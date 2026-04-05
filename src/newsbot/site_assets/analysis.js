const analysisBootstrap = JSON.parse(
  document.getElementById("analysis-bootstrap").textContent,
);

const analysisRefs = {
  windowTabs: document.getElementById("analysis-window-tabs"),
  kpiStrip: document.getElementById("analysis-kpi-strip"),
  trendPrimary: document.getElementById("analysis-trend-primary"),
  distributionPanels: document.getElementById("analysis-distribution-panels"),
  trendPanels: document.getElementById("analysis-trend-panels"),
  repeated: document.getElementById("analysis-repeated"),
  samples: document.getElementById("analysis-samples"),
};

const analysisState = {
  payload: null,
  window: analysisBootstrap.default_window || "7d",
};

const ANALYSIS_LINE_COLORS = ["#6f9fcd", "#3f6fa2", "#9ec4e9", "#7f95bd"];
const ANALYSIS_DONUT_COLORS = ["#6f9fcd", "#8eb4dc", "#b9d2ef", "#d7e7f7", "#adc7e5", "#86afd9"];

function analysisEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function analysisFormatNumber(value) {
  return new Intl.NumberFormat("ko-KR").format(Number(value || 0));
}

function analysisFormatMetric(value) {
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return analysisFormatNumber(value);
    }
    return new Intl.NumberFormat("ko-KR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    return analysisFormatMetric(numeric);
  }
  return String(value);
}

