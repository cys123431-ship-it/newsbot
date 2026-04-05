const marketsBootstrap = JSON.parse(
  document.getElementById("markets-bootstrap").textContent,
);

const marketsRefs = {
  mainTabs: document.getElementById("markets-main-tabs"),
  subTabs: document.getElementById("markets-subfilter-tabs"),
  benchmarkStrip: document.getElementById("markets-benchmark-strip"),
  selectionSummary: document.getElementById("markets-selection-summary"),
  board: document.getElementById("markets-treemap-board"),
  legend: document.getElementById("markets-legend"),
  statusLine: document.getElementById("markets-status-line"),
};

const MAIN_TABS = [
  { key: "korea", label: "한국 증시" },
  { key: "us", label: "미국 증시" },
  { key: "crypto", label: "암호화폐" },
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
  crypto: [
    { key: "all", label: "전체 코인" },
    { key: "layer1", label: "Layer 1" },
    { key: "defi", label: "DeFi" },
    { key: "meme", label: "Meme" },
    { key: "exchange", label: "거래소" },
  ],
};

const US_INDEX_PROXY_SYMBOLS = {
  sp500: "SPY",
  nasdaq: "QQQ",
  dow: "DIA",
  russell: "IWM",
};

const US_INDEX_HEADLINES = {
  sp500: "S&P 500 전체 시가총액 대비 비중",
  nasdaq: "NASDAQ 전체 시가총액 대비 비중",
  dow: "Dow 30 구성 종목 비중",
  russell: "Russell 2000 대표 구성 종목 비중",
};

const CRYPTO_CATEGORY_META = {
  all: { label: "전체 코인" },
  store: { label: "가치 저장" },
  layer1: { label: "Layer 1" },
  defi: { label: "DeFi" },
  meme: { label: "Meme" },
  exchange: { label: "거래소" },
  payments: { label: "결제" },
  scaling: { label: "스케일링" },
  ai: { label: "AI" },
  alt: { label: "기타" },
};

const CRYPTO_CATEGORY_LOOKUP = {
  BTC: "store",
  WBTC: "store",
  ETH: "layer1",
  SOL: "layer1",
  ADA: "layer1",
  AVAX: "layer1",
  DOT: "layer1",
  ATOM: "layer1",
  TIA: "layer1",
  SUI: "layer1",
  APT: "layer1",
  SEI: "layer1",
  TON: "layer1",
  NEAR: "layer1",
  TRX: "layer1",
  BNB: "exchange",
  CRO: "exchange",
  OKB: "exchange",
  UNI: "defi",
  AAVE: "defi",
  MKR: "defi",
  ONDO: "defi",
  PENDLE: "defi",
  JUP: "defi",
  RAY: "defi",
  DYDX: "defi",
  CAKE: "defi",
  DOGE: "meme",
  SHIB: "meme",
  PEPE: "meme",
  BONK: "meme",
  WIF: "meme",
  FLOKI: "meme",
  XRP: "payments",
  XLM: "payments",
  LTC: "payments",
  BCH: "payments",
  ARB: "scaling",
  OP: "scaling",
  IMX: "scaling",
  MNT: "scaling",
  FET: "ai",
  RENDER: "ai",
  TAO: "ai",
};

const marketsState = {
  surface: "korea",
  filters: {
    korea: "kospi",
    us: "sp500",
    crypto: "all",
  },
  chart: null,
};

const marketsPayloads = {
  status: null,
  us: null,
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

function marketEscapeLabel(value) {
  return String(value ?? "")
    .replaceAll("{", "")
    .replaceAll("}", "")
    .replaceAll("|", " ");
}

function normalizeSymbol(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatCompactNumber(value, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) {
    return "0";
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
    ...options,
  }).format(numeric);
}

function marketFormatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

