from __future__ import annotations

from newsbot.markets_builder import _build_crypto_dataset
from newsbot.config import Settings
from newsbot.markets_builder import _build_stocks_dataset
from newsbot.markets_builder import _finalize_crypto_payload
from newsbot.markets_builder import _normalize_coingecko_rows
from newsbot.markets_builder import _finalize_stocks_payload
from newsbot.markets_builder import _parse_finviz_quote_snapshot
from newsbot.markets_builder import _parse_finviz_screener_rows
from newsbot.markets_builder import build_markets_bundle
from newsbot.markets_builder import MarketSnapshotRow


def _settings() -> Settings:
    return Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        static_output_dir="site-dist",
        markets_enabled=True,
        fmp_api_key="test-fmp-key",
        coingecko_api_key=None,
        markets_max_stocks=12,
        markets_max_coins=12,
    )


def _stock_row(symbol: str, *, change_pct: float, market_cap: float, sector: str) -> MarketSnapshotRow:
    return MarketSnapshotRow(
        asset_type="stock",
        symbol=symbol,
        name=symbol,
        exchange="NASDAQ",
        country="US",
        sector_or_category=sector,
        industry="Software",
        last=100.0,
        change_pct=change_pct,
        market_cap=market_cap,
        volume=1_000_000,
        avg_volume=900_000,
        pe=20.0,
        dividend_yield=1.2,
        as_of="2026-04-04T00:00:00+00:00",
        detail_url=f"https://example.com/{symbol}",
        high_52w=101.0,
        low_52w=80.0,
    )


def _crypto_row(symbol: str, *, change_pct: float, market_cap: float) -> MarketSnapshotRow:
    return MarketSnapshotRow(
        asset_type="crypto",
        symbol=symbol,
        name=symbol,
        exchange="CoinGecko",
        country="Global",
        sector_or_category="",
        industry="Crypto",
        last=50.0,
        change_pct=change_pct,
        market_cap=market_cap,
        volume=2_000_000,
        avg_volume=None,
        pe=None,
        dividend_yield=None,
        as_of="2026-04-04T00:00:00+00:00",
        detail_url=f"https://example.com/{symbol}",
        high_52w=60.0,
        low_52w=30.0,
    )


def test_build_markets_bundle_computes_overview_and_news_rail():
    settings = _settings()
    stocks_payload = _finalize_stocks_payload(
        [
            _stock_row("AAPL", change_pct=3.2, market_cap=2_800_000_000_000, sector="Technology"),
            _stock_row("MSFT", change_pct=-1.5, market_cap=2_600_000_000_000, sector="Technology"),
            _stock_row("JPM", change_pct=0.5, market_cap=700_000_000_000, sector="Financial"),
        ],
        [],
        generated_at="2026-04-04T00:00:00+00:00",
        provider="fmp",
        status="ok",
        stale=False,
        message=None,
    )
    crypto_payload = _finalize_crypto_payload(
        [
            _crypto_row("BTC", change_pct=4.1, market_cap=1_300_000_000_000),
            _crypto_row("ETH", change_pct=-2.2, market_cap=400_000_000_000),
            _crypto_row("SOL", change_pct=1.0, market_cap=80_000_000_000),
        ],
        group_performance=[
            {"label": "Layer 1", "market_cap": 500_000_000_000, "change_pct": 2.1, "volume": 100_000_000},
            {"label": "Meme", "market_cap": 80_000_000_000, "change_pct": -1.0, "volume": 20_000_000},
        ],
        heatmap=[
            {"label": "Layer 1", "subLabel": "$500.0B", "change_pct": 2.1, "size": 3, "detail_url": "https://example.com/l1"},
            {"label": "Meme", "subLabel": "$80.0B", "change_pct": -1.0, "size": 1, "detail_url": "https://example.com/meme"},
        ],
        trending=[{"symbol": "BTC", "name": "Bitcoin", "market_cap_rank": 1, "detail_url": "https://example.com/btc"}],
        generated_at="2026-04-04T00:00:00+00:00",
        provider="coingecko",
        status="ok",
        stale=False,
        message=None,
    )

    bundle = build_markets_bundle(
        settings,
        {
            "generated_at": "2026-04-04T00:00:00+00:00",
            "articles": [
                {
                    "title": "US market rally broadens",
                    "source_name": "Reuters",
                    "canonical_url": "https://example.com/news/1",
                    "published_at": "2026-04-04T00:00:00+00:00",
                    "primary_category": "us-markets",
                    "section_label": "Markets",
                },
                {
                    "title": "Bitcoin holds above support",
                    "source_name": "CoinDesk",
                    "canonical_url": "https://example.com/news/2",
                    "published_at": "2026-04-03T23:00:00+00:00",
                    "primary_category": "crypto",
                    "section_label": "Crypto",
                },
                {
                    "title": "Ignore this tech article",
                    "source_name": "TechCrunch",
                    "canonical_url": "https://example.com/news/3",
                    "published_at": "2026-04-03T22:00:00+00:00",
                    "primary_category": "tech-it",
                    "section_label": "Tech",
                },
            ],
        },
        stock_dataset_builder=lambda *_args, **_kwargs: stocks_payload,
        crypto_dataset_builder=lambda *_args, **_kwargs: crypto_payload,
    )

    assert bundle["status"]["overall_status"] == "ok"
    assert bundle["overview"]["top_cards"][0]["value"] == 3
    assert bundle["overview"]["stocks"]["breadth"]["advancers"] == 2
    assert bundle["overview"]["crypto"]["breadth"]["decliners"] == 1
    assert len(bundle["overview"]["market_news"]) == 2


