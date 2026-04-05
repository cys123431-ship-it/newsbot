const bootstrapElement = document.getElementById("markets-bootstrap");
const marketsBootstrap = bootstrapElement ? JSON.parse(bootstrapElement.textContent || "{}") : {};

const refs = {
  mainTabs: document.getElementById("markets-main-tabs"),
  subTabs: document.getElementById("markets-subfilter-tabs"),
  benchmarkStrip: document.getElementById("markets-benchmark-strip"),
  selectionSummary: document.getElementById("markets-selection-summary"),
  board: document.getElementById("markets-treemap-board"),
  legend: document.getElementById("markets-legend"),
  statusLine: document.getElementById("markets-status-line"),
  cryptoUniverseSelect: document.getElementById("crypto-universe-select"),
  cryptoTimeframeSelect: document.getElementById("crypto-timeframe-select"),
  cryptoRefreshButton: document.getElementById("crypto-refresh-button"),
  cryptoCooldownText: document.getElementById("crypto-cooldown-text"),
  cryptoStatusLine: document.getElementById("crypto-status-line"),
  cryptoProgressBar: document.getElementById("crypto-progress-bar"),
  cryptoPageTabs: document.getElementById("crypto-page-tabs"),
  cryptoSummaryMeta: document.getElementById("crypto-summary-meta"),
  cryptoActiveScan: document.getElementById("crypto-active-scan"),
  cryptoPageHighlights: document.getElementById("crypto-page-highlights"),
  cryptoPageControls: document.getElementById("crypto-page-controls"),
  cryptoPageContent: document.getElementById("crypto-page-content"),
};

const MARKET_TABS = [
  { key: "us", label: "미국주식" },
  { key: "korea", label: "한국주식" },
  { key: "crypto", label: "코인" },
];

const SUBFILTERS = {
  korea: [
    { key: "kospi", label: "KOSPI" },
    { key: "kosdaq", label: "KOSDAQ" },
  ],
  us: [
    { key: "sp500", label: "S&P 500" },
    { key: "nasdaq", label: "NASDAQ" },
    { key: "dow", label: "Dow Jones" },
    { key: "russell", label: "Russell 2000" },
  ],
};

const US_INDEX_PROXY_SYMBOLS = { sp500: "SPY", nasdaq: "QQQ", dow: "DIA", russell: "IWM" };
const US_INDEX_HEADLINES = {
  sp500: "S&P 500 시가총액 비중",
  nasdaq: "NASDAQ 시가총액 비중",
  dow: "Dow 30 구성 종목 비중",
  russell: "Russell 2000 구성 종목 비중",
};

const CRYPTO_PATTERN_FILTERS = [
  { key: "all", label: "전체" },
  { key: "forming", label: "실시간 진입" },
  { key: "touch", label: "실시간 터치" },
  { key: "tbar_complete", label: "T-Bar 완성" },
  { key: "complete", label: "일반 완성" },
];

const CRYPTO_COOLDOWN_MS = 45_000;
const CRYPTO_COOLDOWN_STORAGE_KEY = "newsbot-crypto-refresh-cooldown";
const CRYPTO_LAST_LOADED_STORAGE_KEY = "newsbot-crypto-last-loaded-at";
const SEOUL_TIMEZONE = "Asia/Seoul";
const ROOT_PREFIX = (() => {
  const overviewUrl = String(marketsBootstrap.overview_url || "");
  const marker = "data/";
  const index = overviewUrl.indexOf(marker);
  return index >= 0 ? overviewUrl.slice(0, index) : "";
})();

const state = {
  surface: MARKET_TABS.some((tab) => tab.key === marketsBootstrap.initial_surface)
    ? marketsBootstrap.initial_surface
    : "korea",
  filters: { korea: "kospi", us: "sp500" },
  chart: null,
  crypto: {
    pageKey: String(marketsBootstrap.crypto_page_key || "overview"),
    manifest: null,
    pagePayload: null,
    universeKey: "top100",
    timeframe: "5m",
    filter: "all",
    cooldownUntil: Number.parseInt(localStorage.getItem(CRYPTO_COOLDOWN_STORAGE_KEY) || "0", 10) || 0,
    lastLoadedAt: Number.parseInt(localStorage.getItem(CRYPTO_LAST_LOADED_STORAGE_KEY) || "0", 10) || 0,
  },
};

