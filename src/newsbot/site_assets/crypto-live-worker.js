"use strict";

const BINANCE_BASE_URL = "https://fapi.binance.com";
const KLINE_LIMIT = 220;
const REQUEST_CONCURRENCY = 10;
const TIMEFRAMES = ["5m", "15m", "1h", "4h"];
const TIMEFRAME_LABELS = {
  "5m": "5분 (5m)",
  "15m": "15분 (15m)",
  "1h": "1시간 (1h)",
  "4h": "4시간 (4h)",
};
const UNIVERSE_PRESETS = {
  top100: { label: "상위 100개 종목", limit: 100, multiTimeframeLimit: 100 },
};

const CACHE_TTL_MS = 90_000;
const universeCache = new Map();
const pageCache = new Map();
const analysisCache = new Map();

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "load-page") {
    return;
  }

  try {
    const payload = await loadPagePayload(message);
    self.postMessage({ id: message.id, ok: true, payload });
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error || "unknown error"),
    });
  }
};

async function loadPagePayload({ pageKey, timeframe, universeKey = "top100", force = false }) {
  const cacheKey = [pageKey, timeframe, universeKey].join("|");
  const cached = pageCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.storedAt <= CACHE_TTL_MS) {
    return cached.payload;
  }

  const universe = await loadUniverse(universeKey, force);
  const generatedAt = new Date().toISOString();
  let payload;
  if (pageKey === "overview") {
    payload = await buildOverviewPayload({ generatedAt, universeKey, timeframe, universe, force });
  } else if (pageKey === "multi_timeframe") {
    payload = await buildMultiTimeframePayload({ generatedAt, universeKey, universe, force });
  } else if (pageKey === "patterns") {
    payload = buildPatternsNoticePayload({ generatedAt, universeKey, timeframe, universe });
  } else {
    payload = await buildSingleTimeframePayload({
      pageKey,
      generatedAt,
      universeKey,
      timeframe,
      universe,
      force,
    });
  }

  pageCache.set(cacheKey, { storedAt: Date.now(), payload });
  return payload;
}

async function loadUniverse(universeKey, force = false) {
  const preset = UNIVERSE_PRESETS[universeKey] || UNIVERSE_PRESETS.top100;
  const cached = universeCache.get(universeKey);
  if (!force && cached && Date.now() - cached.storedAt <= CACHE_TTL_MS) {
    return cached.data;
  }

  const [tickerRows, premiumRows] = await Promise.all([
    fetchJson("/fapi/v1/ticker/24hr"),
    fetchJson("/fapi/v1/premiumIndex"),
  ]);

  const premiumLookup = {};
  const tradableSymbols = new Set();
  for (const row of Array.isArray(premiumRows) ? premiumRows : []) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol.endsWith("USDT")) {
      continue;
    }
    tradableSymbols.add(symbol);
    premiumLookup[symbol] = safeNumber(row.lastFundingRate) * 100;
  }

  const tickerLookup = {};
  for (const row of Array.isArray(tickerRows) ? tickerRows : []) {
    const symbol = String(row.symbol || "").toUpperCase();
    if (!symbol.endsWith("USDT") || symbol.endsWith("BUSD")) {
      continue;
    }
    if (!tradableSymbols.has(symbol)) {
      continue;
    }
    const quoteVolume = safeNumber(row.quoteVolume);
    if (quoteVolume <= 0) {
      continue;
    }
    tickerLookup[symbol] = {
      symbol,
      last_price: safeNumber(row.lastPrice),
      change_24h: safeNumber(row.priceChangePercent),
      quote_volume: quoteVolume,
      count: safeNumber(row.count),
    };
  }

  const symbols = Object.keys(tickerLookup)
    .sort((left, right) => tickerLookup[right].quote_volume - tickerLookup[left].quote_volume)
    .slice(0, preset.limit);

  const data = { universeKey, preset, symbols, tickerLookup, premiumLookup };
  universeCache.set(universeKey, { storedAt: Date.now(), data });
  return data;
}

async function buildOverviewPayload({ generatedAt, universeKey, timeframe, universe, force }) {
  const symbols = universe.symbols.slice(0, universe.preset.limit);
  const [analyses, analysesByTimeframe] = await Promise.all([
    getAnalysesForTimeframe({
      timeframe,
      universe,
      universeKey,
      symbols,
      force,
    }),
    loadAnalysesByTimeframe({
      timeframes: TIMEFRAMES,
      universe,
      universeKey,
      symbols,
      force,
    }),
  ]);

  const payload = buildPayloadForPage({
    pageKey: "overview",
    generatedAt,
    universeKey,
    timeframe,
    analyses,
    universe,
    coverageNote: `실시간 기준 ${analyses.length}/${universe.symbols.length}개 심볼 계산`,
    strongRecommendations: buildStrongRecommendations(analysesByTimeframe),
  });

  if (!payload.top_opportunities?.length && !payload.top_signals?.length) {
    throw new Error("No live rows were produced for the overview page.");
  }
  return payload;
}

async function buildSingleTimeframePayload({ pageKey, generatedAt, universeKey, timeframe, universe, force }) {
  const analyses = await getAnalysesForTimeframe({
    timeframe,
    universe,
    universeKey,
    symbols: universe.symbols.slice(0, universe.preset.limit),
    force,
  });

  const payload = buildPayloadForPage({
    pageKey,
    generatedAt,
    universeKey,
    timeframe,
    analyses,
    universe,
    coverageNote: `실시간 기준 ${analyses.length}/${universe.symbols.length}개 심볼 계산`,
  });

  if (!payload.rows?.length && !payload.top_opportunities?.length) {
    throw new Error("No live rows were produced for the requested page.");
  }
  return payload;
}

