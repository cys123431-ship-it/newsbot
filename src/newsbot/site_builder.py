"""Build a static GitHub Pages site from curated news sources."""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import replace
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from functools import lru_cache
from hashlib import sha256
import json
from math import ceil
from pathlib import Path
import re
import shutil
from typing import Any
from urllib.parse import urlsplit
from urllib.parse import urlunsplit

import httpx
from jinja2 import Environment
from jinja2 import FileSystemLoader
from jinja2 import select_autoescape

from newsbot.config import Settings
from newsbot.config import get_settings
from newsbot.contracts import ArticleCandidate
from newsbot.markets_builder import build_markets_bundle
from newsbot.markets_builder import MARKETS_CRYPTO_FILENAME
from newsbot.markets_builder import MARKETS_DIRECTORY_NAME
from newsbot.markets_builder import MARKETS_KOREA_FILENAME
from newsbot.markets_builder import MARKETS_OVERVIEW_FILENAME
from newsbot.markets_builder import MARKETS_STATUS_FILENAME
from newsbot.markets_builder import MARKETS_STOCKS_FILENAME
from newsbot.services.classifier import classify_candidate
from newsbot.services.classifier import is_blocked_candidate_url
from newsbot.services.dedupe import canonicalize_candidate
from newsbot.services.ingest import ADAPTERS
from newsbot.services.ingest import _fetch_with_retries
from newsbot.services.thumbnails import hydrate_candidate_thumbnails
from newsbot.source_registry import BLOCKED_SOURCE_KEYS
from newsbot.source_registry import SourceDefinition
from newsbot.source_registry import get_source_definitions
from newsbot.text_tools import build_title_hash
from newsbot.text_tools import clean_headline
from newsbot.text_tools import decode_html_entities
from newsbot.text_tools import normalize_whitespace
from newsbot.text_tools import similar_titles
from newsbot.text_tools import strip_html


PACKAGE_DIR = Path(__file__).resolve().parent
SITE_TEMPLATE_DIR = PACKAGE_DIR / "site_templates"
SITE_ASSET_DIR = PACKAGE_DIR / "site_assets"
REMOVED_ARTICLES_LOG_FILENAME = "removed-articles.txt"
ANALYSIS_STATE_FILENAME = "analysis-state.json"
ANALYSIS_DASHBOARD_FILENAME = "analysis-dashboard.json"
ANALYSIS_DIRECTORY_NAME = "analysis"
ANALYSIS_RETENTION_DAYS = 90
STATIC_FEED_PAGE_SIZE = 12
ANALYSIS_TOP_ITEM_LIMIT = 12
ANALYSIS_REPEAT_LIMIT = 20
ANALYSIS_SAMPLE_LIMIT = 30
ANALYSIS_WINDOW_DEFINITIONS = (
    ("24h", "24h", timedelta(hours=24)),
    ("7d", "7d", timedelta(days=7)),
    ("30d", "30d", timedelta(days=30)),
    ("90d", "90d", timedelta(days=90)),
    ("all", "All", None),
)
_ANALYSIS_TOKEN_PATTERN = re.compile(r"[0-9a-zA-Z\uac00-\ud7a3]+")
_ANALYSIS_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "was",
    "were",
    "will",
    "with",
    "\uc18d\ubcf4",
    "\ub2e8\ub3c5",
    "\uc601\uc0c1",
    "\uc0ac\uc9c4",
    "\ub274\uc2a4",
    "\uc785\uc7a5",
    "\ud604\uc7a5",
    "\uc624\ub298",
    "\uad00\ub828",
    "\ub300\ud574",
    "\uc815\ubd80",
    "\uae30\uc790",
    "news",
    "update",
    "updates",
    "live",
    "breaking",
}
_FEATURED_PRIORITY_BY_SCOPE = {
    "all": ("kr-economy", "us-economy", "us-markets", "crypto", "tech-it", "kr-politics", "us-politics"),
    "kr": ("kr-economy", "kr-society", "kr-local", "kr-culture", "kr-sports", "kr-politics"),
    "us": ("us-economy", "us-markets", "us-world", "us-technology", "us-politics"),
    "global": ("crypto", "tech-it", "military"),
}


def _clean_display_text(value: Any, *, fallback: str = "") -> str:
    cleaned = strip_html(str(value or ""))
    return cleaned or fallback


def _get_featured_priority_map(scope: str) -> dict[str, int]:
    ordered_categories = _FEATURED_PRIORITY_BY_SCOPE.get(scope, ())
    return {category_key: index for index, category_key in enumerate(ordered_categories)}


def _display_priority_tuple(
    article: StaticArticle | dict[str, Any],
    *,
    scope: str = "all",
    section: str = "all",
) -> tuple[int, int, int, str]:
    category_key = (
        article.primary_category
        if isinstance(article, StaticArticle)
        else str(article.get("primary_category") or "")
    )
    sort_timestamp = (
        article.sort_timestamp
        if isinstance(article, StaticArticle)
        else int(article.get("sort_timestamp") or 0)
    )
    trust_level = (
        article.trust_level
        if isinstance(article, StaticArticle)
        else int(article.get("trust_level") or 0)
    )
    title = article.title if isinstance(article, StaticArticle) else str(article.get("title") or "")
    if section and section != "all":
        priority_rank = 0 if category_key == section else 1
    else:
        priority_rank = _get_featured_priority_map(scope).get(category_key, 999)
    return (priority_rank, -sort_timestamp, -trust_level, title.lower())


def _prioritize_feed_articles(
    articles: list[StaticArticle | dict[str, Any]],
    *,
    scope: str = "all",
    section: str = "all",
) -> list[StaticArticle | dict[str, Any]]:
    return sorted(
        articles,
        key=lambda article: _display_priority_tuple(article, scope=scope, section=section),
    )


@dataclass(frozen=True, slots=True)
class StaticArticle:
    title: str
    canonical_url: str
    source_key: str
    source_name: str
    thumbnail_url: str | None
    primary_category: str
    published_at: datetime | None
    trust_level: int
    language: str
    normalized_title: str
    title_hash: str
    source_names: tuple[str, ...] = ()

    @property
    def link_label(self) -> str:
        parts = urlsplit(self.canonical_url)
        path = parts.path.rstrip("/") or "/"
        short_path = path if len(path) <= 42 else path[:39].rstrip("/") + "..."
        query = f"?{parts.query}" if parts.query else ""
        return f"{parts.netloc}{short_path}{query}"

    @property
    def sort_timestamp(self) -> int:
        if self.published_at is None:
            return 0
        return int(self.published_at.timestamp())

    def to_public_dict(self) -> dict[str, Any]:
        category_meta = _get_category_payload_entry(self.primary_category)
        return {
            "title": self.title,
            "canonical_url": self.canonical_url,
            "link_label": self.link_label,
            "source_key": self.source_key,
            "source_name": self.source_name,
            "thumbnail_url": self.thumbnail_url,
            "source_names": list(self.source_names or (self.source_name,)),
            "primary_category": self.primary_category,
            "hub": category_meta["hub"],
            "hub_label": category_meta["hub_label"],
            "section_key": category_meta["key"],
            "section_label": category_meta["label"],
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "trust_level": self.trust_level,
            "language": self.language,
            "sort_timestamp": self.sort_timestamp,
        }

    @classmethod
    def from_public_dict(cls, raw: dict[str, Any]) -> StaticArticle:
        title = _clean_display_text(raw.get("title"))
        source_name = _clean_display_text(raw.get("source_name"), fallback="Unknown")
        source_names = tuple(
            _clean_display_text(name)
            for name in raw.get("source_names", [])
            if _clean_display_text(name)
        ) or (source_name,)
        normalized_title = " ".join(title.split()).lower()
        return cls(
            title=title,
            canonical_url=str(raw.get("canonical_url") or "").strip(),
            source_key=str(raw.get("source_key") or "").strip(),
            source_name=source_name,
            thumbnail_url=decode_html_entities(str(raw.get("thumbnail_url") or "")).strip() or None,
            primary_category=str(raw.get("primary_category") or "").strip(),
            published_at=_parse_optional_datetime(raw.get("published_at")),
            trust_level=int(raw.get("trust_level") or 0),
            language=str(raw.get("language") or "unknown"),
            normalized_title=normalized_title,
            title_hash=build_title_hash(title),
            source_names=source_names,
        )


