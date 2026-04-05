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
  statusLine: document.getElementById("status-line"),
  newsSections: document.getElementById("news-sections"),
  paginationNav: document.getElementById("pagination-nav"),
};

const RECENCY_OPTIONS = [
  { key: "all", label: "전체" },
  { key: "today", label: "오늘" },
  { key: "yesterday", label: "어제" },
  { key: "week", label: "7일" },
  { key: "older", label: "이전" },
  { key: "unknown", label: "시간 미상" },
];
const PAGE_SIZE = Math.max(1, Number.parseInt(payload.page_size || "25", 10) || 25);
const hubMap = Object.fromEntries((payload.hubs || []).map((entry) => [entry.key, entry]));
const categoryMap = Object.fromEntries((payload.categories || []).map((entry) => [entry.key, entry]));
const params = new URLSearchParams(window.location.search);

const state = {
  hub: params.get("hub") || "all",
  section: params.get("section") || params.get("category") || "all",
  recency: params.get("period") || "all",
  source: params.get("source") || "all",
  q: params.get("q") || "",
  page: parsePositiveInt(params.get("page"), 1),
};

if (!hubMap[state.hub] && state.hub !== "all") {
  state.hub = "all";
}
if (!RECENCY_OPTIONS.some((item) => item.key === state.recency)) {
  state.recency = "all";
}

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function parsePublishedAt(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTime(value) {
  const parsed = parsePublishedAt(value);
  if (!parsed) {
    return "시간 미상";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
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

function getSectionLabel(article) {
  return (
    article.section_label ||
    categoryMap[article.primary_category]?.label ||
    article.hub_label ||
    article.primary_category ||
    "뉴스"
  );
}

function getHubLabel(hubKey) {
  return hubMap[hubKey]?.label || "전체";
}

function getArticlesForCurrentScope() {
  return payload.articles.filter((article) => {
    if (state.hub !== "all" && article.hub !== state.hub) {
      return false;
    }
    if (state.section !== "all" && article.primary_category !== state.section) {
      return false;
    }
    if (state.source !== "all" && article.source_key !== state.source) {
      return false;
    }
    if (state.recency !== "all" && getArticleRecencyKey(article) !== state.recency) {
      return false;
    }
    if (state.q && !normalizeText(article.title).includes(normalizeText(state.q))) {
      return false;
    }
    return true;
  });
}

function getVisibleCategories() {
  if (state.hub === "all") {
    return payload.categories || [];
  }
  return (payload.categories || []).filter((entry) => entry.hub === state.hub);
}

function getVisibleSources() {
  const allowedCategories = new Set(getVisibleCategories().map((entry) => entry.key));
  return (payload.sources || []).filter((source) => {
    if (state.hub === "all") {
      return true;
    }
    return allowedCategories.has(source.primary_category);
  });
}

function renderRefreshStrip() {
  const generatedAt = parsePublishedAt(payload.generated_at);
  const ageMinutes = generatedAt
    ? Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60000))
    : null;
  const isFresh = ageMinutes !== null && ageMinutes <= 20;
  refs.refreshSpotlight.classList.toggle("is-fresh", Boolean(isFresh));
  refs.refreshLabel.textContent = isFresh ? "방금 갱신" : "최근 갱신";
  refs.refreshTitle.textContent = isFresh
    ? "새로 들어온 기사부터 바로 읽을 수 있도록 정렬했습니다."
    : "최근 수집된 기사 흐름을 기준으로 피드를 정렬했습니다.";
  refs.refreshTime.textContent = formatDateTime(payload.generated_at);
  refs.refreshTime.dateTime = payload.generated_at;
}

function renderHubFilters() {
  refs.hubFilters.innerHTML = [
    `
      <button type="button" class="hub-tab ${state.hub === "all" ? "is-active" : ""}" data-hub="all">
        전체
      </button>
    `,
    ...(payload.hubs || []).map(
      (hub) => `
        <button type="button" class="hub-tab ${hub.key === state.hub ? "is-active" : ""}" data-hub="${escapeHtml(hub.key)}">
          <span>${escapeHtml(hub.label)}</span>
          <strong>${hub.count}</strong>
        </button>
      `,
    ),
  ].join("");

  refs.hubFilters.querySelectorAll("[data-hub]").forEach((button) => {
    button.addEventListener("click", () => {
      state.hub = button.dataset.hub || "all";
      const categories = getVisibleCategories();
      if (
        state.section !== "all" &&
        !categories.some((entry) => entry.key === state.section)
      ) {
        state.section = "all";
      }
      state.page = 1;
      render();
    });
  });
}

function renderCategoryFilters() {
  const categories = getVisibleCategories();
  refs.categoryFilters.innerHTML = [
    `
      <button type="button" class="section-tab ${state.section === "all" ? "is-active" : ""}" data-section="all">
        전체
      </button>
    `,
    ...categories.map(
      (entry) => `
        <button type="button" class="section-tab ${entry.key === state.section ? "is-active" : ""}" data-section="${escapeHtml(entry.key)}">
          <span>${escapeHtml(entry.label)}</span>
          <strong>${entry.count}</strong>
        </button>
      `,
    ),
  ].join("");

  refs.categoryFilters.querySelectorAll("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      state.section = button.dataset.section || "all";
      if (state.section !== "all") {
        state.hub = categoryMap[state.section]?.hub || state.hub;
      }
      state.page = 1;
      render();
    });
  });
}