const payloads = { status: null, us: null, korea: null };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePath(value) {
  return String(value || "").replace(/^\.?\/*/, "");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(toNumber(value));
}

function formatSeoulDateTime(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)} KST`;
}

function formatPercent(value, digits = 2) {
  const numeric = toNumber(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function formatRatio(value, digits = 3) {
  const numeric = toNumber(value);
  return numeric ? numeric.toFixed(digits) : "-";
}

function formatTickerPrice(value) {
  const numeric = toNumber(value);
  if (numeric <= 0) return "-";
  if (numeric >= 1000) return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric)}`;
  if (numeric >= 1) return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(numeric)}`;
  return `$${numeric.toFixed(5)}`;
}

function formatMarketPrice(value, surface) {
  const numeric = toNumber(value);
  if (numeric <= 0) return "-";
  return surface === "korea"
    ? `₩${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(numeric)}`
    : formatTickerPrice(numeric);
}

function formatUsdCompact(value) {
  const numeric = toNumber(value);
  return numeric ? `$${formatCompact(numeric)}` : "-";
}

function formatCap(value, surface) {
  return `${surface === "korea" ? "₩" : "$"}${formatCompact(value)}`;
}

function formatCardValue(value, format) {
  if (format === "currency") return formatUsdCompact(value);
  if (format === "percent") return formatPercent(value, 4);
  if (format === "ratio") return `${formatRatio(value, 3)}x`;
  return escapeHtml(String(value ?? "-"));
}

function toneClass(value) {
  const numeric = toNumber(value);
  if (numeric > 0) return "is-positive";
  if (numeric < 0) return "is-negative";
  return "is-neutral";
}

function ratingToneClass(label) {
  if (label === "Strong Buy" || label === "Buy") return "is-positive";
  if (label === "Strong Sell" || label === "Sell") return "is-negative";
  return "is-neutral";
}

function loadJson(url, { bust = false } = {}) {
  const target = bust ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}` : url;
  return fetch(target, { cache: bust ? "no-store" : "default" }).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    return response.json();
  });
}

function resolveSiteUrl(relativePath) {
  return `${ROOT_PREFIX}${normalizePath(relativePath)}`;
}

function resolveMarketUrl(relativePath) {
  return resolveSiteUrl(`markets/${normalizePath(relativePath)}`);
}

function resolveScannerDataUrl(relativePath) {
  return String(marketsBootstrap.scanner_manifest_url || "").replace(/manifest\.json(?:\?.*)?$/, normalizePath(relativePath));
}

function activeSubfilters() {
  return SUBFILTERS[state.surface] || [];
}

function currentPayload() {
  return state.surface === "us" ? payloads.us : payloads.korea;
}

// EQUITY_RENDERERS

function renderMainTabs() {
  if (!refs.mainTabs) return;
  const routes = Array.isArray(marketsBootstrap.surface_links) ? marketsBootstrap.surface_links : [];
  refs.mainTabs.innerHTML = MARKET_TABS.map((tab) => {
    const href = routes.find((item) => item.key === tab.key)?.href || "#";
    return `<a class="market-tab-button ${tab.key === state.surface ? "is-active" : ""}" href="${escapeHtml(href)}">${escapeHtml(tab.label)}</a>`;
  }).join("");
}

function renderSubTabs() {
  if (!refs.subTabs) return;
  const current = state.filters[state.surface];
  refs.subTabs.innerHTML = activeSubfilters()
    .map((tab) => `<button type="button" class="market-subtab-button ${tab.key === current ? "is-active" : ""}" data-filter="${tab.key}">${escapeHtml(tab.label)}</button>`)
    .join("");
  refs.subTabs.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.filter;
      if (!next || next === state.filters[state.surface]) return;
      state.filters[state.surface] = next;
      renderMarkets();
    });
  });
}

function renderMarketsStatus() {
  if (!refs.statusLine) return;
  const providers = payloads.status?.providers || {};
  const parts = [
    `미국 ${providers.stocks?.status || "-"}`,
    `한국 ${providers.korea?.status || "-"}`,
    `코인 ${providers.crypto?.status || "-"}`,
  ];
  if (payloads.status?.generated_at) parts.push(`업데이트 ${payloads.status.generated_at}`);
  refs.statusLine.textContent = parts.join(" · ");
}

function resolveSurfaceModel() {
  const payload = currentPayload();
  const filterKey = state.filters[state.surface];
  const subfilter = activeSubfilters().find((item) => item.key === filterKey) || activeSubfilters()[0];
  const rows = asArray(payload?.rows).filter((row) => toNumber(row.market_cap) > 0);

  if (state.surface === "korea") {
    const exchange = filterKey === "kosdaq" ? "KOSDAQ" : "KOSPI";
    return {
      surface: "korea",
      title: `한국주식 · ${subfilter?.label || "KOSPI"}`,
      subtitle: `${subfilter?.label || "KOSPI"} 종목 시가총액 비중`,
      groupLabel: "섹터",
      rows: rows
        .filter((row) => String(row.exchange || "").toUpperCase().includes(exchange))
        .sort((left, right) => toNumber(right.market_cap) - toNumber(left.market_cap))
        .slice(0, 120),
      benchmarks: asArray(payload?.benchmarks).filter((row) => String(row.symbol || "").toUpperCase() === exchange),
      asOf: payload?.as_of || payload?.generated_at || "",
    };
  }

  const members = new Set(asArray((payload?.index_memberships || {})[filterKey]).map((item) => String(item).toUpperCase()));
  const filteredRows = rows
    .filter((row) => members.has(String(row.symbol || "").toUpperCase()))
    .sort((left, right) => toNumber(right.market_cap) - toNumber(left.market_cap))
    .slice(0, 160);

  return {
    surface: "us",
    title: `미국주식 · ${subfilter?.label || "S&P 500"}`,
    subtitle: US_INDEX_HEADLINES[filterKey] || `${subfilter?.label || "S&P 500"} 구성 종목 비중`,
    groupLabel: "섹터",
    rows: filteredRows.length ? filteredRows : rows.slice(0, 120),
    benchmarks: asArray(payload?.benchmarks).filter((row) => String(row.symbol || "").toUpperCase() === US_INDEX_PROXY_SYMBOLS[filterKey]),
    asOf: payload?.as_of || payload?.generated_at || "",
  };
}

function resolveTreemapColor(changePct, surface) {
  const value = toNumber(changePct);
  if (surface === "korea") {
    if (value > 0) return "rgba(235, 74, 101, 0.9)";
    if (value < 0) return "rgba(38, 153, 255, 0.88)";
    return "rgba(93, 108, 130, 0.82)";
  }
  if (value > 0) return "rgba(14, 203, 129, 0.88)";
  if (value < 0) return "rgba(246, 70, 93, 0.88)";
  return "rgba(93, 108, 130, 0.82)";
}

function buildTreemapHierarchy(model) {
  const total = model.rows.reduce((sum, row) => sum + toNumber(row.market_cap), 0) || 1;
  const grouped = new Map();
  model.rows.forEach((row) => {
    const categoryLabel = String(row.sector_or_category || row.industry || "기타").trim() || "기타";
    if (!grouped.has(categoryLabel)) grouped.set(categoryLabel, { name: categoryLabel, value: 0, children: [] });
    const group = grouped.get(categoryLabel);
    const cap = toNumber(row.market_cap);
    group.value += cap;
    group.children.push({
      name: String(row.symbol || row.name || "").trim(),
      fullName: String(row.name || row.symbol || "").trim(),
      symbol: String(row.symbol || "").trim(),
      value: cap,
      last: row.last,
      changePct: row.change_pct,
      marketCap: cap,
      detailUrl: row.detail_url,
      weightPct: (cap / total) * 100,
      itemStyle: { color: resolveTreemapColor(row.change_pct, model.surface), borderColor: "rgba(10,14,19,.72)", borderWidth: 1 },
    });
  });
  return { name: model.title, value: total, children: Array.from(grouped.values()).sort((left, right) => right.value - left.value) };
}

function buildTreemapOption(model) {
  const root = buildTreemapHierarchy(model);
  return {
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "rgba(11,16,23,.96)",
      borderColor: "#273241",
      borderWidth: 1,
      textStyle: { color: "#f8fbff", fontSize: 12 },
      padding: 12,
      formatter: (params) => {
        const data = params.data || {};
        if (Array.isArray(data.children)) {
          return `<div class="market-tooltip"><strong>${escapeHtml(data.name)}</strong><div>시가총액 ${escapeHtml(formatCap(data.value, model.surface))}</div></div>`;
        }
        return `<div class="market-tooltip"><strong>${escapeHtml(data.fullName || data.name)}</strong><div>현재가 ${escapeHtml(formatMarketPrice(data.last, model.surface))}</div><div>등락률 ${escapeHtml(formatPercent(data.changePct))}</div><div>시가총액 ${escapeHtml(formatCap(data.marketCap, model.surface))}</div></div>`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        sort: "desc",
        breadcrumb: { show: false },
        label: {
          show: true,
          formatter: (params) => {
            if (Array.isArray(params.data?.children)) return "";
            const data = params.data || {};
            if (toNumber(data.weightPct) < 0.5) return "";
            return `${data.symbol || data.name}\n${formatPercent(data.changePct)}`;
          },
          color: "#fff",
          overflow: "break",
        },
        upperLabel: { show: true, color: "#a6b4c7", fontSize: 11, fontWeight: 700, height: 24 },
        itemStyle: { borderColor: "#10161d", borderWidth: 2, gapWidth: 2 },
        levels: [{ upperLabel: { show: false } }, { upperLabel: { show: true } }, {}],
        data: root.children,
      },
    ],
  };
}

function renderBenchmarkStrip(model) {
  if (!refs.benchmarkStrip) return;
  refs.benchmarkStrip.innerHTML =
    model.benchmarks
      .map(
        (item) => `
          <article class="market-benchmark-card">
            <span class="market-benchmark-label">${escapeHtml(item.name || item.symbol || "-")}</span>
            <strong>${escapeHtml(formatMarketPrice(item.last, model.surface))}</strong>
            <div class="market-benchmark-move"><span class="${toneClass(item.change_pct)}">${escapeHtml(formatPercent(item.change_pct))}</span></div>
          </article>
        `,
      )
      .join("") || '<div class="analysis-empty">표시할 벤치마크가 없습니다.</div>';
}

function renderSelectionSummary(model) {
  if (!refs.selectionSummary) return;
  const totalCap = model.rows.reduce((sum, row) => sum + toNumber(row.market_cap), 0);
  const advancers = model.rows.filter((row) => toNumber(row.change_pct) > 0).length;
  const decliners = model.rows.filter((row) => toNumber(row.change_pct) < 0).length;
  const cards = [
    { label: "선택 시장", value: model.title, detail: model.asOf || "-" },
    { label: "추적 종목", value: `${model.rows.length}개`, detail: `${model.groupLabel} 기준` },
    { label: "전체 시총", value: formatCap(totalCap, model.surface), detail: "선택 종목 합계" },
    { label: "상승 / 하락", value: `${advancers} / ${decliners}`, detail: `보합 ${model.rows.length - advancers - decliners}` },
  ];
  refs.selectionSummary.innerHTML = cards.map((card) => `<article class="market-summary-card"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small></article>`).join("");
}

function renderLegend(model) {
  if (!refs.legend) return;
  const toneText = model.surface === "korea" ? "상승은 붉은색, 하락은 푸른색" : "상승은 초록색, 하락은 빨간색";
  refs.legend.innerHTML = `
    <div class="market-legend-item"><span class="market-legend-swatch size"></span><strong>크기</strong><small>시가총액 비중</small></div>
    <div class="market-legend-item"><span class="market-legend-swatch tone"></span><strong>색상</strong><small>${escapeHtml(toneText)}</small></div>
    <div class="market-legend-item"><span class="market-legend-swatch group"></span><strong>${escapeHtml(model.groupLabel)} 묶음</strong><small>상단 영역으로 그룹 구분</small></div>
  `;
}

function ensureChart() {
  if (!refs.board || !window.echarts) return null;
  if (!state.chart) {
    state.chart = window.echarts.init(refs.board, null, { renderer: "canvas" });
    window.addEventListener("resize", () => state.chart?.resize());
    state.chart.on("click", (params) => {
      if (params?.data?.detailUrl) window.open(params.data.detailUrl, "_blank", "noopener,noreferrer");
    });
  }
  return state.chart;
}

function renderTreemapSurface(model) {
  const chart = ensureChart();
  if (!chart) return;
  if (!model.rows.length) {
    chart.clear();
    chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle", style: { text: "표시할 종목 데이터가 없습니다.", fill: "#b8c4d6", font: '600 15px "Segoe UI", "Noto Sans KR", sans-serif' } }] }, true);
    return;
  }
  chart.setOption(buildTreemapOption(model), true);
  chart.resize();
}

// CRYPTO_RENDERERS

function renderCryptoPageTabs() {
  if (!refs.cryptoPageTabs) return;
  const links = Array.isArray(marketsBootstrap.crypto_page_links) ? marketsBootstrap.crypto_page_links : [];
  refs.cryptoPageTabs.innerHTML = links
    .map((link) => `<a class="crypto-page-tab ${link.key === state.crypto.pageKey ? "is-active" : ""}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join("");
}

function currentCryptoPageLabel() {
  const links = Array.isArray(marketsBootstrap.crypto_page_links) ? marketsBootstrap.crypto_page_links : [];
  return links.find((link) => link.key === state.crypto.pageKey)?.label || String(marketsBootstrap.crypto_page_label || "오버뷰");
}

function currentCryptoSnapshotMeta() {
  return asArray(state.crypto.manifest?.snapshots).find((item) => item.universe_key === state.crypto.universeKey && item.timeframe === state.crypto.timeframe);
}

function currentCryptoDataTimestamp() {
  return state.crypto.pagePayload?.generated_at || currentCryptoSnapshotMeta()?.generated_at || state.crypto.manifest?.generated_at || "";
}

function currentUniverseLimit() {
  return Number(asArray(state.crypto.manifest?.universe_presets).find((item) => item.key === state.crypto.universeKey)?.limit || currentCryptoSnapshotMeta()?.symbols_scanned || 0);
}

function setCryptoCooldown() {
  state.crypto.cooldownUntil = Date.now() + CRYPTO_COOLDOWN_MS;
  localStorage.setItem(CRYPTO_COOLDOWN_STORAGE_KEY, String(state.crypto.cooldownUntil));
}

function setCryptoLoadedAt(timestamp = Date.now()) {
  state.crypto.lastLoadedAt = timestamp;
  localStorage.setItem(CRYPTO_LAST_LOADED_STORAGE_KEY, String(timestamp));
}

function updateCryptoCooldownUI() {
  if (!refs.cryptoRefreshButton || !refs.cryptoCooldownText) return;
  const remaining = state.crypto.cooldownUntil - Date.now();
  if (remaining <= 0) {
    refs.cryptoRefreshButton.disabled = false;
    refs.cryptoCooldownText.textContent = "최신 스냅샷을 다시 불러올 수 있습니다.";
    return;
  }
  refs.cryptoRefreshButton.disabled = true;
  refs.cryptoCooldownText.textContent = `다음 새로고침까지 ${Math.ceil(remaining / 1000)}초`;
}

function renderCryptoSkeleton() {
  if (refs.cryptoPageHighlights) {
    refs.cryptoPageHighlights.innerHTML = Array.from({ length: 4 }, () => '<article class="crypto-stat-card scanner-detail-card"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-chip-row"></div></article>').join("");
  }
  if (refs.cryptoPageControls) {
    refs.cryptoPageControls.innerHTML = '<article class="crypto-panel crypto-panel-controls"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-grid"></div></article>';
  }
  if (refs.cryptoPageContent) {
    refs.cryptoPageContent.innerHTML = Array.from({ length: 3 }, () => '<article class="scanner-card is-loading"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-chip-row"></div><div class="scanner-skeleton scanner-skeleton-preview"></div></article>').join("");
  }
}

function populateCryptoControls() {
  const manifest = state.crypto.manifest;
  if (!manifest || !refs.cryptoUniverseSelect || !refs.cryptoTimeframeSelect) return;
  refs.cryptoUniverseSelect.innerHTML = asArray(manifest.universe_presets).map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.crypto.universeKey ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  refs.cryptoTimeframeSelect.innerHTML = asArray(manifest.timeframes).map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.crypto.timeframe ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function resolveCryptoPageDatasetUrl() {
  const manifest = state.crypto.manifest;
  if (!manifest) return null;
  const pageFiles = manifest.page_data?.[state.crypto.pageKey]?.[state.crypto.universeKey] || {};
  const relativePath = pageFiles[state.crypto.timeframe];
  if (relativePath) return resolveScannerDataUrl(relativePath);
  const snapshot = currentCryptoSnapshotMeta();
  return snapshot ? resolveScannerDataUrl(snapshot.path) : null;
}

async function loadCryptoManifest({ bust = false } = {}) {
  if (!marketsBootstrap.scanner_manifest_url) return;
  state.crypto.manifest = await loadJson(marketsBootstrap.scanner_manifest_url, { bust });
  const manifest = state.crypto.manifest;
  const firstUniverse = manifest?.universe_presets?.[0]?.key;
  const firstTimeframe = manifest?.timeframes?.[0]?.key;
  if (firstUniverse && !asArray(manifest.universe_presets).some((item) => item.key === state.crypto.universeKey)) state.crypto.universeKey = firstUniverse;
  if (firstTimeframe && !asArray(manifest.timeframes).some((item) => item.key === state.crypto.timeframe)) state.crypto.timeframe = firstTimeframe;
}

async function loadCryptoPagePayload({ bust = false } = {}) {
  const datasetUrl = resolveCryptoPageDatasetUrl();
  if (!datasetUrl) {
    state.crypto.pagePayload = null;
    renderCryptoPage();
    return;
  }
  state.crypto.pagePayload = await loadJson(datasetUrl, { bust });
  setCryptoLoadedAt();
  renderCryptoPage();
}

function renderCryptoSummaryMeta() {
  const snapshot = currentCryptoSnapshotMeta();
  const dataTimestamp = currentCryptoDataTimestamp();
  const loadedTimestamp = state.crypto.lastLoadedAt;
  const universeLabel = asArray(state.crypto.manifest?.universe_presets).find((item) => item.key === state.crypto.universeKey)?.label || state.crypto.universeKey;

  if (refs.cryptoSummaryMeta) {
    refs.cryptoSummaryMeta.innerHTML = `
      <span class="scanner-summary-pill">데이터 기준(한국시간) ${escapeHtml(formatSeoulDateTime(dataTimestamp))}</span>
      <span class="scanner-summary-pill">불러온 시각(한국시간) ${escapeHtml(formatSeoulDateTime(loadedTimestamp))}</span>
      <span class="scanner-summary-pill">${escapeHtml(universeLabel)}</span>
      <span class="scanner-summary-pill">${escapeHtml(currentCryptoPageLabel())}</span>
    `;
  }

  if (refs.cryptoActiveScan) {
    refs.cryptoActiveScan.innerHTML = snapshot
      ? `<span class="scanner-active-pill">상태: [${escapeHtml(String(snapshot.symbols_scanned || 0))}/${escapeHtml(String(currentUniverseLimit() || snapshot.symbols_scanned || 0))}] ${escapeHtml(snapshot.timeframe_label || state.crypto.timeframe)} 데이터 기준 ${escapeHtml(formatSeoulDateTime(snapshot.generated_at))}</span>`
      : '<span class="scanner-active-pill">선택한 조건의 스냅샷을 준비 중입니다.</span>';
  }

  if (refs.cryptoStatusLine) {
    refs.cryptoStatusLine.textContent = snapshot
      ? `상태: [${snapshot.symbols_scanned || 0}/${currentUniverseLimit() || snapshot.symbols_scanned || 0}] 데이터 기준 ${formatSeoulDateTime(dataTimestamp)}, 화면은 ${formatSeoulDateTime(loadedTimestamp)}에 불러왔습니다.`
      : "최신 스캐너 데이터를 불러오는 중입니다.";
  }

  if (refs.cryptoProgressBar) {
    const total = Math.max(currentUniverseLimit() || snapshot?.symbols_scanned || 1, 1);
    refs.cryptoProgressBar.style.width = `${Math.min(((snapshot?.symbols_scanned || 0) / total) * 100, 100)}%`;
  }
}

function renderMetricCards(cards) {
  return `<div class="crypto-stat-grid">${cards.map((card) => `<article class="crypto-stat-card scanner-detail-card"><span class="crypto-card-label">${escapeHtml(card.label)}</span><strong class="crypto-card-value">${formatCardValue(card.value, card.format)}</strong><p class="crypto-card-note">${escapeHtml(card.note || "")}</p></article>`).join("")}</div>`;
}

function renderCountCards(entries) {
  return `<div class="crypto-stat-grid">${entries.map((entry) => `<article class="crypto-stat-card scanner-detail-card"><span class="crypto-card-label">${escapeHtml(entry.label)}</span><strong class="crypto-card-value">${escapeHtml(String(entry.count ?? entry.value ?? 0))}</strong><p class="crypto-card-note">${escapeHtml(entry.note || "")}</p></article>`).join("")}</div>`;
}

function renderBadge(label, extraClass = "") {
  return `<span class="crypto-inline-badge ${extraClass}">${escapeHtml(label)}</span>`;
}

function renderPatternBadge(pattern) {
  if (!pattern) return renderBadge("패턴 없음", "is-neutral");
  return renderBadge(`${pattern.side_label} ${pattern.pattern}`, pattern.side === "bullish" ? "is-positive" : "is-negative");
}

function renderSetupLink(pattern) {
  if (!pattern?.detail_page) return '<span class="crypto-inline-muted">상세 없음</span>';
  return `<a class="scanner-link-button" href="${escapeHtml(resolveMarketUrl(pattern.detail_page))}">상세 보기</a>`;
}

function renderFlags(flags) {
  return flags?.length ? flags.map((flag) => renderBadge(flag)).join("") : '<span class="crypto-inline-muted">표시할 플래그 없음</span>';
}

function renderSection(title, subtitle, bodyHtml) {
  return `<section class="crypto-section scanner-detail-card"><div class="crypto-section-head"><div><p class="analysis-eyebrow">${escapeHtml(title)}</p><h2>${escapeHtml(subtitle)}</h2></div></div>${bodyHtml}</section>`;
}

function renderTable(columns, rows, emptyMessage) {
  if (!rows.length) return `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="crypto-table-wrap"><table class="crypto-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr>${columns.map((column) => `<td>${column.render ? column.render(row, index) : escapeHtml(String(row[column.key] ?? "-"))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderScoreStack(row) {
  return `<div class="crypto-score-stack"><strong>${escapeHtml(row.symbol)}</strong><span class="crypto-inline-muted">${escapeHtml(row.labels?.technical_rating || "-")}</span></div>`;
}

function renderOverviewControls(payload) {
  const statusCards = asArray(payload.status_counts).map((entry) => ({ label: entry.label, count: entry.count, note: "패턴 상태 집계" }));
  const previews = asArray(payload.page_previews).map((card) => `<article class="crypto-preview-card"><div class="crypto-preview-head"><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.symbol)}</span></div><p>${escapeHtml(card.description)}</p><span class="crypto-preview-score">Score ${escapeHtml(String(card.score ?? 0))}</span></article>`).join("");
  return `<div class="crypto-control-grid"><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>상태별 카운트</strong><span>패턴 스캐너 요약</span></div>${renderCountCards(statusCards)}</article><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>페이지 미리보기</strong><span>각 분석 화면 대표 항목</span></div><div class="crypto-preview-grid">${previews}</div></article></div>`;
}

function renderOverviewContent(payload) {
  const opportunities = asArray(payload.top_opportunities).slice(0, 6).map((row) => `
    <article class="crypto-opportunity-card scanner-card">
      <div class="scanner-card-head">
        <div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.labels?.technical_rating || "Neutral")} · ${escapeHtml(row.labels?.trend_bias || "-")}</p></div>
        <div class="scanner-card-badges">${renderPatternBadge(row.pattern)}<span class="scanner-badge is-score">우선순위 ${escapeHtml(String(row.scores?.opportunity ?? 0))}</span></div>
      </div>
      <div class="crypto-kpi-pair-grid">
        <div class="scanner-point-card"><span>현재가</span><strong>${escapeHtml(formatTickerPrice(row.last_price))}</strong></div>
        <div class="scanner-point-card"><span>24h</span><strong class="${toneClass(row.change_24h)}">${escapeHtml(formatPercent(row.change_24h))}</strong></div>
        <div class="scanner-point-card"><span>기술</span><strong>${escapeHtml(String(row.scores?.technical ?? 0))}</strong></div>
        <div class="scanner-point-card"><span>파생</span><strong>${escapeHtml(String(row.scores?.derivatives ?? 0))}</strong></div>
      </div>
      <div class="scanner-card-flags">${renderFlags(asArray(row.flags).slice(0, 4))}</div>
      <div class="scanner-card-footer"><span>${escapeHtml(row.timeframe_label || "-")}</span>${renderSetupLink(row.pattern)}</div>
    </article>
  `).join("");
  const patterns = asArray(payload.top_patterns).slice(0, 4).map((row) => `
    <article class="crypto-compact-card scanner-detail-card">
      <div class="crypto-compact-head"><strong>${escapeHtml(row.symbol)}</strong>${renderPatternBadge(row.pattern)}</div>
      <p>${escapeHtml(row.pattern?.summary || "패턴 설명 없음")}</p>
      <div class="crypto-compact-meta"><span>점수 ${escapeHtml(String(row.pattern?.score ?? 0))}</span><span>기술 ${escapeHtml(String(row.scores?.technical ?? 0))}</span><span>모멘텀 ${escapeHtml(String(row.scores?.momentum ?? 0))}</span></div>
    </article>
  `).join("");
  return `${renderSection("Overview", "상위 기회 종목", `<div class="crypto-opportunity-grid">${opportunities}</div>`)}${renderSection("Patterns", "패턴 스냅샷", `<div class="crypto-compact-grid">${patterns}</div>`)}`;
}

function renderSignalsPage(payload) {
  const anomaly = payload.anomaly_counts || {};
  refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge(`Funding Hot ${anomaly.funding_hot || 0}`)}${renderBadge(`OI Heavy ${anomaly.oi_heavy || 0}`)}${renderBadge(`Squeeze ${anomaly.squeeze || 0}`)}${renderBadge(`Divergence ${anomaly.divergence || 0}`)}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Signals",
    "파생 지표 + 기술 지표 이상치",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "24h", render: (row) => `<span class="${toneClass(row.change_24h)}">${escapeHtml(formatPercent(row.change_24h))}</span>` },
        { label: "Funding", render: (row) => `<span class="${toneClass(row.funding_rate)}">${escapeHtml(formatPercent(row.funding_rate, 4))}</span>` },
        { label: "OI", render: (row) => escapeHtml(formatUsdCompact(row.open_interest_usd)) },
        { label: "L/S", render: (row) => escapeHtml(formatRatio(row.long_short_ratio, 3)) },
        { label: "RSI", render: (row) => escapeHtml(String(row.indicators?.rsi14 ?? "-")) },
        { label: "MACD", render: (row) => `<span class="${toneClass(row.indicators?.macd_histogram)}">${escapeHtml(String(row.indicators?.macd_histogram ?? "-"))}</span>` },
        { label: "VWAP Gap", render: (row) => `<span class="${toneClass(row.indicators?.close_vs_vwap_pct)}">${escapeHtml(formatPercent(row.indicators?.close_vs_vwap_pct))}</span>` },
        { label: "패턴", render: (row) => renderPatternBadge(row.pattern) },
      ],
      asArray(payload.rows).slice(0, 40),
      "이상치 신호가 없습니다.",
    ),
  );
}

function buildPatternSummaryCards(snapshot) {
  const counts = snapshot?.status_counts || {};
  return [
    { label: "전체 결과", count: snapshot?.result_count || 0, note: "현재 조건의 패턴 수" },
    { label: "실시간 진입", count: counts.forming || 0, note: "PRZ 접근 진행형" },
    { label: "실시간 터치", count: counts.touch || 0, note: "PRZ 접촉" },
    { label: "T-Bar 완성", count: counts.tbar_complete || 0, note: "확인 캔들 포함" },
    { label: "일반 완성", count: counts.complete || 0, note: "완성 상태" },
  ];
}

function filteredPatternResults(snapshot) {
  const results = asArray(snapshot?.results);
  return state.crypto.filter === "all" ? results : results.filter((item) => item.status === state.crypto.filter);
}

function renderPatternFilters(snapshot) {
  const counts = snapshot?.status_counts || {};
  const total = asArray(snapshot?.results).length;
  return `<div class="scanner-filter-tabs">${CRYPTO_PATTERN_FILTERS.map((filter) => `<button type="button" class="scanner-filter-button ${filter.key === state.crypto.filter ? "is-active" : ""}" data-pattern-filter="${filter.key}"><span>${escapeHtml(filter.label)}</span><strong>${escapeHtml(String(filter.key === "all" ? total : Number(counts[filter.key] || 0)))}</strong></button>`).join("")}</div>`;
}

function renderPatternCards(snapshot) {
  const results = filteredPatternResults(snapshot);
  if (!results.length) return '<div class="analysis-empty">현재 조건에서 표시할 패턴이 없습니다.</div>';
  return `<div class="scanner-results-grid">${results.map((result) => {
    const pointCells = ["X", "A", "B", "C", "D"].map((label) => {
      const point = result.points?.[label] || {};
      return `<div class="scanner-point-card"><span>${label}</span><strong>${escapeHtml(String(point.price ?? "-"))}</strong><small>${escapeHtml(String(point.timestamp || "").replace("T", " ").slice(5, 16))}</small></div>`;
    }).join("");
    const ratioCells = Object.entries(result.ratios || {}).map(([label, value]) => `<div class="scanner-ratio-card"><span>${escapeHtml(label.toUpperCase())}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");
    const flags = asArray(result.indicator_flags).slice(0, 4).map((flag) => `<span class="scanner-flag-pill ${flag.status === "pass" ? "is-pass" : ""}">${escapeHtml(flag.label)} · ${escapeHtml(flag.value)}</span>`).join("");
    return `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(result.symbol)}</h3><p>${escapeHtml(result.summary || "")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${result.side === "bullish" ? "is-bullish" : "is-bearish"}">${escapeHtml(result.side_label)}</span><span class="scanner-badge is-score">신뢰도 ${escapeHtml(String(result.score))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(result.preview_image))}" alt="${escapeHtml(result.symbol)} pattern preview" loading="lazy" /></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>좌표</span><strong>${escapeHtml(result.pattern)}</strong></div><div class="scanner-point-grid">${pointCells}</div></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>비율</span><strong>${escapeHtml(result.status_label)}</strong></div><div class="scanner-ratio-grid">${ratioCells}</div></div><div class="scanner-prz-box"><div><span>PRZ</span><strong>${escapeHtml(String(result.prz?.lower ?? "-"))} ~ ${escapeHtml(String(result.prz?.upper ?? "-"))}</strong></div><div><span>TP1 / TP2</span><strong>${escapeHtml(String(result.targets?.tp1 ?? "-"))} / ${escapeHtml(String(result.targets?.tp2 ?? "-"))}</strong></div><div><span>SL</span><strong>${escapeHtml(String(result.stop?.value ?? "-"))}</strong></div></div><div class="scanner-card-flags">${flags || '<span class="crypto-inline-muted">확인 지표 없음</span>'}</div><div class="scanner-card-footer"><span>${escapeHtml(result.timeframe_label || "-")} · 24h ${escapeHtml(formatPercent(result.change_24h))}</span><a class="scanner-link-button" href="${escapeHtml(resolveMarketUrl(result.detail_page))}">상세 보기</a></div></article>`;
  }).join("")}</div>`;
}

function bindPatternFilterEvents() {
  refs.cryptoPageControls.querySelectorAll("[data-pattern-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.patternFilter;
      if (!next || next === state.crypto.filter) return;
      state.crypto.filter = next;
      renderCryptoPage();
    });
  });
}

function renderPatternsPage(snapshot) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards(buildPatternSummaryCards(snapshot));
  refs.cryptoPageControls.innerHTML = renderPatternFilters(snapshot);
  refs.cryptoPageContent.innerHTML = renderPatternCards(snapshot);
  bindPatternFilterEvents();
}

function renderOpportunitiesPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("패턴 점수 40")}${renderBadge("PRZ/구조 20")}${renderBadge("파생 지표 15")}${renderBadge("추세 10")}${renderBadge("모멘텀 10")}${renderBadge("변동성 5")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Opportunities",
    "지금 볼 만한 종목 랭킹",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "패턴", render: (row) => renderPatternBadge(row.pattern) },
        { label: "우선순위", render: (row) => escapeHtml(String(row.scores?.opportunity ?? 0)) },
        { label: "기술", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "파생", render: (row) => escapeHtml(String(row.scores?.derivatives ?? 0)) },
        { label: "추세", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "모멘텀", render: (row) => escapeHtml(row.labels?.momentum_bias || "-") },
        { label: "상세", render: (row) => renderSetupLink(row.pattern) },
      ],
      asArray(payload.rows),
      "우선순위 랭킹이 비어 있습니다.",
    ),
  );
}

function renderSetupsPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("상위 세트업만 확대 표시")}${renderBadge("상세 페이지에서 멀티 타임프레임 확인")}</div>`;
  refs.cryptoPageContent.innerHTML = `<div class="crypto-opportunity-grid">${asArray(payload.rows).map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.pattern?.summary || "패턴 요약 없음")}</p></div><div class="scanner-card-badges">${renderPatternBadge(row.pattern)}<span class="scanner-badge is-score">우선순위 ${escapeHtml(String(row.scores?.opportunity ?? 0))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(row.pattern?.preview_image || ""))}" alt="${escapeHtml(row.symbol)} preview" loading="lazy" /></div><div class="crypto-kpi-pair-grid"><div class="scanner-point-card"><span>기술</span><strong>${escapeHtml(String(row.scores?.technical ?? 0))}</strong></div><div class="scanner-point-card"><span>추세</span><strong>${escapeHtml(String(row.scores?.trend ?? 0))}</strong></div><div class="scanner-point-card"><span>모멘텀</span><strong>${escapeHtml(String(row.scores?.momentum ?? 0))}</strong></div><div class="scanner-point-card"><span>파생</span><strong>${escapeHtml(String(row.scores?.derivatives ?? 0))}</strong></div></div><div class="scanner-card-flags">${renderFlags(asArray(row.flags).slice(0, 5))}</div><div class="scanner-card-footer"><span>${escapeHtml(row.labels?.trend_bias || "-")} · ${escapeHtml(row.labels?.momentum_bias || "-")}</span>${renderSetupLink(row.pattern)}</div></article>`).join("")}</div>`;
}

function renderTechnicalRatingsPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards(asArray(payload.distribution).map((entry) => ({ label: entry.label, count: entry.count, note: "기술 레이팅 분포" })));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA 20/50/200")}${renderBadge("Supertrend")}${renderBadge("Ichimoku")}${renderBadge("RSI / MACD / ROC")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Technical Ratings",
    "TradingView 감성의 종합 기술 점수",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "레이팅", render: (row) => renderBadge(row.labels?.technical_rating || "Neutral", ratingToneClass(row.labels?.technical_rating)) },
        { label: "종합", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "이평", render: (row) => escapeHtml(String(row.scores?.moving_average ?? 0)) },
        { label: "오실레이터", render: (row) => escapeHtml(String(row.scores?.oscillator ?? 0)) },
        { label: "추세", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "패턴", render: (row) => renderPatternBadge(row.pattern) },
      ],
      asArray(payload.rows),
      "기술 레이팅 데이터가 없습니다.",
    ),
  );
}

function renderTrendPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "상승 추세", count: payload.counts?.bullish || 0, note: "강한 상승 정렬" }, { label: "하락 추세", count: payload.counts?.bearish || 0, note: "강한 하락 정렬" }, { label: "혼조", count: payload.counts?.mixed || 0, note: "추세 혼재" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA Cross")}${renderBadge("Supertrend")}${renderBadge("ADX / DMI")}${renderBadge("Ichimoku")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Trend",
    "추세 강도와 전환 후보",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "추세", render: (row) => renderBadge(row.labels?.trend_bias || "-", toneClass(row.scores?.trend_bias)) },
        { label: "강도", render: (row) => escapeHtml(String(row.scores?.trend ?? 0)) },
        { label: "ADX", render: (row) => escapeHtml(String(row.indicators?.adx14 ?? "-")) },
        { label: "+DI / -DI", render: (row) => `${escapeHtml(String(row.indicators?.plus_di ?? "-"))} / ${escapeHtml(String(row.indicators?.minus_di ?? "-"))}` },
        { label: "Supertrend", render: (row) => escapeHtml(row.signals?.supertrend || "-") },
        { label: "Ichimoku", render: (row) => escapeHtml(row.signals?.ichimoku_bias || "-") },
      ],
      asArray(payload.rows),
      "추세 데이터가 없습니다.",
    ),
  );
}

function renderMomentumPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "과매수", count: payload.counts?.overbought || 0, note: "상단 과열 구간" }, { label: "과매도", count: payload.counts?.oversold || 0, note: "하단 과열 구간" }, { label: "다이버전스", count: payload.counts?.divergence || 0, note: "후보 종목" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("RSI 14")}${renderBadge("Stoch RSI")}${renderBadge("MACD")}${renderBadge("ROC")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Momentum",
    "과매수·과매도와 모멘텀 강화",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "모멘텀", render: (row) => renderBadge(row.labels?.momentum_bias || "-", toneClass(row.scores?.momentum_bias)) },
        { label: "RSI", render: (row) => escapeHtml(String(row.indicators?.rsi14 ?? "-")) },
        { label: "Stoch RSI", render: (row) => escapeHtml(String(row.indicators?.stoch_rsi ?? "-")) },
        { label: "MACD", render: (row) => `<span class="${toneClass(row.indicators?.macd_histogram)}">${escapeHtml(String(row.indicators?.macd_histogram ?? "-"))}</span>` },
        { label: "ROC", render: (row) => `<span class="${toneClass(row.indicators?.roc12)}">${escapeHtml(formatPercent(row.indicators?.roc12))}</span>` },
        { label: "다이버전스", render: (row) => escapeHtml(row.signals?.divergence_candidate ? "후보" : "-") },
      ],
      asArray(payload.rows),
      "모멘텀 데이터가 없습니다.",
    ),
  );
}

function renderVolatilityPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "Squeeze", count: payload.counts?.squeeze || 0, note: "압축 구간" }, { label: "상방 돌파", count: payload.counts?.breakout_up || 0, note: "상방 브레이크" }, { label: "하방 돌파", count: payload.counts?.breakout_down || 0, note: "하방 브레이크" }, { label: "확장", count: payload.counts?.expansion || 0, note: "변동성 확대" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("Bollinger Bands")}${renderBadge("BBWidth")}${renderBadge("ATR 14")}${renderBadge("Breakout State")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Volatility",
    "압축 · 확장 · 돌파 준비 구간",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "심볼", render: (row) => renderScoreStack(row) },
        { label: "상태", render: (row) => renderBadge(row.labels?.volatility_state || "중립", row.labels?.volatility_state === "상방 돌파" ? "is-positive" : row.labels?.volatility_state === "하방 돌파" ? "is-negative" : "is-neutral") },
        { label: "BB Width", render: (row) => escapeHtml(String(row.indicators?.bb_width ?? "-")) },
        { label: "ATR%", render: (row) => escapeHtml(formatPercent(row.indicators?.atr_pct)) },
        { label: "Squeeze", render: (row) => escapeHtml(row.signals?.squeeze ? "예" : "-") },
        { label: "상방", render: (row) => escapeHtml(row.signals?.breakout_up ? "예" : "-") },
        { label: "하방", render: (row) => escapeHtml(row.signals?.breakout_down ? "예" : "-") },
      ],
      asArray(payload.rows),
      "변동성 데이터가 없습니다.",
    ),
  );
}

function renderMultiTimeframePage(payload) {
  const rows = asArray(payload.rows).slice(0, 24);
  const cards = rows.length
    ? `<div class="crypto-mtf-grid">${rows.map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.consensus_label || "-")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${toNumber(row.agreement_score) > 0 ? "is-bullish" : toNumber(row.agreement_score) < 0 ? "is-bearish" : ""}">${escapeHtml(String(row.agreement_score ?? 0))}</span></div></div><div class="crypto-mtf-table">${Object.entries(row.timeframes || {}).map(([timeframe, details]) => `<div class="crypto-mtf-row"><strong>${escapeHtml(timeframe)}</strong><span>${escapeHtml(details.technical_rating || "-")}</span><span>${escapeHtml(details.trend_bias || "-")}</span><span>${escapeHtml(details.momentum_bias || "-")}</span><span>${escapeHtml(String(details.opportunity ?? "-"))}</span></div>`).join("")}</div></article>`).join("")}</div>`
    : '<div class="analysis-empty">멀티 타임프레임 데이터가 없습니다.</div>';
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "상승 합의", count: payload.counts?.bullish || 0, note: "3개 이상 프레임 정렬" }, { label: "하락 합의", count: payload.counts?.bearish || 0, note: "3개 이상 프레임 정렬" }, { label: "혼합", count: payload.counts?.mixed || 0, note: "방향 충돌" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("5m")}${renderBadge("15m")}${renderBadge("1h")}${renderBadge("4h")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection("Multi-Timeframe", "단기·중기 합의 매트릭스", cards);
}

function renderCryptoPage() {
  populateCryptoControls();
  renderCryptoPageTabs();
  updateCryptoCooldownUI();
  renderCryptoSummaryMeta();

  if (!state.crypto.pagePayload) {
    renderCryptoSkeleton();
    return;
  }

  if (state.crypto.pageKey === "overview") {
    refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(state.crypto.pagePayload.summary_cards));
    refs.cryptoPageControls.innerHTML = renderOverviewControls(state.crypto.pagePayload);
    refs.cryptoPageContent.innerHTML = renderOverviewContent(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "signals") {
    renderSignalsPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "patterns") {
    renderPatternsPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "opportunities") {
    renderOpportunitiesPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "setups") {
    renderSetupsPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "technical_ratings") {
    renderTechnicalRatingsPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "trend") {
    renderTrendPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "momentum") {
    renderMomentumPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "volatility") {
    renderVolatilityPage(state.crypto.pagePayload);
  } else if (state.crypto.pageKey === "multi_timeframe") {
    renderMultiTimeframePage(state.crypto.pagePayload);
  } else {
    refs.cryptoPageHighlights.innerHTML = "";
    refs.cryptoPageControls.innerHTML = "";
    refs.cryptoPageContent.innerHTML = '<div class="analysis-empty">알 수 없는 코인 페이지입니다.</div>';
  }
}

// INIT

function bindCryptoEvents() {
  if (refs.cryptoUniverseSelect) {
    refs.cryptoUniverseSelect.addEventListener("change", async (event) => {
      state.crypto.universeKey = event.target.value;
      renderCryptoSkeleton();
      await loadCryptoPagePayload();
    });
  }
  if (refs.cryptoTimeframeSelect) {
    refs.cryptoTimeframeSelect.addEventListener("change", async (event) => {
      state.crypto.timeframe = event.target.value;
      renderCryptoSkeleton();
      await loadCryptoPagePayload();
    });
  }
  if (refs.cryptoRefreshButton) {
    refs.cryptoRefreshButton.addEventListener("click", async () => {
      if (Date.now() < state.crypto.cooldownUntil) {
        updateCryptoCooldownUI();
        return;
      }
      setCryptoCooldown();
      updateCryptoCooldownUI();
      renderCryptoSkeleton();
      try {
        await loadCryptoManifest({ bust: true });
        await loadCryptoPagePayload({ bust: true });
      } catch (error) {
        if (refs.cryptoStatusLine) refs.cryptoStatusLine.textContent = error?.message || "코인 데이터를 불러오지 못했습니다.";
      }
    });
  }
  window.setInterval(updateCryptoCooldownUI, 1000);
}

function renderMarkets() {
  renderMainTabs();
  if (state.surface === "crypto") {
    renderCryptoPage();
    return;
  }
  renderMarketsStatus();
  renderSubTabs();
  const model = resolveSurfaceModel();
  renderBenchmarkStrip(model);
  renderSelectionSummary(model);
  renderLegend(model);
  renderTreemapSurface(model);
}

async function initEquityMarkets() {
  const [statusPayload, stocksPayload, koreaPayload] = await Promise.all([
    loadJson(marketsBootstrap.status_url),
    loadJson(marketsBootstrap.stocks_url),
    loadJson(marketsBootstrap.korea_url),
  ]);
  payloads.status = statusPayload;
  payloads.us = stocksPayload;
  payloads.korea = koreaPayload;
}

async function initCryptoMarkets() {
  renderCryptoSkeleton();
  bindCryptoEvents();
  await loadCryptoManifest();
  await loadCryptoPagePayload();
}

async function initMarkets() {
  renderMarkets();
  try {
    if (state.surface === "crypto") {
      await initCryptoMarkets();
    } else {
      await initEquityMarkets();
      renderMarkets();
    }
  } catch (error) {
    if (refs.statusLine) refs.statusLine.textContent = "시장 데이터를 불러오지 못했습니다.";
    if (refs.cryptoStatusLine) refs.cryptoStatusLine.textContent = error?.message || "코인 데이터를 불러오지 못했습니다.";
    if (refs.board) refs.board.innerHTML = `<div class="analysis-empty">${escapeHtml(error?.message || "Unknown error")}</div>`;
  }
}

if (bootstrapElement) {
  void initMarkets();
}
