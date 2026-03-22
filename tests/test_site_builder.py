from __future__ import annotations

import json
from datetime import datetime
from datetime import timezone

import pytest

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.site_builder import build_static_site
from newsbot.source_registry import SourceDefinition


class FakeCryptoAdapter:
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
                language="en",
                trust_level=90,
            ),
            ArticleCandidate(
                source_key="coindesk-rss",
                source_name="CoinDesk",
                title="Bitcoin jumps after ETF inflow surprise",
                url="https://www.coindesk.com/markets/2026/03/21/bitcoin-jumps/",
                published_at=datetime(2026, 3, 21, 10, 2, tzinfo=timezone.utc),
                summary="duplicate",
                language="en",
                trust_level=90,
            ),
        ]


class FakeNaverAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return [
            ArticleCandidate(
                source_key="naver-kr-society",
                source_name="NAVER News Search",
                title="서울 지하철 안전 대책 강화 발표",
                url="https://www.yna.co.kr/view/AKR20260321000100004",
                published_at=datetime(2026, 3, 21, 9, 0, tzinfo=timezone.utc),
                summary="정부가 안전 대책을 강화했다.",
                language="ko",
                tags=["교통 안전"],
                trust_level=70,
            ),
            ArticleCandidate(
                source_key="naver-kr-society",
                source_name="NAVER News Search",
                title="여야, 교육 정책 두고 국회 공방",
                url="https://www.yna.co.kr/view/AKR20260321000100005",
                published_at=datetime(2026, 3, 21, 8, 0, tzinfo=timezone.utc),
                summary="정치권 충돌이 이어졌다.",
                language="ko",
                tags=["교육 현장"],
                trust_level=70,
            ),
        ]


class ExplodingFinanceAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        raise RuntimeError("temporary upstream failure")


def _settings(tmp_path, *, min_articles: int = 1) -> Settings:
    return Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        max_retries=1,
        static_output_dir=str(tmp_path / "site-dist"),
        static_min_articles_to_publish=min_articles,
        static_max_articles_per_source=10,
        static_max_total_articles=20,
    )


def test_build_static_site_generates_dense_payload_and_files(tmp_path):
    source_definitions = [
        SourceDefinition(
            source_key="coindesk-rss",
            name="CoinDesk",
            adapter_type="rss",
            category="crypto",
            poll_interval_sec=300,
            base_url="https://www.coindesk.com",
            trust_level=90,
        ),
        SourceDefinition(
            source_key="naver-kr-society",
            name="NAVER News Search",
            adapter_type="naver_search",
            category="kr-society",
            poll_interval_sec=600,
            base_url="https://openapi.naver.com",
            trust_level=70,
            discovery_only=True,
        ),
        SourceDefinition(
            source_key="broken-finance",
            name="Broken Finance",
            adapter_type="html_discovery",
            category="us-finance",
            poll_interval_sec=600,
            base_url="https://example.com",
            trust_level=60,
        ),
        SourceDefinition(
            source_key="disabled-low-quality",
            name="Disabled Low Quality",
            adapter_type="rss",
            category="us-finance",
            poll_interval_sec=300,
            base_url="https://example.com",
            trust_level=20,
            static_enabled=False,
        ),
    ]
    adapters = {
        "rss": FakeCryptoAdapter(),
        "naver_search": FakeNaverAdapter(),
        "html_discovery": ExplodingFinanceAdapter(),
    }

    payload = build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters=adapters,
    )

    assert payload["article_count"] == 2
    assert payload["page_size"] == 25
    assert payload["failed_source_count"] == 1
    assert [article["primary_category"] for article in payload["articles"]] == [
        "crypto",
        "kr-society",
    ]

    output_dir = tmp_path / "site-dist"
    assert (output_dir / "index.html").exists()
    assert (output_dir / "assets" / "style.css").exists()
    assert (output_dir / "data" / "site-data.json").exists()
    html = (output_dir / "index.html").read_text(encoding="utf-8")
    assert 'id="copy-all-button"' in html
    assert 'id="export-word-button"' in html
    assert 'id="export-excel-button"' in html
    assert 'id="refresh-spotlight"' in html
    assert 'id="pagination-nav"' in html

    file_payload = json.loads((output_dir / "data" / "site-data.json").read_text())
    assert file_payload["article_count"] == 2
    assert all(source["source_key"] != "disabled-low-quality" for source in file_payload["sources"])


class FakeFollowupCryptoAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return [
            ArticleCandidate(
                source_key="coindesk-rss",
                source_name="CoinDesk",
                title="Ether traders eye renewed ETF demand",
                url="https://www.coindesk.com/markets/2026/03/22/ether-etf-demand/",
                published_at=datetime(2026, 3, 22, 7, 30, tzinfo=timezone.utc),
                summary="A newer archived story should be inserted ahead of older ones.",
                language="en",
                trust_level=90,
            ),
        ]


def test_build_static_site_merges_existing_archive_before_writing(tmp_path):
    source_definitions = [
        SourceDefinition(
            source_key="coindesk-rss",
            name="CoinDesk",
            adapter_type="rss",
            category="crypto",
            poll_interval_sec=300,
            base_url="https://www.coindesk.com",
            trust_level=90,
        )
    ]

    build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeCryptoAdapter()},
    )

    payload = build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeFollowupCryptoAdapter()},
    )

    assert payload["article_count"] == 2
    assert [article["title"] for article in payload["articles"]] == [
        "Ether traders eye renewed ETF demand",
        "Bitcoin jumps after ETF inflow surprise",
    ]


def test_build_static_site_refuses_to_publish_when_article_floor_not_met(tmp_path):
    source_definitions = [
        SourceDefinition(
            source_key="coindesk-rss",
            name="CoinDesk",
            adapter_type="rss",
            category="crypto",
            poll_interval_sec=300,
            base_url="https://www.coindesk.com",
            trust_level=90,
        )
    ]
    adapters = {"rss": FakeCryptoAdapter()}

    with pytest.raises(RuntimeError):
        build_static_site(
            _settings(tmp_path, min_articles=3),
            output_dir=tmp_path / "site-dist",
            source_definitions=source_definitions,
            adapters=adapters,
        )
