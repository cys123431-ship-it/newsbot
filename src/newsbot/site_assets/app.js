const payload = JSON.parse(document.getElementById("site-data").textContent);

const refs = {
  categoryFilters: document.getElementById("category-filters"),
  sourceSelect: document.getElementById("source-select"),
  searchInput: document.getElementById("search-input"),
  resetButton: document.getElementById("reset-button"),
  copyAllButton: document.getElementById("copy-all-button"),
  statusLine: document.getElementById("status-line"),
  newsSections: document.getElementById("news-sections"),
};

const categoryLabels = Object.fromEntries(
  payload.categories.map((entry) => [entry.key, entry.label]),
);

const params = new URLSearchParams(window.location.search);
const state = {
  category: params.get("category") || "all",
  source: params.get("source") || "all",
  q: params.get("q") || "",
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

function renderStatusLine(articles) {
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
  refs.statusLine.textContent = `${pieces.join(" · ")} · ${articles.length}건`;
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
                    <a class="news-title" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(article.title)}</a>
                    <a class="news-link" href="${escapeHtml(article.canonical_url)}" target="_blank" rel="noreferrer">${escapeHtml(article.link_label)}</a>
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
  syncUrl();
  renderSourceOptions();
  renderCategoryFilters();
  refs.searchInput.value = state.q;
  const articles = getFilteredArticles();
  renderStatusLine(articles);
  renderSections(articles);
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
      const newsLink = row.querySelector(".news-link")?.textContent?.trim() || "";
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

refs.sourceSelect.addEventListener("change", (event) => {
  state.source = event.target.value;
  render();
});

refs.searchInput.addEventListener("input", (event) => {
  state.q = event.target.value;
  render();
});

refs.resetButton.addEventListener("click", () => {
  state.category = "all";
  state.source = "all";
  state.q = "";
  render();
});

refs.copyAllButton.addEventListener("click", () => {
  void copyCurrentView();
});

render();
