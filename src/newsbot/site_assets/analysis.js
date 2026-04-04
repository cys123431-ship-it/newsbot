const bootstrap = JSON.parse(
  document.getElementById("analysis-bootstrap").textContent,
);

const refs = {
  windowTabs: document.getElementById("analysis-window-tabs"),
  status: document.getElementById("analysis-status"),
  kpis: document.getElementById("analysis-kpis"),
  timeline: document.getElementById("analysis-timeline"),
  focusTabs: document.getElementById("analysis-focus-tabs"),
  repeatedPanel: document.getElementById("analysis-repeated-panel"),
  samplesPanel: document.getElementById("analysis-samples-panel"),
  moreAnalytics: document.getElementById("analysis-more-analytics"),
  keywords: document.getElementById("analysis-keywords"),
  sources: document.getElementById("analysis-sources"),
  sections: document.getElementById("analysis-sections"),
  languages: document.getElementById("analysis-languages"),
  repeated: document.getElementById("analysis-repeated"),
  samples: document.getElementById("analysis-samples"),
};

const state = {
  window: bootstrap.default_window || "7d",
  focusPanel: null,
};

let payload = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function formatDate(value) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
  }).format(parsed);
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

function getWindowPayload() {
  if (!payload) {
    return null;
  }
  return payload.windows?.[state.window] || payload.windows?.[payload.default_window] || null;
}

function renderWindowTabs() {
  if (!payload) {
    refs.windowTabs.innerHTML = "";
    return;
  }
  refs.windowTabs.innerHTML = "";
  for (const entry of payload.available_windows || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill${entry.key === state.window ? " is-active" : ""}`;
    button.textContent = entry.label;
    button.addEventListener("click", () => {
      state.window = entry.key;
      renderDashboard();
    });
    refs.windowTabs.appendChild(button);
  }
}

function renderFocusTabs() {
  const items = [
    { key: "repeated", label: "Repeated Titles" },
    { key: "samples", label: "Recent Samples" },
  ];
  refs.focusTabs.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill${state.focusPanel === item.key ? " is-active" : ""}`;
    button.textContent = `${index + 1} ${item.label}`;
    button.addEventListener("click", () => {
      state.focusPanel = state.focusPanel === item.key ? null : item.key;
      renderFocusTabs();
      renderFocusPanels();
    });
    refs.focusTabs.appendChild(button);
  });
}

function renderStatus() {
  const windowPayload = getWindowPayload();
  if (!windowPayload) {
    refs.status.textContent = "Failed to load analysis data.";
    return;
  }
  refs.status.textContent =
    `Lifetime articles ${formatNumber(payload.lifetime_total_articles)}, ` +
    `window articles ${formatNumber(windowPayload.article_count)}, ` +
    `unknown-time lifetime ${formatNumber(payload.lifetime_unknown_time_count)}, ` +
    `recent detail retention ${formatNumber(payload.retention_days)} days`;
}

function renderKpis() {
  const windowPayload = getWindowPayload();
  if (!windowPayload) {
    refs.kpis.innerHTML = '<div class="analysis-empty">No analysis metrics available.</div>';
    return;
  }

  const cards = [
    {
      label: "Lifetime articles",
      value: formatNumber(payload.lifetime_total_articles),
      detail: "Cumulative analysis base",
    },
    {
      label: `${windowPayload.label} article count`,
      value: formatNumber(windowPayload.article_count),
      detail: "Current window coverage",
    },
    {
      label: "Active sources",
      value: formatNumber(windowPayload.active_source_count),
      detail: "Distinct sources in window",
    },
    {
      label: "Repeated titles",
      value: formatNumber(windowPayload.repeated_title_count),
      detail: "Same normalized headline hash",
    },
  ];

  refs.kpis.innerHTML = cards
    .map(
      (card) => `
        <article class="analysis-kpi">
          <p class="analysis-kpi-label">${escapeHtml(card.label)}</p>
          <strong class="analysis-kpi-value">${escapeHtml(card.value)}</strong>
          <p class="analysis-kpi-detail">${escapeHtml(card.detail)}</p>
        </article>
      `,
    )
    .join("");
}

