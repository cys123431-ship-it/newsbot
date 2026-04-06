from __future__ import annotations

import importlib.util
from pathlib import Path

from newsbot.scanner.engine import build_fallback_snapshot


def _load_update_data_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "update_data.py"
    spec = importlib.util.spec_from_file_location("newsbot_update_data_test", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fallback_analyses_populate_non_pattern_pages():
    update_data = _load_update_data_module()
    generated_at = "2026-04-06T10:22:35+00:00"
    snapshots = {
        timeframe: build_fallback_snapshot(timeframe=timeframe, generated_at=generated_at)
        for timeframe in ("5m", "15m", "1h", "4h")
    }
    analyses_by_timeframe = {
        timeframe: update_data._build_fallback_analyses(
            timeframe=timeframe,
            generated_at=generated_at,
            snapshot=snapshot,
            symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
            ticker_lookup={},
            premium_lookup={},
            symbol_contexts={},
        )
        for timeframe, snapshot in snapshots.items()
    }

    assert len(analyses_by_timeframe["5m"]) == 4
    assert any(row["symbol"] == "SOLUSDT" and row["pattern"] for row in analyses_by_timeframe["5m"])
    assert all(row["data_origin"] == "fallback_synthetic" for row in analyses_by_timeframe["5m"])

    page_data, page_payloads, detail_payloads = update_data._build_page_payloads(
        generated_at=generated_at,
        universe_key="top100",
        snapshots=snapshots,
        analyses_by_timeframe=analyses_by_timeframe,
    )

    assert page_data["signals"]["top100"]["5m"] == "signals-top100-5m.json"
    assert len(page_payloads["signals-top100-5m.json"]["rows"]) == 4
    assert len(page_payloads["opportunities-top100-5m.json"]["rows"]) >= 1
    assert len(page_payloads["overview-top100-5m.json"]["top_opportunities"]) >= 1
    assert detail_payloads["setups/scan-top100-5m/solusdt-gartley-touch.json"]["result"]["symbol"] == "SOLUSDT"
