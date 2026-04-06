const bootstrapElement = document.getElementById("markets-bootstrap");
const marketsBootstrap = bootstrapElement ? JSON.parse(bootstrapElement.textContent || "{}") : {};

const refs = {
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

const CRYPTO_PATTERN_FILTERS = [
  { key: "all", label: "??" },
  { key: "forming", label: "??? ??" },
  { key: "touch", label: "??? ??" },
  { key: "tbar_complete", label: "T-Bar ??" },
  { key: "complete", label: "?? ??" },
];

const CRYPTO_COOLDOWN_MS = 45_000;
const CRYPTO_COOLDOWN_STORAGE_KEY = "newsbot-crypto-refresh-cooldown";
const CRYPTO_LAST_LOADED_STORAGE_KEY = "newsbot-crypto-last-loaded-at";
const SEOUL_TIMEZONE = "Asia/Seoul";
const ROOT_PREFIX = (() => {
  const path = window.location.pathname || "/";
  const marker = "/markets/";
  const index = path.indexOf(marker);
  if (index >= 0) return path.slice(0, index + 1);
  const analysisMarker = "/analysis/";
  const analysisIndex = path.indexOf(analysisMarker);
  if (analysisIndex >= 0) return path.slice(0, analysisIndex + 1);
  return path.endsWith("/") ? path : `${path}/`;
})();

const state = {
  surface: "crypto",
  crypto: {
    pageKey: String(marketsBootstrap.crypto_page_key || "overview"),
    manifest: null,
    manifestUrl: "",
    pagePayload: null,
    universeKey: "top100",
    timeframe: "5m",
    filter: "all",
    cooldownUntil: Number.parseInt(localStorage.getItem(CRYPTO_COOLDOWN_STORAGE_KEY) || "0", 10) || 0,
    lastLoadedAt: Number.parseInt(localStorage.getItem(CRYPTO_LAST_LOADED_STORAGE_KEY) || "0", 10) || 0,
    errorMessage: "",
    notice: "?? ?? ??? ???? ?? ????.",
    isLoading: false,
  },
};

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

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFreshnessState(value) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return { label: "?? ??", className: "is-neutral", elapsedLabel: "?? ?? ?? ??" };
  }
  const elapsedMs = Math.max(Date.now() - timestamp.getTime(), 0);
  const elapsedMinutes = elapsedMs / 60_000;
  let label = "??";
  let className = "is-positive";
  if (elapsedMinutes > 45) {
    label = "??? ??";
    className = "is-negative";
  } else if (elapsedMinutes > 25) {
    label = "??";
    className = "is-neutral";
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let elapsedLabel = "";
  if (hours > 0) {
    elapsedLabel = `${hours}?? ${minutes}? ??`;
  } else if (minutes > 0) {
    elapsedLabel = `${minutes}? ??`;
  } else {
    elapsedLabel = `${seconds}? ??`;
  }
  return { label, className, elapsedLabel };
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
    ? `?${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(numeric)}`
    : formatTickerPrice(numeric);
}

function formatUsdCompact(value) {
  const numeric = toNumber(value);
  return numeric ? `$${formatCompact(numeric)}` : "-";
}

function formatCap(value, surface) {
  return `${surface === "korea" ? "?" : "$"}${formatCompact(value)}`;
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
  const manifestUrl = state.crypto.manifestUrl || String(marketsBootstrap.scanner_manifest_url || "");
  if (manifestUrl) {
    return manifestUrl.replace(/manifest\.json(?:\?.*)?$/, normalizePath(relativePath));
  }
  return resolveSiteUrl(`data/scanner/${normalizePath(relativePath)}`);
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
    `?? ${providers.stocks?.status || "-"}`,
    `?? ${providers.korea?.status || "-"}`,
    `?? ${providers.crypto?.status || "-"}`,
  ];
  if (payloads.status?.generated_at) parts.push(`???? ${payloads.status.generated_at}`);
  refs.statusLine.textContent = parts.join(" ? ");
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
      title: `???? ? ${subfilter?.label || "KOSPI"}`,
      subtitle: `${subfilter?.label || "KOSPI"} ?? ???? ??`,
      groupLabel: "??",
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
    title: `???? ? ${subfilter?.label || "S&P 500"}`,
    subtitle: US_INDEX_HEADLINES[filterKey] || `${subfilter?.label || "S&P 500"} ?? ?? ??`,
    groupLabel: "??",
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
    const categoryLabel = String(row.sector_or_category || row.industry || "??").trim() || "??";
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
          return `<div class="market-tooltip"><strong>${escapeHtml(data.name)}</strong><div>???? ${escapeHtml(formatCap(data.value, model.surface))}</div></div>`;
        }
        return `<div class="market-tooltip"><strong>${escapeHtml(data.fullName || data.name)}</strong><div>??? ${escapeHtml(formatMarketPrice(data.last, model.surface))}</div><div>??? ${escapeHtml(formatPercent(data.changePct))}</div><div>???? ${escapeHtml(formatCap(data.marketCap, model.surface))}</div></div>`;
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
      .join("") || '<div class="analysis-empty">??? ????? ????.</div>';
}

