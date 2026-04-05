from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime
from datetime import timezone

import pytest

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.site_builder import _allow_static_candidate
from newsbot.site_builder import _extract_analysis_keywords
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


class EmptyTelegramAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return []


def _settings(tmp_path, *, min_articles: int = 1) -> Settings:
    return Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        max_retries=1,
        naver_client_id="naver-client-id",
        naver_client_secret="naver-client-secret",
        static_output_dir=str(tmp_path / "site-dist"),
        static_archive_url=None,
        static_min_articles_to_publish=min_articles,
        static_max_articles_per_source=10,
        static_max_total_articles=20,
        markets_enabled=False,
    )


def _source_status(payload, source_key: str) -> dict[str, object]:
    return next(
        status
        for status in payload["source_statuses"]
        if status["source_key"] == source_key
    )


def _read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


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
    failed_status = _source_status(payload, "broken-finance")

    assert payload["article_count"] >= 2
    assert payload["removed_article_count"] == 0
    assert payload["page_size"] == 25
    assert payload["warning_source_count"] == 0
    assert payload["failed_source_count"] == 1
    assert failed_status["status"] == "failed"
    assert failed_status["message"] == "temporary upstream failure"
    assert {"kr", "global"}.issubset({hub["key"] for hub in payload["hubs"]})
    assert "crypto" in {article["primary_category"] for article in payload["articles"]}
    assert "kr-society" in {article["primary_category"] for article in payload["articles"]}
    assert any(article["hub"] == "global" for article in payload["articles"])
    assert any(article["hub"] == "kr" for article in payload["articles"])
    assert payload["sources"][0]["hub"] in {"global", "kr"}

    output_dir = tmp_path / "site-dist"
    assert (output_dir / "index.html").exists()
    assert (output_dir / "analysis" / "index.html").exists()
    assert (output_dir / "markets" / "index.html").exists()
    assert (output_dir / "assets" / "style.css").exists()
    assert (output_dir / "data" / "site-data.json").exists()
    assert (output_dir / "data" / "analysis-state.json").exists()
    assert (output_dir / "data" / "analysis-dashboard.json").exists()
    assert (output_dir / "data" / "markets-overview.json").exists()
    assert (output_dir / "data" / "markets-stocks.json").exists()
    assert (output_dir / "data" / "markets-korea.json").exists()
    assert (output_dir / "data" / "markets-crypto.json").exists()
    assert (output_dir / "data" / "markets-status.json").exists()
    assert (output_dir / "data" / "removed-articles.txt").exists()
    html = (output_dir / "index.html").read_text(encoding="utf-8")
    assert 'id="copy-all-button"' in html
    assert 'id="export-word-button"' in html
    assert 'id="export-excel-button"' in html
    assert 'id="refresh-spotlight"' in html
    assert 'id="pagination-nav"' in html
    assert 'id="news-hub-chooser"' in html
    assert 'id="news-content-shell"' in html
    assert 'id="hub-filters"' in html
    assert 'id="recency-filters"' in html
    assert 'class="featured-story-card"' in html
    assert 'class="featured-story-thumb"' in html
    assert 'class="story-actions"' in html
    assert 'class="hub-tab-rail"' in html
    assert 'class="section-tab-rail"' in html
    assert 'class="filter-grid"' in html
    assert 'class="news-timestamp"' in html
    assert 'href="analysis/"' in html
    assert 'href="markets/"' in html

    analysis_html = (output_dir / "analysis" / "index.html").read_text(encoding="utf-8")
    assert 'id="analysis-window-tabs"' in analysis_html
    assert 'id="analysis-kpi-strip"' in analysis_html
    assert 'id="analysis-mini-kpis"' in analysis_html
    assert 'id="analysis-distribution-panels"' in analysis_html
    assert 'id="analysis-trend-panels"' in analysis_html
    assert 'id="analysis-repeated"' in analysis_html
    assert 'id="analysis-samples"' in analysis_html
    assert "../assets/analysis.js" in analysis_html

    markets_html = (output_dir / "markets" / "index.html").read_text(encoding="utf-8")
    assert 'id="markets-surface-tabs"' in markets_html
    assert 'id="markets-korea-surface"' in markets_html
    assert '"korea_url":"' in markets_html
    assert "../assets/markets.js" in markets_html
    markets_js = (output_dir / "assets" / "markets.js").read_text(encoding="utf-8")
    assert "heatmaps?.[marketsState.stockIndex]" in markets_js
    assert "Binance market-cap heatmap" in markets_js
    assert "buildHeatmap" in markets_js

    file_payload = json.loads((output_dir / "data" / "site-data.json").read_text(encoding="utf-8"))
    assert file_payload["article_count"] >= 2
    assert file_payload["removed_articles_log_path"] == "data/removed-articles.txt"
    assert file_payload["warning_source_count"] == 0
    assert any(hub["key"] == "kr" for hub in file_payload["hubs"])
    assert all(source["source_key"] != "disabled-low-quality" for source in file_payload["sources"])
    assert "thumbnail_url" in file_payload["articles"][0]

    analysis_payload = _read_json(output_dir / "data" / "analysis-dashboard.json")
    assert analysis_payload["default_window"] == "7d"
    assert analysis_payload["windows"]["all"]["article_count"] >= 2
    assert analysis_payload["windows"]["7d"]["kpi_series"]
    assert analysis_payload["windows"]["7d"]["distribution_panels"]
    assert analysis_payload["windows"]["7d"]["trend_panels"]

    markets_status = _read_json(output_dir / "data" / "markets-status.json")
    assert markets_status["providers"]["stocks"]["status"] == "warning"
    assert markets_status["providers"]["korea"]["status"] == "warning"
    assert markets_status["providers"]["crypto"]["status"] == "warning"


