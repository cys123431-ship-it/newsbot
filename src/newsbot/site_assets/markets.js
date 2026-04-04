const bootstrap = JSON.parse(
  document.getElementById("markets-bootstrap").textContent,
);

const refs = {
  tabs: document.getElementById("markets-surface-tabs"),
  statusLine: document.getElementById("markets-status-line"),
  overview: document.getElementById("markets-overview-surface"),
  stocks: document.getElementById("markets-stocks-surface"),
  korea: document.getElementById("markets-korea-surface"),
  crypto: document.getElementById("markets-crypto-surface"),
};

const state = {
  surface: "overview",
  stocksLoaded: false,
  koreaLoaded: false,
  cryptoLoaded: false,
  stocksSearch: "",
  koreaSearch: "",
  cryptoSearch: "",
  stocksPreset: "all",
  koreaPreset: "all",
  cryptoPreset: "all",
  stocksSort: "market_cap",
  koreaSort: "market_cap",
  cryptoSort: "market_cap",
  stocksDirection: "desc",
  koreaDirection: "desc",
  cryptoDirection: "desc",
  stocksExchange: "all",
  koreaExchange: "all",
  stocksSector: "all",
  koreaSector: "all",
  stocksIndustry: "all",
  koreaIndustry: "all",
  stocksValuation: "all",
  stocksDetail: "",
  koreaDetail: "",
  cryptoDetail: "",
};

const payloads = {
  status: null,
  overview: null,
  stocks: null,
  korea: null,
  crypto: null,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function formatCompactNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function formatCurrency(value, currency = "USD") {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  const locale = currency === "KRW" ? "ko-KR" : "en-US";
  if (currency === "KRW") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  }
  if (Math.abs(numeric) >= 1000000) {
    return `$${formatCompactNumber(numeric)}`;
  }
  if (Math.abs(numeric) < 1) {
    let maximumFractionDigits = 4;
    if (Math.abs(numeric) < 0.01) {
      maximumFractionDigits = 6;
    }
    if (Math.abs(numeric) < 0.0001) {
      maximumFractionDigits = 8;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits,
    }).format(numeric);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(numeric) >= 1000 ? 1 : 2,
  }).format(numeric);
}

