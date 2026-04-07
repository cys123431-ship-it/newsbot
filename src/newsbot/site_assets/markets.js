const bootstrap = JSON.parse(document.getElementById("markets-bootstrap")?.textContent || "{}");

const refs = {
  app: document.getElementById("crypto-app"),
  universeSelect: document.getElementById("crypto-universe-select"),
  timeframeSelect: document.getElementById("crypto-timeframe-select"),
  refreshButton: document.getElementById("crypto-refresh-button"),
  cooldownText: document.getElementById("crypto-cooldown-text"),
  statusLine: document.getElementById("crypto-status-line"),
  progressBar: document.getElementById("crypto-progress-bar"),
  pageTabs: document.getElementById("crypto-page-tabs"),
  summaryMeta: document.getElementById("crypto-summary-meta"),
  activeScan: document.getElementById("crypto-active-scan"),
  pageHighlights: document.getElementById("crypto-page-highlights"),
  pageControls: document.getElementById("crypto-page-controls"),
  pageContent: document.getElementById("crypto-page-content"),
};

const TIMEFRAMES = [
  { key: "5m", label: "5분 (5m)" },
  { key: "15m", label: "15분 (15m)" },
  { key: "1h", label: "1시간 (1h)" },
  { key: "4h", label: "4시간 (4h)" },
];
const UNIVERSE_OPTIONS = [{ key: "top100", label: "상위 100개 종목" }];
const LOCAL_CACHE_PREFIX = "newsbot:crypto-live:";
const LIVE_CACHE_TTL_MS = 90 * 1000;
const REFRESH_COOLDOWN_MS = 45 * 1000;
const ROOT_FALLBACK_MANIFEST = "/newsbot/data/scanner/manifest.json";

const state = {
  pageKey: String(bootstrap.crypto_page_key || "overview"),
  pageLabel: String(bootstrap.crypto_page_label || "오버뷰"),
  universeKey: localStorage.getItem(`${LOCAL_CACHE_PREFIX}universe`) || "top100",
  timeframe: localStorage.getItem(`${LOCAL_CACHE_PREFIX}timeframe`) || "5m",
  loading: false,
  source: "loading",
  manifest: null,
  manifestPromise: null,
  worker: null,
  workerRequestId: 0,
  cooldownUntil: 0,
  lastLoadedAt: null,
  generatedAt: null,
  liveCoverageNote: "",
};

init();

function init() {
  populateSelect(refs.universeSelect, UNIVERSE_OPTIONS, state.universeKey);
  populateSelect(refs.timeframeSelect, TIMEFRAMES, state.timeframe);
  renderPageTabs();
  bindEvents();
  renderLoadingState();
  void loadPage(false);
}

function bindEvents() {
  refs.universeSelect?.addEventListener("change", () => {
    state.universeKey = refs.universeSelect.value || "top100";
    localStorage.setItem(`${LOCAL_CACHE_PREFIX}universe`, state.universeKey);
    void loadPage(false);
  });

  refs.timeframeSelect?.addEventListener("change", () => {
    state.timeframe = refs.timeframeSelect.value || "5m";
    localStorage.setItem(`${LOCAL_CACHE_PREFIX}timeframe`, state.timeframe);
    void loadPage(false);
  });

  refs.refreshButton?.addEventListener("click", () => {
    if (Date.now() < state.cooldownUntil || state.loading) {
      updateCooldownText();
      return;
    }
    state.cooldownUntil = Date.now() + REFRESH_COOLDOWN_MS;
    updateCooldownText();
    void loadPage(true);
  });

  window.setInterval(updateCooldownText, 1000);
  window.setInterval(() => {
    if (!state.loading && state.source === "live") {
      renderMetaSummary();
    }
  }, 30 * 1000);
}

