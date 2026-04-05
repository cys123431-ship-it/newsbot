"""RSS adapter."""

from __future__ import annotations

from datetime import datetime, timezone
from time import struct_time

import feedparser
import httpx

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language
from newsbot.text_tools import limit_summary
from newsbot.text_tools import normalize_whitespace


def _from_struct_time(value: struct_time | None) -> datetime | None:
    if value is None:
        return None
    return datetime(*value[:6], tzinfo=timezone.utc)


def _extract_rss_thumbnail(entry) -> str | None:
    for attribute in ("media_thumbnail", "media_content", "enclosures"):
        value = getattr(entry, attribute, None)
        if not value:
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            url = str(item.get("url") or item.get("href") or "").strip()
            if url:
                return url
    links = getattr(entry, "links", None) or []
    for item in links:
        if not isinstance(item, dict):
            continue
        if str(item.get("type") or "").startswith("image/"):
            url = str(item.get("href") or "").strip()
            if url:
                return url
    return None


class RssAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        response = await client.get(source_definition.config["feed_url"])
        response.raise_for_status()
        parsed = feedparser.parse(response.text)
        include_keywords = [
            keyword.lower()
            for keyword in source_definition.config.get("include_keywords", [])
        ]
        candidates: list[ArticleCandidate] = []
        for entry in parsed.entries:
            title = normalize_whitespace(getattr(entry, "title", ""))
            link = normalize_whitespace(getattr(entry, "link", ""))
            summary = getattr(entry, "summary", getattr(entry, "description", ""))
            haystack = f"{title} {summary}".lower()
            if include_keywords and not any(keyword in haystack for keyword in include_keywords):
                continue
            if not title or not link:
                continue
            published_at = _from_struct_time(
                getattr(entry, "published_parsed", None)
                or getattr(entry, "updated_parsed", None)
            )
            candidates.append(
                ArticleCandidate(
                    source_key=source_definition.source_key,
                    source_name=source_definition.name,
                    title=title,
                    url=link,
                    thumbnail_url=_extract_rss_thumbnail(entry),
                    published_at=published_at,
                    summary=limit_summary(summary),
                    category=source_definition.category,
                    language=guess_language(title, summary),
                    trust_level=source_definition.trust_level,
                    raw_payload=dict(entry),
                )
            )
        return candidates