@dataclass(slots=True)
class SourceBuildStatus:
    source_key: str
    source_name: str
    category: str | None
    trust_level: int
    status: str
    fetched_count: int = 0
    accepted_count: int = 0
    published_count: int = 0
    message: str | None = None
    error: str | None = None

    def to_public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if payload["message"] is None and payload["error"]:
            payload["message"] = payload["error"]
        return payload


@dataclass(frozen=True, slots=True)
class AnalysisArticle:
    stable_key: str
    source_key: str
    source_name: str
    category: str
    hub: str
    hub_label: str
    section_label: str
    language: str
    title: str
    canonical_url: str
    published_at: datetime | None
    title_hash: str
    keywords: tuple[str, ...] = ()

    @property
    def sort_timestamp(self) -> int:
        if self.published_at is None:
            return 0
        return int(self.published_at.timestamp())

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "stable_key": self.stable_key,
            "source_key": self.source_key,
            "source_name": self.source_name,
            "category": self.category,
            "hub": self.hub,
            "hub_label": self.hub_label,
            "section_label": self.section_label,
            "language": self.language,
            "title": self.title,
            "canonical_url": self.canonical_url,
            "published_at": self.published_at.isoformat() if self.published_at else None,
            "title_hash": self.title_hash,
            "keywords": list(self.keywords),
        }

    @classmethod
    def from_public_dict(cls, raw: dict[str, Any]) -> AnalysisArticle:
        source_key = str(raw.get("source_key") or "").strip()
        canonical_url = str(raw.get("canonical_url") or "").strip()
        title = _clean_display_text(raw.get("title"))
        return cls(
            stable_key=str(raw.get("stable_key") or _build_analysis_stable_key(source_key, canonical_url)),
            source_key=source_key,
            source_name=_clean_display_text(raw.get("source_name"), fallback=source_key),
            category=str(raw.get("category") or "").strip(),
            hub=str(raw.get("hub") or "global").strip() or "global",
            hub_label=str(raw.get("hub_label") or "").strip(),
            section_label=str(raw.get("section_label") or "").strip(),
            language=str(raw.get("language") or "unknown").strip() or "unknown",
            title=title,
            canonical_url=canonical_url,
            published_at=_parse_optional_datetime(raw.get("published_at")),
            title_hash=str(raw.get("title_hash") or build_title_hash(title)).strip(),
            keywords=tuple(
                str(keyword).strip()
                for keyword in raw.get("keywords", [])
                if str(keyword).strip()
            ),
        )


@dataclass(frozen=True, slots=True)
class SourceCollectionResult:
    display_articles: list[StaticArticle]
    analysis_articles: list[AnalysisArticle]
    status: SourceBuildStatus


def list_static_sources(
    source_definitions: list[SourceDefinition] | None = None,
) -> list[SourceDefinition]:
    definitions = source_definitions or get_source_definitions()
    return [
        definition
        for definition in definitions
        if definition.static_enabled and definition.source_key not in BLOCKED_SOURCE_KEYS
    ]


async def collect_site_payload(
    settings: Settings,
    *,
    archive_articles: list[StaticArticle] | None = None,
    source_definitions: list[SourceDefinition] | None = None,
    adapters: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[StaticArticle], list[AnalysisArticle]]:
    active_sources = list_static_sources(source_definitions)
    active_adapters = adapters or ADAPTERS
    semaphore = asyncio.Semaphore(settings.static_fetch_concurrency)
    statuses: list[SourceBuildStatus] = []

    async with httpx.AsyncClient(
        follow_redirects=True,
        headers={"User-Agent": "newsbot-static/0.1"},
        timeout=settings.request_timeout_sec,
    ) as client:
        tasks = [
            _collect_source(
                source_definition,
                settings,
                client,
                semaphore,
                active_adapters,
            )
            for source_definition in active_sources
        ]
        source_results = await asyncio.gather(*tasks)

    gathered_articles: list[StaticArticle] = []
    analysis_articles: list[AnalysisArticle] = []
    for result in source_results:
        statuses.append(result.status)
        gathered_articles.extend(result.display_articles)
        analysis_articles.extend(result.analysis_articles)

    deduped_articles, evicted_articles = dedupe_static_articles(
        [
            *[
                article
                for article in (archive_articles or [])
                if article.source_key not in BLOCKED_SOURCE_KEYS
            ],
            *gathered_articles,
        ],
        max_total=settings.static_max_total_articles,
    )
    published_counts = Counter(article.source_key for article in deduped_articles)
    for status in statuses:
        status.published_count = published_counts.get(status.source_key, 0)

    category_counts = Counter(article.primary_category for article in deduped_articles)
    category_payload = _build_category_payload(category_counts)
    source_options = [
        {
            "source_key": status.source_key,
            "name": status.source_name,
            "category": status.category,
            "count": status.published_count,
            "hub": _resolve_source_hub(status),
            "section": status.category,
            "section_label": _get_category_payload_entry(status.category)["label"] if status.category else "자동 분류",
            "publisher_group": _resolve_publisher_group(status.source_key, source_definitions),
        }
        for status in sorted(
            statuses,
            key=lambda item: (-item.published_count, -item.trust_level, item.source_name),
        )
        if status.published_count > 0
    ]

    payload = {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "article_count": len(deduped_articles),
        "removed_article_count": len(evicted_articles),
        "removed_articles_log_path": f"data/{REMOVED_ARTICLES_LOG_FILENAME}",
        "page_size": settings.article_page_size,
        "feed_page_size": STATIC_FEED_PAGE_SIZE,
        "healthy_source_count": sum(status.status == "ok" for status in statuses),
        "warning_source_count": sum(status.status == "warning" for status in statuses),
        "failed_source_count": sum(status.status == "failed" for status in statuses),
        "hubs": _build_hub_payload(category_payload, deduped_articles),
        "categories": category_payload,
        "sources": source_options,
        "source_statuses": [status.to_public_dict() for status in statuses],
        "articles": [article.to_public_dict() for article in deduped_articles],
    }
    if payload["article_count"] < settings.static_min_articles_to_publish:
        raise RuntimeError(
            f"Refusing to publish only {payload['article_count']} articles; "
            f"minimum is {settings.static_min_articles_to_publish}."
        )
    return payload, evicted_articles, analysis_articles


async def _collect_source(
    source_definition: SourceDefinition,
    settings: Settings,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    adapters: dict[str, Any],
) -> SourceCollectionResult:
    status = SourceBuildStatus(
        source_key=source_definition.source_key,
        source_name=source_definition.name,
        category=source_definition.category,
        trust_level=source_definition.trust_level,
        status="ok",
    )
    preflight_message = _get_source_warning_message(source_definition, settings)
    if preflight_message is not None:
        status.status = "warning"
        status.message = preflight_message
        return SourceCollectionResult(display_articles=[], analysis_articles=[], status=status)

    adapter = adapters.get(source_definition.adapter_type)
    if adapter is None:
        status.status = "failed"
        status.error = (
            f"Source adapter is not registered for static builds: {source_definition.adapter_type}."
        )
        status.message = status.error
        return SourceCollectionResult(display_articles=[], analysis_articles=[], status=status)
    try:
        async with semaphore:
            candidates = await _fetch_with_retries(adapter, source_definition, settings, client)
            await hydrate_candidate_thumbnails(
                candidates,
                source_definition=source_definition,
                client=client,
            )
    except Exception as exc:
        status.status = "failed"
        status.error = str(exc)
        status.message = status.error
        return SourceCollectionResult(display_articles=[], analysis_articles=[], status=status)

    status.fetched_count = len(candidates)
    if source_definition.adapter_type == "telegram_channel" and status.fetched_count == 0:
        status.status = "warning"
        status.message = "No usable external article links found in the latest 20 messages."
    accepted_articles: list[StaticArticle] = []
    analysis_articles: list[AnalysisArticle] = []
    for candidate in candidates:
        candidate.title = clean_headline(candidate.title)
        if not candidate.title:
            continue
        category = classify_candidate(candidate, source_definition)
        if category is None:
            continue
        if not _allow_static_candidate(candidate):
            continue
        canonical_url, normalized_title, title_hash = canonicalize_candidate(candidate)
        accepted_articles.append(
            StaticArticle(
                title=_clean_display_text(candidate.title),
                canonical_url=canonical_url,
                source_key=source_definition.source_key,
                source_name=_clean_display_text(
                    source_definition.name,
                    fallback=source_definition.source_key,
                ),
                thumbnail_url=candidate.thumbnail_url,
                primary_category=category,
                published_at=candidate.published_at,
                trust_level=max(candidate.trust_level, source_definition.trust_level),
                language=candidate.language or "unknown",
                normalized_title=normalized_title,
                title_hash=title_hash,
                source_names=(
                    _clean_display_text(
                        source_definition.name,
                        fallback=source_definition.source_key,
                    ),
                ),
            )
        )
        analysis_articles.append(
            _build_analysis_article(
                candidate,
                category=category,
                canonical_url=canonical_url,
                title_hash=title_hash,
            )
        )

    accepted_articles.sort(key=_article_sort_key, reverse=True)
    limited_articles = accepted_articles[: settings.static_max_articles_per_source]
    status.accepted_count = len(limited_articles)
    analysis_articles.sort(key=_analysis_article_sort_key, reverse=True)
    return SourceCollectionResult(
        display_articles=limited_articles,
        analysis_articles=analysis_articles,
        status=status,
    )