function marketFormatPrice(value, surface) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  if (surface === "korea") {
    return `₩${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 0,
    }).format(numeric)}`;
  }
  if (surface === "crypto" && numeric < 1) {
    return `$${numeric.toFixed(4)}`;
  }
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 100 ? 0 : 2,
  }).format(numeric)}`;
}

function marketFormatCap(value, surface) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "-";
  }
  const prefix = surface === "korea" ? "₩" : "$";
  return `${prefix}${formatCompactNumber(numeric)}`;
}

function hexToRgb(hex) {
  const normalized = String(hex).replace("#", "");
  const safe = normalized.length === 3
    ? normalized
        .split("")
        .map((char) => char + char)
        .join("")
    : normalized;
  return {
    r: Number.parseInt(safe.slice(0, 2), 16),
    g: Number.parseInt(safe.slice(2, 4), 16),
    b: Number.parseInt(safe.slice(4, 6), 16),
  };
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue]
    .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixHex(baseHex, targetHex, amount) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  const weight = clamp(amount, 0, 1);
  return rgbToHex(
    base.r + (target.r - base.r) * weight,
    base.g + (target.g - base.g) * weight,
    base.b + (target.b - base.b) * weight,
  );
}

function resolveTreemapColor(changePct, surface) {
  const neutral = "#323a45";
  const flat = "#4b5563";
  const numeric = Number(changePct);
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.03) {
    return flat;
  }
  const intensity = clamp(Math.abs(numeric) / 8, 0, 1);
  const weight = 0.25 + intensity * 0.75;
  const positive = surface === "korea" ? "#ff4d67" : "#25c26e";
  const negative = surface === "korea" ? "#3d82ff" : "#e14b4b";
  return mixHex(neutral, numeric > 0 ? positive : negative, weight);
}

function computePointChange(last, changePct) {
  const price = Number(last);
  const percent = Number(changePct);
  if (!Number.isFinite(price) || !Number.isFinite(percent)) {
    return null;
  }
  const previous = price / (1 + percent / 100);
  if (!Number.isFinite(previous)) {
    return null;
  }
  return price - previous;
}

function pointChangeText(last, changePct, surface) {
  const delta = computePointChange(last, changePct);
  if (!Number.isFinite(delta)) {
    return "";
  }
  const sign = delta > 0 ? "+" : "";
  if (surface === "korea") {
    return `${sign}${new Intl.NumberFormat("ko-KR", {
      maximumFractionDigits: 0,
    }).format(delta)}`;
  }
  return `${sign}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(delta)}`;
}

function activeSubfilters() {
  return SUBFILTERS[marketsState.surface] || [];
}

function currentPayload() {
  if (marketsState.surface === "us") {
    return marketsPayloads.us;
  }
  if (marketsState.surface === "korea") {
    return marketsPayloads.korea;
  }
  return marketsPayloads.crypto;
}

function inferCryptoCategory(row) {
  const symbol = normalizeSymbol(row.symbol);
  const key = CRYPTO_CATEGORY_LOOKUP[symbol] || "alt";
  return {
    key,
    label: CRYPTO_CATEGORY_META[key]?.label || CRYPTO_CATEGORY_META.alt.label,
  };
}

function loadMarketsJson(url) {
  return fetch(url, { cache: "no-store" }).then((response) => {
    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status}`);
    }
    return response.json();
  });
}

function renderMainTabs() {
  marketsRefs.mainTabs.innerHTML = MAIN_TABS.map(
    (tab) => `
      <button
        type="button"
        class="market-tab-button ${tab.key === marketsState.surface ? "is-active" : ""}"
        data-surface="${tab.key}"
      >
        ${marketEscapeHtml(tab.label)}
      </button>
    `,
  ).join("");

  marketsRefs.mainTabs.querySelectorAll("[data-surface]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextSurface = button.dataset.surface;
      if (!nextSurface || nextSurface === marketsState.surface) {
        return;
      }
      marketsState.surface = nextSurface;
      renderMarkets();
    });
  });
}

