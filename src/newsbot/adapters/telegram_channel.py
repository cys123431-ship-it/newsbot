"""Telegram public channel adapter."""

from __future__ import annotations

from datetime import timezone
from pathlib import Path
import re
from urllib.parse import urlsplit

import httpx
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import MessageEntityTextUrl
from telethon.tl.types import MessageEntityUrl

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language
from newsbot.text_tools import limit_summary
from newsbot.text_tools import normalize_whitespace


_URL_PATTERN = re.compile(r"https?://\S+")


def _clean_url(url: str) -> str | None:
    candidate = url.strip().rstrip(").,")
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return candidate


def _is_telegram_url(url: str) -> bool:
    return urlsplit(url).netloc.lower() in {
        "t.me",
        "www.t.me",
        "telegram.me",
        "www.telegram.me",
    }


def extract_links_from_text(message_text: str) -> list[str]:
    links: list[str] = []
    seen: set[str] = set()
    for match in _URL_PATTERN.finditer(message_text):
        candidate = _clean_url(match.group(0))
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        links.append(candidate)
    return links


def extract_link_from_message(message) -> str | None:
    text = message.message or ""
    links = extract_links_from_text(text)

    for entity in message.entities or []:
        candidate: str | None = None
        if isinstance(entity, MessageEntityTextUrl):
            candidate = _clean_url(entity.url)
        elif isinstance(entity, MessageEntityUrl):
            candidate = _clean_url(text[entity.offset : entity.offset + entity.length])
        if candidate and candidate not in links:
            links.append(candidate)

    preview_url = _clean_url(
        getattr(getattr(getattr(message, "media", None), "webpage", None), "url", "") or ""
    )
    if preview_url and preview_url not in links:
        links.append(preview_url)

    for link in links:
        if not _is_telegram_url(link):
            return link
    return links[0] if links else None


def extract_title_from_message(
    message_text: str,
    url: str | None,
    *,
    preview_title: str | None = None,
) -> str:
    first_line = normalize_whitespace(message_text.splitlines()[0] if message_text else "")
    if first_line and (not url or first_line != url):
        return first_line
    fallback_title = normalize_whitespace(preview_title or "")
    return fallback_title or "Telegram discovery item"


class TelegramChannelAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        del client
        if not settings.telegram_runtime_enabled:
            return []
        session = _build_telegram_session(settings)
        assert session is not None
        channel_name = source_definition.config["channel"]
        telegram_client = TelegramClient(
            session,
            int(settings.telegram_api_id),
            settings.telegram_api_hash,
        )
        candidates: list[ArticleCandidate] = []
        async with telegram_client:
            async for message in telegram_client.iter_messages(channel_name, limit=20):
                text = normalize_whitespace(message.message or "")
                url = extract_link_from_message(message)
                if not url:
                    continue
                preview_title = getattr(
                    getattr(getattr(message, "media", None), "webpage", None),
                    "title",
                    None,
                )
                title = extract_title_from_message(text, url, preview_title=preview_title)
                published_at = None
                if message.date:
                    published_at = message.date.astimezone(timezone.utc)
                candidates.append(
                    ArticleCandidate(
                        source_key=source_definition.source_key,
                        source_name=source_definition.name,
                        title=title,
                        url=url,
                        published_at=published_at,
                        summary=limit_summary(text),
                        category=None,
                        language=guess_language(text),
                        trust_level=source_definition.trust_level,
                    )
                )
        return candidates


def _build_telegram_session(settings: Settings) -> str | StringSession | None:
    if settings.telegram_session_string:
        return StringSession(settings.telegram_session_string)
    if _has_local_session_file(settings.telegram_session_name):
        return settings.telegram_session_name
    return None


def _has_local_session_file(session_name: str) -> bool:
    session_path = Path(session_name)
    candidates = [session_path]
    if session_path.suffix != ".session":
        candidates.append(session_path.with_suffix(".session"))
    return any(candidate.exists() for candidate in candidates)