async function buildMultiTimeframePayload({ generatedAt, universeKey, universe, force }) {
  const symbols = universe.symbols.slice(0, universe.preset.multiTimeframeLimit);
  const analysesByTimeframe = await loadAnalysesByTimeframe({
    timeframes: TIMEFRAMES,
    universe,
    universeKey,
    symbols,
    force,
  });

  const matrix = {};
  for (const timeframe of TIMEFRAMES) {
    for (const row of analysesByTimeframe[timeframe]) {
      if (!matrix[row.symbol]) {
        matrix[row.symbol] = {};
      }
      matrix[row.symbol][timeframe] = row;
    }
  }

  const rows = Object.entries(matrix).map(([symbol, byTimeframe]) => {
    let bullish = 0;
    let bearish = 0;
    const timeframes = {};
    const anchor = byTimeframe["5m"] || byTimeframe["15m"] || byTimeframe["1h"] || byTimeframe["4h"];
    for (const timeframe of TIMEFRAMES) {
      const row = byTimeframe[timeframe];
      if (!row) continue;
      timeframes[timeframe] = {
        side: row.side,
        side_label: row.side_label,
        technical_rating: row.labels.technical_rating,
        trend_bias: row.labels.trend_bias,
        momentum_bias: row.labels.momentum_bias,
        opportunity: row.scores.opportunity,
      };
      if (row.side === "long") bullish += 1;
      if (row.side === "short") bearish += 1;
    }
    const consensus_label = bullish >= 3 ? "상승 합의" : bearish >= 3 ? "하락 합의" : "혼합";
    return {
      symbol,
      last_price: safeNumber(anchor && anchor.last_price),
      change_24h: safeNumber(anchor && anchor.change_24h),
      agreement_score: round(((bullish - bearish) / TIMEFRAMES.length) * 100, 1),
      consensus_label,
      primary: anchor,
      timeframes,
    };
  });

  rows.sort(
    (left, right) =>
      Math.abs(right.agreement_score) - Math.abs(left.agreement_score) ||
      left.symbol.localeCompare(right.symbol),
  );

  return {
    page_key: "multi_timeframe",
    page_label: "멀티 타임프레임",
    generated_at: generatedAt,
    data_source: "binance_live",
    universe_key: universeKey,
    universe_label: universe.preset.label,
    timeframe: "5m",
    timeframe_label: TIMEFRAME_LABELS["5m"],
    coverage_note: `멀티 타임프레임 실시간 집계 ${rows.length}/${universe.symbols.length}개 심볼 기준`,
    counts: {
      bullish: rows.filter((row) => row.consensus_label === "상승 합의").length,
      bearish: rows.filter((row) => row.consensus_label === "하락 합의").length,
      mixed: rows.filter((row) => row.consensus_label === "혼합").length,
    },
    rows: rows.slice(0, 60),
  };
}

async function loadAnalysesByTimeframe({ timeframes, universe, universeKey, symbols, force }) {
  const entries = await Promise.all(
    timeframes.map(async (timeframe) => [
      timeframe,
      await getAnalysesForTimeframe({
        timeframe,
        universe,
        universeKey,
        symbols,
        force,
      }),
    ]),
  );
  return Object.fromEntries(entries);
}

async function getAnalysesForTimeframe({ timeframe, universe, universeKey, symbols, force = false }) {
  const cacheKey = [universeKey, timeframe, symbols.length].join("|");
  const cached = analysisCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.storedAt <= CACHE_TTL_MS) {
    return cached.analyses;
  }

  const contextPromise = loadSymbolContexts(symbols, universe.tickerLookup, timeframe);
  const candlesPromise = loadCandles(symbols, timeframe);
  const [contexts, candleResult] = await Promise.all([contextPromise, candlesPromise]);
  const analyses = [];
  for (const symbol of symbols) {
    const candles = candleResult.candlesBySymbol[symbol] || [];
    if (candles.length < 60) {
      continue;
    }
    const context = contexts[symbol] || {};
    analyses.push(
      buildSymbolAnalysis({
        symbol,
        timeframe,
        candles,
        ticker: universe.tickerLookup[symbol],
        fundingRate: universe.premiumLookup[symbol],
        openInterestUsd: context.open_interest_usd,
        longShortRatio: context.long_short_ratio,
      }),
    );
  }
  analysisCache.set(cacheKey, { storedAt: Date.now(), analyses });
  return analyses;
}

async function loadSymbolContexts(symbols, tickerLookup, timeframe) {
  const longShortPeriod = ["5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d"].includes(timeframe)
    ? timeframe
    : "5m";

  const entries = await mapConcurrent(symbols, REQUEST_CONCURRENCY, async (symbol) => {
    try {
      const [openInterestPayload, longShortPayload] = await Promise.all([
        fetchJson("/fapi/v1/openInterest", { symbol }),
        fetchJson("/futures/data/globalLongShortAccountRatio", {
          symbol,
          period: longShortPeriod,
          limit: 1,
        }),
      ]);
      const openInterest = safeNumber(openInterestPayload.openInterest);
      const lastPrice = safeNumber(tickerLookup[symbol] && tickerLookup[symbol].last_price);
      const longShortRatio =
        Array.isArray(longShortPayload) && longShortPayload.length
          ? safeNumber(longShortPayload[longShortPayload.length - 1].longShortRatio, null)
          : null;
      return [
        symbol,
        {
          open_interest_usd: openInterest * lastPrice,
          long_short_ratio: longShortRatio,
        },
      ];
    } catch (_) {
      return [symbol, { open_interest_usd: null, long_short_ratio: null }];
    }
  });

  return Object.fromEntries(entries);
}