function renderSubTabs() {
  const current = marketsState.filters[marketsState.surface];
  marketsRefs.subTabs.innerHTML = activeSubfilters().map(
    (tab) => `
      <button
        type="button"
        class="market-subtab-button ${tab.key === current ? "is-active" : ""}"
        data-filter="${tab.key}"
      >
        ${marketEscapeHtml(tab.label)}
      </button>
    `,
  ).join("");

  marketsRefs.subTabs.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextFilter = button.dataset.filter;
      if (!nextFilter || nextFilter === marketsState.filters[marketsState.surface]) {
        return;
      }
      marketsState.filters[marketsState.surface] = nextFilter;
      renderMarkets();
    });
  });
}

function renderMarketsStatus() {
  const status = marketsPayloads.status;
  if (!status) {
    marketsRefs.statusLine.textContent = "시장 상태 데이터를 불러오지 못했습니다.";
    return;
  }
  const providers = status.providers || {};
  const segments = [
    `미국 ${providers.stocks?.status || "-"}`,
    `한국 ${providers.korea?.status || "-"}`,
    `크립토 ${providers.crypto?.status || "-"}`,
  ];
  if (status.generated_at) {
    segments.push(`업데이트 ${status.generated_at}`);
  }
  marketsRefs.statusLine.textContent = segments.join(" · ");
}

function resolveSurfaceModel() {
  const payload = currentPayload();
  const filterKey = marketsState.filters[marketsState.surface];
  const subfilter = activeSubfilters().find((item) => item.key === filterKey) || activeSubfilters()[0];
  const rows = Array.isArray(payload?.rows) ? payload.rows.slice() : [];
  const rowsWithCap = rows.filter((row) => toNumber(row.market_cap) > 0);

  if (marketsState.surface === "korea") {
    const exchangeLabel = filterKey === "kosdaq" ? "KOSDAQ" : "KOSPI";
    const filteredRows = rowsWithCap
      .filter((row) => String(row.exchange || "").toUpperCase().includes(exchangeLabel))
      .sort((left, right) => toNumber(right.market_cap) - toNumber(left.market_cap))
      .slice(0, 120);

    return {
      surface: "korea",
      colorMode: "korea",
      title: `한국 증시 · ${subfilter.label}`,
      subtitle: `${subfilter.label} 안에서 시가총액 비중이 큰 종목일수록 더 큰 면적으로 배치됩니다.`,
      groupLabel: "섹터",
      rows: filteredRows,
      benchmarks: (payload?.benchmarks || []).filter(
        (row) => String(row.symbol || "").toUpperCase() === exchangeLabel,
      ),
      asOf: payload?.as_of || payload?.generated_at || "",
    };
  }

  if (marketsState.surface === "us") {
    const memberships = new Set(
      ((payload?.index_memberships || {})[filterKey] || []).map((symbol) => normalizeSymbol(symbol)),
    );
    const filteredRows = rowsWithCap
      .filter((row) => memberships.has(normalizeSymbol(row.symbol)))
      .sort((left, right) => toNumber(right.market_cap) - toNumber(left.market_cap))
      .slice(0, 160);

    return {
      surface: "us",
      colorMode: "global",
      title: `미국 증시 · ${subfilter.label}`,
      subtitle: US_INDEX_HEADLINES[filterKey] || `${subfilter.label} 구성 종목 비중`,
      groupLabel: "섹터",
      rows: filteredRows.length ? filteredRows : rowsWithCap.slice(0, 120),
      benchmarks: (payload?.benchmarks || []).filter(
        (row) => normalizeSymbol(row.symbol) === normalizeSymbol(US_INDEX_PROXY_SYMBOLS[filterKey]),
      ),
      asOf: payload?.as_of || payload?.generated_at || "",
    };
  }

  const filteredRows = rowsWithCap
    .filter((row) => {
      if (filterKey === "all") {
        return true;
      }
      return inferCryptoCategory(row).key === filterKey;
    })
    .sort((left, right) => toNumber(right.market_cap) - toNumber(left.market_cap))
    .slice(0, 140);

  const categoryLabel = filterKey === "all"
    ? "바이낸스 거래 가능 코인 전체 시가총액 비중"
    : `${subfilter.label} 카테고리 안에서의 시가총액 비중`;

  return {
    surface: "crypto",
    colorMode: "global",
    title: `암호화폐 · ${subfilter.label}`,
    subtitle: categoryLabel,
    groupLabel: "카테고리",
    rows: filteredRows,
    benchmarks: filteredRows.slice(0, 4),
    asOf: payload?.as_of || payload?.generated_at || "",
  };
}

