const bootstrap = JSON.parse(document.getElementById("markets-bootstrap")?.textContent || "{}");

const refs = {
  app: document.getElementById("crypto-app"),
  themeToggle: document.getElementById("crypto-theme-toggle"),
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
const THEME_STORAGE_KEY = "newsbot:crypto-theme";
const LIVE_CACHE_TTL_MS = 90 * 1000;
const REFRESH_COOLDOWN_MS = 45 * 1000;
const ROOT_FALLBACK_MANIFEST_PATH = "data/scanner/manifest.json";
const GUIDE_PAGE_ORDER = [
  "overview",
  "signals",
  "derivatives",
  "movers",
  "opportunities",
  "setups",
  "technical_ratings",
  "trend",
  "momentum",
  "volatility",
  "multi_timeframe",
];
const PAGE_GUIDES = {
  overview: {
    label: "오버뷰",
    brief: "기술·추세·모멘텀·파생·변동성 점수를 묶어 전체 시장을 빠르게 요약합니다.",
    chips: ["기회 점수", "상위 시그널", "타임프레임별 강력 롱/숏", "실시간 프리뷰"],
    details: [
      "오버뷰는 지금 어디서부터 볼지 정하는 첫 화면입니다.",
      "상위 기회 종목은 opportunity 순위, 상위 시그널은 signal_score 순위로 정리합니다.",
      "5m·15m·1h·4h마다 롱 1개와 숏 1개를 따로 골라 강력 추천 카드로 보여줍니다.",
    ],
    formula: [
      "상위 기회: opportunity 내림차순",
      "상위 시그널: signal_score 내림차순",
      "강력 추천: 타임프레임별 side별 최고 opportunity",
    ],
    why: "전체 시장에서 먼저 볼 종목과 다음에 열 페이지를 빠르게 고를 때 적합합니다.",
  },
  signals: {
    label: "시그널",
    brief: "Funding, OI, 롱/숏 비율과 RSI, MACD, Bollinger, VWAP를 함께 보고 이상치 강도를 정리합니다.",
    chips: ["Funding", "Open Interest", "Long/Short", "RSI", "MACD", "Bollinger", "VWAP"],
    details: [
      "파생 이상치와 기술적 가속도가 동시에 강한 종목을 위로 올리는 화면입니다.",
      "Funding과 OI가 과열됐는지, RSI와 MACD가 같은 방향으로 힘을 주는지 함께 봅니다.",
    ],
    formula: ["signal_score = 파생 45% + |모멘텀 편향| 30% + |기술 점수| 25%"],
    why: "급하게 뜨거워진 종목이나 지금 시그널이 붙는 종목을 빠르게 찾을 때 좋습니다.",
  },
  derivatives: {
    label: "파생지표",
    brief: "Funding, OI, 롱/숏 비율, 청산 압력을 중심으로 군중 포지셔닝이 어디로 쏠렸는지 봅니다.",
    chips: ["Funding", "Open Interest", "Long/Short", "Liquidation"],
    details: [
      "파생지표는 가격 자체보다 포지션 밀집과 과열도를 읽는 화면입니다.",
      "거래대금과 OI가 충분히 큰 종목을 우선 보면서, Funding과 롱/숏 비율 편향을 같이 반영합니다.",
    ],
    formula: ["derivatives_rank = 파생 점수 50% + 정규화 OI 30% + 정규화 거래대금 20%"],
    why: "숏 과밀·롱 과밀, 청산 압력, OI 집중처럼 군중 포지션 흐름을 볼 때 적합합니다.",
  },
  movers: {
    label: "급등락",
    brief: "24시간 변동률만 보지 않고 거래대금과 변동성까지 묶어 실제로 움직이는 종목을 올립니다.",
    chips: ["24h 변동률", "거래대금", "BB Width", "ATR%", "압축/돌파"],
    details: [
      "단순 급등락 순위가 아니라 거래가 붙고 변동성도 살아 있는 종목을 우선합니다.",
      "볼린저 압축 해제나 상·하방 돌파가 보이는 종목을 함께 걸러냅니다.",
    ],
    formula: ["movers_rank = |24h 변동률| 45% + 정규화 거래대금 30% + 변동성 점수 25%"],
    why: "지금 실제로 크게 움직이는 종목이나 막 돌파가 붙는 종목을 찾을 때 유용합니다.",
  },
  opportunities: {
    label: "기회 랭킹",
    brief: "기술·추세·모멘텀·파생·변동성을 합친 종합 점수로 지금 우선 볼 종목을 정렬합니다.",
    chips: ["기술", "추세", "모멘텀", "파생", "변동성", "방향 합의"],
    details: [
      "기회 랭킹은 코인 섹션의 메인 종합 점수 화면입니다.",
      "롱/숏 후보를 같은 공식을 기준으로 평가하고, 상단에서 각각 따로 볼 수 있게 분리합니다.",
    ],
    formula: [
      "opportunity = |기술| 28% + 추세 강도 20% + 모멘텀 강도 16% + 파생 18% + 변동성 8% + 방향 합의 10%",
    ],
    why: "여러 탭을 다 보지 않고도 지금 가장 강한 후보를 우선순위로 정리하고 싶을 때 좋습니다.",
  },
  setups: {
    label: "워치리스트",
    brief: "기회 점수에 즉시성 신호를 더해 지금 눈여겨볼 만한 종목을 카드형으로 보여줍니다.",
    chips: ["기회 점수", "변동성", "파생 온도", "돌파", "압축", "다이버전스"],
    details: [
      "워치리스트는 단순 상위 랭킹보다 '지금 볼 가치'에 초점을 맞춘 화면입니다.",
      "돌파·압축·다이버전스 같은 즉시성 신호가 있는 종목에 가산점을 줍니다.",
    ],
    formula: ["watchlist_score = opportunity 55% + volatility 20% + derivatives 15% + recency flag 10%"],
    why: "나중에 볼 목록이 아니라 당장 차트를 열어볼 후보를 정리할 때 적합합니다.",
  },
  technical_ratings: {
    label: "테크니컬 레이팅",
    brief: "이동평균 계열과 오실레이터 계열을 합쳐 Strong Buy ~ Strong Sell로 분류합니다.",
    chips: ["MA bias", "Oscillator bias", "VWAP gap"],
    details: [
      "이 페이지는 기술적 방향성만 따로 깔끔하게 보고 싶을 때 쓰는 분류 화면입니다.",
      "추세·모멘텀 세부 설명보다 전체 기술 점수의 강약과 방향을 더 분명히 보여줍니다.",
    ],
    formula: ["technical_rank = |기술 점수| 75% + |이동평균 점수| 25%"],
    why: "Strong Buy, Buy, Neutral, Sell, Strong Sell 분류를 빠르게 확인할 때 좋습니다.",
  },
  trend: {
    label: "추세",
    brief: "EMA 크로스, Supertrend, ADX-DMI, Ichimoku를 함께 봐서 추세 강도와 방향을 판단합니다.",
    chips: ["EMA20/50/200", "Supertrend", "ADX-DMI", "Ichimoku"],
    details: [
      "추세 화면은 방향보다도 추세가 얼마나 정렬돼 있는지를 중요하게 봅니다.",
      "ADX와 DI 차이로 추세 강도를 보강하고, EMA와 Ichimoku 편향을 같이 확인합니다.",
    ],
    formula: ["trend_rank = 추세 강도 70% + |추세 편향| 30%"],
    why: "강한 상승 추세, 강한 하락 추세, 전환 후보를 구분해 보고 싶을 때 적합합니다.",
  },
  momentum: {
    label: "모멘텀",
    brief: "RSI, Stoch RSI, MACD, ROC 중심으로 가속도와 과매수·과매도 상태를 판단합니다.",
    chips: ["RSI", "Stoch RSI", "MACD", "ROC"],
    details: [
      "모멘텀 화면은 지금 힘이 붙는지, 힘이 꺾이는지를 읽는 데 초점을 둡니다.",
      "다이버전스 후보와 과매수·과매도 구간도 함께 보여줘서 과열 여부를 같이 볼 수 있습니다.",
    ],
    formula: ["momentum_rank = 모멘텀 강도 65% + |모멘텀 편향| 35%"],
    why: "상승 가속과 하락 가속, 과열과 침체를 빠르게 비교할 때 유용합니다.",
  },
  volatility: {
    label: "변동성",
    brief: "볼린저 밴드 폭, ATR%, 압축, 확장, 돌파 신호를 묶어 폭발 직전과 진행 중인 움직임을 구분합니다.",
    chips: ["BB Width", "ATR%", "압축", "확장", "돌파"],
    details: [
      "변동성 화면은 이미 크게 움직인 종목과 곧 움직일 종목을 함께 보는 용도입니다.",
      "압축 구간, 상방 돌파, 하방 돌파, 확장 상태를 같은 규칙으로 분류합니다.",
    ],
    formula: ["volatility_rank = 변동성 점수 70% + 돌파/압축 보너스 30%"],
    why: "스퀴즈 해제, 확장 초입, 돌파 진행 상태를 빠르게 보고 싶을 때 적합합니다.",
  },
  multi_timeframe: {
    label: "멀티 타임프레임",
    brief: "5m, 15m, 1h, 4h를 따로 계산한 뒤 가중치로 합산해 프레임 합의도를 계산합니다.",
    chips: ["5m 15", "15m 20", "1h 30", "4h 35", "상승 합의", "하락 합의", "혼합"],
    details: [
      "짧은 프레임만 강한 종목과 큰 프레임까지 같이 맞는 종목을 구분하는 화면입니다.",
      "4h와 1h 비중을 더 높게 둬서, 짧은 프레임 잡음보다 큰 흐름을 더 중요하게 반영합니다.",
    ],
    formula: [
      "합의 가중치 = 5m 15 + 15m 20 + 1h 30 + 4h 35",
      "롱 가중치 65 이상이면 상승 합의, 숏 가중치 65 이상이면 하락 합의, 그 외는 혼합",
    ],
    why: "한 프레임만 강한 종목이 아니라 여러 시간대가 같이 맞는 종목을 찾을 때 가장 유용합니다.",
  },
};

const state = {
  pageKey: String(bootstrap.crypto_page_key || "overview"),
  pageLabel: String(bootstrap.crypto_page_label || "오버뷰"),
  universeKey: localStorage.getItem(`${LOCAL_CACHE_PREFIX}universe`) || "top100",
  timeframe: localStorage.getItem(`${LOCAL_CACHE_PREFIX}timeframe`) || "5m",
  surface: resolveDeploymentSurface(),
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
  fallbackMeta: null,
  theme: readThemePreference(),
};

init();

function init() {
  applyTheme(state.theme, false);
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

  refs.themeToggle?.addEventListener("click", () => {
    applyTheme(state.theme === "light" ? "dark" : "light");
  });

  window.setInterval(updateCooldownText, 1000);
  window.setInterval(() => {
    if (!state.loading && (state.source === "live" || state.source === "fallback")) {
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
    if (state.pageKey === "methodology") {
      renderMethodologyPage();
      return;
    }

    const livePayload = await loadLivePayload(force);
    state.source = "live";
    state.generatedAt = livePayload.generated_at || new Date().toISOString();
    state.lastLoadedAt = new Date().toISOString();
    state.liveCoverageNote = String(livePayload.coverage_note || "");
    state.fallbackMeta = null;
    renderPayload(livePayload);
  } catch (liveError) {
    try {
      const fallbackPayload = await loadFallbackPayload();
      state.source = "fallback";
      state.generatedAt = fallbackPayload.generated_at || null;
      state.lastLoadedAt = new Date().toISOString();
      state.liveCoverageNote = "";
      state.fallbackMeta = {
        reason:
          String(fallbackPayload.fallback_reason || "").trim() ||
          "실시간 Binance 요청 실패 또는 제한으로 배치 fallback 데이터를 표시합니다.",
        generatedAt: fallbackPayload.fallback_generated_at || fallbackPayload.generated_at || null,
      };
      renderPayload(fallbackPayload, {
        warning: state.fallbackMeta.reason,
      });
    } catch (fallbackError) {
      state.source = "error";
      state.generatedAt = null;
      state.lastLoadedAt = new Date().toISOString();
      state.fallbackMeta = null;
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
  const payload = await response.json();
  return {
    ...payload,
    data_origin: payload.data_origin || payload.data_source || "batch_fallback",
    fallback_reason:
      payload.fallback_reason || "실시간 Binance 요청 실패 또는 제한으로 배치 fallback 데이터를 표시합니다.",
    fallback_generated_at: payload.fallback_generated_at || payload.generated_at || null,
  };
}

async function loadManifest() {
  if (state.manifest) {
    return state.manifest;
  }
  if (!state.manifestPromise) {
    state.manifestPromise = (async () => {
      const candidates = [
        resolveManifestUrl(),
        resolveRootManifestUrl(),
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
  return new URL(String(bootstrap.scanner_manifest_url || ROOT_FALLBACK_MANIFEST_PATH), window.location.href).toString();
}

function resolveRootManifestUrl() {
  return resolveSiteRootUrl(ROOT_FALLBACK_MANIFEST_PATH);
}

function resolveSiteRootUrl(pathFromRoot) {
  const basePrefix = String(bootstrap.site_root_prefix || inferSiteRootPrefix());
  const normalizedBase = basePrefix.endsWith("/") ? basePrefix : `${basePrefix}/`;
  return new URL(pathFromRoot.replace(/^\/+/, ""), new URL(normalizedBase, window.location.origin)).toString();
}

function inferSiteRootPrefix() {
  const pathname = window.location.pathname || "/";
  const marketsIndex = pathname.indexOf("/markets");
  if (marketsIndex >= 0) {
    const prefix = pathname.slice(0, marketsIndex);
    return prefix ? `${prefix}/` : "/";
  }
  const lastSlashIndex = pathname.lastIndexOf("/");
  if (lastSlashIndex >= 0) {
    const directory = pathname.slice(0, lastSlashIndex + 1);
    return directory || "/";
  }
  return "/";
}

function resolveDeploymentSurface() {
  const configured = String(bootstrap.deployment_surface || "").trim().toLowerCase();
  if (configured) {
    return configured;
  }
  const hostname = String(window.location.hostname || "").toLowerCase();
  if (hostname.includes("github.io")) {
    return "backup";
  }
  if (hostname.includes("vercel.app")) {
    return "primary";
  }
  return "local";
}

function formatDeploymentSurfaceLabel(surface) {
  if (surface === "primary") {
    return "주 운영면 Vercel";
  }
  if (surface === "backup") {
    return "백업면 GitHub Pages";
  }
  return "로컬 빌드";
}

function buildSurfaceWarning() {
  if (state.surface === "backup") {
    return "GitHub Pages 백업면에서는 fallback 스냅샷이 더 오래될 수 있습니다.";
  }
  return "";
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

function getPageGuide(pageKey) {
  return PAGE_GUIDES[pageKey] || null;
}

function getPageHref(pageKey) {
  const tabs = Array.isArray(bootstrap.crypto_page_links) ? bootstrap.crypto_page_links : [];
  const match = tabs.find((tab) => tab.key === pageKey);
  return match ? String(match.href || "") : "";
}

function renderPagePrimer(pageKey) {
  const guide = getPageGuide(pageKey);
  if (!guide) {
    return "";
  }
  const detailHref = getPageHref("methodology");
  return renderSection(
    `${guide.label}는 이렇게 봅니다`,
    guide.brief,
    `
      ${guide.chips?.length ? renderChipRow(guide.chips) : ""}
      <div class="crypto-methodology-copy">
        ${guide.formula?.[0] ? `<p><strong>핵심 기준</strong> ${escapeHtml(guide.formula[0])}</p>` : ""}
        ${guide.why ? `<p><strong>이럴 때 유용합니다</strong> ${escapeHtml(guide.why)}</p>` : ""}
        ${
          detailHref && pageKey !== "methodology"
            ? `<div class="crypto-methodology-actions">
                <a class="scanner-link-button is-muted" href="${escapeHtml(detailHref)}">상세 분석 기준 보기</a>
              </div>`
            : ""
        }
      </div>
    `,
  );
}

function renderMethodologyPage() {
  state.source = "guide";
  state.generatedAt = null;
  state.lastLoadedAt = new Date().toISOString();
  state.pageLabel = String(bootstrap.crypto_page_label || "분석 기준");
  refs.statusLine.textContent = "각 코인 버튼의 분석 기준을 안내합니다.";
  refs.progressBar.style.width = "100%";
  renderMetaSummary();
  refs.activeScan.innerHTML = chip("이 페이지는 데이터 조회가 아니라 각 분석 탭의 기준을 설명하는 안내 페이지입니다.");
  refs.pageHighlights.innerHTML = renderSection(
    "코인 버튼 해설",
    "각 탭이 어떤 근거로 코인을 분석하는지 짧게 이해할 수 있도록 정리했습니다.",
    `
      ${renderChipRow(["기준 지표", "정렬 공식", "활용 포인트"])}
      <div class="crypto-methodology-copy">
        <p>오버뷰, 시그널, 파생지표, 급등락, 기회 랭킹처럼 화면 목적이 달라서 정렬 기준도 각각 다릅니다.</p>
        <p>아래에서 각 페이지가 어떤 지표를 보고 어떤 점수로 순위를 매기는지 바로 확인할 수 있습니다.</p>
      </div>
    `,
  );
  refs.pageControls.innerHTML = renderSection(
    "페이지 바로가기",
    "설명을 읽고 바로 해당 페이지로 이동할 수 있습니다.",
    `
      <div class="crypto-compact-grid">
        ${GUIDE_PAGE_ORDER.map((pageKey) => {
          const guide = getPageGuide(pageKey);
          const href = getPageHref(pageKey);
          if (!guide || !href) {
            return "";
          }
          return renderRouteCard(href, guide.label, guide.brief);
        }).join("")}
      </div>
    `,
  );
  refs.pageContent.innerHTML = GUIDE_PAGE_ORDER.map((pageKey) => renderMethodologySection(pageKey)).join("");
}

function renderMethodologySection(pageKey) {
  const guide = getPageGuide(pageKey);
  if (!guide) {
    return "";
  }
  const href = getPageHref(pageKey);
  return renderSection(
    `${guide.label} 상세 기준`,
    guide.brief,
    `
      ${guide.chips?.length ? renderChipRow(guide.chips) : ""}
      <div class="crypto-methodology-copy">
        ${(guide.details || []).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
        ${(guide.formula || []).map((line) => `<p><strong>정렬 기준</strong> ${escapeHtml(line)}</p>`).join("")}
        ${guide.why ? `<p><strong>언제 보기 좋은가</strong> ${escapeHtml(guide.why)}</p>` : ""}
        ${
          href
            ? `<div class="crypto-methodology-actions">
                <a class="scanner-link-button" href="${escapeHtml(href)}">${escapeHtml(guide.label)} 페이지 열기</a>
              </div>`
            : ""
        }
      </div>
    `,
  );
}

function renderLoadingState() {
  refs.statusLine.textContent = "실시간 시장 데이터를 준비하고 있습니다.";
  refs.progressBar.style.width = "18%";
  refs.summaryMeta.innerHTML = [
    chip("실시간 데이터를 준비 중입니다."),
    chip(formatDeploymentSurfaceLabel(state.surface)),
  ].join("");
  refs.activeScan.innerHTML = [
    chip("Binance 실시간 데이터를 불러오고 있습니다."),
    state.surface === "backup" ? chip(buildSurfaceWarning()) : "",
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("overview"),
    renderStatCards(payload.summary_cards || []),
    renderStrongRecommendationSection(payload.strong_recommendations || {}),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("signals"),
    renderCombinedHighlights(payload.summary_cards, payload.anomaly_counts),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("derivatives"),
    renderCombinedHighlights(payload.summary_cards, payload.counts),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("movers"),
    renderCombinedHighlights(payload.summary_cards, payload.counts),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("opportunities"),
    renderStatCards(payload.summary_cards || []),
  ].join("");
  refs.pageControls.innerHTML = [
    renderSection(
      "롱/숏 상위 랭킹",
      "같은 종합 점수 체계에서 롱 우위 후보와 숏 우위 후보를 나눠서 바로 봅니다.",
      `<div class="crypto-control-grid">
        ${renderSideRankingBlock("롱 랭킹 상위", payload.long_rows || [], "long")}
        ${renderSideRankingBlock("숏 랭킹 상위", payload.short_rows || [], "short")}
      </div>`,
    ),
    renderSection(
      "랭킹 공식",
      "기술·추세·모멘텀·파생·변동성을 조합한 실시간 우선순위입니다.",
      renderChipRow(["기술 28%", "추세 20%", "모멘텀 16%", "파생 18%", "변동성 8%", "합의도 10%"]),
    ),
  ].join("");
  refs.pageContent.innerHTML = renderOpportunityGrid(payload.rows || []);
}

function renderSetups(payload) {
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("setups"),
    renderStatCards(payload.summary_cards || []),
  ].join("");
  refs.pageControls.innerHTML = renderSection(
    "워치리스트 해석",
    "즉시성 신호와 기회 점수를 함께 반영한 후보를 카드형으로 정리했습니다.",
    renderChipRow(["롱/숏 우위", "기회 점수", "변동성", "파생 온도", "즉시성 신호"]),
  );
  refs.pageContent.innerHTML = renderSetupCards(payload.rows || []);
}

function renderTechnicalRatings(payload) {
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("technical_ratings"),
    renderCountGrid(payload.distribution || []),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("trend"),
    renderCountGrid(payload.counts || {}),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("momentum"),
    renderCountGrid(payload.counts || {}),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("volatility"),
    renderCountGrid(payload.counts || {}),
  ].join("");
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
  refs.pageHighlights.innerHTML = [
    renderPagePrimer("multi_timeframe"),
    renderCountGrid(payload.counts || {}),
  ].join("");
  refs.pageControls.innerHTML = renderSection(
    "프레임 합의도",
    "4h 35 · 1h 30 · 15m 20 · 5m 15 가중치로 롱/숏 합의를 계산합니다.",
    renderChipRow(["4h 35", "1h 30", "15m 20", "5m 15"]),
  );
  refs.pageContent.innerHTML = `
    ${renderMultiTimeframeFeaturedSection(payload.overview_featured_rows || payload.featured_rows || [])}
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

function renderMultiTimeframeFeaturedSection(rows) {
  if (!rows.length) {
    return "";
  }
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>오버뷰 강력 추천 멀티 타임프레임</strong>
          <span>오버뷰 강력 추천 코인을 멀티 타임프레임 매트릭스로 먼저 확인합니다.</span>
        </div>
      </div>
      <div class="crypto-mtf-grid">
        ${rows.map((row) => renderMultiTimeframeCard(row, { featured: true })).join("")}
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
  const sourceLabel =
    state.source === "live"
      ? "Binance 실시간"
      : state.source === "fallback"
        ? "배치 fallback"
        : state.source === "deprecated"
          ? "보관함"
          : state.source === "guide"
            ? "분석 기준 안내"
            : "준비 중";
  refs.summaryMeta.innerHTML = [
    chip(`최근 불러온 시각(한국시간) ${formatSeoulDateTime(state.lastLoadedAt)}`),
    chip(`데이터 소스 ${sourceLabel}`),
    chip(formatDeploymentSurfaceLabel(state.surface)),
    chip(elapsedMinutes === null ? "경과 시간 계산 중" : `경과 시간 ${formatElapsed(elapsedMinutes)}`),
    chip(state.universeKey),
    chip(state.pageLabel),
  ].join("");
}

function renderActiveScan(payload, warning) {
  const backupWarning = buildSurfaceWarning();
  const fallbackGeneratedAt =
    payload?.fallback_generated_at || state.fallbackMeta?.generatedAt || payload?.generated_at || null;
  const line =
    state.source === "live"
      ? `실시간 조회 성공 · ${escapeHtml(payload.coverage_note || `${payload.symbols_scanned || 0}개 심볼 계산`)} · ${escapeHtml(payload.timeframe_label || state.timeframe)}`
      : state.source === "fallback"
        ? `실시간 조회 실패, 최근 배치 데이터 표시 중 · 배치 기준 ${escapeHtml(formatSeoulDateTime(fallbackGeneratedAt))}`
        : "데이터 준비 중";
  refs.activeScan.innerHTML = [
    chip(line),
    warning ? chip(warning) : "",
    backupWarning ? chip(backupWarning) : "",
  ].join("");
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

function renderStrongRecommendationSection(recommendations) {
  const entries = Object.values(recommendations || {});
  if (!entries.length) {
    return "";
  }
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>타임프레임별 강력 추천</strong>
          <span>각 타임프레임에서 가장 강한 롱 후보 1개와 숏 후보 1개를 같이 보여줍니다.</span>
        </div>
      </div>
      <div class="crypto-recommendation-grid">
        ${entries.map((entry) => renderStrongRecommendationFrame(entry)).join("")}
      </div>
    </section>
  `;
}

function renderSideRankingBlock(title, rows, side) {
  return `
    <article class="crypto-panel">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(side === "long" ? "롱 우위 상위 4개" : "숏 우위 상위 4개")}</span>
        </div>
        ${badge(side === "long" ? "롱" : "숏", sideScore(side))}
      </div>
      ${
        rows.length
          ? `<div class="crypto-preview-grid">${rows.slice(0, 4).map((row) => renderOpportunityCard(row)).join("")}</div>`
          : '<div class="analysis-empty">후보 없음</div>'
      }
    </article>
  `;
}

function renderStrongRecommendationFrame(entry) {
  return `
    <article class="crypto-panel crypto-recommendation-frame">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(entry.timeframe_label || entry.timeframe || "-")}</strong>
          <span>롱 1개 · 숏 1개</span>
        </div>
      </div>
      <div class="crypto-preview-grid">
        ${renderStrongRecommendationCard(entry.long)}
        ${renderStrongRecommendationCard(entry.short)}
      </div>
    </article>
  `;
}

function renderStrongRecommendationCard(card) {
  if (!card || card.empty) {
    return `
      <article class="crypto-preview-card">
        <div class="crypto-preview-head">
          <strong>${escapeHtml(card?.side_label || "후보")}</strong>
          ${badge("후보 없음", 0)}
        </div>
        <p>현재 조건에서는 강하게 분류된 후보가 없습니다.</p>
      </article>
    `;
  }
  return `
    <article class="crypto-preview-card">
      <div class="crypto-preview-head">
        <strong>${escapeHtml(card.symbol)}</strong>
        ${badge(card.side_label || "-", sideScore(card.side))}
      </div>
      <p>${escapeHtml([
        card.technical_rating || "Neutral",
        card.trend_bias || "혼조",
        card.momentum_bias || "중립",
      ].join(" · "))}</p>
      <div class="crypto-preview-score">
        <span>${escapeHtml(card.timeframe_label || card.timeframe || "-")}</span>
        <span>기회 ${escapeHtml(formatNumber(card.opportunity))}</span>
        <span>${escapeHtml(formatPrice(card.last_price))}</span>
      </div>
    </article>
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

function renderMultiTimeframeCard(row, options = {}) {
  const featured = Boolean(options.featured);
  const featuredSlot = row.featured_slot || null;
  return `
    <article class="crypto-panel">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(row.symbol)}</strong>
          <span>${escapeHtml(row.consensus_label)} · 롱 ${escapeHtml(formatNumber(row.long_weight))} / 숏 ${escapeHtml(formatNumber(row.short_weight))}</span>
        </div>
      </div>
      ${
        featured && featuredSlot
          ? `<div class="crypto-chip-row">
              ${chip(`오버뷰 ${featuredSlot.timeframe_label || featuredSlot.timeframe || "-"}`)}
              ${badge(featuredSlot.side_label || "-", sideScore(featuredSlot.side))}
              ${chip(`기회 ${formatNumber(featuredSlot.opportunity)}`)}
            </div>`
          : ""
      }
      <div class="crypto-mtf-table">
        ${TIMEFRAMES.map((frame) => renderMultiTimeframeRow(frame, row.timeframes?.[frame.key])).join("")}
      </div>
    </article>
  `;
}

function renderMultiTimeframeRow(frame, entry) {
  return `
    <div class="crypto-mtf-row">
      <strong>${escapeHtml(frame?.key || "-")}</strong>
      ${entry ? badge(entry.side_label || "-", sideScore(entry.side)) : "<span>-</span>"}
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
    return state.fallbackMeta?.reason || "실시간 조회 실패, 최근 배치 데이터 표시 중";
  }
  if (state.source === "guide") {
    return "각 코인 탭의 분석 기준을 설명하는 페이지입니다.";
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

function sideScore(side) {
  if (side === "long") return 1;
  if (side === "short") return -1;
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
  if (state.pageKey === "methodology") {
    refs.refreshButton.disabled = true;
    refs.cooldownText.textContent = "이 페이지는 설명 페이지라 실시간 새로고침이 필요 없습니다.";
    return;
  }
  const remaining = Math.max(0, Math.ceil((state.cooldownUntil - Date.now()) / 1000));
  refs.refreshButton.disabled = state.loading || remaining > 0;
  refs.cooldownText.textContent =
    remaining > 0
      ? `다음 라이브 새로고침까지 ${remaining}초`
      : "실시간 Binance 조회 기준입니다. 버튼을 누르면 최신 시장 데이터를 다시 불러옵니다.";
}

function readThemePreference() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  } catch (_) {
    return "dark";
  }
}

function applyTheme(theme, persist = true) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.classList.remove("crypto-theme-dark", "crypto-theme-light");
  document.documentElement.classList.add(`crypto-theme-${state.theme}`);
  refs.app?.setAttribute("data-theme", state.theme);
  if (refs.themeToggle) {
    refs.themeToggle.textContent = state.theme === "light" ? "다크 모드" : "라이트 모드";
    refs.themeToggle.setAttribute("aria-pressed", state.theme === "light" ? "true" : "false");
  }
  if (!persist) {
    return;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  } catch (_) {
    // Ignore storage errors.
  }
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

function renderMultiTimeframeFeaturedSection(rows) {
  if (!rows.length) {
    return "";
  }
  return `
    <section class="crypto-section">
      <div class="crypto-panel-head">
        <div>
          <strong>오버뷰 강력 추천 멀티 타임프레임</strong>
          <span>오버뷰에서 고른 8개 추천 코인을 멀티 타임프레임 규칙으로 다시 보여줍니다.</span>
        </div>
      </div>
      <div class="crypto-mtf-grid">
        ${rows.map((row) => renderMultiTimeframeCard(row, { featured: true })).join("")}
      </div>
    </section>
  `;
}

function renderMultiTimeframeCard(row, options = {}) {
  const featured = Boolean(options.featured);
  const featuredSlot = row.featured_slot || null;
  const displaySymbol = row.symbol || "후보 없음";
  const displayConsensus = row.missing ? "데이터 준비 중" : row.consensus_label;
  return `
    <article class="crypto-panel">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(displaySymbol)}</strong>
          <span>${escapeHtml(displayConsensus)} · 롱 ${escapeHtml(formatNumber(row.long_weight))} / 숏 ${escapeHtml(formatNumber(row.short_weight))}</span>
        </div>
      </div>
      ${
        featured && featuredSlot
          ? `<div class="crypto-chip-row">
              ${chip(`오버뷰 ${featuredSlot.timeframe_label || featuredSlot.timeframe || "-"}`)}
              ${badge(featuredSlot.side_label || "-", sideScore(featuredSlot.side))}
              ${chip(`기회 ${formatNumber(featuredSlot.opportunity)}`)}
            </div>`
          : ""
      }
      <div class="crypto-mtf-table">
        ${TIMEFRAMES.map((frame) => renderMultiTimeframeRow(frame, row.timeframes?.[frame.key])).join("")}
      </div>
    </article>
  `;
}

function renderMultiTimeframeCard(row, options = {}) {
  const featured = Boolean(options.featured);
  const featuredSlot = row.featured_slot || null;
  const sourceSlots = row.source_slots?.length ? row.source_slots : featuredSlot ? [featuredSlot] : [];
  const displaySymbol = row.symbol || "후보 없음";
  const displayConsensus = row.missing ? "데이터 준비 중" : row.consensus_label;

  return `
    <article class="crypto-panel">
      <div class="crypto-panel-head">
        <div>
          <strong>${escapeHtml(displaySymbol)}</strong>
          <span>${escapeHtml(displayConsensus)} · 롱 ${escapeHtml(formatNumber(row.long_weight))} / 숏 ${escapeHtml(formatNumber(row.short_weight))}</span>
        </div>
      </div>
      ${
        featured && sourceSlots.length
          ? `<div class="crypto-chip-row">
              ${sourceSlots
                .map(
                  (slot) => `
                    ${chip(`오버뷰 ${slot.timeframe_label || slot.timeframe || "-"}`)}
                    ${badge(slot.side_label || "-", sideScore(slot.side))}
                    ${chip(`기회 ${formatNumber(slot.opportunity)}`)}
                  `,
                )
                .join("")}
            </div>`
          : ""
      }
      <div class="crypto-mtf-table">
        ${TIMEFRAMES.map((frame) => renderMultiTimeframeRow(frame, row.timeframes?.[frame.key])).join("")}
      </div>
    </article>
  `;
}