async function loadCandles(symbols, timeframe) {
  const failures = [];
  const entries = await mapConcurrent(symbols, REQUEST_CONCURRENCY, async (symbol) => {
    try {
      const payload = await fetchJson("/fapi/v1/klines", {
        symbol,
        interval: timeframe,
        limit: KLINE_LIMIT,
      });
      const candles = (Array.isArray(payload) ? payload : []).map((item) => ({
        timestamp: new Date(Number(item[0])).toISOString(),
        open: safeNumber(item[1]),
        high: safeNumber(item[2]),
        low: safeNumber(item[3]),
        close: safeNumber(item[4]),
        volume: safeNumber(item[5]),
      }));
      return [symbol, candles];
    } catch (error) {
      failures.push({
        symbol,
        message: error instanceof Error ? error.message : String(error),
      });
      return [symbol, []];
    }
  });

  return { candlesBySymbol: Object.fromEntries(entries), failures };
}

function buildPayloadForPage({
  pageKey,
  generatedAt,
  universeKey,
  timeframe,
  analyses,
  universe,
  coverageNote,
  strongRecommendations = null,
}) {
  const pageLabelMap = {
    overview: "오버뷰",
    signals: "시그널",
    derivatives: "파생지표",
    movers: "급등락",
    opportunities: "기회 랭킹",
    setups: "워치리스트",
    technical_ratings: "테크니컬 레이팅",
    trend: "추세",
    momentum: "모멘텀",
    volatility: "변동성",
  };

  const opportunities = [...analyses].sort(
    (left, right) =>
      right.scores.opportunity - left.scores.opportunity || right.scores.technical - left.scores.technical,
  );
  const summary = buildSummaryCards(analyses);
  const basePayload = {
    page_key: pageKey,
    page_label: pageLabelMap[pageKey] || pageKey,
    generated_at: generatedAt,
    data_source: "binance_live",
    universe_key: universeKey,
    universe_label: universe.preset.label,
    timeframe,
    timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
    symbols_scanned: analyses.length,
    coverage_note: coverageNote,
  };

  if (pageKey === "overview") {
    return {
      ...basePayload,
      summary_cards: summary,
      top_opportunities: opportunities.slice(0, 6),
      top_signals: sortRows(analyses, ["derivatives", "momentum", "technical"]).slice(0, 6),
      page_previews: buildPagePreviewCards(analyses, opportunities),
      strong_recommendations: strongRecommendations,
    };
  }

  if (pageKey === "signals") {
    const rows = sortRows(analyses, ["derivatives", "momentum", "technical"]).slice(0, 60);
    return {
      ...basePayload,
      summary_cards: summary,
      anomaly_counts: {
        funding_hot: analyses.filter((row) => Math.abs(safeNumber(row.funding_rate)) >= 0.015).length,
        oi_heavy: analyses.filter((row) => safeNumber(row.open_interest_usd) >= 500_000_000).length,
        squeeze: analyses.filter((row) => row.signals.squeeze).length,
        divergence: analyses.filter((row) => row.signals.divergence_candidate).length,
      },
      rows,
    };
  }

  if (pageKey === "derivatives") {
    const rows = [...analyses]
      .sort(
        (left, right) =>
          right.scores.derivatives - left.scores.derivatives ||
          Math.abs(right.funding_rate || 0) - Math.abs(left.funding_rate || 0),
      )
      .slice(0, 60);
    return {
      ...basePayload,
      summary_cards: summary,
      counts: {
        funding_hot: analyses.filter((row) => Math.abs(safeNumber(row.funding_rate)) >= 0.015).length,
        oi_heavy: analyses.filter((row) => safeNumber(row.open_interest_usd) >= 500_000_000).length,
        ls_skewed: analyses.filter((row) => Math.abs(safeNumber(row.long_short_ratio, 1) - 1) >= 0.12).length,
        liq_hot: analyses.filter((row) => safeNumber(row.liquidation_pressure_usd) >= 100_000).length,
      },
      rows,
    };
  }

  if (pageKey === "movers") {
    const rows = [...analyses]
      .sort(
        (left, right) =>
          Math.abs(right.change_24h) - Math.abs(left.change_24h) ||
          right.quote_volume - left.quote_volume ||
          right.scores.volatility - left.scores.volatility,
      )
      .slice(0, 60);
    return {
      ...basePayload,
      summary_cards: summary,
      counts: {
        breakout_up: analyses.filter((row) => row.signals.breakout_up).length,
        breakout_down: analyses.filter((row) => row.signals.breakout_down).length,
        squeeze: analyses.filter((row) => row.signals.squeeze).length,
        high_volume: analyses.filter((row) => safeNumber(row.quote_volume) >= 500_000_000).length,
      },
      rows,
    };
  }

  if (pageKey === "opportunities") {
    return {
      ...basePayload,
      summary_cards: summary,
      rows: opportunities.slice(0, 40),
    };
  }

  if (pageKey === "setups") {
    return {
      ...basePayload,
      summary_cards: summary,
      rows: opportunities.slice(0, 20),
    };
  }

  if (pageKey === "technical_ratings") {
    const rows = [...analyses]
      .sort(
        (left, right) =>
          Math.abs(right.scores.technical) - Math.abs(left.scores.technical) ||
          Math.abs(right.scores.moving_average) - Math.abs(left.scores.moving_average) ||
          right.quote_volume - left.quote_volume,
      )
      .slice(0, 80);
    return {
      ...basePayload,
      distribution: buildTechnicalDistribution(analyses),
      rows,
    };
  }

  if (pageKey === "trend") {
    const rows = [...analyses]
      .sort(
        (left, right) =>
          right.scores.trend - left.scores.trend ||
          Math.abs(right.scores.trend_bias) - Math.abs(left.scores.trend_bias) ||
          right.quote_volume - left.quote_volume,
      )
      .slice(0, 80);
    return {
      ...basePayload,
      counts: {
        bullish: analyses.filter((row) => row.labels.trend_bias === "상승 추세").length,
        bearish: analyses.filter((row) => row.labels.trend_bias === "하락 추세").length,
        mixed: analyses.filter((row) => row.labels.trend_bias === "혼조").length,
      },
      rows,
    };
  }

  if (pageKey === "momentum") {
    const rows = [...analyses]
      .sort(
        (left, right) =>
          right.scores.momentum - left.scores.momentum ||
          Math.abs(right.scores.momentum_bias) - Math.abs(left.scores.momentum_bias) ||
          right.quote_volume - left.quote_volume,
      )
      .slice(0, 80);
    return {
      ...basePayload,
      counts: {
        overbought: analyses.filter((row) => row.labels.momentum_bias === "과매수").length,
        oversold: analyses.filter((row) => row.labels.momentum_bias === "과매도").length,
        divergence: analyses.filter((row) => row.signals.divergence_candidate).length,
      },
      rows,
    };
  }

  if (pageKey === "volatility") {
    const rows = [...analyses]
      .sort((left, right) => right.scores.volatility - left.scores.volatility)
      .slice(0, 80);
    return {
      ...basePayload,
      counts: {
        squeeze: analyses.filter((row) => row.signals.squeeze).length,
        breakout_up: analyses.filter((row) => row.signals.breakout_up).length,
        breakout_down: analyses.filter((row) => row.signals.breakout_down).length,
        expansion: analyses.filter((row) => row.labels.volatility_state === "확장").length,
      },
      rows,
    };
  }

  return {
    ...basePayload,
    rows: analyses.slice(0, 60),
  };
}