function renderRecencyFilters() {
  refs.recencyFilters.innerHTML = RECENCY_OPTIONS.map(
    (entry) => `
      <button type="button" class="filter-chip ${entry.key === state.recency ? "is-active" : ""}" data-recency="${entry.key}">
        ${escapeHtml(entry.label)}
      </button>
    `,
  ).join("");
  refs.recencyFilters.querySelectorAll("[data-recency]").forEach((button) => {
    button.addEventListener("click", () => {
      state.recency = button.dataset.recency || "all";
      state.page = 1;
      render();
    });
  });
}

function renderSourceOptions() {
  const visibleSources = getVisibleSources();
  refs.sourceSelect.innerHTML = [
    '<option value="all">모든 소스</option>',
    ...visibleSources.map(
      (source) => `
        <option value="${escapeHtml(source.source_key)}" ${state.source === source.source_key ? "selected" : ""}>
          ${escapeHtml(source.name)}
        </option>
      `,
    ),
  ].join("");
}

function buildStoryThumb(article, featured = false) {
  if (article.thumbnail_url) {
    return `
      <img src="${escapeHtml(article.thumbnail_url)}" alt="" loading="lazy" />
    `;
  }
  return `<span class="story-fallback">${escapeHtml(getSectionLabel(article))}</span>`;
}

function renderFeaturedStory(article) {
  return `
    <article class="featured-story-card">
      <a class="featured-story-thumb" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
        ${buildStoryThumb(article, true)}
      </a>
      <div class="featured-story-copy">
        <div class="story-meta-line">
          <span>${escapeHtml(getSectionLabel(article))}</span>
          <span>${escapeHtml(article.source_name)}</span>
          <span class="news-timestamp">${escapeHtml(formatDateTime(article.published_at))}</span>
        </div>
        <a class="news-title news-title-featured" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
          ${escapeHtml(article.title)}
        </a>
        <div class="story-actions">
          <a class="news-link" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(article.link_label || "원문 보기")}
          </a>
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="word" data-article-url="${escapeHtml(article.canonical_url)}">Word</button>
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="excel" data-article-url="${escapeHtml(article.canonical_url)}">Excel</button>
        </div>
      </div>
    </article>
  `;
}

