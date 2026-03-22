"""Build a static GitHub Pages site from curated news sources."""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import replace
from datetime import datetime
from datetime import timezone
import json
from math import ceil
from pathlib import Path
import shutil
from typing import Any
from urllib.parse import urlsplit

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
        return {
            "title": self.title,
            "canonical_url": self.canonical_url,
            "link_label": self.link_label,
            "source_key": self.source_key,
            "source_name": self.source_name,
            "source_names": list(self.source_names or (self.source_name,)),
            "primary_category": self.primary_category,
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
    error: str | None = None

    def to_public_dict(self) -> dict[str, Any]:
        return asdict(self)


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
) -> dict[str, Any]:
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

    deduped_articles = dedupe_static_articles(
        [*(archive_articles or []), *gathered_articles],
        max_total=settings.static_max_total_articles,
    )
    published_counts = Counter(article.source_key for article in deduped_articles)
    for status in statuses:
        status.published_count = published_counts.get(status.source_key, 0)

    category_counts = Counter(article.primary_category for article in deduped_articles)
    source_options = [
        {
            "source_key": status.source_key,
            "name": status.source_name,
            "category": status.category,
            "count": status.published_count,
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
        "page_size": settings.article_page_size,
        "healthy_source_count": sum(status.status == "ok" for status in statuses),
        "failed_source_count": sum(status.status == "failed" for status in statuses),
        "categories": _build_category_payload(category_counts),
        "sources": source_options,
        "source_statuses": [status.to_public_dict() for status in statuses],
        "articles": [article.to_public_dict() for article in deduped_articles],
    }
    if payload["article_count"] < settings.static_min_articles_to_publish:
        raise RuntimeError(
            f"Refusing to publish only {payload['article_count']} articles; "
            f"minimum is {settings.static_min_articles_to_publish}."
        )
    return payload


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
    adapter = adapters[source_definition.adapter_type]
    try:
        async with semaphore:
            candidates = await _fetch_with_retries(adapter, source_definition, settings, client)
    except Exception as exc:
        status.status = "failed"
        status.error = str(exc)
        return [], status

    status.fetched_count = len(candidates)
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


def dedupe_static_articles(
    articles: list[StaticArticle],
    *,
    max_total: int,
) -> list[StaticArticle]:
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
    return deduped[:max_total]


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


def _build_category_payload(category_counts: Counter[str]) -> list[dict[str, Any]]:
    from newsbot.categories import ALL_CATEGORIES
    from newsbot.categories import CATEGORY_LABELS

    return [
        {
            "key": category,
            "label": CATEGORY_LABELS[category],
            "count": category_counts.get(category, 0),
        }
        for category in ALL_CATEGORIES
    ]


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
    categories = {entry["key"]: entry for entry in payload["categories"]}
    articles_by_category: dict[str, list[dict[str, Any]]] = {
        category_key: [] for category_key in categories
    }
    for article in _paginate_articles(
        payload["articles"],
        page=1,
        page_size=int(payload.get("page_size") or 25),
    ):
        articles_by_category.setdefault(article["primary_category"], []).append(article)
    sections: list[dict[str, Any]] = []
    for category_key, category in categories.items():
        articles = articles_by_category.get(category_key, [])
        if not articles:
            continue
        sections.append(
            {
                "key": category_key,
                "label": category["label"],
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
    payload = asyncio.run(
        collect_site_payload(
            active_settings,
            archive_articles=archive_articles,
            source_definitions=source_definitions,
            adapters=adapters,
        )
    )
    _write_static_site(destination, payload)
    return payload


def _write_static_site(output_dir: Path, payload: dict[str, Any]) -> None:
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
        categories=payload["categories"],
        initial_sections=_build_initial_sections(payload),
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


def _load_archive_payload_from_path(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
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


def main() -> None:
    payload = build_static_site()
    print(
        f"Built static site with {payload['article_count']} articles and "
        f"{payload['failed_source_count']} source failures."
    )


if __name__ == "__main__":
    main()
