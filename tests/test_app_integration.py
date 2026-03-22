from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import httpx
from sqlalchemy import func
from sqlalchemy import select

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
        assert "새로 갱신됐어요" in response.text
        assert "최근 15분 동안 새 기사 1건을 반영했습니다." in response.text


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
    assert "총 27건 · 1/2 페이지" in first_page.text
    assert 'href="/category/crypto?page=2"' in first_page.text
    assert "Crypto archive story 26" in first_page.text

    second_page = client.get("/category/crypto?page=2")
    assert second_page.status_code == 200
    assert "총 27건 · 2/2 페이지" in second_page.text
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
    assert "한국 페이지" in hub_response.text
    assert 'href="/hub/kr/kr-economy"' in hub_response.text
    assert "Korea economy headline" in hub_response.text
    assert "US politics headline" not in hub_response.text

    section_response = client.get("/hub/us/us-politics")
    assert section_response.status_code == 200
    assert "미국 페이지" in section_response.text
    assert "US politics headline" in section_response.text
    assert "Korea economy headline" not in section_response.text