def test_parse_finviz_screener_rows_extracts_market_fields():
    html = """
    <table>
      <tr class="styled-row is-bordered is-rounded is-hoverable is-striped has-color-text" valign="top">
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">1</a></td>
        <td height="10" align="left" data-boxover-ticker="AAPL"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" class="tab-link">AAPL</a></td>
        <td height="10" align="left"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">Apple Inc</a></td>
        <td height="10" align="left"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">Technology</a></td>
        <td height="10" align="left"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">Consumer Electronics</a></td>
        <td height="10" align="left"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">USA</a></td>
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">3.75T</a></td>
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">32.38</a></td>
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" "><span class="color-text is-positive">255.92</span></a></td>
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" "><span class="color-text is-negative">-0.74%</span></a></td>
        <td height="10" align="right"><a href="quote.ashx?t=AAPL&ty=c&p=d&b=1" ">57,416,203</a></td>
      </tr>
    </table>
    """

    rows = _parse_finviz_screener_rows(
        html,
        generated_at="2026-04-04T00:00:00+00:00",
    )

    assert len(rows) == 1
    row = rows[0]
    assert row.symbol == "AAPL"
    assert row.name == "Apple Inc"
    assert row.sector_or_category == "Technology"
    assert row.industry == "Consumer Electronics"
    assert row.market_cap == 3_750_000_000_000
    assert row.pe == 32.38
    assert row.last == 255.92
    assert row.change_pct == -0.74
    assert row.volume == 57_416_203


def test_parse_finviz_quote_snapshot_extracts_label_pairs():
    html = """
    <table class="snapshot-table2 screener_snapshot-table-body">
      <tr class="table-dark-row">
        <td class="snapshot-td2 cursor-pointer w-[7%]" align="left">P/E</td>
        <td class="snapshot-td2 w-[8%]" align="left"><b>32.38</b></td>
        <td class="snapshot-td2 cursor-pointer w-[7%]" align="left">Price</td>
        <td class="snapshot-td2 w-[8%]" align="left"><b>255.92</b></td>
        <td class="snapshot-td2 cursor-pointer w-[7%]" align="left">Change</td>
        <td class="snapshot-td2 w-[8%]" align="left"><b><span class="color-text is-negative">-0.74%</span></b></td>
      </tr>
    </table>
    """

    snapshot = _parse_finviz_quote_snapshot(html)

    assert snapshot["P/E"] == "32.38"
    assert snapshot["Price"] == "255.92"
    assert snapshot["Change"] == "-0.74%"


def test_build_stocks_dataset_uses_public_finviz_fallback_when_key_missing():
    settings = Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        static_output_dir="site-dist",
        markets_enabled=True,
        fmp_api_key=None,
    )

    def fake_finviz_builder(_settings, *, generated_at, archive_data, note):
        assert archive_data is None
        return _finalize_stocks_payload(
            [
                _stock_row(
                    "AAPL",
                    change_pct=2.4,
                    market_cap=3_000_000_000_000,
                    sector="Technology",
                )
            ],
            [],
            generated_at=generated_at,
            provider="finviz-public",
            status="ok",
            stale=False,
            message=note,
        )

    payload = _build_stocks_dataset(
        settings,
        generated_at="2026-04-04T00:00:00+00:00",
        archive_data=None,
        finviz_dataset_builder=fake_finviz_builder,
    )

    assert payload["status"] == "ok"
    assert payload["provider"] == "finviz-public"
    assert payload["row_count"] == 1
    assert "NEWSBOT_FMP_API_KEY" in payload["message"]


