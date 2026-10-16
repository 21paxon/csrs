const { $, requireAuth, getUser, roleOf, roleLabel, isPortalRole, homePath,
  canAnalytics, canSecurityOps, canGate, logout, api } = window.CSRS;

if (!requireAuth()) {
  /* redirected */
} else if (isPortalRole()) {
  window.location.replace(homePath());
} else {
  initDashboard();
}

function initDashboard() {
  const user = getUser() || {};
  const role = roleOf(user);

  $("welcome").textContent =
    "Welcome, " + (user.username || "User") + " · " + roleLabel(role);

  const roleCopy = {
    admin: {
      title: "Administrator Dashboard",
      welcome: "Manage campus security operations, users, reports and system controls.",
      help: "You have full access to campus security records and management tools."
    },
    head_security: {
      title: "Head of Security Dashboard",
      welcome: "Coordinate incidents, emergency response and security operations.",
      help: "Review campus-wide cases, assign officers and monitor overdue work."
    },
    security_officer: {
      title: "Security Officer Dashboard",
      welcome: "Work on assigned incidents and respond to active campus alerts.",
      help: "Incident records are limited to cases assigned to you and your permitted operations."
    },
    management: {
      title: "College Management Dashboard",
      welcome: "Review read-only campus safety performance and trends.",
      help: "This dashboard provides oversight information without operational controls."
    },
    dean: {
      title: "Dean of Students Dashboard",
      welcome: "Review student-safety incidents, alerts and campus trends.",
      help: "This dashboard provides read-only safety information for student support."
    }
  }[role];

  if (roleCopy) {
    $("dashboardTitle").textContent = roleCopy.title;
    $("welcome").textContent = roleCopy.welcome;
    $("workspaceHelp").textContent = roleCopy.help;
  }

  $("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    logout();
  });

  document.querySelectorAll("[data-dashboard-module]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openModule(link.dataset.dashboardModule, link.textContent.trim());
    });
  });

  document.querySelector('[data-view="overview"]').addEventListener("click", (event) => {
    event.preventDefault();
    closeModule();
  });

  document.querySelectorAll("[data-role-gate]").forEach((el) => {
    el.hidden = !canGate(role);
  });
  document.querySelectorAll("[data-role-any]").forEach((el) => {
    const allowed = el.dataset.roleAny.split(",").map((value) => value.trim());
    el.hidden = !allowed.includes(role);
  });
  document.querySelectorAll("[data-menu-label]").forEach((label) => {
    let hasVisibleItem = false;
    let next = label.nextElementSibling;
    while (next && !next.matches("[data-menu-label]")) {
      if (!next.hidden && next.classList.contains("nav-item")) hasVisibleItem = true;
      next = next.nextElementSibling;
    }
    label.hidden = !hasVisibleItem;
  });

  const overviewOnly = canAnalytics(role);
  const operational = canSecurityOps(role);
  $("analyticsBlock").hidden = !overviewOnly;
  $("opsBlock").hidden = !operational;
  $("headerActions").hidden = !overviewOnly;

  if (operational) {
    $("refreshOps").addEventListener("click", loadOperations);
    loadOperations();
  }

  if (overviewOnly) {
    $("refreshButton").addEventListener("click", loadAnalytics);
    $("period").addEventListener("change", loadAnalytics);
    loadAnalytics();
  }

  function openModule(url, label) {
    const frame = $("moduleFrame");
    const workspace = $("moduleWorkspace");
    if (!frame || !workspace || !url) return;

    $("opsBlock").hidden = true;
    $("analyticsBlock").hidden = true;
    $("headerActions").hidden = true;
    $("noticeBox").hidden = true;
    $("errorBox").hidden = true;
    workspace.hidden = false;
    document.body.classList.add("dashboard-workspace-open");
    workspace.setAttribute("aria-label", label + " workspace");
    frame.title = label + " workspace";
    frame.onload = () => {
      try {
        const style = frame.contentDocument.createElement("style");
        style.textContent = `
          .app-top { display: none !important; }
          .app-main { margin-top: 0 !important; padding-top: 24px !important; }
        `;
        frame.contentDocument.head.appendChild(style);
      } catch (error) {
        console.error("Unable to prepare embedded workspace:", error);
      }
    };
    frame.src = url;

    document.querySelectorAll(".nav-item").forEach((item) => {
      const active = item.dataset.dashboardModule === url;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

  }

  function closeModule() {
    $("moduleWorkspace").hidden = true;
    $("moduleFrame").src = "about:blank";
    document.body.classList.remove("dashboard-workspace-open");
    $("analyticsBlock").hidden = !canAnalytics(roleOf());
    $("opsBlock").hidden = !canSecurityOps(roleOf());
    $("headerActions").hidden = !canAnalytics(roleOf());

    document.querySelectorAll(".nav-item").forEach((item) => {
      const active = item.dataset.view === "overview";
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function firstValue(object, keys, fallback = 0) {
  for (const key of keys) {
    if (object && object[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }
  return fallback;
}

let requestId = 0;
let noticeTimer;

async function loadAnalytics() {
  const thisRequest = ++requestId;
  clearTimeout(noticeTimer);
  $("errorBox").hidden = true;
  $("noticeBox").hidden = true;

  const button = $("refreshButton");
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    const days = $("period").value;
    const data = await api("/api/dashboard?days=" + encodeURIComponent(days));
    if (thisRequest !== requestId) return;

    renderDashboard(data);
    $("lastUpdated").textContent = " · Updated " + new Date().toLocaleTimeString();
    $("noticeBox").textContent = "Dashboard data loaded from the server.";
    $("noticeBox").hidden = false;
    noticeTimer = setTimeout(() => {
      $("noticeBox").hidden = true;
    }, 4000);
  } catch (error) {
    if (thisRequest !== requestId) return;
    $("errorBox").textContent = error.message || "Unable to load dashboard data.";
    $("errorBox").hidden = false;
  } finally {
    if (thisRequest === requestId) {
      button.disabled = false;
      button.textContent = "Refresh";
    }
  }
}

async function loadOperations() {
  try {
    const [incidents, alerts, visitors] = await Promise.allSettled([
      api("/api/incidents"),
      api("/api/emergency"),
      canGate() ? api("/api/gate/on-campus") : Promise.resolve([])
    ]);

    const incidentRows = incidents.status === "fulfilled" && Array.isArray(incidents.value)
      ? incidents.value
      : [];
    const alertRows = alerts.status === "fulfilled" && Array.isArray(alerts.value)
      ? alerts.value
      : [];
    const visitorRows = visitors.status === "fulfilled" && Array.isArray(visitors.value)
      ? visitors.value
      : [];

    const openIncidents = incidentRows.filter((row) =>
      !["Resolved", "Closed", "Rejected", "Duplicate"].includes(row.status)
    );
    const openAlerts = alertRows.filter((row) => row.status !== "Resolved");

    $("opsIncidents").textContent = openIncidents.length.toLocaleString();
    $("opsAlerts").textContent = openAlerts.length.toLocaleString();
    $("opsVisitors").textContent = visitorRows.length.toLocaleString();
  } catch (error) {
    $("errorBox").textContent = error.message;
    $("errorBox").hidden = false;
  }
}

function renderDashboard(data) {
  const totals = data.incidents || {};

  $("totalIncidents").textContent = numberValue(
    firstValue(totals, ["total", "count", "total_incidents"], 0)
  ).toLocaleString();

  $("pendingAlerts").textContent = numberValue(data.pending_emergency_alerts).toLocaleString();
  $("visitors").textContent = numberValue(data.visitors_on_campus).toLocaleString();
  $("highSeverity").textContent = numberValue(totals.open_critical).toLocaleString();

  renderBars("severityChart", Array.isArray(data.by_severity) ? data.by_severity : [],
    ["severity", "name", "label"], ["count", "total", "incident_count"],
    ["red", "orange", "", "green"]);
  renderBars("statusChart", Array.isArray(data.by_status) ? data.by_status : [],
    ["status", "name", "label"], ["count", "total", "incident_count"],
    ["orange", "green", "red", ""]);
  renderBars("categoryChart", Array.isArray(data.by_category) ? data.by_category : [],
    ["category", "name", "label"], ["count", "total", "incident_count"],
    ["", "orange", "green", "red"]);
  renderTrend(Array.isArray(data.daily_trend) ? data.daily_trend : []);
  renderHotspots(Array.isArray(data.hotspots) ? data.hotspots : []);
}

function renderBars(elementId, rows, labelKeys, countKeys, colors) {
  const container = $(elementId);
  container.replaceChildren();
  if (!rows.length) {
    showEmpty(container, "No data available for this period.");
    return;
  }

  const values = rows.map((row) => ({
    label: String(firstValue(row, labelKeys, "Unknown")),
    count: numberValue(firstValue(row, countKeys, 0))
  }));
  const max = Math.max(1, ...values.map((item) => item.count));

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
    fill.className = "bar-fill " + (colors[index % colors.length] || "");
    fill.style.width = Math.max(0, (item.count / max) * 100) + "%";
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

  const points = rows.map((row) => ({
    label: String(firstValue(row, ["day", "date", "incident_date", "created_date"], "")).slice(0, 10),
    count: numberValue(firstValue(row, ["count", "total", "incident_count"], 0))
  })).slice(-14);
  const max = Math.max(1, ...points.map((point) => point.count));

  points.forEach((point) => {
    const column = document.createElement("div");
    column.className = "trend-column";
    const value = document.createElement("div");
    value.className = "trend-value";
    value.textContent = point.count.toLocaleString();
    const bar = document.createElement("div");
    bar.className = "trend-bar";
    bar.style.height = Math.max(3, (point.count / max) * 130) + "px";
    bar.title = point.label + ": " + point.count;
    const date = document.createElement("div");
    date.className = "trend-date";
    date.textContent = point.label ? point.label.slice(5, 10) : "";
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

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const location = document.createElement("td");
    location.textContent = String(
      firstValue(row, ["location", "location_name", "name", "hotspot"], "Unknown")
    );
    const count = document.createElement("td");
    count.textContent = numberValue(
      firstValue(row, ["incidents", "count", "total", "incident_count"], 0)
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
