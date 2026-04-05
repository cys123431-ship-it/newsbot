const bootstrap = JSON.parse(
  document.getElementById("analysis-bootstrap").textContent,
);

const refs = {
  windowTabs: document.getElementById("analysis-window-tabs"),
  status: document.getElementById("analysis-status"),
  kpis: document.getElementById("analysis-kpis"),
  timeline: document.getElementById("analysis-timeline"),
  snapshot: document.getElementById("analysis-snapshot"),
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
  focusPanel: "repeated",
};

let payload = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function formatCompactNumber(value) {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatDecimal(value) {
  const numeric = Number(value || 0);
  if (numeric >= 100) {
    return formatNumber(Math.round(numeric));
  }
  return numeric.toFixed(1);
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

function getTopItem(items, labelKey) {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  return {
    label: items[0]?.[labelKey] || items[0]?.label || "-",
    count: Number(items[0]?.count || 0),
  };
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

function scrollToPanel(panelKey) {
  const mapping = {
    repeated: refs.repeatedPanel,
    samples: refs.samplesPanel,
    guide: refs.moreAnalytics,
  };
  const target = mapping[panelKey];
  if (!target) {
    return;
  }
  if (panelKey === "guide") {
    refs.moreAnalytics.open = true;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderFocusTabs() {
  const items = [
    { key: "repeated", label: "Repeated Titles" },
    { key: "samples", label: "Recent Samples" },
    { key: "guide", label: "Reading Guide" },
  ];
  refs.focusTabs.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill${state.focusPanel === item.key ? " is-active" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => {
      state.focusPanel = item.key;
      renderFocusTabs();
      renderFocusPanels();
      scrollToPanel(item.key);
    });
    refs.focusTabs.appendChild(button);
  });
}

function renderFocusPanels() {
  refs.repeatedPanel.classList.toggle("is-spotlight", state.focusPanel === "repeated");
  refs.samplesPanel.classList.toggle("is-spotlight", state.focusPanel === "samples");
  refs.moreAnalytics.classList.toggle("is-spotlight", state.focusPanel === "guide");
}

function renderStatus() {
  const windowPayload = getWindowPayload();
  if (!windowPayload) {
    refs.status.textContent = "Failed to load analysis data.";
    return;
  }

  const topSource = getTopItem(windowPayload.top_sources, "name");
  const topKeyword = getTopItem(windowPayload.top_keywords, "keyword");
  const topSection = getTopItem(windowPayload.top_sections, "label");
  refs.status.textContent =
    `${windowPayload.label} 동안 기사 ${formatNumber(windowPayload.article_count)}건, ` +
    `출처 ${formatNumber(windowPayload.active_source_count)}곳, ` +
    `반복 제목 ${formatNumber(windowPayload.repeated_title_count)}건. ` +
    `상위 출처 ${topSource?.label || "-"}, 상위 키워드 ${topKeyword?.label || "-"}, ` +
    `핵심 섹션 ${topSection?.label || "-"}.`;
}

function renderKpis() {
  const windowPayload = getWindowPayload();
  if (!windowPayload) {
    refs.kpis.innerHTML = '<div class="analysis-empty">No analysis metrics available.</div>';
    return;
  }

  const timelineItems = windowPayload.timeline || [];
  const peakTimeline = timelineItems.reduce(
    (best, item) => (Number(item.count || 0) > Number(best?.count || -1) ? item : best),
    null,
  );
  const averagePerBucket = timelineItems.length
    ? windowPayload.article_count / timelineItems.length
    : windowPayload.article_count;

  const cards = [
    {
      label: `${windowPayload.label} articles`,
      value: formatNumber(windowPayload.article_count),
      detail: `Lifetime ${formatCompactNumber(payload.lifetime_total_articles)}`,
      emphasis: true,
    },
    {
      label: "Active sources",
      value: formatNumber(windowPayload.active_source_count),
      detail: "Distinct publishers in this window",
    },
    {
      label: "Repeated titles",
      value: formatNumber(windowPayload.repeated_title_count),
      detail: "Headline clusters worth checking",
    },
    {
      label: "Peak interval",
      value: formatNumber(peakTimeline?.count || 0),
      detail: peakTimeline ? formatDate(peakTimeline.date) : "No peak detected",
    },
    {
      label: "Average per bucket",
      value: formatDecimal(averagePerBucket),
      detail: `${formatNumber(timelineItems.length)} timeline buckets`,
    },
  ];

  refs.kpis.innerHTML = cards
    .map(
      (card) => `
        <article class="analysis-kpi${card.emphasis ? " analysis-kpi-primary" : ""}">
          <p class="analysis-kpi-label">${escapeHtml(card.label)}</p>
          <strong class="analysis-kpi-value">${escapeHtml(card.value)}</strong>
          <p class="analysis-kpi-detail">${escapeHtml(card.detail)}</p>
        </article>
      `,
    )
    .join("");
}

function renderSnapshotCards() {
  const windowPayload = getWindowPayload();
  if (!windowPayload) {
    refs.snapshot.innerHTML = '<div class="analysis-empty compact-empty">No insight notes available.</div>';
    return;
  }

  const leadSource = getTopItem(windowPayload.top_sources, "name");
  const leadKeyword = getTopItem(windowPayload.top_keywords, "keyword");
  const leadHub = getTopItem(windowPayload.top_hubs, "label");
  const leadLanguage = getTopItem(windowPayload.language_counts, "language");

  const cards = [
    {
      label: "Lead source",
      value: leadSource?.label || "-",
      detail: `${formatNumber(leadSource?.count || 0)} articles`,
    },
    {
      label: "Lead keyword",
      value: leadKeyword?.label || "-",
      detail: `${formatNumber(leadKeyword?.count || 0)} mentions`,
    },
    {
      label: "Lead hub",
      value: leadHub?.label || "-",
      detail: `${formatNumber(leadHub?.count || 0)} articles`,
    },
    {
      label: "Lead language",
      value: String(leadLanguage?.label || "-").toUpperCase(),
      detail: `${formatNumber(leadLanguage?.count || 0)} articles`,
    },
    {
      label: "Undated lifetime",
      value: formatNumber(payload.lifetime_unknown_time_count),
      detail: "Articles without a timestamp",
    },
    {
      label: "Retention",
      value: `${formatNumber(payload.retention_days)}d`,
      detail: "Detailed history kept for review",
    },
  ];

  refs.snapshot.innerHTML = cards
    .map(
      (card) => `
        <article class="analysis-snapshot-card">
          <p class="analysis-snapshot-label">${escapeHtml(card.label)}</p>
          <strong class="analysis-snapshot-value">${escapeHtml(card.value)}</strong>
          <p class="analysis-snapshot-detail">${escapeHtml(card.detail)}</p>
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

  const maxCount = Math.max(...items.map((item) => Number(item.count || 0)), 1);
  const averageCount = items.reduce((sum, item) => sum + Number(item.count || 0), 0) / items.length;
  const averageHeight = Math.max(8, Math.round((averageCount / maxCount) * 100));
  const peakCount = Math.max(...items.map((item) => Number(item.count || 0)), 0);
  const peakItem = items.find((item) => Number(item.count || 0) === peakCount) || items[0];
  const labelStep = Math.max(1, Math.ceil(items.length / 8));

  refs.timeline.innerHTML = `
    <div class="analysis-timeline-shell">
      <div class="analysis-timeline-summary">
        <div class="analysis-timeline-stat">
          <span>Peak day</span>
          <strong>${escapeHtml(formatDate(peakItem.date))}</strong>
          <small>${escapeHtml(formatNumber(peakCount))} articles</small>
        </div>
        <div class="analysis-timeline-stat">
          <span>Average</span>
          <strong>${escapeHtml(formatDecimal(averageCount))}</strong>
          <small>articles per bucket</small>
        </div>
        <div class="analysis-timeline-stat">
          <span>Coverage</span>
          <strong>${escapeHtml(formatNumber(items.length))}</strong>
          <small>timeline points in this window</small>
        </div>
      </div>
      <div class="timeline-bars">
        ${items
          .map((item, index) => {
            const numericCount = Number(item.count || 0);
            const height = Math.max(10, Math.round((numericCount / maxCount) * 100));
            const label = index % labelStep === 0 || index === items.length - 1
              ? formatDate(item.date)
              : "";
            const isPeak = numericCount === peakCount;
            return `
              <div class="timeline-bar-item">
                <span class="timeline-bar-count">${escapeHtml(formatNumber(numericCount))}</span>
                <div class="timeline-bar-track">
                  <span class="timeline-bar-average" style="bottom:${averageHeight}%"></span>
                  <div class="timeline-bar-fill${isPeak ? " is-peak" : ""}" style="height:${height}%"></div>
                </div>
                <span class="timeline-bar-label">${escapeHtml(label)}</span>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderRankList(
  container,
  items,
  valueKey,
  labelKey,
  emptyMessage,
  options = {},
) {
  if (!items.length) {
    container.innerHTML = `<div class="analysis-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const maxValue = Math.max(...items.map((item) => Number(item[valueKey] || 0)), 1);
  const formatValue = options.formatValue || ((value) => formatNumber(value));
  const subtitleKey = options.subtitleKey || null;

  container.innerHTML = `
    <div class="analysis-rank-list">
      ${items
        .map((item) => {
          const value = Number(item[valueKey] || 0);
          const width = Math.max(12, Math.round((value / maxValue) * 100));
          const subtitle = subtitleKey ? item[subtitleKey] : "";
          return `
            <div class="analysis-rank-row">
              <div class="analysis-rank-copy">
                <div class="analysis-rank-copy-main">
                  <strong>${escapeHtml(item[labelKey] || "-")}</strong>
                  ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
                </div>
                <span>${escapeHtml(formatValue(value))}</span>
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

  const hubMax = Math.max(...hubs.map((entry) => Number(entry.count || 0)), 1);
  const sectionMax = Math.max(...sections.map((entry) => Number(entry.count || 0)), 1);
  refs.sections.innerHTML = `
    <div class="analysis-split-list">
      <section>
        <h3 class="analysis-mini-title">Hubs</h3>
        ${hubs.length ? "" : '<div class="analysis-empty compact-empty">No data</div>'}
        <div class="analysis-rank-list">
          ${hubs
            .map(
              (item) => `
                <div class="analysis-rank-row">
                  <div class="analysis-rank-copy">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(formatNumber(item.count))}</span>
                  </div>
                  <div class="analysis-rank-track">
                    <div class="analysis-rank-fill" style="width:${Math.max(12, Math.round((Number(item.count || 0) / hubMax) * 100))}%"></div>
                  </div>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
      <section>
        <h3 class="analysis-mini-title">Sections</h3>
        ${sections.length ? "" : '<div class="analysis-empty compact-empty">No data</div>'}
        <div class="analysis-rank-list">
          ${sections
            .map(
              (item) => `
                <div class="analysis-rank-row">
                  <div class="analysis-rank-copy">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(formatNumber(item.count))}</span>
                  </div>
                  <div class="analysis-rank-track">
                    <div class="analysis-rank-fill" style="width:${Math.max(12, Math.round((Number(item.count || 0) / sectionMax) * 100))}%"></div>
                  </div>
                </div>
              `,
            )
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

function renderDashboard() {
  renderWindowTabs();
  renderFocusTabs();
  renderStatus();
  renderKpis();
  renderSnapshotCards();
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
    {
      formatValue: (value) => `${formatNumber(value)} articles`,
    },
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
    refs.snapshot.innerHTML = fallback;
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