function analysisFormatDateTime(value) {
  if (!value) {
    return "시간 미상";
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

function buildSparkline(series) {
  const points = Array.isArray(series) ? series.map((value) => Number(value || 0)) : [];
  if (!points.length) {
    return "";
  }
  const maxValue = Math.max(...points, 1);
  const step = points.length > 1 ? 100 / (points.length - 1) : 100;
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = 30 - (value / maxValue) * 26;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return `
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" />
    </svg>
  `;
}

function buildLineChart(seriesGroups) {
  const groups = Array.isArray(seriesGroups) ? seriesGroups : [];
  const allValues = groups.flatMap((group) =>
    (group.series || []).map((item) => Number(item.count || 0)),
  );
  const maxValue = Math.max(...allValues, 1);
  return `
    <svg viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
      ${groups
        .map((group, index) => {
          const series = group.series || [];
          const step = series.length > 1 ? 100 / (series.length - 1) : 100;
          const path = series
            .map((point, pointIndex) => {
              const x = pointIndex * step;
              const y = 120 - (Number(point.count || 0) / maxValue) * 104;
              return `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          return `<path d="${path}" stroke="${ANALYSIS_LINE_COLORS[index % ANALYSIS_LINE_COLORS.length]}" />`;
        })
        .join("")}
    </svg>
  `;
}

function buildDonutChart(items) {
  const normalized = (items || [])
    .map((item) => ({
      label: item.label || item.name || item.language || item.key || "",
      count: Number(item.count || 0),
    }))
    .filter((item) => item.count > 0);
  const total = normalized.reduce((sum, item) => sum + item.count, 0);
  if (!normalized.length || total <= 0) {
    return "";
  }

  let cursor = 0;
  const arcs = normalized
    .map((item, index) => {
      const start = cursor / total;
      cursor += item.count;
      const end = cursor / total;
      const largeArc = end - start > 0.5 ? 1 : 0;
      const startAngle = start * Math.PI * 2 - Math.PI / 2;
      const endAngle = end * Math.PI * 2 - Math.PI / 2;
      const startX = 60 + Math.cos(startAngle) * 46;
      const startY = 60 + Math.sin(startAngle) * 46;
      const endX = 60 + Math.cos(endAngle) * 46;
      const endY = 60 + Math.sin(endAngle) * 46;
      return `
        <path
          d="M 60 60 L ${startX.toFixed(3)} ${startY.toFixed(3)} A 46 46 0 ${largeArc} 1 ${endX.toFixed(3)} ${endY.toFixed(3)} Z"
          fill="${ANALYSIS_DONUT_COLORS[index % ANALYSIS_DONUT_COLORS.length]}"
        />
      `;
    })
    .join("");

  return `
    <div class="donut-shell">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        ${arcs}
        <circle cx="60" cy="60" r="28" fill="#ffffff"></circle>
        <text x="60" y="56" text-anchor="middle">${analysisFormatNumber(total)}</text>
        <text x="60" y="70" text-anchor="middle">items</text>
      </svg>
      <div class="donut-legend">
        ${normalized
          .map(
            (item, index) => `
              <div class="donut-legend-item">
                <span class="donut-swatch" style="background:${ANALYSIS_DONUT_COLORS[index % ANALYSIS_DONUT_COLORS.length]}"></span>
                <strong>${analysisEscapeHtml(item.label)}</strong>
                <span>${analysisFormatNumber(item.count)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderWindowTabs() {
  const windows = analysisState.payload?.available_windows || [];
  analysisRefs.windowTabs.innerHTML = windows
    .map(
      (item) => `
        <button
          type="button"
          class="analysis-window-tab ${item.key === analysisState.window ? "is-active" : ""}"
          data-window="${item.key}"
        >
          ${analysisEscapeHtml(item.label)}
        </button>
      `,
    )
    .join("");
  analysisRefs.windowTabs.querySelectorAll("[data-window]").forEach((button) => {
    button.addEventListener("click", () => {
      analysisState.window = button.dataset.window || analysisState.window;
      renderAnalysisDashboard();
    });
  });
}

function renderKpiStrip(windowPayload) {
  const cards = windowPayload.kpi_series || [];
  analysisRefs.kpiStrip.innerHTML = cards
    .map(
      (card) => `
        <article class="kpi-strip-card">
          <p>${analysisEscapeHtml(card.label)}</p>
          <strong>${analysisFormatMetric(card.value)}</strong>
          <div class="kpi-sparkline">${buildSparkline(card.series || [])}</div>
        </article>
      `,
    )
    .join("");
}

function renderDistributionPanels(windowPayload) {
  const panels = windowPayload.distribution_panels || [];
  analysisRefs.distributionPanels.innerHTML = panels
    .map((panel) => {
      const items = panel.items || [];
      const maxValue = Math.max(...items.map((item) => Number(item.count || 0)), 1);
      const chartHtml =
        panel.chart === "donut"
          ? buildDonutChart(items)
          : `
            <div class="bar-list">
              ${items
                .map(
                  (item) => `
                    <div class="bar-row">
                      <div class="bar-copy">
                        <strong>${analysisEscapeHtml(item.label || item.name || item.language || item.key)}</strong>
                        <span>${analysisFormatNumber(item.count || 0)}</span>
                      </div>
                      <div class="bar-track">
                        <span class="bar-fill" style="width:${((Number(item.count || 0) / maxValue) * 100).toFixed(1)}%"></span>
                      </div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          `;

      return `
        <section class="analysis-panel">
          <div class="analysis-panel-head">
            <div>
              <p class="analysis-kicker">Distribution</p>
              <h2>${analysisEscapeHtml(panel.label)}</h2>
            </div>
          </div>
          ${chartHtml}
        </section>
      `;
    })
    .join("");
}

function renderTrendSummary(panel) {
  const summaryItems = panel.summary_items || [];
  if (!summaryItems.length) {
    return "";
  }
  return `
    <div class="trend-summary-grid">
      ${summaryItems
        .map(
          (item) => `
            <article class="trend-summary-card">
              <span>${analysisEscapeHtml(item.label || "")}</span>
              <strong>${analysisEscapeHtml(analysisFormatMetric(item.value))}</strong>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderTrendPanel(panel) {
  if (panel.key === "volume") {
    return `
      <section class="analysis-panel trend-panel">
        <div class="analysis-panel-head">
          <div>
            <p class="analysis-kicker">Trend</p>
            <h2>${analysisEscapeHtml(panel.label)}</h2>
          </div>
        </div>
        ${renderTrendSummary(panel)}
        <div class="trend-chart">${buildSparkline((panel.series || []).map((item) => item.count || 0))}</div>
        <div class="trend-label-row">
          ${(panel.series || [])
            .slice(-6)
            .map((item) => `<span>${analysisEscapeHtml(item.date || "")}</span>`)
            .join("")}
        </div>
      </section>
    `;
  }

  return `
    <section class="analysis-panel trend-panel">
      <div class="analysis-panel-head">
        <div>
          <p class="analysis-kicker">Trend</p>
          <h2>${analysisEscapeHtml(panel.label)}</h2>
        </div>
      </div>
      ${renderTrendSummary(panel)}
      <div class="trend-legend">
        ${(panel.series_groups || [])
          .map(
            (group, index) => `
              <div class="trend-legend-item">
                <span class="trend-dot" style="background:${ANALYSIS_LINE_COLORS[index % ANALYSIS_LINE_COLORS.length]}"></span>
                <span>${analysisEscapeHtml(group.label || group.key)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
      <div class="trend-lines">
        ${buildLineChart(panel.series_groups || [])}
      </div>
    </section>
  `;
}

function renderTrendPanels(windowPayload) {
  const panels = windowPayload.trend_panels || [];
  const [primaryPanel, ...secondaryPanels] = panels;
  analysisRefs.trendPrimary.innerHTML = primaryPanel ? renderTrendPanel(primaryPanel) : "";
  analysisRefs.trendPanels.innerHTML = secondaryPanels.map((panel) => renderTrendPanel(panel)).join("");
}

function renderRepeated(windowPayload) {
  const rows = windowPayload.repeated_titles || [];
  if (!rows.length) {
    analysisRefs.repeated.innerHTML = '<div class="analysis-empty">No repeated headlines in this window.</div>';
    return;
  }
  analysisRefs.repeated.innerHTML = `
    <table class="analysis-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Count</th>
          <th>Sources</th>
          <th>Latest</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td><a href="${analysisEscapeHtml(row.canonical_url || "#")}" target="_blank" rel="noreferrer">${analysisEscapeHtml(row.title)}</a></td>
                <td>${analysisFormatNumber(row.article_count)}</td>
                <td>${analysisFormatNumber(row.source_count)}</td>
                <td>${analysisEscapeHtml(analysisFormatDateTime(row.latest_published_at))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSamples(windowPayload) {
  const rows = windowPayload.recent_samples || [];
  if (!rows.length) {
    analysisRefs.samples.innerHTML = '<div class="analysis-empty">No recent samples in this window.</div>';
    return;
  }
  analysisRefs.samples.innerHTML = `
    <table class="analysis-table">
      <thead>
        <tr>
          <th>Headline</th>
          <th>Source</th>
          <th>Section</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td><a href="${analysisEscapeHtml(row.canonical_url || "#")}" target="_blank" rel="noreferrer">${analysisEscapeHtml(row.title)}</a></td>
                <td>${analysisEscapeHtml(row.source_name)}</td>
                <td>${analysisEscapeHtml(row.section_label || row.category || "")}</td>
                <td>${analysisEscapeHtml(analysisFormatDateTime(row.published_at))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAnalysisDashboard() {
  const windowPayload = analysisState.payload?.windows?.[analysisState.window];
  if (!windowPayload) {
    return;
  }
  renderWindowTabs();
  renderKpiStrip(windowPayload);
  renderDistributionPanels(windowPayload);
  renderTrendPanels(windowPayload);
  renderRepeated(windowPayload);
  renderSamples(windowPayload);
}

async function initAnalysis() {
  const response = await fetch(analysisBootstrap.data_url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load analysis payload: ${response.status}`);
  }
  analysisState.payload = await response.json();
  renderAnalysisDashboard();
}

void initAnalysis();
