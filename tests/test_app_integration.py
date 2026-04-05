from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import newsbot.api.api as api_module
from fastapi.testclient import TestClient
from sqlalchemy import func
from sqlalchemy import select

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.models import Article
from newsbot.models import ArticleAlias
from newsbot.models import Bookmark
from newsbot.models import Source
from newsbot.services import ingest


class FakeRssAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return [
            ArticleCandidate(
                source_key="coindesk-rss",
                source_name="CoinDesk",
                title="Bitcoin jumps after ETF inflow surprise",
                url="https://www.coindesk.com/markets/2026/03/21/bitcoin-jumps/?utm_source=x",
                published_at=datetime(2026, 3, 21, 10, 0, tzinfo=timezone.utc),
                summary="ETF flows pushed bitcoin higher.",
                category="crypto",
                language="en",
                trust_level=90,
            )
        ]


class FakeTelegramAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return [
            ArticleCandidate(
                source_key="telegram-dada-news2",
                source_name="Telegram @dada_news2",
                title="Bitcoin jumps after ETF inflow surprise",
                url="https://www.coindesk.com/markets/2026/03/21/bitcoin-jumps/",
                published_at=datetime(2026, 3, 21, 10, 5, tzinfo=timezone.utc),
                summary="Telegram mirror",
                language="en",
                trust_level=55,
            )
        ]


class TimeoutAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        raise httpx.ReadTimeout("timed out")


class ExplodingTelegramAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        raise AssertionError("bootstrap should not call telegram adapters")


def test_fetch_persist_and_render_article(client, app, monkeypatch):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", FakeRssAdapter())
    session_factory = app.state.session_factory

    result = asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "coindesk-rss")
    )

    assert result == {"fetched": 1, "inserted": 1}
    response = client.get("/api/articles?category=crypto")
    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["title"] == "Bitcoin jumps after ETF inflow surprise"

    article_id = payload["items"][0]["id"]
    bookmark_response = client.post(f"/api/bookmarks/{article_id}")
    assert bookmark_response.status_code == 200

    with session_factory() as session:
        assert session.scalar(select(func.count(Bookmark.id))) == 1


def test_refresh_notice_is_visible_across_pages(client, app, monkeypatch):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", FakeRssAdapter())
    session_factory = app.state.session_factory

    asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "coindesk-rss")
    )

    for path in ["/", "/sources", "/admin/health"]:
        response = client.get(path)
        assert response.status_code == 200
        assert 'class="site-refresh' in response.text
        assert 'class="site-refresh-kicker"' in response.text
        assert '<time datetime=' in response.text


def test_direct_source_and_telegram_source_merge_into_one_article(app, monkeypatch):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", FakeRssAdapter())
    monkeypatch.setitem(ingest.ADAPTERS, "telegram_channel", FakeTelegramAdapter())
    session_factory = app.state.session_factory

    asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "coindesk-rss")
    )
    asyncio.run(
        ingest.fetch_single_source(
            session_factory, app.state.settings, "telegram-dada-news2"
        )
    )

    with session_factory() as session:
        assert session.scalar(select(func.count(Article.id))) == 1
        assert session.scalar(select(func.count(ArticleAlias.id))) == 2


def test_fetch_failure_does_not_break_and_increments_source_failures(app, monkeypatch):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", TimeoutAdapter())
    session_factory = app.state.session_factory

    result = asyncio.run(
        ingest.fetch_single_source(session_factory, app.state.settings, "coindesk-rss")
    )
    assert result == {"fetched": 0, "inserted": 0}

    with session_factory() as session:
        source = session.scalar(select(Source).where(Source.source_key == "coindesk-rss"))
        assert source.consecutive_failures == 1