def _get_source_warning_message(
    source_definition: SourceDefinition,
    settings: Settings,
) -> str | None:
    if source_definition.adapter_type == "naver_search":
        missing_settings: list[str] = []
        if not settings.naver_client_id:
            missing_settings.append("NEWSBOT_NAVER_CLIENT_ID")
        if not settings.naver_client_secret:
            missing_settings.append("NEWSBOT_NAVER_CLIENT_SECRET")
        if missing_settings:
            return (
                "NAVER news search not configured: missing "
                + ", ".join(missing_settings)
                + "."
            )

    return None


def _build_analysis_stable_key(source_key: str, canonical_url: str) -> str:
    return sha256(f"{source_key}:{canonical_url}".encode("utf-8")).hexdigest()


def _extract_analysis_keywords(title: str, tags: list[str] | tuple[str, ...]) -> tuple[str, ...]:
    raw_parts = [strip_html(title)]
    raw_parts.extend(str(tag or "") for tag in tags)
    normalized = normalize_whitespace(" ".join(raw_parts)).lower()
    if not normalized:
        return ()

    tokens: list[str] = []
    for match in _ANALYSIS_TOKEN_PATTERN.findall(normalized):
        token = match.strip().lower()
        if len(token) < 2:
            continue
        if token.isdigit():
            continue
        if token in _ANALYSIS_STOPWORDS:
            continue
        tokens.append(token)

    if not tokens:
        return ()

    keywords: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        keywords.append(token)
        if len(keywords) >= 6:
            return tuple(keywords)

    for left, right in zip(tokens, tokens[1:]):
        bigram = f"{left} {right}"
        if bigram in seen:
            continue
        seen.add(bigram)
        keywords.append(bigram)
        if len(keywords) >= 6:
            break
    return tuple(keywords)


def _build_analysis_article(
    candidate: ArticleCandidate,
    *,
    category: str,
    canonical_url: str,
    title_hash: str,
) -> AnalysisArticle:
    category_meta = _get_category_payload_entry(category)
    cleaned_title = _clean_display_text(candidate.title)
    return AnalysisArticle(
        stable_key=_build_analysis_stable_key(candidate.source_key, canonical_url),
        source_key=candidate.source_key,
        source_name=_clean_display_text(candidate.source_name, fallback=candidate.source_key),
        category=category,
        hub=category_meta["hub"],
        hub_label=category_meta["hub_label"],
        section_label=category_meta["label"],
        language=candidate.language or "unknown",
        title=cleaned_title,
        canonical_url=canonical_url,
        published_at=candidate.published_at,
        title_hash=title_hash,
        keywords=_extract_analysis_keywords(cleaned_title, candidate.tags),
    )


def dedupe_static_articles(
    articles: list[StaticArticle],
    *,
    max_total: int,
) -> tuple[list[StaticArticle], list[StaticArticle]]:
    deduped: list[StaticArticle] = []
    url_index: dict[str, int] = {}
    hash_index: dict[str, list[int]] = {}

    for article in sorted(articles, key=_article_sort_key, reverse=True):
        existing_index = url_index.get(article.canonical_url)
        if existing_index is None:
            for candidate_index in hash_index.get(article.title_hash, []):
                existing_article = deduped[candidate_index]
                if not _within_dedupe_window(existing_article, article):
                    continue
                if existing_article.normalized_title == article.normalized_title or similar_titles(
                    existing_article.title,
                    article.title,
                ):
                    existing_index = candidate_index
                    break

        if existing_index is None:
            url_index[article.canonical_url] = len(deduped)
            hash_index.setdefault(article.title_hash, []).append(len(deduped))
            deduped.append(article)
            continue

        deduped[existing_index] = _merge_articles(deduped[existing_index], article)
        url_index[deduped[existing_index].canonical_url] = existing_index

    deduped.sort(key=_article_sort_key, reverse=True)
    return deduped[:max_total], deduped[max_total:]


def _merge_articles(current: StaticArticle, incoming: StaticArticle) -> StaticArticle:
    current_rank = (
        current.trust_level,
        current.sort_timestamp,
        len(current.title),
    )
    incoming_rank = (
        incoming.trust_level,
        incoming.sort_timestamp,
        len(incoming.title),
    )
    preferred = incoming if incoming_rank > current_rank else current
    merged_sources = tuple(
        sorted(set(current.source_names or (current.source_name,)) | set(incoming.source_names or (incoming.source_name,)))
    )
    return replace(preferred, source_names=merged_sources)


def _within_dedupe_window(left: StaticArticle, right: StaticArticle) -> bool:
    if left.published_at is None or right.published_at is None:
        return True
    return abs((left.published_at - right.published_at).total_seconds()) <= 36 * 3600


def _allow_static_candidate(candidate: ArticleCandidate) -> bool:
    if candidate.source_key in BLOCKED_SOURCE_KEYS:
        return False
    if not candidate.title or len(candidate.title.strip()) < 12:
        return False
    if not candidate.url.startswith(("http://", "https://")):
        return False
    if is_blocked_candidate_url(candidate.url):
        return False
    blocked_hosts = {"news.naver.com", "n.news.naver.com"}
    if (
        urlsplit(candidate.url).netloc.lower() in blocked_hosts
        and not candidate.source_key.startswith("naver-")
    ):
        return False
    blocked_title_fragments = ("포토", "[속보]", "속보:")
    normalized_title = candidate.title.strip()
    if any(fragment in normalized_title for fragment in blocked_title_fragments):
        return False
    return True


def _parse_optional_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    return datetime.fromisoformat(text)


def _article_sort_key(article: StaticArticle) -> tuple[int, int, str]:
    return (
        article.sort_timestamp,
        article.trust_level,
        article.title.lower(),
    )


def _analysis_article_sort_key(article: AnalysisArticle) -> tuple[int, str, str]:
    return (
        article.sort_timestamp,
        article.source_name.lower(),
        article.title.lower(),
    )


def _empty_analysis_lifetime() -> dict[str, Any]:
    return {
        "total_articles": 0,
        "unknown_time_count": 0,
        "daily_counts": {},
        "source_counts": {},
        "hub_counts": {},
        "section_counts": {},
        "language_counts": {},
        "keyword_counts": {},
        "title_groups": {},
    }


