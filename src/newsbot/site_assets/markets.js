const bootstrapElement = document.getElementById("markets-bootstrap");
const marketsBootstrap = bootstrapElement ? JSON.parse(bootstrapElement.textContent || "{}") : {};

const refs = {
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
  manifest: null,
  manifestUrl: "",
  pagePayload: null,
  pageKey: String(marketsBootstrap.crypto_page_key || "overview"),
  universeKey: "top100",
  timeframe: "5m",
  filter: "all",
  cooldownUntil: Number.parseInt(localStorage.getItem(CRYPTO_COOLDOWN_STORAGE_KEY) || "0", 10) || 0,
  lastLoadedAt: Number.parseInt(localStorage.getItem(CRYPTO_LAST_LOADED_STORAGE_KEY) || "0", 10) || 0,
  isLoading: false,
  errorMessage: "",
  notice: "최근 5분 배치 스냅샷을 준비하고 있습니다.",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePath(value) {
  return String(value || "").replace(/^\.?\/*/, "");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSeoulDateTime(value) {
  const date = parseTimestamp(value);
  if (!date) return "-";
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

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(toNumber(value));
}

function formatUsdCompact(value) {
  const numeric = toNumber(value);
  return numeric ? `$${formatCompact(numeric)}` : "-";
}

function formatTickerPrice(value) {
  const numeric = toNumber(value);
  if (numeric <= 0) return "-";
  if (numeric >= 1000) return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(numeric)}`;
  if (numeric >= 1) return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(numeric)}`;
  return `$${numeric.toFixed(5)}`;
}

function formatPercent(value, digits = 2) {
  const numeric = toNumber(value);
  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
}

function formatRatio(value, digits = 3) {
  const numeric = toNumber(value);
  return numeric ? numeric.toFixed(digits) : "-";
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
  const manifestUrl = state.manifestUrl || String(marketsBootstrap.scanner_manifest_url || "");
  if (manifestUrl) {
    return manifestUrl.replace(/manifest\.json(?:\?.*)?$/, normalizePath(relativePath));
  }
  return resolveSiteUrl(`data/scanner/${normalizePath(relativePath)}`);
}

function currentPageLinks() {
  return Array.isArray(marketsBootstrap.crypto_page_links) ? marketsBootstrap.crypto_page_links : [];
}

function currentPageLabel() {
  return currentPageLinks().find((link) => link.key === state.pageKey)?.label || String(marketsBootstrap.crypto_page_label || "오버뷰");
}

function currentSnapshotMeta() {
  return asArray(state.manifest?.snapshots).find((item) => item.universe_key === state.universeKey && item.timeframe === state.timeframe);
}

function currentDataTimestamp() {
  return state.pagePayload?.generated_at || currentSnapshotMeta()?.generated_at || state.manifest?.generated_at || "";
}

function currentUniverseLimit() {
  return Number(asArray(state.manifest?.universe_presets).find((item) => item.key === state.universeKey)?.limit || currentSnapshotMeta()?.symbols_scanned || 0);
}

function buildFreshnessState(value) {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return { label: "확인 불가", className: "is-neutral", elapsedLabel: "경과 시간 확인 불가" };
  }
  const elapsedMs = Math.max(Date.now() - timestamp.getTime(), 0);
  const elapsedMinutes = elapsedMs / 60_000;
  let label = "최신";
  let className = "is-positive";
  if (elapsedMinutes > 20) {
    label = "심각한 지연";
    className = "is-negative";
  } else if (elapsedMinutes > 10) {
    label = "지연";
    className = "is-neutral";
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let elapsedLabel = "";
  if (hours > 0) {
    elapsedLabel = `${hours}시간 ${minutes}분 경과`;
  } else if (minutes > 0) {
    elapsedLabel = `${minutes}분 ${seconds}초 경과`;
  } else {
    elapsedLabel = `${seconds}초 경과`;
  }
  return { label, className, elapsedLabel };
}

function setCooldown() {
  state.cooldownUntil = Date.now() + CRYPTO_COOLDOWN_MS;
  localStorage.setItem(CRYPTO_COOLDOWN_STORAGE_KEY, String(state.cooldownUntil));
}

function setLoadedAt(timestamp = Date.now()) {
  state.lastLoadedAt = timestamp;
  localStorage.setItem(CRYPTO_LAST_LOADED_STORAGE_KEY, String(timestamp));
}

function updateCooldownUI() {
  if (!refs.refreshButton || !refs.cooldownText) return;
  const remaining = state.cooldownUntil - Date.now();
  if (remaining <= 0) {
    refs.refreshButton.disabled = false;
    refs.cooldownText.textContent = "5분 배치 기준 최신 스냅샷을 곧 다시 불러올 수 있습니다.";
    return;
  }
  refs.refreshButton.disabled = true;
  refs.cooldownText.textContent = `다음 새로고침까지 ${Math.ceil(remaining / 1000)}초`;
}

function renderSkeleton() {
  if (refs.pageHighlights) {
    refs.pageHighlights.innerHTML = Array.from({ length: 4 }, () => '<article class="crypto-stat-card scanner-detail-card"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-chip-row"></div></article>').join("");
  }
  if (refs.pageControls) {
    refs.pageControls.innerHTML = '<article class="crypto-panel crypto-panel-controls"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-grid"></div></article>';
  }
  if (refs.pageContent) {
    refs.pageContent.innerHTML = Array.from({ length: 3 }, () => '<article class="scanner-card is-loading"><div class="scanner-skeleton scanner-skeleton-title"></div><div class="scanner-skeleton scanner-skeleton-chip-row"></div><div class="scanner-skeleton scanner-skeleton-preview"></div></article>').join("");
  }
}

function renderErrorState() {
  const message = state.errorMessage || "코인 데이터를 불러오지 못했습니다.";
  if (refs.pageHighlights) {
    refs.pageHighlights.innerHTML = `
      <div class="crypto-stat-grid">
        <article class="crypto-stat-card scanner-detail-card">
          <span class="crypto-card-label">상태</span>
          <strong class="crypto-card-value">배포 점검 필요</strong>
          <p class="crypto-card-note">${escapeHtml(message)}</p>
        </article>
      </div>
    `;
  }
  if (refs.pageControls) {
    refs.pageControls.innerHTML = `
      <article class="crypto-panel crypto-panel-controls">
        <div class="crypto-panel-head">
          <strong>데이터 상태</strong>
          <span>배포 또는 데이터셋 점검이 필요합니다.</span>
        </div>
        <div class="analysis-empty">${escapeHtml(message)}</div>
      </article>
    `;
  }
  if (refs.pageContent) {
    refs.pageContent.innerHTML = `<div class="analysis-empty">${escapeHtml(message)}</div>`;
  }
}

function populateControls() {
  const manifest = state.manifest;
  if (!manifest || !refs.universeSelect || !refs.timeframeSelect) return;
  refs.universeSelect.innerHTML = asArray(manifest.universe_presets)
    .map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.universeKey ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
  refs.timeframeSelect.innerHTML = asArray(manifest.timeframes)
    .map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.timeframe ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
}

function dataMissingMessage() {
  const baseMessage = "데이터 파일을 찾지 못했습니다. 배포가 덜 끝났거나 스캐너 데이터가 누락되었습니다.";
  return state.pageKey === "patterns"
    ? `패턴 스냅샷이 아직 준비되지 않았습니다. ${baseMessage}`
    : `${currentPageLabel()} 데이터셋이 아직 준비되지 않았습니다. ${baseMessage}`;
}

function resolveDatasetPath() {
  const manifest = state.manifest;
  if (!manifest) return null;
  const pageFiles = manifest.page_data?.[state.pageKey]?.[state.universeKey] || {};
  return pageFiles[state.timeframe] || null;
}

function resolveDatasetUrl() {
  const datasetPath = resolveDatasetPath();
  if (datasetPath) return resolveScannerDataUrl(datasetPath);
  if (state.pageKey === "patterns") {
    const snapshot = currentSnapshotMeta();
    return snapshot ? resolveScannerDataUrl(snapshot.path) : null;
  }
  return null;
}

function manifestCandidates() {
  const candidates = [
    String(marketsBootstrap.scanner_manifest_url || "").trim(),
    resolveSiteUrl("data/scanner/manifest.json"),
  ].filter(Boolean);
  return [...new Set(candidates)];
}

async function loadManifest({ bust = false } = {}) {
  let lastError = null;
  for (const candidate of manifestCandidates()) {
    try {
      state.manifest = await loadJson(candidate, { bust });
      state.manifestUrl = candidate;
      state.errorMessage = "";
      const firstUniverse = state.manifest?.universe_presets?.[0]?.key;
      const firstTimeframe = state.manifest?.timeframes?.[0]?.key;
      if (firstUniverse && !asArray(state.manifest.universe_presets).some((item) => item.key === state.universeKey)) {
        state.universeKey = firstUniverse;
      }
      if (firstTimeframe && !asArray(state.manifest.timeframes).some((item) => item.key === state.timeframe)) {
        state.timeframe = firstTimeframe;
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }
  state.errorMessage = "스캐너 manifest를 불러오지 못했습니다. 배포 경로를 확인해 주세요.";
  throw lastError || new Error(state.errorMessage);
}

async function loadPagePayload({ bust = false } = {}) {
  const previousTimestamp = currentDataTimestamp();
  const datasetUrl = resolveDatasetUrl();
  if (!datasetUrl) {
    state.pagePayload = null;
    state.isLoading = false;
    state.errorMessage = dataMissingMessage();
    state.notice = state.pageKey === "patterns"
      ? "패턴 스냅샷 경로를 찾지 못했습니다."
      : `${currentPageLabel()} 데이터 경로를 찾지 못했습니다.`;
    renderPage();
    return;
  }

  try {
    state.pagePayload = await loadJson(datasetUrl, { bust });
    setLoadedAt();
    state.errorMessage = "";
    const nextTimestamp = currentDataTimestamp();
    if (bust) {
      state.notice = previousTimestamp && previousTimestamp === nextTimestamp
        ? "다시 불러왔지만 최신 스냅샷 시각은 동일합니다."
        : "최신 스냅샷을 다시 불러왔습니다.";
    } else if (!state.notice) {
      state.notice = "최근 5분 배치 스냅샷 기준으로 화면을 표시합니다.";
    }
  } catch (error) {
    state.notice = state.pageKey === "patterns"
      ? "패턴 스냅샷을 불러오는 중 오류가 발생했습니다."
      : `${currentPageLabel()} 데이터를 불러오는 중 오류가 발생했습니다.`;
    if (!state.pagePayload) {
      state.errorMessage = dataMissingMessage();
    }
    throw error;
  } finally {
    state.isLoading = false;
    renderPage();
  }
}

function renderPageTabs() {
  if (!refs.pageTabs) return;
  refs.pageTabs.innerHTML = currentPageLinks()
    .map((link) => `<a class="crypto-page-tab ${link.key === state.pageKey ? "is-active" : ""}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`)
    .join("");
}

function renderSummaryMeta() {
  const snapshot = currentSnapshotMeta();
  const dataTimestamp = currentDataTimestamp();
  const loadedTimestamp = state.lastLoadedAt;
  const freshness = buildFreshnessState(dataTimestamp);
  const universeLabel = asArray(state.manifest?.universe_presets).find((item) => item.key === state.universeKey)?.label || state.universeKey;

  if (refs.summaryMeta) {
    refs.summaryMeta.innerHTML = `
      <span class="scanner-summary-pill">데이터 기준(한국시간) ${escapeHtml(formatSeoulDateTime(dataTimestamp))}</span>
      <span class="scanner-summary-pill">불러온 시각(한국시간) ${escapeHtml(formatSeoulDateTime(loadedTimestamp))}</span>
      <span class="scanner-summary-pill ${freshness.className}">경과 시간 ${escapeHtml(freshness.elapsedLabel)}</span>
      <span class="scanner-summary-pill ${freshness.className}">상태 ${escapeHtml(freshness.label)}</span>
      <span class="scanner-summary-pill">${escapeHtml(universeLabel)}</span>
      <span class="scanner-summary-pill">${escapeHtml(currentPageLabel())}</span>
    `;
  }

  if (refs.activeScan) {
    refs.activeScan.innerHTML = snapshot
      ? `<span class="scanner-active-pill ${freshness.className}">최근 5분 배치 스냅샷 기준 · ${escapeHtml(freshness.label)} · [${escapeHtml(String(snapshot.symbols_scanned || 0))}/${escapeHtml(String(currentUniverseLimit() || snapshot.symbols_scanned || 0))}] ${escapeHtml(snapshot.timeframe_label || state.timeframe)} 데이터 기준 ${escapeHtml(formatSeoulDateTime(snapshot.generated_at))}</span>`
      : '<span class="scanner-active-pill">선택한 조건의 스냅샷을 준비 중입니다.</span>';
  }

  if (refs.statusLine) {
    if (state.errorMessage) {
      refs.statusLine.textContent = state.notice || state.errorMessage;
    } else if (snapshot) {
      refs.statusLine.textContent = `${state.notice} 데이터 기준 ${formatSeoulDateTime(dataTimestamp)}, 이 화면은 ${formatSeoulDateTime(loadedTimestamp)}에 불러왔고 현재 ${freshness.elapsedLabel}입니다.`;
    } else {
      refs.statusLine.textContent = state.notice || "선택한 조건의 스냅샷을 준비하고 있습니다.";
    }
  }

  if (refs.progressBar) {
    const total = Math.max(currentUniverseLimit() || snapshot?.symbols_scanned || 1, 1);
    refs.progressBar.style.width = `${Math.min(((snapshot?.symbols_scanned || 0) / total) * 100, 100)}%`;
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
  const previews = asArray(payload.page_previews)
    .map((card) => `<article class="crypto-preview-card"><div class="crypto-preview-head"><strong>${escapeHtml(card.title)}</strong><span>${escapeHtml(card.symbol)}</span></div><p>${escapeHtml(card.description)}</p><span class="crypto-preview-score">Score ${escapeHtml(String(card.score ?? 0))}</span></article>`)
    .join("");
  return `<div class="crypto-control-grid"><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>상태 요약</strong><span>패턴 상태 집계</span></div>${renderCountCards(statusCards)}</article><article class="crypto-panel crypto-panel-controls"><div class="crypto-panel-head"><strong>페이지 미리보기</strong><span>각 분석 화면의 대표 후보</span></div><div class="crypto-preview-grid">${previews}</div></article></div>`;
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
      <p>${escapeHtml(row.pattern?.summary || "패턴 요약이 없습니다.")}</p>
      <div class="crypto-compact-meta"><span>패턴 ${escapeHtml(String(row.pattern?.score ?? 0))}</span><span>기술 ${escapeHtml(String(row.scores?.technical ?? 0))}</span><span>모멘텀 ${escapeHtml(String(row.scores?.momentum ?? 0))}</span></div>
    </article>
  `).join("");
  return `${renderSection("Overview", "지금 볼 만한 후보", `<div class="crypto-opportunity-grid">${opportunities}</div>`)}${renderSection("Patterns", "상위 패턴 후보", `<div class="crypto-compact-grid">${patterns}</div>`)}`;
}

function renderSignalsPage(payload) {
  const anomaly = payload.anomaly_counts || {};
  refs.pageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge(`Funding Hot ${anomaly.funding_hot || 0}`)}${renderBadge(`OI Heavy ${anomaly.oi_heavy || 0}`)}${renderBadge(`Squeeze ${anomaly.squeeze || 0}`)}${renderBadge(`Divergence ${anomaly.divergence || 0}`)}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Signals",
    "파생 지표와 기술 지표 이상치",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
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
      "시그널 데이터가 아직 없습니다.",
    ),
  );
}

function buildPatternSummaryCards(snapshot) {
  const counts = snapshot?.status_counts || {};
  return [
    { label: "전체 결과", count: snapshot?.result_count || 0, note: "현재 스냅샷 기준" },
    { label: "실시간 진입", count: counts.forming || 0, note: "PRZ 진입 대기" },
    { label: "실시간 터치", count: counts.touch || 0, note: "PRZ 접촉" },
    { label: "T-Bar 완성", count: counts.tbar_complete || 0, note: "반응 캔들 확인" },
    { label: "일반 완성", count: counts.complete || 0, note: "패턴 완료" },
  ];
}

function filteredPatternResults(snapshot) {
  const results = asArray(snapshot?.results);
  return state.filter === "all" ? results : results.filter((item) => item.status === state.filter);
}

function renderPatternFilters(snapshot) {
  const counts = snapshot?.status_counts || {};
  const total = asArray(snapshot?.results).length;
  return `<div class="scanner-filter-tabs">${CRYPTO_PATTERN_FILTERS.map((filter) => `<button type="button" class="scanner-filter-button ${filter.key === state.filter ? "is-active" : ""}" data-pattern-filter="${filter.key}"><span>${escapeHtml(filter.label)}</span><strong>${escapeHtml(String(filter.key === "all" ? total : Number(counts[filter.key] || 0)))}</strong></button>`).join("")}</div>`;
}

function renderPatternCards(snapshot) {
  const results = filteredPatternResults(snapshot);
  if (!results.length) return '<div class="analysis-empty">선택한 패턴 결과가 없습니다.</div>';
  return `<div class="scanner-results-grid">${results.map((result) => {
    const pointCells = ["X", "A", "B", "C", "D"].map((label) => {
      const point = result.points?.[label] || {};
      return `<div class="scanner-point-card"><span>${label}</span><strong>${escapeHtml(String(point.price ?? "-"))}</strong><small>${escapeHtml(String(point.timestamp || "").replace("T", " ").slice(5, 16))}</small></div>`;
    }).join("");
    const ratioCells = Object.entries(result.ratios || {}).map(([label, value]) => `<div class="scanner-ratio-card"><span>${escapeHtml(label.toUpperCase())}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("");
    const flags = asArray(result.indicator_flags).slice(0, 4).map((flag) => `<span class="scanner-flag-pill ${flag.status === "pass" ? "is-pass" : ""}">${escapeHtml(flag.label)} · ${escapeHtml(flag.value)}</span>`).join("");
    return `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(result.symbol)}</h3><p>${escapeHtml(result.summary || "")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${result.side === "bullish" ? "is-bullish" : "is-bearish"}">${escapeHtml(result.side_label)}</span><span class="scanner-badge is-score">점수 ${escapeHtml(String(result.score))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(result.preview_image))}" alt="${escapeHtml(result.symbol)} pattern preview" loading="lazy" /></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>좌표</span><strong>${escapeHtml(result.pattern)}</strong></div><div class="scanner-point-grid">${pointCells}</div></div><div class="scanner-card-section"><div class="scanner-card-section-head"><span>비율</span><strong>${escapeHtml(result.status_label)}</strong></div><div class="scanner-ratio-grid">${ratioCells}</div></div><div class="scanner-prz-box"><div><span>PRZ</span><strong>${escapeHtml(String(result.prz?.lower ?? "-"))} ~ ${escapeHtml(String(result.prz?.upper ?? "-"))}</strong></div><div><span>TP1 / TP2</span><strong>${escapeHtml(String(result.targets?.tp1 ?? "-"))} / ${escapeHtml(String(result.targets?.tp2 ?? "-"))}</strong></div><div><span>SL</span><strong>${escapeHtml(String(result.stop?.value ?? "-"))}</strong></div></div><div class="scanner-card-flags">${flags || '<span class="crypto-inline-muted">표시할 플래그 없음</span>'}</div><div class="scanner-card-footer"><span>${escapeHtml(result.timeframe_label || "-")} · 24h ${escapeHtml(formatPercent(result.change_24h))}</span><a class="scanner-link-button" href="${escapeHtml(resolveMarketUrl(result.detail_page))}">상세 보기</a></div></article>`;
  }).join("")}</div>`;
}

function bindPatternFilterEvents() {
  refs.pageControls.querySelectorAll("[data-pattern-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.patternFilter;
      if (!next || next === state.filter) return;
      state.filter = next;
      renderPage();
    });
  });
}

function renderPatternsPage(snapshot) {
  refs.pageHighlights.innerHTML = renderCountCards(buildPatternSummaryCards(snapshot));
  refs.pageControls.innerHTML = renderPatternFilters(snapshot);
  refs.pageContent.innerHTML = renderPatternCards(snapshot);
  bindPatternFilterEvents();
}

function renderOpportunitiesPage(payload) {
  refs.pageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("패턴 적합도 40")}${renderBadge("PRZ/구조 20")}${renderBadge("파생 지표 15")}${renderBadge("추세 10")}${renderBadge("모멘텀 10")}${renderBadge("변동성 5")}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Opportunities",
    "지금 볼 만한 종목 랭킹",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
        { label: "패턴", render: (row) => renderPatternBadge(row.pattern) },
        { label: "우선순위", render: (row) => escapeHtml(String(row.scores?.opportunity ?? 0)) },
        { label: "기술", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "파생", render: (row) => escapeHtml(String(row.scores?.derivatives ?? 0)) },
        { label: "추세", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "모멘텀", render: (row) => escapeHtml(row.labels?.momentum_bias || "-") },
        { label: "상세", render: (row) => renderSetupLink(row.pattern) },
      ],
      asArray(payload.rows),
      "우선순위 데이터가 아직 없습니다.",
    ),
  );
}

function renderSetupsPage(payload) {
  refs.pageHighlights.innerHTML = renderMetricCards(asArray(payload.summary_cards));
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("상위 세트업만 표시")}${renderBadge("상세 페이지에서 전체 해설 확인")}</div>`;
  refs.pageContent.innerHTML = `<div class="crypto-opportunity-grid">${asArray(payload.rows).map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.pattern?.summary || "세트업 요약이 없습니다.")}</p></div><div class="scanner-card-badges">${renderPatternBadge(row.pattern)}<span class="scanner-badge is-score">우선순위 ${escapeHtml(String(row.scores?.opportunity ?? 0))}</span></div></div><div class="scanner-card-preview-wrap"><img class="scanner-card-preview" src="${escapeHtml(resolveSiteUrl(row.pattern?.preview_image || ""))}" alt="${escapeHtml(row.symbol)} preview" loading="lazy" /></div><div class="crypto-kpi-pair-grid"><div class="scanner-point-card"><span>기술</span><strong>${escapeHtml(String(row.scores?.technical ?? 0))}</strong></div><div class="scanner-point-card"><span>추세</span><strong>${escapeHtml(String(row.scores?.trend ?? 0))}</strong></div><div class="scanner-point-card"><span>모멘텀</span><strong>${escapeHtml(String(row.scores?.momentum ?? 0))}</strong></div><div class="scanner-point-card"><span>파생</span><strong>${escapeHtml(String(row.scores?.derivatives ?? 0))}</strong></div></div><div class="scanner-card-flags">${renderFlags(asArray(row.flags).slice(0, 5))}</div><div class="scanner-card-footer"><span>${escapeHtml(row.labels?.trend_bias || "-")} · ${escapeHtml(row.labels?.momentum_bias || "-")}</span>${renderSetupLink(row.pattern)}</div></article>`).join("")}</div>`;
}

function renderTechnicalRatingsPage(payload) {
  refs.pageHighlights.innerHTML = renderCountCards(asArray(payload.distribution).map((entry) => ({ label: entry.label, count: entry.count, note: "기술 점수 분포" })));
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA 20/50/200")}${renderBadge("Supertrend")}${renderBadge("Ichimoku")}${renderBadge("RSI / MACD / ROC")}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Technical Ratings",
    "TradingView 감성의 종합 기술 점수",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
        { label: "등급", render: (row) => renderBadge(row.labels?.technical_rating || "Neutral", ratingToneClass(row.labels?.technical_rating)) },
        { label: "기술", render: (row) => escapeHtml(String(row.scores?.technical ?? 0)) },
        { label: "이평선", render: (row) => escapeHtml(String(row.scores?.moving_average ?? 0)) },
        { label: "오실레이터", render: (row) => escapeHtml(String(row.scores?.oscillator ?? 0)) },
        { label: "추세", render: (row) => escapeHtml(row.labels?.trend_bias || "-") },
        { label: "패턴", render: (row) => renderPatternBadge(row.pattern) },
      ],
      asArray(payload.rows),
      "테크니컬 레이팅 데이터가 아직 없습니다.",
    ),
  );
}

function renderTrendPage(payload) {
  refs.pageHighlights.innerHTML = renderCountCards([
    { label: "상승 추세", count: payload.counts?.bullish || 0, note: "추세 정렬 종목" },
    { label: "하락 추세", count: payload.counts?.bearish || 0, note: "추세 약세 종목" },
    { label: "혼조", count: payload.counts?.mixed || 0, note: "방향성 혼재" },
  ]);
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("EMA Cross")}${renderBadge("Supertrend")}${renderBadge("ADX / DMI")}${renderBadge("Ichimoku")}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Trend",
    "추세 정렬과 전환 후보",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
        { label: "추세", render: (row) => renderBadge(row.labels?.trend_bias || "-", toneClass(row.scores?.trend_bias)) },
        { label: "점수", render: (row) => escapeHtml(String(row.scores?.trend ?? 0)) },
        { label: "ADX", render: (row) => escapeHtml(String(row.indicators?.adx14 ?? "-")) },
        { label: "+DI / -DI", render: (row) => `${escapeHtml(String(row.indicators?.plus_di ?? "-"))} / ${escapeHtml(String(row.indicators?.minus_di ?? "-"))}` },
        { label: "Supertrend", render: (row) => escapeHtml(row.signals?.supertrend || "-") },
        { label: "Ichimoku", render: (row) => escapeHtml(row.signals?.ichimoku_bias || "-") },
      ],
      asArray(payload.rows),
      "추세 데이터가 아직 없습니다.",
    ),
  );
}

function renderMomentumPage(payload) {
  refs.pageHighlights.innerHTML = renderCountCards([
    { label: "과매수", count: payload.counts?.overbought || 0, note: "상단 과열 후보" },
    { label: "과매도", count: payload.counts?.oversold || 0, note: "하단 과열 후보" },
    { label: "다이버전스", count: payload.counts?.divergence || 0, note: "반전 후보" },
  ]);
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("RSI 14")}${renderBadge("Stoch RSI")}${renderBadge("MACD")}${renderBadge("ROC")}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Momentum",
    "오실레이터 중심 모멘텀 체크",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
        { label: "모멘텀", render: (row) => renderBadge(row.labels?.momentum_bias || "-", toneClass(row.scores?.momentum_bias)) },
        { label: "RSI", render: (row) => escapeHtml(String(row.indicators?.rsi14 ?? "-")) },
        { label: "Stoch RSI", render: (row) => escapeHtml(String(row.indicators?.stoch_rsi ?? "-")) },
        { label: "MACD", render: (row) => `<span class="${toneClass(row.indicators?.macd_histogram)}">${escapeHtml(String(row.indicators?.macd_histogram ?? "-"))}</span>` },
        { label: "ROC", render: (row) => `<span class="${toneClass(row.indicators?.roc12)}">${escapeHtml(formatPercent(row.indicators?.roc12))}</span>` },
        { label: "다이버전스", render: (row) => escapeHtml(row.signals?.divergence_candidate ? "후보" : "-") },
      ],
      asArray(payload.rows),
      "모멘텀 데이터가 아직 없습니다.",
    ),
  );
}

function volatilityToneClass(label) {
  if (label === "상방 돌파") return "is-positive";
  if (label === "하방 돌파") return "is-negative";
  return "is-neutral";
}

function renderVolatilityPage(payload) {
  refs.pageHighlights.innerHTML = renderCountCards([
    { label: "Squeeze", count: payload.counts?.squeeze || 0, note: "압축 상태" },
    { label: "상방 돌파", count: payload.counts?.breakout_up || 0, note: "상승 돌파 후보" },
    { label: "하방 돌파", count: payload.counts?.breakout_down || 0, note: "하락 돌파 후보" },
    { label: "확장", count: payload.counts?.expansion || 0, note: "변동성 확장" },
  ]);
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("Bollinger Bands")}${renderBadge("BBWidth")}${renderBadge("ATR 14")}${renderBadge("Breakout State")}</div>`;
  refs.pageContent.innerHTML = renderSection(
    "Volatility",
    "압축과 돌파 준비 구간",
    renderTable(
      [
        { label: "#", render: (_row, index) => escapeHtml(String(index + 1)) },
        { label: "종목", render: (row) => renderScoreStack(row) },
        { label: "상태", render: (row) => renderBadge(row.labels?.volatility_state || "중립", volatilityToneClass(row.labels?.volatility_state)) },
        { label: "BB Width", render: (row) => escapeHtml(String(row.indicators?.bb_width ?? "-")) },
        { label: "ATR%", render: (row) => escapeHtml(formatPercent(row.indicators?.atr_pct)) },
        { label: "Squeeze", render: (row) => escapeHtml(row.signals?.squeeze ? "예" : "-") },
        { label: "상방", render: (row) => escapeHtml(row.signals?.breakout_up ? "예" : "-") },
        { label: "하방", render: (row) => escapeHtml(row.signals?.breakout_down ? "예" : "-") },
      ],
      asArray(payload.rows),
      "변동성 데이터가 아직 없습니다.",
    ),
  );
}

function renderMultiTimeframePage(payload) {
  const rows = asArray(payload.rows).slice(0, 24);
  const cards = rows.length
    ? `<div class="crypto-mtf-grid">${rows.map((row) => `<article class="scanner-card"><div class="scanner-card-head"><div><h3>${escapeHtml(row.symbol)}</h3><p>${escapeHtml(row.consensus_label || "-")}</p></div><div class="scanner-card-badges"><span class="scanner-badge ${toNumber(row.agreement_score) > 0 ? "is-bullish" : toNumber(row.agreement_score) < 0 ? "is-bearish" : ""}">${escapeHtml(String(row.agreement_score ?? 0))}</span></div></div><div class="crypto-mtf-table">${Object.entries(row.timeframes || {}).map(([timeframe, details]) => `<div class="crypto-mtf-row"><strong>${escapeHtml(timeframe)}</strong><span>${escapeHtml(details.technical_rating || "-")}</span><span>${escapeHtml(details.trend_bias || "-")}</span><span>${escapeHtml(details.momentum_bias || "-")}</span><span>${escapeHtml(String(details.opportunity ?? "-"))}</span></div>`).join("")}</div></article>`).join("")}</div>`
    : '<div class="analysis-empty">멀티 타임프레임 데이터가 없습니다.</div>';
  refs.pageHighlights.innerHTML = renderCountCards([
    { label: "상승 합의", count: payload.counts?.bullish || 0, note: "3개 이상 동일 방향" },
    { label: "하락 합의", count: payload.counts?.bearish || 0, note: "3개 이상 동일 방향" },
    { label: "혼조", count: payload.counts?.mixed || 0, note: "방향 충돌" },
  ]);
  refs.pageControls.innerHTML = `<div class="crypto-chip-row">${renderBadge("5m")}${renderBadge("15m")}${renderBadge("1h")}${renderBadge("4h")}</div>`;
  refs.pageContent.innerHTML = renderSection("Multi-Timeframe", "타임프레임 합의 매트릭스", cards);
}

function renderPage() {
  populateControls();
  renderPageTabs();
  updateCooldownUI();
  renderSummaryMeta();

  if (state.isLoading) {
    renderSkeleton();
    return;
  }

  if (state.errorMessage && !state.pagePayload) {
    renderErrorState();
    return;
  }

  if (!state.pagePayload) {
    renderErrorState();
    return;
  }

  if (state.pageKey === "overview") {
    refs.pageHighlights.innerHTML = renderMetricCards(asArray(state.pagePayload.summary_cards));
    refs.pageControls.innerHTML = renderOverviewControls(state.pagePayload);
    refs.pageContent.innerHTML = renderOverviewContent(state.pagePayload);
    return;
  }
  if (state.pageKey === "signals") return renderSignalsPage(state.pagePayload);
  if (state.pageKey === "patterns") return renderPatternsPage(state.pagePayload);
  if (state.pageKey === "opportunities") return renderOpportunitiesPage(state.pagePayload);
  if (state.pageKey === "setups") return renderSetupsPage(state.pagePayload);
  if (state.pageKey === "technical_ratings") return renderTechnicalRatingsPage(state.pagePayload);
  if (state.pageKey === "trend") return renderTrendPage(state.pagePayload);
  if (state.pageKey === "momentum") return renderMomentumPage(state.pagePayload);
  if (state.pageKey === "volatility") return renderVolatilityPage(state.pagePayload);
  if (state.pageKey === "multi_timeframe") return renderMultiTimeframePage(state.pagePayload);

  refs.pageHighlights.innerHTML = "";
  refs.pageControls.innerHTML = "";
  refs.pageContent.innerHTML = '<div class="analysis-empty">아직 지원되지 않는 페이지입니다.</div>';
}

function bindEvents() {
  if (refs.universeSelect) {
    refs.universeSelect.addEventListener("change", async (event) => {
      state.universeKey = event.target.value;
      state.isLoading = true;
      state.notice = "선택한 조건으로 데이터를 다시 불러오는 중입니다.";
      renderPage();
      await loadPagePayload();
    });
  }
  if (refs.timeframeSelect) {
    refs.timeframeSelect.addEventListener("change", async (event) => {
      state.timeframe = event.target.value;
      state.isLoading = true;
      state.notice = "선택한 조건으로 데이터를 다시 불러오는 중입니다.";
      renderPage();
      await loadPagePayload();
    });
  }
  if (refs.refreshButton) {
    refs.refreshButton.addEventListener("click", async () => {
      if (Date.now() < state.cooldownUntil) {
        updateCooldownUI();
        return;
      }
      setCooldown();
      updateCooldownUI();
      state.isLoading = true;
      state.notice = "최신 스냅샷을 다시 확인하는 중입니다.";
      renderPage();
      try {
        await loadManifest({ bust: true });
        await loadPagePayload({ bust: true });
      } catch (error) {
        state.isLoading = false;
        if (!state.errorMessage) state.errorMessage = error?.message || "코인 데이터를 불러오지 못했습니다.";
        state.notice = state.errorMessage;
        renderPage();
      }
    });
  }
  window.setInterval(() => {
    updateCooldownUI();
    if (!state.isLoading) renderSummaryMeta();
  }, 1000);
}

async function init() {
  state.isLoading = true;
  renderPage();
  bindEvents();
  try {
    await loadManifest();
    await loadPagePayload();
  } catch (error) {
    state.isLoading = false;
    if (!state.errorMessage) state.errorMessage = error?.message || "코인 데이터를 불러오지 못했습니다.";
    state.notice = state.errorMessage;
    renderPage();
  }
}

if (bootstrapElement) {
  void init();
}
