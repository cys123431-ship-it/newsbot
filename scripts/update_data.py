from __future__ import annotations

import asyncio
from datetime import datetime
from datetime import timedelta
from datetime import timezone
from hashlib import sha1
import json
import math
from pathlib import Path
import shutil
import sys
from typing import Any

import httpx


ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from newsbot.scanner import CRYPTO_PAGE_DEFINITIONS
from newsbot.scanner import FALLBACK_SYMBOLS
from newsbot.scanner import SCANNER_STATUS_ORDER
from newsbot.scanner import TIMEFRAME_LABELS
from newsbot.scanner import UNIVERSE_PRESETS
from newsbot.scanner import build_fallback_snapshot
from newsbot.scanner import build_manifest
from newsbot.scanner import build_snapshot
from newsbot.scanner import build_symbol_analysis
from newsbot.scanner import detect_pattern_match
from newsbot.scanner import generate_preview_svg


BASE_URL = "https://fapi.binance.com"
PUBLIC_DATA_DIR = ROOT_DIR / "public" / "data" / "scanner"
PUBLIC_GENERATED_DIR = ROOT_DIR / "public" / "generated" / "scanner"
UNIVERSE_KEY = "top100"
TIMEFRAMES = ("5m", "15m", "1h", "4h")
REQUEST_TIMEOUT = 20.0
REQUEST_CONCURRENCY = 8
KLINE_LIMIT = 220
TIMEFRAME_MINUTES = {"5m": 5, "15m": 15, "1h": 60, "4h": 240}
FALLBACK_SYMBOL_BASELINES: dict[str, dict[str, float]] = {
    "BTCUSDT": {"last_price": 68320.0, "quote_volume": 9_450_000_000.0, "open_interest_usd": 3_850_000_000.0},
    "ETHUSDT": {"last_price": 3315.0, "quote_volume": 4_280_000_000.0, "open_interest_usd": 1_920_000_000.0},
    "SOLUSDT": {"last_price": 80.06, "quote_volume": 1_280_000_000.0, "open_interest_usd": 987_000_000.0},
    "XRPUSDT": {"last_price": 0.642, "quote_volume": 1_140_000_000.0, "open_interest_usd": 602_000_000.0},
    "BNBUSDT": {"last_price": 587.2, "quote_volume": 734_000_000.0, "open_interest_usd": 511_000_000.0},
    "ADAUSDT": {"last_price": 0.714, "quote_volume": 598_000_000.0, "open_interest_usd": 318_000_000.0},
    "DOGEUSDT": {"last_price": 0.1834, "quote_volume": 836_000_000.0, "open_interest_usd": 402_000_000.0},
    "SUIUSDT": {"last_price": 1.64, "quote_volume": 326_000_000.0, "open_interest_usd": 145_000_000.0},
    "LINKUSDT": {"last_price": 18.28, "quote_volume": 281_000_000.0, "open_interest_usd": 176_000_000.0},
    "AVAXUSDT": {"last_price": 38.14, "quote_volume": 254_000_000.0, "open_interest_usd": 164_000_000.0},
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric != numeric:
        return fallback
    return numeric


def _slugify(value: str) -> str:
    text = []
    for character in value.lower():
        if character.isalnum():
            text.append(character)
        elif text and text[-1] != "-":
            text.append("-")
    return "".join(text).strip("-") or "item"


def _page_filename(page_key: str, *, universe_key: str, timeframe: str) -> str:
    return f"{page_key.replace('_', '-')}-{universe_key}-{timeframe}.json"


def _parse_iso_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = datetime.now(timezone.utc)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _stable_seed(*parts: str) -> int:
    digest = sha1("|".join(parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


async def _fetch_json(
    client: httpx.AsyncClient,
    path: str,
    *,
    params: dict[str, Any] | None = None,
) -> Any:
    response = await client.get(path, params=params)
    response.raise_for_status()
    return response.json()


def _normalize_ticker_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "symbol": str(row.get("symbol") or "").upper(),
        "last_price": _safe_float(row.get("lastPrice")),
        "change_24h": _safe_float(row.get("priceChangePercent")),
        "quote_volume": _safe_float(row.get("quoteVolume")),
    }


async def _load_universe(
    client: httpx.AsyncClient,
) -> tuple[list[str], dict[str, dict[str, Any]], dict[str, float]]:
    exchange_info, ticker_rows, premium_rows = await asyncio.gather(
        _fetch_json(client, "/fapi/v1/exchangeInfo"),
        _fetch_json(client, "/fapi/v1/ticker/24hr"),
        _fetch_json(client, "/fapi/v1/premiumIndex"),
    )

    tradable = {
        str(item.get("symbol") or "").upper()
        for item in exchange_info.get("symbols", [])
        if item.get("status") == "TRADING"
        and item.get("contractType") == "PERPETUAL"
        and item.get("quoteAsset") == "USDT"
    }

    ticker_lookup = {}
    for raw_row in ticker_rows:
        row = _normalize_ticker_row(raw_row)
        symbol = row["symbol"]
        if symbol not in tradable:
            continue
        if row["quote_volume"] <= 0 or symbol.endswith("BUSD"):
            continue
        ticker_lookup[symbol] = row

    ordered_symbols = sorted(
        ticker_lookup,
        key=lambda symbol: ticker_lookup[symbol]["quote_volume"],
        reverse=True,
    )[: UNIVERSE_PRESETS[UNIVERSE_KEY]["limit"]]

    premium_lookup = {
        str(item.get("symbol") or "").upper(): _safe_float(item.get("lastFundingRate")) * 100
        for item in premium_rows
        if str(item.get("symbol") or "").upper() in ordered_symbols
    }
    return ordered_symbols, ticker_lookup, premium_lookup


async def _load_symbol_contexts(
    client: httpx.AsyncClient,
    symbols: list[str],
    ticker_lookup: dict[str, dict[str, Any]],
) -> dict[str, dict[str, float | None]]:
    semaphore = asyncio.Semaphore(REQUEST_CONCURRENCY)

    async def worker(symbol: str) -> tuple[str, dict[str, float | None]]:
        async with semaphore:
            try:
                open_interest_payload, long_short_payload = await asyncio.gather(
                    _fetch_json(client, "/fapi/v1/openInterest", params={"symbol": symbol}),
                    _fetch_json(
                        client,
                        "/futures/data/globalLongShortAccountRatio",
                        params={"symbol": symbol, "period": "5m", "limit": 1},
                    ),
                )
            except httpx.HTTPError:
                return symbol, {"open_interest_usd": None, "long_short_ratio": None}

            open_interest = _safe_float(open_interest_payload.get("openInterest"))
            last_price = ticker_lookup.get(symbol, {}).get("last_price", 0.0)
            long_short_ratio = None
            if isinstance(long_short_payload, list) and long_short_payload:
                long_short_ratio = _safe_float(long_short_payload[-1].get("longShortRatio"))
            return (
                symbol,
                {
                    "open_interest_usd": open_interest * _safe_float(last_price),
                    "long_short_ratio": long_short_ratio,
                },
            )

    return dict(await asyncio.gather(*(worker(symbol) for symbol in symbols)))


async def _load_candles_for_timeframe(
    client: httpx.AsyncClient,
    symbols: list[str],
    timeframe: str,
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    semaphore = asyncio.Semaphore(REQUEST_CONCURRENCY)
    failures: list[dict[str, str]] = []

    async def worker(symbol: str) -> tuple[str, list[dict[str, Any]]]:
        async with semaphore:
            try:
                payload = await _fetch_json(
                    client,
                    "/fapi/v1/klines",
                    params={"symbol": symbol, "interval": timeframe, "limit": KLINE_LIMIT},
                )
            except httpx.HTTPError as exc:
                failures.append({"symbol": symbol, "message": str(exc)})
                return symbol, []

            candles = [
                {
                    "timestamp": datetime.fromtimestamp(int(item[0]) / 1000, tz=timezone.utc)
                    .replace(microsecond=0)
                    .isoformat(),
                    "open": _safe_float(item[1]),
                    "high": _safe_float(item[2]),
                    "low": _safe_float(item[3]),
                    "close": _safe_float(item[4]),
                    "volume": _safe_float(item[5]),
                }
                for item in payload
            ]
            return symbol, candles

    return dict(await asyncio.gather(*(worker(symbol) for symbol in symbols))), failures


def _build_preview_candles(result: dict[str, Any]) -> list[dict[str, Any]]:
    points = result.get("points", {})
    labels = ("X", "A", "B", "C", "D")
    values = [points[label]["price"] for label in labels]
    candles: list[dict[str, Any]] = []
    current_time = datetime(2026, 4, 4, tzinfo=timezone.utc)
    for leg_index, (start, end) in enumerate(zip(values[:-1], values[1:]), start=1):
        for step in range(16):
            ratio = step / 15
            close = start + ((end - start) * ratio)
            open_price = close if not candles else candles[-1]["close"]
            high = max(open_price, close) * 1.002
            low = min(open_price, close) * 0.998
            candles.append(
                {
                    "timestamp": current_time.replace(microsecond=0).isoformat(),
                    "open": open_price,
                    "high": high,
                    "low": low,
                    "close": close,
                    "volume": 1000 + leg_index * 100 + step,
                }
            )
            current_time += timedelta(minutes=5)
    return candles


def _build_synthetic_candles(
    *,
    symbol: str,
    timeframe: str,
    generated_at: str,
    last_price: float,
    change_24h: float,
) -> list[dict[str, Any]]:
    count = KLINE_LIMIT
    interval_minutes = TIMEFRAME_MINUTES.get(timeframe, 5)
    end_time = _parse_iso_datetime(generated_at)
    seed = _stable_seed(symbol, timeframe, generated_at)
    phase = (seed % 360) * math.pi / 180.0
    wave_primary = 0.004 + ((seed % 7) * 0.0007)
    wave_secondary = 0.0014 + (((seed >> 3) % 5) * 0.0004)
    drift_bias = ((seed % 17) - 8) / 3000
    baseline_close = max(last_price, 0.0001)
    if abs(change_24h) >= 0.01:
        start_close = baseline_close / max(1 + (change_24h / 100), 0.2)
    else:
        start_close = baseline_close * (0.992 + (((seed >> 5) % 20) / 1000))
    current_time = end_time - timedelta(minutes=interval_minutes * (count - 1))

    candles: list[dict[str, Any]] = []
    previous_close = start_close
    volume_base = max(baseline_close * (200 + (seed % 120)), 1.0)
    for index in range(count):
        progress = index / max(count - 1, 1)
        linear = start_close + ((baseline_close - start_close) * progress)
        seasonal = math.sin((progress * 7.2) + phase) * wave_primary
        micro = math.cos((progress * 18.0) + (phase / 3)) * wave_secondary
        drift = progress * drift_bias
        close_price = max(linear * (1 + seasonal + micro + drift), baseline_close * 0.55, 0.0001)
        open_price = previous_close
        spread_ratio = 0.0016 + ((seed + index) % 9) * 0.00023
        high_price = max(open_price, close_price) * (1 + spread_ratio)
        low_price = max(min(open_price, close_price) * (1 - spread_ratio), 0.00001)
        volume = volume_base * (0.88 + (abs(math.sin(index / 5.0 + phase)) * 0.42))
        candles.append(
            {
                "timestamp": current_time.replace(microsecond=0).isoformat(),
                "open": round(open_price, 8),
                "high": round(high_price, 8),
                "low": round(low_price, 8),
                "close": round(close_price, 8),
                "volume": round(volume, 2),
            }
        )
        previous_close = close_price
        current_time += timedelta(minutes=interval_minutes)

    if candles:
        candles[-1]["close"] = round(baseline_close, 8)
        candles[-1]["high"] = round(max(candles[-1]["high"], baseline_close), 8)
        candles[-1]["low"] = round(min(candles[-1]["low"], baseline_close), 8)
    return candles


def _fallback_ticker(symbol: str, *, position: int) -> dict[str, Any]:
    baseline = FALLBACK_SYMBOL_BASELINES.get(symbol, {})
    last_price = _safe_float(baseline.get("last_price"), fallback=max(1.0 / (position + 1), 0.01))
    direction = 1 if position % 2 == 0 else -1
    change_24h = round(direction * (1.8 + ((position % 5) * 0.9)), 2)
    quote_volume = _safe_float(
        baseline.get("quote_volume"),
        fallback=max(40_000_000.0, last_price * (120_000_000 / max(position + 1, 1))),
    )
    return {
        "symbol": symbol,
        "last_price": last_price,
        "change_24h": change_24h,
        "quote_volume": quote_volume,
    }


def _fallback_symbol_context(symbol: str, *, position: int, ticker: dict[str, Any]) -> dict[str, float]:
    baseline = FALLBACK_SYMBOL_BASELINES.get(symbol, {})
    open_interest_usd = _safe_float(
        baseline.get("open_interest_usd"),
        fallback=max(_safe_float(ticker.get("quote_volume")) * 0.34, 25_000_000.0),
    )
    long_short_ratio = round(0.9 + ((position % 7) * 0.055), 3)
    if position % 3 == 0:
        long_short_ratio = round(max(long_short_ratio - 0.16, 0.72), 3)
    funding_rate = round((((position % 9) - 4) * 0.0024), 4)
    return {
        "open_interest_usd": open_interest_usd,
        "long_short_ratio": long_short_ratio,
        "funding_rate": funding_rate,
    }


def _build_fallback_analyses(
    *,
    timeframe: str,
    generated_at: str,
    snapshot: dict[str, Any],
    symbols: list[str],
    ticker_lookup: dict[str, dict[str, Any]],
    premium_lookup: dict[str, float],
    symbol_contexts: dict[str, dict[str, float | None]],
) -> list[dict[str, Any]]:
    pattern_lookup = {str(result.get("symbol") or "").upper(): result for result in snapshot.get("results", [])}
    analyses: list[dict[str, Any]] = []
    for position, symbol in enumerate(symbols):
        ticker = ticker_lookup.get(symbol) or _fallback_ticker(symbol, position=position)
        if _safe_float(ticker.get("last_price")) <= 0:
            continue
        fallback_context = _fallback_symbol_context(symbol, position=position, ticker=ticker)
        funding_rate = premium_lookup.get(symbol)
        if funding_rate is None:
            funding_rate = _safe_float(fallback_context.get("funding_rate"))
        context = symbol_contexts.get(symbol, {})
        open_interest_usd = context.get("open_interest_usd")
        if open_interest_usd is None:
            open_interest_usd = _safe_float(fallback_context.get("open_interest_usd"))
        long_short_ratio = context.get("long_short_ratio")
        if long_short_ratio is None:
            long_short_ratio = _safe_float(fallback_context.get("long_short_ratio"))
        candles = _build_synthetic_candles(
            symbol=symbol,
            timeframe=timeframe,
            generated_at=generated_at,
            last_price=_safe_float(ticker.get("last_price")),
            change_24h=_safe_float(ticker.get("change_24h")),
        )
        analysis = build_symbol_analysis(
            symbol=symbol,
            timeframe=timeframe,
            candles=candles,
            ticker=ticker,
            funding_rate=funding_rate,
            open_interest_usd=open_interest_usd,
            long_short_ratio=long_short_ratio,
            pattern_result=pattern_lookup.get(symbol),
        )
        analysis["data_origin"] = "fallback_synthetic"
        analyses.append(analysis)
    return analyses


def _clean_output_directories() -> None:
    for path in (PUBLIC_DATA_DIR, PUBLIC_GENERATED_DIR):
        if path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _decorate_results(
    *,
    snapshot: dict[str, Any],
    candles_by_symbol: dict[str, list[dict[str, Any]]],
) -> None:
    scan_dir = PUBLIC_GENERATED_DIR / snapshot["scan_id"]
    scan_dir.mkdir(parents=True, exist_ok=True)
    for result in snapshot["results"]:
        image_name = (
            f"{_slugify(result['symbol'])}-{_slugify(result['pattern'])}-{_slugify(result['status'])}.svg"
        )
        image_path = scan_dir / image_name
        candles = candles_by_symbol.get(result["symbol"]) or _build_preview_candles(result)
        result["preview_image"] = f"generated/scanner/{snapshot['scan_id']}/{image_name}"
        generate_preview_svg(result=result, candles=candles, output_path=image_path)


def _analysis_row(row: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(row, ensure_ascii=False))


def _summary_cards(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    count = max(len(rows), 1)
    open_interest_total = sum(_safe_float(row.get("open_interest_usd")) for row in rows)
    liquidation_total = sum(_safe_float(row.get("liquidation_pressure_usd")) for row in rows)
    funding_values = [row.get("funding_rate") for row in rows if row.get("funding_rate") is not None]
    long_short_values = [row.get("long_short_ratio") for row in rows if row.get("long_short_ratio") is not None]
    return [
        {
            "label": "총 미결제약정",
            "value": round(open_interest_total, 2),
            "format": "currency",
            "note": f"상위 {count}개 심볼 합산",
        },
        {
            "label": "24h 청산 압력",
            "value": round(liquidation_total, 2),
            "format": "currency",
            "note": "변동성 기반 추정치",
        },
        {
            "label": "평균 펀딩비",
            "value": round(sum(funding_values) / max(len(funding_values), 1), 4),
            "format": "percent",
            "note": "선택 타임프레임 기준",
        },
        {
            "label": "평균 롱/숏 비율",
            "value": round(sum(long_short_values) / max(len(long_short_values), 1), 3),
            "format": "ratio",
            "note": "계정 비율 평균",
        },
    ]


def _status_counts(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "key": status,
            "label": status,
            "count": int(snapshot.get("status_counts", {}).get(status, 0)),
        }
        for status in SCANNER_STATUS_ORDER
    ]


def _page_preview_cards(
    *,
    opportunities: list[dict[str, Any]],
    analyses: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    def best_label(
        rows: list[dict[str, Any]],
        *,
        score_key: str,
        title: str,
        description: str,
    ) -> dict[str, Any]:
        if not rows:
            return {"title": title, "symbol": "-", "description": description, "score": 0}
        best = max(rows, key=lambda item: _safe_float(item.get("scores", {}).get(score_key)))
        return {
            "title": title,
            "symbol": best["symbol"],
            "description": description,
            "score": round(_safe_float(best.get("scores", {}).get(score_key)), 1),
        }

    return [
        best_label(opportunities, score_key="opportunity", title="우선순위", description="가장 높은 종합 기회 점수"),
        best_label(analyses, score_key="derivatives", title="시그널", description="파생 이상치가 가장 큰 심볼"),
        best_label(analyses, score_key="technical", title="테크니컬 레이팅", description="종합 기술 점수 최상위"),
        best_label(analyses, score_key="trend", title="추세", description="추세 강도가 가장 강한 심볼"),
        best_label(analyses, score_key="momentum", title="모멘텀", description="모멘텀 강도가 가장 큰 심볼"),
        best_label(analyses, score_key="volatility", title="변동성", description="돌파/압축 상태가 가장 뚜렷한 심볼"),
    ]


def _technical_distribution(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = {label: 0 for label in ("Strong Buy", "Buy", "Neutral", "Sell", "Strong Sell")}
    for row in rows:
        counts[row["labels"]["technical_rating"]] = counts.get(row["labels"]["technical_rating"], 0) + 1
    return [{"label": label, "count": count} for label, count in counts.items()]


def _build_page_payloads(
    *,
    generated_at: str,
    universe_key: str,
    snapshots: dict[str, dict[str, Any]],
    analyses_by_timeframe: dict[str, list[dict[str, Any]]],
) -> tuple[dict[str, dict[str, dict[str, str]]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    page_data: dict[str, dict[str, dict[str, str]]] = {}
    page_payloads: dict[str, dict[str, Any]] = {}
    detail_payloads: dict[str, dict[str, Any]] = {}
    universe_label = UNIVERSE_PRESETS[universe_key]["label"]

    symbol_matrix: dict[str, dict[str, dict[str, Any]]] = {}
    for timeframe, rows in analyses_by_timeframe.items():
        for row in rows:
            symbol_matrix.setdefault(row["symbol"], {})[timeframe] = row

    for timeframe in TIMEFRAMES:
        analyses = analyses_by_timeframe.get(timeframe, [])
        snapshot = snapshots[timeframe]
        analyses_sorted = sorted(
            analyses,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("technical")),
                -_safe_float(row.get("quote_volume")),
                row["symbol"],
            ),
        )
        opportunities = [row for row in analyses if row.get("pattern")]
        opportunities_sorted = sorted(
            opportunities,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("opportunity")),
                -_safe_float(row.get("scores", {}).get("technical")),
                row["symbol"],
            ),
        )

        overview_payload = {
            "page_key": "overview",
            "page_label": "오버뷰",
            "generated_at": generated_at,
            "market": "binance-usdt-perpetual",
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "summary_cards": _summary_cards(analyses),
            "status_counts": _status_counts(snapshot),
            "top_opportunities": [_analysis_row(row) for row in opportunities_sorted[:6]],
            "top_patterns": [_analysis_row(row) for row in opportunities_sorted[:4]],
            "page_previews": _page_preview_cards(opportunities=opportunities_sorted, analyses=analyses),
        }

        signals_rows = sorted(
            analyses,
            key=lambda row: (
                -(
                    _safe_float(row.get("scores", {}).get("derivatives"))
                    + abs(_safe_float(row.get("scores", {}).get("momentum_bias")))
                    + abs(_safe_float(row.get("scores", {}).get("technical")))
                ),
                row["symbol"],
            ),
        )
        signals_payload = {
            "page_key": "signals",
            "page_label": "시그널",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "summary_cards": _summary_cards(signals_rows),
            "anomaly_counts": {
                "funding_hot": sum(1 for row in analyses if abs(_safe_float(row.get("funding_rate"))) >= 0.015),
                "oi_heavy": sum(1 for row in analyses if _safe_float(row.get("open_interest_usd")) >= 500_000_000),
                "squeeze": sum(1 for row in analyses if row.get("signals", {}).get("squeeze")),
                "divergence": sum(1 for row in analyses if row.get("signals", {}).get("divergence_candidate")),
            },
            "rows": [_analysis_row(row) for row in signals_rows[:60]],
        }

        opportunities_payload = {
            "page_key": "opportunities",
            "page_label": "우선순위",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "summary_cards": _summary_cards(opportunities_sorted),
            "rows": [_analysis_row(row) for row in opportunities_sorted[:40]],
        }

        setups_payload = {
            "page_key": "setups",
            "page_label": "세트업 랩",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "summary_cards": _summary_cards(opportunities_sorted),
            "rows": [_analysis_row(row) for row in opportunities_sorted[:20]],
        }

        ratings_rows = sorted(
            analyses,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("technical")),
                -_safe_float(row.get("scores", {}).get("moving_average")),
                row["symbol"],
            ),
        )
        technical_payload = {
            "page_key": "technical_ratings",
            "page_label": "테크니컬 레이팅",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "distribution": _technical_distribution(ratings_rows),
            "rows": [_analysis_row(row) for row in ratings_rows[:80]],
        }

        trend_rows = sorted(
            analyses,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("trend")),
                -abs(_safe_float(row.get("scores", {}).get("trend_bias"))),
                row["symbol"],
            ),
        )
        trend_payload = {
            "page_key": "trend",
            "page_label": "추세",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "counts": {
                "bullish": sum(1 for row in analyses if row["labels"]["trend_bias"] == "상승 추세"),
                "bearish": sum(1 for row in analyses if row["labels"]["trend_bias"] == "하락 추세"),
                "mixed": sum(1 for row in analyses if row["labels"]["trend_bias"] == "혼조"),
            },
            "rows": [_analysis_row(row) for row in trend_rows[:80]],
        }

        momentum_rows = sorted(
            analyses,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("momentum")),
                -abs(_safe_float(row.get("scores", {}).get("momentum_bias"))),
                row["symbol"],
            ),
        )
        momentum_payload = {
            "page_key": "momentum",
            "page_label": "모멘텀",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "counts": {
                "overbought": sum(1 for row in analyses if row["labels"]["momentum_bias"] == "과매수"),
                "oversold": sum(1 for row in analyses if row["labels"]["momentum_bias"] == "과매도"),
                "divergence": sum(1 for row in analyses if row["signals"]["divergence_candidate"]),
            },
            "rows": [_analysis_row(row) for row in momentum_rows[:80]],
        }

        volatility_rows = sorted(
            analyses,
            key=lambda row: (
                -_safe_float(row.get("scores", {}).get("volatility")),
                row["symbol"],
            ),
        )
        volatility_payload = {
            "page_key": "volatility",
            "page_label": "변동성",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "counts": {
                "squeeze": sum(1 for row in analyses if row["signals"]["squeeze"]),
                "breakout_up": sum(1 for row in analyses if row["signals"]["breakout_up"]),
                "breakout_down": sum(1 for row in analyses if row["signals"]["breakout_down"]),
                "expansion": sum(1 for row in analyses if row["labels"]["volatility_state"] == "확장"),
            },
            "rows": [_analysis_row(row) for row in volatility_rows[:80]],
        }

        multi_timeframe_rows = []
        for symbol, rows_by_timeframe in symbol_matrix.items():
            anchor = rows_by_timeframe.get(timeframe)
            if not anchor:
                continue
            timeframes_payload = {}
            bullish_count = 0
            bearish_count = 0
            for frame in TIMEFRAMES:
                row = rows_by_timeframe.get(frame)
                if not row:
                    continue
                timeframes_payload[frame] = {
                    "technical_rating": row["labels"]["technical_rating"],
                    "trend_bias": row["labels"]["trend_bias"],
                    "momentum_bias": row["labels"]["momentum_bias"],
                    "opportunity": row["scores"]["opportunity"],
                    "pattern": row.get("pattern", {}).get("pattern") if row.get("pattern") else "",
                }
                if row["labels"]["trend_bias"] == "상승 추세":
                    bullish_count += 1
                elif row["labels"]["trend_bias"] == "하락 추세":
                    bearish_count += 1
            consensus = "상승 합의" if bullish_count >= 3 else "하락 합의" if bearish_count >= 3 else "혼합"
            multi_timeframe_rows.append(
                {
                    "symbol": symbol,
                    "last_price": anchor["last_price"],
                    "change_24h": anchor["change_24h"],
                    "agreement_score": round((bullish_count - bearish_count) * 25, 1),
                    "consensus_label": consensus,
                    "primary": _analysis_row(anchor),
                    "timeframes": timeframes_payload,
                }
            )
        multi_timeframe_rows.sort(key=lambda row: (-abs(_safe_float(row.get("agreement_score"))), row["symbol"]))
        multi_timeframe_payload = {
            "page_key": "multi_timeframe",
            "page_label": "멀티 타임프레임",
            "generated_at": generated_at,
            "universe_key": universe_key,
            "universe_label": universe_label,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "counts": {
                "bullish": sum(1 for row in multi_timeframe_rows if row["consensus_label"] == "상승 합의"),
                "bearish": sum(1 for row in multi_timeframe_rows if row["consensus_label"] == "하락 합의"),
                "mixed": sum(1 for row in multi_timeframe_rows if row["consensus_label"] == "혼합"),
            },
            "rows": multi_timeframe_rows[:80],
        }

        payload_by_page = {
            "overview": overview_payload,
            "signals": signals_payload,
            "patterns": snapshot,
            "opportunities": opportunities_payload,
            "setups": setups_payload,
            "technical_ratings": technical_payload,
            "trend": trend_payload,
            "momentum": momentum_payload,
            "volatility": volatility_payload,
            "multi_timeframe": multi_timeframe_payload,
        }

        for page_key, payload in payload_by_page.items():
            if page_key == "patterns":
                page_data.setdefault(page_key, {}).setdefault(universe_key, {})[timeframe] = (
                    f"scan-{universe_key}-{timeframe}.json"
                )
            else:
                page_data.setdefault(page_key, {}).setdefault(universe_key, {})[timeframe] = _page_filename(
                    page_key,
                    universe_key=universe_key,
                    timeframe=timeframe,
                )
            if page_key != "patterns":
                page_payloads[page_data[page_key][universe_key][timeframe]] = payload

        for row in opportunities_sorted:
            pattern = row.get("pattern")
            if not pattern or not pattern.get("detail_data_path"):
                continue
            related_timeframes = {}
            for frame in TIMEFRAMES:
                related_row = symbol_matrix.get(row["symbol"], {}).get(frame)
                if not related_row:
                    continue
                related_timeframes[frame] = {
                    "technical_rating": related_row["labels"]["technical_rating"],
                    "trend_bias": related_row["labels"]["trend_bias"],
                    "momentum_bias": related_row["labels"]["momentum_bias"],
                    "opportunity": related_row["scores"]["opportunity"],
                }
            detail_payloads[pattern["detail_data_path"]] = {
                "generated_at": generated_at,
                "scan_id": snapshot["scan_id"],
                "market": "binance-usdt-perpetual",
                "universe_key": universe_key,
                "universe_label": universe_label,
                "timeframe": timeframe,
                "timeframe_label": TIMEFRAME_LABELS[timeframe],
                "result": pattern,
                "analysis": _analysis_row(row),
                "related_timeframes": related_timeframes,
            }

        # Fallback snapshots can exist without analysis rows when upstream market
        # requests fail. We still need detail JSON for every referenced setup so
        # the static site can render detail pages and validate output paths.
        for result in snapshot.get("results", []):
            if not isinstance(result, dict):
                continue
            detail_data_path = str(result.get("detail_data_path") or "").strip()
            if not detail_data_path or detail_data_path in detail_payloads:
                continue
            detail_payloads[detail_data_path] = {
                "generated_at": generated_at,
                "scan_id": snapshot["scan_id"],
                "market": "binance-usdt-perpetual",
                "universe_key": universe_key,
                "universe_label": universe_label,
                "timeframe": timeframe,
                "timeframe_label": TIMEFRAME_LABELS[timeframe],
                "result": json.loads(json.dumps(result, ensure_ascii=False)),
                "analysis": {},
                "related_timeframes": {},
            }

    return page_data, page_payloads, detail_payloads


