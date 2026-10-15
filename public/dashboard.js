const token = sessionStorage.getItem("csrs_token");
let currentUser = {};

try {
  currentUser = JSON.parse(
    sessionStorage.getItem("csrs_user") || "{}"
  );
} catch {
  currentUser = {};
}

const $ = id => document.getElementById(id);

function clearSession() {
  sessionStorage.removeItem("csrs_token");
  sessionStorage.removeItem("csrs_user");
  window.location.replace("/index.html");
}

$("logoutLink").addEventListener("click", event => {
  event.preventDefault();
  clearSession();
});

/* ---------- View switching (hash-based) ---------- */

const VIEW_TITLES = {
  overview: "Security Dashboard",
  incidents: "Incident Monitoring",
  emergency: "Emergency Centre",
  "lost-found": "Lost & Found",
  visitors: "Campus Visitors"
};

function showView(name) {
  if (!Object.prototype.hasOwnProperty.call(VIEW_TITLES, name)) {
    name = "overview";
  }

  document.querySelectorAll("[data-view-panel]").forEach(panel => {
    panel.hidden = panel.dataset.viewPanel !== name;
  });

  document.querySelectorAll(".nav-item[data-view]").forEach(link => {
    const active = link.dataset.view === name;
    link.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  // Load an embedded page only the first time its view is opened.
  if (name !== "overview") {
    const frame = document.querySelector(
      "#view-" + name + " iframe[data-page]"
    );

    if (frame && !frame.getAttribute("src")) {
      frame.setAttribute("src", frame.dataset.page);
    }
  }

  // Period selector and Refresh only apply to the overview.
  const actions = document.querySelector(".header-actions");
  if (actions) actions.hidden = name !== "overview";

  document.title = "CSRS | " + VIEW_TITLES[name];
}

window.addEventListener("hashchange", () => {
  showView(window.location.hash.slice(1));
});

showView(window.location.hash.slice(1));

/* ---------- Auth + initial load ---------- */

if (!token) {
  window.location.replace("/index.html");
} else {
  $("welcome").textContent =
    "Welcome, " +
    (currentUser.username || "User") +
    (currentUser.role ? " · " + currentUser.role : "");

  loadDashboard();
}

$("refreshButton").addEventListener("click", loadDashboard);
$("period").addEventListener("change", loadDashboard);

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstValue(object, keys, fallback = 0) {
  for (const key of keys) {
    if (
      object &&
      object[key] !== undefined &&
      object[key] !== null
    ) {
      return object[key];
    }
  }

  return fallback;
}

let requestId = 0;
let noticeTimer;

async function loadDashboard() {
  if (!token) return;

  // Ignore responses from older requests if the period changes quickly.
  const thisRequest = ++requestId;

  clearTimeout(noticeTimer);
  $("errorBox").hidden = true;
  $("noticeBox").hidden = true;

  const button = $("refreshButton");
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const days = $("period").value;

    const response = await fetch(
      "/api/dashboard?days=" + encodeURIComponent(days),
      {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json().catch(() => ({}));

    if (thisRequest !== requestId) return;

    if (response.status === 401) {
      clearSession();
      return;
    }

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(
          "Your account does not have permission to view the dashboard."
        );
      }

      throw new Error(
        data.error ||
        "Could not load dashboard data (HTTP " +
        response.status +
        ")."
      );
    }

    renderDashboard(data);

    $("lastUpdated").textContent =
      " · Updated " + new Date().toLocaleTimeString();

    $("noticeBox").textContent =
      "Dashboard data loaded from the server.";
    $("noticeBox").hidden = false;

    noticeTimer = setTimeout(() => {
      $("noticeBox").hidden = true;
    }, 4000);
  } catch (error) {
    if (thisRequest !== requestId) return;

    console.error("Dashboard loading failed:", error);

    $("errorBox").textContent =
      error.message || "Unable to load dashboard data.";
    $("errorBox").hidden = false;
  } finally {
    if (thisRequest === requestId) {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }
}

function renderDashboard(data) {
  const totals = data.incidents || {};

  $("totalIncidents").textContent =
    numberValue(
      firstValue(totals, ["total", "count", "total_incidents"], 0)
    ).toLocaleString();

  $("pendingAlerts").textContent =
    numberValue(data.pending_emergency_alerts).toLocaleString();

  $("visitors").textContent =
    numberValue(data.visitors_on_campus).toLocaleString();

  // Use the backend's open_critical total where available.
  // This represents critical incidents that are not closed.
  $("highSeverity").textContent =
    numberValue(totals.open_critical).toLocaleString();

  const severityRows = Array.isArray(data.by_severity)
    ? data.by_severity
    : [];

  const statusRows = Array.isArray(data.by_status)
    ? data.by_status
    : [];

  const categoryRows = Array.isArray(data.by_category)
    ? data.by_category
    : [];

  renderBars(
    "severityChart",
    severityRows,
    ["severity", "name", "label"],
    ["count", "total", "incident_count"],
    ["red", "orange", "", "green"]
  );

  renderBars(
    "statusChart",
    statusRows,
    ["status", "name", "label"],
    ["count", "total", "incident_count"],
    ["orange", "green", "red", ""]
  );

  renderBars(
    "categoryChart",
    categoryRows,
    ["category", "name", "label"],
    ["count", "total", "incident_count"],
    ["", "orange", "green", "red"]
  );

  renderTrend(
    Array.isArray(data.daily_trend) ? data.daily_trend : []
  );

  renderHotspots(
    Array.isArray(data.hotspots) ? data.hotspots : []
  );
}

function renderBars(elementId, rows, labelKeys, countKeys, colors) {
  const container = $(elementId);
  container.replaceChildren();

  if (!rows.length) {
    showEmpty(container, "No data available for this period.");
    return;
  }

  const values = rows.map(row => ({
    label: String(firstValue(row, labelKeys, "Unknown")),
    count: numberValue(firstValue(row, countKeys, 0))
  }));

  const max = Math.max(1, ...values.map(item => item.count));

  values.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "bar-row";

    const heading = document.createElement("div");
    heading.className = "bar-heading";

    const label = document.createElement("span");
    label.textContent = item.label;

    const count = document.createElement("strong");
    count.textContent = item.count.toLocaleString();

    heading.append(label, count);

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className =
      "bar-fill " + (colors[index % colors.length] || "");

    fill.style.width =
      Math.max(0, item.count / max * 100) + "%";

    track.appendChild(fill);
    wrapper.append(heading, track);
    container.appendChild(wrapper);
  });
}

