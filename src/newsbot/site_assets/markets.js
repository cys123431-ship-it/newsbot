const marketsBootstrap = JSON.parse(document.getElementById("markets-bootstrap").textContent);

const refs = {
  mainTabs: document.getElementById("markets-main-tabs"),
  subTabs: document.getElementById("markets-subfilter-tabs"),
  benchmarkStrip: document.getElementById("markets-benchmark-strip"),
  selectionSummary: document.getElementById("markets-selection-summary"),
  board: document.getElementById("markets-treemap-board"),
  legend: document.getElementById("markets-legend"),
  statusLine: document.getElementById("markets-status-line"),
  scannerShell: document.getElementById("scanner-shell"),
  scannerUniverseSelect: document.getElementById("scanner-universe-select"),
  scannerTimeframeSelect: document.getElementById("scanner-timeframe-select"),
  scannerRefreshButton: document.getElementById("scanner-refresh-button"),
  scannerCooldownText: document.getElementById("scanner-cooldown-text"),
  scannerStatusLine: document.getElementById("scanner-status-line"),
  scannerProgressBar: document.getElementById("scanner-progress-bar"),
  scannerSummaryMeta: document.getElementById("scanner-summary-meta"),
  scannerActiveScan: document.getElementById("scanner-active-scan"),
  scannerFilterTabs: document.getElementById("scanner-filter-tabs"),
  scannerResults: document.getElementById("scanner-results"),
};

const MAIN_TABS = [
  { key: "us", label: "미국주식" },
  { key: "korea", label: "한국주식" },
  { key: "crypto", label: "코인" },
];

const SUBFILTERS = {
  korea: [{ key: "kospi", label: "KOSPI" }, { key: "kosdaq", label: "KOSDAQ" }],
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

const SCANNER_FILTERS = [
  { key: "all", label: "전체" },
  { key: "forming", label: "실시간 진입" },
  { key: "touch", label: "실시간 터치" },
  { key: "tbar_complete", label: "T-Bar 완성" },
  { key: "complete", label: "일반 완성" },
];

const SCANNER_STORAGE_KEY = "newsbot-scanner-refresh-cooldown";
const SCANNER_COOLDOWN_MS = 45_000;

const state = {
  surface: MAIN_TABS.some((tab) => tab.key === marketsBootstrap.initial_surface)
    ? marketsBootstrap.initial_surface
    : "korea",
  filters: { korea: "kospi", us: "sp500" },
  chart: null,
  scanner: {
    manifest: null,
    snapshot: null,
    universeKey: "top100",
    timeframe: "5m",
    filter: "all",
    cooldownUntil: Number.parseInt(localStorage.getItem(SCANNER_STORAGE_KEY) || "0", 10) || 0,
  },
};

const payloads = { status: null, us: null, korea: null, crypto: null };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(toNumber(value));
}

function formatPercent(value) {
  const numeric = toNumber(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatTickerPrice(value) {
  const numeric = toNumber(value);
  if (numeric <= 0) return "-";
  if (numeric >= 1000) {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric)}`;
  }
  if (numeric >= 1) {
    return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(numeric)}`;
  }
  return `$${numeric.toFixed(5)}`;
}

function formatMarketPrice(value, surface) {
  const numeric = toNumber(value);
  if (numeric <= 0) return "-";
  if (surface === "korea") {
    return `₩${new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(numeric)}`;
  }
  return formatTickerPrice(numeric);
}

function formatCap(value, surface) {
  return `${surface === "korea" ? "₩" : "$"}${formatCompact(value)}`;
}

function activeSubfilters() {
  return SUBFILTERS[state.surface] || [];
}

function loadJson(url, { bust = false } = {}) {
  const target = bust ? `${url}${url.includes("?") ? "&" : "?"}ts=${Date.now()}` : url;
  return fetch(target, { cache: bust ? "no-store" : "default" }).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  });
}

function currentPayload() {
  return state.surface === "us" ? payloads.us : payloads.korea;
}

function renderMainTabs() {
  if (!refs.mainTabs) return;
  const routes = Array.isArray(marketsBootstrap.surface_links) ? marketsBootstrap.surface_links : [];
  refs.mainTabs.innerHTML = MAIN_TABS.map((tab) => {
    const href = routes.find((item) => item.key === tab.key)?.href || "#";
    return `<a class="market-tab-button ${tab.key === state.surface ? "is-active" : ""}" href="${escapeHtml(href)}">${escapeHtml(tab.label)}</a>`;
  }).join("");
}