async def _scan_all() -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    generated_at = _now_iso()
    async with httpx.AsyncClient(
        base_url=BASE_URL,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": "newsbot-scanner/0.1"},
        follow_redirects=True,
    ) as client:
        try:
            symbols, ticker_lookup, premium_lookup = await _load_universe(client)
            symbol_contexts = await _load_symbol_contexts(client, symbols, ticker_lookup)
        except httpx.HTTPError as exc:
            snapshots = [
                build_fallback_snapshot(
                    timeframe=timeframe,
                    generated_at=generated_at,
                    failures=[{"scope": "universe", "message": str(exc)}],
                )
                for timeframe in TIMEFRAMES
            ]
            analyses = {}
            for snapshot in snapshots:
                _decorate_results(snapshot=snapshot, candles_by_symbol={})
                analyses[snapshot["timeframe"]] = _build_fallback_analyses(
                    timeframe=snapshot["timeframe"],
                    generated_at=generated_at,
                    snapshot=snapshot,
                    symbols=list(FALLBACK_SYMBOLS),
                    ticker_lookup={},
                    premium_lookup={},
                    symbol_contexts={},
                )
            return snapshots, analyses

        snapshots: list[dict[str, Any]] = []
        analyses_by_timeframe: dict[str, list[dict[str, Any]]] = {}
        for timeframe in TIMEFRAMES:
            candles_by_symbol, failures = await _load_candles_for_timeframe(client, symbols, timeframe)
            results = []
            pattern_lookup: dict[str, dict[str, Any]] = {}
            for symbol in symbols:
                candles = candles_by_symbol.get(symbol) or []
                if not candles:
                    continue
                result = detect_pattern_match(
                    symbol=symbol,
                    timeframe=timeframe,
                    candles=candles,
                    ticker=ticker_lookup.get(symbol),
                    funding_rate=premium_lookup.get(symbol),
                    open_interest_usd=symbol_contexts.get(symbol, {}).get("open_interest_usd"),
                    long_short_ratio=symbol_contexts.get(symbol, {}).get("long_short_ratio"),
                )
                if result is not None:
                    results.append(result)

            snapshot = (
                build_fallback_snapshot(
                    timeframe=timeframe,
                    universe_key=UNIVERSE_KEY,
                    generated_at=generated_at,
                    failures=failures,
                )
                if not results
                else build_snapshot(
                    generated_at=generated_at,
                    universe_key=UNIVERSE_KEY,
                    timeframe=timeframe,
                    symbols_scanned=len(symbols),
                    results=results,
                    failures=failures,
                )
            )
            _decorate_results(snapshot=snapshot, candles_by_symbol=candles_by_symbol)
            for result in snapshot["results"]:
                pattern_lookup[result["symbol"]] = result
            snapshots.append(snapshot)

            analyses = [
                build_symbol_analysis(
                    symbol=symbol,
                    timeframe=timeframe,
                    candles=candles_by_symbol.get(symbol) or [],
                    ticker=ticker_lookup.get(symbol),
                    funding_rate=premium_lookup.get(symbol),
                    open_interest_usd=symbol_contexts.get(symbol, {}).get("open_interest_usd"),
                    long_short_ratio=symbol_contexts.get(symbol, {}).get("long_short_ratio"),
                    pattern_result=pattern_lookup.get(symbol),
                )
                for symbol in symbols
                if candles_by_symbol.get(symbol)
            ]
            existing_symbols = {row["symbol"] for row in analyses}
            if len(existing_symbols) < len(symbols):
                fallback_analyses = _build_fallback_analyses(
                    timeframe=timeframe,
                    generated_at=generated_at,
                    snapshot=snapshot,
                    symbols=[symbol for symbol in symbols if symbol not in existing_symbols],
                    ticker_lookup=ticker_lookup,
                    premium_lookup=premium_lookup,
                    symbol_contexts=symbol_contexts,
                )
                analyses.extend(fallback_analyses)
            analyses_by_timeframe[timeframe] = analyses
        return snapshots, analyses_by_timeframe


