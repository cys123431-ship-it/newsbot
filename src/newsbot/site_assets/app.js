const payload = JSON.parse(document.getElementById("site-data").textContent);

const refs = {
  categoryFilters: document.getElementById("category-filters"),
  sourceSelect: document.getElementById("source-select"),
  searchInput: document.getElementById("search-input"),
  resetButton: document.getElementById("reset-button"),
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

render();
