const marketsBootstrap = JSON.parse(
  document.getElementById("markets-bootstrap").textContent,
);

const marketsRefs = {
  tabs: document.getElementById("markets-surface-tabs"),
  statusLine: document.getElementById("markets-status-line"),
  overview: document.getElementById("markets-overview-surface"),
  stocks: document.getElementById("markets-stocks-surface"),
  korea: document.getElementById("markets-korea-surface"),
  crypto: document.getElementById("markets-crypto-surface"),
};

const marketsState = {
  surface: "overview",
  stockIndex: "nasdaq",
};

const marketsPayloads = {
  status: null,
  overview: null,
  stocks: null,
  korea: null,
  crypto: null,
};

function marketEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function marketFormatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value));
}

function marketFormatCompact(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function marketFormatPercent(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function marketSignedClass(value) {
  const numeric = Number(value || 0);
  if (numeric > 0) {
    return "is-positive";
  }
  if (numeric < 0) {
    return "is-negative";
  }
  return "is-flat";
}

async function loadMarketsJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`);
  }
  return response.json();
}

async function ensureMarketsDataset(surface) {
  if (surface === "stocks" && !marketsPayloads.stocks) {
    marketsPayloads.stocks = await loadMarketsJson(marketsBootstrap.stocks_url);
  }
  if (surface === "korea" && !marketsPayloads.korea) {
    marketsPayloads.korea = await loadMarketsJson(marketsBootstrap.korea_url);
  }
  if (surface === "crypto" && !marketsPayloads.crypto) {
    marketsPayloads.crypto = await loadMarketsJson(marketsBootstrap.crypto_url);
  }
}

function renderMarketSurfaceTabs() {
  const surfaces = [
    { key: "overview", label: "Overview" },
    { key: "stocks", label: "US Stocks" },
    { key: "korea", label: "Korea" },
    { key: "crypto", label: "Crypto" },
  ];
  marketsRefs.tabs.innerHTML = surfaces
    .map(
      (item) => `
        <button
          type="button"
          class="analysis-window-tab ${item.key === marketsState.surface ? "is-active" : ""}"
          data-surface="${item.key}"
        >
          ${marketEscapeHtml(item.label)}
        </button>
      `,
    )
    .join("");
  marketsRefs.tabs.querySelectorAll("[data-surface]").forEach((button) => {
    button.addEventListener("click", async () => {
      marketsState.surface = button.dataset.surface || marketsState.surface;
      await renderMarkets();
    });
  });
}

function renderMarketsStatus() {
  const status = marketsPayloads.status;
  if (!status) {
    marketsRefs.statusLine.textContent = "Unable to load market status.";
    return;
  }
  const providers = status.providers || {};
  marketsRefs.statusLine.textContent = [
    `US ${providers.stocks?.status || "-"}`,
    `KR ${providers.korea?.status || "-"}`,
    `Crypto ${providers.crypto?.status || "-"}`,
    `Updated ${status.generated_at || "-"}`,
  ].join(" · ");
}

function buildHeatmap(items, caption) {
  if (!items.length) {
    return '<div class="analysis-empty">No heatmap items available.</div>';
  }
  return `
    <section class="market-map-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">Heatmap</p>
          <h2>${marketEscapeHtml(caption)}</h2>
        </div>
      </div>
      <div class="heatmap-board">
        ${items
          .map(
            (item) => `
              <a
                class="heatmap-tile ${marketSignedClass(item.change_pct)}"
                href="${marketEscapeHtml(item.detail_url || "#")}"
                target="_blank"
                rel="noreferrer"
                style="grid-column: span ${Math.max(2, Number(item.tile_cols || item.size || 2))}; grid-row: span ${Math.max(2, Number(item.tile_rows || item.size || 2))};"
              >
                <span class="heatmap-label">${marketEscapeHtml(item.label || item.name)}</span>
                <strong>${marketFormatPercent(item.change_pct)}</strong>
                <span class="heatmap-weight">${marketEscapeHtml(item.metric_display || `${Number(item.weight_pct || item.share_pct || 0).toFixed(2)}%`)}</span>
              </a>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function buildMoverTable(title, rows) {
  if (!rows.length) {
    return `
      <section class="analysis-panel">
        <div class="analysis-panel-head"><h2>${marketEscapeHtml(title)}</h2></div>
        <div class="analysis-empty">No rows.</div>
      </section>
    `;
  }
  return `
    <section class="analysis-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">Movers</p>
          <h2>${marketEscapeHtml(title)}</h2>
        </div>
      </div>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Change</th>
            <th>Market cap</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td><a href="${marketEscapeHtml(row.detail_url || "#")}" target="_blank" rel="noreferrer">${marketEscapeHtml(row.symbol || row.label)}</a></td>
                  <td class="${marketSignedClass(row.change_pct)}">${marketFormatPercent(row.change_pct)}</td>
                  <td>${marketFormatCompact(row.market_cap || row.value)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderOverviewSurface() {
  const overview = marketsPayloads.overview;
  if (!overview) {
    marketsRefs.overview.innerHTML = '<div class="analysis-empty">Overview unavailable.</div>';
    return;
  }

  const topCards = overview.top_cards || [];
  marketsRefs.overview.innerHTML = `
    <section class="market-top-card-grid">
      ${topCards
        .map(
          (card) => `
            <article class="market-stat-card market-stat-card-${marketEscapeHtml(card.status || "warning")}">
              <span>${marketEscapeHtml(card.label)}</span>
              <strong>${marketFormatNumber(card.value)}</strong>
              <p>${marketEscapeHtml(card.detail || "")}</p>
            </article>
          `,
        )
        .join("")}
    </section>

    <section class="market-overview-grid">
      <article class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">United States</p>
            <h2>Index-weighted stock board</h2>
          </div>
        </div>
        <p class="market-support-copy">NASDAQ, S&amp;P 500, Russell, Dow 기준으로 개별 종목 비중을 계산합니다.</p>
        ${(overview.stocks?.benchmarks || [])
          .slice(0, 4)
          .map(
            (item) => `
              <div class="market-benchmark-row">
                <strong>${marketEscapeHtml(item.symbol)}</strong>
                <span class="${marketSignedClass(item.change_pct)}">${marketFormatPercent(item.change_pct)}</span>
              </div>
            `,
          )
          .join("")}
      </article>

      <article class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">Korea</p>
            <h2>Large-cap market board</h2>
          </div>
        </div>
        <p class="market-support-copy">국내 주식은 시총 기반 히트맵으로 유지하고, 상단에서 벤치마크를 보여줍니다.</p>
        ${(overview.korea?.benchmarks || [])
          .slice(0, 2)
          .map(
            (item) => `
              <div class="market-benchmark-row">
                <strong>${marketEscapeHtml(item.symbol)}</strong>
                <span class="${marketSignedClass(item.change_pct)}">${marketFormatPercent(item.change_pct)}</span>
              </div>
            `,
          )
          .join("")}
      </article>

      <article class="analysis-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">Crypto</p>
            <h2>Binance-style coin map</h2>
          </div>
        </div>
        <p class="market-support-copy">Binance spot 거래쌍과 코인 시총을 매칭해서 BTC, ETH 중심의 마켓맵을 만듭니다.</p>
        ${(overview.crypto?.benchmarks || [])
          .slice(0, 4)
          .map(
            (item) => `
              <div class="market-benchmark-row">
                <strong>${marketEscapeHtml(item.symbol)}</strong>
                <span class="${marketSignedClass(item.change_pct)}">${marketFormatPercent(item.change_pct)}</span>
              </div>
            `,
          )
          .join("")}
      </article>
    </section>
  `;
}

function renderStocksSurface() {
  const payload = marketsPayloads.stocks;
  const indexFilters = payload.index_filters || [];
  const activeItems = payload.heatmaps?.[marketsState.stockIndex] || payload.heatmap || [];

  marketsRefs.stocks.innerHTML = `
    <section class="market-index-tabs">
      ${indexFilters
        .map(
          (item) => `
            <button
              type="button"
              class="analysis-window-tab ${item.key === marketsState.stockIndex ? "is-active" : ""}"
              data-index="${item.key}"
            >
              ${marketEscapeHtml(item.label)}
            </button>
          `,
        )
        .join("")}
    </section>

    ${buildHeatmap(activeItems, `${indexFilters.find((item) => item.key === marketsState.stockIndex)?.label || "US stocks"} heatmap`)}

    <section class="market-table-grid">
      ${buildMoverTable("Top gainers", payload.movers?.gainers || [])}
      ${buildMoverTable("Most active", payload.movers?.active || [])}
    </section>
  `;

  marketsRefs.stocks.querySelectorAll("[data-index]").forEach((button) => {
    button.addEventListener("click", () => {
      marketsState.stockIndex = button.dataset.index || marketsState.stockIndex;
      renderStocksSurface();
    });
  });
}

function renderKoreaSurface() {
  const payload = marketsPayloads.korea;
  marketsRefs.korea.innerHTML = `
    ${buildHeatmap(payload.heatmap || [], "Korea market-cap heatmap")}
    <section class="market-table-grid">
      ${buildMoverTable("Top gainers", payload.movers?.gainers || [])}
      ${buildMoverTable("Most active", payload.movers?.active || [])}
    </section>
  `;
}

function renderCryptoSurface() {
  const payload = marketsPayloads.crypto;
  const trending = payload.trending || [];
  marketsRefs.crypto.innerHTML = `
    ${buildHeatmap(payload.heatmap || [], "Binance market-cap heatmap")}

    <section class="market-table-grid">
      ${buildMoverTable("Top gainers", payload.movers?.gainers || [])}
      ${buildMoverTable("Most active", payload.movers?.active || [])}
    </section>

    <section class="analysis-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">Trending</p>
          <h2>Coin watchlist</h2>
        </div>
      </div>
      <div class="chip-grid">
        ${trending
          .map(
            (item) => `
              <a class="chip-card" href="${marketEscapeHtml(item.detail_url || "#")}" target="_blank" rel="noreferrer">
                <strong>${marketEscapeHtml(item.symbol || item.name)}</strong>
                <span>${marketEscapeHtml(item.name || "")}</span>
              </a>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

async function renderMarkets() {
  await ensureMarketsDataset(marketsState.surface);
  renderMarketSurfaceTabs();
  renderMarketsStatus();

  marketsRefs.overview.hidden = marketsState.surface !== "overview";
  marketsRefs.stocks.hidden = marketsState.surface !== "stocks";
  marketsRefs.korea.hidden = marketsState.surface !== "korea";
  marketsRefs.crypto.hidden = marketsState.surface !== "crypto";

  if (marketsState.surface === "overview") {
    renderOverviewSurface();
  }
  if (marketsState.surface === "stocks") {
    renderStocksSurface();
  }
  if (marketsState.surface === "korea") {
    renderKoreaSurface();
  }
  if (marketsState.surface === "crypto") {
    renderCryptoSurface();
  }
}

async function initMarkets() {
  const [statusPayload, overviewPayload] = await Promise.all([
    loadMarketsJson(marketsBootstrap.status_url),
    loadMarketsJson(marketsBootstrap.overview_url),
  ]);
  marketsPayloads.status = statusPayload;
  marketsPayloads.overview = overviewPayload;
  await renderMarkets();
}

void initMarkets();