function formatPercent(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function signedClass(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return "is-positive";
  }
  if (numeric < 0) {
    return "is-negative";
  }
  return "is-flat";
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

async function ensureDataset(surface) {
  if (surface === "stocks" && !payloads.stocks) {
    payloads.stocks = await loadJson(bootstrap.stocks_url);
    state.stocksLoaded = true;
  }
  if (surface === "korea" && !payloads.korea) {
    payloads.korea = await loadJson(bootstrap.korea_url);
    state.koreaLoaded = true;
  }
  if (surface === "crypto" && !payloads.crypto) {
    payloads.crypto = await loadJson(bootstrap.crypto_url);
    state.cryptoLoaded = true;
  }
}

function summarizeText(value, maxLength = 140) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trimEnd()}...` : text;
}

async function setSurface(nextSurface) {
  if (!nextSurface || nextSurface === state.surface) {
    return;
  }
  state.surface = nextSurface;
  renderSurfaceTabs();
  await renderSurface();
}

function renderSurfaceTabs() {
  const surfaces = [
    { key: "overview", label: "Overview" },
    { key: "stocks", label: "Stocks" },
    { key: "korea", label: "Korea" },
    { key: "crypto", label: "Crypto" },
  ];
  refs.tabs.innerHTML = surfaces
    .map(
      (item) => `
        <button
          type="button"
          class="pill${item.key === state.surface ? " is-active" : ""}"
          data-surface="${item.key}"
        >
          ${escapeHtml(item.label)}
        </button>
      `,
    )
    .join("");
  refs.tabs.querySelectorAll("[data-surface]").forEach((button) => {
    button.addEventListener("click", async () => {
      const nextSurface = button.getAttribute("data-surface");
      await setSurface(nextSurface);
    });
  });
}

function renderStatusLine() {
  if (!payloads.status) {
    refs.statusLine.textContent = "Unable to load market status.";
    return;
  }
  const stocks = payloads.status.providers?.stocks;
  const korea = payloads.status.providers?.korea;
  const crypto = payloads.status.providers?.crypto;
  refs.statusLine.textContent =
    `Stocks ${stocks?.status || "-"} (${formatNumber(stocks?.row_count || 0)} rows), ` +
    `Korea ${korea?.status || "-"} (${formatNumber(korea?.row_count || 0)} rows), ` +
    `Crypto ${crypto?.status || "-"} (${formatNumber(crypto?.row_count || 0)} rows), ` +
    `Updated ${formatDateTime(payloads.status.generated_at)}`;
}

function renderOverviewSurface() {
  const overview = payloads.overview;
  if (!overview) {
    refs.overview.innerHTML = '<div class="analysis-empty">Overview data unavailable.</div>';
    return;
  }
  refs.overview.hidden = state.surface !== "overview";
  refs.stocks.hidden = state.surface !== "stocks";
  refs.korea.hidden = state.surface !== "korea";
  refs.crypto.hidden = state.surface !== "crypto";

  const stocks = overview.stocks || {};
  const korea = overview.korea || {};
  const crypto = overview.crypto || {};
  refs.overview.innerHTML = `
    <section class="analysis-table-panel market-overview-shell">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">Overview</p>
          <h2>Cross-market snapshot</h2>
        </div>
      </div>
      <div class="market-overview-columns">
        <section class="market-overview-block">
          <div class="market-overview-block-head">
            <div class="market-overview-copy">
              <p class="analysis-kicker">US Stocks</p>
              <h3>US stocks summary</h3>
              <p>Detailed heatmap and screener live in Stocks.</p>
            </div>
            <button type="button" class="market-jump-button" data-surface-jump="stocks">Stocks</button>
          </div>
          ${stocks.message ? `<p class="market-message">${escapeHtml(summarizeText(stocks.message, 120))}</p>` : ""}
          ${renderBenchmarkCards((stocks.benchmarks || []).slice(0, 4), "No stock benchmarks available.")}
          ${renderOverviewStatGrid([
            { label: "Advancers", value: formatNumber(stocks.breadth?.advancers || 0) },
            { label: "Decliners", value: formatNumber(stocks.breadth?.decliners || 0) },
            { label: "Near 52W High", value: formatNumber(stocks.breadth?.new_highs || 0) },
            { label: "Near 52W Low", value: formatNumber(stocks.breadth?.new_lows || 0) },
          ], "USD")}
        </section>

        <section class="market-overview-block">
          <div class="market-overview-block-head">
            <div class="market-overview-copy">
              <p class="analysis-kicker">Korea</p>
              <h3>Korea stocks summary</h3>
              <p>Detailed heatmap and screener live in Korea.</p>
            </div>
            <button type="button" class="market-jump-button" data-surface-jump="korea">Korea</button>
          </div>
          ${korea.message ? `<p class="market-message">${escapeHtml(summarizeText(korea.message, 120))}</p>` : ""}
          ${renderBenchmarkCards((korea.benchmarks || []).slice(0, 4), "No Korea benchmarks available.", "KRW")}
          ${renderOverviewStatGrid([
            { label: "Advancers", value: formatNumber(korea.breadth?.advancers || 0) },
            { label: "Decliners", value: formatNumber(korea.breadth?.decliners || 0) },
            { label: "Near 52W High", value: formatNumber(korea.breadth?.new_highs || 0) },
            { label: "Near 52W Low", value: formatNumber(korea.breadth?.new_lows || 0) },
          ], "KRW")}
        </section>

        <section class="market-overview-block">
          <div class="market-overview-block-head">
            <div class="market-overview-copy">
              <p class="analysis-kicker">Crypto</p>
              <h3>Crypto summary</h3>
              <p>Detailed heatmap and screener live in Crypto.</p>
            </div>
            <button type="button" class="market-jump-button" data-surface-jump="crypto">Crypto</button>
          </div>
          ${crypto.message ? `<p class="market-message">${escapeHtml(summarizeText(crypto.message, 120))}</p>` : ""}
          ${renderBenchmarkCards((crypto.benchmarks || []).slice(0, 4), "No crypto benchmarks available.")}
          ${renderOverviewStatGrid([
            { label: "Advancers", value: formatNumber(crypto.breadth?.advancers || 0) },
            { label: "Decliners", value: formatNumber(crypto.breadth?.decliners || 0) },
            { label: "Near 24H High", value: formatNumber(crypto.breadth?.new_highs || 0) },
            { label: "Near 24H Low", value: formatNumber(crypto.breadth?.new_lows || 0) },
          ], "USD")}
        </section>
      </div>
    </section>
  `;
  refs.overview.querySelectorAll("[data-surface-jump]").forEach((button) => {
    button.addEventListener("click", async () => {
      await setSurface(button.getAttribute("data-surface-jump"));
    });
  });
}

function renderBenchmarkCards(items, emptyMessage, currency = "USD") {
  if (!items.length) {
    return `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <div class="market-benchmark-grid">
      ${items
        .map(
          (item) => `
            <a class="market-benchmark-card" href="${escapeHtml(item.detail_url || "#")}" target="_blank" rel="noreferrer">
              <span class="market-benchmark-symbol">${escapeHtml(item.symbol || "-")}</span>
              <strong>${escapeHtml(formatCurrency(item.last, currency))}</strong>
              <span class="market-value ${signedClass(item.change_pct)}">${escapeHtml(formatPercent(item.change_pct))}</span>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOverviewStatGrid(items) {
  return `
    <div class="market-overview-stat-grid">
      ${items
        .map(
          (item) => `
            <div class="market-overview-stat">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderBreadth(breadth, assetType) {
  const highLabel = assetType === "crypto" ? "Near 24H High" : "Near 52W High";
  const lowLabel = assetType === "crypto" ? "Near 24H Low" : "Near 52W Low";
  const items = [
    ["Advancers", breadth.advancers || 0],
    ["Decliners", breadth.decliners || 0],
    ["Flat", breadth.unchanged || 0],
    [highLabel, breadth.new_highs || 0],
    [lowLabel, breadth.new_lows || 0],
  ];
  return `
    <div class="market-breadth-row">
      ${items
        .map(
          ([label, value]) => `
            <div class="market-breadth-pill">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(formatNumber(value))}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderMiniList(title, items, emptyMessage, currency = "USD") {
  return `
    <section class="market-mini-panel">
      <h3>${escapeHtml(title)}</h3>
      ${
        items.length
          ? `<div class="market-mini-list">
              ${items
                .map(
                  (item) => `
                    <a class="market-mini-row" href="${escapeHtml(item.detail_url || "#")}" target="_blank" rel="noreferrer">
                      <div>
                        <strong>${escapeHtml(item.symbol || "-")}</strong>
                        <span>${escapeHtml(item.name || "-")}</span>
                      </div>
                      <div class="market-mini-values">
                        <span>${escapeHtml(formatCurrency(item.last, currency))}</span>
                        <span class="${signedClass(item.change_pct)}">${escapeHtml(formatPercent(item.change_pct))}</span>
                      </div>
                    </a>
                  `,
                )
                .join("")}
            </div>`
          : `<div class="analysis-empty compact-empty">${escapeHtml(emptyMessage)}</div>`
      }
    </section>
  `;
}

function renderGroupBars(title, items, emptyMessage) {
  if (!items.length) {
    return `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  const maxValue = Math.max(...items.map((item) => Math.abs(Number(item.change_pct || 0))), 1);
  return `
    <section class="market-section-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="analysis-rank-list">
        ${items
          .map(
            (item) => `
              <div class="analysis-rank-row">
                <div class="analysis-rank-copy">
                  <strong>${escapeHtml(item.label || "-")}</strong>
                  <span class="${signedClass(item.change_pct)}">${escapeHtml(formatPercent(item.change_pct))}</span>
                </div>
                <div class="analysis-rank-track">
                  <div
                    class="analysis-rank-fill ${signedClass(item.change_pct)}"
                    style="width:${Math.max(12, Math.round((Math.abs(Number(item.change_pct || 0)) / maxValue) * 100))}%"
                  ></div>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderHeatmap(title, items, emptyMessage) {
  if (!items.length) {
    return `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <section class="market-section-block">
      <h3>${escapeHtml(title)}</h3>
      <div class="market-heatmap-grid">
        ${items
          .map(
            (item) => `
              <a
                class="market-heatmap-cell ${signedClass(item.change_pct)} size-${escapeHtml(item.size || 1)}"
                href="${escapeHtml(item.detail_url || "#")}"
                target="_blank"
                rel="noreferrer"
              >
                <strong>${escapeHtml(item.label || "-")}</strong>
                <span>${escapeHtml(item.subLabel || "-")}</span>
                <b>${escapeHtml(formatPercent(item.change_pct))}</b>
              </a>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderTrending(items) {
  if (!items.length) {
    return "";
  }
  return `
    <section class="market-section-block">
      <h3>Trending</h3>
      <div class="market-trending-grid">
        ${items
          .map(
            (item) => `
              <a class="market-trending-card" href="${escapeHtml(item.detail_url || "#")}" target="_blank" rel="noreferrer">
                <strong>${escapeHtml(item.symbol || "-")}</strong>
                <span>${escapeHtml(item.name || "-")}</span>
                <small>Rank ${escapeHtml(item.market_cap_rank ?? "-")}</small>
              </a>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function getDataset(surface) {
  return payloads[surface] || null;
}

function isStockSurface(surface) {
  return surface === "stocks" || surface === "korea";
}

function getCurrencyForSurface(surface) {
  return surface === "korea" ? "KRW" : "USD";
}

function getSurfaceStateKeys(surface) {
  if (surface === "stocks") {
    return {
      search: "stocksSearch",
      preset: "stocksPreset",
      sort: "stocksSort",
      direction: "stocksDirection",
      exchange: "stocksExchange",
      sector: "stocksSector",
      industry: "stocksIndustry",
      detail: "stocksDetail",
      valuation: "stocksValuation",
    };
  }
  if (surface === "korea") {
    return {
      search: "koreaSearch",
      preset: "koreaPreset",
      sort: "koreaSort",
      direction: "koreaDirection",
      exchange: "koreaExchange",
      sector: "koreaSector",
      industry: "koreaIndustry",
      detail: "koreaDetail",
      valuation: null,
    };
  }
  return {
    search: "cryptoSearch",
    preset: "cryptoPreset",
    sort: "cryptoSort",
    direction: "cryptoDirection",
    exchange: null,
    sector: null,
    industry: null,
    detail: "cryptoDetail",
    valuation: null,
  };
}

function getOverviewSnapshot(surface) {
  return payloads.overview?.[surface] || {};
}

function getFilteredRows(surface) {
  const dataset = getDataset(surface);
  if (!dataset) {
    return [];
  }
  const stateKeys = getSurfaceStateKeys(surface);
  const search = stateKeys.search ? state[stateKeys.search] : "";
  const preset = stateKeys.preset ? state[stateKeys.preset] : "all";
  let rows = [...(dataset.rows || [])];

  if (search) {
    const keyword = search.trim().toLowerCase();
    rows = rows.filter((row) =>
      [row.symbol, row.name, row.sector_or_category, row.industry]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }

  if (isStockSurface(surface)) {
    if (stateKeys.exchange && state[stateKeys.exchange] !== "all") {
      rows = rows.filter((row) => row.exchange === state[stateKeys.exchange]);
    }
    if (stateKeys.sector && state[stateKeys.sector] !== "all") {
      rows = rows.filter((row) => row.sector_or_category === state[stateKeys.sector]);
    }
    if (stateKeys.industry && state[stateKeys.industry] !== "all") {
      rows = rows.filter((row) => row.industry === state[stateKeys.industry]);
    }
    if (surface === "stocks" && state.stocksValuation === "value") {
      rows = rows.filter((row) => row.pe !== null && row.pe <= 15);
    }
    if (surface === "stocks" && state.stocksValuation === "blend") {
      rows = rows.filter((row) => row.pe !== null && row.pe > 15 && row.pe <= 30);
    }
    if (surface === "stocks" && state.stocksValuation === "growth") {
      rows = rows.filter((row) => row.pe !== null && row.pe > 30);
    }
    if (surface === "stocks" && state.stocksValuation === "income") {
      rows = rows.filter((row) => (row.dividend_yield || 0) >= 2);
    }
  }

  if (preset === "mega") {
    rows = rows.filter((row) => Number(row.market_cap || 0) >= 200_000_000_000);
  }
  if (preset === "gainers") {
    rows = rows.filter((row) => Number(row.change_pct || 0) > 0);
  }
  if (preset === "losers") {
    rows = rows.filter((row) => Number(row.change_pct || 0) < 0);
  }
  if (preset === "active") {
    rows = rows.filter((row) => Number(row.volume || 0) > 0);
  }
  if (preset === "kospi") {
    rows = rows.filter((row) => row.exchange === "KOSPI");
  }
  if (preset === "kosdaq") {
    rows = rows.filter((row) => row.exchange === "KOSDAQ");
  }
  if (preset === "value") {
    rows = rows.filter((row) => row.pe !== null && row.pe <= 15);
  }
  if (preset === "income") {
    rows = rows.filter((row) => (row.dividend_yield || 0) >= 2);
  }
  if (preset === "majors") {
    rows = rows.filter((row) => ["BTC", "ETH", "SOL", "XRP"].includes(row.symbol));
  }

  const sortKey = stateKeys.sort ? state[stateKeys.sort] : "market_cap";
  const direction = stateKeys.direction ? state[stateKeys.direction] : "desc";
  rows.sort((left, right) => {
    const leftValue = left?.[sortKey] ?? 0;
    const rightValue = right?.[sortKey] ?? 0;
    if (typeof leftValue === "string" || typeof rightValue === "string") {
      const result = String(leftValue).localeCompare(String(rightValue));
      return direction === "asc" ? result : -result;
    }
    const result = Number(leftValue || 0) - Number(rightValue || 0);
    return direction === "asc" ? result : -result;
  });

  return rows;
}

function getDetailPanelState(surface) {
  const stateKeys = getSurfaceStateKeys(surface);
  return stateKeys.detail ? state[stateKeys.detail] : "";
}

function setDetailPanelState(surface, nextPanel) {
  const stateKeys = getSurfaceStateKeys(surface);
  const key = stateKeys.detail;
  state[key] = state[key] === nextPanel ? "" : nextPanel;
}

function renderBenchmarkTickerRow(items, emptyMessage, currency = "USD") {
  if (!items.length) {
    return `<div class="analysis-empty compact-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  return `
    <div class="market-benchmark-row">
      ${items
        .slice(0, 5)
        .map(
          (item) => `
            <a class="market-benchmark-pill" href="${escapeHtml(item.detail_url || "#")}" target="_blank" rel="noreferrer">
              <strong>${escapeHtml(item.symbol || "-")}</strong>
              <span>${escapeHtml(formatCurrency(item.last, currency))}</span>
              <b class="${signedClass(item.change_pct)}">${escapeHtml(formatPercent(item.change_pct))}</b>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderDetailTabs(surface) {
  const activePanel = getDetailPanelState(surface);
  const items = [
    { key: "heatmap", label: "1 Heatmap" },
    { key: "movers", label: "2 Movers" },
    { key: "screener", label: "3 Screener" },
  ];
  return `
    <section class="analysis-table-panel market-detail-switcher">
      <div class="market-detail-tabs">
        ${items
          .map(
            (item) => `
              <button
                type="button"
                class="pill${activePanel === item.key ? " is-active" : ""}"
                data-detail-panel="${escapeHtml(item.key)}"
              >
                ${escapeHtml(item.label)}
              </button>
            `,
          )
          .join("")}
      </div>
      <p class="market-detail-hint">필요한 패널만 눌러서 열 수 있습니다.</p>
    </section>
  `;
}

function renderSummaryStrip(surface, snapshot, dataset) {
  const currency = getCurrencyForSurface(surface);
  const labels = {
    stocks: { kicker: "US Stocks", benchmark: "No stock benchmarks available." },
    korea: { kicker: "Korea", benchmark: "No Korea benchmarks available." },
    crypto: { kicker: "Crypto", benchmark: "No crypto benchmarks available." },
  };
  const labelSet = labels[surface] || labels.crypto;

  return `
    <section class="analysis-panel market-strip-panel">
      <div class="market-strip-head">
        <div>
          <p class="analysis-kicker">${labelSet.kicker}</p>
          <h2>Benchmarks and breadth</h2>
        </div>
        <span class="market-chip ${escapeHtml(dataset.status || "warning")}">${escapeHtml(dataset.status || "-")}</span>
      </div>
      ${dataset.message ? `<p class="market-message market-strip-message">${escapeHtml(dataset.message)}</p>` : ""}
      <div class="market-strip-layout">
        ${renderBenchmarkTickerRow(snapshot.benchmarks || [], labelSet.benchmark, currency)}
        ${renderBreadth(snapshot.breadth || {}, surface === "crypto" ? "crypto" : "stock")}
      </div>
    </section>
  `;
}

function renderSelectedDetailPanel(surface, snapshot, dataset, rows) {
  const isStockLike = isStockSurface(surface);
  const currency = getCurrencyForSurface(surface);
  const activePanel = getDetailPanelState(surface);
  const surfaceLabels = {
    stocks: {
      kicker: "US Stocks",
      groupTitle: "Sector performance",
      heatmapTitle: "Stock heatmap",
      heatmapEmpty: "No stock heatmap data available.",
      groupEmpty: "No stock sector data available.",
      gainersEmpty: "No gainers available.",
      losersEmpty: "No losers available.",
      activeEmpty: "No stock activity data available.",
      moversTitle: "US Stocks movers",
      screenerTitle: "Screener",
      searchPlaceholder: "Search ticker, company, sector",
    },
    korea: {
      kicker: "Korea",
      groupTitle: "Sector performance",
      heatmapTitle: "Korea heatmap",
      heatmapEmpty: "No Korea heatmap data available.",
      groupEmpty: "No Korea sector data available.",
      gainersEmpty: "No Korea gainers available.",
      losersEmpty: "No Korea losers available.",
      activeEmpty: "No Korea activity data available.",
      moversTitle: "Korea movers",
      screenerTitle: "Korea Screener",
      searchPlaceholder: "Search ticker, company, sector",
    },
    crypto: {
      kicker: "Crypto",
      groupTitle: "Category performance",
      heatmapTitle: "Crypto heatmap",
      heatmapEmpty: "No crypto heatmap data available.",
      groupEmpty: "No crypto category data available.",
      gainersEmpty: "No crypto gainers available.",
      losersEmpty: "No crypto losers available.",
      activeEmpty: "No crypto activity data available.",
      moversTitle: "Crypto movers",
      screenerTitle: "Coin Screener",
      searchPlaceholder: "Search symbol or coin",
    },
  };
  const labels = surfaceLabels[surface] || surfaceLabels.crypto;

  if (!activePanel) {
    return "";
  }

  if (activePanel === "heatmap") {
    return `
      <section class="analysis-panel market-detail-heatmap">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">${labels.kicker}</p>
            <h2>${labels.heatmapTitle}</h2>
          </div>
        </div>
        ${renderGroupBars(labels.groupTitle, snapshot.group_performance || [], labels.groupEmpty)}
        ${surface === "crypto" ? renderTrending(snapshot.trending || []) : ""}
        ${renderHeatmap(labels.heatmapTitle, snapshot.heatmap || [], labels.heatmapEmpty)}
      </section>
    `;
  }

  if (activePanel === "movers") {
    return `
      <section class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">${labels.kicker}</p>
            <h2>${labels.moversTitle}</h2>
          </div>
        </div>
        <div class="markets-three-up">
          ${renderMiniList("Top gainers", (snapshot.top_gainers || []).slice(0, 6), labels.gainersEmpty, currency)}
          ${renderMiniList("Top losers", (snapshot.top_losers || []).slice(0, 6), labels.losersEmpty, currency)}
          ${renderMiniList("Most active", (snapshot.most_active || []).slice(0, 6), labels.activeEmpty, currency)}
        </div>
      </section>
    `;
  }

  return `
    <section class="analysis-table-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">${labels.kicker}</p>
          <h2>${labels.screenerTitle}</h2>
        </div>
      </div>
      <div class="market-controls">
        <input
          id="${surface}-search"
          class="market-search"
          type="search"
          value="${escapeHtml(state[getSurfaceStateKeys(surface).search] || "")}"
          placeholder="${labels.searchPlaceholder}"
        />
        <select id="${surface}-preset">
          ${(dataset.presets || [])
            .map(
              (item) => `
                <option value="${escapeHtml(item.key)}" ${state[getSurfaceStateKeys(surface).preset] === item.key ? "selected" : ""}>
                  ${escapeHtml(item.label)}
                </option>
              `,
            )
            .join("")}
        </select>
        ${
          isStockLike
            ? `
              <select id="${surface}-exchange">
                <option value="all">All Exchanges</option>
                ${(dataset.filter_options?.exchanges || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state[getSurfaceStateKeys(surface).exchange] === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
              <select id="${surface}-sector">
                <option value="all">All Sectors</option>
                ${(dataset.filter_options?.sectors || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state[getSurfaceStateKeys(surface).sector] === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
              <select id="${surface}-industry">
                <option value="all">All Industries</option>
                ${(dataset.filter_options?.industries || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state[getSurfaceStateKeys(surface).industry] === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
              ${
                surface === "stocks"
                  ? `
                    <select id="stocks-valuation">
                      <option value="all" ${state.stocksValuation === "all" ? "selected" : ""}>All Valuation</option>
                      <option value="value" ${state.stocksValuation === "value" ? "selected" : ""}>PE <= 15</option>
                      <option value="blend" ${state.stocksValuation === "blend" ? "selected" : ""}>PE 15-30</option>
                      <option value="growth" ${state.stocksValuation === "growth" ? "selected" : ""}>PE > 30</option>
                      <option value="income" ${state.stocksValuation === "income" ? "selected" : ""}>Yield >= 2%</option>
                    </select>
                  `
                  : ""
              }
            `
            : ""
        }
        <select id="${surface}-sort">
          <option value="market_cap" ${state[getSurfaceStateKeys(surface).sort] === "market_cap" ? "selected" : ""}>Sort: Market Cap</option>
          <option value="change_pct" ${state[getSurfaceStateKeys(surface).sort] === "change_pct" ? "selected" : ""}>Sort: Change</option>
          <option value="volume" ${state[getSurfaceStateKeys(surface).sort] === "volume" ? "selected" : ""}>Sort: Volume</option>
          ${isStockLike ? `<option value="pe" ${state[getSurfaceStateKeys(surface).sort] === "pe" ? "selected" : ""}>Sort: PE</option>` : ""}
        </select>
        <button id="${surface}-sort-direction" type="button" class="pill">
          ${state[getSurfaceStateKeys(surface).direction] === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>
      <div class="market-table-shell">
        ${rows.length ? renderTable(rows, surface) : '<div class="analysis-empty">No rows match the current filters.</div>'}
      </div>
    </section>
  `;
}

function renderDatasetSurface(surface) {
  const dataset = getDataset(surface);
  const target = refs[surface];
  if (!dataset) {
    target.innerHTML = '<div class="analysis-empty">Dataset not loaded.</div>';
    return;
  }

  const rows = getFilteredRows(surface);
  const isStockLike = isStockSurface(surface);
  const stateKeys = getSurfaceStateKeys(surface);
  const snapshot = getOverviewSnapshot(surface);
  const controls = `
    ${renderSummaryStrip(surface, snapshot, dataset)}
    ${renderDetailTabs(surface)}
    ${renderSelectedDetailPanel(surface, snapshot, dataset, rows)}
  `;
  target.innerHTML = controls;

  target.querySelectorAll("[data-detail-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      setDetailPanelState(surface, button.getAttribute("data-detail-panel") || "");
      renderDatasetSurface(surface);
    });
  });

  target.querySelector(`#${surface}-search`)?.addEventListener("input", (event) => {
    state[stateKeys.search] = event.target.value;
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-preset`)?.addEventListener("change", (event) => {
    state[stateKeys.preset] = event.target.value;
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-sort`)?.addEventListener("change", (event) => {
    state[stateKeys.sort] = event.target.value;
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-sort-direction`)?.addEventListener("click", () => {
    state[stateKeys.direction] = state[stateKeys.direction] === "asc" ? "desc" : "asc";
    renderDatasetSurface(surface);
  });
  if (isStockLike) {
    target.querySelector(`#${surface}-exchange`)?.addEventListener("change", (event) => {
      state[stateKeys.exchange] = event.target.value;
      renderDatasetSurface(surface);
    });
    target.querySelector(`#${surface}-sector`)?.addEventListener("change", (event) => {
      state[stateKeys.sector] = event.target.value;
      renderDatasetSurface(surface);
    });
    target.querySelector(`#${surface}-industry`)?.addEventListener("change", (event) => {
      state[stateKeys.industry] = event.target.value;
      renderDatasetSurface(surface);
    });
  }
  if (surface === "stocks") {
    target.querySelector("#stocks-valuation")?.addEventListener("change", (event) => {
      state.stocksValuation = event.target.value;
      renderDatasetSurface(surface);
    });
  }
}

function renderTable(rows, surface) {
  const isStockLike = isStockSurface(surface);
  const currency = getCurrencyForSurface(surface);
  return `
    <table class="market-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Name</th>
          <th>${isStockLike ? "Sector" : "Type"}</th>
          <th>Price</th>
          <th>Change</th>
          <th>Market Cap</th>
          <th>Volume</th>
          ${isStockLike ? "<th>PE</th><th>Yield</th>" : ""}
        </tr>
      </thead>
      <tbody>
        ${rows
          .slice(0, 80)
          .map(
            (row) => `
              <tr>
                <td><a href="${escapeHtml(row.detail_url || "#")}" target="_blank" rel="noreferrer">${escapeHtml(row.symbol || "-")}</a></td>
                <td>${escapeHtml(row.name || "-")}</td>
                <td>${escapeHtml(row.sector_or_category || row.industry || "-")}</td>
                <td>${escapeHtml(formatCurrency(row.last, currency))}</td>
                <td class="${signedClass(row.change_pct)}">${escapeHtml(formatPercent(row.change_pct))}</td>
                <td>${escapeHtml(formatCompactNumber(row.market_cap))}</td>
                <td>${escapeHtml(formatCompactNumber(row.volume))}</td>
                ${isStockLike ? `<td>${escapeHtml(row.pe === null || row.pe === undefined ? "-" : Number(row.pe).toFixed(2))}</td><td>${escapeHtml(row.dividend_yield === null || row.dividend_yield === undefined ? "-" : formatPercent(row.dividend_yield))}</td>` : ""}
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function renderSurface() {
  refs.overview.hidden = state.surface !== "overview";
  refs.stocks.hidden = state.surface !== "stocks";
  refs.korea.hidden = state.surface !== "korea";
  refs.crypto.hidden = state.surface !== "crypto";
  if (state.surface === "overview") {
    renderOverviewSurface();
    return;
  }
  try {
    await ensureDataset(state.surface);
    renderDatasetSurface(state.surface);
  } catch (error) {
    const target = refs[state.surface];
    target.innerHTML = `<div class="analysis-empty">${escapeHtml(String(error))}</div>`;
  }
}

async function init() {
  try {
    const [statusPayload, overviewPayload] = await Promise.all([
      loadJson(bootstrap.status_url),
      loadJson(bootstrap.overview_url),
    ]);
    payloads.status = statusPayload;
    payloads.overview = overviewPayload;
    renderSurfaceTabs();
    renderStatusLine();
    await renderSurface();
  } catch (error) {
    refs.statusLine.textContent = String(error);
    refs.overview.innerHTML = `<div class="analysis-empty">${escapeHtml(String(error))}</div>`;
  }
}

init();