function renderTimeline() {
  const windowPayload = getWindowPayload();
  const items = windowPayload?.timeline || [];
  if (!items.length) {
    refs.timeline.innerHTML =
      '<div class="analysis-empty">No timeline articles for this window.</div>';
    return;
  }

  const maxCount = Math.max(...items.map((item) => item.count), 1);
  const labelStep = Math.max(1, Math.ceil(items.length / 8));
  refs.timeline.innerHTML = `
    <div class="timeline-bars">
      ${items
        .map((item, index) => {
          const height = Math.max(8, Math.round((item.count / maxCount) * 100));
          const label = index % labelStep === 0 || index === items.length - 1
            ? formatDate(item.date)
            : "";
          return `
            <div class="timeline-bar-item">
              <span class="timeline-bar-count">${formatNumber(item.count)}</span>
              <div class="timeline-bar-track">
                <div class="timeline-bar-fill" style="height:${height}%"></div>
              </div>
              <span class="timeline-bar-label">${escapeHtml(label)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderRankList(container, items, valueKey, labelKey, emptyMessage) {
  if (!items.length) {
    container.innerHTML = `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  const maxValue = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  container.innerHTML = `
    <div class="analysis-rank-list">
      ${items
        .map((item) => {
          const value = Number(item[valueKey] || 0);
          const width = Math.max(12, Math.round((value / maxValue) * 100));
          return `
            <div class="analysis-rank-row">
              <div class="analysis-rank-copy">
                <strong>${escapeHtml(item[labelKey] || "-")}</strong>
                <span>${escapeHtml(formatNumber(value))}</span>
              </div>
              <div class="analysis-rank-track">
                <div class="analysis-rank-fill" style="width:${width}%"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderSections() {
  const windowPayload = getWindowPayload();
  const hubs = windowPayload?.top_hubs || [];
  const sections = windowPayload?.top_sections || [];
  if (!hubs.length && !sections.length) {
    refs.sections.innerHTML =
      '<div class="analysis-empty">No hub or section data available.</div>';
    return;
  }
  refs.sections.innerHTML = `
    <div class="analysis-split-list">
      <section>
        <h3 class="analysis-mini-title">Hubs</h3>
        ${hubs.length ? "" : '<div class="analysis-empty compact-empty">No data</div>'}
        <div class="analysis-rank-list">
          ${hubs
            .map((item) => {
              const maxCount = Math.max(...hubs.map((entry) => entry.count), 1);
              const width = Math.max(12, Math.round((item.count / maxCount) * 100));
              return `
                <div class="analysis-rank-row">
                  <div class="analysis-rank-copy">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(formatNumber(item.count))}</span>
                  </div>
                  <div class="analysis-rank-track">
                    <div class="analysis-rank-fill" style="width:${width}%"></div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
      <section>
        <h3 class="analysis-mini-title">Sections</h3>
        ${sections.length ? "" : '<div class="analysis-empty compact-empty">No data</div>'}
        <div class="analysis-rank-list">
          ${sections
            .map((item) => {
              const maxCount = Math.max(...sections.map((entry) => entry.count), 1);
              const width = Math.max(12, Math.round((item.count / maxCount) * 100));
              return `
                <div class="analysis-rank-row">
                  <div class="analysis-rank-copy">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(formatNumber(item.count))}</span>
                  </div>
                  <div class="analysis-rank-track">
                    <div class="analysis-rank-fill" style="width:${width}%"></div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
    </div>
  `;
}

function renderRepeatedTable() {
  const items = getWindowPayload()?.repeated_titles || [];
  if (!items.length) {
    refs.repeated.innerHTML =
      '<div class="analysis-empty">Not enough repeated headline groups yet.</div>';
    return;
  }
  refs.repeated.innerHTML = `
    <table class="analysis-table">
      <thead>
        <tr>
          <th>Headline</th>
          <th>Articles</th>
          <th>Sources</th>
          <th>Latest time</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>
                  <a href="${escapeHtml(item.canonical_url || "#")}" target="_blank" rel="noreferrer">
                    ${escapeHtml(item.title)}
                  </a>
                </td>
                <td>${escapeHtml(formatNumber(item.article_count))}</td>
                <td>${escapeHtml(formatNumber(item.source_count))}</td>
                <td>${escapeHtml(formatDateTime(item.latest_published_at))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSamplesTable() {
  const items = getWindowPayload()?.recent_samples || [];
  if (!items.length) {
    refs.samples.innerHTML =
      '<div class="analysis-empty">No recent samples available.</div>';
    return;
  }
  refs.samples.innerHTML = `
    <table class="analysis-table">
      <thead>
        <tr>
          <th>Article</th>
          <th>Source</th>
          <th>Section</th>
          <th>Time</th>
          <th>Keywords</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `
              <tr>
                <td>
                  <a href="${escapeHtml(item.canonical_url || "#")}" target="_blank" rel="noreferrer">
                    ${escapeHtml(item.title)}
                  </a>
                </td>
                <td>${escapeHtml(item.source_name || "-")}</td>
                <td>${escapeHtml(item.section_label || item.category || "-")}</td>
                <td>${escapeHtml(formatDateTime(item.published_at))}</td>
                <td>${escapeHtml((item.keywords || []).slice(0, 4).join(", ") || "-")}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderFocusPanels() {
  refs.repeatedPanel.hidden = state.focusPanel !== "repeated";
  refs.samplesPanel.hidden = state.focusPanel !== "samples";
}

function renderDashboard() {
  renderWindowTabs();
  renderFocusTabs();
  renderStatus();
  renderKpis();
  renderTimeline();
  renderRankList(
    refs.keywords,
    getWindowPayload()?.top_keywords || [],
    "count",
    "keyword",
    "No keyword data available.",
  );
  renderRankList(
    refs.sources,
    getWindowPayload()?.top_sources || [],
    "count",
    "name",
    "No source data available.",
  );
  renderSections();
  renderRankList(
    refs.languages,
    getWindowPayload()?.language_counts || [],
    "count",
    "language",
    "No language data available.",
  );
  renderRepeatedTable();
  renderSamplesTable();
  renderFocusPanels();
}

async function init() {
  try {
    const response = await fetch(bootstrap.data_url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load analysis payload (${response.status})`);
    }
    payload = await response.json();
    if (!payload.windows?.[state.window]) {
      state.window = payload.default_window || "7d";
    }
    renderDashboard();
  } catch (error) {
    refs.status.textContent = "Failed to load analysis data.";
    const message = escapeHtml(error instanceof Error ? error.message : String(error));
    const fallback = `<div class="analysis-empty">${message}</div>`;
    refs.focusTabs.innerHTML = "";
    refs.kpis.innerHTML = fallback;
    refs.timeline.innerHTML = fallback;
    refs.keywords.innerHTML = fallback;
    refs.sources.innerHTML = fallback;
    refs.sections.innerHTML = fallback;
    refs.languages.innerHTML = fallback;
    refs.repeated.innerHTML = fallback;
    refs.samples.innerHTML = fallback;
  }
}

void init();
