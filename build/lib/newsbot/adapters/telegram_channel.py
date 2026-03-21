"""Telegram public channel adapter."""

from __future__ import annotations

from datetime import timezone
import re

import httpx
from telethon import TelegramClient

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import guess_language
from newsbot.text_tools import limit_summary
from newsbot.text_tools import normalize_whitespace


_URL_PATTERN = re.compile(r"https?://\S+")


def extract_link_from_text(message_text: str) -> str | None:
    match = _URL_PATTERN.search(message_text)
    if not match:
        return None
    return match.group(0).rstrip(").,")


def extract_title_from_message(message_text: str, url: str | None) -> str:
    first_line = normalize_whitespace(message_text.splitlines()[0] if message_text else "")
    if url and first_line == url:
        return "Telegram discovery item"
    return first_line or "Telegram discovery item"


class TelegramChannelAdapter:
    async def fetch(
        self,
        source_definition: SourceDefinition,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> list[ArticleCandidate]:
        del client
        if not settings.telegram_input_enabled:
            return []
        if not settings.telegram_api_id or not settings.telegram_api_hash:
            return []
        channel_name = source_definition.config["channel"]
        telegram_client = TelegramClient(
            settings.telegram_session_name,
            int(settings.telegram_api_id),
            settings.telegram_api_hash,
        )
        candidates: list[ArticleCandidate] = []
        async with telegram_client:
            async for message in telegram_client.iter_messages(channel_name, limit=20):
                text = normalize_whitespace(message.message or "")
                url = extract_link_from_text(text)
                if not url:
                    continue
                title = extract_title_from_message(text, url)
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

