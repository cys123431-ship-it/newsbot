const payload = JSON.parse(document.getElementById("site-data").textContent);

const refs = {
  hubChooser: document.getElementById("news-hub-chooser"),
  newsContentShell: document.getElementById("news-content-shell"),
  hubFilters: document.getElementById("hub-filters"),
  categoryFilters: document.getElementById("category-filters"),
  recencyFilters: document.getElementById("recency-filters"),
  sourceSelect: document.getElementById("source-select"),
  searchInput: document.getElementById("search-input"),
  resetButton: document.getElementById("reset-button"),
  copyAllButton: document.getElementById("copy-all-button"),
  exportWordButton: document.getElementById("export-word-button"),
  exportExcelButton: document.getElementById("export-excel-button"),
  refreshSpotlight: document.getElementById("refresh-spotlight"),
  refreshLabel: document.getElementById("refresh-label"),
  refreshTitle: document.getElementById("refresh-title"),
  refreshTime: document.getElementById("refresh-time"),
  hubKicker: document.getElementById("hub-kicker"),
  hubTitle: document.getElementById("hub-title"),
  hubDescription: document.getElementById("hub-description"),
  hubCountChip: document.getElementById("hub-count-chip"),
  hubRangeChip: document.getElementById("hub-range-chip"),
  statusLine: document.getElementById("status-line"),
  newsSections: document.getElementById("news-sections"),
  paginationNav: document.getElementById("pagination-nav"),
};

const hubs = payload.hubs || [];
const categories = payload.categories || [];
const hubMap = Object.fromEntries(hubs.map((entry) => [entry.key, entry]));
const categoryMap = Object.fromEntries(categories.map((entry) => [entry.key, entry]));
const categoryLabels = Object.fromEntries(
  categories.map((entry) => [entry.key, entry.label]),
);
const RECENCY_OPTIONS = [
  { key: "all", label: "All time" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "older", label: "Earlier" },
  { key: "unknown", label: "Unknown time" },
];
const ENTRY_HUB_ORDER = ["kr", "us", "global"];
const ENTRY_HUB_LABELS = {
  kr: "Korea News",
  us: "US News",
  global: "Global News",
};
const ENTRY_HUB_DESCRIPTIONS = {
  kr: "A faster way to scan major domestic headlines first.",
  us: "US economy, technology, and market stories in one flow.",
  global: "Global macro and international headlines in one place.",
};

const PAGE_SIZE = Math.max(1, Number.parseInt(payload.page_size || "25", 10) || 25);
const RECENCY_COPY = RECENCY_OPTIONS;
const ENTRY_HUB_COPY = {
  kr: {
    label: "Korea News",
    description: "A faster way to scan major domestic headlines first.",
  },
  us: {
    label: "US News",
    description: "US economy, technology, and market stories in one flow.",
  },
  global: {
    label: "Global News",
    description: "Global macro and international headlines in one place.",
  },
};

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inferHubForSection(sectionKey) {
  if (!sectionKey || sectionKey === "all") {
    return "all";
  }
  return categoryMap[sectionKey]?.hub || "global";
}

const params = new URLSearchParams(window.location.search);
const incomingSection = params.get("section") || params.get("category") || "all";
const incomingHub = params.get("hub") || inferHubForSection(incomingSection);
const state = {
  hub: incomingHub,
  section: incomingSection,
  recency: params.get("period") || "all",
  source: params.get("source") || "all",
  q: params.get("q") || "",
  page: parsePositiveInt(params.get("page"), 1),
};

if (state.section !== "all" && state.hub === "all") {
  state.hub = inferHubForSection(state.section);
}
if (!RECENCY_OPTIONS.some((entry) => entry.key === state.recency)) {
  state.recency = "all";
}

