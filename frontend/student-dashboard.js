const C = window.CSRS;
const { $, requireAuth, getUser, roleOf, roleLabel, isPortalRole, homePath,
  logout, api, formatDate, statusCell, addCell, emptyRow, setLoading,
  getDeviceLocation } = C;

if (!requireAuth()) {
  /* redirected */
} else if (!isPortalRole()) {
  window.location.replace(homePath());
} else {
  initPortal();
}

function initPortal() {
  const user = getUser() || {};
  const role = roleOf(user);
  const isStaff = role === "staff";

  $("welcome").textContent = "Welcome, " + (user.username || "User") + " · " + roleLabel(role);
  $("portalHeading").textContent = isStaff ? "Staff portal" : "Student dashboard";
  $("portalBannerTitle").textContent = isStaff
    ? "Campus safety tools for staff"
    : "Welcome to your campus safety portal";
  document.title = isStaff ? "CSRS | Staff Portal" : "CSRS | Student Dashboard";

  $("profileUsername").textContent = user.username || "Not available";
  $("profileEmail").textContent = user.email || "Not available";
  $("profileRole").textContent = roleLabel(role);

  document.querySelectorAll("[data-role-any]").forEach((element) => {
    const allowed = element.dataset.roleAny.split(",").map((value) => value.trim());
    element.hidden = !allowed.includes(role) || element.hasAttribute("data-start-hidden");
  });

  $("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    logout();
  });

  $("refreshButton").addEventListener("click", loadPortal);
  $("refreshItemsButton").addEventListener("click", loadLostAndFound);
  $("emergencyButton").addEventListener("click", submitEmergencyAlert);
  $("closeReportDetails").addEventListener("click", () => {
    $("report-details").hidden = true;
  });
  document.querySelectorAll("[data-open-report]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openIncidentWorkspace();
    });
  });
  $("closeIncidentWorkspace").addEventListener("click", closeIncidentWorkspace);
  document.querySelectorAll("[data-open-module]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openModuleWorkspace(link.dataset.openModule);
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const workspace = document.querySelector(".workspace-overlay:not([hidden])");
      if (workspace) closeWorkspace(workspace);
    }
  });

  setupSectionNav();
  loadPortal();
  loadProfile();
}

function openIncidentWorkspace() {
  const workspace = $("incident-workspace");
  openWorkspace(workspace);
}

function closeIncidentWorkspace() {
  closeWorkspace($("incident-workspace"));
}

function openModuleWorkspace(path) {
  const workspace = path === "/lost-found.html"
    ? $("lost-found-workspace")
    : $("incident-workspace");
  openWorkspace(workspace);
}

function openWorkspace(workspace) {
  workspace.classList.add("workspace-overlay");
  workspace.hidden = false;
  document.body.classList.add("workspace-open");
}

function closeWorkspace(workspace) {
  workspace.hidden = true;
  workspace.classList.remove("workspace-overlay");
  if (!document.querySelector(".workspace-overlay:not([hidden])")) {
    document.body.classList.remove("workspace-open");
  }
}

function setupSectionNav() {
  const links = document.querySelectorAll(".nav-item[data-view]");
  const triggers = document.querySelectorAll("[data-view]");
  const views = document.querySelectorAll("[data-dashboard-view]:not([data-view-detail])");

  function showView(view) {
    const selectedView = view || "overview";
    document.body.classList.toggle("lost-found-mode", selectedView === "lost-found");
    document.querySelectorAll("[data-view-detail]").forEach((element) => {
      element.hidden = true;
    });
    views.forEach((element) => {
      const isSelected = element.dataset.dashboardView === selectedView;
      element.hidden = !isSelected;
      element.classList.toggle("dashboard-view-hidden", !isSelected);
    });
    links.forEach((link) => {
      const active = link.dataset.view === selectedView;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    history.replaceState(null, "", "#" + selectedView);
  }

  triggers.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showView(link.dataset.view);
    });
  });

  const initialView = window.location.hash.slice(1);
  showView(["overview", "reports", "emergency", "profile", "lost-found"].includes(initialView)
    ? initialView
    : "overview");
}

async function loadProfile() {
  try {
    const me = await api("/api/auth/me");
    $("profileUsername").textContent = me.username || me.full_name || "Not available";
    $("profileEmail").textContent = me.email || "Not available";
    $("profileRole").textContent = roleLabel(me.role);
    if (me.full_name) {
      $("welcome").textContent = "Welcome, " + me.full_name + " · " + roleLabel(me.role);
    }
  } catch {
    /* session user is already shown */
  }
}

async function loadPortal() {
  $("errorBox").hidden = true;
  $("noticeBox").hidden = true;
  const button = $("refreshButton");
  setLoading(button, true, "Refresh Dashboard", "Loading...");
  try {
    await Promise.all([loadMyReports(), loadLostAndFound()]);
    $("noticeBox").textContent = "Your portal has been updated.";
    $("noticeBox").hidden = false;
  } catch (error) {
    $("errorBox").textContent = error.message || "Could not load dashboard information.";
    $("errorBox").hidden = false;
  } finally {
    setLoading(button, false, "Refresh Dashboard");
  }
}

function closedStatus(status) {
  return ["closed", "resolved", "rejected", "duplicate"].includes(
    String(status || "").trim().toLowerCase()
  );
}

