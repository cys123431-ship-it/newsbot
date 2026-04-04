const bootstrap = JSON.parse(
  document.getElementById("markets-bootstrap").textContent,
);

const refs = {
  tabs: document.getElementById("markets-surface-tabs"),
  statusLine: document.getElementById("markets-status-line"),
  overview: document.getElementById("markets-overview-surface"),
  stocks: document.getElementById("markets-stocks-surface"),
  crypto: document.getElementById("markets-crypto-surface"),
};

const state = {
  surface: "overview",
  stocksLoaded: false,
  cryptoLoaded: false,
  stocksSearch: "",
  cryptoSearch: "",
  stocksPreset: "all",
  cryptoPreset: "all",
  stocksSort: "market_cap",
  cryptoSort: "market_cap",
  stocksDirection: "desc",
  cryptoDirection: "desc",
  stocksExchange: "all",
  stocksSector: "all",
  stocksIndustry: "all",
  stocksValuation: "all",
  stocksDetail: "",
  cryptoDetail: "",
};

const payloads = {
  status: null,
  overview: null,
  stocks: null,
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

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
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
  const crypto = payloads.status.providers?.crypto;
  refs.statusLine.textContent =
    `Stocks ${stocks?.status || "-"} (${formatNumber(stocks?.row_count || 0)} rows), ` +
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
  refs.crypto.hidden = state.surface !== "crypto";

  const stocks = overview.stocks || {};
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
          ])}
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
          ])}
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