function summarizeRows(rows) {
  const totalMarketCap = rows.reduce((sum, row) => sum + toNumber(row.market_cap), 0);
  const advancers = rows.filter((row) => toNumber(row.change_pct) > 0).length;
  const decliners = rows.filter((row) => toNumber(row.change_pct) < 0).length;
  return {
    totalMarketCap,
    advancers,
    decliners,
    unchanged: rows.length - advancers - decliners,
  };
}

function buildLeafLabel(item, surface) {
  const primary = surface === "korea"
    ? item.fullName
    : item.symbol || item.fullName;

  if (item.weightPct >= 4.5) {
    return `{name|${marketEscapeLabel(primary)}}\n{change|${marketEscapeLabel(marketFormatPercent(item.changePct))}}`;
  }
  if (item.weightPct >= 1.15) {
    return `{name|${marketEscapeLabel(primary)}}\n{change|${marketEscapeLabel(marketFormatPercent(item.changePct))}}`;
  }
  if (item.weightPct >= 0.5) {
    return `{tiny|${marketEscapeLabel(item.symbol || primary)}}`;
  }
  return "";
}

function buildTreemapHierarchy(model) {
  const totalMarketCap = model.rows.reduce((sum, row) => sum + toNumber(row.market_cap), 0) || 1;
  const grouped = new Map();

  model.rows.forEach((row) => {
    const category = model.surface === "crypto"
      ? inferCryptoCategory(row)
      : {
          key: String(row.sector_or_category || row.industry || "기타").trim() || "기타",
          label: String(row.sector_or_category || row.industry || "기타").trim() || "기타",
        };
    const groupKey = category.key;
    const groupLabel = category.label;
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        name: groupLabel,
        value: 0,
        itemStyle: {
          color: "#111821",
          borderColor: "#0b0f14",
          borderWidth: 3,
          gapWidth: 4,
        },
        upperLabel: {
          show: true,
        },
        children: [],
      });
    }
    const marketCap = toNumber(row.market_cap);
    const weightPct = (marketCap / totalMarketCap) * 100;
    const leaf = {
      name: model.surface === "korea"
        ? String(row.name || row.symbol || "").trim()
        : String(row.symbol || row.name || "").trim(),
      value: marketCap,
      symbol: String(row.symbol || "").trim(),
      fullName: String(row.name || row.symbol || "").trim(),
      last: row.last,
      changePct: row.change_pct,
      marketCap,
      volume: row.volume,
      sector: groupLabel,
      detailUrl: row.detail_url,
      weightPct,
      itemStyle: {
        color: resolveTreemapColor(row.change_pct, model.colorMode),
        borderColor: "rgba(10, 14, 19, 0.72)",
        borderWidth: 1,
      },
    };
    const group = grouped.get(groupKey);
    group.value += marketCap;
    group.children.push(leaf);
  });

  const groups = Array.from(grouped.values())
    .map((group) => ({
      ...group,
      children: group.children.sort((left, right) => right.value - left.value),
    }))
    .sort((left, right) => right.value - left.value);

  return {
    name: model.title,
    value: totalMarketCap,
    children: groups,
  };
}

function buildTooltipHtml(params, model) {
  const data = params.data || {};
  if (Array.isArray(data.children)) {
    return `
      <div class="market-tooltip">
        <strong>${marketEscapeHtml(data.name)}</strong>
        <div>구성 종목 ${marketEscapeHtml(data.children.length)}</div>
        <div>시가총액 ${marketEscapeHtml(marketFormatCap(data.value, model.surface))}</div>
      </div>
    `;
  }

  return `
    <div class="market-tooltip">
      <strong>${marketEscapeHtml(data.fullName || data.symbol || data.name)}</strong>
      <div>티커 ${marketEscapeHtml(data.symbol || "-")}</div>
      <div>현재가 ${marketEscapeHtml(marketFormatPrice(data.last, model.surface))}</div>
      <div>등락률 ${marketEscapeHtml(marketFormatPercent(data.changePct))}</div>
      <div>시가총액 ${marketEscapeHtml(marketFormatCap(data.marketCap, model.surface))}</div>
      <div>거래량 ${marketEscapeHtml(formatCompactNumber(data.volume || 0))}</div>
      <div>${marketEscapeHtml(model.groupLabel)} ${marketEscapeHtml(data.sector || "-")}</div>
      <div>비중 ${marketEscapeHtml(data.weightPct.toFixed(2))}%</div>
    </div>
  `;
}