async function loadMyReports() {
  const reports = await api("/api/incidents");
  if (!Array.isArray(reports)) {
    throw new Error("The incidents API returned an unexpected response.");
  }

  $("totalReports").textContent = reports.length.toLocaleString();
  $("openReports").textContent = reports.filter((report) => !closedStatus(report.status)).length.toLocaleString();
  renderMyReports(reports);
}

function renderMyReports(reports) {
  const body = $("reportsBody");
  body.replaceChildren();
  if (!reports.length) {
    body.appendChild(emptyRow(5, "You have not submitted any incident reports yet."));
    return;
  }

  reports.forEach((report) => {
    const row = document.createElement("tr");
    addCell(row, report.reference_no || report.id);
    addCell(row, report.category);
    addCell(row, report.severity);
    row.appendChild(statusCell(report.status));
    addCell(row, formatDate(report.reported_datetime || report.created_at, true));
    const actionCell = document.createElement("td");
    const trackButton = document.createElement("button");
    trackButton.type = "button";
    trackButton.className = "button";
    trackButton.textContent = "Track report";
    trackButton.addEventListener("click", () => loadReportDetails(report.id));
    actionCell.appendChild(trackButton);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

async function loadReportDetails(id) {
  const panel = $("report-details");
  const summary = $("reportDetailsSummary");
  const details = $("reportDetailsBody");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  summary.textContent = "Loading report history...";
  details.replaceChildren();

  try {
    const report = await api("/api/incidents/" + encodeURIComponent(id));
    summary.textContent = `${report.reference_no} · ${report.status}`;

    const overview = document.createElement("p");
    overview.className = "subtitle";
    overview.textContent =
      `Severity: ${report.severity || "Not set"} · Reported: ${formatDate(report.reported_datetime, true)}`;
    details.appendChild(overview);

    const heading = document.createElement("h3");
    heading.textContent = "Status history";
    details.appendChild(heading);

    if (!Array.isArray(report.updates) || !report.updates.length) {
      const empty = document.createElement("p");
      empty.className = "subtitle";
      empty.textContent = "No status updates have been recorded yet.";
      details.appendChild(empty);
      return;
    }

    const list = document.createElement("ol");
    list.className = "report-history";
    report.updates.forEach((update) => {
      const item = document.createElement("li");
      item.textContent =
        `${formatDate(update.created_at, true)} · ${update.new_status || "Update"}` +
        (update.note ? ` — ${update.note}` : "");
      list.appendChild(item);
    });
    details.appendChild(list);
  } catch (error) {
    summary.textContent = "Could not load report tracking.";
    const message = document.createElement("p");
    message.className = "message error";
    message.textContent = error.message;
    details.appendChild(message);
  }
}

async function loadLostAndFound() {
  const results = await Promise.allSettled([
    api("/api/lost-found/lost"),
    api("/api/lost-found/found")
  ]);

  if (results[0].status === "fulfilled" && Array.isArray(results[0].value)) {
    $("lostItems").textContent = results[0].value.length.toLocaleString();
    renderLostItems(results[0].value);
  } else {
    $("lostItems").textContent = "—";
    $("lostBody").replaceChildren();
    $("lostBody").appendChild(emptyRow(4, "Could not load your lost items."));
  }

  if (results[1].status === "fulfilled" && Array.isArray(results[1].value)) {
    renderFoundItems(results[1].value);
  } else {
    $("foundBody").replaceChildren();
    $("foundBody").appendChild(emptyRow(4, "Could not load found items."));
  }
}

function renderLostItems(items) {
  const body = $("lostBody");
  body.replaceChildren();
  if (!items.length) {
    body.appendChild(emptyRow(4, "You have not reported any lost items."));
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");
    addCell(row, item.item_name || item.title);
    addCell(row, item.location_lost || item.location_text);
    addCell(row, formatDate(item.date_lost || item.event_date));
    row.appendChild(statusCell(item.status));
    body.appendChild(row);
  });
}

function renderFoundItems(items) {
  const body = $("foundBody");
  body.replaceChildren();
  if (!items.length) {
    body.appendChild(emptyRow(4, "No found items are currently available."));
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");
    addCell(row, item.item_name || item.title);
    addCell(row, item.description, "description");
    addCell(row, item.location_found || item.location_text);
    addCell(row, formatDate(item.date_found || item.event_date));
    body.appendChild(row);
  });
}

async function submitEmergencyAlert() {
  const button = $("emergencyButton");
  const result = $("emergencyResult");
  const message = $("emergencyMessage").value.trim();

  if (!window.confirm(
    "Do you need urgent campus security assistance? This will send an emergency alert."
  )) {
    return;
  }

  setLoading(button, true, "Request Emergency Assistance", "Sending Alert...");
  result.textContent = "Sending alert…";

  try {
    const coords = await getDeviceLocation();
    const payload = { message: message || "Emergency assistance requested" };
    if (coords) {
      payload.latitude = coords.latitude;
      payload.longitude = coords.longitude;
    }

    const alert = await api("/api/emergency", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    result.textContent =
      "Emergency alert sent successfully. Alert ID: " + alert.id +
      (coords ? " Location was attached." : " Location was not available.") +
      " Campus security has been notified.";
    $("emergencyMessage").value = "";
  } catch (error) {
    result.textContent = error.message || "Unable to send the emergency alert.";
  } finally {
    setLoading(button, false, "Request Emergency Assistance");
  }
}
