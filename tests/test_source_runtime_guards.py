from __future__ import annotations

import asyncio

from sqlalchemy import select

from newsbot.config import Settings
from newsbot.models import FetchRun
from newsbot.models import Source
from newsbot.services import ingest
from newsbot.services.scheduler import build_scheduler
from newsbot.services.source_sync import STALE_SOURCE_ERROR
from newsbot.services.source_sync import sync_sources


def _make_source(source_key: str, *, adapter_type: str = "rss") -> Source:
    return Source(
        source_key=source_key,
        name=f"Source {source_key}",
        adapter_type=adapter_type,
        category="crypto",
        base_url="https://example.com",
        enabled=True,
        discovery_only=False,
        allow_page_fetch=False,
        poll_interval_sec=300,
        trust_level=50,
        dedupe_strategy="default",
        config_json={},
    )


def test_sync_sources_disables_stale_rows_and_scheduler_skips_them(app):
    session_factory = app.state.session_factory
    with session_factory() as session:
        session.add(_make_source("stale-rss"))
        session.commit()
        sync_sources(session)

    with session_factory() as session:
        stale_source = session.scalar(
            select(Source).where(Source.source_key == "stale-rss")
        )
        assert stale_source is not None
        assert stale_source.enabled is False
        assert stale_source.last_error == STALE_SOURCE_ERROR

    assert "stale-rss" not in ingest.list_source_keys(session_factory)

    scheduler = build_scheduler(session_factory, app.state.settings)
    assert "fetch:stale-rss" not in {job.id for job in scheduler.get_jobs()}


def test_sync_sources_disables_removed_env_telegram_sources(monkeypatch, app):
    session_factory = app.state.session_factory
    monkeypatch.setenv("NEWSBOT_TELEGRAM_NEWS_CHANNELS", "@fresh_news")
    with session_factory() as session:
        sync_sources(session)

    with session_factory() as session:
        env_source = session.scalar(
            select(Source).where(Source.source_key == "telegram-env-fresh-news")
        )
        assert env_source is not None
        assert env_source.enabled is True

    monkeypatch.delenv("NEWSBOT_TELEGRAM_NEWS_CHANNELS", raising=False)
    with session_factory() as session:
        sync_sources(session)

    with session_factory() as session:
        env_source = session.scalar(
            select(Source).where(Source.source_key == "telegram-env-fresh-news")
        )
        assert env_source is not None
        assert env_source.enabled is False
        assert env_source.last_error == STALE_SOURCE_ERROR

    assert "telegram-env-fresh-news" not in ingest.list_source_keys(session_factory)


def test_scheduler_skips_telegram_sources_when_runtime_is_disabled(app):
    scheduler = build_scheduler(app.state.session_factory, app.state.settings)

    assert "fetch:telegram-dada-news2" not in {job.id for job in scheduler.get_jobs()}


def test_scheduler_keeps_telegram_sources_when_runtime_is_enabled(app):
    settings = Settings(
        database_url=app.state.settings.database_url,
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=True,
        telegram_api_id="123456",
        telegram_api_hash="hash-value",
        telegram_session_string="session-value",
    )

    scheduler = build_scheduler(app.state.session_factory, settings)

    assert "fetch:telegram-dada-news2" in {job.id for job in scheduler.get_jobs()}


def test_fetch_single_source_records_failure_for_unknown_registry_source(app):
    session_factory = app.state.session_factory
    with session_factory() as session:
        session.add(_make_source("stale-rss"))
        session.commit()

    result = asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "stale-rss")
    )

    assert result == {"fetched": 0, "inserted": 0}
    with session_factory() as session:
        stale_source = session.scalar(
            select(Source).where(Source.source_key == "stale-rss")
        )
        fetch_run = session.scalar(
            select(FetchRun)
            .where(FetchRun.source_key == "stale-rss")
            .order_by(FetchRun.id.desc())
        )
        assert stale_source is not None
        assert stale_source.consecutive_failures == 1
        assert stale_source.last_error == ingest.UNKNOWN_SOURCE_ERROR
        assert fetch_run is not None
        assert fetch_run.status == "failed"
        assert fetch_run.error_message == ingest.UNKNOWN_SOURCE_ERROR


def test_fetch_single_source_records_failure_for_missing_adapter(app, monkeypatch):
    session_factory = app.state.session_factory
    monkeypatch.delitem(ingest.ADAPTERS, "rss")

    result = asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "coindesk-rss")
    )

    assert result == {"fetched": 0, "inserted": 0}
    with session_factory() as session:
        source = session.scalar(
            select(Source).where(Source.source_key == "coindesk-rss")
        )
        fetch_run = session.scalar(
            select(FetchRun)
            .where(FetchRun.source_key == "coindesk-rss")
            .order_by(FetchRun.id.desc())
        )
        assert source is not None
        assert source.consecutive_failures == 1
        assert "Missing adapter type: rss." in source.last_error
        assert fetch_run is not None
        assert fetch_run.status == "failed"
        assert "Missing adapter type: rss." in fetch_run.error_message
