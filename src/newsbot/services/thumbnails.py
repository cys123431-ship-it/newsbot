"""Thumbnail extraction helpers for article candidates."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin
from urllib.parse import urlsplit

import httpx

from newsbot.contracts import ArticleCandidate
from newsbot.source_registry import SourceDefinition
from newsbot.text_tools import decode_html_entities


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
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
    "image",
    "image_src",
)
_IMG_ATTRIBUTE_KEYS = (
    "src",
    "data-src",
    "data-original",
    "data-lazy-src",
    "data-image",
    "data-thumb",
)
_LINK_REL_CANDIDATES = {"image_src", "preload", "preconnect"}


class _ThumbnailHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.candidates: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {
            str(key).strip().lower(): str(value or "").strip()
            for key, value in attrs
            if key
        }
        if tag == "meta":
            name = (
                attrs_map.get("property")
                or attrs_map.get("name")
                or attrs_map.get("itemprop")
            ).strip().lower()
            if name in _PREFERRED_META_NAMES or name == "image":
                self._push_candidate(attrs_map.get("content"))
            return

        if tag == "link":
            rel_values = {
                part.strip().lower()
                for part in attrs_map.get("rel", "").split()
                if part.strip()
            }
            if rel_values & _LINK_REL_CANDIDATES:
                if "preload" not in rel_values or attrs_map.get("as", "").strip().lower() == "image":
                    self._push_candidate(attrs_map.get("href"))
            return

        if tag != "img":
            return

        for key in _IMG_ATTRIBUTE_KEYS:
            self._push_candidate(attrs_map.get(key))
        self._push_candidate(_first_srcset_url(attrs_map.get("srcset")))

    def _push_candidate(self, value: str | None) -> None:
        candidate = str(value or "").strip()
        if candidate:
            self.candidates.append(candidate)


def _first_srcset_url(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    first_item = text.split(",", 1)[0].strip()
    if not first_item:
        return None
    return first_item.split()[0].strip() or None


def _normalize_thumbnail_url(url: str | None, *, base_url: str | None = None) -> str | None:
    value = decode_html_entities(str(url or "")).strip()
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
    parser = _ThumbnailHTMLParser()
    try:
        parser.feed(html)
    except Exception:
        return None
    for value in parser.candidates:
        extracted = _normalize_thumbnail_url(value, base_url=base_url)
        if extracted:
            return extracted
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
        candidate.thumbnail_url = _normalize_thumbnail_url(
            candidate.thumbnail_url,
            base_url=candidate.url,
        )
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