def test_build_static_site_marks_empty_telegram_results_as_warning(tmp_path):
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
            source_key="telegram-dada-news2",
            name="Telegram @dada_news2",
            adapter_type="telegram_channel",
            category=None,
            poll_interval_sec=180,
            base_url="https://t.me/dada_news2",
            trust_level=55,
            config={"channel": "dada_news2"},
        ),
    ]

    payload = build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeCryptoAdapter(), "telegram_channel": EmptyTelegramAdapter()},
    )

    telegram_status = _source_status(payload, "telegram-dada-news2")
    assert payload["healthy_source_count"] == 1
    assert payload["warning_source_count"] == 1
    assert payload["failed_source_count"] == 0
    assert telegram_status["status"] == "warning"
    assert telegram_status["fetched_count"] == 0
    assert telegram_status["message"] == (
        "No usable external article links found in the latest 20 messages."
    )

    html = (tmp_path / "site-dist" / "index.html").read_text(encoding="utf-8")
    assert "health-row-warning" in html
    assert "No usable external article links found in the latest 20 messages." in html


def test_build_static_site_marks_empty_telegram_fetch_as_warning(tmp_path):
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
            source_key="telegram-dada-news2",
            name="Telegram @dada_news2",
            adapter_type="telegram_channel",
            category=None,
            poll_interval_sec=180,
            base_url="https://t.me/dada_news2",
            trust_level=55,
            config={"channel": "dada_news2"},
        ),
    ]
    settings = replace(
        _settings(tmp_path),
        telegram_input_enabled=True,
        telegram_api_id="123456",
        telegram_api_hash="hash-value",
        telegram_session_string="session-value",
    )

    payload = build_static_site(
        settings,
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeCryptoAdapter(), "telegram_channel": EmptyTelegramAdapter()},
    )

    telegram_status = _source_status(payload, "telegram-dada-news2")
    assert payload["warning_source_count"] == 1
    assert telegram_status["status"] == "warning"
    assert telegram_status["message"] == (
        "No usable external article links found in the latest 20 messages."
    )


def test_build_static_site_marks_missing_naver_credentials_as_warning(tmp_path):
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
    ]
    settings = replace(
        _settings(tmp_path),
        naver_client_id=None,
        naver_client_secret=None,
    )

    payload = build_static_site(
        settings,
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeCryptoAdapter(), "naver_search": FakeNaverAdapter()},
    )

    naver_status = _source_status(payload, "naver-kr-society")
    assert payload["warning_source_count"] == 1
    assert payload["failed_source_count"] == 0
    assert naver_status["status"] == "warning"
    assert naver_status["fetched_count"] == 0
    assert naver_status["message"] == (
        "NAVER news search not configured: missing "
        "NEWSBOT_NAVER_CLIENT_ID, NEWSBOT_NAVER_CLIENT_SECRET."
    )


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


class OverflowCryptoAdapter:
    async def fetch(self, source_definition, settings, client):
        del settings, client
        return [
            ArticleCandidate(
                source_key=source_definition.source_key,
                source_name=source_definition.name,
                title=f"Overflow crypto story {index:02d}",
                url=f"https://www.coindesk.com/markets/2026/04/03/overflow-{index:02d}/",
                published_at=datetime(2026, 4, 3, 8, index, tzinfo=timezone.utc),
                summary="Large source batch for analysis coverage.",
                language="en",
                trust_level=90,
            )
            for index in range(12)
        ]


class DuplicateAcrossSourcesAdapter:
    async def fetch(self, source_definition, settings, client):
        del settings, client
        return [
            ArticleCandidate(
                source_key=source_definition.source_key,
                source_name=source_definition.name,
                title="Shared headline repeated across sources",
                url="https://example.com/shared-story",
                published_at=datetime(2026, 4, 3, 9, 0, tzinfo=timezone.utc),
                summary="Two sources point to the same canonical story.",
                language="en",
                trust_level=source_definition.trust_level,
            )
        ]