function buildTreemapOption(model) {
  const root = buildTreemapHierarchy(model);
  return {
    backgroundColor: "transparent",
    tooltip: {
      backgroundColor: "rgba(11, 16, 23, 0.96)",
      borderColor: "#273241",
      borderWidth: 1,
      textStyle: {
        color: "#f8fbff",
        fontSize: 12,
      },
      padding: 12,
      formatter: (params) => buildTooltipHtml(params, model),
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        sort: "desc",
        squareRatio: 1.18,
        animationDurationUpdate: 280,
        breadcrumb: {
          show: false,
        },
        visibleMin: 1,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        label: {
          show: true,
          position: "inside",
          formatter: (params) => {
            if (Array.isArray(params.data?.children)) {
              return "";
            }
            return buildLeafLabel(params.data, model.surface);
          },
          color: "#ffffff",
          align: "center",
          verticalAlign: "middle",
          overflow: "break",
          rich: {
            name: {
              color: "#ffffff",
              fontSize: 16,
              fontWeight: 800,
              lineHeight: 20,
              align: "center",
            },
            change: {
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 18,
              align: "center",
            },
            tiny: {
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 14,
              align: "center",
            },
          },
        },
        upperLabel: {
          show: true,
          color: "#a6b4c7",
          fontSize: 11,
          fontWeight: 700,
          height: 24,
        },
        itemStyle: {
          borderColor: "#10161d",
          borderWidth: 2,
          gapWidth: 2,
        },
        levels: [
          {
            itemStyle: {
              borderColor: "#0f141b",
              borderWidth: 0,
              gapWidth: 4,
            },
            upperLabel: {
              show: false,
            },
          },
          {
            colorSaturation: [0, 0],
            itemStyle: {
              borderColor: "#0b0f14",
              borderWidth: 3,
              gapWidth: 4,
            },
            upperLabel: {
              show: true,
              color: "#a6b4c7",
              fontSize: 11,
              fontWeight: 800,
              height: 24,
            },
          },
          {
            itemStyle: {
              borderColor: "rgba(10, 14, 19, 0.78)",
              borderWidth: 1,
              gapWidth: 1,
            },
          },
        ],
        data: root.children,
      },
    ],
  };
}

function renderBenchmarkStrip(model) {
  const cards = (model.benchmarks || []).map((item) => {
    const pointChange = pointChangeText(item.last, item.change_pct, model.surface);
    return `
      <article class="market-benchmark-card">
        <span class="market-benchmark-label">${marketEscapeHtml(item.name || item.symbol || "-")}</span>
        <strong>${marketEscapeHtml(marketFormatPrice(item.last, model.surface))}</strong>
        <div class="market-benchmark-move">
          <span class="${toNumber(item.change_pct) > 0 ? "is-positive" : toNumber(item.change_pct) < 0 ? "is-negative" : "is-flat"}">
            ${marketEscapeHtml(pointChange)} (${marketEscapeHtml(marketFormatPercent(item.change_pct))})
          </span>
        </div>
      </article>
    `;
  });

  marketsRefs.benchmarkStrip.innerHTML = cards.length
    ? cards.join("")
    : '<div class="analysis-empty">표시할 대표 지수가 없습니다.</div>';
}