function buildPatternsNoticePayload({ generatedAt, universeKey, timeframe, universe }) {
  return {
    page_key: "patterns",
    page_label: "패턴 보관함",
    generated_at: generatedAt,
    data_source: "deprecated",
    universe_key: universeKey,
    universe_label: universe.preset.label,
    timeframe,
    timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
    deprecated: true,
    message:
      "패턴은 주력 제품 흐름에서 제외됐습니다. 실시간 파생지표, 급등락, 기회 랭킹 중심으로 다시 구성했습니다.",
  };
}

function buildSummaryCards(rows) {
  const topRows = rows.slice(0, 10);
  return [
    {
      label: "총 미결제약정",
      value: topRows.reduce((total, row) => total + safeNumber(row.open_interest_usd), 0),
      format: "currency",
      note: "상위 계산 종목 기준 합산",
    },
    {
      label: "24h 청산 압력",
      value: topRows.reduce((total, row) => total + safeNumber(row.liquidation_pressure_usd), 0),
      format: "currency",
      note: "변동성 기반 추정치",
    },
    {
      label: "평균 펀딩비",
      value: average(rows.map((row) => safeNumber(row.funding_rate))),
      format: "percent",
      note: "실시간 Premium Index 기준",
    },
    {
      label: "평균 롱/숏 비율",
      value: average(rows.map((row) => safeNumber(row.long_short_ratio, 1))),
      format: "ratio",
      note: "최근 계정 비율 평균",
    },
  ];
}

function buildPagePreviewCards(analyses, opportunities) {
  return [
    bestRowCard(opportunities, "opportunity", "기회 랭킹", "지금 우선 확인할 종목"),
    bestRowCard(analyses, "derivatives", "파생지표", "펀딩·OI·롱숏 이상치"),
    bestRowCard(analyses, "technical", "테크니컬", "기술 점수 우위"),
    bestRowCard(analyses, "trend", "추세", "추세 강도 우위"),
    bestRowCard(analyses, "momentum", "모멘텀", "가속도 우위"),
    bestRowCard(analyses, "volatility", "변동성", "압축·돌파 후보"),
  ].filter(Boolean);
}

function bestRowCard(rows, scoreKey, title, description) {
  if (!rows.length) {
    return null;
  }
  const best = [...rows].sort(
    (left, right) => safeNumber(right.scores?.[scoreKey]) - safeNumber(left.scores?.[scoreKey]),
  )[0];
  return {
    title,
    symbol: best.symbol,
    description,
    score: round(safeNumber(best.scores?.[scoreKey]), 1),
  };
}

function buildTechnicalDistribution(rows) {
  const counts = { "Strong Buy": 0, Buy: 0, Neutral: 0, Sell: 0, "Strong Sell": 0 };
  for (const row of rows) {
    counts[row.labels.technical_rating] = (counts[row.labels.technical_rating] || 0) + 1;
  }
  return Object.entries(counts).map(([label, count]) => ({ label, count }));
}

function sortRows(rows, scoreKeys) {
  return [...rows].sort((left, right) => {
    const leftScore = scoreKeys.reduce((total, key) => total + safeNumber(left.scores?.[key]), 0);
    const rightScore = scoreKeys.reduce((total, key) => total + safeNumber(right.scores?.[key]), 0);
    return (
      rightScore - leftScore ||
      right.quote_volume - left.quote_volume ||
      left.symbol.localeCompare(right.symbol)
    );
  });
}

