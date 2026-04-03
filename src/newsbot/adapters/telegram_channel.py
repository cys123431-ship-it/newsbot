"""Telegram public channel adapter."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
from html import unescape
from html.parser import HTMLParser
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
_PUBLIC_CHANNEL_PATH = "https://t.me/s/{channel}"
_PUBLIC_MESSAGE_LIMIT = 20


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
    return None


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


@dataclass(slots=True)
class PublicTelegramMessage:
    text: str
    links: list[str]
    published_at: datetime | None = None


class _TelegramPublicPageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[PublicTelegramMessage] = []
        self._message_depth = 0
        self._message_text_depth = 0
        self._links: list[str] = []
        self._parts: list[str] = []
        self._published_at: datetime | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = dict(attrs)
        classes = set((attrs_map.get("class") or "").split())

        if tag == "div" and "tgme_widget_message_wrap" in classes:
            self._message_depth = 1
            self._message_text_depth = 0
            self._links = []
            self._parts = []
            self._published_at = None
            return

        if self._message_depth == 0:
            return

        if tag == "div":
            self._message_depth += 1
            if "tgme_widget_message_text" in classes:
                self._message_text_depth = 1
            elif self._message_text_depth > 0:
                self._message_text_depth += 1
            return

        if tag == "br" and self._message_text_depth > 0:
            self._parts.append("\n")
            return

        if tag == "time":
            raw_datetime = attrs_map.get("datetime")
            if raw_datetime:
                self._published_at = _parse_public_message_datetime(raw_datetime)
            return

        if tag != "a":
            return

        href = _clean_url(unescape(attrs_map.get("href") or ""))
        if href and href not in self._links:
            self._links.append(href)

    def handle_data(self, data: str) -> None:
        if self._message_depth > 0 and self._message_text_depth > 0:
            self._parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self._message_depth == 0 or tag != "div":
            return

        if self._message_text_depth > 0:
            self._message_text_depth -= 1

        self._message_depth -= 1
        if self._message_depth == 0:
            raw_text = unescape("".join(self._parts)).replace("\xa0", " ")
            text = "\n".join(
                line
                for line in (
                    normalize_whitespace(part)
                    for part in raw_text.splitlines()
                )
                if line
            )
            self.messages.append(
                PublicTelegramMessage(
                    text=text,
                    links=list(self._links),
                    published_at=self._published_at,
                )
            )
            self._message_text_depth = 0
            self._links = []
            self._parts = []
            self._published_at = None


def _parse_public_message_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value).astimezone(timezone.utc)
    except ValueError:
        return None


def extract_candidates_from_public_channel_html(
    source_definition: SourceDefinition,
    html: str,
) -> list[ArticleCandidate]:
    parser = _TelegramPublicPageParser()
    parser.feed(html)
    candidates: list[ArticleCandidate] = []
    for message in parser.messages[:_PUBLIC_MESSAGE_LIMIT]:
        url = next((link for link in message.links if not _is_telegram_url(link)), None)
        if not url:
            continue
        title = extract_title_from_message(message.text, url)
        candidates.append(
            ArticleCandidate(
                source_key=source_definition.source_key,
                source_name=source_definition.name,
                title=title,
                url=url,
                published_at=message.published_at,
                summary=limit_summary(message.text),
                category=None,
                language=guess_language(message.text),
                trust_level=source_definition.trust_level,
            )
        )
    return candidates


class TelegramChannelAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        telethon_error: Exception | None = None
        if settings.telegram_runtime_enabled:
            try:
                candidates = await self._fetch_via_telethon(source_definition, settings)
            except Exception as exc:
                telethon_error = exc
            else:
                if candidates:
                    return candidates

        public_candidates = await self._fetch_via_public_page(source_definition, client)
        if public_candidates or telethon_error is None:
            return public_candidates
        raise telethon_error

    async def _fetch_via_telethon(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
    ) -> list[ArticleCandidate]:
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

    async def _fetch_via_public_page(
        self,
        source_definition: SourceDefinition,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        channel_name = source_definition.config["channel"]
        response = await client.get(_PUBLIC_CHANNEL_PATH.format(channel=channel_name))
        response.raise_for_status()
        return extract_candidates_from_public_channel_html(
            source_definition,
            response.text,
        )


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