def _normalize_analysis_lifetime(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _empty_analysis_lifetime()

    lifetime = _empty_analysis_lifetime()
    lifetime["total_articles"] = max(0, int(raw.get("total_articles") or 0))
    lifetime["unknown_time_count"] = max(0, int(raw.get("unknown_time_count") or 0))

    for day_key, count in (raw.get("daily_counts") or {}).items():
        if not isinstance(day_key, str):
            continue
        lifetime["daily_counts"][day_key] = max(0, int(count or 0))

    for source_key, entry in (raw.get("source_counts") or {}).items():
        if not isinstance(source_key, str):
            continue
        payload = entry if isinstance(entry, dict) else {}
        lifetime["source_counts"][source_key] = {
            "source_key": source_key,
            "name": str(payload.get("name") or source_key),
            "count": max(0, int(payload.get("count") or 0)),
        }

    for hub_key, entry in (raw.get("hub_counts") or {}).items():
        if not isinstance(hub_key, str):
            continue
        payload = entry if isinstance(entry, dict) else {}
        lifetime["hub_counts"][hub_key] = {
            "key": hub_key,
            "label": str(payload.get("label") or hub_key),
            "count": max(0, int(payload.get("count") or 0)),
        }

    for section_key, entry in (raw.get("section_counts") or {}).items():
        if not isinstance(section_key, str):
            continue
        payload = entry if isinstance(entry, dict) else {}
        lifetime["section_counts"][section_key] = {
            "key": section_key,
            "label": str(payload.get("label") or section_key),
            "hub": str(payload.get("hub") or _infer_hub_key(section_key)),
            "hub_label": str(payload.get("hub_label") or _default_hub_definition(_infer_hub_key(section_key))["label"]),
            "count": max(0, int(payload.get("count") or 0)),
        }

    for language, count in (raw.get("language_counts") or {}).items():
        if not isinstance(language, str):
            continue
        lifetime["language_counts"][language] = max(0, int(count or 0))

    for keyword, count in (raw.get("keyword_counts") or {}).items():
        if not isinstance(keyword, str):
            continue
        lifetime["keyword_counts"][keyword] = max(0, int(count or 0))

    for title_hash, entry in (raw.get("title_groups") or {}).items():
        if not isinstance(title_hash, str):
            continue
        payload = entry if isinstance(entry, dict) else {}
        lifetime["title_groups"][title_hash] = {
            "title_hash": title_hash,
            "title": str(payload.get("title") or ""),
            "article_count": max(0, int(payload.get("article_count") or 0)),
            "source_keys": sorted(
                {
                    str(source_key).strip()
                    for source_key in payload.get("source_keys", [])
                    if str(source_key).strip()
                }
            ),
            "source_names": sorted(
                {
                    str(source_name).strip()
                    for source_name in payload.get("source_names", [])
                    if str(source_name).strip()
                }
            ),
            "latest_published_at": str(payload.get("latest_published_at") or "").strip() or None,
            "canonical_url": str(payload.get("canonical_url") or "").strip(),
        }
    return lifetime


def _load_recent_analysis_articles(raw: Any) -> list[AnalysisArticle]:
    if not isinstance(raw, dict):
        return []
    recent_articles: list[AnalysisArticle] = []
    for raw_article in raw.get("recent_articles", []):
        if not isinstance(raw_article, dict):
            continue
        try:
            article = AnalysisArticle.from_public_dict(raw_article)
        except Exception:
            continue
        if is_blocked_candidate_url(article.canonical_url):
            continue
        if article.stable_key and article.title and article.canonical_url and article.category:
            recent_articles.append(article)
    return recent_articles


def _apply_analysis_article_to_lifetime(lifetime: dict[str, Any], article: AnalysisArticle) -> None:
    lifetime["total_articles"] += 1

    source_entry = lifetime["source_counts"].setdefault(
        article.source_key,
        {"source_key": article.source_key, "name": article.source_name, "count": 0},
    )
    source_entry["name"] = article.source_name
    source_entry["count"] += 1

    hub_entry = lifetime["hub_counts"].setdefault(
        article.hub,
        {"key": article.hub, "label": article.hub_label, "count": 0},
    )
    hub_entry["label"] = article.hub_label
    hub_entry["count"] += 1

    section_entry = lifetime["section_counts"].setdefault(
        article.category,
        {
            "key": article.category,
            "label": article.section_label,
            "hub": article.hub,
            "hub_label": article.hub_label,
            "count": 0,
        },
    )
    section_entry["label"] = article.section_label
    section_entry["hub"] = article.hub
    section_entry["hub_label"] = article.hub_label
    section_entry["count"] += 1

    language_key = article.language or "unknown"
    lifetime["language_counts"][language_key] = (
        int(lifetime["language_counts"].get(language_key) or 0) + 1
    )

    for keyword in dict.fromkeys(article.keywords):
        lifetime["keyword_counts"][keyword] = (
            int(lifetime["keyword_counts"].get(keyword) or 0) + 1
        )

    if article.published_at is None:
        lifetime["unknown_time_count"] += 1
    else:
        day_key = article.published_at.astimezone(timezone.utc).date().isoformat()
        lifetime["daily_counts"][day_key] = int(lifetime["daily_counts"].get(day_key) or 0) + 1

    title_group = lifetime["title_groups"].setdefault(
        article.title_hash,
        {
            "title_hash": article.title_hash,
            "title": article.title,
            "article_count": 0,
            "source_keys": [],
            "source_names": [],
            "latest_published_at": None,
            "canonical_url": article.canonical_url,
        },
    )
    title_group["article_count"] += 1
    title_group["source_keys"] = sorted(
        set(title_group.get("source_keys", [])) | {article.source_key}
    )
    title_group["source_names"] = sorted(
        set(title_group.get("source_names", [])) | {article.source_name}
    )
    current_latest = _parse_optional_datetime(title_group.get("latest_published_at"))
    if (
        not title_group.get("title")
        or current_latest is None
        or (
            article.published_at is not None
            and article.published_at >= current_latest
        )
    ):
        title_group["title"] = article.title
        title_group["canonical_url"] = article.canonical_url
    if article.published_at is not None and (
        current_latest is None or article.published_at >= current_latest
    ):
        title_group["latest_published_at"] = article.published_at.isoformat()


def _merge_analysis_state(
    existing_state: dict[str, Any] | None,
    current_articles: list[AnalysisArticle],
    *,
    generated_at: str,
) -> dict[str, Any]:
    timestamp = _parse_optional_datetime(generated_at) or datetime.now(tz=timezone.utc)
    cutoff = timestamp - timedelta(days=ANALYSIS_RETENTION_DAYS)
    seen_keys = {
        str(value).strip()
        for value in (existing_state or {}).get("seen_keys", [])
        if str(value).strip()
    }
    lifetime = _normalize_analysis_lifetime((existing_state or {}).get("lifetime"))

    recent_articles_by_key: dict[str, AnalysisArticle] = {}
    for article in _load_recent_analysis_articles(existing_state or {}):
        if article.published_at is None or article.published_at < cutoff:
            continue
        recent_articles_by_key[article.stable_key] = article

    for article in current_articles:
        if article.stable_key in seen_keys:
            if article.published_at is not None and article.published_at >= cutoff:
                recent_articles_by_key.setdefault(article.stable_key, article)
            continue
        seen_keys.add(article.stable_key)
        _apply_analysis_article_to_lifetime(lifetime, article)
        if article.published_at is not None and article.published_at >= cutoff:
            recent_articles_by_key[article.stable_key] = article

    recent_articles = sorted(
        recent_articles_by_key.values(),
        key=_analysis_article_sort_key,
        reverse=True,
    )
    lifetime["daily_counts"] = dict(sorted(lifetime["daily_counts"].items()))
    lifetime["source_counts"] = dict(sorted(lifetime["source_counts"].items()))
    lifetime["hub_counts"] = dict(sorted(lifetime["hub_counts"].items()))
    lifetime["section_counts"] = dict(sorted(lifetime["section_counts"].items()))
    lifetime["language_counts"] = dict(sorted(lifetime["language_counts"].items()))
    lifetime["keyword_counts"] = dict(sorted(lifetime["keyword_counts"].items()))
    lifetime["title_groups"] = dict(sorted(lifetime["title_groups"].items()))
    return {
        "version": 1,
        "generated_at": generated_at,
        "retention_days": ANALYSIS_RETENTION_DAYS,
        "seen_keys": sorted(seen_keys),
        "recent_articles": [article.to_public_dict() for article in recent_articles],
        "lifetime": lifetime,
    }


def _rank_keyword_counts(keyword_counts: dict[str, int], *, limit: int = ANALYSIS_TOP_ITEM_LIMIT) -> list[dict[str, Any]]:
    items = [
        {"keyword": keyword, "count": int(count)}
        for keyword, count in keyword_counts.items()
        if int(count) > 0
    ]
    items.sort(key=lambda item: (-item["count"], item["keyword"]))
    return items[:limit]


def _rank_named_counts(
    entries: dict[str, dict[str, Any]],
    *,
    key_field: str,
    label_field: str,
    limit: int = ANALYSIS_TOP_ITEM_LIMIT,
) -> list[dict[str, Any]]:
    items = [
        {
            key_field: key,
            label_field: str(entry.get(label_field) or key),
            "count": int(entry.get("count") or 0),
        }
        for key, entry in entries.items()
        if int(entry.get("count") or 0) > 0
    ]
    items.sort(key=lambda item: (-item["count"], item[label_field]))
    return items[:limit]


def _rank_section_counts(
    entries: dict[str, dict[str, Any]],
    *,
    limit: int = ANALYSIS_TOP_ITEM_LIMIT,
) -> list[dict[str, Any]]:
    items = [
        {
            "key": key,
            "label": str(entry.get("label") or key),
            "hub": str(entry.get("hub") or _infer_hub_key(key)),
            "hub_label": str(entry.get("hub_label") or _default_hub_definition(_infer_hub_key(key))["label"]),
            "count": int(entry.get("count") or 0),
        }
        for key, entry in entries.items()
        if int(entry.get("count") or 0) > 0
    ]
    items.sort(key=lambda item: (-item["count"], item["label"]))
    return items[:limit]


def _build_timeline_from_daily_counts(daily_counts: dict[str, int]) -> list[dict[str, Any]]:
    return [
        {"date": day_key, "count": int(count)}
        for day_key, count in sorted(daily_counts.items())
        if int(count) > 0
    ]


def _build_title_groups_from_articles(articles: list[AnalysisArticle]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for article in articles:
        group = groups.setdefault(
            article.title_hash,
            {
                "title_hash": article.title_hash,
                "title": article.title,
                "article_count": 0,
                "source_keys": set(),
                "source_names": set(),
                "latest_published_at": None,
                "canonical_url": article.canonical_url,
                "sort_timestamp": 0,
            },
        )
        group["article_count"] += 1
        group["source_keys"].add(article.source_key)
        group["source_names"].add(article.source_name)
        if article.sort_timestamp >= int(group["sort_timestamp"] or 0):
            group["title"] = article.title
            group["canonical_url"] = article.canonical_url
            group["latest_published_at"] = (
                article.published_at.isoformat() if article.published_at else None
            )
            group["sort_timestamp"] = article.sort_timestamp

    items = [
        {
            "title_hash": group["title_hash"],
            "title": group["title"],
            "article_count": group["article_count"],
            "source_count": len(group["source_keys"]),
            "latest_published_at": group["latest_published_at"],
            "canonical_url": group["canonical_url"],
            "sort_timestamp": int(group["sort_timestamp"] or 0),
        }
        for group in groups.values()
        if int(group["article_count"]) > 1
    ]
    items.sort(
        key=lambda item: (
            -item["article_count"],
            -item["source_count"],
            -item["sort_timestamp"],
            item["title"].lower(),
        )
    )
    return items


def _rank_title_groups(
    title_groups: dict[str, dict[str, Any]],
    *,
    limit: int = ANALYSIS_REPEAT_LIMIT,
) -> list[dict[str, Any]]:
    items = []
    for title_hash, entry in title_groups.items():
        article_count = int(entry.get("article_count") or 0)
        if article_count <= 1:
            continue
        latest_published_at = str(entry.get("latest_published_at") or "").strip() or None
        latest_timestamp = (
            int((_parse_optional_datetime(latest_published_at) or datetime.fromtimestamp(0, tz=timezone.utc)).timestamp())
            if latest_published_at
            else 0
        )
        items.append(
            {
                "title_hash": title_hash,
                "title": str(entry.get("title") or ""),
                "article_count": article_count,
                "source_count": len(entry.get("source_keys", [])),
                "latest_published_at": latest_published_at,
                "canonical_url": str(entry.get("canonical_url") or ""),
                "sort_timestamp": latest_timestamp,
            }
        )
    items.sort(
        key=lambda item: (
            -item["article_count"],
            -item["source_count"],
            -item["sort_timestamp"],
            item["title"].lower(),
        )
    )
    return items[:limit]


def _build_window_payload_from_articles(
    *,
    label: str,
    articles: list[AnalysisArticle],
) -> dict[str, Any]:
    keyword_counts: Counter[str] = Counter()
    source_counts: dict[str, dict[str, Any]] = {}
    hub_counts: dict[str, dict[str, Any]] = {}
    section_counts: dict[str, dict[str, Any]] = {}
    language_counts: Counter[str] = Counter()
    daily_counts: Counter[str] = Counter()

    for article in articles:
        for keyword in dict.fromkeys(article.keywords):
            keyword_counts[keyword] += 1
        source_entry = source_counts.setdefault(
            article.source_key,
            {"source_key": article.source_key, "name": article.source_name, "count": 0},
        )
        source_entry["count"] += 1
        hub_entry = hub_counts.setdefault(
            article.hub,
            {"key": article.hub, "label": article.hub_label, "count": 0},
        )
        hub_entry["count"] += 1
        section_entry = section_counts.setdefault(
            article.category,
            {
                "key": article.category,
                "label": article.section_label,
                "hub": article.hub,
                "hub_label": article.hub_label,
                "count": 0,
            },
        )
        section_entry["count"] += 1
        language_counts[article.language or "unknown"] += 1
        if article.published_at is not None:
            day_key = article.published_at.astimezone(timezone.utc).date().isoformat()
            daily_counts[day_key] += 1

    repeated_titles = _build_title_groups_from_articles(articles)
    return {
        "label": label,
        "article_count": len(articles),
        "unknown_time_count": 0,
        "active_source_count": len(source_counts),
        "repeated_title_count": len(repeated_titles),
        "timeline": _build_timeline_from_daily_counts(dict(daily_counts)),
        "top_keywords": _rank_keyword_counts(dict(keyword_counts)),
        "top_sources": _rank_named_counts(
            source_counts,
            key_field="source_key",
            label_field="name",
        ),
        "top_hubs": _rank_named_counts(hub_counts, key_field="key", label_field="label"),
        "top_sections": _rank_section_counts(section_counts),
        "language_counts": [
            {"language": language, "count": count}
            for language, count in sorted(
                language_counts.items(),
                key=lambda item: (-item[1], item[0]),
            )
        ],
        "repeated_titles": repeated_titles[:ANALYSIS_REPEAT_LIMIT],
        "recent_samples": [
            article.to_public_dict()
            for article in sorted(articles, key=_analysis_article_sort_key, reverse=True)[:ANALYSIS_SAMPLE_LIMIT]
        ],
    }


def _augment_analysis_window_payload(
    payload: dict[str, Any],
    *,
    articles: list[AnalysisArticle],
) -> dict[str, Any]:
    timeline = list(payload.get("timeline") or [])
    sparkline = [int(item.get("count") or 0) for item in timeline[-14:]]
    sparkline = sparkline or [int(payload.get("article_count") or 0)]

    daily_hub_counts: dict[str, Counter[str]] = {}
    daily_section_counts: dict[str, Counter[str]] = {}
    for article in articles:
        if article.published_at is None:
            continue
        day_key = article.published_at.astimezone(timezone.utc).date().isoformat()
        daily_hub_counts.setdefault(day_key, Counter())[article.hub] += 1
        daily_section_counts.setdefault(day_key, Counter())[article.category] += 1

    top_hubs = list(payload.get("top_hubs") or [])[:2]
    timeline_by_key = {str(item.get("date")): item for item in timeline}
    hub_series: list[dict[str, Any]] = []
    for hub in top_hubs:
        hub_key = str(hub.get("key") or "")
        if not hub_key:
            continue
        series = []
        for day_key in timeline_by_key:
            series.append(
                {
                    "date": day_key,
                    "count": int(daily_hub_counts.get(day_key, Counter()).get(hub_key, 0)),
                }
            )
        hub_series.append(
            {
                "key": hub_key,
                "label": str(hub.get("label") or hub_key),
                "count": int(hub.get("count") or 0),
                "series": series,
            }
        )

    top_sections = list(payload.get("top_sections") or [])[:3]
    section_series: list[dict[str, Any]] = []
    for section in top_sections:
        section_key = str(section.get("key") or "")
        if not section_key:
            continue
        series = []
        for day_key in timeline_by_key:
            series.append(
                {
                    "date": day_key,
                    "count": int(daily_section_counts.get(day_key, Counter()).get(section_key, 0)),
                }
            )
        section_series.append(
            {
                "key": section_key,
                "label": str(section.get("label") or section_key),
                "count": int(section.get("count") or 0),
                "series": series,
            }
        )

    timeline_counts = [int(item.get("count") or 0) for item in timeline]
    average_count = round(sum(timeline_counts) / len(timeline_counts), 1) if timeline_counts else 0
    peak_point = max(
        timeline,
        key=lambda item: int(item.get("count") or 0),
        default={"date": "-", "count": 0},
    )
    latest_point = timeline[-1] if timeline else {"date": "-", "count": 0}

    payload["kpi_series"] = [
        {
            "key": "articles",
            "label": "기사 수",
            "value": int(payload.get("article_count") or 0),
            "series": sparkline,
        },
        {
            "key": "sources",
            "label": "활성 소스",
            "value": int(payload.get("active_source_count") or 0),
            "series": sparkline,
        },
        {
            "key": "repeats",
            "label": "반복 기사",
            "value": int(payload.get("repeated_title_count") or 0),
            "series": sparkline,
        },
        {
            "key": "unknown",
            "label": "시간 미상",
            "value": int(payload.get("unknown_time_count") or 0),
            "series": sparkline,
        },
    ]
    payload["distribution_panels"] = [
        {
            "key": "sources",
            "label": "소스 분포",
            "items": list(payload.get("top_sources") or [])[:8],
        },
        {
            "key": "sections",
            "label": "섹션 비중",
            "items": list(payload.get("top_sections") or [])[:8],
            "chart": "donut",
        },
        {
            "key": "keywords",
            "label": "반복 키워드",
            "items": [
                {
                    "key": item.get("keyword"),
                    "label": item.get("keyword"),
                    "count": int(item.get("count") or 0),
                }
                for item in list(payload.get("top_keywords") or [])[:8]
            ],
        },
    ]
    payload["trend_panels"] = [
        {
            "key": "volume",
            "label": "일자별 기사량 추이",
            "series": timeline,
            "summary_items": [
                {"label": "최근 집계", "value": int(latest_point.get("count") or 0)},
                {"label": "일 평균", "value": average_count},
                {
                    "label": "최대 일자",
                    "value": f"{peak_point.get('date')} / {int(peak_point.get('count') or 0)}",
                },
            ],
        },
        {
            "key": "hubs",
            "label": "허브 비중 추이",
            "series_groups": hub_series,
            "summary_items": [
                {
                    "label": str(group.get("label") or group.get("key") or ""),
                    "value": int(group.get("count") or 0),
                }
                for group in hub_series
            ],
        },
        {
            "key": "sections",
            "label": "주요 섹션 추이",
            "series_groups": section_series,
            "summary_items": [
                {
                    "label": str(group.get("label") or group.get("key") or ""),
                    "value": int(group.get("count") or 0),
                }
                for group in section_series
            ],
        },
    ]
    return payload


def _build_analysis_dashboard_payload(
    state: dict[str, Any],
    *,
    generated_at: str,
) -> dict[str, Any]:
    timestamp = _parse_optional_datetime(generated_at) or datetime.now(tz=timezone.utc)
    lifetime = _normalize_analysis_lifetime(state.get("lifetime"))
    recent_articles = sorted(
        _load_recent_analysis_articles(state),
        key=_analysis_article_sort_key,
        reverse=True,
    )

    windows: dict[str, Any] = {}
    for key, label, duration in ANALYSIS_WINDOW_DEFINITIONS:
        if duration is None:
            repeated_titles = _rank_title_groups(lifetime["title_groups"])
            windows[key] = _augment_analysis_window_payload({
                "label": label,
                "article_count": lifetime["total_articles"],
                "unknown_time_count": lifetime["unknown_time_count"],
                "active_source_count": len(lifetime["source_counts"]),
                "repeated_title_count": len(
                    [
                        entry
                        for entry in lifetime["title_groups"].values()
                        if int(entry.get("article_count") or 0) > 1
                    ]
                ),
                "timeline": _build_timeline_from_daily_counts(lifetime["daily_counts"]),
                "top_keywords": _rank_keyword_counts(lifetime["keyword_counts"]),
                "top_sources": _rank_named_counts(
                    lifetime["source_counts"],
                    key_field="source_key",
                    label_field="name",
                ),
                "top_hubs": _rank_named_counts(
                    lifetime["hub_counts"],
                    key_field="key",
                    label_field="label",
                ),
                "top_sections": _rank_section_counts(lifetime["section_counts"]),
                "language_counts": [
                    {"language": language, "count": int(count)}
                    for language, count in sorted(
                        lifetime["language_counts"].items(),
                        key=lambda item: (-int(item[1]), item[0]),
                    )
                    if int(count) > 0
                ],
                "repeated_titles": repeated_titles,
                "recent_samples": [
                    article.to_public_dict()
                    for article in recent_articles[:ANALYSIS_SAMPLE_LIMIT]
                ],
            }, articles=recent_articles)
            continue

        cutoff = timestamp - duration
        window_articles = [
            article
            for article in recent_articles
            if article.published_at is not None and article.published_at >= cutoff
        ]
        windows[key] = _augment_analysis_window_payload(
            _build_window_payload_from_articles(label=label, articles=window_articles),
            articles=window_articles,
        )

    return {
        "generated_at": generated_at,
        "retention_days": int(state.get("retention_days") or ANALYSIS_RETENTION_DAYS),
        "default_window": "7d",
        "lifetime_total_articles": lifetime["total_articles"],
        "lifetime_unknown_time_count": lifetime["unknown_time_count"],
        "available_windows": [
            {"key": key, "label": label}
            for key, label, _duration in ANALYSIS_WINDOW_DEFINITIONS
        ],
        "windows": windows,
    }


def _coerce_metadata_entry(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    data: dict[str, Any] = {}
    for key in (
        "key",
        "label",
        "headline",
        "hub",
        "hub_key",
        "hub_label",
        "section_label",
        "description",
        "order",
        "sort_order",
    ):
        if hasattr(raw, key):
            data[key] = getattr(raw, key)
    return data


def _infer_hub_key(category_key: str) -> str:
    if category_key.startswith("kr-"):
        return "kr"
    if category_key.startswith("us-"):
        return "us"
    return "global"


def _default_hub_definition(hub_key: str) -> dict[str, Any]:
    defaults = {
        "kr": {
            "key": "kr",
            "label": "대한민국",
            "description": "국내 언론과 방송 보도를 분야별로 묶어 빠르게 훑는 허브입니다.",
            "order": 10,
        },
        "us": {
            "key": "us",
            "label": "미국",
            "description": "미국 주요 신문과 방송 네트워크 기사를 분야별로 정리한 허브입니다.",
            "order": 20,
        },
        "global": {
            "key": "global",
            "label": "글로벌 전문",
            "description": "코인, 기술, 군사처럼 주제 중심 전문 소스를 모아 둔 허브입니다.",
            "order": 30,
        },
    }
    return dict(defaults.get(hub_key, {"key": hub_key, "label": hub_key.upper(), "description": "", "order": 99}))


@lru_cache(maxsize=1)
def _get_hub_definitions() -> list[dict[str, Any]]:
    from newsbot import categories as category_module

    raw_entries = getattr(category_module, "HUB_DEFINITIONS", None)
    entries: list[dict[str, Any]] = []
    if raw_entries:
        iterable = raw_entries.values() if isinstance(raw_entries, dict) else raw_entries
        for raw in iterable:
            entry = _coerce_metadata_entry(raw)
            hub_key = str(entry.get("key") or "").strip()
            if not hub_key:
                continue
            default = _default_hub_definition(hub_key)
            default.update(
                {
                    "label": str(entry.get("label") or default["label"]),
                    "description": str(entry.get("description") or default["description"]),
                    "order": int(entry.get("order", entry.get("sort_order", default["order"]))),
                }
            )
            entries.append(default)
    if not entries:
        entries = [
            _default_hub_definition("kr"),
            _default_hub_definition("us"),
            _default_hub_definition("global"),
        ]
    entries.sort(key=lambda item: (item["order"], item["label"]))
    return entries


@lru_cache(maxsize=1)
def _get_category_payload_entries() -> list[dict[str, Any]]:
    from newsbot import categories as category_module

    raw_entries = getattr(category_module, "CATEGORY_DEFINITIONS", None)
    category_labels = getattr(category_module, "CATEGORY_LABELS", {})
    all_categories = getattr(category_module, "ALL_CATEGORIES", tuple(category_labels))
    entries: list[dict[str, Any]] = []

    if raw_entries:
        iterable = raw_entries.values() if isinstance(raw_entries, dict) else raw_entries
        for raw in iterable:
            entry = _coerce_metadata_entry(raw)
            key = str(entry.get("key") or "").strip()
            if not key:
                continue
            hub_key = str(entry.get("hub") or entry.get("hub_key") or _infer_hub_key(key))
            hub_definition = _default_hub_definition(hub_key)
            entries.append(
                {
                    "key": key,
                    "label": str(
                        entry.get("section_label")
                        or entry.get("label")
                        or category_labels.get(key)
                        or key
                    ),
                    "hub": hub_key,
                    "hub_label": str(entry.get("hub_label") or hub_definition["label"]),
                    "description": str(entry.get("description") or ""),
                    "order": int(entry.get("order", entry.get("sort_order", len(entries) + 1))),
                }
            )

    if not entries:
        for index, category_key in enumerate(all_categories):
            hub_key = _infer_hub_key(category_key)
            hub_definition = _default_hub_definition(hub_key)
            entries.append(
                {
                    "key": category_key,
                    "label": str(category_labels.get(category_key, category_key)),
                    "hub": hub_key,
                    "hub_label": hub_definition["label"],
                    "description": "",
                    "order": index,
                }
            )

    entries.sort(key=lambda item: (item["hub"], item["order"], item["label"]))
    return entries


def _get_category_payload_entry(category_key: str) -> dict[str, Any]:
    for entry in _get_category_payload_entries():
        if entry["key"] == category_key:
            return entry
    hub_key = _infer_hub_key(category_key)
    hub_definition = _default_hub_definition(hub_key)
    return {
        "key": category_key,
        "label": category_key,
        "hub": hub_key,
        "hub_label": hub_definition["label"],
        "description": "",
        "order": 999,
    }


def _build_category_payload(category_counts: Counter[str]) -> list[dict[str, Any]]:
    return [
        {
            **entry,
            "count": category_counts.get(entry["key"], 0),
        }
        for entry in _get_category_payload_entries()
    ]


def _build_hub_payload(
    categories: list[dict[str, Any]],
    articles: list[StaticArticle],
) -> list[dict[str, Any]]:
    hub_counts = Counter(_get_category_payload_entry(article.primary_category)["hub"] for article in articles)
    categories_by_hub: dict[str, list[dict[str, Any]]] = {}
    for category in categories:
        categories_by_hub.setdefault(category["hub"], []).append(category)

    hubs: list[dict[str, Any]] = []
    for hub_definition in _get_hub_definitions():
        hub_key = hub_definition["key"]
        categories_for_hub = categories_by_hub.get(hub_key, [])
        if not categories_for_hub and hub_counts.get(hub_key, 0) == 0:
            continue
        hubs.append(
            {
                **hub_definition,
                "count": hub_counts.get(hub_key, 0),
                "categories": categories_for_hub,
            }
        )
    return hubs


def _find_source_definition(
    source_key: str,
    source_definitions: list[SourceDefinition] | None,
) -> SourceDefinition | None:
    if source_definitions:
        for definition in source_definitions:
            if definition.source_key == source_key:
                return definition
    try:
        from newsbot.source_registry import get_source_definition

        return get_source_definition(source_key)
    except Exception:
        return None


def _resolve_source_hub(status: SourceBuildStatus) -> str:
    if status.category:
        return _get_category_payload_entry(status.category)["hub"]
    return "global"


def _resolve_publisher_group(
    source_key: str,
    source_definitions: list[SourceDefinition] | None,
) -> str:
    definition = _find_source_definition(source_key, source_definitions)
    if definition is None:
        return "unknown"
    raw_group = definition.config.get("publisher_group")
    if raw_group:
        return str(raw_group)
    domain = urlsplit(definition.base_url).netloc.lower()
    if any(marker in definition.name.lower() for marker in ("news", "press", "times", "journal")):
        return "newspaper"
    if any(domain.endswith(suffix) for suffix in ("sbs.co.kr", "kbs.co.kr", "imbc.com", "ytn.co.kr", "cnn.com", "foxnews.com", "abcnews.com", "nbcnews.com", "cbsnews.com")):
        return "broadcast"
    return "publisher"


def _paginate_articles(
    articles: list[dict[str, Any]],
    *,
    page: int,
    page_size: int,
) -> list[dict[str, Any]]:
    if page_size <= 0:
        return articles
    start = max(page - 1, 0) * page_size
    return articles[start : start + page_size]


def _build_page_tokens(total_pages: int, current_page: int) -> list[int | None]:
    if total_pages <= 7:
        return list(range(1, total_pages + 1))

    pages = {1, total_pages, current_page - 1, current_page, current_page + 1}
    if current_page <= 3:
        pages.update({2, 3, 4})
    if current_page >= total_pages - 2:
        pages.update({total_pages - 3, total_pages - 2, total_pages - 1})

    tokens: list[int | None] = []
    previous_page: int | None = None
    for page in sorted(candidate for candidate in pages if 1 <= candidate <= total_pages):
        if previous_page is not None and page - previous_page > 1:
            tokens.append(None)
        tokens.append(page)
        previous_page = page
    return tokens


def _build_initial_feed(payload: dict[str, Any]) -> dict[str, Any]:
    page_articles = _paginate_articles(
        _prioritize_feed_articles(payload["articles"], scope="all", section="all"),
        page=1,
        page_size=int(payload.get("feed_page_size") or payload.get("page_size") or 25),
    )
    featured = page_articles[0] if page_articles else None
    return {
        "featured": featured,
        "items": page_articles[1:] if len(page_articles) > 1 else [],
    }


def build_static_site(
    settings: Settings | None = None,
    *,
    output_dir: str | Path | None = None,
    source_definitions: list[SourceDefinition] | None = None,
    adapters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    active_settings = settings or get_settings()
    destination = Path(output_dir or active_settings.static_output_dir)
    archive_articles = _load_archive_articles(active_settings, destination)
    analysis_state = _load_analysis_state(active_settings, destination)
    market_archives = _load_markets_archives(active_settings, destination)
    existing_removed_log = _load_removed_article_log(active_settings, destination)
    payload, evicted_articles, analysis_articles = asyncio.run(
        collect_site_payload(
            active_settings,
            archive_articles=archive_articles,
            source_definitions=source_definitions,
            adapters=adapters,
        )
    )
    merged_analysis_state = _merge_analysis_state(
        analysis_state,
        analysis_articles,
        generated_at=payload["generated_at"],
    )
    analysis_dashboard = _build_analysis_dashboard_payload(
        merged_analysis_state,
        generated_at=payload["generated_at"],
    )
    markets_bundle = build_markets_bundle(
        active_settings,
        payload,
        archive_bundle=market_archives,
    )
    removed_log = _build_removed_article_log(
        existing_removed_log,
        evicted_articles,
        generated_at=payload["generated_at"],
    )
    _write_static_site(
        destination,
        payload,
        removed_log=removed_log,
        analysis_state=merged_analysis_state,
        analysis_dashboard=analysis_dashboard,
        markets_bundle=markets_bundle,
    )
    return payload


def _write_static_site(
    output_dir: Path,
    payload: dict[str, Any],
    *,
    removed_log: str,
    analysis_state: dict[str, Any],
    analysis_dashboard: dict[str, Any],
    markets_bundle: dict[str, dict[str, Any]],
) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "assets").mkdir(parents=True, exist_ok=True)
    (output_dir / "data").mkdir(parents=True, exist_ok=True)
    (output_dir / ANALYSIS_DIRECTORY_NAME).mkdir(parents=True, exist_ok=True)
    (output_dir / MARKETS_DIRECTORY_NAME).mkdir(parents=True, exist_ok=True)

    shutil.copy2(SITE_ASSET_DIR / "style.css", output_dir / "assets" / "style.css")
    shutil.copy2(SITE_ASSET_DIR / "app.js", output_dir / "assets" / "app.js")
    shutil.copy2(SITE_ASSET_DIR / "analysis.js", output_dir / "assets" / "analysis.js")
    shutil.copy2(SITE_ASSET_DIR / "markets.js", output_dir / "assets" / "markets.js")

    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace(
        "</", "<\\/"
    )
    environment = Environment(
        loader=FileSystemLoader(str(SITE_TEMPLATE_DIR)),
        autoescape=select_autoescape(("html",)),
    )
    template = environment.get_template("index.html")
    html = template.render(
        article_count=payload["article_count"],
        generated_at=payload["generated_at"],
        hubs=payload["hubs"],
        categories=payload["categories"],
        initial_feed=_build_initial_feed(payload),
        initial_total_pages=max(1, ceil(payload["article_count"] / max(payload["feed_page_size"], 1))),
        initial_pagination_tokens=_build_page_tokens(
            max(1, ceil(payload["article_count"] / max(payload["feed_page_size"], 1))),
            1,
        ),
        source_statuses=payload["source_statuses"],
        payload_json=payload_json,
    )
    analysis_template = environment.get_template("analysis.html")
    analysis_bootstrap_json = json.dumps(
        {
            "data_url": "../data/" + ANALYSIS_DASHBOARD_FILENAME,
            "default_window": analysis_dashboard["default_window"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    analysis_html = analysis_template.render(
        generated_at=payload["generated_at"],
        retention_days=analysis_dashboard["retention_days"],
        bootstrap_json=analysis_bootstrap_json,
    )
    markets_template = environment.get_template("markets.html")
    markets_bootstrap_json = json.dumps(
        {
            "overview_url": "../data/" + MARKETS_OVERVIEW_FILENAME,
            "stocks_url": "../data/" + MARKETS_STOCKS_FILENAME,
            "korea_url": "../data/" + MARKETS_KOREA_FILENAME,
            "crypto_url": "../data/" + MARKETS_CRYPTO_FILENAME,
            "status_url": "../data/" + MARKETS_STATUS_FILENAME,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ).replace("</", "<\\/")
    markets_html = markets_template.render(
        generated_at=payload["generated_at"],
        bootstrap_json=markets_bootstrap_json,
    )

    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / "404.html").write_text(html, encoding="utf-8")
    (output_dir / ANALYSIS_DIRECTORY_NAME / "index.html").write_text(
        analysis_html,
        encoding="utf-8",
    )
    (output_dir / MARKETS_DIRECTORY_NAME / "index.html").write_text(
        markets_html,
        encoding="utf-8",
    )
    (output_dir / "data" / "site-data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / ANALYSIS_STATE_FILENAME).write_text(
        json.dumps(analysis_state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / ANALYSIS_DASHBOARD_FILENAME).write_text(
        json.dumps(analysis_dashboard, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / MARKETS_OVERVIEW_FILENAME).write_text(
        json.dumps(markets_bundle["overview"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / MARKETS_STOCKS_FILENAME).write_text(
        json.dumps(markets_bundle["stocks"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / MARKETS_KOREA_FILENAME).write_text(
        json.dumps(markets_bundle["korea"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / MARKETS_CRYPTO_FILENAME).write_text(
        json.dumps(markets_bundle["crypto"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / MARKETS_STATUS_FILENAME).write_text(
        json.dumps(markets_bundle["status"], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (output_dir / "data" / REMOVED_ARTICLES_LOG_FILENAME).write_text(
        removed_log,
        encoding="utf-8",
    )
    (output_dir / ".nojekyll").write_text("", encoding="utf-8")


def _load_archive_articles(settings: Settings, output_dir: Path) -> list[StaticArticle]:
    payload = _load_archive_payload_from_path(output_dir / "data" / "site-data.json")
    if payload is None and settings.static_archive_url:
        payload = _load_archive_payload_from_url(
            settings.static_archive_url,
            timeout_seconds=settings.request_timeout_sec,
        )
    if not payload:
        return []
    raw_articles = payload.get("articles")
    if not isinstance(raw_articles, list):
        return []

    archive_articles: list[StaticArticle] = []
    for raw_article in raw_articles:
        if not isinstance(raw_article, dict):
            continue
        try:
            article = StaticArticle.from_public_dict(raw_article)
        except Exception:
            continue
        if is_blocked_candidate_url(article.canonical_url):
            continue
        if article.source_key in BLOCKED_SOURCE_KEYS:
            continue
        if article.title and article.canonical_url and article.primary_category:
            archive_articles.append(article)
    return archive_articles


def _load_removed_article_log(settings: Settings, output_dir: Path) -> str:
    text = _load_text_from_path(output_dir / "data" / REMOVED_ARTICLES_LOG_FILENAME)
    if text is None and settings.static_archive_url:
        log_url = _derive_related_data_url(
            settings.static_archive_url,
            REMOVED_ARTICLES_LOG_FILENAME,
        )
        if log_url:
            text = _load_text_from_url(
                log_url,
                timeout_seconds=settings.request_timeout_sec,
            )
    return text or ""


def _load_analysis_state(settings: Settings, output_dir: Path) -> dict[str, Any] | None:
    payload = _load_archive_payload_from_path(output_dir / "data" / ANALYSIS_STATE_FILENAME)
    analysis_archive_url = settings.static_analysis_archive_url
    if analysis_archive_url is None and settings.static_archive_url:
        analysis_archive_url = _derive_related_data_url(
            settings.static_archive_url,
            ANALYSIS_STATE_FILENAME,
        )
    if payload is None and analysis_archive_url:
        payload = _load_archive_payload_from_url(
            analysis_archive_url,
            timeout_seconds=settings.request_timeout_sec,
        )
    return payload if isinstance(payload, dict) else None


def _load_markets_archives(
    settings: Settings,
    output_dir: Path,
) -> dict[str, dict[str, Any] | None]:
    filenames = {
        "overview": MARKETS_OVERVIEW_FILENAME,
        "stocks": MARKETS_STOCKS_FILENAME,
        "korea": MARKETS_KOREA_FILENAME,
        "crypto": MARKETS_CRYPTO_FILENAME,
        "status": MARKETS_STATUS_FILENAME,
    }
    archives: dict[str, dict[str, Any] | None] = {}
    for key, filename in filenames.items():
        payload = _load_archive_payload_from_path(output_dir / "data" / filename)
        if payload is None and settings.static_archive_url:
            related_url = _derive_related_data_url(settings.static_archive_url, filename)
            if related_url:
                payload = _load_archive_payload_from_url(
                    related_url,
                    timeout_seconds=settings.request_timeout_sec,
                )
        archives[key] = payload if isinstance(payload, dict) else None
    return archives


def _load_archive_payload_from_path(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _load_text_from_path(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _load_archive_payload_from_url(
    url: str,
    *,
    timeout_seconds: int,
) -> dict[str, Any] | None:
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=timeout_seconds,
            headers={"User-Agent": "newsbot-static/0.1"},
        )
        response.raise_for_status()
        return response.json()
    except (httpx.HTTPError, json.JSONDecodeError):
        return None


def _load_text_from_url(
    url: str,
    *,
    timeout_seconds: int,
) -> str | None:
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=timeout_seconds,
            headers={"User-Agent": "newsbot-static/0.1"},
        )
        response.raise_for_status()
        return response.text
    except httpx.HTTPError:
        return None


def _derive_related_data_url(source_url: str, filename: str) -> str | None:
    parsed = urlsplit(source_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        return None
    parts[-1] = filename
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            "/" + "/".join(parts),
            "",
            "",
        )
    )


def _build_removed_article_log(
    existing_log: str,
    removed_articles: list[StaticArticle],
    *,
    generated_at: str,
) -> str:
    normalized_existing = existing_log.rstrip()
    if not removed_articles:
        return f"{normalized_existing}\n" if normalized_existing else ""

    seen_urls = {
        line.strip()
        for line in existing_log.splitlines()
        if line.strip().startswith(("http://", "https://"))
    }
    fresh_articles = [
        article for article in removed_articles if article.canonical_url not in seen_urls
    ]
    if not fresh_articles:
        return f"{normalized_existing}\n" if normalized_existing else ""

    timestamp = _parse_optional_datetime(generated_at) or datetime.now(tz=timezone.utc)
    month_key = timestamp.astimezone(timezone.utc).strftime("%Y-%m")

    lines: list[str] = []
    if normalized_existing:
        lines.append(normalized_existing)

    if f"[{month_key}]" not in existing_log:
        if lines:
            lines.append("")
        lines.append(f"[{month_key}]")

    for article in fresh_articles:
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(f"- {article.title}")
        lines.append(article.canonical_url)

    return "\n".join(lines).strip() + "\n"


def main() -> None:
    payload = build_static_site()
    print(
        f"Built static site with {payload['article_count']} articles and "
        f"{payload['failed_source_count']} source failures, "
        f"{payload['warning_source_count']} warnings."
    )


if __name__ == "__main__":
    main()
