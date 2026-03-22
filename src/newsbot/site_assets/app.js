const payload = JSON.parse(document.getElementById("site-data").textContent);

const refs = {
  categoryFilters: document.getElementById("category-filters"),
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

const categoryLabels = Object.fromEntries(
  payload.categories.map((entry) => [entry.key, entry.label]),
);

const PAGE_SIZE = Math.max(1, Number.parseInt(payload.page_size || "25", 10) || 25);

function parsePositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const params = new URLSearchParams(window.location.search);
const state = {
  category: params.get("category") || "all",
  source: params.get("source") || "all",
  q: params.get("q") || "",
  page: parsePositiveInt(params.get("page"), 1),
};

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
    ? "새로 반영된 기사 묶음을 보고 있어요."
    : "최근 갱신 기준 기사 묶음을 보고 있어요.";
  refs.refreshTime.textContent = formatRefreshTimestamp(payload.generated_at);
  refs.refreshTime.dateTime = payload.generated_at;
}

function getFilteredArticles() {
  const query = normalize(state.q);
  return payload.articles.filter((article) => {
    if (state.category !== "all" && article.primary_category !== state.category) {
      return false;
    }
    if (state.source !== "all" && article.source_key !== state.source) {
      return false;
    }
    if (!query) {
      return true;
    }
    return normalize(article.title).includes(query);
  });
}

function groupArticles(articles) {
  const groups = new Map(payload.categories.map((category) => [category.key, []]));
  articles.forEach((article) => {
    if (!groups.has(article.primary_category)) {
      groups.set(article.primary_category, []);
    }
    groups.get(article.primary_category).push(article);
  });
  return payload.categories
    .map((category) => ({
      key: category.key,
      label: category.label,
      articles: groups.get(category.key) || [],
    }))
    .filter((group) => group.articles.length > 0);
}

function syncUrl() {
  const nextParams = new URLSearchParams();
  if (state.category !== "all") {
    nextParams.set("category", state.category);
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

function renderCategoryFilters() {
  const counts = new Map(payload.categories.map((category) => [category.key, 0]));
  const sourceFiltered = payload.articles.filter((article) => {
    if (state.source !== "all" && article.source_key !== state.source) {
      return false;
    }
    if (state.q.trim() && !normalize(article.title).includes(normalize(state.q))) {
      return false;
    }
    return true;
  });
  sourceFiltered.forEach((article) => {
    counts.set(article.primary_category, (counts.get(article.primary_category) || 0) + 1);
  });
  const totalCount = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);

  refs.categoryFilters.innerHTML = "";
  refs.categoryFilters.appendChild(createCategoryButton("all", "전체", totalCount));
  payload.categories.forEach((category) => {
    refs.categoryFilters.appendChild(
      createCategoryButton(category.key, category.label, counts.get(category.key) || 0),
    );
  });
}

function createCategoryButton(category, label, count) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pill${state.category === category ? " is-active" : ""}`;
  button.dataset.category = category;
  button.innerHTML = `${escapeHtml(label)} <span>${count}</span>`;
  button.addEventListener("click", () => {
    state.category = category;
    state.page = 1;
    render();
  });
  return button;
}

function renderSourceOptions() {
  const currentValue = state.source;
  refs.sourceSelect.innerHTML = '<option value="all">모든 소스</option>';

  const allowedCategories = state.category === "all" ? null : new Set([state.category]);
  payload.sources
    .filter((source) => !allowedCategories || allowedCategories.has(source.category))
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
  if (state.category === "all") {
    pieces.push("전체");
  } else {
    pieces.push(categoryLabels[state.category] || state.category);
  }
  if (state.source !== "all") {
    const source = payload.sources.find((entry) => entry.source_key === state.source);
    if (source) {
      pieces.push(source.name);
    }
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
  if (!refs.paginationNav) {
    return;
  }
  if (pagination.totalItems === 0 || pagination.totalPages <= 1) {
    refs.paginationNav.innerHTML = "";
    refs.paginationNav.hidden = true;
    return;
  }

  refs.paginationNav.hidden = false;
  refs.paginationNav.innerHTML = "";
  if (pagination.page > 1) {
    refs.paginationNav.appendChild(
      createPageButton("이전", pagination.page - 1, false, true),
    );
  }

  getPageTokens(pagination.totalPages, pagination.page).forEach((token) => {
    if (token === "ellipsis") {
      const marker = document.createElement("span");
      marker.className = "pagination-chip pagination-ellipsis";
      marker.textContent = "…";
      refs.paginationNav.appendChild(marker);
      return;
    }
    refs.paginationNav.appendChild(
      createPageButton(String(token), token, token === pagination.page),
    );
  });

  if (pagination.page < pagination.totalPages) {
    refs.paginationNav.appendChild(
      createPageButton("다음", pagination.page + 1, false, true),
    );
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
            <h2>${escapeHtml(group.label)}</h2>
            <span>${group.articles.length}건</span>
          </div>
          <div class="news-list">
            ${group.articles
              .map(
                (article) => `
                  <article class="news-row">
                    <div class="news-topline">
                      <a class="news-title" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(article.title)}</a>
                      <div class="row-actions">
                        <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="word" data-article-url="${escapeHtml(article.canonical_url)}">Word</button>
                        <button type="button" class="mini-export-button" data-export-scope="single" data-export-format="excel" data-article-url="${escapeHtml(article.canonical_url)}">Excel</button>
                      </div>
                    </div>
                    <a class="news-link" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(article.canonical_url)}</a>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");
}

function render() {
  renderRefreshSpotlight();
  renderSourceOptions();
  renderCategoryFilters();
  refs.searchInput.value = state.q;
  const articles = getFilteredArticles();
  const pagination = getPaginationMeta(articles.length);
  syncUrl();
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
    category: categoryLabels[article.primary_category] || article.primary_category,
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
  const categoryPart = state.category === "all" ? "all" : state.category;
  const sourcePart = state.source === "all" ? "all" : state.source;
  return `newsbot-${categoryPart}-${sourcePart}-${format}`;
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

function setCopyButtonState(label, state) {
  refs.copyAllButton.textContent = label;
  refs.copyAllButton.classList.remove("is-done", "is-error");
  if (state === "done") {
    refs.copyAllButton.classList.add("is-done");
  }
  if (state === "error") {
    refs.copyAllButton.classList.add("is-error");
  }
  window.clearTimeout(copyButtonResetTimer);
  copyButtonResetTimer = window.setTimeout(() => {
    refs.copyAllButton.textContent = "현재 화면 전체 복사";
    refs.copyAllButton.classList.remove("is-done", "is-error");
  }, 2200);
}

function flashButtonState(button, label, state) {
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;
  button.textContent = label;
  button.classList.remove("is-done", "is-error");
  if (state === "done") {
    button.classList.add("is-done");
  }
  if (state === "error") {
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
  state.category = "all";
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
  flashButtonState(refs.exportWordButton, ok ? "저장 완료" : "저장할 뉴스 없음", ok ? "done" : "error");
});

refs.exportExcelButton.addEventListener("click", () => {
  const ok = exportArticles("current", "excel");
  flashButtonState(refs.exportExcelButton, ok ? "저장 완료" : "저장할 뉴스 없음", ok ? "done" : "error");
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