function renderStoryRow(article) {
  return `
    <article class="news-row">
      <a class="story-thumb" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
        ${buildStoryThumb(article)}
      </a>
      <div class="story-copy">
        <div class="news-meta-line">
          <span>${escapeHtml(getSectionLabel(article))}</span>
          <span>${escapeHtml(article.source_name)}</span>
          <span class="news-timestamp">${escapeHtml(formatDateTime(article.published_at))}</span>
        </div>
        <a class="news-title" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
          ${escapeHtml(article.title)}
        </a>
        <div class="story-actions">
          <a class="news-link" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">
            ${escapeHtml(article.link_label || "원문 보기")}
          </a>
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="word" data-article-url="${escapeHtml(article.canonical_url)}">Word</button>
          <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="excel" data-article-url="${escapeHtml(article.canonical_url)}">Excel</button>
        </div>
      </div>
    </article>
  `;
}

function getPaginationMeta(totalItems) {
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  if (state.page > totalPages) {
    state.page = totalPages;
  }
  const start = (state.page - 1) * PAGE_SIZE;
  return {
    totalItems,
    totalPages,
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
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= totalPages - 2) {
    pages.add(totalPages - 1);
    pages.add(totalPages - 2);
    pages.add(totalPages - 3);
  }
  const tokens = [];
  let previous = null;
  [...pages]
    .filter((value) => value >= 1 && value <= totalPages)
    .sort((left, right) => left - right)
    .forEach((value) => {
      if (previous !== null && value - previous > 1) {
        tokens.push("ellipsis");
      }
      tokens.push(value);
      previous = value;
    });
  return tokens;
}

function renderPagination(pagination) {
  if (pagination.totalItems === 0 || pagination.totalPages <= 1) {
    refs.paginationNav.hidden = true;
    refs.paginationNav.innerHTML = "";
    return;
  }

  refs.paginationNav.hidden = false;
  refs.paginationNav.innerHTML = "";
  if (state.page > 1) {
    refs.paginationNav.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="pagination-chip pagination-step" data-page="${state.page - 1}">이전</button>`,
    );
  }
  getPageTokens(pagination.totalPages, state.page).forEach((token) => {
    if (token === "ellipsis") {
      refs.paginationNav.insertAdjacentHTML(
        "beforeend",
        '<span class="pagination-chip pagination-ellipsis">…</span>',
      );
      return;
    }
    refs.paginationNav.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="pagination-chip ${token === state.page ? "is-active" : ""}" data-page="${token}">${token}</button>`,
    );
  });
  if (state.page < pagination.totalPages) {
    refs.paginationNav.insertAdjacentHTML(
      "beforeend",
      `<button type="button" class="pagination-chip pagination-step" data-page="${state.page + 1}">다음</button>`,
    );
  }
}

function renderFeed() {
  const filteredArticles = getArticlesForCurrentScope();
  const pagination = getPaginationMeta(filteredArticles.length);
  const pageArticles = filteredArticles.slice(pagination.start, pagination.end);
  const featured = pageArticles[0] || null;
  const rest = pageArticles.slice(1);

  if (!featured) {
    refs.newsSections.innerHTML = '<div class="empty-state">조건에 맞는 기사가 없습니다.</div>';
    refs.statusLine.textContent = "선택한 조건에 맞는 기사가 없습니다.";
    renderPagination(pagination);
    return;
  }

  refs.statusLine.textContent = `${getHubLabel(state.hub)} 피드에서 ${filteredArticles.length}개의 기사를 찾았습니다.`;
  refs.newsSections.innerHTML = `
    ${renderFeaturedStory(featured)}
    <div class="news-list">
      ${rest.map((article) => renderStoryRow(article)).join("")}
    </div>
  `;
  renderPagination(pagination);
}

function syncUrl() {
  const url = new URL(window.location.href);
  const updates = {
    hub: state.hub,
    section: state.section,
    period: state.recency,
    source: state.source,
    q: state.q,
    page: String(state.page),
  };

  Object.entries(updates).forEach(([key, value]) => {
    if (!value || value === "all" || (key === "page" && value === "1")) {
      url.searchParams.delete(key);
      return;
    }
    url.searchParams.set(key, value);
  });
  window.history.replaceState({}, "", url);
}