function renderSubTabs() {
  if (!refs.subTabs) return;
  const current = state.filters[state.surface];
  refs.subTabs.innerHTML = activeSubfilters()
    .map(
      (tab) => `
        <button type="button" class="market-subtab-button ${tab.key === current ? "is-active" : ""}" data-filter="${tab.key}">
          ${escapeHtml(tab.label)}
        </button>
      `,
    )
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
  const stamp = payloads.status?.generated_at;
  if (stamp) parts.push(`업데이트 ${stamp}`);
  refs.statusLine.textContent = parts.join(" · ");
}

function resolveSurfaceModel() {
  const payload = currentPayload();
  const filterKey = state.filters[state.surface];
  const subfilter = activeSubfilters().find((item) => item.key === filterKey) || activeSubfilters()[0];
  const rows = (Array.isArray(payload?.rows) ? payload.rows : []).filter((row) => toNumber(row.market_cap) > 0);

  if (state.surface === "korea") {
    const exchange = filterKey === "kosdaq" ? "KOSDAQ" : "KOSPI";
    return {
      surface: "korea",
      title: `한국주식 · ${subfilter?.label || "KOSPI"}`,
      subtitle: `${subfilter?.label || "KOSPI"} 종목 시가총액 비중`,
      groupLabel: "섹터",
      rows: rows
        .filter((row) => String(row.exchange || "").toUpperCase().includes(exchange))
        .sort((a, b) => toNumber(b.market_cap) - toNumber(a.market_cap))
        .slice(0, 120),
      benchmarks: (payload?.benchmarks || []).filter(
        (row) => String(row.symbol || "").toUpperCase() === exchange,
      ),
      asOf: payload?.as_of || payload?.generated_at || "",
    };
  }

  const members = new Set(((payload?.index_memberships || {})[filterKey] || []).map((item) => String(item).toUpperCase()));
  const filteredRows = rows
    .filter((row) => members.has(String(row.symbol || "").toUpperCase()))
    .sort((a, b) => toNumber(b.market_cap) - toNumber(a.market_cap))
    .slice(0, 160);
  return {
    surface: "us",
    title: `미국주식 · ${subfilter?.label || "S&P 500"}`,
    subtitle: US_INDEX_HEADLINES[filterKey] || `${subfilter?.label || "S&P 500"} 구성 종목 비중`,
    groupLabel: "섹터",
    rows: filteredRows.length ? filteredRows : rows.slice(0, 120),
    benchmarks: (payload?.benchmarks || []).filter(
      (row) => String(row.symbol || "").toUpperCase() === US_INDEX_PROXY_SYMBOLS[filterKey],
    ),
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
    if (!grouped.has(categoryLabel)) {
      grouped.set(categoryLabel, { name: categoryLabel, value: 0, children: [] });
    }
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
      itemStyle: {
        color: resolveTreemapColor(row.change_pct, model.surface),
        borderColor: "rgba(10,14,19,.72)",
        borderWidth: 1,
      },
    });
  });

  return {
    name: model.title,
    value: total,
    children: Array.from(grouped.values()).sort((a, b) => b.value - a.value),
  };
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
    (model.benchmarks || [])
      .map(
        (item) => `
          <article class="market-benchmark-card">
            <span class="market-benchmark-label">${escapeHtml(item.name || item.symbol || "-")}</span>
            <strong>${escapeHtml(formatMarketPrice(item.last, model.surface))}</strong>
            <div class="market-benchmark-move">
              <span class="${toNumber(item.change_pct) > 0 ? "is-positive" : toNumber(item.change_pct) < 0 ? "is-negative" : "is-flat"}">
                ${escapeHtml(formatPercent(item.change_pct))}
              </span>
            </div>
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
  refs.selectionSummary.innerHTML = cards
    .map(
      (card) => `
        <article class="market-summary-card">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          <small>${escapeHtml(card.detail)}</small>
        </article>
      `,
    )
    .join("");
}

function renderLegend(model) {
  if (!refs.legend) return;
  const toneText = model.surface === "korea" ? "상승은 붉은색, 하락은 푸른색" : "상승은 초록색, 하락은 붉은색";
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
      if (params?.data?.detailUrl) {
        window.open(params.data.detailUrl, "_blank", "noopener,noreferrer");
      }
    });
  }
  return state.chart;
}

function renderTreemapSurface(model) {
  const chart = ensureChart();
  if (!chart) return;
  if (!model.rows.length) {
    chart.clear();
    chart.setOption(
      {
        graphic: [
          {
            type: "text",
            left: "center",
            top: "middle",
            style: {
              text: "표시할 종목 데이터가 없습니다.",
              fill: "#b8c4d6",
              font: '600 15px "Segoe UI", "Noto Sans KR", sans-serif',
            },
          },
        ],
      },
      true,
    );
    return;
  }
  chart.setOption(buildTreemapOption(model), true);
  chart.resize();
}

function formatCountLabel(snapshot) {
  if (!snapshot) return "-";
  return `${snapshot.symbols_scanned || 0}/${snapshot.symbols_scanned || 0}`;
}

function scannerSelectedSnapshot() {
  return state.scanner.snapshot;
}

function resolveScannerSnapshotPath() {
  const manifest = state.scanner.manifest;
  if (!manifest) return null;
  const entry = (manifest.snapshots || []).find(
    (item) => item.universe_key === state.scanner.universeKey && item.timeframe === state.scanner.timeframe,
  );
  if (!entry) return null;
  const baseUrl = marketsBootstrap.scanner_manifest_url || "";
  return baseUrl.replace(/manifest\.json(?:\?.*)?$/, entry.path);
}

function setScannerCooldown() {
  state.scanner.cooldownUntil = Date.now() + SCANNER_COOLDOWN_MS;
  localStorage.setItem(SCANNER_STORAGE_KEY, String(state.scanner.cooldownUntil));
}

function updateScannerCooldownUI() {
  if (!refs.scannerRefreshButton || !refs.scannerCooldownText) return;
  const remaining = state.scanner.cooldownUntil - Date.now();
  if (remaining <= 0) {
    refs.scannerRefreshButton.disabled = false;
    refs.scannerCooldownText.textContent = "최근 정적 스냅샷을 다시 불러올 수 있습니다.";
    return;
  }
  refs.scannerRefreshButton.disabled = true;
  refs.scannerCooldownText.textContent = `다음 새로고침까지 ${Math.ceil(remaining / 1000)}초`;
}

function renderScannerSkeleton() {
  if (!refs.scannerResults) return;
  refs.scannerResults.innerHTML = Array.from({ length: 4 }, () => `
    <article class="scanner-card is-loading">
      <div class="scanner-skeleton scanner-skeleton-title"></div>
      <div class="scanner-skeleton scanner-skeleton-chip-row"></div>
      <div class="scanner-skeleton scanner-skeleton-preview"></div>
      <div class="scanner-skeleton scanner-skeleton-grid"></div>
    </article>
  `).join("");
}

function populateScannerControls() {
  const manifest = state.scanner.manifest;
  if (!manifest || !refs.scannerUniverseSelect || !refs.scannerTimeframeSelect) return;

  refs.scannerUniverseSelect.innerHTML = (manifest.universe_presets || [])
    .map(
      (item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.scanner.universeKey ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    )
    .join("");
  refs.scannerTimeframeSelect.innerHTML = (manifest.timeframes || [])
    .map(
      (item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.scanner.timeframe ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    )
    .join("");
}

function resolveScannerDetailHref(detailPage) {
  if (!detailPage) return "#";
  const normalized = String(detailPage).replace(/^\.?\//, "");
  if (window.location.pathname.includes("/markets/crypto/")) {
    return `../${normalized}`;
  }
  return normalized;
}

function resolveScannerPreviewSrc(previewImage) {
  if (!previewImage) return "";
  if (String(previewImage).startsWith("http")) return previewImage;
  const normalized = String(previewImage).replace(/^\.?\//, "");
  if (window.location.pathname.includes("/markets/crypto/")) {
    return `../../${normalized}`;
  }
  return `../${normalized}`;
}

function renderScannerSummary() {
  const manifest = state.scanner.manifest;
  const snapshot = scannerSelectedSnapshot();
  if (refs.scannerSummaryMeta) {
    refs.scannerSummaryMeta.innerHTML = manifest
      ? `<span class="scanner-summary-pill">마지막 갱신 ${escapeHtml(manifest.generated_at || "-")}</span>
         <span class="scanner-summary-pill">전체 결과 ${escapeHtml(String(manifest.total_results || 0))}</span>
         <span class="scanner-summary-pill">대상 ${escapeHtml(String(manifest.symbols_scanned || 0))}개</span>`
      : "";
  }
  if (refs.scannerActiveScan) {
    refs.scannerActiveScan.innerHTML = snapshot
      ? `<span class="scanner-active-pill">최근 배치 스캔 기준 · ${escapeHtml(snapshot.timeframe_label || state.scanner.timeframe)}</span>`
      : "";
  }
  if (refs.scannerStatusLine) {
    refs.scannerStatusLine.textContent = snapshot
      ? `상태: [${formatCountLabel(snapshot)}] 데이터 스캔 완료 · ${snapshot.generated_at}`
      : "스냅샷을 불러오는 중입니다.";
  }
  if (refs.scannerProgressBar) {
    const universe = (manifest?.universe_presets || []).find((item) => item.key === state.scanner.universeKey);
    const total = Number(universe?.limit || snapshot?.symbols_scanned || 1);
    const progress = Math.min(((snapshot?.symbols_scanned || 0) / Math.max(total, 1)) * 100, 100);
    refs.scannerProgressBar.style.width = `${progress}%`;
  }
}

function filteredScannerResults() {
  const snapshot = scannerSelectedSnapshot();
  const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
  if (state.scanner.filter === "all") return results;
  return results.filter((item) => item.status === state.scanner.filter);
}

function renderScannerFilters() {
  const snapshot = scannerSelectedSnapshot();
  if (!refs.scannerFilterTabs) return;
  const counts = snapshot?.status_counts || {};
  const total = Array.isArray(snapshot?.results) ? snapshot.results.length : 0;
  refs.scannerFilterTabs.innerHTML = SCANNER_FILTERS.map((filter) => {
    const count = filter.key === "all" ? total : Number(counts[filter.key] || 0);
    return `
      <button type="button" class="scanner-filter-button ${filter.key === state.scanner.filter ? "is-active" : ""}" data-scanner-filter="${filter.key}">
        <span>${escapeHtml(filter.label)}</span>
        <strong>${escapeHtml(String(count))}</strong>
      </button>
    `;
  }).join("");
  refs.scannerFilterTabs.querySelectorAll("[data-scanner-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.scannerFilter;
      if (!next) return;
      state.scanner.filter = next;
      renderScannerFilters();
      renderScannerResults();
    });
  });
}

function renderScannerResults() {
  if (!refs.scannerResults) return;
  const results = filteredScannerResults();
  if (!results.length) {
    refs.scannerResults.innerHTML = '<div class="analysis-empty">이 조건에서 표시할 패턴이 없습니다.</div>';
    return;
  }
  refs.scannerResults.innerHTML = results
    .map((result) => {
      const pointCells = ["X", "A", "B", "C", "D"]
        .map((label) => {
          const point = result.points?.[label] || {};
          return `
            <div class="scanner-point-card">
              <span>${label}</span>
              <strong>${escapeHtml(String(point.price ?? "-"))}</strong>
              <small>${escapeHtml(String(point.timestamp || "").replace("T", " ").slice(5, 16))}</small>
            </div>
          `;
        })
        .join("");
      const ratioCells = Object.entries(result.ratios || {})
        .map(
          ([label, value]) => `
            <div class="scanner-ratio-card">
              <span>${escapeHtml(label.toUpperCase())}</span>
              <strong>${escapeHtml(String(value))}</strong>
            </div>
          `,
        )
        .join("");
      const flagMarkup = (result.indicator_flags || [])
        .slice(0, 4)
        .map(
          (flag) => `
            <span class="scanner-flag-pill ${flag.status === "pass" ? "is-pass" : ""}">
              ${escapeHtml(flag.label)} · ${escapeHtml(flag.value)}
            </span>
          `,
        )
        .join("");
      return `
        <article class="scanner-card">
          <div class="scanner-card-head">
            <div>
              <h3>${escapeHtml(result.symbol)}</h3>
              <p>${escapeHtml(result.summary || "")}</p>
            </div>
            <div class="scanner-card-badges">
              <span class="scanner-badge ${result.side === "bullish" ? "is-bullish" : "is-bearish"}">${escapeHtml(result.side_label)}</span>
              <span class="scanner-badge is-score">신뢰도 ${escapeHtml(String(result.score))}</span>
            </div>
          </div>

          <div class="scanner-card-preview-wrap">
            <img class="scanner-card-preview" src="${escapeHtml(resolveScannerPreviewSrc(result.preview_image))}" alt="${escapeHtml(result.symbol)} pattern preview" loading="lazy" />
          </div>

          <div class="scanner-card-section">
            <div class="scanner-card-section-head">
              <span>좌표</span>
              <strong>${escapeHtml(result.pattern)}</strong>
            </div>
            <div class="scanner-point-grid">${pointCells}</div>
          </div>

          <div class="scanner-card-section">
            <div class="scanner-card-section-head">
              <span>비율</span>
              <strong>${escapeHtml(result.status_label)}</strong>
            </div>
            <div class="scanner-ratio-grid">${ratioCells}</div>
          </div>

          <div class="scanner-prz-box">
            <div>
              <span>PRZ</span>
              <strong>${escapeHtml(String(result.prz?.lower ?? "-"))} ~ ${escapeHtml(String(result.prz?.upper ?? "-"))}</strong>
            </div>
            <div>
              <span>TP1 / TP2</span>
              <strong>${escapeHtml(String(result.targets?.tp1 ?? "-"))} / ${escapeHtml(String(result.targets?.tp2 ?? "-"))}</strong>
            </div>
            <div>
              <span>SL</span>
              <strong>${escapeHtml(String(result.stop?.value ?? "-"))}</strong>
            </div>
          </div>

          <div class="scanner-card-flags">${flagMarkup}</div>

          <div class="scanner-card-footer">
            <span>${escapeHtml(result.timeframe_label || "-")} · 24h ${escapeHtml(formatPercent(result.change_24h))}</span>
            <a class="scanner-link-button" href="${escapeHtml(resolveScannerDetailHref(result.detail_page))}">상세 보기</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderScanner() {
  populateScannerControls();
  updateScannerCooldownUI();
  renderScannerSummary();
  renderScannerFilters();
  renderScannerResults();
}

async function loadScannerManifest({ bust = false } = {}) {
  if (!marketsBootstrap.scanner_manifest_url) return;
  state.scanner.manifest = await loadJson(marketsBootstrap.scanner_manifest_url, { bust });
  const manifest = state.scanner.manifest;
  const firstUniverse = manifest?.universe_presets?.[0]?.key;
  const firstTimeframe = manifest?.timeframes?.[0]?.key;
  if (firstUniverse && !manifest.universe_presets.some((item) => item.key === state.scanner.universeKey)) {
    state.scanner.universeKey = firstUniverse;
  }
  if (firstTimeframe && !manifest.timeframes.some((item) => item.key === state.scanner.timeframe)) {
    state.scanner.timeframe = firstTimeframe;
  }
}

async function loadScannerSnapshot({ bust = false } = {}) {
  const snapshotPath = resolveScannerSnapshotPath();
  if (!snapshotPath) {
    state.scanner.snapshot = null;
    renderScanner();
    return;
  }
  state.scanner.snapshot = await loadJson(snapshotPath, { bust });
  renderScanner();
}

function bindScannerEvents() {
  if (refs.scannerUniverseSelect) {
    refs.scannerUniverseSelect.addEventListener("change", async (event) => {
      state.scanner.universeKey = event.target.value;
      renderScannerSkeleton();
      await loadScannerSnapshot();
    });
  }
  if (refs.scannerTimeframeSelect) {
    refs.scannerTimeframeSelect.addEventListener("change", async (event) => {
      state.scanner.timeframe = event.target.value;
      renderScannerSkeleton();
      await loadScannerSnapshot();
    });
  }
  if (refs.scannerRefreshButton) {
    refs.scannerRefreshButton.addEventListener("click", async () => {
      if (Date.now() < state.scanner.cooldownUntil) {
        updateScannerCooldownUI();
        return;
      }
      setScannerCooldown();
      updateScannerCooldownUI();
      renderScannerSkeleton();
      try {
        await loadScannerManifest({ bust: true });
        await loadScannerSnapshot({ bust: true });
      } catch (error) {
        if (refs.scannerStatusLine) {
          refs.scannerStatusLine.textContent = error?.message || "스캐너 데이터를 불러오지 못했습니다.";
        }
      }
    });
  }
  window.setInterval(updateScannerCooldownUI, 1000);
}

function renderMarkets() {
  renderMainTabs();
  if (state.surface === "crypto") {
    renderScanner();
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

async function initScannerMarkets() {
  renderScannerSkeleton();
  bindScannerEvents();
  await loadScannerManifest();
  await loadScannerSnapshot();
}

async function initMarkets() {
  renderMarkets();
  try {
    if (state.surface === "crypto") {
      await initScannerMarkets();
    } else {
      await initEquityMarkets();
      renderMarkets();
    }
  } catch (error) {
    if (refs.statusLine) {
      refs.statusLine.textContent = "시장 데이터를 불러오지 못했습니다.";
    }
    if (refs.scannerStatusLine) {
      refs.scannerStatusLine.textContent = error?.message || "스캐너 데이터를 불러오지 못했습니다.";
    }
    if (refs.board) {
      refs.board.innerHTML = `<div class="analysis-empty">${escapeHtml(error?.message || "Unknown error")}</div>`;
    }
  }
}

void initMarkets();
