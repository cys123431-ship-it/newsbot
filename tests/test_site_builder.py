from __future__ import annotations

import json
import asyncio
from dataclasses import replace
from datetime import datetime
from datetime import timezone
from pathlib import Path

import pytest

from newsbot.config import Settings
from newsbot.contracts import ArticleCandidate
from newsbot.site_builder import StaticArticle
from newsbot.site_builder import _allow_static_candidate
from newsbot.site_builder import _extract_analysis_keywords
from newsbot.site_builder import collect_site_payload
from newsbot.site_builder import build_static_site
from newsbot.site_builder import validate_site_output
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
                title="?? ??? ?? ?? ?? ??",
                url="https://www.yna.co.kr/view/AKR20260321000100004",
                published_at=datetime(2026, 3, 21, 9, 0, tzinfo=timezone.utc),
                summary="??? ?? ??? ????.",
                language="ko",
                tags=["?? ??"],
                trust_level=70,
            ),
            ArticleCandidate(
                source_key="naver-kr-society",
                source_name="NAVER News Search",
                title="??, ?? ?? ?? ?? ??",
                url="https://www.yna.co.kr/view/AKR20260321000100005",
                published_at=datetime(2026, 3, 21, 8, 0, tzinfo=timezone.utc),
                summary="??? ??? ????.",
                language="ko",
                tags=["?? ??"],
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


def test_collect_site_payload_cleans_archive_titles_and_filters_blocked_sources(tmp_path):
    archive_articles = [
        StaticArticle.from_public_dict(
            {
                "title": '?? ?? ???? ??? &quot;?? ??&quot;',
                "canonical_url": "https://example.com/visible",
                "source_key": "coindesk-rss",
                "source_name": "CoinDesk",
                "thumbnail_url": "https://img.example.com/thumb.jpg?x=1&amp;y=2",
                "primary_category": "crypto",
                "published_at": "2026-04-05T10:00:00+00:00",
                "trust_level": 90,
                "language": "ko",
            }
        ),
        StaticArticle.from_public_dict(
            {
                "title": "???? ???? ??",
                "canonical_url": "https://example.com/pressian-hidden",
                "source_key": "pressian-politics-rss",
                "source_name": "Pressian Politics",
                "primary_category": "kr-politics",
                "published_at": "2026-04-05T10:01:00+00:00",
                "trust_level": 80,
                "language": "ko",
            }
        ),
    ]

    payload, _, _ = asyncio.run(
        collect_site_payload(
            _settings(tmp_path),
            archive_articles=archive_articles,
            source_definitions=[],
            adapters={},
        )
    )

    assert [article["source_key"] for article in payload["articles"]] == ["coindesk-rss"]
    assert payload["articles"][0]["title"] == '?? ?? ???? ??? "?? ??"'
    assert payload["articles"][0]["thumbnail_url"] == "https://img.example.com/thumb.jpg?x=1&y=2"


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
    validate_site_output(output_dir)
    assert (output_dir / "index.html").exists()
    assert not (output_dir / "analysis" / "index.html").exists()
    assert (output_dir / "markets" / "index.html").exists()
    assert (output_dir / "markets" / "us" / "index.html").exists()
    assert (output_dir / "markets" / "korea" / "index.html").exists()
    assert (output_dir / "markets" / "crypto" / "index.html").exists()
    assert (output_dir / "assets" / "style.css").exists()
    assert (output_dir / "assets" / "crypto-live-worker.js").exists()
    assert (output_dir / "data" / "site-data.json").exists()
    assert (output_dir / "data" / "analysis-state.json").exists()
    assert (output_dir / "data" / "analysis-dashboard.json").exists()
    assert (output_dir / "data" / "markets-overview.json").exists()
    assert (output_dir / "data" / "markets-stocks.json").exists()
    assert (output_dir / "data" / "markets-korea.json").exists()
    assert (output_dir / "data" / "markets-crypto.json").exists()
    assert (output_dir / "data" / "markets-status.json").exists()
    assert (output_dir / "data" / "scanner" / "manifest.json").exists()
    assert (output_dir / "generated" / "scanner").exists()
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
    assert 'featured-story-thumb' in html
    assert 'class="story-actions"' in html
    assert 'class="hub-tab-rail"' in html
    assert 'class="section-tab-rail"' in html
    assert 'class="filter-grid"' in html
    assert 'class="news-timestamp"' in html
    assert 'class="news-control-deck"' in html
    assert 'class="news-desktop-lead"' in html
    assert 'class="headline-stack"' in html
    assert 'class="news-side-rail"' in html
    assert 'href="analysis/"' not in html
    assert 'href="markets/crypto/"' in html
    assert 'href="markets/us/"' not in html
    assert 'href="markets/korea/"' not in html

    markets_alias_html = (output_dir / "markets" / "index.html").read_text(encoding="utf-8")
    assert 'id="crypto-app"' in markets_alias_html
    assert 'id="crypto-universe-select"' in markets_alias_html
    assert 'id="crypto-timeframe-select"' in markets_alias_html
    assert 'id="crypto-refresh-button"' in markets_alias_html
    assert 'id="crypto-page-tabs"' in markets_alias_html
    assert 'id="crypto-page-content"' in markets_alias_html
    assert '"initial_surface":"crypto"' in markets_alias_html
    assert '"crypto_page_key":"overview"' in markets_alias_html
    assert '"scanner_manifest_url":"' in markets_alias_html
    assert "../assets/markets.js" in markets_alias_html
    assert '????' not in markets_alias_html
    assert '????' not in markets_alias_html

    us_markets_html = (output_dir / "markets" / "us" / "index.html").read_text(encoding="utf-8")
    assert 'http-equiv="refresh"' in us_markets_html
    assert '../crypto/' in us_markets_html

    korea_markets_html = (output_dir / "markets" / "korea" / "index.html").read_text(encoding="utf-8")
    assert 'http-equiv="refresh"' in korea_markets_html
    assert '../crypto/' in korea_markets_html

    crypto_markets_html = (output_dir / "markets" / "crypto" / "index.html").read_text(encoding="utf-8")
    assert 'id="crypto-app"' in crypto_markets_html
    assert 'id="crypto-universe-select"' in crypto_markets_html
    assert 'id="crypto-timeframe-select"' in crypto_markets_html
    assert 'id="crypto-refresh-button"' in crypto_markets_html
    assert 'id="crypto-page-tabs"' in crypto_markets_html
    assert 'id="crypto-page-controls"' in crypto_markets_html
    assert 'id="crypto-page-content"' in crypto_markets_html
    assert 'id="crypto-theme-toggle"' in crypto_markets_html
    assert '"initial_surface":"crypto"' in crypto_markets_html
    assert '"crypto_page_key":"overview"' in crypto_markets_html
    assert '"crypto_page_links":' in crypto_markets_html
    assert '"scanner_manifest_url":"' in crypto_markets_html
    assert '"site_root_prefix":"../../"' in crypto_markets_html
    assert "../../assets/markets.js" in crypto_markets_html
    assert "echarts.min.js" not in crypto_markets_html
    assert '>News<' in crypto_markets_html
    assert '>Coin<' in crypto_markets_html
    assert '>Analysis<' not in crypto_markets_html
    assert 'href="../us/"' not in crypto_markets_html
    assert 'href="../korea/"' not in crypto_markets_html

    for slug, key in (
        ("signals", "signals"),
        ("derivatives", "derivatives"),
        ("movers", "movers"),
        ("patterns", "patterns"),
        ("opportunities", "opportunities"),
        ("setups", "setups"),
        ("technical-ratings", "technical_ratings"),
        ("trend", "trend"),
        ("momentum", "momentum"),
        ("volatility", "volatility"),
        ("multi-timeframe", "multi_timeframe"),
    ):
        nested_html = (output_dir / "markets" / "crypto" / slug / "index.html").read_text(encoding="utf-8")
        assert f'"crypto_page_key":"{key}"' in nested_html
        assert 'id="crypto-page-content"' in nested_html
        assert '../../../assets/markets.js' in nested_html

    markets_js = (output_dir / "assets" / "markets.js").read_text(encoding="utf-8")
    assert "crypto-live-worker.js" in crypto_markets_html
    assert "ensureWorker" in markets_js
    assert "loadLivePayload" in markets_js
    assert "loadFallbackPayload" in markets_js
    assert "resolveRootManifestUrl" in markets_js
    assert 'const ROOT_FALLBACK_MANIFEST_PATH = "data/scanner/manifest.json";' in markets_js
    assert "renderSignals" in markets_js
    assert "renderDerivatives" in markets_js
    assert "renderMovers" in markets_js
    assert "renderMultiTimeframe" in markets_js
    assert "Live fetch failed" in markets_js

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

    scanner_manifest = _read_json(output_dir / "data" / "scanner" / "manifest.json")
    assert scanner_manifest["snapshots"]
    for page_key in (
        "overview",
        "signals",
        "derivatives",
        "movers",
        "patterns",
        "opportunities",
        "setups",
        "technical_ratings",
        "trend",
        "momentum",
        "volatility",
        "multi_timeframe",
    ):
        assert scanner_manifest["page_data"][page_key]["top100"]["5m"]
    assert scanner_manifest["page_data"]["patterns"]["top100"]["5m"].startswith("scan-top100-")
    assert any(page["key"] == "technical_ratings" for page in scanner_manifest["crypto_pages"])
    first_snapshot_path = (
        output_dir / "data" / "scanner" / scanner_manifest["snapshots"][0]["path"]
    )
    first_snapshot = _read_json(first_snapshot_path)
    assert first_snapshot["results"]
    first_result = first_snapshot["results"][0]
    assert first_result["preview_image"]
    assert first_result["detail_page"]
    assert first_result["detail_page"].startswith("crypto/setups/")
    detail_html_path = output_dir / "markets" / first_result["detail_page"] / "index.html"
    assert detail_html_path.exists()
    detail_html = detail_html_path.read_text(encoding="utf-8")
    assert 'id="crypto-detail-theme-toggle"' in detail_html
    legacy_detail_html_path = output_dir / "markets" / first_result["legacy_detail_page"] / "index.html"
    assert legacy_detail_html_path.exists()
    detail_json_path = output_dir / "data" / "scanner" / first_result["detail_data_path"]
    assert detail_json_path.exists()


def test_build_static_site_fails_when_scanner_manifest_is_missing(tmp_path, monkeypatch):
    empty_scanner_dir = tmp_path / "scanner-empty"
    empty_scanner_dir.mkdir()
    monkeypatch.setattr("newsbot.site_builder.PUBLIC_SCANNER_DATA_DIR", empty_scanner_dir)
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

    with pytest.raises(FileNotFoundError):
        build_static_site(
            _settings(tmp_path),
            output_dir=tmp_path / "site-dist",
            source_definitions=source_definitions,
            adapters=adapters,
        )


def test_allow_static_candidate_blocks_pressian_urls():
    candidate = ArticleCandidate(
        source_key="naver-kr-politics",
        source_name="NAVER News Search",
        title="Government policy update after cabinet meeting",
        url="https://www.pressian.com/pages/articles/2026040512455461732",
    )

    assert _allow_static_candidate(candidate) is False


def test_static_article_from_public_dict_unescapes_html_entities():
    article = StaticArticle.from_public_dict(
        {
            "title": '??? &quot;???&quot; ???? ?? ??&hellip;',
            "canonical_url": "https://example.com/story",
            "source_key": "example",
            "source_name": "Example News",
            "primary_category": "kr-politics",
            "published_at": "2026-04-05T11:31:00+00:00",
            "trust_level": 80,
            "language": "ko",
        }
    )

    assert "&quot;" not in article.title
    assert "&hellip;" not in article.title


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
        "?? AI ??? ?? update",
        ["??", "???"],
    )

    assert "??" not in keywords
    assert "update" not in keywords
    assert "???" in keywords
    assert "??" in keywords
    assert "ai ???" in keywords
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
        title="?? ?? ??? ???20? ?? ??",
        url="https://n.news.naver.com/mnews/article/277/0005744333",
        summary="??? ??",
        language="ko",
        trust_level=70,
    )

    assert _allow_static_candidate(candidate) is True


