"""NAVER news search adapter."""

from __future__ import annotations

from datetime import datetime
from email.utils import parsedate_to_datetime

import httpx

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language
from newsbot.text_tools import limit_summary
from newsbot.text_tools import normalize_whitespace
from newsbot.text_tools import strip_html


class NaverNewsAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        if not settings.naver_client_id or not settings.naver_client_secret:
            return []
        headers = {
            "X-Naver-Client-Id": settings.naver_client_id,
            "X-Naver-Client-Secret": settings.naver_client_secret,
        }
        candidates: list[ArticleCandidate] = []
        for query in source_definition.config.get("queries", []):
            response = await client.get(
                "https://openapi.naver.com/v1/search/news.json",
                headers=headers,
                params={
                    "query": query,
                    "display": source_definition.config.get("display", 10),
                    "sort": "date",
                },
            )
            response.raise_for_status()
            payload = response.json()
            for item in payload.get("items", []):
                published_at: datetime | None = None
                if item.get("pubDate"):
                    published_at = parsedate_to_datetime(item["pubDate"])
                url = item.get("originallink") or item.get("link") or ""
                title = strip_html(item.get("title", ""))
                summary = item.get("description", "")
                if not title or not url:
                    continue
                candidates.append(
                    ArticleCandidate(
                        source_key=source_definition.source_key,
                        source_name=source_definition.name,
                        title=title,
                        url=url,
                        published_at=published_at,
                        summary=limit_summary(summary),
                        category=source_definition.category,
                        language=guess_language(title, summary),
                        trust_level=source_definition.trust_level,
                        tags=[query],
                        raw_payload=item,
                    )
                )
        return candidates