def test_normalize_coingecko_rows_uses_24h_high_low_not_ath_atl():
    rows = _normalize_coingecko_rows(
        [
            {
                "id": "pepe",
                "symbol": "pepe",
                "name": "Pepe",
                "current_price": 0.00000712,
                "price_change_percentage_24h": 3.21,
                "market_cap": 3_000_000_000,
                "total_volume": 800_000_000,
                "last_updated": "2026-04-04T00:00:00.000Z",
                "high_24h": 0.0000075,
                "low_24h": 0.0000068,
                "ath": 0.00002,
                "atl": 0.0000001,
            }
        ]
    )

    assert len(rows) == 1
    assert rows[0].high_52w == 0.0000075
    assert rows[0].low_52w == 0.0000068


def test_build_crypto_dataset_keeps_rows_when_aux_calls_fail():
    settings = Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        static_output_dir="site-dist",
        markets_enabled=True,
        coingecko_api_key=None,
    )

    payload = _build_crypto_dataset(
        settings,
        generated_at="2026-04-04T00:00:00+00:00",
        archive_data={
            "group_performance": [{"label": "Archived", "market_cap": 100.0, "change_pct": 1.0, "volume": 10.0}],
            "heatmap": [{"label": "Archived", "subLabel": "$100", "change_pct": 1.0, "size": 1, "detail_url": "https://example.com/arch"}],
            "trending": [{"symbol": "ARCH", "name": "Archived Coin", "market_cap_rank": 999, "detail_url": "https://example.com/arch"}],
        },
        market_rows_fetcher=lambda *_args, **_kwargs: [
            {
                "id": "bitcoin",
                "symbol": "btc",
                "name": "Bitcoin",
                "current_price": 68000,
                "price_change_percentage_24h": 2.5,
                "market_cap": 1_300_000_000_000,
                "total_volume": 25_000_000_000,
                "last_updated": "2026-04-04T00:00:00.000Z",
                "high_24h": 69000,
                "low_24h": 66000,
            }
        ],
        categories_fetcher=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("categories blocked")),
        trending_fetcher=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("trending blocked")),
    )

    assert payload["status"] == "ok"
    assert payload["stale"] is False
    assert payload["row_count"] == 1
    assert payload["group_performance"][0]["label"] == "Archived"
    assert payload["trending"][0]["symbol"] == "ARCH"
    assert "categories blocked" in payload["message"]
    assert "trending blocked" in payload["message"]


def test_build_stocks_dataset_reuses_archive_when_fallback_fails():
    archived_row = _stock_row(
        "ARCH",
        change_pct=1.0,
        market_cap=12_000_000_000,
        sector="Technology",
    ).to_public_dict()
    archive_payload = {
        "generated_at": "2026-04-03T00:00:00+00:00",
        "asset_type": "stock",
        "provider": "fmp",
        "status": "ok",
        "stale": False,
        "message": None,
        "as_of": "2026-04-03T00:00:00+00:00",
        "row_count": 1,
        "presets": [],
        "filter_options": {"exchanges": ["NASDAQ"], "sectors": ["Technology"], "industries": ["Software"]},
        "rows": [archived_row],
        "benchmarks": [],
        "breadth": {"advancers": 1, "decliners": 0, "unchanged": 0, "new_highs": 0, "new_lows": 0},
        "movers": {"gainers": [], "losers": [], "active": []},
        "group_performance": [],
        "heatmap": [],
    }
    settings = Settings(
        bootstrap_on_startup=False,
        enable_scheduler=False,
        telegram_input_enabled=False,
        static_output_dir="site-dist",
        markets_enabled=True,
        fmp_api_key=None,
    )

    payload = _build_stocks_dataset(
        settings,
        generated_at="2026-04-04T00:00:00+00:00",
        archive_data=archive_payload,
        finviz_dataset_builder=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("blocked")
        ),
    )

    assert payload["status"] == "warning"
    assert payload["stale"] is True
    assert payload["row_count"] == 1
    assert "NEWSBOT_FMP_API_KEY" in payload["message"]
    assert "blocked" in payload["message"]
