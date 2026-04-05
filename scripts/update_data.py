from __future__ import annotations

import asyncio
from datetime import datetime
from datetime import timedelta
from datetime import timezone
import json
from pathlib import Path
import shutil
import sys
from typing import Any

import httpx


ROOT_DIR = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT_DIR / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from newsbot.scanner import UNIVERSE_PRESETS
from newsbot.scanner import build_fallback_snapshot
from newsbot.scanner import build_manifest
from newsbot.scanner import build_snapshot
from newsbot.scanner import detect_pattern_match
from newsbot.scanner import generate_preview_svg


BASE_URL = "https://fapi.binance.com"
PUBLIC_DATA_DIR = ROOT_DIR / "public" / "data" / "scanner"
PUBLIC_GENERATED_DIR = ROOT_DIR / "public" / "generated" / "scanner"
UNIVERSE_KEY = "top100"
TIMEFRAMES = ("5m", "15m", "1h", "4h")
REQUEST_TIMEOUT = 20.0
REQUEST_CONCURRENCY = 8
KLINE_LIMIT = 180


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

    pairs = await asyncio.gather(*(worker(symbol) for symbol in symbols))
    return dict(pairs)


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

    pairs = await asyncio.gather(*(worker(symbol) for symbol in symbols))
    return dict(pairs), failures


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
    timeframe: str,
    snapshot: dict[str, Any],
    candles_by_symbol: dict[str, list[dict[str, Any]]],
) -> None:
    scan_dir = PUBLIC_GENERATED_DIR / snapshot["scan_id"]
    scan_dir.mkdir(parents=True, exist_ok=True)
    for result in snapshot["results"]:
        image_name = f"{_slugify(result['symbol'])}-{_slugify(result['pattern'])}-{_slugify(result['status'])}.svg"
        image_path = scan_dir / image_name
        result["preview_image"] = f"generated/scanner/{snapshot['scan_id']}/{image_name}"
        candles = candles_by_symbol.get(result["symbol"]) or _build_preview_candles(result)
        generate_preview_svg(result=result, candles=candles, output_path=image_path)
        result["detail_page"] = result.get("detail_page") or f"patterns/{timeframe}/{_slugify(result['symbol'])}/"


async def _scan_all() -> list[dict[str, Any]]:
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
        except httpx.HTTPError:
            return [
                build_fallback_snapshot(timeframe=timeframe, generated_at=generated_at)
                for timeframe in TIMEFRAMES
            ]

        snapshots: list[dict[str, Any]] = []
        for timeframe in TIMEFRAMES:
            candles_by_symbol, failures = await _load_candles_for_timeframe(client, symbols, timeframe)
            results = []
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

            if not results:
                snapshot = build_fallback_snapshot(
                    timeframe=timeframe,
                    universe_key=UNIVERSE_KEY,
                    generated_at=generated_at,
                )
            else:
                snapshot = build_snapshot(
                    generated_at=generated_at,
                    universe_key=UNIVERSE_KEY,
                    timeframe=timeframe,
                    symbols_scanned=len(symbols),
                    results=results,
                    failures=failures,
                )
            _decorate_results(timeframe=timeframe, snapshot=snapshot, candles_by_symbol=candles_by_symbol)
            snapshots.append(snapshot)

        return snapshots


def main() -> None:
    _clean_output_directories()
    snapshots = asyncio.run(_scan_all())
    manifest = build_manifest(snapshots)
    for snapshot in snapshots:
        _write_json(
            PUBLIC_DATA_DIR / f"scan-{snapshot['universe_key']}-{snapshot['timeframe']}.json",
            snapshot,
        )
    _write_json(PUBLIC_DATA_DIR / "manifest.json", manifest)
    print(
        f"Updated scanner dataset with {len(snapshots)} snapshots and "
        f"{manifest['total_results']} results."
    )


if __name__ == "__main__":
    main()
