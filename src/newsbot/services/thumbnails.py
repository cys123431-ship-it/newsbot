"""Thumbnail extraction helpers for article candidates."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
import re
from typing import Any
from urllib.parse import urljoin
from urllib.parse import urlsplit

import httpx

from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition


_META_TAG_PATTERN = re.compile(
    r"<meta\b[^>]+(?:property|name)\s*=\s*[\"']([^\"']+)[\"'][^>]+content\s*=\s*[\"']([^\"']+)[\"'][^>]*>",
    re.IGNORECASE,
)
_IMG_TAG_PATTERN = re.compile(
    r"<img\b[^>]+src\s*=\s*[\"']([^\"']+)[\"'][^>]*>",
    re.IGNORECASE,
)
_PREFERRED_KEYS = (
    "thumbnail_url",
    "thumbnail",
    "thumb_url",
    "thumb",
    "image_url",
    "image",
    "og:image",
    "twitter:image",
    "media_thumbnail",
    "media_content",
    "enclosures",
)
_PREFERRED_META_NAMES = (
    "og:image",
    "twitter:image",
    "twitter:image:src",
    "og:image:secure_url",
)


def _normalize_thumbnail_url(url: str | None, *, base_url: str | None = None) -> str | None:
    value = str(url or "").strip()
    if not value:
        return None
    if base_url:
        value = urljoin(base_url, value)
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        return None
    return value


def _extract_from_mapping(raw_payload: Mapping[str, Any], *, base_url: str | None = None) -> str | None:
    for key in _PREFERRED_KEYS:
        value = raw_payload.get(key)
        extracted = _extract_thumbnail_candidate(value, base_url=base_url)
        if extracted:
            return extracted

    for key, value in raw_payload.items():
        lower_key = str(key).strip().lower()
        if "image" in lower_key or "thumb" in lower_key:
            extracted = _extract_thumbnail_candidate(value, base_url=base_url)
            if extracted:
                return extracted
    return None


def _extract_thumbnail_candidate(value: Any, *, base_url: str | None = None) -> str | None:
    if isinstance(value, str):
        return _normalize_thumbnail_url(value, base_url=base_url)
    if isinstance(value, Mapping):
        return _extract_from_mapping(value, base_url=base_url)
    if isinstance(value, list | tuple):
        for item in value:
            extracted = _extract_thumbnail_candidate(item, base_url=base_url)
            if extracted:
                return extracted
    return None


def extract_thumbnail_from_payload(
    raw_payload: Mapping[str, Any] | None,
    *,
    base_url: str | None = None,
) -> str | None:
    if not raw_payload:
        return None
    return _extract_from_mapping(raw_payload, base_url=base_url)


def extract_thumbnail_from_html(html: str, *, base_url: str) -> str | None:
    for name, value in _META_TAG_PATTERN.findall(html):
        if name.strip().lower() in _PREFERRED_META_NAMES:
            extracted = _normalize_thumbnail_url(value, base_url=base_url)
            if extracted:
                return extracted

    img_match = _IMG_TAG_PATTERN.search(html)
    if img_match:
        return _normalize_thumbnail_url(img_match.group(1), base_url=base_url)
    return None


async def hydrate_candidate_thumbnails(
    candidates: list[ArticleCandidate],
    *,
    source_definition: SourceDefinition,
    client: httpx.AsyncClient,
    concurrency: int = 6,
) -> None:
    if not candidates:
        return

    for candidate in candidates:
        if candidate.thumbnail_url:
            continue
        candidate.thumbnail_url = extract_thumbnail_from_payload(
            candidate.raw_payload,
            base_url=candidate.url,
        )

    if not source_definition.allow_page_fetch:
        return

    semaphore = asyncio.Semaphore(max(1, concurrency))
    should_fetch_page = source_definition.adapter_type == "html_discovery"
    tasks = []
    for candidate in candidates:
        if candidate.thumbnail_url:
            continue
        if not should_fetch_page and not candidate.raw_payload:
            continue
        tasks.append(
            _hydrate_thumbnail_from_page(
                candidate,
                client=client,
                semaphore=semaphore,
            )
        )
    if tasks:
        await asyncio.gather(*tasks)


async def _hydrate_thumbnail_from_page(
    candidate: ArticleCandidate,
    *,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> None:
    if candidate.thumbnail_url:
        return
    async with semaphore:
        try:
            response = await client.get(
                candidate.url,
                headers={"Accept": "text/html,application/xhtml+xml"},
            )
            response.raise_for_status()
        except Exception:
            return
        content_type = response.headers.get("content-type", "").lower()
        if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
            return
        html = response.text[:200_000]
        candidate.thumbnail_url = extract_thumbnail_from_html(html, base_url=str(response.url))