function isChooserMode() {
  return state.hub === "all";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function getStartOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function getStartOfWeek(date) {
  const next = getStartOfDay(date);
  const day = next.getDay();
  const diff = day === 0 ? 6 : day - 1;
  next.setDate(next.getDate() - diff);
  return next;
}

function parsePublishedAt(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getArticleRecencyKey(article) {
  const publishedAt = parsePublishedAt(article.published_at);
  if (!publishedAt) {
    return "unknown";
  }

  const now = new Date();
  const startToday = getStartOfDay(now);
  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);
  const startWeek = getStartOfWeek(now);

  if (publishedAt >= startToday && publishedAt < startTomorrow) {
    return "today";
  }
  if (publishedAt >= startYesterday && publishedAt < startToday) {
    return "yesterday";
  }
  if (publishedAt >= startWeek) {
    return "week";
  }
  return "older";
}

function getRecencyLabel(key) {
  return RECENCY_COPY.find((entry) => entry.key === key)?.label || "전체 기간";
}

function formatRefreshTimestamp(timestamp) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function formatPublishedAt(timestamp) {
  const parsed = parsePublishedAt(timestamp);
  if (!parsed) {
    return "시간 미상";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function getHubEntryDescription(hub) {
  if (!hub) {
    return "허브를 선택하면 해당 범위의 섹션과 헤드라인으로 바로 이동합니다.";
  }
  return hub.description || ENTRY_HUB_COPY[hub.key]?.description || getHubDescription(hub.key);
}

function getHubEntryRefreshHint() {
  return `마지막 갱신 ${formatRefreshTimestamp(payload.generated_at)}`;
}

function getArticleLinkLabel(article) {
  return article.link_label || article.canonical_url;
}

function renderArticleCard(article) {
  const sectionLabel =
    article.section_label || categoryLabels[article.primary_category] || article.primary_category;
  const timestampLabel = formatPublishedAt(article.published_at);
  const timestampHtml = article.published_at
    ? `<time class="news-timestamp" datetime="${escapeHtml(article.published_at)}">${escapeHtml(timestampLabel)}</time>`
    : '<span class="news-timestamp">시간 미상</span>';

  return `
    <article class="news-row">
      <div class="news-card-main">
        <a class="news-title" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(article.title)}</a>
        <p class="news-meta-line">
          <span>${escapeHtml(article.source_name)}</span>
          <span>${escapeHtml(sectionLabel)}</span>
        </p>
        <p class="news-time-line">
          <span class="news-recency-badge">${escapeHtml(getRecencyLabel(getArticleRecencyKey(article)))}</span>
          ${timestampHtml}
        </p>
      </div>
      <div class="news-card-footer">
        <div class="news-supporting">
          <span class="news-link-label">원문</span>
          <a class="news-link" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(getArticleLinkLabel(article))}</a>
        </div>
        <div class="row-actions">
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="word" data-article-url="${escapeHtml(article.canonical_url)}">Word</button>
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="excel" data-article-url="${escapeHtml(article.canonical_url)}">Excel</button>
        </div>
      </div>
    </article>
  `;
}

function renderRefreshSpotlight() {
  const generatedAt = new Date(payload.generated_at);
  const ageMinutes = Number.isNaN(generatedAt.getTime())
    ? null
    : Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60000));
  const isFresh = ageMinutes !== null && ageMinutes <= 20;

  refs.refreshSpotlight.classList.toggle("is-fresh", Boolean(isFresh));
  refs.refreshSpotlight.classList.toggle("is-stale", !isFresh);
  refs.refreshLabel.textContent = isFresh ? "방금 갱신" : "최근 갱신";
  refs.refreshTitle.textContent = isFresh
    ? "방금 반영된 기사 묶음을 먼저 확인해보세요."
    : "최근 갱신 기준으로 정리된 기사 묶음을 보고 있습니다.";
  refs.refreshTime.textContent = formatRefreshTimestamp(payload.generated_at);
  refs.refreshTime.dateTime = payload.generated_at;
}

function getSectionsForHub(hubKey) {
  if (hubKey === "all") {
    return [];
  }
  return categories.filter((entry) => entry.hub === hubKey);
}

function getHubTitle(hubKey) {
  if (hubKey === "all") {
    return "전체 허브";
  }
  return hubMap[hubKey]?.label || hubKey;
}

function getHubDescription(hubKey) {
  if (hubKey === "all") {
    return "한국, 미국, 글로벌 허브를 한 번에 보고 바로 원하는 섹션으로 좁혀갈 수 있습니다.";
  }
  return (
    hubMap[hubKey]?.description ||
    "선택한 허브 안에서 세부 섹션과 발행처를 좁혀 기사를 탐색할 수 있습니다."
  );
}

function articleMatchesScope(article) {
  if (state.hub !== "all" && article.hub !== state.hub) {
    return false;
  }
  if (state.section !== "all" && article.primary_category !== state.section) {
    return false;
  }
  return true;
}

function articleMatchesSourceAndQuery(article) {
  if (state.source !== "all" && article.source_key !== state.source) {
    return false;
  }
  const query = normalize(state.q);
  if (!query) {
    return true;
  }
  return normalize(article.title).includes(query);
}

function articleMatchesRecency(article) {
  if (state.recency === "all") {
    return true;
  }
  return getArticleRecencyKey(article) === state.recency;
}

function getFilteredArticles() {
  return payload.articles.filter((article) => {
    return (
      articleMatchesScope(article) &&
      articleMatchesSourceAndQuery(article) &&
      articleMatchesRecency(article)
    );
  });
}

function getSourceAndQueryFilteredArticles() {
  return payload.articles.filter((article) => {
    return articleMatchesSourceAndQuery(article);
  });
}

function getScopedSourceAndQueryFilteredArticles() {
  return payload.articles.filter((article) => {
    return articleMatchesScope(article) && articleMatchesSourceAndQuery(article);
  });
}

function groupArticles(articles) {
  if (!articles.length) {
    return [];
  }

  if (state.section !== "all") {
    const category = categoryMap[state.section];
    return [
      {
        key: state.section,
        label: category?.label || state.section,
        eyebrow: getHubTitle(category?.hub || state.hub),
        articles,
      },
    ];
  }

  if (state.hub !== "all") {
    return getSectionsForHub(state.hub)
      .map((category) => ({
        key: category.key,
        label: category.label,
        eyebrow: getHubTitle(state.hub),
        articles: articles.filter((article) => article.primary_category === category.key),
      }))
      .filter((group) => group.articles.length > 0);
  }

  return hubs
    .map((hub) => ({
      key: hub.key,
      label: hub.label,
      eyebrow: "허브",
      articles: articles.filter((article) => article.hub === hub.key),
    }))
    .filter((group) => group.articles.length > 0);
}

function syncUrl() {
  const nextParams = new URLSearchParams();
  if (state.hub !== "all") {
    nextParams.set("hub", state.hub);
  }
  if (state.section !== "all") {
    nextParams.set("section", state.section);
  }
  if (state.recency !== "all") {
    nextParams.set("period", state.recency);
  }
  if (state.source !== "all") {
    nextParams.set("source", state.source);
  }
  if (state.q.trim()) {
    nextParams.set("q", state.q.trim());
  }
  if (state.page > 1) {
    nextParams.set("page", String(state.page));
  }
  const nextQuery = nextParams.toString();
  const nextUrl = nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname;
  window.history.replaceState({}, "", nextUrl);
}

function createPillButton({ datasetKey, datasetValue, label, count, active, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pill${active ? " is-active" : ""}`;
  button.setAttribute("aria-pressed", active ? "true" : "false");
  button.dataset[datasetKey] = datasetValue;
  if (typeof count === "number") {
    button.innerHTML = `${escapeHtml(label)} <span>${count}</span>`;
  } else {
    button.textContent = label;
  }
  button.addEventListener("click", onClick);
  return button;
}

function renderHubChooser() {
  const chooserHubs = ENTRY_HUB_ORDER
    .map((key) => hubMap[key])
    .filter(Boolean);

  refs.hubChooser.innerHTML = `
    <section class="news-entry-panel">
      <div class="news-entry-copy">
        <p class="news-entry-kicker">Entry point</p>
        <h2>어디 뉴스부터 볼까요?</h2>
        <p>가장 먼저 허브를 고르면, 그 범위에 맞는 섹션과 헤드라인만 다시 정리해서 보여줍니다.</p>
      </div>
      <div class="news-entry-grid">
        ${chooserHubs
          .map(
            (hub) => `
              <button type="button" class="news-entry-button" data-entry-hub="${escapeHtml(hub.key)}">
                <div class="news-entry-header">
                  <span class="news-entry-label">뉴스 허브</span>
                  <span class="news-entry-arrow" aria-hidden="true">→</span>
                </div>
                <div class="news-entry-body">
                  <strong>${escapeHtml(ENTRY_HUB_COPY[hub.key]?.label || hub.label)}</strong>
                  <p class="news-entry-description">${escapeHtml(getHubEntryDescription(hub))}</p>
                </div>
                <div class="news-entry-meta">
                  <span class="news-entry-count">기사 ${escapeHtml(String(hub.count || 0))}건</span>
                  <span class="news-entry-refresh">${escapeHtml(getHubEntryRefreshHint())}</span>
                </div>
                <div class="news-entry-cta">
                  <span class="news-entry-action">바로 보기</span>
                  <span class="news-entry-cta-copy">첫 화면부터 이 허브 기준으로 시작</span>
                </div>
              </button>
            `,
          )
          .join("")}
      </div>
    </section>
  `;

  refs.hubChooser.querySelectorAll("[data-entry-hub]").forEach((button) => {
    button.addEventListener("click", () => {
      state.hub = button.getAttribute("data-entry-hub") || "all";
      state.section = "all";
      state.recency = "all";
      state.source = "all";
      state.q = "";
      state.page = 1;
      render();
    });
  });
}

function renderHubFilters() {
  refs.hubFilters.innerHTML = "";
  if (isChooserMode()) {
    return;
  }

  refs.hubFilters.appendChild(
    createPillButton({
      datasetKey: "hubAction",
      datasetValue: "chooser",
      label: "허브 다시 선택",
      active: false,
      onClick: () => {
        state.hub = "all";
        state.section = "all";
        state.recency = "all";
        state.source = "all";
        state.q = "";
        state.page = 1;
        render();
      },
    }),
  );

  refs.hubFilters.appendChild(
    createPillButton({
      datasetKey: "hub",
      datasetValue: state.hub,
      label: ENTRY_HUB_COPY[state.hub]?.label || getHubTitle(state.hub),
      count: getSourceAndQueryFilteredArticles().filter((article) => article.hub === state.hub).length,
      active: true,
      onClick: () => {},
    }),
  );
}

function renderCategoryFilters() {
  const visibleSections = getSectionsForHub(state.hub);
  const counts = new Map(visibleSections.map((category) => [category.key, 0]));
  const scopedArticles = getSourceAndQueryFilteredArticles().filter((article) => {
    if (state.hub === "all") {
      return true;
    }
    return article.hub === state.hub;
  });
  scopedArticles.forEach((article) => {
    if (counts.has(article.primary_category)) {
      counts.set(article.primary_category, (counts.get(article.primary_category) || 0) + 1);
    }
  });

  refs.categoryFilters.innerHTML = "";
  refs.categoryFilters.appendChild(
    createPillButton({
      datasetKey: "category",
      datasetValue: "all",
      label: state.hub === "all" ? "허브를 먼저 고르세요" : "전체 섹션",
      count: state.hub === "all" ? undefined : scopedArticles.length,
      active: state.section === "all",
      onClick: () => {
        state.section = "all";
        state.page = 1;
        render();
      },
    }),
  );

  refs.categoryFilters.classList.toggle("is-disabled", state.hub === "all");
  visibleSections.forEach((category) => {
    refs.categoryFilters.appendChild(
      createPillButton({
        datasetKey: "category",
        datasetValue: category.key,
        label: category.label,
        count: counts.get(category.key) || 0,
        active: state.section === category.key,
        onClick: () => {
          state.section = category.key;
          state.page = 1;
          render();
        },
      }),
    );
  });
}

function renderRecencyFilters() {
  const counts = new Map(RECENCY_COPY.map((entry) => [entry.key, 0]));
  getScopedSourceAndQueryFilteredArticles().forEach((article) => {
    const recencyKey = getArticleRecencyKey(article);
    counts.set(recencyKey, (counts.get(recencyKey) || 0) + 1);
  });
  counts.set(
    "all",
    Array.from(counts.entries())
      .filter(([key]) => key !== "all")
      .reduce((sum, [, count]) => sum + count, 0),
  );

  refs.recencyFilters.innerHTML = "";
  RECENCY_COPY.forEach((option) => {
    refs.recencyFilters.appendChild(
      createPillButton({
        datasetKey: "recency",
        datasetValue: option.key,
        label: option.label,
        count: counts.get(option.key) || 0,
        active: state.recency === option.key,
        onClick: () => {
          state.recency = option.key;
          state.page = 1;
          render();
        },
      }),
    );
  });
}

function renderHubHero(articles) {
  if (isChooserMode()) {
    refs.hubKicker.textContent = "첫 화면";
    refs.hubTitle.textContent = "뉴스 범위 선택";
    refs.hubDescription.textContent =
      "한국 뉴스, 미국 뉴스, 글로벌 뉴스 중 하나를 먼저 고르고 그다음 세부 섹션과 기사 목록으로 이동하세요.";
    refs.hubCountChip.textContent = `기사 ${payload.article_count || payload.articles.length}건`;
    refs.hubRangeChip.textContent = "한국 · 미국 · 글로벌";
    return;
  }

  const hubTitle = getHubTitle(state.hub);
  const category = state.section !== "all" ? categoryMap[state.section] : null;

  refs.hubKicker.textContent = state.section !== "all" ? "세부 섹션" : "뉴스 허브";
  refs.hubTitle.textContent = category ? `${hubTitle} · ${category.label}` : hubTitle;
  refs.hubDescription.textContent = category
    ? `${hubTitle} 허브 안에서 ${category.label} 기사만 모아 최신순으로 정리했습니다.`
    : getHubDescription(state.hub);
  refs.hubCountChip.textContent = `기사 ${articles.length}건`;
  refs.hubRangeChip.textContent =
    state.hub === "all"
      ? "한국 · 미국 · 글로벌 전체 범위"
      : `${hubTitle} 허브 탐색`;
}

function renderSourceOptions() {
  const currentValue = state.source;
  refs.sourceSelect.innerHTML = '<option value="all">모든 소스</option>';

  payload.sources
    .filter((source) => {
      if (state.hub !== "all" && source.hub !== state.hub) {
        return false;
      }
      if (state.section !== "all" && source.category !== state.section) {
        return false;
      }
      return true;
    })
    .forEach((source) => {
      const option = document.createElement("option");
      option.value = source.source_key;
      option.textContent = `${source.name} (${source.count})`;
      refs.sourceSelect.appendChild(option);
    });

  const availableValues = new Set(
    Array.from(refs.sourceSelect.options).map((option) => option.value),
  );
  if (!availableValues.has(currentValue)) {
    state.source = "all";
  }
  refs.sourceSelect.value = state.source;
}

function getPaginationMeta(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  state.page = Math.min(Math.max(state.page, 1), totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  return {
    page: state.page,
    totalPages,
    totalItems,
    start,
    end: start + PAGE_SIZE,
  };
}

function getPageTokens(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 3) {
    [2, 3, 4].forEach((page) => pages.add(page));
  }
  if (currentPage >= totalPages - 2) {
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page));
  }
  const tokens = [];
  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);
  sortedPages.forEach((page) => {
    const previousPage = tokens[tokens.length - 1];
    if (typeof previousPage === "number" && page - previousPage > 1) {
      tokens.push("ellipsis");
    }
    tokens.push(page);
  });
  return tokens;
}

function renderStatusLine(articles, pagination) {
  const pieces = [];
  pieces.push(getHubTitle(state.hub));
  if (state.section !== "all") {
    pieces.push(categoryLabels[state.section] || state.section);
  }
  if (state.source !== "all") {
    const source = payload.sources.find((entry) => entry.source_key === state.source);
    if (source) {
      pieces.push(source.name);
    }
  }
  if (state.recency !== "all") {
    pieces.push(getRecencyLabel(state.recency));
  }
  if (state.q.trim()) {
    pieces.push(`검색어 "${state.q.trim()}"`);
  }
  refs.statusLine.textContent =
    `${pieces.join(" · ")} · ${articles.length}건 · ${pagination.page}/${pagination.totalPages} 페이지`;
}

function createPageButton(label, page, active = false, step = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pagination-chip${active ? " is-active" : ""}${step ? " is-step" : ""}`;
  button.textContent = label;
  button.dataset.page = String(page);
  return button;
}

function renderPagination(pagination) {
  if (pagination.totalItems === 0 || pagination.totalPages <= 1) {
    refs.paginationNav.innerHTML = "";
    refs.paginationNav.hidden = true;
    return;
  }

  refs.paginationNav.hidden = false;
  refs.paginationNav.innerHTML = "";
  if (pagination.page > 1) {
    refs.paginationNav.appendChild(createPageButton("이전", pagination.page - 1, false, true));
  }
  getPageTokens(pagination.totalPages, pagination.page).forEach((token) => {
    if (token === "ellipsis") {
      const marker = document.createElement("span");
      marker.className = "pagination-chip pagination-ellipsis";
      marker.textContent = "…";
      refs.paginationNav.appendChild(marker);
      return;
    }
    refs.paginationNav.appendChild(createPageButton(String(token), token, token === pagination.page));
  });
  if (pagination.page < pagination.totalPages) {
    refs.paginationNav.appendChild(createPageButton("다음", pagination.page + 1, false, true));
  }
}

function renderSections(articles) {
  const groups = groupArticles(articles);
  if (!groups.length) {
    refs.newsSections.innerHTML = '<div class="empty-state">조건에 맞는 뉴스가 없습니다.</div>';
    return;
  }
  refs.newsSections.innerHTML = groups
    .map(
      (group) => `
        <section class="news-section" data-category="${escapeHtml(group.key)}">
          <div class="section-head">
            <div>
              <p class="section-kicker">${escapeHtml(group.eyebrow || "섹션")}</p>
              <h2>${escapeHtml(group.label)}</h2>
            </div>
            <span>${group.articles.length}건</span>
          </div>
          <div class="news-list">
            ${group.articles
              .map((article) => renderArticleCard(article))
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function render() {
  renderRefreshSpotlight();
  renderHubChooser();
  refs.hubChooser.hidden = !isChooserMode();
  refs.newsContentShell.hidden = isChooserMode();
  renderHubFilters();
  renderCategoryFilters();
  renderRecencyFilters();
  renderSourceOptions();
  refs.searchInput.value = state.q;
  const articles = getFilteredArticles();
  const pagination = getPaginationMeta(articles.length);
  syncUrl();
  renderHubHero(articles);
  if (isChooserMode()) {
    refs.statusLine.textContent = "허브를 고르면 세부 섹션과 기사 목록이 바로 열립니다.";
    refs.newsSections.innerHTML = "";
    refs.paginationNav.innerHTML = "";
    refs.paginationNav.hidden = true;
    return;
  }
  renderStatusLine(articles, pagination);
  renderSections(articles.slice(pagination.start, pagination.end));
  renderPagination(pagination);
}

async function copyCurrentView() {
  const sections = Array.from(refs.newsSections.querySelectorAll(".news-section"));
  const lines = [];

  sections.forEach((section) => {
    const titleNode = section.querySelector(".section-head h2");
    const rowNodes = Array.from(section.querySelectorAll(".news-row"));
    if (!titleNode || !rowNodes.length) {
      return;
    }
    lines.push(titleNode.textContent.trim());
    rowNodes.forEach((row) => {
      const newsTitle = row.querySelector(".news-title")?.textContent?.trim() || "";
      const newsLinkNode = row.querySelector(".news-link");
      const newsLink =
        newsLinkNode?.getAttribute("href")?.trim() ||
        newsLinkNode?.textContent?.trim() ||
        "";
      if (newsTitle) {
        lines.push(newsTitle);
      }
      if (newsLink) {
        lines.push(newsLink);
      }
      lines.push("");
    });
  });

  const text = lines.join("\n").trim();
  if (!text) {
    setCopyButtonState("복사할 뉴스 없음", "error");
    return;
  }

  try {
    await writeClipboardText(text);
    setCopyButtonState("복사 완료", "done");
  } catch (error) {
    console.error(error);
    setCopyButtonState("복사 실패", "error");
  }
}

function getExportArticles(scope, articleUrl) {
  if (scope === "single") {
    return payload.articles.filter((article) => article.canonical_url === articleUrl);
  }
  return getFilteredArticles();
}

function buildExportMeta(article) {
  return {
    category: article.section_label || categoryLabels[article.primary_category] || article.primary_category,
    hub: article.hub_label || getHubTitle(article.hub),
    source: article.source_name,
    publishedAt: article.published_at || "",
    title: article.title,
    url: article.canonical_url,
  };
}

function buildWordHtml(articles, title) {
  const rows = articles
    .map((article) => {
      const item = buildExportMeta(article);
      return `
        <div style="margin-bottom:18px;">
          <h3 style="margin:0 0 8px 0; font-size:16px;">${escapeHtml(item.title)}</h3>
          <p style="margin:0 0 4px 0;"><strong>허브:</strong> ${escapeHtml(item.hub)}</p>
          <p style="margin:0 0 4px 0;"><strong>카테고리:</strong> ${escapeHtml(item.category)}</p>
          <p style="margin:0 0 4px 0;"><strong>소스:</strong> ${escapeHtml(item.source)}</p>
          <p style="margin:0 0 4px 0;"><strong>업데이트:</strong> ${escapeHtml(item.publishedAt)}</p>
          <p style="margin:0;"><strong>링크:</strong> <a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
        </div>
      `;
    })
    .join("");
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${rows}
      </body>
    </html>
  `;
}

function buildExcelHtml(articles, title) {
  const rows = articles
    .map((article) => {
      const item = buildExportMeta(article);
      return `
        <tr>
          <td>${escapeHtml(item.hub)}</td>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.source)}</td>
          <td>${escapeHtml(item.publishedAt)}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.url)}</td>
        </tr>
      `;
    })
    .join("");
  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
      </head>
      <body>
        <table border="1">
          <caption>${escapeHtml(title)}</caption>
          <thead>
            <tr>
              <th>허브</th>
              <th>카테고리</th>
              <th>소스</th>
              <th>게시 시각</th>
              <th>제목</th>
              <th>링크</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function buildExportTitle(scope, format, articleUrl) {
  if (scope === "single") {
    const article = payload.articles.find((item) => item.canonical_url === articleUrl);
    return article ? `${article.title} (${format})` : `newsbot article (${format})`;
  }
  const hubPart = state.hub === "all" ? "all" : state.hub;
  const sectionPart = state.section === "all" ? "all" : state.section;
  const sourcePart = state.source === "all" ? "all" : state.source;
  return `newsbot-${hubPart}-${sectionPart}-${sourcePart}-${format}`;
}

function sanitizeFilename(value, extension) {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${sanitized || "newsbot-export"}.${extension}`;
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob(["\ufeff", content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportArticles(scope, format, articleUrl = "") {
  const articles = getExportArticles(scope, articleUrl);
  if (!articles.length) {
    return false;
  }
  const title = buildExportTitle(scope, format, articleUrl);
  if (format === "word") {
    downloadFile(
      sanitizeFilename(title, "doc"),
      buildWordHtml(articles, title),
      "application/msword;charset=utf-8",
    );
    return true;
  }
  downloadFile(
    sanitizeFilename(title, "xls"),
    buildExcelHtml(articles, title),
    "application/vnd.ms-excel;charset=utf-8",
  );
  return true;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

let copyButtonResetTimer;

function setCopyButtonState(label, stateName) {
  refs.copyAllButton.textContent = label;
  refs.copyAllButton.classList.remove("is-done", "is-error");
  if (stateName === "done") {
    refs.copyAllButton.classList.add("is-done");
  }
  if (stateName === "error") {
    refs.copyAllButton.classList.add("is-error");
  }
  window.clearTimeout(copyButtonResetTimer);
  copyButtonResetTimer = window.setTimeout(() => {
    refs.copyAllButton.textContent = "현재 화면 전체 복사";
    refs.copyAllButton.classList.remove("is-done", "is-error");
  }, 2200);
}

function flashButtonState(button, label, stateName) {
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;
  button.textContent = label;
  button.classList.remove("is-done", "is-error");
  if (stateName === "done") {
    button.classList.add("is-done");
  }
  if (stateName === "error") {
    button.classList.add("is-error");
  }
  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.classList.remove("is-done", "is-error");
  }, 1800);
}

refs.sourceSelect.addEventListener("change", (event) => {
  state.source = event.target.value;
  state.page = 1;
  render();
});

refs.searchInput.addEventListener("input", (event) => {
  state.q = event.target.value;
  state.page = 1;
  render();
});

refs.resetButton.addEventListener("click", () => {
  state.hub = "all";
  state.section = "all";
  state.recency = "all";
  state.source = "all";
  state.q = "";
  state.page = 1;
  render();
});

refs.copyAllButton.addEventListener("click", () => {
  void copyCurrentView();
});

refs.exportWordButton.addEventListener("click", () => {
  const ok = exportArticles("current", "word");
  flashButtonState(refs.exportWordButton, ok ? "내보내기 완료" : "내보낼 뉴스 없음", ok ? "done" : "error");
});

refs.exportExcelButton.addEventListener("click", () => {
  const ok = exportArticles("current", "excel");
  flashButtonState(refs.exportExcelButton, ok ? "내보내기 완료" : "내보낼 뉴스 없음", ok ? "done" : "error");
});

refs.newsSections.addEventListener("click", (event) => {
  const button = event.target.closest(".mini-export-button");
  if (!button) {
    return;
  }
  const format = button.dataset.exportFormat;
  const articleUrl = button.dataset.articleUrl || "";
  const ok = exportArticles("single", format, articleUrl);
  flashButtonState(button, ok ? "?꾨즺" : "?놁쓬", ok ? "done" : "error");
});

refs.paginationNav?.addEventListener("click", (event) => {
  const button = event.target.closest(".pagination-chip");
  if (!button) {
    return;
  }
  const nextPage = parsePositiveInt(button.dataset.page, state.page);
  if (nextPage === state.page) {
    return;
  }
  state.page = nextPage;
  render();
  refs.paginationNav.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

render();






