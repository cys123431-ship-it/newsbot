"""String normalization helpers."""

from __future__ import annotations

from hashlib import sha256
import html
import re
from difflib import SequenceMatcher


_TAG_PATTERN = re.compile(r"<[^>]+>")
_SPACE_PATTERN = re.compile(r"\s+")
_TITLE_CLEAN_PATTERN = re.compile(r"[^0-9a-zA-Z가-힣]+")


def strip_html(value: str) -> str:
    unescaped = html.unescape(value or "")
    without_tags = _TAG_PATTERN.sub(" ", unescaped)
    return normalize_whitespace(without_tags)


def normalize_whitespace(value: str) -> str:
    return _SPACE_PATTERN.sub(" ", value or "").strip()


def normalize_title(value: str) -> str:
    cleaned = _TITLE_CLEAN_PATTERN.sub(" ", strip_html(value).lower())
    return normalize_whitespace(cleaned)


def build_title_hash(value: str) -> str:
    return sha256(normalize_title(value).encode("utf-8")).hexdigest()


def guess_language(*values: str) -> str:
    text = " ".join(values)
    return "ko" if re.search(r"[가-힣]", text) else "en"


def similar_titles(left: str, right: str, threshold: float = 0.92) -> bool:
    return SequenceMatcher(None, normalize_title(left), normalize_title(right)).ratio() >= threshold


def limit_summary(value: str, limit: int = 240) -> str:
    normalized = strip_html(value)
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"

