const analysisBootstrap = JSON.parse(
  document.getElementById("analysis-bootstrap").textContent,
);

const analysisRefs = {
  windowTabs: document.getElementById("analysis-window-tabs"),
  kpiStrip: document.getElementById("analysis-kpi-strip"),
  miniKpis: document.getElementById("analysis-mini-kpis"),
  distributionPanels: document.getElementById("analysis-distribution-panels"),
  trendPanels: document.getElementById("analysis-trend-panels"),
  repeated: document.getElementById("analysis-repeated"),
  samples: document.getElementById("analysis-samples"),
};

const analysisState = {
  payload: null,
  window: analysisBootstrap.default_window || "7d",
};

function analysisEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function analysisFormatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
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
  const points = Array.isArray(series) ? series : [];
  if (!points.length) {
    return "";
  }
  const maxValue = Math.max(...points, 1);
  const step = points.length > 1 ? 100 / (points.length - 1) : 100;
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = 30 - (Number(value || 0) / maxValue) * 26;
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
  const colors = ["#03c75a", "#101418", "#25a0ff", "#ff6d3a"];
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
          return `<path d="${path}" stroke="${colors[index % colors.length]}" />`;
        })
        .join("")}
    </svg>
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
          <strong>${analysisFormatNumber(card.value)}</strong>
          <div class="kpi-sparkline">${buildSparkline(card.series || [])}</div>
        </article>
      `,
    )
    .join("");
}

function renderMiniKpis(windowPayload) {
  const items = [
    { label: "Articles", value: windowPayload.article_count },
    { label: "Sources", value: windowPayload.active_source_count },
    { label: "Repeats", value: windowPayload.repeated_title_count },
    { label: "Unknown time", value: windowPayload.unknown_time_count },
  ];
  analysisRefs.miniKpis.innerHTML = items
    .map(
      (item) => `
        <article class="mini-kpi-card">
          <span>${analysisEscapeHtml(item.label)}</span>
          <strong>${analysisFormatNumber(item.value)}</strong>
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
      return `
        <section class="analysis-panel">
          <div class="analysis-panel-head">
            <div>
              <p class="analysis-kicker">Distribution</p>
              <h2>${analysisEscapeHtml(panel.label)}</h2>
            </div>
          </div>
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
        </section>
      `;
    })
    .join("");
}

function renderTrendPanels(windowPayload) {
  const panels = windowPayload.trend_panels || [];
  analysisRefs.trendPanels.innerHTML = panels
    .map((panel) => {
      if (panel.key === "volume") {
        return `
          <section class="analysis-panel trend-panel">
            <div class="analysis-panel-head">
              <div>
                <p class="analysis-kicker">Trend</p>
                <h2>${analysisEscapeHtml(panel.label)}</h2>
              </div>
            </div>
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
          <div class="trend-legend">
            ${(panel.series_groups || [])
              .map(
                (group, index) => `
                  <div class="trend-legend-item">
                    <span class="trend-dot trend-dot-${index + 1}"></span>
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
    })
    .join("");
}

function renderRepeated(windowPayload) {
  const rows = windowPayload.repeated_titles || [];
  if (!rows.length) {
    analysisRefs.repeated.innerHTML = '<div class="analysis-empty">반복 제목이 없습니다.</div>';
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
    analysisRefs.samples.innerHTML = '<div class="analysis-empty">최근 샘플이 없습니다.</div>';
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
  renderMiniKpis(windowPayload);
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