function renderSelectionSummary(model) {
  const summary = summarizeRows(model.rows);
  const groupCount = new Set(
    model.rows.map((row) => {
      if (model.surface === "crypto") {
        return inferCryptoCategory(row).label;
      }
      return String(row.sector_or_category || row.industry || "기타").trim() || "기타";
    }),
  ).size;

  marketsRefs.selectionSummary.innerHTML = [
    {
      label: "선택 시장",
      value: model.title,
      detail: model.asOf || "-",
    },
    {
      label: "추적 종목",
      value: `${model.rows.length}개`,
      detail: `${model.groupLabel} ${groupCount}개`,
    },
    {
      label: "전체 시총",
      value: marketFormatCap(summary.totalMarketCap, model.surface),
      detail: "선택된 종목 기준 합계",
    },
    {
      label: "상승 / 하락",
      value: `${summary.advancers} / ${summary.decliners}`,
      detail: `보합 ${summary.unchanged}`,
    },
  ].map(
    (card) => `
      <article class="market-summary-card">
        <span>${marketEscapeHtml(card.label)}</span>
        <strong>${marketEscapeHtml(card.value)}</strong>
        <small>${marketEscapeHtml(card.detail)}</small>
      </article>
    `,
  ).join("");
}

function renderLegend(model) {
  const directionText = model.surface === "korea"
    ? "상승은 붉은색, 하락은 푸른색, 보합은 회색"
    : "상승은 초록색, 하락은 붉은색, 보합은 회색";

  marketsRefs.legend.innerHTML = `
    <div class="market-legend-item">
      <span class="market-legend-swatch size"></span>
      <strong>크기</strong>
      <small>선택한 시장 안에서의 시가총액 비중</small>
    </div>
    <div class="market-legend-item">
      <span class="market-legend-swatch tone"></span>
      <strong>색상</strong>
      <small>${marketEscapeHtml(directionText)}</small>
    </div>
    <div class="market-legend-item">
      <span class="market-legend-swatch group"></span>
      <strong>${marketEscapeHtml(model.groupLabel)} 묶음</strong>
      <small>굵은 테두리 상단 라벨로 그룹을 구분합니다.</small>
    </div>
  `;
}

function ensureChart() {
  if (!window.echarts) {
    marketsRefs.board.innerHTML = '<div class="analysis-empty">ECharts를 불러오지 못했습니다.</div>';
    return null;
  }
  if (!marketsState.chart) {
    marketsState.chart = window.echarts.init(marketsRefs.board, null, {
      renderer: "canvas",
    });
    window.addEventListener("resize", () => {
      marketsState.chart?.resize();
    });
    marketsState.chart.on("click", (params) => {
      const detailUrl = params?.data?.detailUrl;
      if (detailUrl) {
        window.open(detailUrl, "_blank", "noopener,noreferrer");
      }
    });
  }
  return marketsState.chart;
}

function renderTreemapSurface(model) {
  const chart = ensureChart();
  if (!chart) {
    return;
  }
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

function renderMarkets() {
  renderMainTabs();
  renderSubTabs();
  renderMarketsStatus();
  const model = resolveSurfaceModel();
  renderBenchmarkStrip(model);
  renderSelectionSummary(model);
  renderLegend(model);
  renderTreemapSurface(model);
}

async function initMarkets() {
  try {
    const [statusPayload, stocksPayload, koreaPayload, cryptoPayload] = await Promise.all([
      loadMarketsJson(marketsBootstrap.status_url),
      loadMarketsJson(marketsBootstrap.stocks_url),
      loadMarketsJson(marketsBootstrap.korea_url),
      loadMarketsJson(marketsBootstrap.crypto_url),
    ]);
    marketsPayloads.status = statusPayload;
    marketsPayloads.us = stocksPayload;
    marketsPayloads.korea = koreaPayload;
    marketsPayloads.crypto = cryptoPayload;
    renderMarkets();
  } catch (error) {
    marketsRefs.statusLine.textContent = "시장 데이터를 불러오지 못했습니다.";
    marketsRefs.board.innerHTML = `
      <div class="analysis-empty">
        ${(error && error.message) ? marketEscapeHtml(error.message) : "Unknown error"}
      </div>
    `;
  }
}

void initMarkets();