class OldArchiveAdapter:
    async def fetch(self, source_definition, settings, client):
        del source_definition, settings, client
        return [
            ArticleCandidate(
                source_key="coindesk-rss",
                source_name="CoinDesk",
                title="Older cycle story still worth counting",
                url="https://www.coindesk.com/markets/2025/11/20/older-cycle-story/",
                published_at=datetime(2025, 11, 20, 10, 0, tzinfo=timezone.utc),
                summary="Older than the recent detail retention window.",
                language="en",
                trust_level=90,
            )
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
    assert all(article["hub"] == "global" for article in payload["articles"])


def test_build_static_site_logs_evicted_articles_in_text_archive(tmp_path):
    settings = replace(_settings(tmp_path), static_max_total_articles=1)
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
        settings,
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeCryptoAdapter()},
    )

    payload = build_static_site(
        settings,
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": FakeFollowupCryptoAdapter()},
    )

    assert payload["article_count"] == 1
    assert payload["removed_article_count"] == 1
    removed_log = (tmp_path / "site-dist" / "data" / "removed-articles.txt").read_text(
        encoding="utf-8"
    )
    assert "Bitcoin jumps after ETF inflow surprise" in removed_log
    assert "https://www.coindesk.com/markets/2026/03/21/bitcoin-jumps" in removed_log


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


def test_extract_analysis_keywords_filters_noise_and_builds_bigrams():
    keywords = _extract_analysis_keywords(
        "속보 AI 반도체 투자 update",
        ["사진", "반도체"],
    )

    assert "속보" not in keywords
    assert "update" not in keywords
    assert "반도체" in keywords
    assert "투자" in keywords
    assert "ai 반도체" in keywords
    assert len(keywords) <= 6


def test_analysis_dashboard_includes_articles_trimmed_from_news_page_by_source_cap(tmp_path):
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
    settings = replace(_settings(tmp_path), static_max_articles_per_source=2)

    payload = build_static_site(
        settings,
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": OverflowCryptoAdapter()},
    )

    analysis_dashboard = _read_json(tmp_path / "site-dist" / "data" / "analysis-dashboard.json")
    assert payload["article_count"] == 2
    assert analysis_dashboard["windows"]["all"]["article_count"] == 12
    assert analysis_dashboard["windows"]["90d"]["article_count"] == 12


def test_analysis_dashboard_keeps_deduped_away_articles_and_repeated_title_groups(tmp_path):
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
            source_key="cointelegraph-rss",
            name="Cointelegraph",
            adapter_type="rss",
            category="crypto",
            poll_interval_sec=300,
            base_url="https://cointelegraph.com",
            trust_level=85,
        ),
    ]

    payload = build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": DuplicateAcrossSourcesAdapter()},
    )

    analysis_dashboard = _read_json(tmp_path / "site-dist" / "data" / "analysis-dashboard.json")
    assert payload["article_count"] == 1
    assert analysis_dashboard["windows"]["all"]["article_count"] == 2
    assert analysis_dashboard["windows"]["all"]["repeated_title_count"] == 1
    repeated = analysis_dashboard["windows"]["all"]["repeated_titles"][0]
    assert repeated["article_count"] == 2
    assert repeated["source_count"] == 2


def test_analysis_state_does_not_double_count_reharvested_articles(tmp_path):
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
        adapters={"rss": OverflowCryptoAdapter()},
    )
    build_static_site(
        _settings(tmp_path),
        output_dir=tmp_path / "site-dist",
        source_definitions=source_definitions,
        adapters={"rss": OverflowCryptoAdapter()},
    )

    analysis_state = _read_json(tmp_path / "site-dist" / "data" / "analysis-state.json")
    analysis_dashboard = _read_json(tmp_path / "site-dist" / "data" / "analysis-dashboard.json")
    assert analysis_state["lifetime"]["total_articles"] == 12
    assert len(analysis_state["seen_keys"]) == 12
    assert analysis_dashboard["windows"]["all"]["article_count"] == 12


def test_analysis_dashboard_keeps_lifetime_counts_for_old_articles_but_trims_recent_detail(
    tmp_path,
):
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
        adapters={"rss": OldArchiveAdapter()},
    )

    analysis_state = _read_json(tmp_path / "site-dist" / "data" / "analysis-state.json")
    analysis_dashboard = _read_json(tmp_path / "site-dist" / "data" / "analysis-dashboard.json")
    assert analysis_state["lifetime"]["total_articles"] == 1
    assert analysis_state["recent_articles"] == []
    assert analysis_dashboard["windows"]["all"]["article_count"] == 1
    assert analysis_dashboard["windows"]["90d"]["article_count"] == 0


def test_allow_static_candidate_keeps_naver_section_articles_for_naver_source():
    candidate = ArticleCandidate(
        source_key="naver-kr-society",
        source_name="NAVER News Search",
        title="장모 살해 캐리어 유기…20대 부부 구속",
        url="https://n.news.naver.com/mnews/article/277/0005744333",
        summary="사회면 기사",
        language="ko",
        trust_level=70,
    )

    assert _allow_static_candidate(candidate) is True


def test_allow_static_candidate_still_blocks_naver_wrapper_urls_for_other_sources():
    candidate = ArticleCandidate(
        source_key="telegram-dada-news2",
        source_name="Telegram @dada_news2",
        title="장모 살해 캐리어 유기…20대 부부 구속",
        url="https://n.news.naver.com/mnews/article/277/0005744333",
        summary="사회면 기사",
        language="ko",
        trust_level=55,
    )

    assert _allow_static_candidate(candidate) is False