def test_bootstrap_initial_content_skips_telegram_sources(app, monkeypatch):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", FakeRssAdapter())
    monkeypatch.setitem(ingest.ADAPTERS, "html_discovery", FakeRssAdapter())
    monkeypatch.setitem(ingest.ADAPTERS, "telegram_channel", ExplodingTelegramAdapter())
    session_factory = app.state.session_factory

    with session_factory() as session:
        session.query(Article).delete()
        session.commit()

    result = asyncio.run(
        ingest.bootstrap_initial_content(session_factory, app.state.settings)
    )

    assert "telegram-dada-news2" not in result
    with session_factory() as session:
        assert session.scalar(select(func.count(Article.id))) >= 1


def test_bootstrap_initial_content_includes_telegram_sources_when_runtime_enabled(
    app, monkeypatch
):
    monkeypatch.setitem(ingest.ADAPTERS, "rss", FakeRssAdapter())
    monkeypatch.setitem(ingest.ADAPTERS, "html_discovery", FakeRssAdapter())
    monkeypatch.setitem(ingest.ADAPTERS, "telegram_channel", FakeTelegramAdapter())
    session_factory = app.state.session_factory

    with session_factory() as session:
        session.query(Article).delete()
        session.commit()

    telegram_settings = Settings(
        database_url=app.state.settings.database_url,
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=True,
        telegram_api_id="123456",
        telegram_api_hash="hash-value",
        telegram_session_string="session-value",
    )

    result = asyncio.run(
        ingest.bootstrap_initial_content(session_factory, telegram_settings)
    )

    assert "telegram-dada-news2" in result
    assert result["telegram-dada-news2"]["fetched"] == 1


def test_fetch_now_defaults_to_runtime_telegram_setting(app, monkeypatch):
    captured = SimpleNamespace(include_telegram_sources=None)
    app.state.settings = Settings(
        database_url=app.state.settings.database_url,
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=True,
        telegram_api_id="123456",
        telegram_api_hash="hash-value",
        telegram_session_string="session-value",
    )

    async def fake_fetch_all_sources(
        session_factory,
        settings,
        *,
        source_keys=None,
        include_telegram_sources=True,
        include_discovery_sources=True,
    ):
        del session_factory, settings, source_keys, include_discovery_sources
        captured.include_telegram_sources = include_telegram_sources
        return {}

    monkeypatch.setattr(api_module, "fetch_all_sources", fake_fetch_all_sources)

    with TestClient(app) as client:
        response = client.post("/api/admin/fetch-now")

    assert response.status_code == 200
    assert captured.include_telegram_sources is True


def test_category_page_uses_numbered_pagination(client, app):
    session_factory = app.state.session_factory

    with session_factory() as session:
        for index in range(27):
            session.add(
                Article(
                    title=f"Crypto archive story {index:02d}",
                    canonical_url=f"https://example.com/crypto/{index:02d}",
                    source_key="coindesk-rss",
                    source_name="CoinDesk",
                    published_at=datetime(2026, 3, 22, 12, index, tzinfo=timezone.utc),
                    primary_category="crypto",
                    language="en",
                    trust_level=90,
                    title_hash=f"hash-{index:02d}",
                    normalized_title=f"crypto archive story {index:02d}",
                )
            )
        session.commit()

    first_page = client.get("/category/crypto?page=1")
    assert first_page.status_code == 200
    assert 'class="pagination-summary"' in first_page.text
    assert '1/2' in first_page.text
    assert 'href="/category/crypto?page=2"' in first_page.text
    assert "Crypto archive story 26" in first_page.text

    second_page = client.get("/category/crypto?page=2")
    assert second_page.status_code == 200
    assert 'class="pagination-summary"' in second_page.text
    assert '2/2' in second_page.text
    assert "Crypto archive story 01" in second_page.text