async function loadPage(force) {
  state.loading = true;
  renderLoadingState();

  try {
    if (state.pageKey === "patterns") {
      renderPatternsDeprecated();
      return;
    }

    const livePayload = await loadLivePayload(force);
    state.source = "live";
    state.generatedAt = livePayload.generated_at || new Date().toISOString();
    state.lastLoadedAt = new Date().toISOString();
    state.liveCoverageNote = String(livePayload.coverage_note || "");
    renderPayload(livePayload);
  } catch (liveError) {
    try {
      const fallbackPayload = await loadFallbackPayload();
      state.source = "fallback";
      state.generatedAt = fallbackPayload.generated_at || null;
      state.lastLoadedAt = new Date().toISOString();
      state.liveCoverageNote = "";
      renderPayload(fallbackPayload, {
        warning:
          "실시간 조회에 실패해 최근 배치 데이터를 표시 중입니다. 잠시 뒤 다시 시도하면 라이브 데이터로 복귀할 수 있습니다.",
      });
    } catch (fallbackError) {
      state.source = "error";
      state.generatedAt = null;
      state.lastLoadedAt = new Date().toISOString();
      renderErrorState(liveError, fallbackError);
    }
  } finally {
    state.loading = false;
    updateCooldownText();
  }
}

async function loadLivePayload(force) {
  const cacheKey = `${LOCAL_CACHE_PREFIX}${state.pageKey}:${state.universeKey}:${state.timeframe}`;
  if (!force) {
    const cached = readLocalCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const worker = ensureWorker();
  const requestId = `req-${Date.now()}-${++state.workerRequestId}`;
  const payload = await new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = event.data || {};
      if (message.id !== requestId) {
        return;
      }
      worker.removeEventListener("message", onMessage);
      if (message.ok) {
        resolve(message.payload);
      } else {
        reject(new Error(message.error || "Worker failed to load live payload."));
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({
      id: requestId,
      type: "load-page",
      pageKey: state.pageKey,
      timeframe: state.timeframe,
      universeKey: state.universeKey,
      force,
    });
  });
  writeLocalCache(cacheKey, payload);
  return payload;
}

