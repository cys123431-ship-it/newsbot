"""Build market dashboard payloads for the public static site."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timezone
from html import unescape
from math import ceil
import re
from typing import Any
from urllib.parse import urljoin

import httpx

from newsbot.config import Settings


MARKETS_DIRECTORY_NAME = "markets"
MARKETS_OVERVIEW_FILENAME = "markets-overview.json"
MARKETS_STOCKS_FILENAME = "markets-stocks.json"
MARKETS_CRYPTO_FILENAME = "markets-crypto.json"
MARKETS_STATUS_FILENAME = "markets-status.json"
DEFAULT_STOCKS_PROVIDER = "fmp"
DEFAULT_CRYPTO_PROVIDER = "coingecko"
PUBLIC_FINVIZ_PROVIDER = "finviz-public"
_STOCK_EXCHANGES = {"NASDAQ", "NYSE", "AMEX", "ARCA", "BATS", "CBOE"}
_FINVIZ_BASE_URL = "https://finviz.com/"
_FINVIZ_SCREENER_FILTER = "cap_largeover,sh_avgvol_o500,sh_price_o3"
_FINVIZ_SCREENER_SORT = "-marketcap"
_FINVIZ_PAGE_SIZE = 20
_FINVIZ_FALLBACK_MAX_ROWS = 100
_FINVIZ_ROW_PATTERN = re.compile(
    r'<tr class="styled-row[^"]*"[^>]*>(.*?)</tr>',
    re.S,
)
_FINVIZ_CELL_PATTERN = re.compile(r"<td\b[^>]*>(.*?)</td>", re.S)
_FINVIZ_SNAPSHOT_PAIR_PATTERN = re.compile(
    r'<td class="snapshot-td2[^>]*>(.*?)</td>\s*<td class="snapshot-td2[^>]*>(.*?)</td>',
    re.S,
)
_FINVIZ_TITLE_PATTERN = re.compile(r"<title>(.*?)</title>", re.S)
_HTML_TAG_PATTERN = re.compile(r"<[^>]+>")
_FIRST_NUMBER_PATTERN = re.compile(r"[-+]?\d[\d,]*\.?\d*")
_COMPACT_NUMBER_PATTERN = re.compile(r"([-+]?\d[\d,]*\.?\d*)\s*([KMBT])?", re.I)
_STOCK_PRESETS = (
    {"key": "all", "label": "All Stocks"},
    {"key": "mega", "label": "Mega Caps"},
    {"key": "gainers", "label": "Top Gainers"},
    {"key": "active", "label": "Most Active"},
    {"key": "value", "label": "Value"},
    {"key": "income", "label": "Income"},
)
_CRYPTO_PRESETS = (
    {"key": "all", "label": "All Coins"},
    {"key": "majors", "label": "Majors"},
    {"key": "gainers", "label": "Top Gainers"},
    {"key": "losers", "label": "Top Losers"},
    {"key": "active", "label": "Most Active"},
)
_STOCK_BENCHMARKS = ("SPY", "QQQ", "DIA", "IWM")
_CRYPTO_BENCHMARKS = ("BTC", "ETH", "SOL", "XRP")
_MARKET_NEWS_CATEGORIES = {"us-markets", "crypto"}


@dataclass(frozen=True, slots=True)
class MarketSnapshotRow:
    asset_type: str
    symbol: str
    name: str
    exchange: str
    country: str
    sector_or_category: str
    industry: str
    last: float | None
    change_pct: float | None
    market_cap: float | None
    volume: float | None
    avg_volume: float | None
    pe: float | None
    dividend_yield: float | None
    as_of: str | None
    detail_url: str
    high_52w: float | None = None
    low_52w: float | None = None

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "asset_type": self.asset_type,
            "symbol": self.symbol,
            "name": self.name,
            "exchange": self.exchange,
            "country": self.country,
            "sector_or_category": self.sector_or_category,
            "industry": self.industry,
            "last": self.last,
            "change_pct": self.change_pct,
            "market_cap": self.market_cap,
            "volume": self.volume,
            "avg_volume": self.avg_volume,
            "pe": self.pe,
            "dividend_yield": self.dividend_yield,
            "as_of": self.as_of,
            "detail_url": self.detail_url,
            "high_52w": self.high_52w,
            "low_52w": self.low_52w,
        }

    @classmethod
    def from_public_dict(cls, raw: dict[str, Any]) -> MarketSnapshotRow:
        return cls(
            asset_type=str(raw.get("asset_type") or "").strip(),
            symbol=str(raw.get("symbol") or "").strip(),
            name=str(raw.get("name") or "").strip(),
            exchange=str(raw.get("exchange") or "").strip(),
            country=str(raw.get("country") or "").strip(),
            sector_or_category=str(raw.get("sector_or_category") or "").strip(),
            industry=str(raw.get("industry") or "").strip(),
            last=_as_float(raw.get("last")),
            change_pct=_as_float(raw.get("change_pct")),
            market_cap=_as_float(raw.get("market_cap")),
            volume=_as_float(raw.get("volume")),
            avg_volume=_as_float(raw.get("avg_volume")),
            pe=_as_float(raw.get("pe")),
            dividend_yield=_as_float(raw.get("dividend_yield")),
            as_of=str(raw.get("as_of") or "").strip() or None,
            detail_url=str(raw.get("detail_url") or "").strip(),
            high_52w=_as_float(raw.get("high_52w")),
            low_52w=_as_float(raw.get("low_52w")),
        )


def build_markets_bundle(
    settings: Settings,
    news_payload: dict[str, Any],
    *,
    archive_bundle: dict[str, dict[str, Any] | None] | None = None,
    stock_dataset_builder: Any = None,
    crypto_dataset_builder: Any = None,
) -> dict[str, dict[str, Any]]:
    generated_at = str(
        news_payload.get("generated_at") or datetime.now(tz=timezone.utc).isoformat()
    )
    archive_bundle = archive_bundle or {}

    if not settings.markets_enabled:
        disabled_stocks = _empty_market_payload(
            asset_type="stock",
            generated_at=generated_at,
            provider=settings.markets_stocks_provider,
            status="warning",
            stale=False,
            message="Markets dashboard is disabled by NEWSBOT_MARKETS_ENABLED.",
        )
        disabled_crypto = _empty_market_payload(
            asset_type="crypto",
            generated_at=generated_at,
            provider=settings.markets_crypto_provider,
            status="warning",
            stale=False,
            message="Markets dashboard is disabled by NEWSBOT_MARKETS_ENABLED.",
        )
        status_payload = _build_markets_status_payload(
            generated_at,
            disabled_stocks,
            disabled_crypto,
        )
        overview_payload = _build_markets_overview_payload(
            generated_at,
            stocks_payload=disabled_stocks,
            crypto_payload=disabled_crypto,
            status_payload=status_payload,
            news_payload=news_payload,
        )
        return {
            "overview": overview_payload,
            "stocks": disabled_stocks,
            "crypto": disabled_crypto,
            "status": status_payload,
        }

    stock_builder = stock_dataset_builder or _build_stocks_dataset
    crypto_builder = crypto_dataset_builder or _build_crypto_dataset
    stock_payload = stock_builder(
        settings,
        generated_at=generated_at,
        archive_data=archive_bundle.get("stocks"),
    )
    crypto_payload = crypto_builder(
        settings,
        generated_at=generated_at,
        archive_data=archive_bundle.get("crypto"),
    )
    status_payload = _build_markets_status_payload(
        generated_at,
        stock_payload,
        crypto_payload,
    )
    overview_payload = _build_markets_overview_payload(
        generated_at,
        stocks_payload=stock_payload,
        crypto_payload=crypto_payload,
        status_payload=status_payload,
        news_payload=news_payload,
    )
    return {
        "overview": overview_payload,
        "stocks": stock_payload,
        "crypto": crypto_payload,
        "status": status_payload,
    }


def _build_stocks_dataset(
    settings: Settings,
    *,
    generated_at: str,
    archive_data: dict[str, Any] | None,
    finviz_dataset_builder: Any = None,
) -> dict[str, Any]:
    provider = settings.markets_stocks_provider
    finviz_builder = finviz_dataset_builder or _build_public_finviz_stocks_dataset
    if provider not in {"fmp", "finviz", PUBLIC_FINVIZ_PROVIDER}:
        return _reuse_or_empty_market_payload(
            archive_data,
            asset_type="stock",
            generated_at=generated_at,
            provider=provider,
            status="warning",
            message=f"Unsupported stocks provider: {provider}.",
        )
    if provider in {"finviz", PUBLIC_FINVIZ_PROVIDER}:
        return _build_public_finviz_or_reuse(
            settings,
            generated_at=generated_at,
            archive_data=archive_data,
            finviz_dataset_builder=finviz_builder,
            note=None,
        )

    if not settings.fmp_api_key:
        return _build_public_finviz_or_reuse(
            settings,
            generated_at=generated_at,
            archive_data=archive_data,
            finviz_dataset_builder=finviz_builder,
            note="Using public Finviz fallback because NEWSBOT_FMP_API_KEY is not configured.",
        )

    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=settings.request_timeout_sec,
            headers=_market_request_headers(),
        ) as client:
            screener_rows = _fetch_fmp_screener_rows(client, settings)
            quote_map = _fetch_fmp_batch_quotes(
                client,
                settings,
                [
                    str(row.get("symbol") or row.get("ticker") or "").strip()
                    for row in screener_rows
                ],
            )
            benchmark_quote_map = _fetch_fmp_batch_quotes(
                client,
                settings,
                list(_STOCK_BENCHMARKS),
            )

        rows = _normalize_fmp_stock_rows(
            screener_rows,
            quote_map,
            generated_at=generated_at,
            max_rows=settings.markets_max_stocks,
        )
        if not rows:
            raise RuntimeError("FMP returned no stock rows.")
        benchmark_rows = _normalize_fmp_benchmark_rows(
            benchmark_quote_map,
            generated_at=generated_at,
        )
        return _finalize_stocks_payload(
            rows,
            benchmark_rows,
            generated_at=generated_at,
            provider=provider,
            status="ok",
            stale=False,
            message=None,
        )
    except Exception as exc:
        return _build_public_finviz_or_reuse(
            settings,
            generated_at=generated_at,
            archive_data=archive_data,
            finviz_dataset_builder=finviz_builder,
            note=f"Using public Finviz fallback after FMP request failed: {exc}",
        )


def _build_crypto_dataset(
    settings: Settings,
    *,
    generated_at: str,
    archive_data: dict[str, Any] | None,
    market_rows_fetcher: Any = None,
    categories_fetcher: Any = None,
    trending_fetcher: Any = None,
) -> dict[str, Any]:
    provider = settings.markets_crypto_provider
    if provider != "coingecko":
        return _reuse_or_empty_market_payload(
            archive_data,
            asset_type="crypto",
            generated_at=generated_at,
            provider=provider,
            status="warning",
            message=f"Unsupported crypto provider: {provider}.",
        )

    market_fetcher = market_rows_fetcher or _fetch_coingecko_market_rows
    group_fetcher = categories_fetcher or _fetch_coingecko_categories
    trend_fetcher = trending_fetcher or _fetch_coingecko_trending
    archived_group_performance = list((archive_data or {}).get("group_performance") or [])
    archived_heatmap = list((archive_data or {}).get("heatmap") or [])
    archived_trending = list((archive_data or {}).get("trending") or [])

    try:
        with httpx.Client(
            follow_redirects=True,
            timeout=settings.request_timeout_sec,
            headers=_market_request_headers(),
        ) as client:
            market_rows = market_fetcher(client, settings)
            notes: list[str] = []
            group_performance = archived_group_performance
            heatmap = archived_heatmap
            trending = archived_trending

            try:
                categories = group_fetcher(client, settings)
            except Exception as exc:
                notes.append(f"Category view unavailable: {exc}")
            else:
                normalized_categories = _normalize_coingecko_categories(categories)
                group_performance = normalized_categories[:12]
                heatmap = _build_category_heatmap(normalized_categories[:24])

            try:
                trending = trend_fetcher(client, settings)[:10]
            except Exception as exc:
                notes.append(f"Trending view unavailable: {exc}")

        rows = _normalize_coingecko_rows(market_rows)
        if not rows:
            raise RuntimeError("CoinGecko markets returned no crypto rows.")
        return _finalize_crypto_payload(
            rows,
            group_performance=group_performance,
            heatmap=heatmap,
            trending=trending,
            generated_at=generated_at,
            provider=provider,
            status="ok",
            stale=False,
            message=_merge_notes(*notes),
        )
    except Exception as exc:
        return _reuse_or_empty_market_payload(
            archive_data,
            asset_type="crypto",
            generated_at=generated_at,
            provider=provider,
            status="warning",
            message=f"Crypto provider request failed: {exc}",
        )


def _build_public_finviz_or_reuse(
    settings: Settings,
    *,
    generated_at: str,
    archive_data: dict[str, Any] | None,
    finviz_dataset_builder: Any,
    note: str | None,
) -> dict[str, Any]:
    try:
        return finviz_dataset_builder(
            settings,
            generated_at=generated_at,
            archive_data=archive_data,
            note=note,
        )
    except Exception as exc:
        message = f"Public Finviz stocks request failed: {exc}"
        if note:
            message = f"{note} Public Finviz fallback failed: {exc}"
        return _reuse_or_empty_market_payload(
            archive_data,
            asset_type="stock",
            generated_at=generated_at,
            provider=PUBLIC_FINVIZ_PROVIDER,
            status="warning",
            message=message,
        )


def _build_public_finviz_stocks_dataset(
    settings: Settings,
    *,
    generated_at: str,
    archive_data: dict[str, Any] | None,
    note: str | None,
) -> dict[str, Any]:
    _ = archive_data
    effective_max_rows = min(
        max(settings.markets_max_stocks, 1),
        _FINVIZ_FALLBACK_MAX_ROWS,
    )
    with httpx.Client(
        follow_redirects=True,
        timeout=settings.request_timeout_sec,
        headers=_market_request_headers(),
    ) as client:
        rows = _fetch_finviz_screener_rows(
            client,
            generated_at=generated_at,
            max_rows=effective_max_rows,
        )
        benchmark_rows = _fetch_finviz_benchmark_rows(
            client,
            generated_at=generated_at,
        )
    if not rows:
        raise RuntimeError("Finviz screener returned no stock rows.")
    resolved_note = note
    if settings.markets_max_stocks > effective_max_rows:
        resolved_note = _merge_notes(
            resolved_note,
            f"Public Finviz snapshot is capped at the top {effective_max_rows} stocks to avoid rate limits.",
        )
    return _finalize_stocks_payload(
        rows,
        benchmark_rows,
        generated_at=generated_at,
        provider=PUBLIC_FINVIZ_PROVIDER,
        status="ok",
        stale=False,
        message=resolved_note,
    )


def _fetch_finviz_screener_rows(
    client: httpx.Client,
    *,
    generated_at: str,
    max_rows: int,
) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    seen_symbols: set[str] = set()
    max_pages = max(1, ceil(max(max_rows, 1) / _FINVIZ_PAGE_SIZE))
    for page_index in range(max_pages):
        params: dict[str, Any] = {
            "v": 111,
            "f": _FINVIZ_SCREENER_FILTER,
            "o": _FINVIZ_SCREENER_SORT,
        }
        start_index = page_index * _FINVIZ_PAGE_SIZE + 1
        if start_index > 1:
            params["r"] = start_index
        response = client.get(
            urljoin(_FINVIZ_BASE_URL, "screener.ashx"),
            params=params,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            if rows:
                break
            raise
        page_rows = _parse_finviz_screener_rows(
            response.text,
            generated_at=generated_at,
        )
        if not page_rows:
            break
        new_rows = 0
        for row in page_rows:
            if row.symbol in seen_symbols:
                continue
            seen_symbols.add(row.symbol)
            rows.append(row)
            new_rows += 1
            if len(rows) >= max_rows:
                return rows[:max_rows]
        if new_rows == 0 or len(page_rows) < _FINVIZ_PAGE_SIZE:
            break
    return rows[:max_rows]


def _fetch_finviz_benchmark_rows(
    client: httpx.Client,
    *,
    generated_at: str,
) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for symbol in _STOCK_BENCHMARKS:
        response = client.get(
            urljoin(_FINVIZ_BASE_URL, "quote.ashx"),
            params={"t": symbol, "p": "d"},
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            continue
        snapshot = _parse_finviz_quote_snapshot(response.text)
        rows.append(
            MarketSnapshotRow(
                asset_type="stock",
                symbol=symbol,
                name=_parse_finviz_quote_name(response.text, symbol),
                exchange="US",
                country="USA",
                sector_or_category="Benchmark",
                industry="ETF",
                last=_parse_first_number(snapshot.get("Price")),
                change_pct=_parse_percent_value(snapshot.get("Change")),
                market_cap=_parse_compact_number(snapshot.get("Market Cap")),
                volume=_parse_plain_number(snapshot.get("Volume")),
                avg_volume=_parse_plain_number(snapshot.get("Avg Volume")),
                pe=_parse_first_number(snapshot.get("P/E")),
                dividend_yield=_parse_percent_value(snapshot.get("Dividend")),
                as_of=generated_at,
                detail_url=f"https://finviz.com/quote.ashx?t={symbol}&p=d",
                high_52w=_parse_first_number(snapshot.get("52W High")),
                low_52w=_parse_first_number(snapshot.get("52W Low")),
            )
        )
    return rows


def _parse_finviz_screener_rows(
    html_text: str,
    *,
    generated_at: str,
) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for row_html in _FINVIZ_ROW_PATTERN.findall(html_text or ""):
        cells = _FINVIZ_CELL_PATTERN.findall(row_html)
        if len(cells) < 11:
            continue
        values = [_clean_html_fragment(cell) for cell in cells[:11]]
        symbol = values[1].strip().upper()
        if not symbol or not re.fullmatch(r"[A-Z.\-]+", symbol):
            continue
        rows.append(
            MarketSnapshotRow(
                asset_type="stock",
                symbol=symbol,
                name=values[2] or symbol,
                exchange="US",
                country=values[5] or "USA",
                sector_or_category=values[3] or "Unclassified",
                industry=values[4] or "Unknown",
                last=_parse_first_number(values[8]),
                change_pct=_parse_percent_value(values[9]),
                market_cap=_parse_compact_number(values[6]),
                volume=_parse_plain_number(values[10]),
                avg_volume=None,
                pe=_parse_first_number(values[7]),
                dividend_yield=None,
                as_of=generated_at,
                detail_url=f"https://finviz.com/quote.ashx?t={symbol}&p=d",
                high_52w=None,
                low_52w=None,
            )
        )
    return rows


def _parse_finviz_quote_snapshot(html_text: str) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for raw_label, raw_value in _FINVIZ_SNAPSHOT_PAIR_PATTERN.findall(html_text or ""):
        label = _clean_html_fragment(raw_label)
        value = _clean_html_fragment(raw_value)
        if label:
            snapshot[label] = value
    return snapshot


def _parse_finviz_quote_name(html_text: str, symbol: str) -> str:
    match = _FINVIZ_TITLE_PATTERN.search(html_text or "")
    if not match:
        return symbol
    title = _clean_html_fragment(match.group(1))
    prefix = f"{symbol} - "
    suffix = " Stock Price and Quote"
    if title.startswith(prefix) and title.endswith(suffix):
        return title[len(prefix):-len(suffix)].strip() or symbol
    return title or symbol


def _fetch_fmp_screener_rows(
    client: httpx.Client,
    settings: Settings,
) -> list[dict[str, Any]]:
    params = {
        "limit": min(max(settings.markets_max_stocks * 3, 180), 500),
        "apikey": settings.fmp_api_key,
    }
    response = client.get(
        "https://financialmodelingprep.com/stable/company-screener",
        params=params,
    )
    if response.status_code == 404:
        response = client.get(
            "https://financialmodelingprep.com/stable/stock-screener",
            params=params,
        )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("FMP screener returned a non-list payload.")
    return [row for row in payload if isinstance(row, dict)]


def _fetch_fmp_batch_quotes(
    client: httpx.Client,
    settings: Settings,
    symbols: list[str],
) -> dict[str, dict[str, Any]]:
    quote_map: dict[str, dict[str, Any]] = {}
    cleaned_symbols = [
        symbol.strip().upper()
        for symbol in symbols
        if isinstance(symbol, str) and symbol.strip()
    ]
    for index in range(0, len(cleaned_symbols), 40):
        chunk = cleaned_symbols[index:index + 40]
        if not chunk:
            continue
        response = client.get(
            "https://financialmodelingprep.com/stable/batch-quote",
            params={
                "symbols": ",".join(chunk),
                "apikey": settings.fmp_api_key,
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list):
            continue
        for entry in payload:
            if not isinstance(entry, dict):
                continue
            symbol = str(entry.get("symbol") or "").strip().upper()
            if symbol:
                quote_map[symbol] = entry
    return quote_map


def _normalize_fmp_stock_rows(
    screener_rows: list[dict[str, Any]],
    quote_map: dict[str, dict[str, Any]],
    *,
    generated_at: str,
    max_rows: int,
) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for raw in screener_rows:
        symbol = str(raw.get("symbol") or raw.get("ticker") or "").strip().upper()
        if not symbol:
            continue
        quote = quote_map.get(symbol, {})
        exchange = str(
            raw.get("exchangeShortName")
            or raw.get("exchange")
            or quote.get("exchange")
            or ""
        ).strip().upper()
        country = str(raw.get("country") or "").strip() or "US"
        if exchange and exchange not in _STOCK_EXCHANGES and country.upper() not in {"US", "USA"}:
            continue
        rows.append(
            MarketSnapshotRow(
                asset_type="stock",
                symbol=symbol,
                name=str(raw.get("companyName") or raw.get("name") or symbol).strip(),
                exchange=exchange or "US",
                country=country,
                sector_or_category=str(raw.get("sector") or "").strip() or "Unclassified",
                industry=str(raw.get("industry") or "").strip() or "Unknown",
                last=_as_float(quote.get("price") or raw.get("price")),
                change_pct=_as_float(
                    quote.get("changesPercentage")
                    or quote.get("changePercentage")
                    or raw.get("changesPercentage")
                    or raw.get("changePercentage")
                ),
                market_cap=_as_float(quote.get("marketCap") or raw.get("marketCap")),
                volume=_as_float(quote.get("volume") or raw.get("volume")),
                avg_volume=_as_float(quote.get("avgVolume") or raw.get("avgVolume")),
                pe=_as_float(raw.get("pe") or quote.get("pe")),
                dividend_yield=_normalize_percent(
                    _as_float(raw.get("dividendYield") or quote.get("dividendYield"))
                ),
                as_of=str(quote.get("timestamp") or quote.get("asOfDate") or generated_at),
                detail_url=f"https://finviz.com/quote.ashx?t={symbol}&p=d",
                high_52w=_as_float(quote.get("yearHigh") or raw.get("yearHigh")),
                low_52w=_as_float(quote.get("yearLow") or raw.get("yearLow")),
            )
        )

    rows.sort(
        key=lambda item: (
            _safe_number(item.market_cap),
            _safe_number(item.volume),
            item.symbol,
        ),
        reverse=True,
    )
    return rows[:max_rows]


def _normalize_fmp_benchmark_rows(
    quote_map: dict[str, dict[str, Any]],
    *,
    generated_at: str,
) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for symbol in _STOCK_BENCHMARKS:
        quote = quote_map.get(symbol, {})
        if not quote:
            continue
        rows.append(
            MarketSnapshotRow(
                asset_type="stock",
                symbol=symbol,
                name=str(quote.get("name") or symbol).strip(),
                exchange=str(quote.get("exchange") or "US").strip(),
                country="US",
                sector_or_category="Benchmark",
                industry="ETF",
                last=_as_float(quote.get("price")),
                change_pct=_as_float(
                    quote.get("changesPercentage") or quote.get("changePercentage")
                ),
                market_cap=_as_float(quote.get("marketCap")),
                volume=_as_float(quote.get("volume")),
                avg_volume=_as_float(quote.get("avgVolume")),
                pe=_as_float(quote.get("pe")),
                dividend_yield=_normalize_percent(_as_float(quote.get("dividendYield"))),
                as_of=str(quote.get("timestamp") or generated_at),
                detail_url=f"https://finviz.com/quote.ashx?t={symbol}&p=d",
                high_52w=_as_float(quote.get("yearHigh")),
                low_52w=_as_float(quote.get("yearLow")),
            )
        )
    return rows


def _fetch_coingecko_market_rows(
    client: httpx.Client,
    settings: Settings,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {
        "vs_currency": "usd",
        "order": "market_cap_desc",
        "per_page": min(max(settings.markets_max_coins, 25), 250),
        "page": 1,
        "sparkline": "false",
        "price_change_percentage": "24h",
    }
    if settings.coingecko_api_key:
        params["x_cg_demo_api_key"] = settings.coingecko_api_key
    response = client.get(
        "https://api.coingecko.com/api/v3/coins/markets",
        params=params,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("CoinGecko markets returned a non-list payload.")
    return [row for row in payload if isinstance(row, dict)]


def _fetch_coingecko_categories(
    client: httpx.Client,
    settings: Settings,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {}
    if settings.coingecko_api_key:
        params["x_cg_demo_api_key"] = settings.coingecko_api_key
    response = client.get("https://api.coingecko.com/api/v3/coins/categories", params=params)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("CoinGecko categories returned a non-list payload.")
    return [row for row in payload if isinstance(row, dict)]


def _fetch_coingecko_trending(
    client: httpx.Client,
    settings: Settings,
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {}
    if settings.coingecko_api_key:
        params["x_cg_demo_api_key"] = settings.coingecko_api_key
    response = client.get("https://api.coingecko.com/api/v3/search/trending", params=params)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("CoinGecko trending returned a non-dict payload.")
    items = payload.get("coins")
    if not isinstance(items, list):
        return []
    results: list[dict[str, Any]] = []
    for entry in items:
        if not isinstance(entry, dict):
            continue
        item = entry.get("item")
        if not isinstance(item, dict):
            continue
        slug = str(item.get("slug") or item.get("id") or "").strip()
        results.append(
            {
                "symbol": str(item.get("symbol") or "").upper(),
                "name": str(item.get("name") or "").strip(),
                "market_cap_rank": item.get("market_cap_rank"),
                "detail_url": (
                    f"https://www.coingecko.com/en/coins/{slug}"
                    if slug
                    else "https://www.coingecko.com/"
                ),
            }
        )
    return results[:10]


def _normalize_coingecko_rows(raw_rows: list[dict[str, Any]]) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for raw in raw_rows:
        coin_id = str(raw.get("id") or "").strip()
        symbol = str(raw.get("symbol") or "").strip().upper()
        if not coin_id or not symbol:
            continue
        rows.append(
            MarketSnapshotRow(
                asset_type="crypto",
                symbol=symbol,
                name=str(raw.get("name") or symbol).strip(),
                exchange="CoinGecko",
                country="Global",
                sector_or_category="",
                industry="Crypto",
                last=_as_float(raw.get("current_price")),
                change_pct=_as_float(raw.get("price_change_percentage_24h")),
                market_cap=_as_float(raw.get("market_cap")),
                volume=_as_float(raw.get("total_volume")),
                avg_volume=None,
                pe=None,
                dividend_yield=None,
                as_of=str(raw.get("last_updated") or "").strip() or None,
                detail_url=f"https://www.coingecko.com/en/coins/{coin_id}",
                high_52w=_as_float(raw.get("high_24h")),
                low_52w=_as_float(raw.get("low_24h")),
            )
        )
    rows.sort(
        key=lambda item: (
            _safe_number(item.market_cap),
            _safe_number(item.volume),
            item.symbol,
        ),
        reverse=True,
    )
    return rows


def _finalize_stocks_payload(
    rows: list[MarketSnapshotRow],
    benchmark_rows: list[MarketSnapshotRow],
    *,
    generated_at: str,
    provider: str,
    status: str,
    stale: bool,
    message: str | None,
) -> dict[str, Any]:
    return {
        "generated_at": generated_at,
        "asset_type": "stock",
        "provider": provider,
        "status": status,
        "stale": stale,
        "message": message,
        "as_of": _resolve_latest_as_of(rows, generated_at),
        "row_count": len(rows),
        "presets": list(_STOCK_PRESETS),
        "filter_options": {
            "exchanges": _sorted_unique(row.exchange for row in rows if row.exchange),
            "sectors": _sorted_unique(
                row.sector_or_category for row in rows if row.sector_or_category
            ),
            "industries": _sorted_unique(row.industry for row in rows if row.industry),
        },
        "rows": [row.to_public_dict() for row in rows],
        "benchmarks": [row.to_public_dict() for row in (benchmark_rows or rows[:4])],
        "breadth": _build_breadth_payload(rows),
        "movers": _build_mover_payload(rows),
        "group_performance": _build_group_performance(rows),
        "heatmap": _build_equity_heatmap(rows),
    }


def _finalize_crypto_payload(
    rows: list[MarketSnapshotRow],
    *,
    group_performance: list[dict[str, Any]],
    heatmap: list[dict[str, Any]],
    trending: list[dict[str, Any]],
    generated_at: str,
    provider: str,
    status: str,
    stale: bool,
    message: str | None,
) -> dict[str, Any]:
    benchmarks = [row.to_public_dict() for row in rows if row.symbol in _CRYPTO_BENCHMARKS]
    if not benchmarks:
        benchmarks = [row.to_public_dict() for row in rows[:4]]
    return {
        "generated_at": generated_at,
        "asset_type": "crypto",
        "provider": provider,
        "status": status,
        "stale": stale,
        "message": message,
        "as_of": _resolve_latest_as_of(rows, generated_at),
        "row_count": len(rows),
        "presets": list(_CRYPTO_PRESETS),
        "filter_options": {},
        "rows": [row.to_public_dict() for row in rows],
        "benchmarks": benchmarks,
        "breadth": _build_breadth_payload(rows),
        "movers": _build_mover_payload(rows),
        "group_performance": list(group_performance)[:12],
        "heatmap": list(heatmap)[:24],
        "trending": trending[:10],
    }


def _reuse_or_empty_market_payload(
    archive_data: dict[str, Any] | None,
    *,
    asset_type: str,
    generated_at: str,
    provider: str,
    status: str,
    message: str,
) -> dict[str, Any]:
    if archive_data:
        payload = dict(archive_data)
        payload["generated_at"] = generated_at
        payload["provider"] = provider
        payload["status"] = status
        payload["stale"] = True
        payload["message"] = message
        return payload
    return _empty_market_payload(
        asset_type=asset_type,
        generated_at=generated_at,
        provider=provider,
        status=status,
        stale=False,
        message=message,
    )


def _empty_market_payload(
    *,
    asset_type: str,
    generated_at: str,
    provider: str,
    status: str,
    stale: bool,
    message: str | None,
) -> dict[str, Any]:
    payload = {
        "generated_at": generated_at,
        "asset_type": asset_type,
        "provider": provider,
        "status": status,
        "stale": stale,
        "message": message,
        "as_of": None,
        "row_count": 0,
        "presets": list(_STOCK_PRESETS if asset_type == "stock" else _CRYPTO_PRESETS),
        "filter_options": (
            {"exchanges": [], "sectors": [], "industries": []}
            if asset_type == "stock"
            else {}
        ),
        "rows": [],
        "benchmarks": [],
        "breadth": _build_breadth_payload([]),
        "movers": _build_mover_payload([]),
        "group_performance": [],
        "heatmap": [],
    }
    if asset_type == "crypto":
        payload["trending"] = []
    return payload


def _build_markets_status_payload(
    generated_at: str,
    stocks_payload: dict[str, Any],
    crypto_payload: dict[str, Any],
) -> dict[str, Any]:
    providers = {
        "stocks": _dataset_status_entry(stocks_payload),
        "crypto": _dataset_status_entry(crypto_payload),
    }
    statuses = [entry["status"] for entry in providers.values()]
    overall_status = "ok"
    if "failed" in statuses:
        overall_status = "failed"
    elif "warning" in statuses:
        overall_status = "warning"
    return {
        "generated_at": generated_at,
        "overall_status": overall_status,
        "providers": providers,
    }


def _dataset_status_entry(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": payload.get("status", "warning"),
        "stale": bool(payload.get("stale")),
        "provider": payload.get("provider"),
        "message": payload.get("message"),
        "as_of": payload.get("as_of"),
        "row_count": int(payload.get("row_count") or 0),
    }


def _build_markets_overview_payload(
    generated_at: str,
    *,
    stocks_payload: dict[str, Any],
    crypto_payload: dict[str, Any],
    status_payload: dict[str, Any],
    news_payload: dict[str, Any],
) -> dict[str, Any]:
    stock_rows = _dataset_rows(stocks_payload)
    crypto_rows = _dataset_rows(crypto_payload)
    stock_breadth = stocks_payload.get("breadth") or _build_breadth_payload(stock_rows)
    crypto_breadth = crypto_payload.get("breadth") or _build_breadth_payload(crypto_rows)
    return {
        "generated_at": generated_at,
        "top_cards": [
            {
                "label": "US stocks tracked",
                "value": len(stock_rows),
                "detail": stocks_payload.get("message") or stocks_payload.get("provider"),
                "status": stocks_payload.get("status", "warning"),
            },
            {
                "label": "Crypto assets tracked",
                "value": len(crypto_rows),
                "detail": crypto_payload.get("message") or crypto_payload.get("provider"),
                "status": crypto_payload.get("status", "warning"),
            },
            {
                "label": "Stock advancers",
                "value": int(stock_breadth.get("advancers") or 0),
                "detail": f"Decliners {int(stock_breadth.get('decliners') or 0)}",
                "status": stocks_payload.get("status", "warning"),
            },
            {
                "label": "Crypto advancers",
                "value": int(crypto_breadth.get("advancers") or 0),
                "detail": f"Decliners {int(crypto_breadth.get('decliners') or 0)}",
                "status": crypto_payload.get("status", "warning"),
            },
        ],
        "status": status_payload,
        "stocks": {
            "status": stocks_payload.get("status", "warning"),
            "stale": bool(stocks_payload.get("stale")),
            "message": stocks_payload.get("message"),
            "benchmarks": list(stocks_payload.get("benchmarks") or []),
            "breadth": stock_breadth,
            "top_gainers": list((stocks_payload.get("movers") or {}).get("gainers", []))[:6],
            "top_losers": list((stocks_payload.get("movers") or {}).get("losers", []))[:6],
            "most_active": list((stocks_payload.get("movers") or {}).get("active", []))[:6],
            "group_performance": list(stocks_payload.get("group_performance") or [])[:8],
            "heatmap": list(stocks_payload.get("heatmap") or [])[:24],
        },
        "crypto": {
            "status": crypto_payload.get("status", "warning"),
            "stale": bool(crypto_payload.get("stale")),
            "message": crypto_payload.get("message"),
            "benchmarks": list(crypto_payload.get("benchmarks") or []),
            "breadth": crypto_breadth,
            "top_gainers": list((crypto_payload.get("movers") or {}).get("gainers", []))[:6],
            "top_losers": list((crypto_payload.get("movers") or {}).get("losers", []))[:6],
            "most_active": list((crypto_payload.get("movers") or {}).get("active", []))[:6],
            "group_performance": list(crypto_payload.get("group_performance") or [])[:8],
            "heatmap": list(crypto_payload.get("heatmap") or [])[:24],
            "trending": list(crypto_payload.get("trending") or [])[:8],
        },
        "market_news": _build_market_news(news_payload),
    }


def _dataset_rows(payload: dict[str, Any]) -> list[MarketSnapshotRow]:
    rows: list[MarketSnapshotRow] = []
    for raw in payload.get("rows", []):
        if not isinstance(raw, dict):
            continue
        try:
            rows.append(MarketSnapshotRow.from_public_dict(raw))
        except Exception:
            continue
    return rows


def _build_breadth_payload(rows: list[MarketSnapshotRow]) -> dict[str, int]:
    advancers = 0
    decliners = 0
    unchanged = 0
    new_highs = 0
    new_lows = 0
    for row in rows:
        change_pct = row.change_pct or 0.0
        if change_pct > 0:
            advancers += 1
        elif change_pct < 0:
            decliners += 1
        else:
            unchanged += 1
        if row.high_52w and row.last and row.last >= row.high_52w * 0.995:
            new_highs += 1
        if row.low_52w and row.last and row.last <= row.low_52w * 1.005:
            new_lows += 1
    return {
        "advancers": advancers,
        "decliners": decliners,
        "unchanged": unchanged,
        "new_highs": new_highs,
        "new_lows": new_lows,
    }


def _build_mover_payload(rows: list[MarketSnapshotRow]) -> dict[str, list[dict[str, Any]]]:
    comparable_rows = [row for row in rows if row.change_pct is not None]
    gainers = sorted(
        comparable_rows,
        key=lambda row: (row.change_pct or 0.0, _safe_number(row.volume)),
        reverse=True,
    )[:12]
    losers = sorted(
        comparable_rows,
        key=lambda row: (row.change_pct or 0.0, _safe_number(row.volume)),
    )[:12]
    active = sorted(
        rows,
        key=lambda row: (_safe_number(row.volume), _safe_number(row.market_cap)),
        reverse=True,
    )[:12]
    return {
        "gainers": [_compact_row_dict(row) for row in gainers],
        "losers": [_compact_row_dict(row) for row in losers],
        "active": [_compact_row_dict(row) for row in active],
    }


def _build_group_performance(rows: list[MarketSnapshotRow]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, float | str]] = {}
    for row in rows:
        label = row.sector_or_category or "Other"
        entry = grouped.setdefault(
            label,
            {"label": label, "market_cap": 0.0, "weighted_change": 0.0, "count": 0.0},
        )
        weight = _safe_number(row.market_cap) or 1.0
        entry["market_cap"] = float(entry["market_cap"]) + weight
        entry["weighted_change"] = float(entry["weighted_change"]) + weight * (
            row.change_pct or 0.0
        )
        entry["count"] = float(entry["count"]) + 1.0

    items: list[dict[str, Any]] = []
    for entry in grouped.values():
        market_cap = float(entry["market_cap"])
        weighted_change = float(entry["weighted_change"])
        items.append(
            {
                "label": str(entry["label"]),
                "market_cap": market_cap,
                "count": int(entry["count"]),
                "change_pct": (weighted_change / market_cap) if market_cap else 0.0,
            }
        )
    items.sort(key=lambda item: (item["market_cap"], item["change_pct"]), reverse=True)
    return items


def _build_equity_heatmap(rows: list[MarketSnapshotRow]) -> list[dict[str, Any]]:
    top_rows = sorted(
        rows,
        key=lambda row: (_safe_number(row.market_cap), abs(row.change_pct or 0.0)),
        reverse=True,
    )[:36]
    if not top_rows:
        return []
    max_market_cap = max(_safe_number(row.market_cap) for row in top_rows) or 1.0
    items: list[dict[str, Any]] = []
    for row in top_rows:
        items.append(
            {
                "label": row.symbol,
                "subLabel": row.sector_or_category or row.industry or row.exchange,
                "change_pct": row.change_pct or 0.0,
                "value": _safe_number(row.market_cap),
                "size": max(
                    1,
                    min(
                        4,
                        int(ceil((_safe_number(row.market_cap) / max_market_cap) * 4)),
                    ),
                ),
                "detail_url": row.detail_url,
            }
        )
    return items


def _normalize_coingecko_categories(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for row in categories:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        items.append(
            {
                "label": name,
                "market_cap": _as_float(row.get("market_cap")) or 0.0,
                "change_pct": _as_float(row.get("market_cap_change_24h")) or 0.0,
                "volume": _as_float(row.get("volume_24h")) or 0.0,
            }
        )
    items.sort(key=lambda item: (item["market_cap"], item["change_pct"]), reverse=True)
    return items


def _build_category_heatmap(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not categories:
        return []
    max_market_cap = max(item["market_cap"] for item in categories) or 1.0
    items: list[dict[str, Any]] = []
    for item in categories:
        items.append(
            {
                "label": item["label"],
                "subLabel": "Category",
                "change_pct": item["change_pct"],
                "value": item["market_cap"],
                "size": max(
                    1,
                    min(4, int(ceil((item["market_cap"] / max_market_cap) * 4))),
                ),
                "detail_url": "https://www.coingecko.com/en/categories",
            }
        )
    return items


def _build_market_news(news_payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_articles = news_payload.get("articles")
    if not isinstance(raw_articles, list):
        return []
    items: list[dict[str, Any]] = []
    for raw in raw_articles:
        if not isinstance(raw, dict):
            continue
        if str(raw.get("primary_category") or "").strip() not in _MARKET_NEWS_CATEGORIES:
            continue
        items.append(
            {
                "title": str(raw.get("title") or "").strip(),
                "source_name": str(raw.get("source_name") or "").strip(),
                "canonical_url": str(raw.get("canonical_url") or "").strip(),
                "published_at": str(raw.get("published_at") or "").strip() or None,
                "section_label": str(raw.get("section_label") or "").strip(),
            }
        )
    items.sort(key=lambda item: str(item.get("published_at") or ""), reverse=True)
    return [item for item in items if item["title"] and item["canonical_url"]][:10]


def _resolve_latest_as_of(rows: list[MarketSnapshotRow], fallback: str) -> str:
    values = [row.as_of for row in rows if row.as_of]
    if not values:
        return fallback
    return sorted(values)[-1]


def _compact_row_dict(row: MarketSnapshotRow) -> dict[str, Any]:
    return {
        "symbol": row.symbol,
        "name": row.name,
        "change_pct": row.change_pct,
        "last": row.last,
        "market_cap": row.market_cap,
        "volume": row.volume,
        "detail_url": row.detail_url,
    }


def _sorted_unique(values: Any) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def _market_request_headers() -> dict[str, str]:
    return {
        "User-Agent": "Mozilla/5.0 (compatible; newsbot-markets/0.2)",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": _FINVIZ_BASE_URL,
    }


def _clean_html_fragment(value: str) -> str:
    text = unescape(_HTML_TAG_PATTERN.sub(" ", value or ""))
    return " ".join(text.split())


def _merge_notes(*parts: str | None) -> str | None:
    cleaned = [str(part).strip() for part in parts if str(part or "").strip()]
    if not cleaned:
        return None
    return " ".join(cleaned)


def _parse_first_number(value: Any) -> float | None:
    text = str(value or "").strip()
    match = _FIRST_NUMBER_PATTERN.search(text.replace("%", ""))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def _parse_plain_number(value: Any) -> float | None:
    return _parse_first_number(value)


def _parse_percent_value(value: Any) -> float | None:
    return _parse_first_number(value)


def _parse_compact_number(value: Any) -> float | None:
    text = str(value or "").strip().upper()
    if not text or text == "-":
        return None
    match = _COMPACT_NUMBER_PATTERN.search(text)
    if not match:
        return None
    try:
        number = float(match.group(1).replace(",", ""))
    except ValueError:
        return None
    suffix = (match.group(2) or "").upper()
    multiplier = {
        "": 1.0,
        "K": 1_000.0,
        "M": 1_000_000.0,
        "B": 1_000_000_000.0,
        "T": 1_000_000_000_000.0,
    }.get(suffix, 1.0)
    return number * multiplier


def _normalize_percent(value: float | None) -> float | None:
    if value is None:
        return None
    if 0 < abs(value) <= 1:
        return value * 100
    return value


def _safe_number(value: float | None) -> float:
    return float(value or 0.0)


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