function buildSymbolAnalysis({
  symbol,
  timeframe,
  candles,
  ticker = {},
  fundingRate = null,
  openInterestUsd = null,
  longShortRatio = null,
}) {
  const closes = candles.map((candle) => safeNumber(candle.close));
  const currentClose = closes[closes.length - 1] || 0;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes, 14);
  const stochRsi = stochRsiValue(closes, 14);
  const macdResult = macd(closes);
  const [bbLower, bbMid, bbUpper] = bollinger(closes, 20);
  const bbWidth = bbMid ? ((bbUpper - bbLower) / Math.max(Math.abs(bbMid), 1e-6)) * 100 : 0;
  const atr14 = atr(candles, 14);
  const atrPct = currentClose ? (atr14 / Math.max(Math.abs(currentClose), 1e-6)) * 100 : 0;
  const [adx14, plusDi, minusDi] = adxDmi(candles, 14);
  const [supertrendDirection, supertrendValue] = supertrend(candles, 10, 3.0);
  const ichimoku = ichimokuCloud(candles);
  const vwapValue = vwap(candles);
  const roc12 = roc(closes, 12);
  const closeVsVwapPct = vwapValue
    ? ((currentClose - vwapValue) / Math.max(Math.abs(vwapValue), 1e-6)) * 100
    : 0;
  const liquidationPressureUsd = estimateLiquidationPressure({
    openInterestUsd,
    change24h: safeNumber(ticker.change_24h),
    atrPct,
    longShortRatio,
  });

  let movingAverageScore = 0;
  movingAverageScore += currentClose >= ema20 ? 18 : -18;
  movingAverageScore += currentClose >= ema50 ? 16 : -16;
  movingAverageScore += currentClose >= ema200 ? 12 : -12;
  movingAverageScore += ema20 >= ema50 ? 12 : -12;
  movingAverageScore += ema50 >= ema200 ? 10 : -10;
  movingAverageScore += supertrendDirection === "bullish" ? 12 : supertrendDirection === "bearish" ? -12 : 0;
  movingAverageScore += ichimoku.bias === "bullish" ? 10 : ichimoku.bias === "bearish" ? -10 : 0;
  if (adx14 >= 20) {
    movingAverageScore += plusDi >= minusDi ? 10 : -10;
  }
  movingAverageScore = round(clamp(movingAverageScore, -100, 100), 1);

  let oscillatorScore = 0;
  oscillatorScore += clamp((rsi14 - 50) * 1.1, -22, 22);
  oscillatorScore += clamp((stochRsi - 50) * 0.7, -16, 16);
  oscillatorScore += macdResult.histogram > 0 ? 18 : macdResult.histogram < 0 ? -18 : 0;
  oscillatorScore += clamp(roc12 * 2.0, -18, 18);
  oscillatorScore = round(clamp(oscillatorScore, -100, 100), 1);

  const trendBiasScore = round(
    clamp((movingAverageScore * 0.82) + ((plusDi - minusDi) * 0.45), -100, 100),
    1,
  );
  const trendStrength = round(
    clamp(Math.abs(trendBiasScore) * 0.72 + Math.min(adx14, 50) * 0.56, 0, 100),
    1,
  );
  const momentumBiasScore = round(
    clamp((oscillatorScore * 0.88) + clamp(closeVsVwapPct * 2.5, -18, 18), -100, 100),
    1,
  );
  const momentumStrength = round(clamp(Math.abs(momentumBiasScore), 0, 100), 1);

  const squeeze = bbWidth <= 8.0 && atrPct <= 2.6;
  const expansion = bbWidth >= 16.0 || atrPct >= 5.0;
  const breakoutUp = currentClose >= bbUpper || (currentClose > ema20 && roc12 > 0 && bbWidth >= 10);
  const breakoutDown = currentClose <= bbLower || (currentClose < ema20 && roc12 < 0 && bbWidth >= 10);
  const volatilityScore = round(
    clamp(
      (squeeze ? 88 : breakoutUp || breakoutDown ? 72 : expansion ? 60 : 46) +
        Math.min(atrPct * 4.2, 12),
      0,
      100,
    ),
    1,
  );

  const fundingExtreme = Math.min(Math.abs(fundingRate || 0) * 1800, 100);
  const lsExtreme = Math.min(Math.abs((longShortRatio || 1) - 1) * 160, 100);
  const oiDepth = Math.min((openInterestUsd || 0) / 25_000_000, 100);
  const liquidationHeat = Math.min(liquidationPressureUsd / 2_500_000, 100);
  const derivativesScore = round(
    clamp(
      (fundingExtreme * 0.25) + (lsExtreme * 0.25) + (oiDepth * 0.3) + (liquidationHeat * 0.2),
      0,
      100,
    ),
    1,
  );

  let crowdingBiasScore = 0;
  if (fundingRate !== null && fundingRate !== undefined) {
    crowdingBiasScore -= clamp(fundingRate * 2200, -26, 26);
  }
  if (longShortRatio !== null && longShortRatio !== undefined) {
    crowdingBiasScore -= clamp((longShortRatio - 1.0) * 65, -24, 24);
  }
  crowdingBiasScore = round(clamp(crowdingBiasScore, -100, 100), 1);

  const technicalBiasScore = round(
    clamp(
      (movingAverageScore * 0.58) + (oscillatorScore * 0.32) + clamp(closeVsVwapPct * 2.2, -12, 12),
      -100,
      100,
    ),
    1,
  );
  const technicalRating = ratingLabel(technicalBiasScore);
  const divergenceCandidate = (roc12 > 0 && macdResult.histogram < 0) || (roc12 < 0 && macdResult.histogram > 0);
  const setupBiasScore = round(
    clamp((technicalBiasScore * 0.45) + (trendBiasScore * 0.35) + (momentumBiasScore * 0.2), -100, 100),
    1,
  );
  const directionAgreement = Math.min(
    100,
    Math.abs(Math.sign(technicalBiasScore) + Math.sign(trendBiasScore) + Math.sign(momentumBiasScore)) * 33.34,
  );
  const opportunityScore = round(
    clamp(
      (Math.abs(technicalBiasScore) * 0.28) +
        (trendStrength * 0.2) +
        (momentumStrength * 0.16) +
        (derivativesScore * 0.18) +
        (volatilityScore * 0.08) +
        (directionAgreement * 0.1),
      0,
      100,
    ),
    1,
  );

  const side = sideFromScore(setupBiasScore);
  const sideLabel = side === "long" ? "롱" : side === "short" ? "숏" : "관망";
  const flags = [];
  if (technicalRating === "Strong Buy" || technicalRating === "Strong Sell") {
    flags.push(`기술 ${technicalRating}`);
  }
  if (squeeze) flags.push("볼린저 압축");
  if (breakoutUp) flags.push("상방 돌파");
  if (breakoutDown) flags.push("하방 돌파");
  if (derivativesScore >= 72) flags.push("파생 과열");
  if (divergenceCandidate) flags.push("다이버전스 후보");

  return {
    symbol,
    timeframe,
    timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
    side,
    side_label: sideLabel,
    last_price: roundPrice(currentClose),
    change_24h: round(safeNumber(ticker.change_24h), 2),
    quote_volume: round(safeNumber(ticker.quote_volume), 2),
    funding_rate: fundingRate === null || fundingRate === undefined ? null : round(fundingRate, 4),
    open_interest_usd:
      openInterestUsd === null || openInterestUsd === undefined ? null : round(openInterestUsd, 2),
    long_short_ratio:
      longShortRatio === null || longShortRatio === undefined ? null : round(longShortRatio, 3),
    liquidation_pressure_usd: round(liquidationPressureUsd, 2),
    scores: {
      moving_average: movingAverageScore,
      oscillator: oscillatorScore,
      technical: technicalBiasScore,
      trend: trendStrength,
      trend_bias: trendBiasScore,
      momentum: momentumStrength,
      momentum_bias: momentumBiasScore,
      volatility: volatilityScore,
      derivatives: derivativesScore,
      derivatives_bias: crowdingBiasScore,
      opportunity: opportunityScore,
      setup_bias: setupBiasScore,
    },
    labels: {
      technical_rating: technicalRating,
      trend_bias: signedLabel(trendBiasScore, "상승 추세", "하락 추세", "혼조"),
      momentum_bias:
        rsi14 >= 70 || stochRsi >= 82
          ? "과매수"
          : rsi14 <= 30 || stochRsi <= 18
            ? "과매도"
            : signedLabel(momentumBiasScore, "상승 모멘텀", "하락 모멘텀", "중립"),
      volatility_state: squeeze ? "압축" : breakoutUp ? "상방 돌파" : breakoutDown ? "하방 돌파" : expansion ? "확장" : "중립",
      derivatives_bias: signedLabel(crowdingBiasScore, "숏 과밀", "롱 과밀", "중립"),
      setup_bias: setupBiasLabel(setupBiasScore),
    },
    signals: {
      squeeze,
      breakout_up: breakoutUp,
      breakout_down: breakoutDown,
      divergence_candidate: divergenceCandidate,
      supertrend: supertrendDirection,
      ichimoku_bias: ichimoku.bias,
    },
    indicators: {
      ema20: round(ema20, pricePrecision(ema20)),
      ema50: round(ema50, pricePrecision(ema50)),
      ema200: round(ema200, pricePrecision(ema200)),
      rsi14: round(rsi14, 2),
      stoch_rsi: round(stochRsi, 2),
      macd_line: round(macdResult.line, 5),
      macd_signal: round(macdResult.signal, 5),
      macd_histogram: round(macdResult.histogram, 5),
      bollinger_lower: round(bbLower, pricePrecision(bbLower)),
      bollinger_mid: round(bbMid, pricePrecision(bbMid)),
      bollinger_upper: round(bbUpper, pricePrecision(bbUpper)),
      bb_width: round(bbWidth, 2),
      atr14: round(atr14, pricePrecision(atr14)),
      atr_pct: round(atrPct, 2),
      adx14,
      plus_di: plusDi,
      minus_di: minusDi,
      supertrend_value: supertrendValue,
      vwap: round(vwapValue, pricePrecision(vwapValue)),
      close_vs_vwap_pct: round(closeVsVwapPct, 2),
      roc12: round(roc12, 2),
      ichimoku,
    },
    pattern: null,
    flags,
    data_origin: "live_binance",
  };
}