def test_hub_routes_render_hub_and_section_navigation(client, app):
    session_factory = app.state.session_factory

    with session_factory() as session:
        session.add_all(
            [
                Article(
                    title="Korea economy headline",
                    canonical_url="https://example.com/kr-economy",
                    source_key="sample-kr-economy",
                    source_name="Sample KR Economy",
                    published_at=datetime(2026, 3, 22, 13, 0, tzinfo=timezone.utc),
                    primary_category="kr-economy",
                    language="ko",
                    trust_level=70,
                    title_hash="kr-economy-hash",
                    normalized_title="korea economy headline",
                ),
                Article(
                    title="US politics headline",
                    canonical_url="https://example.com/us-politics",
                    source_key="sample-us-politics",
                    source_name="Sample US Politics",
                    published_at=datetime(2026, 3, 22, 13, 5, tzinfo=timezone.utc),
                    primary_category="us-politics",
                    language="en",
                    trust_level=70,
                    title_hash="us-politics-hash",
                    normalized_title="us politics headline",
                ),
            ]
        )
        session.commit()

    hub_response = client.get("/hub/kr")
    assert hub_response.status_code == 200
    assert 'href="/hub/kr/kr-economy"' in hub_response.text
    assert 'class="hero hero-hub"' in hub_response.text
    assert 'class="hub-tabs"' in hub_response.text
    assert 'class="section-tabs"' in hub_response.text
    assert 'class="filters filter-toolbar"' in hub_response.text
    assert 'class="article-meta-line compact-meta"' in hub_response.text
    assert 'class="article-timestamp"' in hub_response.text
    assert hub_response.text.index('class="article-title"') < hub_response.text.index(
        'class="article-meta-line compact-meta"'
    )
    assert hub_response.text.index('class="article-meta-line compact-meta"') < hub_response.text.index(
        'class="article-timestamp"'
    )
    assert "Korea economy headline" in hub_response.text
    assert "US politics headline" not in hub_response.text

    section_response = client.get("/hub/us/us-politics")
    assert section_response.status_code == 200
    assert "US politics headline" in section_response.text
    assert "Korea economy headline" not in section_response.text


def test_article_api_cursor_keeps_sort_order_across_pages(client, app):
    session_factory = app.state.session_factory

    with session_factory() as session:
        recent_articles = [
            Article(
                title=f"Recent markets story {index:02d}",
                canonical_url=f"https://example.com/recent/{index:02d}",
                source_key="coindesk-rss",
                source_name="CoinDesk",
                published_at=datetime(2026, 3, 30, 12, index % 60, tzinfo=timezone.utc),
                primary_category="crypto",
                language="en",
                trust_level=90,
                title_hash=f"recent-hash-{index:02d}",
                normalized_title=f"recent markets story {index:02d}",
            )
            for index in range(31)
        ]
        late_old_articles = [
            Article(
                title=f"Late archived story {index:02d}",
                canonical_url=f"https://example.com/late/{index:02d}",
                source_key="coindesk-rss",
                source_name="CoinDesk",
                published_at=datetime(2025, 12, 1, 8, index, tzinfo=timezone.utc),
                primary_category="crypto",
                language="en",
                trust_level=90,
                title_hash=f"late-hash-{index:02d}",
                normalized_title=f"late archived story {index:02d}",
            )
            for index in range(4)
        ]
        session.add_all([*recent_articles, *late_old_articles])
        session.commit()

    first_page = client.get("/api/articles?category=crypto")
    assert first_page.status_code == 200
    first_payload = first_page.json()
    assert len(first_payload["items"]) == 30
    assert first_payload["next_cursor"]

    second_page = client.get(
        f"/api/articles?category=crypto&cursor={first_payload['next_cursor']}"
    )
    assert second_page.status_code == 200
    second_payload = second_page.json()

    combined_urls = [
        item["canonical_url"]
        for item in [*first_payload["items"], *second_payload["items"]]
    ]
    assert len(combined_urls) == 35
    assert len(set(combined_urls)) == 35
    assert "https://example.com/recent/00" in combined_urls
    assert "https://example.com/late/00" in combined_urls
    assert "https://example.com/late/03" in combined_urls


def test_article_api_rejects_invalid_cursor(client):
    response = client.get("/api/articles?cursor=not-a-valid-cursor")

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid cursor."}



