"""Pattern scanner primitives used by the static crypto dashboard."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
from hashlib import sha1
from math import floor
import statistics
from pathlib import Path
from typing import Any


UNIVERSE_PRESETS: dict[str, dict[str, Any]] = {
    "top100": {"label": "상위 100개 종목", "limit": 100},
}

TIMEFRAME_LABELS = {
    "5m": "5분 (5m)",
    "15m": "15분 (15m)",
    "1h": "1시간 (1h)",
    "4h": "4시간 (4h)",
}

SCANNER_STATUS_LABELS = {
    "forming": "실시간 진입",
    "touch": "실시간 터치",
    "tbar_complete": "T-Bar 완성",
    "complete": "일반 완성",
}

SCANNER_STATUS_ORDER = ("forming", "touch", "tbar_complete", "complete")

FALLBACK_SYMBOLS = (
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "BNBUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "SUIUSDT",
    "LINKUSDT",
    "AVAXUSDT",
)

_SVG_COLORS = {
    "background": "#0b1220",
    "panel": "#111827",
    "grid": "#223045",
    "text": "#f3f4f6",
    "muted": "#8ba0b5",
    "up": "#0ecb81",
    "down": "#f6465d",
    "pattern": "#2fc273",
    "prz": "#fbbf24",
}


@dataclass(frozen=True)
class Pivot:
    kind: str
    index: int
    price: float
    timestamp: str


@dataclass(frozen=True)
class PatternDefinition:
    key: str
    label: str
    xab: tuple[float, float] | float | None
    abc: tuple[float, float] | float | None
    bcd: tuple[float, float] | float | None
    xad: tuple[float, float] | float | None
    ab_equal_cd: bool = False


PATTERN_DEFINITIONS: tuple[PatternDefinition, ...] = (
    PatternDefinition("abcd", "AB=CD", None, (0.382, 0.886), (1.13, 2.618), None, ab_equal_cd=True),
    PatternDefinition("gartley", "Gartley", 0.618, (0.382, 0.886), (1.272, 1.618), 0.786),
    PatternDefinition("bat", "Bat", (0.382, 0.5), (0.382, 0.886), (1.618, 2.618), 0.886),
    PatternDefinition("alternate_bat", "Alternate Bat", (0.0, 0.382), (0.382, 0.886), (2.0, 3.618), 1.13),
    PatternDefinition("butterfly", "Butterfly", 0.786, (0.382, 0.886), (1.618, 2.618), 1.27),
    PatternDefinition("crab", "Crab", (0.382, 0.618), (0.382, 0.886), (2.24, 3.618), 1.618),
    PatternDefinition("deep_crab", "Deep Crab", 0.886, (0.382, 0.886), (2.0, 3.618), 1.618),
    PatternDefinition("cypher", "Cypher", (0.382, 0.618), (1.13, 1.414), 0.786, 0.786),
    PatternDefinition("shark", "Shark", (0.5, 0.886), (1.13, 1.618), (1.618, 2.24), (0.886, 1.13)),
)


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return fallback
    if numeric != numeric:
        return fallback
    return numeric


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _price_precision(price: float) -> int:
    absolute = abs(price)
    if absolute >= 1000:
        return 2
    if absolute >= 10:
        return 3
    if absolute >= 1:
        return 4
    if absolute >= 0.1:
        return 5
    return 6


def _round_price(price: float) -> float:
    return round(price, _price_precision(price))


def _normalize_symbol(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def _slugify(value: str) -> str:
    sanitized = []
    for character in value.lower():
        if character.isalnum():
            sanitized.append(character)
        elif sanitized and sanitized[-1] != "-":
            sanitized.append("-")
    return "".join(sanitized).strip("-") or "result"


def _ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    if len(values) < period:
        return statistics.fmean(values)
    multiplier = 2 / (period + 1)
    ema_value = statistics.fmean(values[:period])
    for value in values[period:]:
        ema_value = (value - ema_value) * multiplier + ema_value
    return ema_value


def _rsi(values: list[float], period: int = 14) -> float:
    if len(values) <= period:
        return 50.0
    gains: list[float] = []
    losses: list[float] = []
    for previous, current in zip(values[:-1], values[1:]):
        delta = current - previous
        gains.append(max(delta, 0.0))
        losses.append(abs(min(delta, 0.0)))
    avg_gain = statistics.fmean(gains[:period]) if gains[:period] else 0.0
    avg_loss = statistics.fmean(losses[:period]) if losses[:period] else 0.0
    for index in range(period, len(gains)):
        avg_gain = ((avg_gain * (period - 1)) + gains[index]) / period
        avg_loss = ((avg_loss * (period - 1)) + losses[index]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _bollinger(values: list[float], period: int = 20) -> tuple[float, float, float]:
    sample = values[-period:] if len(values) >= period else values
    if not sample:
        return (0.0, 0.0, 0.0)
    mean = statistics.fmean(sample)
    deviation = statistics.pstdev(sample) if len(sample) > 1 else 0.0
    return (mean - (2 * deviation), mean, mean + (2 * deviation))


def _vwap(candles: list[dict[str, Any]]) -> float:
    numerator = 0.0
    denominator = 0.0
    for candle in candles:
        high = _safe_float(candle.get("high"))
        low = _safe_float(candle.get("low"))
        close = _safe_float(candle.get("close"))
        volume = max(_safe_float(candle.get("volume")), 0.0)
        typical = (high + low + close) / 3 if volume else 0.0
        numerator += typical * volume
        denominator += volume
    if denominator <= 0:
        return _safe_float(candles[-1].get("close")) if candles else 0.0
    return numerator / denominator


def _macd(values: list[float]) -> tuple[float, float, float]:
    if not values:
        return (0.0, 0.0, 0.0)
    fast_values = []
    slow_values = []
    for index in range(1, len(values) + 1):
        sample = values[:index]
        fast_values.append(_ema(sample, 12))
        slow_values.append(_ema(sample, 26))
    macd_line_series = [fast - slow for fast, slow in zip(fast_values, slow_values)]
    macd_line = macd_line_series[-1]
    signal = _ema(macd_line_series, 9)
    histogram = macd_line - signal
    return (macd_line, signal, histogram)


def find_pivots(candles: list[dict[str, Any]], *, left: int = 3, right: int = 3) -> list[Pivot]:
    if len(candles) < left + right + 5:
        return []

    pivots: list[Pivot] = []
    highs = [_safe_float(candle.get("high")) for candle in candles]
    lows = [_safe_float(candle.get("low")) for candle in candles]

    for index in range(left, len(candles) - right):
        window_highs = highs[index - left : index + right + 1]
        window_lows = lows[index - left : index + right + 1]
        timestamp = str(candles[index].get("timestamp") or "")
        if highs[index] == max(window_highs):
            pivots.append(Pivot("H", index, highs[index], timestamp))
        if lows[index] == min(window_lows):
            pivots.append(Pivot("L", index, lows[index], timestamp))

    compressed: list[Pivot] = []
    for pivot in pivots:
        if not compressed:
            compressed.append(pivot)
            continue
        previous = compressed[-1]
        if previous.kind != pivot.kind:
            compressed.append(pivot)
            continue
        if pivot.kind == "H" and pivot.price >= previous.price:
            compressed[-1] = pivot
        elif pivot.kind == "L" and pivot.price <= previous.price:
            compressed[-1] = pivot
    return compressed


def _score_against_spec(value: float, spec: tuple[float, float] | float | None) -> float:
    if spec is None:
        return 1.0
    value = abs(value)
    if isinstance(spec, tuple):
        low, high = spec
        if low <= value <= high:
            return 1.0
        span = max(high - low, (abs(low) + abs(high)) / 2 * 0.08, 1e-6)
        if value < low:
            distance = (low - value) / span
        else:
            distance = (value - high) / span
        return _clamp(1 - distance, 0.0, 1.0)
    tolerance = max(abs(spec) * 0.14, 0.04)
    distance = abs(value - spec) / tolerance
    return _clamp(1 - distance, 0.0, 1.0)


def _pattern_direction(points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot]) -> str:
    return "bullish" if points[-1].kind == "L" else "bearish"


def _expected_price(
    start_price: float,
    end_price: float,
    ratio_spec: tuple[float, float] | float | None,
) -> float | None:
    if ratio_spec is None:
        return None
    ratio = statistics.fmean(ratio_spec) if isinstance(ratio_spec, tuple) else ratio_spec
    delta = end_price - start_price
    return start_price + (delta * ratio)


def _build_indicator_flags(
    candles: list[dict[str, Any]],
    *,
    side: str,
    funding_rate: float | None,
    open_interest_usd: float | None,
    long_short_ratio: float | None,
) -> tuple[list[dict[str, Any]], float]:
    closes = [_safe_float(candle.get("close")) for candle in candles]
    current_close = closes[-1] if closes else 0.0
    current_rsi = _rsi(closes)
    _, _, histogram = _macd(closes)
    bb_lower, _, bb_upper = _bollinger(closes)
    vwap = _vwap(candles)

    flags: list[dict[str, Any]] = []

    def append_flag(key: str, label: str, passed: bool, value: str, note: str) -> None:
        flags.append(
            {
                "key": key,
                "label": label,
                "status": "pass" if passed else "neutral",
                "value": value,
                "note": note,
            }
        )

    bullish = side == "bullish"
    append_flag(
        "rsi",
        "RSI",
        current_rsi <= 48 if bullish else current_rsi >= 52,
        f"{current_rsi:.1f}",
        "과매도/과매수 구간 접근",
    )
    append_flag(
        "macd",
        "MACD",
        histogram >= 0 if bullish else histogram <= 0,
        f"{histogram:.4f}",
        "히스토그램 반전 확인",
    )
    append_flag(
        "bollinger",
        "Bollinger",
        current_close <= bb_lower * 1.03 if bullish else current_close >= bb_upper * 0.97,
        f"{bb_lower:.4f} ~ {bb_upper:.4f}",
        "밴드 극단값 근접",
    )
    append_flag(
        "vwap",
        "VWAP",
        current_close >= vwap * 0.995 if bullish else current_close <= vwap * 1.005,
        f"{vwap:.4f}",
        "VWAP 회복/이탈 흐름",
    )

    if funding_rate is not None:
        append_flag(
            "funding",
            "Funding",
            funding_rate <= 0 if bullish else funding_rate >= 0,
            f"{funding_rate:.4f}%",
            "반대 포지션 과열 여부",
        )
    if open_interest_usd is not None:
        append_flag(
            "open_interest",
            "Open Interest",
            open_interest_usd >= 1_000_000,
            f"${open_interest_usd:,.0f}",
            "체결 관심도 유지",
        )
    if long_short_ratio is not None:
        append_flag(
            "long_short",
            "Long/Short",
            long_short_ratio <= 1.0 if bullish else long_short_ratio >= 1.0,
            f"{long_short_ratio:.2f}",
            "군중 포지션 반대편 우위",
        )

    positive_flags = sum(1 for flag in flags if flag["status"] == "pass")
    indicator_score = 15 * (positive_flags / max(len(flags), 1))
    return flags, indicator_score


def _build_prz(
    definition: PatternDefinition,
    points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot],
) -> dict[str, float]:
    x, a, b, c, d = points
    expected_xd = _expected_price(x.price, a.price, definition.xad)
    bc_delta = c.price - b.price
    projection_ratio = (
        statistics.fmean(definition.bcd)
        if isinstance(definition.bcd, tuple)
        else definition.bcd or 1.0
    )
    expected_cd = c.price - (bc_delta * projection_ratio)
    expected_abcd = None
    if definition.ab_equal_cd:
        expected_abcd = c.price + (b.price - a.price)

    expected_values = [value for value in (expected_xd, expected_cd, expected_abcd) if value is not None]
    center = statistics.fmean(expected_values) if expected_values else d.price
    width = max(abs(value - center) for value in expected_values) if expected_values else 0.0
    width = max(width, abs(a.price - x.price) * 0.025, abs(center) * 0.0025, 1e-6)
    lower = min(center - width, center + width)
    upper = max(center - width, center + width)
    return {
        "lower": _round_price(lower),
        "upper": _round_price(upper),
        "center": _round_price(center),
        "distance_pct": round((abs(d.price - center) / max(abs(center), 1e-6)) * 100, 3),
    }


def _build_targets(
    points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot],
    *,
    side: str,
) -> tuple[dict[str, float], dict[str, Any]]:
    x, a, _, c, d = points
    xa_size = abs(a.price - x.price)
    cd_size = abs(d.price - c.price)
    direction = 1 if side == "bullish" else -1
    tp1 = d.price + (direction * cd_size * 0.382)
    tp2 = d.price + (direction * cd_size * 0.618)
    stop = d.price - (direction * xa_size * 0.13)
    return (
        {"tp1": _round_price(tp1), "tp2": _round_price(tp2)},
        {"value": _round_price(stop), "label": "1.13 XA"},
    )


def _geometry_score(points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot], prz_center: float) -> float:
    x, a, b, c, d = points
    ab_bars = max(b.index - a.index, 1)
    cd_bars = max(d.index - c.index, 1)
    xa_bars = max(a.index - x.index, 1)
    bc_bars = max(c.index - b.index, 1)
    symmetry = 1 - min(abs(ab_bars - cd_bars) / max(ab_bars, cd_bars), 1.0)
    pacing = 1 - min(abs(xa_bars - bc_bars) / max(xa_bars, bc_bars), 1.0)
    prz_alignment = 1 - min(abs(d.price - prz_center) / max(abs(prz_center), 1e-6) / 0.04, 1.0)
    return 25 * ((symmetry * 0.45) + (pacing * 0.2) + (prz_alignment * 0.35))


def _classify_status(
    candles: list[dict[str, Any]],
    points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot],
    *,
    side: str,
    prz: dict[str, float],
    targets: dict[str, float],
) -> tuple[str, float]:
    if not candles:
        return ("forming", 8.0)

    current_close = _safe_float(candles[-1].get("close"))
    d = points[-1]
    xa_size = abs(points[1].price - points[0].price)
    bars_since_d = max(len(candles) - 1 - d.index, 0)
    bullish = side == "bullish"
    reversal_move = (
        (current_close - d.price) / max(xa_size, 1e-6)
        if bullish
        else (d.price - current_close) / max(xa_size, 1e-6)
    )
    in_prz = prz["lower"] <= current_close <= prz["upper"] or prz["lower"] <= d.price <= prz["upper"]

    if not in_prz and bars_since_d <= 2:
        return ("forming", 8.0)
    if in_prz and reversal_move < 0.01:
        return ("touch", 12.0)
    hit_tp1 = current_close >= targets["tp1"] if bullish else current_close <= targets["tp1"]
    hit_tp2 = current_close >= targets["tp2"] if bullish else current_close <= targets["tp2"]
    if hit_tp2 or reversal_move >= 0.028:
        return ("complete", 20.0)
    if hit_tp1 or reversal_move >= 0.012:
        return ("tbar_complete", 16.0)
    return ("touch", 12.0)


def _ratio_payload(
    points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot]
) -> tuple[dict[str, float], dict[str, float]]:
    x, a, b, c, d = points
    xa = abs(a.price - x.price)
    ab = abs(b.price - a.price)
    bc = abs(c.price - b.price)
    cd = abs(d.price - c.price)
    xd = abs(d.price - x.price)
    ratios = {
        "xab": round(ab / max(xa, 1e-6), 3),
        "abc": round(bc / max(ab, 1e-6), 3),
        "bcd": round(cd / max(bc, 1e-6), 3),
        "xad": round(xd / max(xa, 1e-6), 3),
    }
    lengths = {"xa": xa, "ab": ab, "bc": bc, "cd": cd, "xd": xd}
    return ratios, lengths


def _evaluate_definition(
    definition: PatternDefinition,
    points: tuple[Pivot, Pivot, Pivot, Pivot, Pivot],
    *,
    candles: list[dict[str, Any]],
    current_close: float,
    indicator_score: float,
    indicator_flags: list[dict[str, Any]],
) -> dict[str, Any]:
    ratios, lengths = _ratio_payload(points)
    side = _pattern_direction(points)
    ratio_score = 40 * statistics.fmean(
        [
            _score_against_spec(ratios["xab"], definition.xab),
            _score_against_spec(ratios["abc"], definition.abc),
            _score_against_spec(ratios["bcd"], definition.bcd),
            _score_against_spec(ratios["xad"], definition.xad),
        ]
    )
    prz = _build_prz(definition, points)
    geometry_score = _geometry_score(points, prz["center"])
    targets, stop = _build_targets(points, side=side)
    status, reaction_score = _classify_status(
        candles,
        points,
        side=side,
        prz=prz,
        targets=targets,
    )
    total_score = ratio_score + geometry_score + reaction_score + indicator_score
    if total_score < 55 or ratio_score < 18:
        return {}

    side_label = "Bullish (매수)" if side == "bullish" else "Bearish (매도)"
    slug = _slugify(f"{points[-1].timestamp}-{definition.label}-{side}-{points[-1].price}")
    summary = (
        f"{definition.label} 패턴이 PRZ 구간에 진입했고 "
        f"{SCANNER_STATUS_LABELS[status]} 상태로 분류되었습니다."
    )
    return {
        "pattern": definition.label,
        "pattern_key": definition.key,
        "side": side,
        "side_label": side_label,
        "status": status,
        "status_label": SCANNER_STATUS_LABELS[status],
        "score": round(total_score, 1),
        "score_breakdown": {
            "ratio_fit": round(ratio_score, 1),
            "geometry": round(geometry_score, 1),
            "reaction": round(reaction_score, 1),
            "indicators": round(indicator_score, 1),
        },
        "points": {
            label: {
                "price": _round_price(point.price),
                "timestamp": point.timestamp,
                "index": point.index,
            }
            for label, point in zip(("X", "A", "B", "C", "D"), points)
        },
        "ratios": ratios,
        "prz": prz,
        "targets": targets,
        "stop": stop,
        "indicator_flags": indicator_flags,
        "summary": summary,
        "detail_slug": slug,
        "bars_since_d": max(len(candles) - 1 - points[-1].index, 0),
        "leg_sizes": {name: round(value, _price_precision(value)) for name, value in lengths.items()},
    }


def detect_pattern_match(
    *,
    symbol: str,
    timeframe: str,
    candles: list[dict[str, Any]],
    ticker: dict[str, Any] | None = None,
    funding_rate: float | None = None,
    open_interest_usd: float | None = None,
    long_short_ratio: float | None = None,
) -> dict[str, Any] | None:
    if len(candles) < 40:
        return None

    pivots = find_pivots(candles)
    if len(pivots) < 5:
        return None

    closes = [_safe_float(candle.get("close")) for candle in candles]
    current_close = closes[-1] if closes else 0.0
    best_result: dict[str, Any] | None = None

    for start in range(max(0, len(pivots) - 12), len(pivots) - 4):
        points = tuple(pivots[start : start + 5])
        if len(points) != 5:
            continue
        if len({points[0].kind, points[1].kind}) != 2:
            continue
        indicator_flags, indicator_score = _build_indicator_flags(
            candles,
            side=_pattern_direction(points),
            funding_rate=funding_rate,
            open_interest_usd=open_interest_usd,
            long_short_ratio=long_short_ratio,
        )
        for definition in PATTERN_DEFINITIONS:
            result = _evaluate_definition(
                definition,
                points,
                candles=candles,
                current_close=current_close,
                indicator_score=indicator_score,
                indicator_flags=indicator_flags,
            )
            if not result:
                continue
            if best_result is None or result["score"] > best_result["score"]:
                best_result = result
                continue
            if (
                best_result["pattern"] == "AB=CD"
                and result["pattern"] != "AB=CD"
                and result["score"] >= best_result["score"] - 2.5
            ):
                best_result = result

    if best_result is None:
        return None

    ticker = ticker or {}
    symbol = _normalize_symbol(symbol)
    scan_hash = sha1(f"{symbol}:{timeframe}:{best_result['detail_slug']}".encode("utf-8")).hexdigest()[:10]
    detail_path = f"patterns/{timeframe}/{symbol.lower()}-{scan_hash}/"
    best_result.update(
        {
            "symbol": symbol,
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS.get(timeframe, timeframe),
            "last_price": _round_price(current_close),
            "change_24h": round(_safe_float(ticker.get("change_24h")), 2),
            "quote_volume": round(_safe_float(ticker.get("quote_volume")), 2),
            "funding_rate": None if funding_rate is None else round(funding_rate, 4),
            "open_interest_usd": None if open_interest_usd is None else round(open_interest_usd, 2),
            "long_short_ratio": None if long_short_ratio is None else round(long_short_ratio, 3),
            "preview_image": "",
            "detail_page": detail_path,
            "external_links": {
                "binance": f"https://www.binance.com/en/futures/{symbol}",
                "tradingview": f"https://www.tradingview.com/chart/?symbol=BINANCE:{symbol}",
            },
        }
    )
    return best_result


def build_snapshot(
    *,
    generated_at: str,
    universe_key: str,
    timeframe: str,
    symbols_scanned: int,
    results: list[dict[str, Any]],
    failures: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    sorted_results = sorted(
        results,
        key=lambda item: (
            SCANNER_STATUS_ORDER.index(item["status"]),
            -_safe_float(item["score"]),
            item["symbol"],
        ),
    )
    status_counts = {status: 0 for status in SCANNER_STATUS_ORDER}
    for result in sorted_results:
        status_counts[result["status"]] = status_counts.get(result["status"], 0) + 1
    return {
        "scan_id": f"scan-{universe_key}-{timeframe}",
        "generated_at": generated_at,
        "market": "binance-usdt-perpetual",
        "universe_key": universe_key,
        "universe_label": UNIVERSE_PRESETS[universe_key]["label"],
        "timeframe": timeframe,
        "timeframe_label": TIMEFRAME_LABELS.get(timeframe, timeframe),
        "symbols_scanned": symbols_scanned,
        "status_counts": status_counts,
        "result_count": len(sorted_results),
        "failures": failures or [],
        "results": sorted_results,
    }


def build_manifest(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    generated_at = (
        max((str(snapshot.get("generated_at") or "") for snapshot in snapshots), default="")
        or _utc_now_iso()
    )
    total_results = sum(int(snapshot.get("result_count") or 0) for snapshot in snapshots)
    total_symbols = max((int(snapshot.get("symbols_scanned") or 0) for snapshot in snapshots), default=0)
    aggregates = {status: 0 for status in SCANNER_STATUS_ORDER}
    for snapshot in snapshots:
        for status, count in snapshot.get("status_counts", {}).items():
            aggregates[status] = aggregates.get(status, 0) + int(count or 0)
    return {
        "generated_at": generated_at,
        "market": "binance-usdt-perpetual",
        "universe_presets": [{"key": key, **value} for key, value in UNIVERSE_PRESETS.items()],
        "timeframes": [{"key": key, "label": label} for key, label in TIMEFRAME_LABELS.items()],
        "symbols_scanned": total_symbols,
        "total_results": total_results,
        "status_counts": aggregates,
        "snapshots": [
            {
                "scan_id": snapshot["scan_id"],
                "generated_at": snapshot["generated_at"],
                "universe_key": snapshot["universe_key"],
                "timeframe": snapshot["timeframe"],
                "timeframe_label": snapshot["timeframe_label"],
                "symbols_scanned": snapshot["symbols_scanned"],
                "result_count": snapshot["result_count"],
                "status_counts": snapshot["status_counts"],
                "path": f"scan-{snapshot['universe_key']}-{snapshot['timeframe']}.json",
            }
            for snapshot in sorted(snapshots, key=lambda item: item["timeframe"])
        ],
    }


def generate_preview_svg(
    *,
    result: dict[str, Any],
    candles: list[dict[str, Any]],
    output_path: Path,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    width = 960
    height = 540
    chart_left = 72
    chart_top = 58
    chart_width = width - 112
    chart_height = height - 146
    window = candles[-80:] if len(candles) > 80 else candles
    highs = [_safe_float(candle.get("high")) for candle in window] or [0.0]
    lows = [_safe_float(candle.get("low")) for candle in window] or [0.0]
    price_min = min(lows)
    price_max = max(highs)
    price_span = max(price_max - price_min, 1e-6)

    def scale_x(index: int) -> float:
        return chart_left + (index / max(len(window) - 1, 1)) * chart_width

    def scale_y(price: float) -> float:
        relative = (price - price_min) / price_span
        return chart_top + chart_height - (relative * chart_height)

    candle_group: list[str] = []
    for index, candle in enumerate(window):
        open_price = _safe_float(candle.get("open"))
        high_price = _safe_float(candle.get("high"))
        low_price = _safe_float(candle.get("low"))
        close_price = _safe_float(candle.get("close"))
        x = scale_x(index)
        color = _SVG_COLORS["up"] if close_price >= open_price else _SVG_COLORS["down"]
        body_top = scale_y(max(open_price, close_price))
        body_bottom = scale_y(min(open_price, close_price))
        body_height = max(body_bottom - body_top, 2.0)
        candle_group.append(
            f'<line x1="{x:.2f}" y1="{scale_y(high_price):.2f}" x2="{x:.2f}" y2="{scale_y(low_price):.2f}" stroke="{color}" stroke-width="1.4" />'
        )
        candle_group.append(
            f'<rect x="{x - 3:.2f}" y="{body_top:.2f}" width="6" height="{body_height:.2f}" rx="1.5" fill="{color}" />'
        )

    point_map = result.get("points", {})
    point_elements: list[str] = []
    line_points: list[str] = []
    start_index = max(len(candles) - len(window), 0)
    for label in ("X", "A", "B", "C", "D"):
        point = point_map.get(label, {})
        point_index = max(int(point.get("index", 0)) - start_index, 0)
        x = scale_x(min(point_index, len(window) - 1))
        y = scale_y(_safe_float(point.get("price")))
        line_points.append(f"{x:.2f},{y:.2f}")
        point_elements.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5.5" fill="{_SVG_COLORS["pattern"]}" fill-opacity="0.15" stroke="{_SVG_COLORS["pattern"]}" stroke-width="2" />')
        point_elements.append(f'<text x="{x:.2f}" y="{y - 12:.2f}" fill="{_SVG_COLORS["text"]}" font-size="15" font-weight="700" text-anchor="middle">{label}</text>')

    prz = result.get("prz", {})
    prz_y1 = scale_y(_safe_float(prz.get("upper")))
    prz_y2 = scale_y(_safe_float(prz.get("lower")))
    d_index = max(int(point_map.get("D", {}).get("index", len(window) - 1)) - start_index, 0)
    prz_x = scale_x(min(d_index, len(window) - 1)) - 28

    horizontal_guides: list[str] = []
    for step in range(5):
        y = chart_top + floor((chart_height / 4) * step)
        horizontal_guides.append(
            f'<line x1="{chart_left}" y1="{y}" x2="{chart_left + chart_width}" y2="{y}" stroke="{_SVG_COLORS["grid"]}" stroke-width="1" stroke-dasharray="4 8" />'
        )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" rx="24" fill="{_SVG_COLORS["background"]}" />
  <rect x="28" y="28" width="{width - 56}" height="{height - 56}" rx="22" fill="{_SVG_COLORS["panel"]}" stroke="#1f2937" />
  <text x="56" y="74" fill="{_SVG_COLORS["text"]}" font-size="34" font-weight="700">{result["symbol"]} · {result["pattern"]}</text>
  <text x="{width - 56}" y="74" fill="{_SVG_COLORS["muted"]}" font-size="20" text-anchor="end">{result["side_label"]} · Score {result["score"]}</text>
  {''.join(horizontal_guides)}
  <rect x="{prz_x:.2f}" y="{min(prz_y1, prz_y2):.2f}" width="84" height="{abs(prz_y2 - prz_y1):.2f}" fill="{_SVG_COLORS["prz"]}" fill-opacity="0.12" stroke="{_SVG_COLORS["prz"]}" stroke-width="1.5" stroke-dasharray="6 6" />
  {''.join(candle_group)}
  <polyline points="{' '.join(line_points)}" fill="none" stroke="{_SVG_COLORS["pattern"]}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  {''.join(point_elements)}
  <text x="56" y="{height - 48}" fill="{_SVG_COLORS["muted"]}" font-size="18">{result["status_label"]} · TP1 {result["targets"]["tp1"]} · TP2 {result["targets"]["tp2"]} · SL {result["stop"]["value"]}</text>
</svg>
"""
    output_path.write_text(svg, encoding="utf-8")