function buildStrongRecommendations(analysesByTimeframe) {
  const recommendations = {};
  for (const timeframe of TIMEFRAMES) {
    const rows = Array.isArray(analysesByTimeframe[timeframe]) ? analysesByTimeframe[timeframe] : [];
    recommendations[timeframe] = {
      timeframe,
      timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
      long: buildStrongRecommendationCard(rows, "long", timeframe),
      short: buildStrongRecommendationCard(rows, "short", timeframe),
    };
  }
  return recommendations;
}

function buildStrongRecommendationCard(rows, side, timeframe) {
  const candidates = rows.filter((row) => row.side === side);
  if (!candidates.length) {
    return {
      timeframe,
      timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
      side,
      side_label: side === "long" ? "롱" : "숏",
      symbol: null,
      empty: true,
      opportunity: null,
      technical_rating: null,
      trend_bias: null,
      momentum_bias: null,
      setup_bias: null,
    };
  }

  const best = [...candidates].sort(
    (left, right) =>
      right.scores.opportunity - left.scores.opportunity ||
      Math.abs(right.scores.technical) - Math.abs(left.scores.technical) ||
      right.quote_volume - left.quote_volume ||
      left.symbol.localeCompare(right.symbol),
  )[0];
  return {
    timeframe,
    timeframe_label: TIMEFRAME_LABELS[timeframe] || timeframe,
    side,
    side_label: side === "long" ? "롱" : "숏",
    symbol: best.symbol,
    empty: false,
    opportunity: best.scores.opportunity,
    technical_rating: best.labels.technical_rating,
    trend_bias: best.labels.trend_bias,
    momentum_bias: best.labels.momentum_bias,
    setup_bias: best.labels.setup_bias,
    change_24h: best.change_24h,
    last_price: best.last_price,
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fetchJson(path, params = undefined) {
  const url = new URL(path, BINANCE_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Binance request failed: ${response.status} ${path}`);
  }
  return response.json();
}

function safeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return valid.reduce((total, value) => total + value, 0) / valid.length;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((safeNumber(value) + Number.EPSILON) * factor) / factor;
}

function pricePrecision(price) {
  const absolute = Math.abs(safeNumber(price));
  if (absolute >= 1000) return 2;
  if (absolute >= 10) return 3;
  if (absolute >= 1) return 4;
  if (absolute >= 0.1) return 5;
  return 6;
}

function roundPrice(price) {
  return round(price, pricePrecision(price));
}

function ema(values, period) {
  if (!values.length) return 0;
  if (values.length < period) return average(values);
  const multiplier = 2 / (period + 1);
  let value = average(values.slice(0, period));
  for (const item of values.slice(period)) {
    value = (item - value) * multiplier + value;
  }
  return value;
}

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  const gains = [];
  const losses = [];
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.abs(Math.min(delta, 0)));
  }
  let avgGain = average(gains.slice(0, period));
  let avgLoss = average(losses.slice(0, period));
  for (let index = period; index < gains.length; index += 1) {
    avgGain = ((avgGain * (period - 1)) + gains[index]) / period;
    avgLoss = ((avgLoss * (period - 1)) + losses[index]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function rsiSeries(values, period = 14) {
  return values.map((_, index) => rsi(values.slice(0, index + 1), period));
}

function stochRsiValue(values, period = 14) {
  const series = rsiSeries(values, period);
  if (series.length < period) return 50;
  const sample = series.slice(-period);
  const low = Math.min(...sample);
  const high = Math.max(...sample);
  if (Math.abs(high - low) <= 1e-9) return 50;
  return ((sample[sample.length - 1] - low) / (high - low)) * 100;
}

function bollinger(values, period = 20) {
  const sample = values.length >= period ? values.slice(-period) : values;
  if (!sample.length) return [0, 0, 0];
  const mean = average(sample);
  const variance = average(sample.map((value) => (value - mean) ** 2));
  const deviation = Math.sqrt(variance);
  return [mean - (2 * deviation), mean, mean + (2 * deviation)];
}

function macd(values) {
  if (!values.length) return { line: 0, signal: 0, histogram: 0 };
  const fastSeries = [];
  const slowSeries = [];
  for (let index = 1; index <= values.length; index += 1) {
    const sample = values.slice(0, index);
    fastSeries.push(ema(sample, 12));
    slowSeries.push(ema(sample, 26));
  }
  const macdSeries = fastSeries.map((item, index) => item - slowSeries[index]);
  const line = macdSeries[macdSeries.length - 1];
  const signal = ema(macdSeries, 9);
  return { line, signal, histogram: line - signal };
}

function roc(values, period = 12) {
  if (values.length <= period) return 0;
  const baseline = values[values.length - (period + 1)];
  if (Math.abs(baseline) <= 1e-9) return 0;
  return ((values[values.length - 1] - baseline) / baseline) * 100;
}

function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const ranges = [];
  let previousClose = safeNumber(candles[0].close);
  for (const candle of candles.slice(1)) {
    const high = safeNumber(candle.high);
    const low = safeNumber(candle.low);
    const close = safeNumber(candle.close);
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
    previousClose = close;
  }
  const sample = ranges.length >= period ? ranges.slice(-period) : ranges;
  return average(sample);
}

function adxDmi(candles, period = 14) {
  if (candles.length <= period + 1) return [0, 0, 0];
  const trueRanges = [];
  const plusDmValues = [];
  const minusDmValues = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const currentHigh = safeNumber(current.high);
    const currentLow = safeNumber(current.low);
    const previousHigh = safeNumber(previous.high);
    const previousLow = safeNumber(previous.low);
    const previousClose = safeNumber(previous.close);
    const upMove = currentHigh - previousHigh;
    const downMove = previousLow - currentLow;
    const plusDm = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDm = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - previousClose),
      Math.abs(currentLow - previousClose),
    );
    trueRanges.push(tr);
    plusDmValues.push(plusDm);
    minusDmValues.push(minusDm);
  }
  if (trueRanges.length < period) return [0, 0, 0];
  let trSum = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0);
  let plusDmSum = plusDmValues.slice(0, period).reduce((sum, value) => sum + value, 0);
  let minusDmSum = minusDmValues.slice(0, period).reduce((sum, value) => sum + value, 0);
  const dxValues = [];
  for (let index = period; index < trueRanges.length; index += 1) {
    trSum = trSum - (trSum / period) + trueRanges[index];
    plusDmSum = plusDmSum - (plusDmSum / period) + plusDmValues[index];
    minusDmSum = minusDmSum - (minusDmSum / period) + minusDmValues[index];
    if (trSum <= 1e-9) {
      dxValues.push(0);
      continue;
    }
    const plusDi = 100 * (plusDmSum / trSum);
    const minusDi = 100 * (minusDmSum / trSum);
    const total = plusDi + minusDi;
    dxValues.push(total <= 1e-9 ? 0 : (100 * Math.abs(plusDi - minusDi)) / total);
  }
  if (!dxValues.length) {
    if (trSum <= 1e-9) return [0, 0, 0];
    return [0, round(100 * (plusDmSum / trSum), 2), round(100 * (minusDmSum / trSum), 2)];
  }
  const adx = average(dxValues.length >= period ? dxValues.slice(-period) : dxValues);
  const plusDi = trSum > 1e-9 ? 100 * (plusDmSum / trSum) : 0;
  const minusDi = trSum > 1e-9 ? 100 * (minusDmSum / trSum) : 0;
  return [round(adx, 2), round(plusDi, 2), round(minusDi, 2)];
}

function supertrend(candles, period = 10, multiplier = 3) {
  if (candles.length < period + 2) {
    const close = candles.length ? safeNumber(candles[candles.length - 1].close) : 0;
    return ["neutral", close];
  }
  const atrValue = atr(candles, period);
  if (atrValue <= 1e-9) {
    return ["neutral", safeNumber(candles[candles.length - 1].close)];
  }
  let upperBand = 0;
  let lowerBand = 0;
  let trend = "bullish";
  let supertrendValue = safeNumber(candles[0].close);
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const high = safeNumber(candle.high);
    const low = safeNumber(candle.low);
    const close = safeNumber(candle.close);
    const hl2 = (high + low) / 2;
    const basicUpper = hl2 + (multiplier * atrValue);
    const basicLower = hl2 - (multiplier * atrValue);
    if (index === 0) {
      upperBand = basicUpper;
      lowerBand = basicLower;
      supertrendValue = basicLower;
      continue;
    }
    const previousClose = safeNumber(candles[index - 1].close);
    upperBand = previousClose <= upperBand ? Math.min(basicUpper, upperBand) : basicUpper;
    lowerBand = previousClose >= lowerBand ? Math.max(basicLower, lowerBand) : basicLower;
    if (close > upperBand) trend = "bullish";
    else if (close < lowerBand) trend = "bearish";
    supertrendValue = trend === "bullish" ? lowerBand : upperBand;
  }
  return [trend, round(supertrendValue, pricePrecision(supertrendValue))];
}

function ichimokuCloud(candles) {
  if (!candles.length) {
    return { tenkan: 0, kijun: 0, span_a: 0, span_b: 0, bias: "neutral" };
  }
  const highs = candles.map((candle) => safeNumber(candle.high));
  const lows = candles.map((candle) => safeNumber(candle.low));
  const close = safeNumber(candles[candles.length - 1].close);
  const channel = (period) => {
    const sampleHighs = highs.length >= period ? highs.slice(-period) : highs;
    const sampleLows = lows.length >= period ? lows.slice(-period) : lows;
    return sampleHighs.length ? (Math.max(...sampleHighs) + Math.min(...sampleLows)) / 2 : close;
  };
  const tenkan = channel(9);
  const kijun = channel(26);
  const spanA = (tenkan + kijun) / 2;
  const spanB = channel(52);
  const cloudHigh = Math.max(spanA, spanB);
  const cloudLow = Math.min(spanA, spanB);
  const bias = close > cloudHigh ? "bullish" : close < cloudLow ? "bearish" : "neutral";
  return {
    tenkan: round(tenkan, pricePrecision(tenkan)),
    kijun: round(kijun, pricePrecision(kijun)),
    span_a: round(spanA, pricePrecision(spanA)),
    span_b: round(spanB, pricePrecision(spanB)),
    bias,
  };
}

function vwap(candles) {
  let numerator = 0;
  let denominator = 0;
  for (const candle of candles) {
    const high = safeNumber(candle.high);
    const low = safeNumber(candle.low);
    const close = safeNumber(candle.close);
    const volume = Math.max(safeNumber(candle.volume), 0);
    const typical = volume ? (high + low + close) / 3 : 0;
    numerator += typical * volume;
    denominator += volume;
  }
  if (denominator <= 0) {
    return candles.length ? safeNumber(candles[candles.length - 1].close) : 0;
  }
  return numerator / denominator;
}

function signedLabel(score, bullishLabel, bearishLabel, neutralLabel) {
  if (score >= 20) return bullishLabel;
  if (score <= -20) return bearishLabel;
  return neutralLabel;
}

function sideFromScore(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return "neutral";
  }
  return numeric > 0 ? "long" : "short";
}

function setupBiasLabel(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return "관망";
  }
  return numeric > 0 ? "롱 우위" : "숏 우위";
}

function ratingLabel(score) {
  if (score >= 55) return "Strong Buy";
  if (score >= 20) return "Buy";
  if (score <= -55) return "Strong Sell";
  if (score <= -20) return "Sell";
  return "Neutral";
}

function estimateLiquidationPressure({ openInterestUsd, change24h, atrPct, longShortRatio }) {
  if (openInterestUsd === null || openInterestUsd === undefined) return 0;
  const skew = Math.abs((longShortRatio || 1) - 1);
  let pressure = openInterestUsd * (Math.abs(change24h) / 100) * Math.max(atrPct, 0.6) / 220;
  pressure *= 1 + Math.min(skew, 1.5);
  return Math.max(pressure, 0);
}