function renderTrend(rows) {
  const container = $("trendChart");
  container.replaceChildren();

  if (!rows.length) {
    showEmpty(container, "No trend data available.");
    return;
  }

  const points = rows.map(row => ({
    label: String(
      firstValue(
        row,
        ["day", "date", "incident_date", "created_date"],
        ""
      )
    ).slice(0, 10),
    count: numberValue(
      firstValue(row, ["count", "total", "incident_count"], 0)
    )
  })).slice(-14);

  const max = Math.max(1, ...points.map(point => point.count));

  points.forEach(point => {
    const column = document.createElement("div");
    column.className = "trend-column";

    const value = document.createElement("div");
    value.className = "trend-value";
    value.textContent = point.count.toLocaleString();

    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height =
      Math.max(3, point.count / max * 130) + "px";
    bar.title = point.label + ": " + point.count;

    const date = document.createElement("div");
    date.className = "trend-date";
    date.textContent = point.label
      ? point.label.slice(5, 10)
      : "";

    column.append(value, bar, date);
    container.appendChild(column);
  });
}

function renderHotspots(rows) {
  const tbody = $("hotspotsTable");
  tbody.replaceChildren();

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = 2;
    td.className = "empty";
    td.textContent = "No hotspot data available.";

    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement("tr");

    const location = document.createElement("td");
    location.textContent = String(
      firstValue(
        row,
        ["location", "location_name", "name", "hotspot"],
        "Unknown"
      )
    );

    const count = document.createElement("td");
    // Backend returns the hotspot count as "incidents".
    count.textContent = numberValue(
      firstValue(
        row,
        ["incidents", "count", "total", "incident_count"],
        0
      )
    ).toLocaleString();

    tr.append(location, count);
    tbody.appendChild(tr);
  });
}

function showEmpty(container, message) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  container.appendChild(element);
}