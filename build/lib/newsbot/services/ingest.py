"""Fetching, normalization, and persistence."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Callable

import httpx
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import Session

from newsbot.adapters.html_discovery import HtmlDiscoveryAdapter
from newsbot.adapters.naver_news import NaverNewsAdapter
from newsbot.adapters.rss import RssAdapter
from newsbot.adapters.telegram_channel import TelegramChannelAdapter
from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.models import Article
from newsbot.models import ArticleAlias
from newsbot.models import FetchRun
from newsbot.models import Source
from newsbot.services.classifier import classify_candidate
from newsbot.services.dedupe import canonicalize_candidate
from newsbot.services.dedupe import find_existing_article
from newsbot.source_registry import get_source_definition


ADAPTERS = {
    "rss": RssAdapter(),
    "html_discovery": HtmlDiscoveryAdapter(),
    "naver_search": NaverNewsAdapter(),
    "telegram_channel": TelegramChannelAdapter(),
}


async def fetch_all_sources(
    session_factory: Callable[[], Session],
    settings: Settings,
    *,
    source_keys: list[str] | None = None,
    include_telegram_sources: bool = True,
    include_discovery_sources: bool = True,
) -> dict[str, dict[str, int]]:
    selected_source_keys = source_keys or list_source_keys(
        session_factory,
        include_telegram_sources=include_telegram_sources,
        include_discovery_sources=include_discovery_sources,
    )
    results: dict[str, dict[str, int]] = {}
    tasks = [
        fetch_single_source(session_factory, settings, source_key)
        for source_key in selected_source_keys
    ]
    task_results = await asyncio.gather(*tasks)
    for source_key, task_result in zip(selected_source_keys, task_results, strict=True):
        results[source_key] = task_result
    return results


def list_source_keys(
    session_factory: Callable[[], Session],
    *,
    include_telegram_sources: bool = True,
    include_discovery_sources: bool = True,
) -> list[str]:
    with session_factory() as session:
        sources = list(
            session.scalars(
                select(Source).where(Source.enabled.is_(True)).order_by(Source.source_key)
            )
        )
    source_keys: list[str] = []
    for source in sources:
        source_definition = get_source_definition(source.source_key)
        if not include_telegram_sources and source_definition.adapter_type == "telegram_channel":
            continue
        if not include_discovery_sources and source_definition.discovery_only:
            continue
        source_keys.append(source.source_key)
    return source_keys


async def bootstrap_initial_content(
    session_factory: Callable[[], Session],
    settings: Settings,
) -> dict[str, dict[str, int]]:
    with session_factory() as session:
        article_count = session.scalar(select(func.count(Article.id))) or 0
    if article_count > 0:
        return {}
    bootstrap_source_keys = list_source_keys(
        session_factory,
        include_telegram_sources=False,
        include_discovery_sources=False,
    )
    return await fetch_all_sources(
        session_factory,
        settings,
        source_keys=bootstrap_source_keys,
        include_telegram_sources=False,
        include_discovery_sources=False,
    )


async def fetch_single_source(
    session_factory: Callable[[], Session],
    settings: Settings,
    source_key: str,
) -> dict[str, int]:
    source_definition = get_source_definition(source_key)
    adapter = ADAPTERS[source_definition.adapter_type]
    with session_factory() as session:
        source = session.scalar(select(Source).where(Source.source_key == source_key))
        if source is None or not source.enabled:
            return {"fetched": 0, "inserted": 0}
        fetch_run = FetchRun(source_key=source_key)
        session.add(fetch_run)
        session.commit()
        session.refresh(fetch_run)
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            headers={"User-Agent": "newsbot/0.1"},
            timeout=settings.request_timeout_sec,
        ) as client:
            candidates = await _fetch_with_retries(
                adapter,
                source_definition,
                settings,
                client,
            )
        inserted_count = await _store_candidates(
            session_factory, settings, source_definition, candidates
        )
        with session_factory() as session:
            source = session.scalar(select(Source).where(Source.source_key == source_key))
            fetch_run = session.get(FetchRun, fetch_run.id)
            source.consecutive_failures = 0
            source.last_error = None
            source.last_success_at = datetime.now(tz=timezone.utc)
            source.last_fetched_at = datetime.now(tz=timezone.utc)
            fetch_run.finished_at = datetime.now(tz=timezone.utc)
            fetch_run.status = "success"
            fetch_run.fetched_count = len(candidates)
            fetch_run.inserted_count = inserted_count
            session.commit()
        return {"fetched": len(candidates), "inserted": inserted_count}
    except Exception as exc:
        with session_factory() as session:
            source = session.scalar(select(Source).where(Source.source_key == source_key))
            fetch_run = session.get(FetchRun, fetch_run.id)
            source.consecutive_failures += 1
            source.last_error = str(exc)
            source.last_fetched_at = datetime.now(tz=timezone.utc)
            if source.consecutive_failures >= settings.auto_disable_after_failures:
                source.enabled = False
            fetch_run.finished_at = datetime.now(tz=timezone.utc)
            fetch_run.status = "failed"
            fetch_run.error_message = str(exc)
            session.commit()
        return {"fetched": 0, "inserted": 0}


async def _fetch_with_retries(
    adapter,
    source_definition,
    settings: Settings,
    client: httpx.AsyncClient,
) -> list[ArticleCandidate]:
    last_error: Exception | None = None
    for attempt in range(settings.max_retries):
        try:
            return await adapter.fetch(source_definition, settings, client)
        except Exception as exc:  # pragma: no cover - exercised via caller failure test
            last_error = exc
            if attempt == settings.max_retries - 1:
                break
            await asyncio.sleep(0.2 * (2**attempt))
    assert last_error is not None
    raise last_error


async def _store_candidates(
    session_factory: Callable[[], Session],
    settings: Settings,
    source_definition,
    candidates: list[ArticleCandidate],
) -> int:
    inserted_count = 0
    new_article_ids: list[int] = []
    with session_factory() as session:
        for candidate in candidates:
            category = classify_candidate(candidate, source_definition)
            if category is None:
                continue
            existing_article = find_existing_article(session, candidate)
            canonical_url, normalized_title, title_hash = canonicalize_candidate(candidate)
            if existing_article is None:
                article = Article(
                    title=candidate.title,
                    canonical_url=canonical_url,
                    source_key=source_definition.source_key,
                    source_name=source_definition.name,
                    published_at=candidate.published_at,
                    primary_category=category,
                    tags=candidate.tags,
                    short_summary=candidate.summary,
                    language=candidate.language or "unknown",
                    trust_level=candidate.trust_level,
                    title_hash=title_hash,
                    normalized_title=normalized_title,
                )
                session.add(article)
                session.flush()
                session.add(
                    ArticleAlias(
                        article_id=article.id,
                        source_key=source_definition.source_key,
                        alias_url=canonical_url,
                        title=candidate.title,
                    )
                )
                new_article_ids.append(article.id)
                inserted_count += 1
                continue
            _merge_existing_article(
                session,
                existing_article,
                source_definition,
                candidate,
                canonical_url,
            )
        session.commit()
    return inserted_count


def _merge_existing_article(
    session: Session,
    article: Article,
    source_definition,
    candidate: ArticleCandidate,
    canonical_url: str,
) -> None:
    if source_definition.trust_level > article.trust_level:
        article.title = candidate.title
        article.source_key = source_definition.source_key
        article.source_name = source_definition.name
        article.trust_level = source_definition.trust_level
    if not article.short_summary and candidate.summary:
        article.short_summary = candidate.summary
    alias_exists = session.scalar(
        select(ArticleAlias).where(
            ArticleAlias.alias_url == canonical_url,
            ArticleAlias.source_key == source_definition.source_key,
        )
    )
    if alias_exists is None:
        session.add(
            ArticleAlias(
                article_id=article.id,
                source_key=source_definition.source_key,
                alias_url=canonical_url,
                title=candidate.title,
            )
        )