async function loadFallbackPayload() {
  const manifest = await loadManifest();
  if (state.pageKey === "patterns") {
    throw new Error("Patterns route is deprecated and no live fallback is rendered.");
  }
  const relativePath = manifest?.page_data?.[state.pageKey]?.[state.universeKey]?.[state.timeframe];
  if (!relativePath) {
    throw new Error("Selected page dataset is not present in the scanner manifest.");
  }
  const datasetUrl = new URL(relativePath, resolveManifestUrl()).toString();
  const response = await fetch(datasetUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fallback dataset request failed: ${response.status}`);
  }
  return response.json();
}

async function loadManifest() {
  if (state.manifest) {
    return state.manifest;
  }
  if (!state.manifestPromise) {
    state.manifestPromise = (async () => {
      const candidates = [
        resolveManifestUrl(),
        new URL(ROOT_FALLBACK_MANIFEST, window.location.origin).toString(),
      ];
      let lastError = null;
      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`${response.status}`);
          }
          const payload = await response.json();
          state.manifest = payload;
          return payload;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Failed to load scanner manifest.");
    })();
  }
  return state.manifestPromise;
}

function resolveManifestUrl() {
  return new URL(String(bootstrap.scanner_manifest_url || ROOT_FALLBACK_MANIFEST), window.location.href).toString();
}

function ensureWorker() {
  if (!state.worker) {
    const workerUrl = new URL(String(bootstrap.live_worker_url || "../assets/crypto-live-worker.js"), window.location.href);
    state.worker = new Worker(workerUrl);
  }
  return state.worker;
}

function renderPageTabs() {
  const tabs = Array.isArray(bootstrap.crypto_page_links) ? bootstrap.crypto_page_links : [];
  refs.pageTabs.innerHTML = tabs
    .map(
      (tab) => `
        <a class="crypto-page-tab ${tab.key === state.pageKey ? "is-active" : ""}" href="${escapeHtml(tab.href)}">
          ${escapeHtml(tab.label)}
        </a>
      `,
    )
    .join("");
}

function renderLoadingState() {
  refs.statusLine.textContent = "Preparing live market data.";
  refs.progressBar.style.width = "18%";
  refs.summaryMeta.innerHTML = chip("Preparing data");
  refs.activeScan.innerHTML = chip("Loading live Binance market data.");
  refs.pageHighlights.innerHTML = renderSkeletonGrid(4);
  refs.pageControls.innerHTML = renderSkeletonGrid(2);
  refs.pageContent.innerHTML = renderSkeletonGrid(3);
}

function renderPayload(payload, options = {}) {
  state.pageLabel = payload.page_label || state.pageLabel;
  refs.progressBar.style.width = "100%";
  refs.statusLine.textContent = options.warning || buildStatusLine(payload);
  renderMetaSummary();
  renderActiveScan(payload, options.warning);

  if (payload.deprecated) {
    refs.pageHighlights.innerHTML = renderNoticeSection("패턴 보관함", payload.message);
    refs.pageControls.innerHTML = "";
    refs.pageContent.innerHTML = renderDeprecatedLinks();
    return;
  }

  switch (payload.page_key) {
    case "overview":
      renderOverview(payload);
      break;
    case "signals":
      renderSignals(payload);
      break;
    case "derivatives":
      renderDerivatives(payload);
      break;
    case "movers":
      renderMovers(payload);
      break;
    case "opportunities":
      renderOpportunities(payload);
      break;
    case "setups":
      renderSetups(payload);
      break;
    case "technical_ratings":
      renderTechnicalRatings(payload);
      break;
    case "trend":
      renderTrend(payload);
      break;
    case "momentum":
      renderMomentum(payload);
      break;
    case "volatility":
      renderVolatility(payload);
      break;
    case "multi_timeframe":
      renderMultiTimeframe(payload);
      break;
    default:
      refs.pageHighlights.innerHTML = "";
      refs.pageControls.innerHTML = "";
      refs.pageContent.innerHTML = renderNoticeSection("알 수 없는 페이지", "이 페이지를 렌더링할 수 없습니다.");
      break;
  }
}

function renderOverview(payload) {
  refs.pageHighlights.innerHTML = renderStatCards(payload.summary_cards || []);
  refs.pageControls.innerHTML = renderPreviewCards(payload.page_previews || []);
  refs.pageContent.innerHTML = [
    renderSection(
      "기회 랭킹 상위 후보",
      "실시간 종합 점수 기준 상위 종목",
      renderOpportunityGrid(payload.top_opportunities || []),
    ),
    renderSection(
      "실시간 시그널 상위 후보",
      "파생 이상치와 모멘텀 가속도가 강한 순서",
      renderCompactGrid(payload.top_signals || []),
    ),
  ].join("");
}

function renderSignals(payload) {
  refs.pageHighlights.innerHTML = renderCombinedHighlights(payload.summary_cards, payload.anomaly_counts);
  refs.pageControls.innerHTML = renderSection(
    "Signal Lens",
    "RSI, MACD, Bollinger, VWAP, funding, open interest, and positioning in one screen.",
    renderChipRow(["Funding", "Open Interest", "Long/Short", "Momentum"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "Symbol", render: (row) => renderSymbolCell(row) },
    { label: "Price", render: (row) => formatPrice(row.last_price) },
    { label: "24h", render: (row) => renderSignedBadge(row.change_24h, "%") },
    { label: "Funding", render: (row) => renderSignedBadge(row.funding_rate, "%") },
    { label: "OI", render: (row) => formatCurrencyCompact(row.open_interest_usd) },
    { label: "RSI / MACD", render: (row) => `${formatNumber(row.indicators?.rsi14)} / ${formatSignedNumber(row.indicators?.macd_histogram)}` },
    { label: "Flags", render: (row) => renderFlags(row.flags) },
  ]);
}

function renderDerivatives(payload) {
  refs.pageHighlights.innerHTML = renderCombinedHighlights(payload.summary_cards, payload.counts);
  refs.pageControls.innerHTML = renderSection(
    "파생지표 포커스",
    "Funding, OI, 롱/숏, 청산 압력 편차를 한 번에 봅니다.",
    renderChipRow(["Funding", "Open Interest", "Long/Short", "Liquidation"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "Funding", render: (row) => renderSignedBadge(row.funding_rate, "%") },
    { label: "OI", render: (row) => formatCurrencyCompact(row.open_interest_usd) },
    { label: "롱/숏", render: (row) => formatRatio(row.long_short_ratio) },
    { label: "청산 압력", render: (row) => formatCurrencyCompact(row.liquidation_pressure_usd) },
    { label: "편향", render: (row) => badge(row.labels?.derivatives_bias || "중립", row.scores?.derivatives_bias) },
    { label: "플래그", render: (row) => renderFlags(row.flags) },
  ]);
}

function renderMovers(payload) {
  refs.pageHighlights.innerHTML = renderCombinedHighlights(payload.summary_cards, payload.counts);
  refs.pageControls.innerHTML = renderSection(
    "급등락/돌파 관찰",
    "24시간 변동률, 거래량, 볼린저 압축/돌파 여부 중심으로 정렬합니다.",
    renderChipRow(["상방 돌파", "하방 돌파", "압축", "고거래량"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "24h", render: (row) => renderSignedBadge(row.change_24h, "%") },
    { label: "거래대금", render: (row) => formatCurrencyCompact(row.quote_volume) },
    { label: "BB Width", render: (row) => `${formatNumber(row.indicators?.bb_width)}%` },
    { label: "ATR%", render: (row) => `${formatNumber(row.indicators?.atr_pct)}%` },
    { label: "상태", render: (row) => badge(row.labels?.volatility_state || "중립", stateScoreForLabel(row.labels?.volatility_state)) },
    { label: "플래그", render: (row) => renderFlags(row.flags) },
  ]);
}

function renderOpportunities(payload) {
  refs.pageHighlights.innerHTML = renderStatCards(payload.summary_cards || []);
  refs.pageControls.innerHTML = renderSection(
    "랭킹 공식",
    "기술·추세·모멘텀·파생·변동성을 조합한 실시간 우선순위입니다.",
    renderChipRow(["기술 28%", "추세 20%", "모멘텀 16%", "파생 18%", "변동성 8%", "합의도 10%"]),
  );
  refs.pageContent.innerHTML = renderOpportunityGrid(payload.rows || []);
}

function renderSetups(payload) {
  refs.pageHighlights.innerHTML = renderStatCards(payload.summary_cards || []);
  refs.pageControls.innerHTML = renderSection(
    "워치리스트 해석",
    "지금 바로 체크할 만한 실시간 후보를 카드형으로 정리했습니다.",
    renderChipRow(["롱/숏 우위", "기술 점수", "모멘텀", "파생 온도"]),
  );
  refs.pageContent.innerHTML = renderSetupCards(payload.rows || []);
}

function renderTechnicalRatings(payload) {
  refs.pageHighlights.innerHTML = renderCountGrid(payload.distribution || []);
  refs.pageControls.innerHTML = renderSection(
    "테크니컬 분류",
    "이동평균 계열과 오실레이터 계열을 합쳐 Strong Buy ~ Strong Sell 로 분류합니다.",
    renderChipRow(["MA bias", "Oscillator bias", "VWAP gap"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "등급", render: (row) => badge(row.labels?.technical_rating || "Neutral", row.scores?.technical) },
    { label: "기술 점수", render: (row) => formatSignedNumber(row.scores?.technical) },
    { label: "MA", render: (row) => formatSignedNumber(row.scores?.moving_average) },
    { label: "Osc", render: (row) => formatSignedNumber(row.scores?.oscillator) },
    { label: "VWAP 갭", render: (row) => `${formatSignedNumber(row.indicators?.close_vs_vwap_pct)}%` },
  ]);
}

function renderTrend(payload) {
  refs.pageHighlights.innerHTML = renderCountGrid(payload.counts || {});
  refs.pageControls.innerHTML = renderSection(
    "추세 판정",
    "EMA 크로스, Supertrend, ADX-DMI, Ichimoku 편향을 함께 봅니다.",
    renderChipRow(["EMA20/50/200", "Supertrend", "ADX-DMI", "Ichimoku"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "추세", render: (row) => badge(row.labels?.trend_bias || "혼조", row.scores?.trend_bias) },
    { label: "강도", render: (row) => formatNumber(row.scores?.trend) },
    { label: "ADX", render: (row) => formatNumber(row.indicators?.adx14) },
    { label: "+DI / -DI", render: (row) => `${formatNumber(row.indicators?.plus_di)} / ${formatNumber(row.indicators?.minus_di)}` },
    { label: "Supertrend", render: (row) => row.signals?.supertrend || "-" },
  ]);
}

function renderMomentum(payload) {
  refs.pageHighlights.innerHTML = renderCountGrid(payload.counts || {});
  refs.pageControls.innerHTML = renderSection(
    "모멘텀 판정",
    "RSI, Stoch RSI, MACD, ROC 중심으로 과매수·과매도와 다이버전스를 봅니다.",
    renderChipRow(["RSI", "Stoch RSI", "MACD", "ROC"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "모멘텀", render: (row) => badge(row.labels?.momentum_bias || "중립", row.scores?.momentum_bias) },
    { label: "RSI", render: (row) => formatNumber(row.indicators?.rsi14) },
    { label: "Stoch RSI", render: (row) => formatNumber(row.indicators?.stoch_rsi) },
    { label: "MACD Hist", render: (row) => formatSignedNumber(row.indicators?.macd_histogram) },
    { label: "ROC", render: (row) => `${formatSignedNumber(row.indicators?.roc12)}%` },
  ]);
}

function renderVolatility(payload) {
  refs.pageHighlights.innerHTML = renderCountGrid(payload.counts || {});
  refs.pageControls.innerHTML = renderSection(
    "변동성 판정",
    "볼린저 밴드 폭, ATR%, 압축, 확장, 돌파 신호를 중심으로 봅니다.",
    renderChipRow(["BB Width", "ATR%", "압축", "돌파"]),
  );
  refs.pageContent.innerHTML = renderDataTable(payload.rows || [], [
    { label: "심볼", render: (row) => renderSymbolCell(row) },
    { label: "상태", render: (row) => badge(row.labels?.volatility_state || "중립", stateScoreForLabel(row.labels?.volatility_state)) },
    { label: "BB Width", render: (row) => `${formatNumber(row.indicators?.bb_width)}%` },
    { label: "ATR%", render: (row) => `${formatNumber(row.indicators?.atr_pct)}%` },
    { label: "돌파", render: (row) => row.signals?.breakout_up ? "상방" : row.signals?.breakout_down ? "하방" : "-" },
    { label: "플래그", render: (row) => renderFlags(row.flags) },
  ]);
}

function renderMultiTimeframe(payload) {
  refs.pageHighlights.innerHTML = renderCountGrid(payload.counts || {});
  refs.pageControls.innerHTML = renderSection(
    "프레임 합의도",
    "5m / 15m / 1h / 4h의 추세·모멘텀·기회 점수를 한 번에 확인합니다.",
    renderChipRow(["5m", "15m", "1h", "4h"]),
  );
  refs.pageContent.innerHTML = `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>멀티 타임프레임 매트릭스</strong>
          <span>${escapeHtml(payload.coverage_note || "상위 프레임 합의")}</span>
        </div>
      </div>
      <div class="crypto-mtf-grid">
        ${(payload.rows || []).map((row) => renderMultiTimeframeCard(row)).join("")}
      </div>
    </section>
  `;
}

function renderPatternsDeprecated() {
  state.source = "deprecated";
  state.generatedAt = null;
  state.lastLoadedAt = new Date().toISOString();
  refs.statusLine.textContent = "패턴은 보관함으로 이동했습니다.";
  refs.progressBar.style.width = "100%";
  renderMetaSummary();
  refs.activeScan.innerHTML = chip("패턴은 주력 제품 흐름에서 제외됐습니다.");
  refs.pageHighlights.innerHTML = renderNoticeSection(
    "패턴 보관함",
    "패턴은 주력 제품에서 제외했습니다. 실시간 파생지표, 급등락, 기회 랭킹 중심으로 사용해 주세요.",
  );
  refs.pageControls.innerHTML = renderDeprecatedLinks();
  refs.pageContent.innerHTML = "";
}

function renderDeprecatedLinks() {
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>대체 페이지</strong>
          <span>실시간 분석이 잘 맞는 세 축을 바로 열 수 있습니다.</span>
        </div>
      </div>
      <div class="crypto-compact-grid">
        ${renderRouteCard("../derivatives/", "파생지표", "Funding, OI, 롱/숏, 청산 압력을 실시간으로 확인")}
        ${renderRouteCard("../movers/", "급등락", "변동률, 거래량, 볼린저 압축·돌파 위주로 탐색")}
        ${renderRouteCard("../opportunities/", "기회 랭킹", "기술·추세·모멘텀·파생 종합 점수 순위")}
      </div>
    </section>
  `;
}

function renderRouteCard(href, title, description) {
  return `
    <a class="crypto-compact-card" href="${escapeHtml(href)}">
      <div class="crypto-compact-head">
        <strong>${escapeHtml(title)}</strong>
        <span>열기</span>
      </div>
      <p>${escapeHtml(description)}</p>
    </a>
  `;
}

function renderMetaSummary() {
  const elapsedMinutes = state.lastLoadedAt
    ? Math.max(0, Math.round((Date.now() - new Date(state.lastLoadedAt).getTime()) / 60000))
    : null;
  refs.summaryMeta.innerHTML = [
    chip(`최근 불러온 시각(한국시간) ${formatSeoulDateTime(state.lastLoadedAt)}`),
    chip(`데이터 소스 ${state.source === "live" ? "Binance 실시간" : state.source === "fallback" ? "배치 fallback" : state.source === "deprecated" ? "보관함" : "준비 중"}`),
    chip(elapsedMinutes === null ? "경과 시간 계산 중" : `경과 시간 ${formatElapsed(elapsedMinutes)}`),
    chip(state.universeKey),
    chip(state.pageLabel),
  ].join("");
}

function renderActiveScan(payload, warning) {
  const line =
    state.source === "live"
      ? `실시간 조회 성공 · ${escapeHtml(payload.coverage_note || `${payload.symbols_scanned || 0}개 심볼 계산`)} · ${escapeHtml(payload.timeframe_label || state.timeframe)}`
      : state.source === "fallback"
        ? `실시간 조회 실패, 최근 배치 데이터 표시 중 · 배치 기준 ${escapeHtml(formatSeoulDateTime(payload.generated_at))}`
        : "데이터 준비 중";
  refs.activeScan.innerHTML = [chip(line), warning ? chip(warning) : ""].join("");
}

function renderCombinedHighlights(summaryCards, counts) {
  return `${renderStatCards(summaryCards || [])}${renderCountGrid(counts || {})}`;
}

function renderStatCards(cards) {
  if (!cards.length) {
    return "";
  }
  return `
    <section class="crypto-stat-grid">
      ${cards
        .map(
          (card) => `
            <article class="crypto-stat-card">
              <span class="crypto-card-label">${escapeHtml(card.label)}</span>
              <strong class="crypto-card-value">${escapeHtml(formatSummaryValue(card.value, card.format))}</strong>
              <p class="crypto-card-note">${escapeHtml(card.note || "")}</p>
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderCountGrid(counts) {
  const entries = Array.isArray(counts)
    ? counts
    : Object.entries(counts).map(([label, count]) => ({ label, count }));
  if (!entries.length) {
    return "";
  }
  return `
    <section class="crypto-stat-grid">
      ${entries
        .map(
          (entry) => `
            <article class="crypto-stat-card">
              <span class="crypto-card-label">${escapeHtml(entry.label)}</span>
              <strong class="crypto-card-value">${escapeHtml(String(entry.count ?? 0))}</strong>
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderPreviewCards(cards) {
  if (!cards.length) {
    return "";
  }
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>실시간 프리뷰</strong>
          <span>각 화면에서 바로 확인할 대표 종목</span>
        </div>
      </div>
      <div class="crypto-preview-grid">
        ${cards
          .map(
            (card) => `
              <article class="crypto-preview-card">
                <div class="crypto-preview-head">
                  <strong>${escapeHtml(card.title)}</strong>
                  <span class="crypto-inline-badge">${escapeHtml(card.symbol)}</span>
                </div>
                <p>${escapeHtml(card.description)}</p>
                <div class="crypto-preview-score"><span>점수 ${escapeHtml(formatNumber(card.score))}</span></div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSection(title, subtitle, body) {
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(subtitle)}</span>
        </div>
      </div>
      ${body}
    </section>
  `;
}

function renderOpportunityGrid(rows) {
  if (!rows.length) {
    return '<div class="analysis-empty">표시할 실시간 후보가 없습니다.</div>';
  }
  return `<div class="crypto-opportunity-grid">${rows.map((row) => renderOpportunityCard(row)).join("")}</div>`;
}

function renderCompactGrid(rows) {
  if (!rows.length) {
    return '<div class="analysis-empty">표시할 항목이 없습니다.</div>';
  }
  return `<div class="crypto-compact-grid">${rows.map((row) => renderCompactCard(row)).join("")}</div>`;
}

function renderSetupCards(rows) {
  if (!rows.length) {
    return '<div class="analysis-empty">워치리스트 후보가 없습니다.</div>';
  }
  return `<div class="crypto-opportunity-grid">${rows.map((row) => renderSetupCard(row)).join("")}</div>`;
}

function renderOpportunityCard(row) {
  return `
    <article class="crypto-preview-card">
      <div class="crypto-preview-head">
        <strong>${escapeHtml(row.symbol)}</strong>
        ${badge(row.labels?.setup_bias || "관망", row.scores?.setup_bias)}
      </div>
      <p>${escapeHtml(renderOpportunitySummary(row))}</p>
      <div class="crypto-preview-score">
        <span>기회 ${escapeHtml(formatNumber(row.scores?.opportunity))}</span>
        <span>기술 ${escapeHtml(formatSignedNumber(row.scores?.technical))}</span>
        <span>파생 ${escapeHtml(formatNumber(row.scores?.derivatives))}</span>
      </div>
    </article>
  `;
}

function renderSetupCard(row) {
  return `
    <article class="crypto-preview-card">
      <div class="crypto-preview-head">
        <strong>${escapeHtml(row.symbol)}</strong>
        ${badge(row.labels?.setup_bias || "관망", row.scores?.setup_bias)}
      </div>
      <p>${escapeHtml(renderOpportunitySummary(row))}</p>
      <div class="crypto-preview-score">
        <span>가격 ${escapeHtml(formatPrice(row.last_price))}</span>
        <span>24h ${escapeHtml(formatSignedNumber(row.change_24h))}%</span>
        <span>Funding ${escapeHtml(formatSignedNumber(row.funding_rate))}%</span>
      </div>
    </article>
  `;
}

function renderCompactCard(row) {
  return `
    <article class="crypto-compact-card">
      <div class="crypto-compact-head">
        <strong>${escapeHtml(row.symbol)}</strong>
        ${badge(row.labels?.technical_rating || "Neutral", row.scores?.technical)}
      </div>
      <p>${escapeHtml(renderOpportunitySummary(row))}</p>
      <div class="crypto-compact-meta">
        <span>RSI ${escapeHtml(formatNumber(row.indicators?.rsi14))}</span>
        <span>ADX ${escapeHtml(formatNumber(row.indicators?.adx14))}</span>
        <span>OI ${escapeHtml(formatCurrencyCompact(row.open_interest_usd))}</span>
      </div>
    </article>
  `;
}

function renderMultiTimeframeCard(row) {
  return `
    <article class="crypto-panel">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(row.symbol)}</strong>
          <span>${escapeHtml(row.consensus_label)} · 합의도 ${escapeHtml(formatSignedNumber(row.agreement_score))}</span>
        </div>
      </div>
      <div class="crypto-mtf-table">
        ${TIMEFRAMES.map((frame) => renderMultiTimeframeRow(frame, row.timeframes?.[frame])).join("")}
      </div>
    </article>
  `;
}

function renderMultiTimeframeRow(frame, entry) {
  return `
    <div class="crypto-mtf-row">
      <strong>${escapeHtml(frame)}</strong>
      <span>${escapeHtml(entry?.technical_rating || "-")}</span>
      <span>${escapeHtml(entry?.trend_bias || "-")}</span>
      <span>${escapeHtml(entry?.momentum_bias || "-")}</span>
      <span>${escapeHtml(entry ? formatNumber(entry.opportunity) : "-")}</span>
    </div>
  `;
}

function renderDataTable(rows, columns) {
  if (!rows.length) {
    return '<div class="analysis-empty">표시할 데이터가 없습니다.</div>';
  }
  return `
    <section class="crypto-section">
      <div class="crypto-table-wrap">
        <table class="crypto-table">
          <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>${columns.map((column) => `<td>${column.render(row)}</td>`).join("")}</tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderNoticeSection(title, copy) {
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(copy)}</span>
        </div>
      </div>
    </section>
  `;
}

function renderErrorState(liveError, fallbackError) {
  refs.progressBar.style.width = "100%";
  refs.statusLine.textContent = "실시간 데이터와 배치 fallback 모두 불러오지 못했습니다.";
  renderMetaSummary();
  refs.activeScan.innerHTML = chip("데이터 준비 중");
  refs.pageHighlights.innerHTML = renderNoticeSection(
    "데이터 파일을 찾지 못했습니다.",
    "실시간 조회와 fallback 배치 데이터를 모두 읽지 못했습니다. 배포가 덜 끝났거나 네트워크에 문제가 있을 수 있습니다.",
  );
  refs.pageControls.innerHTML = "";
  refs.pageContent.innerHTML = `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>진단 정보</strong>
          <span>${escapeHtml(String(liveError?.message || "Live fetch failed"))}</span>
        </div>
      </div>
      <p class="crypto-card-note">${escapeHtml(String(fallbackError?.message || "fallback failed"))}</p>
    </section>
  `;
}

function buildStatusLine(payload) {
  if (state.source === "live") {
    return "실시간 조회 성공";
  }
  if (state.source === "fallback") {
    return "실시간 조회 실패, 최근 배치 데이터 표시 중";
  }
  if (payload?.deprecated) {
    return "패턴은 보관함으로 이동했습니다.";
  }
  return "데이터 준비 중";
}

function renderSkeletonGrid(count) {
  return `<div class="crypto-preview-grid">${Array.from({ length: count }, () => '<div class="crypto-preview-card"><div class="crypto-card-note">불러오는 중...</div></div>').join("")}</div>`;
}

function renderChipRow(labels) {
  return `<div class="crypto-chip-row">${labels.map((label) => chip(label)).join("")}</div>`;
}

function chip(text) {
  return `<span class="crypto-inline-badge is-neutral">${escapeHtml(String(text || ""))}</span>`;
}

function renderSignedBadge(value, suffix = "") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return badge("-", 0);
  }
  const className = numeric > 0 ? "is-positive" : numeric < 0 ? "is-negative" : "is-neutral";
  return `<span class="crypto-inline-badge ${className}">${escapeHtml(`${formatSignedNumber(numeric)}${suffix}`)}</span>`;
}

function badge(text, score) {
  const numeric = Number(score);
  const className = Number.isFinite(numeric)
    ? numeric > 0
      ? "is-positive"
      : numeric < 0
        ? "is-negative"
        : "is-neutral"
    : "is-neutral";
  return `<span class="crypto-inline-badge ${className}">${escapeHtml(String(text || ""))}</span>`;
}

function renderFlags(flags) {
  if (!Array.isArray(flags) || !flags.length) {
    return "-";
  }
  return flags.map((flag) => chip(flag)).join("");
}

function renderSymbolCell(row) {
  return `
    <div class="crypto-score-stack">
      <strong>${escapeHtml(row.symbol)}</strong>
      <span class="crypto-inline-muted">${escapeHtml(row.labels?.setup_bias || row.labels?.trend_bias || "중립")}</span>
    </div>
  `;
}

function renderOpportunitySummary(row) {
  return `${row.labels?.technical_rating || "Neutral"} · ${row.labels?.trend_bias || "혼조"} · ${row.labels?.momentum_bias || "중립"} · ${row.labels?.derivatives_bias || "중립"}`;
}

function stateScoreForLabel(label) {
  if (label === "상방 돌파" || label === "확장") return 1;
  if (label === "하방 돌파") return -1;
  return 0;
}

function formatSummaryValue(value, format) {
  if (format === "currency") return formatCurrencyCompact(value);
  if (format === "percent") return `${formatSignedNumber(value)}%`;
  if (format === "ratio") return formatRatio(value);
  return formatNumber(value);
}

function formatCurrencyCompact(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric);
}

function formatPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 1000 ? 2 : numeric >= 1 ? 4 : 6,
  }).format(numeric);
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric);
}

function formatSignedNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const formatted = formatNumber(Math.abs(numeric));
  return numeric > 0 ? `+${formatted}` : numeric < 0 ? `-${formatted}` : formatted;
}

function formatRatio(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toFixed(3);
}

function formatSeoulDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(parsed).replace(",", "");
}

function formatElapsed(minutes) {
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function updateCooldownText() {
  const remaining = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
  refs.refreshButton.disabled = state.loading || remaining > 0;
  refs.cooldownText.textContent =
    remaining > 0
      ? `다음 라이브 새로고침까지 ${remaining}초`
      : "실시간 Binance 조회 기준입니다. 버튼을 누르면 최신 시장 데이터를 다시 불러옵니다.";
}

function populateSelect(element, options, selected) {
  if (!element) return;
  element.innerHTML = options
    .map(
      (option) => `
        <option value="${escapeHtml(option.key)}" ${option.key === selected ? "selected" : ""}>
          ${escapeHtml(option.label)}
        </option>
      `,
    )
    .join("");
}

function writeLocalCache(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify({ storedAt: Date.now(), payload }));
  } catch (_) {
    // Ignore quota/cache errors.
  }
}

function readLocalCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.storedAt || Date.now() - parsed.storedAt > LIVE_CACHE_TTL_MS) {
      return null;
    }
    return parsed.payload || null;
  } catch (_) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
