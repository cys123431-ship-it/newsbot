"""String normalization helpers."""

from __future__ import annotations

from difflib import SequenceMatcher
from hashlib import sha256
import html
import re


_TAG_PATTERN = re.compile(r"<[^>]+>")
_SPACE_PATTERN = re.compile(r"\s+")
_TITLE_CLEAN_PATTERN = re.compile(r"[^0-9a-zA-Z\uac00-\ud7a3]+")
_KOREAN_TEXT_PATTERN = re.compile(r"[\uac00-\ud7a3]")


def decode_html_entities(value: str) -> str:
    return html.unescape(value or "").replace("\xa0", " ")


def normalize_whitespace(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value or "").strip()


def strip_html(value: str) -> str:
    without_tags = _TAG_PATTERN.sub(" ", decode_html_entities(value))
    return normalize_whitespace(without_tags)


def clean_headline(value: str) -> str:
    return strip_html(value)


def normalize_title(value: str) -> str:
    cleaned = _TITLE_CLEAN_PATTERN.sub(" ", clean_headline(value).lower())
    return normalize_whitespace(cleaned)


def build_title_hash(value: str) -> str:
    return sha256(normalize_title(value).encode("utf-8")).hexdigest()


def guess_language(*values: str) -> str:
    text = " ".join(values)
    return "ko" if _KOREAN_TEXT_PATTERN.search(text) else "en"


def similar_titles(left: str, right: str, threshold: float = 0.92) -> bool:
    return SequenceMatcher(None, normalize_title(left), normalize_title(right)).ratio() >= threshold


def limit_summary(value: str, limit: int = 240) -> str:
    normalized = strip_html(value)
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."