function renderBenchmarkCards(items, emptyMessage) {
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
              <strong>${escapeHtml(formatCurrency(item.last))}</strong>
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

function renderMiniList(title, items, emptyMessage) {
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
                        <span>${escapeHtml(formatCurrency(item.last))}</span>
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
  return surface === "stocks" ? payloads.stocks : payloads.crypto;
}

function getFilteredRows(surface) {
  const dataset = getDataset(surface);
  if (!dataset) {
    return [];
  }
  const search = surface === "stocks" ? state.stocksSearch : state.cryptoSearch;
  const preset = surface === "stocks" ? state.stocksPreset : state.cryptoPreset;
  let rows = [...(dataset.rows || [])];

  if (search) {
    const keyword = search.trim().toLowerCase();
    rows = rows.filter((row) =>
      [row.symbol, row.name, row.sector_or_category, row.industry]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }

  if (surface === "stocks") {
    if (state.stocksExchange !== "all") {
      rows = rows.filter((row) => row.exchange === state.stocksExchange);
    }
    if (state.stocksSector !== "all") {
      rows = rows.filter((row) => row.sector_or_category === state.stocksSector);
    }
    if (state.stocksIndustry !== "all") {
      rows = rows.filter((row) => row.industry === state.stocksIndustry);
    }
    if (state.stocksValuation === "value") {
      rows = rows.filter((row) => row.pe !== null && row.pe <= 15);
    }
    if (state.stocksValuation === "blend") {
      rows = rows.filter((row) => row.pe !== null && row.pe > 15 && row.pe <= 30);
    }
    if (state.stocksValuation === "growth") {
      rows = rows.filter((row) => row.pe !== null && row.pe > 30);
    }
    if (state.stocksValuation === "income") {
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
  if (preset === "value") {
    rows = rows.filter((row) => row.pe !== null && row.pe <= 15);
  }
  if (preset === "income") {
    rows = rows.filter((row) => (row.dividend_yield || 0) >= 2);
  }
  if (preset === "majors") {
    rows = rows.filter((row) => ["BTC", "ETH", "SOL", "XRP"].includes(row.symbol));
  }

  const sortKey = surface === "stocks" ? state.stocksSort : state.cryptoSort;
  const direction = surface === "stocks" ? state.stocksDirection : state.cryptoDirection;
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
  return surface === "stocks" ? state.stocksDetail : state.cryptoDetail;
}

function setDetailPanelState(surface, nextPanel) {
  const key = surface === "stocks" ? "stocksDetail" : "cryptoDetail";
  state[key] = state[key] === nextPanel ? "" : nextPanel;
}

function renderBenchmarkTickerRow(items, emptyMessage) {
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
              <span>${escapeHtml(formatCurrency(item.last))}</span>
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
  const isStocks = surface === "stocks";
  const benchmarkEmpty = isStocks ? "No stock benchmarks available." : "No crypto benchmarks available.";

  return `
    <section class="analysis-panel market-strip-panel">
      <div class="market-strip-head">
        <div>
          <p class="analysis-kicker">${isStocks ? "US Stocks" : "Crypto"}</p>
          <h2>${isStocks ? "Benchmarks and breadth" : "Benchmarks and breadth"}</h2>
        </div>
        <span class="market-chip ${escapeHtml(dataset.status || "warning")}">${escapeHtml(dataset.status || "-")}</span>
      </div>
      ${dataset.message ? `<p class="market-message market-strip-message">${escapeHtml(dataset.message)}</p>` : ""}
      <div class="market-strip-layout">
        ${renderBenchmarkTickerRow(snapshot.benchmarks || [], benchmarkEmpty)}
        ${renderBreadth(snapshot.breadth || {}, isStocks ? "stock" : "crypto")}
      </div>
    </section>
  `;
}

function renderSelectedDetailPanel(surface, snapshot, dataset, rows) {
  const isStocks = surface === "stocks";
  const activePanel = getDetailPanelState(surface);
  const groupTitle = isStocks ? "Sector performance" : "Category performance";
  const heatmapTitle = isStocks ? "Stock heatmap" : "Crypto heatmap";
  const heatmapEmpty = isStocks ? "No stock heatmap data available." : "No crypto heatmap data available.";
  const groupEmpty = isStocks ? "No stock sector data available." : "No crypto category data available.";
  const gainersEmpty = isStocks ? "No gainers available." : "No crypto gainers available.";
  const losersEmpty = isStocks ? "No losers available." : "No crypto losers available.";
  const activeEmpty = isStocks ? "No stock activity data available." : "No crypto activity data available.";

  if (!activePanel) {
    return "";
  }

  if (activePanel === "heatmap") {
    return `
      <section class="analysis-panel market-detail-heatmap">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">${isStocks ? "US Stocks" : "Crypto"}</p>
            <h2>${heatmapTitle}</h2>
          </div>
        </div>
        ${renderGroupBars(groupTitle, snapshot.group_performance || [], groupEmpty)}
        ${!isStocks ? renderTrending(snapshot.trending || []) : ""}
        ${renderHeatmap(heatmapTitle, snapshot.heatmap || [], heatmapEmpty)}
      </section>
    `;
  }

  if (activePanel === "movers") {
    return `
      <section class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">${isStocks ? "US Stocks" : "Crypto"}</p>
            <h2>${isStocks ? "US Stocks movers" : "Crypto movers"}</h2>
          </div>
        </div>
        <div class="markets-three-up">
          ${renderMiniList("Top gainers", (snapshot.top_gainers || []).slice(0, 6), gainersEmpty)}
          ${renderMiniList("Top losers", (snapshot.top_losers || []).slice(0, 6), losersEmpty)}
          ${renderMiniList("Most active", (snapshot.most_active || []).slice(0, 6), activeEmpty)}
        </div>
      </section>
    `;
  }

  return `
    <section class="analysis-table-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">${isStocks ? "US Stocks" : "Crypto"}</p>
          <h2>${isStocks ? "Screener" : "Coin Screener"}</h2>
        </div>
      </div>
      <div class="market-controls">
        <input
          id="${surface}-search"
          class="market-search"
          type="search"
          value="${escapeHtml(isStocks ? state.stocksSearch : state.cryptoSearch)}"
          placeholder="${isStocks ? "Search ticker, company, sector" : "Search symbol or coin"}"
        />
        <select id="${surface}-preset">
          ${(dataset.presets || [])
            .map(
              (item) => `
                <option value="${escapeHtml(item.key)}" ${(isStocks ? state.stocksPreset : state.cryptoPreset) === item.key ? "selected" : ""}>
                  ${escapeHtml(item.label)}
                </option>
              `,
            )
            .join("")}
        </select>
        ${
          isStocks
            ? `
              <select id="stocks-exchange">
                <option value="all">All Exchanges</option>
                ${(dataset.filter_options?.exchanges || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state.stocksExchange === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
              <select id="stocks-sector">
                <option value="all">All Sectors</option>
                ${(dataset.filter_options?.sectors || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state.stocksSector === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
              <select id="stocks-industry">
                <option value="all">All Industries</option>
                ${(dataset.filter_options?.industries || [])
                  .map(
                    (item) => `
                      <option value="${escapeHtml(item)}" ${state.stocksIndustry === item ? "selected" : ""}>${escapeHtml(item)}</option>
                    `,
                  )
                  .join("")}
              </select>
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
        <select id="${surface}-sort">
          <option value="market_cap" ${(isStocks ? state.stocksSort : state.cryptoSort) === "market_cap" ? "selected" : ""}>Sort: Market Cap</option>
          <option value="change_pct" ${(isStocks ? state.stocksSort : state.cryptoSort) === "change_pct" ? "selected" : ""}>Sort: Change</option>
          <option value="volume" ${(isStocks ? state.stocksSort : state.cryptoSort) === "volume" ? "selected" : ""}>Sort: Volume</option>
          ${isStocks ? `<option value="pe" ${state.stocksSort === "pe" ? "selected" : ""}>Sort: PE</option>` : ""}
        </select>
        <button id="${surface}-sort-direction" type="button" class="pill">
          ${(isStocks ? state.stocksDirection : state.cryptoDirection) === "asc" ? "Ascending" : "Descending"}
        </button>
      </div>
      <div class="market-table-shell">
        ${rows.length ? renderTable(rows, isStocks) : '<div class="analysis-empty">No rows match the current filters.</div>'}
      </div>
    </section>
  `;
}

function renderDatasetSurface(surface) {
  const dataset = getDataset(surface);
  const target = surface === "stocks" ? refs.stocks : refs.crypto;
  if (!dataset) {
    target.innerHTML = '<div class="analysis-empty">Dataset not loaded.</div>';
    return;
  }

  const rows = getFilteredRows(surface);
  const isStocks = surface === "stocks";
  const snapshot = isStocks ? payloads.overview?.stocks || {} : payloads.overview?.crypto || {};
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
    if (isStocks) {
      state.stocksSearch = event.target.value;
    } else {
      state.cryptoSearch = event.target.value;
    }
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-preset`)?.addEventListener("change", (event) => {
    if (isStocks) {
      state.stocksPreset = event.target.value;
    } else {
      state.cryptoPreset = event.target.value;
    }
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-sort`)?.addEventListener("change", (event) => {
    if (isStocks) {
      state.stocksSort = event.target.value;
    } else {
      state.cryptoSort = event.target.value;
    }
    renderDatasetSurface(surface);
  });
  target.querySelector(`#${surface}-sort-direction`)?.addEventListener("click", () => {
    if (isStocks) {
      state.stocksDirection = state.stocksDirection === "asc" ? "desc" : "asc";
    } else {
      state.cryptoDirection = state.cryptoDirection === "asc" ? "desc" : "asc";
    }
    renderDatasetSurface(surface);
  });
  if (isStocks) {
    target.querySelector("#stocks-exchange")?.addEventListener("change", (event) => {
      state.stocksExchange = event.target.value;
      renderDatasetSurface(surface);
    });
    target.querySelector("#stocks-sector")?.addEventListener("change", (event) => {
      state.stocksSector = event.target.value;
      renderDatasetSurface(surface);
    });
    target.querySelector("#stocks-industry")?.addEventListener("change", (event) => {
      state.stocksIndustry = event.target.value;
      renderDatasetSurface(surface);
    });
    target.querySelector("#stocks-valuation")?.addEventListener("change", (event) => {
      state.stocksValuation = event.target.value;
      renderDatasetSurface(surface);
    });
  }
}

function renderTable(rows, isStocks) {
  return `
    <table class="market-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Name</th>
          <th>${isStocks ? "Sector" : "Type"}</th>
          <th>Price</th>
          <th>Change</th>
          <th>Market Cap</th>
          <th>Volume</th>
          ${isStocks ? "<th>PE</th><th>Yield</th>" : ""}
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
                <td>${escapeHtml(formatCurrency(row.last))}</td>
                <td class="${signedClass(row.change_pct)}">${escapeHtml(formatPercent(row.change_pct))}</td>
                <td>${escapeHtml(formatCompactNumber(row.market_cap))}</td>
                <td>${escapeHtml(formatCompactNumber(row.volume))}</td>
                ${isStocks ? `<td>${escapeHtml(row.pe === null || row.pe === undefined ? "-" : Number(row.pe).toFixed(2))}</td><td>${escapeHtml(row.dividend_yield === null || row.dividend_yield === undefined ? "-" : formatPercent(row.dividend_yield))}</td>` : ""}
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
  refs.crypto.hidden = state.surface !== "crypto";
  if (state.surface === "overview") {
    renderOverviewSurface();
    return;
  }
  try {
    await ensureDataset(state.surface);
    renderDatasetSurface(state.surface);
  } catch (error) {
    const target = state.surface === "stocks" ? refs.stocks : refs.crypto;
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