function renderSelectionSummary(model) {
  if (!refs.selectionSummary) return;
  const totalCap = model.rows.reduce((sum, row) => sum + toNumber(row.market_cap), 0);
  const advancers = model.rows.filter((row) => toNumber(row.change_pct) > 0).length;
  const decliners = model.rows.filter((row) => toNumber(row.change_pct) < 0).length;
  const cards = [
    { label: "?? ??", value: model.title, detail: model.asOf || "-" },
    { label: "?? ??", value: `${model.rows.length}?`, detail: `${model.groupLabel} ??` },
    { label: "?? ??", value: formatCap(totalCap, model.surface), detail: "?? ?? ??" },
    { label: "?? / ??", value: `${advancers} / ${decliners}`, detail: `?? ${model.rows.length - advancers - decliners}` },
  ];
  refs.selectionSummary.innerHTML = cards.map((card) => `<article class="market-summary-card"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(card.value)}</strong><small>${escapeHtml(card.detail)}</small></article>`).join("");
}

function renderLegend(model) {
  if (!refs.legend) return;
  const toneText = model.surface === "korea" ? "??? ???, ??? ???" : "??? ???, ??? ???";
  refs.legend.innerHTML = `
    <div class="market-legend-item"><span class="market-legend-swatch size"></span><strong>??</strong><small>???? ??</small></div>
    <div class="market-legend-item"><span class="market-legend-swatch tone"></span><strong>??</strong><small>${escapeHtml(toneText)}</small></div>
    <div class="market-legend-item"><span class="market-legend-swatch group"></span><strong>${escapeHtml(model.groupLabel)} ??</strong><small>?? ???? ?? ??</small></div>
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
    chart.setOption({ graphic: [{ type: "text", left: "center", top: "middle", style: { text: "??? ?? ???? ????.", fill: "#b8c4d6", font: '600 15px "Segoe UI", "Noto Sans KR", sans-serif' } }] }, true);
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
  return links.find((link) => link.key === state.crypto.pageKey)?.label || String(marketsBootstrap.crypto_page_label || "???");
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
    refs.cryptoCooldownText.textContent = "?? ???? ?? ??? ? ????.";
    return;
  }
  refs.cryptoRefreshButton.disabled = true;
  refs.cryptoCooldownText.textContent = `?? ?????? ${Math.ceil(remaining / 1000)}?`;
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

function renderCryptoErrorState() {
  const message = state.crypto.errorMessage || "?? ???? ???? ?????.";
  if (refs.cryptoPageHighlights) {
    refs.cryptoPageHighlights.innerHTML = `
      <div class="crypto-stat-grid">
        <article class="crypto-stat-card scanner-detail-card">
          <span class="crypto-card-label">?? ??</span>
          <strong class="crypto-card-value">?? ??</strong>
          <p class="crypto-card-note">${escapeHtml(message)}</p>
        </article>
      </div>
    `;
  }
  if (refs.cryptoPageControls) {
    refs.cryptoPageControls.innerHTML = `
      <article class="crypto-panel crypto-panel-controls">
        <div class="crypto-panel-head">
          <strong>??? ??</strong>
          <span>?? ?? ??? ??</span>
        </div>
        <div class="analysis-empty">${escapeHtml(message)}</div>
      </article>
    `;
  }
  if (refs.cryptoPageContent) {
    refs.cryptoPageContent.innerHTML = `<div class="analysis-empty">${escapeHtml(message)}</div>`;
  }
}

function populateCryptoControls() {
  const manifest = state.crypto.manifest;
  if (!manifest || !refs.cryptoUniverseSelect || !refs.cryptoTimeframeSelect) return;
  refs.cryptoUniverseSelect.innerHTML = asArray(manifest.universe_presets).map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.crypto.universeKey ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
  refs.cryptoTimeframeSelect.innerHTML = asArray(manifest.timeframes).map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.crypto.timeframe ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
}

function cryptoDataMissingMessage() {
  const baseMessage = "??? ??? ?? ?????. ??? ? ???? ??? ???? ???????.";
  if (state.crypto.pageKey === "patterns") {
    return `??? ??? ?? ??? ??? ?? ?????. ${baseMessage}`;
  }
  return `${currentCryptoPageLabel()} ??? ???? ?? ???? ?????. ${baseMessage}`;
}

function resolveCryptoPageDatasetPath() {
  const manifest = state.crypto.manifest;
  if (!manifest) return null;
  const pageFiles = manifest.page_data?.[state.crypto.pageKey]?.[state.crypto.universeKey] || {};
  return pageFiles[state.crypto.timeframe] || null;
}

function resolveCryptoPageDatasetUrl() {
  const datasetPath = resolveCryptoPageDatasetPath();
  if (datasetPath) return resolveScannerDataUrl(datasetPath);
  if (state.crypto.pageKey === "patterns") {
    const snapshot = currentCryptoSnapshotMeta();
    return snapshot ? resolveScannerDataUrl(snapshot.path) : null;
  }
  return null;
}

function cryptoManifestCandidates() {
  const candidates = [
    String(marketsBootstrap.scanner_manifest_url || "").trim(),
    resolveSiteUrl("data/scanner/manifest.json"),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

async function loadCryptoManifest({ bust = false } = {}) {
  let lastError = null;
  for (const candidate of cryptoManifestCandidates()) {
    try {
      state.crypto.manifest = await loadJson(candidate, { bust });
      state.crypto.manifestUrl = candidate;
      state.crypto.errorMessage = "";
      const manifest = state.crypto.manifest;
      const firstUniverse = manifest?.universe_presets?.[0]?.key;
      const firstTimeframe = manifest?.timeframes?.[0]?.key;
      if (firstUniverse && !asArray(manifest.universe_presets).some((item) => item.key === state.crypto.universeKey)) state.crypto.universeKey = firstUniverse;
      if (firstTimeframe && !asArray(manifest.timeframes).some((item) => item.key === state.crypto.timeframe)) state.crypto.timeframe = firstTimeframe;
      return;
    } catch (error) {
      lastError = error;
    }
  }
  state.crypto.errorMessage = "??? ??? ?? ?????. ??? ? ???? ??? ???? ???????.";
  throw lastError || new Error(state.crypto.errorMessage);
}

async function loadCryptoPagePayload({ bust = false } = {}) {
  const previousTimestamp = currentCryptoDataTimestamp();
  const datasetUrl = resolveCryptoPageDatasetUrl();
  if (!datasetUrl) {
    state.crypto.notice = state.crypto.pageKey === "patterns"
      ? "??? ??? ?? ???? ???? ?????."
      : `${currentCryptoPageLabel()} ??? ??? ?? ??? ??? ???.`;
    state.crypto.errorMessage = cryptoDataMissingMessage();
    state.crypto.pagePayload = null;
    state.crypto.isLoading = false;
    renderCryptoPage();
    return;
  }
  try {
    state.crypto.pagePayload = await loadJson(datasetUrl, { bust });
    setCryptoLoadedAt();
    state.crypto.errorMessage = "";
    const nextTimestamp = currentCryptoDataTimestamp();
    if (bust) {
      state.crypto.notice = previousTimestamp && previousTimestamp === nextTimestamp
        ? "?? ????? ?? ??? ??? ?????."
        : "?? ?? ???? ?? ??????.";
    } else if (!state.crypto.notice) {
      state.crypto.notice = "?? ?? ??? ???? ?? ????.";
    }
  } catch (error) {
    state.crypto.notice = state.crypto.pageKey === "patterns"
      ? "??? ?? ???? ???? ?????."
      : `${currentCryptoPageLabel()} ??? ???? ???? ?????.`;
    if (!state.crypto.pagePayload) {
      state.crypto.errorMessage = cryptoDataMissingMessage();
    }
    throw error;
  } finally {
    state.crypto.isLoading = false;
    renderCryptoPage();
  }
}

function renderCryptoSummaryMeta() {
  const snapshot = currentCryptoSnapshotMeta();
  const dataTimestamp = currentCryptoDataTimestamp();
  const loadedTimestamp = state.crypto.lastLoadedAt;
  const universeLabel = asArray(state.crypto.manifest?.universe_presets).find((item) => item.key === state.crypto.universeKey)?.label || state.crypto.universeKey;
  const freshness = buildFreshnessState(dataTimestamp);

  if (refs.cryptoSummaryMeta) {
    refs.cryptoSummaryMeta.innerHTML = `
      <span class="scanner-summary-pill">??? ??(????) ${escapeHtml(formatSeoulDateTime(dataTimestamp))}</span>
      <span class="scanner-summary-pill">??? ??(????) ${escapeHtml(formatSeoulDateTime(loadedTimestamp))}</span>
      <span class="scanner-summary-pill ${freshness.className}">?? ?? ${escapeHtml(freshness.elapsedLabel)}</span>
      <span class="scanner-summary-pill ${freshness.className}">?? ${escapeHtml(freshness.label)}</span>
      <span class="scanner-summary-pill">${escapeHtml(universeLabel)}</span>
      <span class="scanner-summary-pill">${escapeHtml(currentCryptoPageLabel())}</span>
    `;
  }

  if (refs.cryptoActiveScan) {
    refs.cryptoActiveScan.innerHTML = snapshot
      ? `<span class="scanner-active-pill ${freshness.className}">?? ?? ??? ?? ? ${escapeHtml(freshness.label)} ? [${escapeHtml(String(snapshot.symbols_scanned || 0))}/${escapeHtml(String(currentUniverseLimit() || snapshot.symbols_scanned || 0))}] ${escapeHtml(snapshot.timeframe_label || state.crypto.timeframe)} ??? ?? ${escapeHtml(formatSeoulDateTime(snapshot.generated_at))}</span>`
      : '<span class="scanner-active-pill">??? ??? ???? ?? ????.</span>';
  }

  if (refs.cryptoStatusLine) {
    if (state.crypto.errorMessage) {
      refs.cryptoStatusLine.textContent = state.crypto.notice || state.crypto.errorMessage;
    } else if (snapshot) {
      refs.cryptoStatusLine.textContent = `${state.crypto.notice} ??? ?? ${formatSeoulDateTime(dataTimestamp)}, ??? ${formatSeoulDateTime(loadedTimestamp)}? ???? ${freshness.elapsedLabel}.`;
    } else {
      refs.cryptoStatusLine.textContent = state.crypto.notice || "?? ??? ???? ???? ????.";
    }
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
  if (!pattern) return renderBadge("?? ??", "is-neutral");
  return renderBadge(`${pattern.side_label} ${pattern.pattern}`, pattern.side === "bullish" ? "is-positive" : "is-negative");
}

function renderSetupLink(pattern) {
  if (!pattern?.detail_page) return '<span class="crypto-inline-muted">?? ??</span>';
  return `<a class="scanner-link-button" href="${escapeHtml(resolveMarketUrl(pattern.detail_page))}">?? ??</a>`;
}

function renderFlags(flags) {
  return flags?.length ? flags.map((flag) => renderBadge(flag)).join("") : '<span class="crypto-inline-muted">??? ??? ??</span>';
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
  const statusCards = asArray(payload.status_counts).map((entry) => ({ label: entry.label, count: entry.count, note: "?? ?? ??" }));
  const previews = asArray(payload.page_previews).map((card) => `<article class="crypto-preview-card"><div class="crypto-preview-head"><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.symbol)}</span></div><p>${escapeHtml(card.description)}</p><span class="crypto-preview-score">Score ${escapeHtml(String(card.score ?? 0))}</span></article>`).join("");
  return `<div class="crypto-control-grid"><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>??? ???</strong><span>?? ??? ??</span></div>${renderCountCards(statusCards)}</article><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>??? ????</strong><span>? ?? ?? ?? ??</span></div><div class="crypto-preview-grid">${previews}</div></article></div>`;
}

function renderOverviewContent(payload) {
  const opportunities = asArray(payload.top_opportunities).slice(0, 6).map((row) => `
    <article class="crypto-opportunity-card scanner-card">
      <div class="scanner-card-head">
        <div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.labels?.technical_rating || "Neutral")} ? ${escapeHtml(row.labels?.trend_bias || "-")}</p></div>
        <div class="scanner-card-badges">${renderPatternBadge(row.pattern)}<span class="scanner-badge is-score">???? ${escapeHtml(String(row.scores?.opportunity ?? 0))}</span></div>
      </div>
      <div class="crypto-kpi-pair-grid">
        <div class="scanner-point-card"><span>???</span><strong>${escapeHtml(formatTickerPrice(row.last_price))}</strong></div>
        <div class="scanner-point-card"><span>24h</span><strong class="${toneClass(row.change_24h)}">${escapeHtml(formatPercent(row.change_24h))}</strong></div>
        <div class="scanner-point-card"><span>??</span><strong>${escapeHtml(String(row.scores?.technical ?? 0))}</strong></div>
        <div class="scanner-point-card"><span>??</span><strong>${escapeHtml(String(row.scores?.derivatives ?? 0))}</strong></div>
      </div>
      <div class="scanner-card-flags">${renderFlags(asArray(row.flags).slice(0, 4))}</div>
      <div class="scanner-card-footer"><span>${escapeHtml(row.timeframe_label || "-")}</span>${renderSetupLink(row.pattern)}</div>
    </article>
  `).join("");
  const patterns = asArray(payload.top_patterns).slice(0, 4).map((row) => `
    <article class="crypto-compact-card scanner-detail-card">
      <div class="crypto-compact-head"><strong>${escapeHtml(row.symbol)}</strong>${renderPatternBadge(row.pattern)}</div>
      <p>${escapeHtml(row.pattern?.summary || "?? ?? ??")}</p>
      <div class="crypto-compact-meta"><span>?? ${escapeHtml(String(row.pattern?.score ?? 0))}</span><span>?? ${escapeHtml(String(row.scores?.technical ?? 0))}</span><span>??? ${escapeHtml(String(row.scores?.momentum ?? 0))}</span></div>
    </article>
  `).join("");
  return `${renderSection("Overview", "?? ?? ??", `<div class="crypto-opportunity-grid">${opportunities}</div>`)}${renderSection("Patterns", "?? ???", `<div class="crypto-compact-grid">${patterns}</div>`)}`;
}

function renderSignalsPage(payload) {
  const anomaly = payload.anomaly_counts || {};
  refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge(`Funding Hot ${anomaly.funding_hot || 0}`)}${renderBadge(`OI Heavy ${anomaly.oi_heavy || 0}`)}${renderBadge(`Squeeze ${anomaly.squeeze || 0}`)}${renderBadge(`Divergence ${anomaly.divergence || 0}`)}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Signals",
    "?? ?? + ?? ?? ???",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "24h", render: (row) => `<span class="${toneClass(row.change_24h)}">${escapeHtml(formatPercent(row.change_24h))}</span>` },
        { label: "Funding", render: (row) => `<span class="${toneClass(row.funding_rate)}">${escapeHtml(formatPercent(row.funding_rate, 4))}</span>` },
        { label: "OI", render: (row) => escapeHtml(formatUsdCompact(row.open_interest_usd)) },
        { label: "L/S", render: (row) => escapeHtml(formatRatio(row.long_short_ratio, 3)) },
        { label: "RSI", render: (row) => escapeHtml(String(row.indicators?.rsi14 ?? "-")) },
        { label: "MACD", render: (row) => `<span class="${toneClass(row.indicators?.macd_histogram)}">${escapeHtml(String(row.indicators?.macd_histogram ?? "-"))}</span>` },
        { label: "VWAP Gap", render: (row) => `<span class="${toneClass(row.indicators?.close_vs_vwap_pct)}">${escapeHtml(formatPercent(row.indicators?.close_vs_vwap_pct))}</span>` },
        { label: "??", render: (row) => renderPatternBadge(row.pattern) },
      ],
      asArray(payload.rows).slice(0, 40),
      "??? ??? ????.",
    ),
  );
}

function buildPatternSummaryCards(snapshot) {
  const counts = snapshot?.status_counts || {};
  return [
    { label: "?? ??", count: snapshot?.result_count || 0, note: "?? ??? ?? ?" },
    { label: "??? ??", count: counts.forming || 0, note: "PRZ ?? ???" },
    { label: "??? ??", count: counts.touch || 0, note: "PRZ ??" },
    { label: "T-Bar ??", count: counts.tbar_complete || 0, note: "?? ?? ??" },
    { label: "?? ??", count: counts.complete || 0, note: "?? ??" },
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
  if (!results.length) return '<div class="analysis-empty">?? ???? ??? ??? ????.</div>';
  return `<div class="scanner-results-grid">${results.map((result) => {
    const pointCells = ["X", "A", "B", "C", "D"].map((label) => {
      const point = result.points?.[label] || {};
      return `<div class="scanner-point-card"><span>${label}</span><strong>${escapeHtml(String(point.price ?? "-"))}</strong><small>${escapeHtml(String(point.timestamp || "").replace("T", " ").slice(5, 16))}</small></div>`;
    }).join("");
    const ratioCells = Object.entries(result.ratios || {}).map(([label, value]) => `<div class="scanner-ratio-card"><span>${escapeHtml(label.toUpperCase())}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");
    const flags = asArray(result.indicator_flags).slice(0, 4).map((flag) => `<span class="scanner-flag-pill ${flag.status === "pass" ? "is-pass" : ""}">${escapeHtml(flag.label)} ? ${escapeHtml(flag.value)}</span>`).join("");
    return `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(result.symbol)}</h3><p>${escapeHtml(result.summary || "")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${result.side === "bullish" ? "is-bullish" : "is-bearish"}">${escapeHtml(result.side_label)}</span><span class="scanner-badge is-score">??? ${escapeHtml(String(result.score))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(result.preview_image))}" alt="${escapeHtml(result.symbol)} pattern preview" loading="lazy" /></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>??</span><strong>${escapeHtml(result.pattern)}</strong></div><div class="scanner-point-grid">${pointCells}</div></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>??</span><strong>${escapeHtml(result.status_label)}</strong></div><div class="scanner-ratio-grid">${ratioCells}</div></div><div class="scanner-prz-box"><div><span>PRZ</span><strong>${escapeHtml(String(result.prz?.lower ?? "-"))} ~ ${escapeHtml(String(result.prz?.upper ?? "-"))}</strong></div><div><span>TP1 / TP2</span><strong>${escapeHtml(String(result.targets?.tp1 ?? "-"))} / ${escapeHtml(String(result.targets?.tp2 ?? "-"))}</strong></div><div><span>SL</span><strong>${escapeHtml(String(result.stop?.value ?? "-"))}</strong></div></div><div class="scanner-card-flags">${flags || '<span class="crypto-inline-muted">?? ?? ??</span>'}</div><div class="scanner-card-footer"><span>${escapeHtml(result.timeframe_label || "-")} ? 24h ${escapeHtml(formatPercent(result.change_24h))}</span><a class="scanner-link-button" href="${escapeHtml(resolveMarketUrl(result.detail_page))}">?? ??</a></div></article>`;
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
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("?? ?? 40")}${renderBadge("PRZ/?? 20")}${renderBadge("?? ?? 15")}${renderBadge("?? 10")}${renderBadge("??? 10")}${renderBadge("??? 5")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Opportunities",
    "?? ? ?? ?? ??",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "??", render: (row) => renderPatternBadge(row.pattern) },
        { label: "????", render: (row) => escapeHtml(String(row.scores?.opportunity ?? 0)) },
        { label: "??", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "??", render: (row) => escapeHtml(String(row.scores?.derivatives ?? 0)) },
        { label: "??", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "???", render: (row) => escapeHtml(row.labels?.momentum_bias || "-") },
        { label: "??", render: (row) => renderSetupLink(row.pattern) },
      ],
      asArray(payload.rows),
      "???? ??? ?? ????.",
    ),
  );
}

function renderSetupsPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("?? ???? ?? ??")}${renderBadge("?? ????? ?? ????? ??")}</div>`;
  refs.cryptoPageContent.innerHTML = `<div class="crypto-opportunity-grid">${asArray(payload.rows).map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.pattern?.summary || "?? ?? ??")}</p></div><div class="scanner-card-badges">${renderPatternBadge(row.pattern)}<span class="scanner-badge is-score">???? ${escapeHtml(String(row.scores?.opportunity ?? 0))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(row.pattern?.preview_image || ""))}" alt="${escapeHtml(row.symbol)} preview" loading="lazy" /></div><div class="crypto-kpi-pair-grid"><div class="scanner-point-card"><span>??</span><strong>${escapeHtml(String(row.scores?.technical ?? 0))}</strong></div><div class="scanner-point-card"><span>??</span><strong>${escapeHtml(String(row.scores?.trend ?? 0))}</strong></div><div class="scanner-point-card"><span>???</span><strong>${escapeHtml(String(row.scores?.momentum ?? 0))}</strong></div><div class="scanner-point-card"><span>??</span><strong>${escapeHtml(String(row.scores?.derivatives ?? 0))}</strong></div></div><div class="scanner-card-flags">${renderFlags(asArray(row.flags).slice(0, 5))}</div><div class="scanner-card-footer"><span>${escapeHtml(row.labels?.trend_bias || "-")} ? ${escapeHtml(row.labels?.momentum_bias || "-")}</span>${renderSetupLink(row.pattern)}</div></article>`).join("")}</div>`;
}

function renderTechnicalRatingsPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards(asArray(payload.distribution).map((entry) => ({ label: entry.label, count: entry.count, note: "?? ??? ??" })));
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA 20/50/200")}${renderBadge("Supertrend")}${renderBadge("Ichimoku")}${renderBadge("RSI / MACD / ROC")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Technical Ratings",
    "TradingView ??? ?? ?? ??",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "???", render: (row) => renderBadge(row.labels?.technical_rating || "Neutral", ratingToneClass(row.labels?.technical_rating)) },
        { label: "??", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "??", render: (row) => escapeHtml(String(row.scores?.moving_average ?? 0)) },
        { label: "?????", render: (row) => escapeHtml(String(row.scores?.oscillator ?? 0)) },
        { label: "??", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "??", render: (row) => renderPatternBadge(row.pattern) },
      ],
      asArray(payload.rows),
      "?? ??? ???? ????.",
    ),
  );
}

function renderTrendPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "?? ??", count: payload.counts?.bullish || 0, note: "?? ?? ??" }, { label: "?? ??", count: payload.counts?.bearish || 0, note: "?? ?? ??" }, { label: "??", count: payload.counts?.mixed || 0, note: "?? ??" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA Cross")}${renderBadge("Supertrend")}${renderBadge("ADX / DMI")}${renderBadge("Ichimoku")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Trend",
    "?? ??? ?? ??",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "??", render: (row) => renderBadge(row.labels?.trend_bias || "-", toneClass(row.scores?.trend_bias)) },
        { label: "??", render: (row) => escapeHtml(String(row.scores?.trend ?? 0)) },
        { label: "ADX", render: (row) => escapeHtml(String(row.indicators?.adx14 ?? "-")) },
        { label: "+DI / -DI", render: (row) => `${escapeHtml(String(row.indicators?.plus_di ?? "-"))} / ${escapeHtml(String(row.indicators?.minus_di ?? "-"))}` },
        { label: "Supertrend", render: (row) => escapeHtml(row.signals?.supertrend || "-") },
        { label: "Ichimoku", render: (row) => escapeHtml(row.signals?.ichimoku_bias || "-") },
      ],
      asArray(payload.rows),
      "?? ???? ????.",
    ),
  );
}

function renderMomentumPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "???", count: payload.counts?.overbought || 0, note: "?? ?? ??" }, { label: "???", count: payload.counts?.oversold || 0, note: "?? ?? ??" }, { label: "?????", count: payload.counts?.divergence || 0, note: "?? ??" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("RSI 14")}${renderBadge("Stoch RSI")}${renderBadge("MACD")}${renderBadge("ROC")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Momentum",
    "???????? ??? ??",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "???", render: (row) => renderBadge(row.labels?.momentum_bias || "-", toneClass(row.scores?.momentum_bias)) },
        { label: "RSI", render: (row) => escapeHtml(String(row.indicators?.rsi14 ?? "-")) },
        { label: "Stoch RSI", render: (row) => escapeHtml(String(row.indicators?.stoch_rsi ?? "-")) },
        { label: "MACD", render: (row) => `<span class="${toneClass(row.indicators?.macd_histogram)}">${escapeHtml(String(row.indicators?.macd_histogram ?? "-"))}</span>` },
        { label: "ROC", render: (row) => `<span class="${toneClass(row.indicators?.roc12)}">${escapeHtml(formatPercent(row.indicators?.roc12))}</span>` },
        { label: "?????", render: (row) => escapeHtml(row.signals?.divergence_candidate ? "??" : "-") },
      ],
      asArray(payload.rows),
      "??? ???? ????.",
    ),
  );
}

function renderVolatilityPage(payload) {
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "Squeeze", count: payload.counts?.squeeze || 0, note: "?? ??" }, { label: "?? ??", count: payload.counts?.breakout_up || 0, note: "?? ????" }, { label: "?? ??", count: payload.counts?.breakout_down || 0, note: "?? ????" }, { label: "??", count: payload.counts?.expansion || 0, note: "??? ??" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("Bollinger Bands")}${renderBadge("BBWidth")}${renderBadge("ATR 14")}${renderBadge("Breakout State")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection(
    "Volatility",
    "?? ? ?? ? ?? ?? ??",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "??", render: (row) => renderScoreStack(row) },
        { label: "??", render: (row) => renderBadge(row.labels?.volatility_state || "??", row.labels?.volatility_state === "?? ??" ? "is-positive" : row.labels?.volatility_state === "?? ??" ? "is-negative" : "is-neutral") },
        { label: "BB Width", render: (row) => escapeHtml(String(row.indicators?.bb_width ?? "-")) },
        { label: "ATR%", render: (row) => escapeHtml(formatPercent(row.indicators?.atr_pct)) },
        { label: "Squeeze", render: (row) => escapeHtml(row.signals?.squeeze ? "?" : "-") },
        { label: "??", render: (row) => escapeHtml(row.signals?.breakout_up ? "?" : "-") },
        { label: "??", render: (row) => escapeHtml(row.signals?.breakout_down ? "?" : "-") },
      ],
      asArray(payload.rows),
      "??? ???? ????.",
    ),
  );
}

function renderMultiTimeframePage(payload) {
  const rows = asArray(payload.rows).slice(0, 24);
  const cards = rows.length
    ? `<div class="crypto-mtf-grid">${rows.map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.consensus_label || "-")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${toNumber(row.agreement_score) > 0 ? "is-bullish" : toNumber(row.agreement_score) < 0 ? "is-bearish" : ""}">${escapeHtml(String(row.agreement_score ?? 0))}</span></div></div><div class="crypto-mtf-table">${Object.entries(row.timeframes || {}).map(([timeframe, details]) => `<div class="crypto-mtf-row"><strong>${escapeHtml(timeframe)}</strong><span>${escapeHtml(details.technical_rating || "-")}</span><span>${escapeHtml(details.trend_bias || "-")}</span><span>${escapeHtml(details.momentum_bias || "-")}</span><span>${escapeHtml(String(details.opportunity ?? "-"))}</span></div>`).join("")}</div></article>`).join("")}</div>`
    : '<div class="analysis-empty">?? ????? ???? ????.</div>';
  refs.cryptoPageHighlights.innerHTML = renderCountCards([{ label: "?? ??", count: payload.counts?.bullish || 0, note: "3? ?? ??? ??" }, { label: "?? ??", count: payload.counts?.bearish || 0, note: "3? ?? ??? ??" }, { label: "??", count: payload.counts?.mixed || 0, note: "?? ??" }]);
  refs.cryptoPageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("5m")}${renderBadge("15m")}${renderBadge("1h")}${renderBadge("4h")}</div>`;
  refs.cryptoPageContent.innerHTML = renderSection("Multi-Timeframe", "????? ?? ????", cards);
}

function renderCryptoPage() {
  populateCryptoControls();
  renderCryptoPageTabs();
  updateCryptoCooldownUI();
  renderCryptoSummaryMeta();

  if (state.crypto.isLoading) {
    renderCryptoSkeleton();
    return;
  }

  if (state.crypto.errorMessage && !state.crypto.pagePayload) {
    renderCryptoErrorState();
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
    refs.cryptoPageContent.innerHTML = '<div class="analysis-empty">? ? ?? ?? ??????.</div>';
  }
}

// INIT

function bindCryptoEvents() {
  if (refs.cryptoUniverseSelect) {
    refs.cryptoUniverseSelect.addEventListener("change", async (event) => {
      state.crypto.universeKey = event.target.value;
      state.crypto.isLoading = true;
      state.crypto.notice = "??? ??? ?? ?? ???? ???? ????.";
      renderCryptoPage();
      await loadCryptoPagePayload();
    });
  }
  if (refs.cryptoTimeframeSelect) {
    refs.cryptoTimeframeSelect.addEventListener("change", async (event) => {
      state.crypto.timeframe = event.target.value;
      state.crypto.isLoading = true;
      state.crypto.notice = "??? ??? ?? ?? ???? ???? ????.";
      renderCryptoPage();
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
      state.crypto.isLoading = true;
      state.crypto.notice = "?? ?? ???? ???? ????.";
      renderCryptoPage();
      try {
        await loadCryptoManifest({ bust: true });
        await loadCryptoPagePayload({ bust: true });
      } catch (error) {
        state.crypto.isLoading = false;
        if (!state.crypto.errorMessage) {
          state.crypto.errorMessage = error?.message || "?? ???? ???? ?????.";
        }
        state.crypto.notice = state.crypto.errorMessage;
        renderCryptoPage();
      }
    });
  }
  window.setInterval(() => {
    updateCryptoCooldownUI();
    if (!state.crypto.isLoading) {
      renderCryptoSummaryMeta();
    }
  }, 1000);
}

function renderMarkets() {
  renderCryptoPage();
}

async function initCryptoMarkets() {
  state.crypto.isLoading = true;
  renderCryptoPage();
  bindCryptoEvents();
  await loadCryptoManifest();
  await loadCryptoPagePayload();
}

async function initMarkets() {
  renderMarkets();
  try {
    await initCryptoMarkets();
  } catch (error) {
    state.crypto.isLoading = false;
    if (!state.crypto.errorMessage) {
      state.crypto.errorMessage = error?.message || "?? ???? ???? ?????.";
    }
    state.crypto.notice = state.crypto.errorMessage;
    renderCryptoPage();
  }
}

if (bootstrapElement) {
  void initMarkets();
}
