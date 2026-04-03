"""Build a static GitHub Pages site from curated news sources."""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import replace
from datetime import datetime
from datetime import timezone
from functools import lru_cache
import json
from math import ceil
from pathlib import Path
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
from newsbot.services.classifier import classify_candidate
from newsbot.services.dedupe import canonicalize_candidate
from newsbot.services.ingest import ADAPTERS
from newsbot.services.ingest import _fetch_with_retries
from newsbot.source_registry import SourceDefinition
from newsbot.source_registry import get_source_definitions
from newsbot.text_tools import build_title_hash
from newsbot.text_tools import similar_titles


PACKAGE_DIR = Path(__file__).resolve().parent
SITE_TEMPLATE_DIR = PACKAGE_DIR / "site_templates"
SITE_ASSET_DIR = PACKAGE_DIR / "site_assets"
REMOVED_ARTICLES_LOG_FILENAME = "removed-articles.txt"


@dataclass(frozen=True, slots=True)
class StaticArticle:
    title: str
    canonical_url: str
    source_key: str
    source_name: str
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
        title = str(raw.get("title") or "").strip()
        source_name = str(raw.get("source_name") or "").strip() or "Unknown"
        source_names = tuple(
            str(name).strip()
            for name in raw.get("source_names", [])
            if str(name).strip()
        ) or (source_name,)
        normalized_title = " ".join(title.split()).lower()
        return cls(
            title=title,
            canonical_url=str(raw.get("canonical_url") or "").strip(),
            source_key=str(raw.get("source_key") or "").strip(),
            source_name=source_name,
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


def list_static_sources(
    source_definitions: list[SourceDefinition] | None = None,
) -> list[SourceDefinition]:
    definitions = source_definitions or get_source_definitions()
    return [definition for definition in definitions if definition.static_enabled]


async def collect_site_payload(
    settings: Settings,
    *,
    archive_articles: list[StaticArticle] | None = None,
    source_definitions: list[SourceDefinition] | None = None,
    adapters: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[StaticArticle]]:
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
    for source_articles, status in source_results:
        statuses.append(status)
        gathered_articles.extend(source_articles)

    deduped_articles, evicted_articles = dedupe_static_articles(
        [*(archive_articles or []), *gathered_articles],
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
    return payload, evicted_articles


async def _collect_source(
    source_definition: SourceDefinition,
    settings: Settings,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    adapters: dict[str, Any],
) -> tuple[list[StaticArticle], SourceBuildStatus]:
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
        return [], status

    adapter = adapters.get(source_definition.adapter_type)
    if adapter is None:
        status.status = "failed"
        status.error = (
            f"Source adapter is not registered for static builds: {source_definition.adapter_type}."
        )
        status.message = status.error
        return [], status
    try:
        async with semaphore:
            candidates = await _fetch_with_retries(adapter, source_definition, settings, client)
    except Exception as exc:
        status.status = "failed"
        status.error = str(exc)
        status.message = status.error
        return [], status

    status.fetched_count = len(candidates)
    if source_definition.adapter_type == "telegram_channel" and status.fetched_count == 0:
        status.status = "warning"
        status.message = "No usable external article links found in the latest 20 messages."
    accepted_articles: list[StaticArticle] = []
    for candidate in candidates:
        category = classify_candidate(candidate, source_definition)
        if category is None:
            continue
        if not _allow_static_candidate(candidate):
            continue
        canonical_url, normalized_title, title_hash = canonicalize_candidate(candidate)
        accepted_articles.append(
            StaticArticle(
                title=candidate.title,
                canonical_url=canonical_url,
                source_key=source_definition.source_key,
                source_name=source_definition.name,
                primary_category=category,
                published_at=candidate.published_at,
                trust_level=max(candidate.trust_level, source_definition.trust_level),
                language=candidate.language or "unknown",
                normalized_title=normalized_title,
                title_hash=title_hash,
                source_names=(source_definition.name,),
            )
        )

    accepted_articles.sort(key=_article_sort_key, reverse=True)
    limited_articles = accepted_articles[: settings.static_max_articles_per_source]
    status.accepted_count = len(limited_articles)
    return limited_articles, status


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
    if not candidate.title or len(candidate.title.strip()) < 12:
        return False
    if not candidate.url.startswith(("http://", "https://")):
        return False
    blocked_hosts = {"news.naver.com", "n.news.naver.com"}
    if urlsplit(candidate.url).netloc.lower() in blocked_hosts:
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


def _build_initial_sections(payload: dict[str, Any]) -> list[dict[str, Any]]:
    hubs = {entry["key"]: entry for entry in payload.get("hubs", [])}
    articles_by_hub: dict[str, list[dict[str, Any]]] = {
        hub_key: [] for hub_key in hubs
    }
    for article in _paginate_articles(
        payload["articles"],
        page=1,
        page_size=int(payload.get("page_size") or 25),
    ):
        articles_by_hub.setdefault(article.get("hub", "global"), []).append(article)
    sections: list[dict[str, Any]] = []
    for hub_key, hub in hubs.items():
        articles = articles_by_hub.get(hub_key, [])
        if not articles:
            continue
        sections.append(
            {
                "key": hub_key,
                "label": hub["label"],
                "eyebrow": "허브",
                "count": len(articles),
                "articles": articles,
            }
        )
    return sections


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
    existing_removed_log = _load_removed_article_log(active_settings, destination)
    payload, evicted_articles = asyncio.run(
        collect_site_payload(
            active_settings,
            archive_articles=archive_articles,
            source_definitions=source_definitions,
            adapters=adapters,
        )
    )
    removed_log = _build_removed_article_log(
        existing_removed_log,
        evicted_articles,
        generated_at=payload["generated_at"],
    )
    _write_static_site(destination, payload, removed_log=removed_log)
    return payload


def _write_static_site(
    output_dir: Path,
    payload: dict[str, Any],
    *,
    removed_log: str,
) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "assets").mkdir(parents=True, exist_ok=True)
    (output_dir / "data").mkdir(parents=True, exist_ok=True)

    shutil.copy2(SITE_ASSET_DIR / "style.css", output_dir / "assets" / "style.css")
    shutil.copy2(SITE_ASSET_DIR / "app.js", output_dir / "assets" / "app.js")

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
        initial_sections=_build_initial_sections(payload),
        initial_hub={
            "label": "전체 허브",
            "description": "대한민국, 미국, 글로벌 전문 허브를 한 화면에서 살펴볼 수 있습니다.",
        },
        initial_total_pages=max(1, ceil(payload["article_count"] / max(payload["page_size"], 1))),
        initial_pagination_tokens=_build_page_tokens(
            max(1, ceil(payload["article_count"] / max(payload["page_size"], 1))),
            1,
        ),
        source_statuses=payload["source_statuses"],
        payload_json=payload_json,
    )

    (output_dir / "index.html").write_text(html, encoding="utf-8")
    (output_dir / "404.html").write_text(html, encoding="utf-8")
    (output_dir / "data" / "site-data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
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
