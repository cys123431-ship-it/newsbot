from __future__ import annotations

from pathlib import Path

from newsbot.scanner.engine import build_symbol_analysis
from newsbot.scanner.engine import build_fallback_snapshot
from newsbot.scanner.engine import build_manifest
from newsbot.scanner.engine import find_pivots
from newsbot.scanner.engine import generate_preview_svg


def _sample_candles() -> list[dict[str, float | str]]:
    values = [
        100.0,
        101.5,
        103.0,
        101.0,
        98.5,
        96.0,
        98.2,
        100.6,
        99.1,
        97.4,
        99.0,
        101.0,
        98.7,
        96.8,
        95.6,
        97.0,
        98.8,
    ]
    candles = []
    for index, close in enumerate(values):
        open_price = values[index - 1] if index else close - 0.4
        candles.append(
            {
                "timestamp": f"2026-04-05T00:{index:02d}:00+00:00",
                "open": open_price,
                "high": max(open_price, close) + 0.6,
                "low": min(open_price, close) - 0.6,
                "close": close,
                "volume": 1000 + (index * 20),
            }
        )
    return candles


def test_find_pivots_extracts_alternating_extremes():
    pivots = find_pivots(_sample_candles(), left=1, right=1)

    assert len(pivots) >= 5
    assert {pivot.kind for pivot in pivots}.issubset({"H", "L"})


def test_build_manifest_collects_snapshot_metadata():
    snapshots = [
        build_fallback_snapshot(
            timeframe="5m",
            generated_at="2026-04-05T12:00:00+00:00",
            failures=[{"scope": "klines", "message": "timeout"}],
        ),
        build_fallback_snapshot(timeframe="1h", generated_at="2026-04-05T12:00:00+00:00"),
    ]

    manifest = build_manifest(
        snapshots,
        page_data={
            "overview": {"top100": {"5m": "overview-top100-5m.json"}},
            "patterns": {"top100": {"5m": "scan-top100-5m.json"}},
        },
    )

    assert manifest["total_results"] >= 4
    assert manifest["snapshots"][0]["path"].startswith("scan-top100-")
    assert manifest["symbols_scanned"] == 100
    assert manifest["page_data"]["overview"]["top100"]["5m"] == "overview-top100-5m.json"
    assert manifest["page_data"]["patterns"]["top100"]["5m"] == "scan-top100-5m.json"
    assert any(page["key"] == "technical_ratings" for page in manifest["crypto_pages"])
    assert snapshots[0]["failures"][0]["scope"] == "klines"


def test_build_symbol_analysis_exposes_scores_and_labels():
    analysis = build_symbol_analysis(
        symbol="SOLUSDT",
        timeframe="5m",
        candles=_sample_candles() * 20,
        ticker={"change_24h": 4.25, "quote_volume": 123456789, "last_price": 101.5},
        funding_rate=0.0112,
        open_interest_usd=450_000_000,
        long_short_ratio=1.17,
        pattern_result=build_fallback_snapshot(timeframe="5m", generated_at="2026-04-05T12:00:00+00:00")["results"][0],
    )

    assert analysis["symbol"] == "SOLUSDT"
    assert "technical" in analysis["scores"]
    assert "trend_bias" in analysis["labels"]
    assert "rsi14" in analysis["indicators"]
    assert analysis["pattern"]["detail_page"].startswith("crypto/setups/")
    assert analysis["pattern"]["detail_data_path"].startswith("setups/")


def test_generate_preview_svg_writes_chart_image(tmp_path: Path):
    snapshot = build_fallback_snapshot(timeframe="5m", generated_at="2026-04-05T12:00:00+00:00")
    result = snapshot["results"][0]
    output_path = tmp_path / "preview.svg"

    generate_preview_svg(result=result, candles=_sample_candles() * 5, output_path=output_path)

    assert output_path.exists()
    assert "<svg" in output_path.read_text(encoding="utf-8")
