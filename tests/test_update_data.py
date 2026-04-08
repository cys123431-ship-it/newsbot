from __future__ import annotations

import importlib.util
import json
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
            symbols=["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "DOGEUSDT"],
            ticker_lookup={},
            premium_lookup={},
            symbol_contexts={},
        )
        for timeframe, snapshot in snapshots.items()
    }

    assert len(analyses_by_timeframe["5m"]) == 6
    assert any(row["symbol"] == "SOLUSDT" and row["pattern"] for row in analyses_by_timeframe["5m"])
    assert all(row["data_origin"] == "fallback_synthetic" for row in analyses_by_timeframe["5m"])
    assert any(row["side"] == "long" for row in analyses_by_timeframe["5m"])
    assert any(row["side"] == "short" for row in analyses_by_timeframe["5m"])

    page_data, page_payloads, detail_payloads = update_data._build_page_payloads(
        generated_at=generated_at,
        universe_key="top100",
        snapshots=snapshots,
        analyses_by_timeframe=analyses_by_timeframe,
    )

    assert page_data["signals"]["top100"]["5m"] == "signals-top100-5m.json"
    assert page_data["derivatives"]["top100"]["5m"] == "derivatives-top100-5m.json"
    assert page_data["movers"]["top100"]["5m"] == "movers-top100-5m.json"
    assert len(page_payloads["signals-top100-5m.json"]["rows"]) == 6
    assert len(page_payloads["derivatives-top100-5m.json"]["rows"]) == 6
    assert len(page_payloads["movers-top100-5m.json"]["rows"]) == 6
    assert len(page_payloads["opportunities-top100-5m.json"]["rows"]) >= 1
    assert len(page_payloads["overview-top100-5m.json"]["top_opportunities"]) >= 1
    assert len(page_payloads["overview-top100-5m.json"]["top_signals"]) >= 1
    assert page_payloads["overview-top100-5m.json"]["strong_recommendations"]["5m"]["long"]["side"] == "long"
    assert page_payloads["overview-top100-5m.json"]["strong_recommendations"]["5m"]["short"]["side"] == "short"
    assert page_payloads["overview-top100-5m.json"]["strong_recommendations"]["5m"]["long"]["symbol"]
    assert page_payloads["overview-top100-5m.json"]["strong_recommendations"]["5m"]["short"]["symbol"]
    mtf_rows = page_payloads["multi-timeframe-top100-5m.json"]["rows"]
    assert mtf_rows
    assert "side" in mtf_rows[0]["timeframes"]["5m"]
    assert mtf_rows[0]["consensus_label"] in {"상승 합의", "하락 합의", "혼합"}
    assert detail_payloads["setups/scan-top100-5m/solusdt-gartley-touch.json"]["result"]["symbol"] == "SOLUSDT"


def test_write_json_preserves_generated_at_for_unchanged_detail_payload(tmp_path):
    update_data = _load_update_data_module()
    target = tmp_path / "setups" / "scan-top100-5m" / "solusdt-gartley-touch.json"
    payload = {
        "generated_at": "2026-04-06T10:00:00+00:00",
        "scan_id": "scan-top100-5m",
        "result": {"symbol": "SOLUSDT", "pattern": "Gartley"},
        "analysis": {"score": 77.2},
        "related_timeframes": {"5m": {"opportunity": 81.4}},
    }
    assert update_data._write_json(target, payload, preserve_generated_at_when_unchanged=True) is True

    second_payload = {
        **payload,
        "generated_at": "2026-04-06T10:05:00+00:00",
    }
    assert update_data._write_json(
        target,
        second_payload,
        preserve_generated_at_when_unchanged=True,
    ) is False

    stored = json.loads(target.read_text(encoding="utf-8"))
    assert stored["generated_at"] == "2026-04-06T10:00:00+00:00"


def test_decorate_results_reuses_existing_preview_for_unchanged_pattern(tmp_path, monkeypatch):
    update_data = _load_update_data_module()
    monkeypatch.setattr(update_data, "PUBLIC_GENERATED_DIR", tmp_path)

    result = {
        "symbol": "SOLUSDT",
        "timeframe": "5m",
        "pattern": "Gartley",
        "status": "touch",
        "side": "bullish",
        "score": 77.2,
        "summary": "Bullish Gartley",
        "side_label": "Bullish",
        "status_label": "실시간 터치",
        "points": {"X": {"price": 79.92}, "A": {"price": 80.54}, "B": {"price": 80.15}, "C": {"price": 80.42}, "D": {"price": 80.06}},
        "ratios": {"xab": 0.629, "abc": 0.692, "bcd": 1.333, "xad": 0.774},
        "prz": {"lower": 79.98, "upper": 80.03},
        "targets": {"tp1": 80.3, "tp2": 80.9},
        "stop": {"value": 79.4},
        "change_24h": 2.57,
        "detail_page": "crypto/setups/scan-top100-5m/solusdt-gartley-touch/",
        "detail_data_path": "setups/scan-top100-5m/solusdt-gartley-touch.json",
        "legacy_detail_page": "patterns/5m/solusdt-gartley-touch/",
    }
    snapshot = {"scan_id": "scan-top100-5m", "results": [dict(result)]}
    preview_path = tmp_path / "scan-top100-5m" / "solusdt-gartley-touch.svg"
    preview_path.parent.mkdir(parents=True, exist_ok=True)
    preview_path.write_text("<svg />", encoding="utf-8")
    existing_snapshot = {
        "scan_id": "scan-top100-5m",
        "results": [{**result, "preview_image": "generated/scanner/scan-top100-5m/solusdt-gartley-touch.svg"}],
    }

    calls: list[Path] = []

    def _fake_generate_preview_svg(*, result, candles, output_path):
        calls.append(output_path)

    monkeypatch.setattr(update_data, "generate_preview_svg", _fake_generate_preview_svg)
    expected_generated_paths: set[Path] = set()

    update_data._decorate_results(
        snapshot=snapshot,
        candles_by_symbol={},
        existing_snapshot=existing_snapshot,
        expected_generated_paths=expected_generated_paths,
    )

    assert snapshot["results"][0]["preview_image"] == "generated/scanner/scan-top100-5m/solusdt-gartley-touch.svg"
    assert expected_generated_paths == {preview_path}
    assert calls == []