def main() -> None:
    _clean_output_directories()
    snapshots, analyses_by_timeframe = asyncio.run(_scan_all())
    snapshot_map = {snapshot["timeframe"]: snapshot for snapshot in snapshots}
    generated_at = max((snapshot["generated_at"] for snapshot in snapshots), default=_now_iso())
    page_data, page_payloads, detail_payloads = _build_page_payloads(
        generated_at=generated_at,
        universe_key=UNIVERSE_KEY,
        snapshots=snapshot_map,
        analyses_by_timeframe=analyses_by_timeframe,
    )
    manifest = build_manifest(snapshots, page_data=page_data)

    for snapshot in snapshots:
        _write_json(
            PUBLIC_DATA_DIR / f"scan-{snapshot['universe_key']}-{snapshot['timeframe']}.json",
            snapshot,
        )
    for filename, payload in page_payloads.items():
        _write_json(PUBLIC_DATA_DIR / filename, payload)
    for relative_path, payload in detail_payloads.items():
        _write_json(PUBLIC_DATA_DIR / relative_path, payload)
    _write_json(PUBLIC_DATA_DIR / "manifest.json", manifest)
    print(
        f"Updated scanner dataset with {len(snapshots)} snapshots, "
        f"{len(page_payloads)} page datasets, and {manifest['total_results']} pattern results."
    )


if __name__ == "__main__":
    main()