async function copyCurrentView() {
  const rows = Array.from(refs.newsSections.querySelectorAll(".featured-story-card, .news-row"));
  const lines = rows.flatMap((row) => {
    const title = row.querySelector(".news-title")?.textContent?.trim() || "";
    const link = row.querySelector(".news-link")?.getAttribute("href") || "";
    const meta = row.querySelector(".news-meta-line, .story-meta-line")?.textContent?.trim() || "";
    return [title, meta, link, ""].filter(Boolean);
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
  return getArticlesForCurrentScope();
}

function buildExportMeta(article) {
  return {
    hub: article.hub_label || getHubLabel(article.hub),
    category: getSectionLabel(article),
    source: article.source_name,
    publishedAt: formatDateTime(article.published_at),
    title: article.title,
    url: article.canonical_url,
  };
}

function buildWordHtml(articles, title) {
  return `
    <html>
      <head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${articles
          .map((article) => {
            const item = buildExportMeta(article);
            return `
              <section style="margin-bottom:18px;">
                <h2 style="margin:0 0 8px;font-size:16px;">${escapeHtml(item.title)}</h2>
                <p style="margin:0 0 4px;"><strong>허브:</strong> ${escapeHtml(item.hub)}</p>
                <p style="margin:0 0 4px;"><strong>섹션:</strong> ${escapeHtml(item.category)}</p>
                <p style="margin:0 0 4px;"><strong>소스:</strong> ${escapeHtml(item.source)}</p>
                <p style="margin:0 0 4px;"><strong>시간:</strong> ${escapeHtml(item.publishedAt)}</p>
                <p style="margin:0;"><strong>링크:</strong> <a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
              </section>
            `;
          })
          .join("")}
      </body>
    </html>
  `;
}

function buildExcelHtml(articles, title) {
  return `
    <html>
      <head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
      <body>
        <table border="1">
          <caption>${escapeHtml(title)}</caption>
          <thead>
            <tr>
              <th>허브</th>
              <th>섹션</th>
              <th>소스</th>
              <th>시간</th>
              <th>제목</th>
              <th>링크</th>
            </tr>
          </thead>
          <tbody>
            ${articles
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
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function buildExportTitle(scope, format, articleUrl) {
  if (scope === "single") {
    const article = payload.articles.find((item) => item.canonical_url === articleUrl);
    return article ? `${article.title} (${format})` : `newsbot-${format}`;
  }
  return `newsbot-${state.hub}-${state.section}-${format}`;
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
    refs.copyAllButton.textContent = "현재 화면 복사";
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

function render() {
  renderRefreshStrip();
  renderHubFilters();
  renderCategoryFilters();
  renderRecencyFilters();
  renderSourceOptions();
  refs.searchInput.value = state.q;
  renderFeed();
  syncUrl();
}

refs.sourceSelect.addEventListener("change", (event) => {
  state.source = event.target.value || "all";
  state.page = 1;
  render();
});

refs.searchInput.addEventListener("input", (event) => {
  state.q = event.target.value || "";
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
  flashButtonState(refs.exportWordButton, ok ? "저장 완료" : "내보낼 기사 없음", ok ? "done" : "error");
});

refs.exportExcelButton.addEventListener("click", () => {
  const ok = exportArticles("current", "excel");
  flashButtonState(refs.exportExcelButton, ok ? "저장 완료" : "내보낼 기사 없음", ok ? "done" : "error");
});

refs.newsSections.addEventListener("click", (event) => {
  const button = event.target.closest(".mini-export-button");
  if (!button) {
    return;
  }
  const format = button.dataset.exportFormat;
  const articleUrl = button.dataset.articleUrl || "";
  const ok = exportArticles("single", format, articleUrl);
  flashButtonState(button, ok ? "완료" : "없음", ok ? "done" : "error");
});

refs.paginationNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
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