def build_fallback_snapshot(
    *,
    timeframe: str,
    universe_key: str = "top100",
    generated_at: str | None = None,
) -> dict[str, Any]:
    stamp = generated_at or _utc_now_iso()
    score_adjustment = {"5m": 0.0, "15m": 0.8, "1h": 1.6, "4h": 2.4}.get(timeframe, 0.0)
    sample_results = [
        {
            "symbol": "SOLUSDT",
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "pattern": "Gartley",
            "pattern_key": "gartley",
            "side": "bullish",
            "side_label": "Bullish (매수)",
            "status": "touch",
            "status_label": SCANNER_STATUS_LABELS["touch"],
            "score": round(77.2 - score_adjustment, 1),
            "score_breakdown": {"ratio_fit": 31.4, "geometry": 18.3, "reaction": 12.0, "indicators": 14.5},
            "last_price": 80.0600,
            "change_24h": 2.84,
            "quote_volume": 1_280_000_000.0,
            "funding_rate": -0.0062,
            "open_interest_usd": 987_000_000.0,
            "long_short_ratio": 0.93,
            "points": {
                "X": {"price": 79.9200, "timestamp": "2026-04-04T07:45:00+00:00", "index": 24},
                "A": {"price": 80.5400, "timestamp": "2026-04-04T08:30:00+00:00", "index": 38},
                "B": {"price": 80.1500, "timestamp": "2026-04-04T08:55:00+00:00", "index": 49},
                "C": {"price": 80.4200, "timestamp": "2026-04-04T09:30:00+00:00", "index": 63},
                "D": {"price": 80.0600, "timestamp": "2026-04-04T10:30:00+00:00", "index": 79},
            },
            "ratios": {"xab": 0.629, "abc": 0.692, "bcd": 1.333, "xad": 0.774},
            "prz": {"lower": 79.9831, "upper": 80.0527, "center": 80.0180, "distance_pct": 0.052},
            "targets": {"tp1": 80.2336, "tp2": 80.3714},
            "stop": {"value": 79.1411, "label": "1.13 XA"},
            "indicator_flags": [
                {"key": "rsi", "label": "RSI", "status": "pass", "value": "41.5", "note": "과매도/과매수 구간 접근"},
                {"key": "macd", "label": "MACD", "status": "pass", "value": "0.0038", "note": "히스토그램 반전 확인"},
                {"key": "bollinger", "label": "Bollinger", "status": "pass", "value": "79.98 ~ 80.62", "note": "밴드 극단값 근접"},
                {"key": "vwap", "label": "VWAP", "status": "pass", "value": "80.17", "note": "VWAP 회복/이탈 흐름"},
            ],
            "summary": "Gartley 패턴이 PRZ 구간에 진입했고 실시간 터치 상태로 분류되었습니다.",
            "detail_slug": "solusdt-gartley-touch",
            "detail_page": f"patterns/{timeframe}/solusdt-gartley-touch/",
            "preview_image": f"generated/scanner/scan-{universe_key}-{timeframe}/solusdt-gartley-touch.svg",
            "external_links": {
                "binance": "https://www.binance.com/en/futures/SOLUSDT",
                "tradingview": "https://www.tradingview.com/chart/?symbol=BINANCE:SOLUSDT",
            },
        },
        {
            "symbol": "NIGHTUSDT",
            "timeframe": timeframe,
            "timeframe_label": TIMEFRAME_LABELS[timeframe],
            "pattern": "Bat",
            "pattern_key": "bat",
            "side": "bullish",
            "side_label": "Bullish (매수)",
            "status": "tbar_complete",
            "status_label": SCANNER_STATUS_LABELS["tbar_complete"],
            "score": round(70.1 - (score_adjustment / 2), 1),
            "score_breakdown": {"ratio_fit": 28.2, "geometry": 17.0, "reaction": 14.0, "indicators": 10.9},
            "last_price": 0.04196,
            "change_24h": 5.18,
            "quote_volume": 68_400_000.0,
            "funding_rate": -0.0114,
            "open_interest_usd": 12_400_000.0,
            "long_short_ratio": 0.88,
            "points": {
                "X": {"price": 0.04161, "timestamp": "2026-04-04T18:20:00+00:00", "index": 24},
                "A": {"price": 0.04348, "timestamp": "2026-04-04T19:40:00+00:00", "index": 36},
                "B": {"price": 0.04233, "timestamp": "2026-04-04T20:05:00+00:00", "index": 46},
                "C": {"price": 0.04305, "timestamp": "2026-04-04T20:15:00+00:00", "index": 58},
                "D": {"price": 0.04196, "timestamp": "2026-04-04T21:35:00+00:00", "index": 79},
            },
            "ratios": {"xab": 0.615, "abc": 0.626, "bcd": 1.514, "xad": 0.884},
            "prz": {"lower": 0.04180, "upper": 0.04212, "center": 0.04196, "distance_pct": 0.0},
            "targets": {"tp1": 0.04248, "tp2": 0.04288},
            "stop": {"value": 0.04137, "label": "1.13 XA"},
            "indicator_flags": [
                {"key": "rsi", "label": "RSI", "status": "pass", "value": "43.1", "note": "과매도/과매수 구간 접근"},
                {"key": "macd", "label": "MACD", "status": "pass", "value": "0.0002", "note": "히스토그램 반전 확인"},
                {"key": "funding", "label": "Funding", "status": "pass", "value": "-0.0114%", "note": "반대 포지션 과열 여부"},
            ],
            "summary": "Bat 패턴이 T-Bar 완성 구간으로 넘어가면서 반전 강도가 확인되었습니다.",
            "detail_slug": "nightusdt-bat-tbar",
            "detail_page": f"patterns/{timeframe}/nightusdt-bat-tbar/",
            "preview_image": f"generated/scanner/scan-{universe_key}-{timeframe}/nightusdt-bat-tbar.svg",
            "external_links": {
                "binance": "https://www.binance.com/en/futures/NIGHTUSDT",
                "tradingview": "https://www.tradingview.com/chart/?symbol=BINANCE:NIGHTUSDT",
            },
        },
    ]
    return build_snapshot(
        generated_at=stamp,
        universe_key=universe_key,
        timeframe=timeframe,
        symbols_scanned=UNIVERSE_PRESETS[universe_key]["limit"],
        results=sample_results,
        failures=[],
    )