def test_allow_static_candidate_still_blocks_naver_wrapper_urls_for_other_sources():
    candidate = ArticleCandidate(
        source_key="telegram-dada-news2",
        source_name="Telegram @dada_news2",
        title="?? ?? ??? ???20? ?? ??",
        url="https://n.news.naver.com/mnews/article/277/0005744333",
        summary="??? ??",
        language="ko",
        trust_level=55,
    )

    assert _allow_static_candidate(candidate) is False


def test_vercel_config_targets_static_site_output():
    vercel_config = json.loads(
        (Path(__file__).resolve().parents[1] / "vercel.json").read_text(encoding="utf-8")
    )
    requirements_text = (
        (Path(__file__).resolve().parents[1] / "requirements.txt").read_text(encoding="utf-8")
    )
    vercel_build_script = (
        (Path(__file__).resolve().parents[1] / "scripts" / "vercel_build.py").read_text(encoding="utf-8")
    )

    assert vercel_config["outputDirectory"] == "site-dist"
    assert vercel_config["buildCommand"] == "python scripts/vercel_build.py"
    assert "installCommand" not in vercel_config
    assert any(header["source"] == "/data/(.*)" for header in vercel_config["headers"])
    assert "jinja2>=" in requirements_text
    assert "sys.path.insert" in vercel_build_script
