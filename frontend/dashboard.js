
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const config = window.CSRS_CONFIG || {};
  const API_BASE = String(
    config.apiBaseUrl || "https://csrs-backend.onrender.com"
  ).replace(/\/+$/, "");

  const PATHS = {
    dashboard: config.dashboardPath || "/api/dashboard",
    incidents: config.incidentsPath || "/api/incidents",
    categories: config.categoriesPath || "/api/incident-categories",
    locations: config.locationsPath || "/api/locations",
    emergency: config.emergencyPath || "/api/emergency",
    visitors: config.visitorsPath || "/api/gate/on-campus"
  };

  const LOGIN_PATH = config.loginPath || "/home.html";
  const ALLOW_ANONYMOUS = config.allowAnonymous !== false;
  const VISITORS_INCLUDE_HISTORY = config.visitorsIncludeCheckedOut === true;

  const VIEWS = {
    overview: ["Security Dashboard", "Campus security overview"],
    incidents: ["Incident Monitoring", "Review and report incidents"],
    emergency: ["Emergency Centre", "Monitor emergency alerts"],
    visitors: ["Campus Visitors", "Review visitor activity"],
    profile: ["Profile Management", "Manage your account"]
  };

  let incidents = [];
  let emergencies = [];
  let visitors = [];
  let currentView = "overview";
  let requestInProgress = false;
  const latestRequest = {};

  const beginRequest = key =>
    (latestRequest[key] = (latestRequest[key] || 0) + 1);

  const isStale = (key, id) => latestRequest[key] !== id;

  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem("csrs_user") || "{}") || {};
    } catch {
      return {};
    }
  }

  function clearSession() {
    sessionStorage.removeItem("csrs_token");
    sessionStorage.removeItem("csrs_user");
  }

  function redirectToLogin() {
    clearSession();
    window.location.replace(LOGIN_PATH);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function slug(value) {
    return String(value ?? "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  function badge(value) {
    const text = String(value ?? "").trim();
    if (!text) return "—";
    return `<span class="badge ${slug(text)}">${escapeHTML(text)}</span>`;
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "0";
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value ?? "";
  }

  function setHTML(id, value) {
    const element = $(id);
    if (element) element.innerHTML = value;
  }

  function emptyRow(columns, message) {
    return `<tr><td colspan="${columns}" class="empty-cell">${escapeHTML(message)}</td></tr>`;
  }

  function showMessage(message, type = "success") {
    const box = $(type === "error" ? "errorBox" : "noticeBox");
    const other = $(type === "error" ? "noticeBox" : "errorBox");

    if (other) other.hidden = true;

    if (box) {
      box.textContent = message;
      box.hidden = false;
    } else {
      console[type === "error" ? "error" : "log"]("CSRS:", message);
    }
  }

  function clearMessage() {
    if ($("errorBox")) $("errorBox").hidden = true;
    if ($("noticeBox")) $("noticeBox").hidden = true;
  }

  function showError(error) {
    console.error("CSRS:", error);
    showMessage(error?.message || "Something went wrong.", "error");
  }

  function setBusy(button, busy, label) {
    if (!button) return;

    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent;
      }
      button.disabled = true;
      if (label) button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    }
  }

  function displayDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }

  function timeOf(value) {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  function valueOf(object, ...keys) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }
    return "";
  }

  function rowsFrom(data, keys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];

    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }

    return [];
  }

  function localInputValue(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  async function api(path, options = {}) {
    const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };

    const token = sessionStorage.getItem("csrs_token");
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;

    try {
      response = await fetch(url, { ...options, headers });
    } catch (error) {
      console.error("CSRS network error:", url, error);
      throw new Error(
        "Cannot connect to the backend. Check the Render service and its CORS settings."
      );
    }

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (response.status === 401) {
      redirectToLogin();
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (response.status === 403) {
      throw new Error("Your account does not have permission for this request.");
    }

    if (!response.ok) {
      const message = typeof data === "object" && data !== null
        ? data.error || data.message
        : "";

      throw new Error(message || `HTTP ${response.status} from ${path}`);
    }

    if (typeof data === "string" && data.trimStart().startsWith("<")) {
      throw new Error(`Expected JSON from ${path}, but the server returned HTML.`);
    }

    return data;
  }

  function updateUserDisplay() {
    const user = getUser();
    const name = String(
      user.full_name || user.fullName || user.username ||
      user.name || user.email || "User"
    );
    const role = String(user.role || user.role_name || "Staff");
    const initial = name.charAt(0).toUpperCase() || "U";

    setText("welcomeName", name);
    setText("sidebarUsername", name);
    setText("sidebarRole", role);
    setText("userAvatar", initial);
    setText("topAvatar", initial);
    setText("topUsername", name);

    setText("profileDisplayName", name);
    setText("profileAvatar", initial);
    setText("profileRole", role);
    setText("profileFullName", user.full_name || user.fullName || user.name || "—");
    setText("profileUsername", user.username || "—");
    setText("profileEmail", user.email || "—");
    setText("profileRoleDetail", role);
    setText(
      "profileRegistration",
      user.registration_number || user.registrationNumber || user.reg_no || "—"
    );
  }

  function drawBars(elementId, entries) {
    const element = $(elementId);
    if (!element) return;

    const values = (Array.isArray(entries) ? entries : []).map(item => ({
      label: String(valueOf(
        item, "label", "name", "status", "category",
        "category_name", "severity", "date", "day", "location_name"
      ) || "Other"),
      value: Number(valueOf(item, "count", "total", "value") || 0)
    }));

    if (!values.length) {
      element.innerHTML = '<p class="empty-cell">No data available.</p>';
      return;
    }

    const max = Math.max(1, ...values.map(item => item.value));

    element.innerHTML = values.map(item => {
      const width = Math.max(0, Math.min(100, item.value / max * 100));
      return `
        <div class="chart-row">
          <span title="${escapeHTML(item.label)}">${escapeHTML(item.label)}</span>
          <div class="chart-track" role="img"
               aria-label="${escapeHTML(item.label)}: ${escapeHTML(item.value)}">
            <div class="chart-fill" style="width:${width}%"></div>
          </div>
          <span class="chart-value">${escapeHTML(formatNumber(item.value))}</span>
        </div>`;
    }).join("");
  }

  function updateLastUpdated() {
    setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
  }

  function resetStats() {
    ["totalIncidents", "pendingAlerts", "visitors", "highSeverity"]
      .forEach(id => setText(id, "—"));
  }

  async function loadDashboard() {
    const request = beginRequest("dashboard");

    try {
      const days = encodeURIComponent($("period")?.value || "30");
      const data = await api(`${PATHS.dashboard}?days=${days}`);

      if (isStale("dashboard", request)) return;

      const stats = data.stats || data;
      const incidentStats = data.incidents && !Array.isArray(data.incidents)
        ? data.incidents
        : stats;

      setText("totalIncidents", formatNumber(valueOf(
        incidentStats, "total", "count", "total_incidents", "total_incident",
        "totalIncidents", "incident_count"
      )));

      setText("pendingAlerts", formatNumber(valueOf(
        data, "pending_emergency_alerts", "open_alerts", "pending_alerts",
        "pendingAlerts", "active_alerts"
      )));

      setText("visitors", formatNumber(valueOf(
        data, "visitors_on_campus", "active_visitors", "current_visitors",
        "visitors", "activeVisitors"
      )));

      setText("highSeverity", formatNumber(valueOf(
        incidentStats, "open_critical", "critical", "critical_incidents",
        "criticalIncidents", "high_severity"
      )));

      drawBars("severityChart", data.by_severity || data.bySeverity);
      drawBars("statusChart", data.by_status || data.byStatus);
      drawBars("categoryChart", data.by_category || data.byCategory);
      drawBars("trendChart", data.daily_trend || data.dailyTrend);

      const hotspots = rowsFrom(data.hotspots, ["hotspots", "data", "items"]);
      setHTML("hotspotsTable", hotspots.length
        ? hotspots.map(item => `
            <tr>
              <td>${escapeHTML(valueOf(item, "location", "location_name", "name") || "Unknown")}</td>
              <td>${escapeHTML(formatNumber(valueOf(item, "count", "total")))}</td>
            </tr>`).join("")
        : emptyRow(2, "No incident hotspot data returned."));

      updateUserDisplay();
      updateLastUpdated();
    } catch (error) {
      if (isStale("dashboard", request)) return;
      resetStats();
      showError(error);
    }
  }

  function populateSelect(elementId, records, idKey, labelKey, placeholder) {
    const select = $(elementId);
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);

    records.forEach(item => {
      const id = valueOf(item, idKey, "id");
      const label = valueOf(item, labelKey, "name");
      if (id === "") return;

      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = String(label || `Option ${id}`);
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  async function loadIncidents() {
    const request = beginRequest("incidents");
    setHTML("incidentsTable", emptyRow(6, "Loading incidents..."));

    try {
      const [raw, categoryData, locationData] = await Promise.all([
        api(PATHS.incidents),
        api(PATHS.categories),
        api(PATHS.locations)
      ]);

      if (isStale("incidents", request)) return;

      incidents = rowsFrom(raw, ["incidents", "data", "items", "rows", "results"])
        .slice()
        .sort((a, b) =>
          timeOf(valueOf(b, "incident_datetime", "created_at")) -
          timeOf(valueOf(a, "incident_datetime", "created_at"))
        );

      populateSelect(
        "incidentCategory",
        rowsFrom(categoryData, ["categories", "data", "items"]),
        "category_id", "category_name", "Select category"
      );

      populateSelect(
        "incidentLocation",
        rowsFrom(locationData, ["locations", "data", "items"]),
        "location_id", "location_name", "Select location"
      );

      renderIncidents();
      updateLastUpdated();
    } catch (error) {
      if (isStale("incidents", request)) return;
      showError(error);
      setHTML("incidentsTable", emptyRow(6, error.message));
    }
  }

  function renderIncidents() {
    const search = ($("incidentSearch")?.value || "").trim().toLowerCase();
    const status = ($("incidentStatusFilter")?.value || "").toLowerCase();

    const filtered = incidents.filter(item => {
      const text = [
        item.reference_no, item.category_name, item.location_name,
        item.description, item.status, item.severity
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status || String(item.status || "").toLowerCase() === status);
    });

    setHTML("incidentsTable", filtered.length
      ? filtered.map(item => `
          <tr>
            <td>${escapeHTML(valueOf(item, "reference_no", "id") || "—")}</td>
            <td>${escapeHTML(valueOf(item, "category_name", "category") || "—")}</td>
            <td>${escapeHTML(valueOf(item, "location_name", "location") || "—")}</td>
            <td>${badge(item.severity)}</td>
            <td>${badge(item.status)}</td>
            <td>${escapeHTML(displayDate(valueOf(item, "incident_datetime", "created_at")))}</td>
          </tr>`).join("")
      : emptyRow(6, "No matching incidents found."));
  }

  function resetIncidentForm() {
    const form = $("incidentForm");
    if (!form) return;

    form.reset();
    if ($("incidentDateTime")) {
      $("incidentDateTime").max = localInputValue();
      $("incidentDateTime").value = localInputValue();
    }
  }

  function setIncidentForm(open) {
    const panel = $("incidentFormPanel");
    if (!panel) return;

    panel.hidden = !open;
    $("toggleIncidentForm")?.setAttribute("aria-expanded", String(open));

    if (open) {
      if ($("incidentDateTime")) {
        $("incidentDateTime").max = localInputValue();
        if (!$("incidentDateTime").value) {
          $("incidentDateTime").value = localInputValue();
        }
      }
      $("incidentCategory")?.focus();
    }
  }

  async function submitIncident(event) {
    event.preventDefault();
    if (requestInProgress) return;

    const categoryId = $("incidentCategory")?.value;
    const locationId = $("incidentLocation")?.value;
    const dateValue = $("incidentDateTime")?.value;
    const description = $("incidentDescription")?.value.trim();

    if (!categoryId || !locationId || !description) {
      showMessage("Please complete the category, location and description.", "error");
      return;
    }

    const date = dateValue ? new Date(dateValue) : new Date();
    if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 60000) {
      showMessage("Enter a valid incident date and time that is not in the future.", "error");
      return;
    }

    const payload = {
      category_id: Number(categoryId),
      location_id: Number(locationId),
      severity: $("incidentSeverity")?.value || "Medium",
      incident_datetime: date.toISOString(),
      description,
      is_anonymous: ALLOW_ANONYMOUS && Boolean($("incidentAnonymous")?.checked)
    };

    const form = $("incidentForm");
    const button = form?.querySelector('button[type="submit"]');
    requestInProgress = true;
    setBusy(button, true, "Submitting...");

    try {
      await api(PATHS.incidents, {
        method: "POST",
        body: JSON.stringify(payload)
      });

      resetIncidentForm();
      setIncidentForm(false);
      showMessage("Incident report submitted successfully.");
      await loadIncidents();
      await loadDashboard();
    } catch (error) {
      showError(error);
    } finally {
      requestInProgress = false;
      setBusy(button, false);
    }
  }

  async function loadEmergencies() {
    const request = beginRequest("emergency");
    setHTML("emergencyTable", emptyRow(5, "Loading emergency alerts..."));

    try {
      const data = await api(PATHS.emergency);
      if (isStale("emergency", request)) return;

      emergencies = rowsFrom(data, ["emergencies", "alerts", "data", "items"])
        .slice()
        .sort((a, b) =>
          timeOf(valueOf(b, "created_at", "created_on")) -
          timeOf(valueOf(a, "created_at", "created_on"))
        );

      renderEmergencies();
      updateLastUpdated();
    } catch (error) {
      if (isStale("emergency", request)) return;
      showError(error);
      setHTML("emergencyTable", emptyRow(5, error.message));
    }
  }

  function renderEmergencies() {
    const search = ($("emergencySearch")?.value || "").trim().toLowerCase();
    const status = ($("emergencyStatusFilter")?.value || "").toLowerCase();

    const filtered = emergencies.filter(item => {
      const text = [
        item.reference_no, item.type, item.title,
        item.location_name, item.description, item.status
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status || String(item.status || "").toLowerCase() === status);
    });

    setHTML("emergencyTable", filtered.length
      ? filtered.map(item => `
          <tr>
            <td>${escapeHTML(valueOf(item, "reference_no", "id") || "—")}</td>
            <td>${escapeHTML(valueOf(item, "type", "title", "description") || "—")}</td>
            <td>${escapeHTML(valueOf(item, "location_name", "location") || "—")}</td>
            <td>${badge(item.status)}</td>
            <td>${escapeHTML(displayDate(valueOf(item, "created_at", "created_on")))}</td>
          </tr>`).join("")
      : emptyRow(5, "No matching emergency alerts found."));
  }

  const checkoutOf = item =>
    valueOf(item, "check_out_time", "checked_out_at", "checkout_time");

  async function loadVisitors() {
    const request = beginRequest("visitors");
    setHTML("visitorsTable", emptyRow(6, "Loading visitor records..."));

    try {
      const data = await api(PATHS.visitors);
      if (isStale("visitors", request)) return;

      visitors = rowsFrom(data, ["visitors", "records", "data", "items"])
        .slice()
        .sort((a, b) =>
          timeOf(valueOf(b, "check_in_time", "checked_in_at", "checkin_time")) -
          timeOf(valueOf(a, "check_in_time", "checked_in_at", "checkin_time"))
        );

      renderVisitors();
      updateLastUpdated();
    } catch (error) {
      if (isStale("visitors", request)) return;
      showError(error);
      setHTML("visitorsTable", emptyRow(6, error.message));
    }
  }

  function renderVisitors() {
    const search = ($("visitorSearch")?.value || "").trim().toLowerCase();
    const status = $("visitorStatusFilter")?.value || "";

    const filtered = visitors.filter(item => {
      const checkedOut = Boolean(checkoutOf(item));
      const text = [
        item.visitor_name, item.name, item.purpose, item.host_name, item.host
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status ||
          (status === "checked-out" && checkedOut) ||
          (status === "on-campus" && !checkedOut));
    });

    setHTML("visitorsTable", filtered.length
      ? filtered.map(item => `
          <tr>
            <td>${escapeHTML(valueOf(item, "visitor_name", "name") || "—")}</td>
            <td>${escapeHTML(item.purpose || "—")}</td>
            <td>${escapeHTML(valueOf(item, "host_name", "host") || "—")}</td>
            <td>${escapeHTML(displayDate(valueOf(item, "check_in_time", "checked_in_at", "checkin_time")))}</td>
            <td>${escapeHTML(displayDate(checkoutOf(item)))}</td>
            <td>${badge(checkoutOf(item) ? "Checked out" : "On campus")}</td>
          </tr>`).join("")
      : emptyRow(6, "No matching visitor records found."));
  }

  function setSidebar(open) {
    const sidebar = $("sidebar");
    if (!sidebar) return;

    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const isOpen = mobile && open;

    sidebar.classList.toggle("open", isOpen);
    sidebar.inert = mobile && !isOpen;

    if ($("sidebarBackdrop")) $("sidebarBackdrop").hidden = !isOpen;
    $("menuButton")?.setAttribute("aria-expanded", String(isOpen));
  }

  function loadView(view) {
    if (view === "overview") return loadDashboard();
    if (view === "incidents") return loadIncidents();
    if (view === "emergency") return loadEmergencies();
    if (view === "visitors") return loadVisitors();
    if (view === "profile") {
      updateUserDisplay();
      return Promise.resolve();
    }
    return Promise.resolve();
  }

  function showView(name, focus = false) {
    const view = Object.prototype.hasOwnProperty.call(VIEWS, name)
      ? name
      : "overview";

    currentView = view;

    document.querySelectorAll("[data-view-panel]").forEach(panel => {
      panel.hidden = panel.dataset.viewPanel !== view;
    });

    document.querySelectorAll("[data-view]").forEach(link => {
      const active = link.dataset.view === view;
      link.classList.toggle("active", active);

      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    setText("pageTitle", VIEWS[view][0]);
    setText("pageSubtitle", VIEWS[view][1]);
    setText("breadcrumbCurrent", VIEWS[view][0]);
    document.title = `CSRS | ${VIEWS[view][0]}`;

    if (location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }

    setSidebar(false);
    clearMessage();

    if (focus) $("main")?.focus({ preventScroll: true });
    loadView(view);
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach(link => {
      link.addEventListener("click", event => {
        event.preventDefault();
        showView(link.dataset.view, true);
      });
    });

    window.addEventListener("hashchange", () => {
      const view = location.hash.slice(1);
      if (view !== currentView) showView(view);
    });

    $("menuButton")?.addEventListener("click", () => {
      setSidebar(!$("sidebar")?.classList.contains("open"));
    });

    $("sidebarBackdrop")?.addEventListener("click", () => setSidebar(false));

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && $("sidebar")?.classList.contains("open")) {
        setSidebar(false);
        $("menuButton")?.focus();
      }
    });

    window.matchMedia("(max-width: 760px)")
      .addEventListener("change", () => setSidebar(false));

    $("logoutButton")?.addEventListener("click", redirectToLogin);
    $("profileLogoutButton")?.addEventListener("click", redirectToLogin);

    $("refreshButton")?.addEventListener("click", async () => {
      setBusy($("refreshButton"), true, "Refreshing...");
      try {
        await loadView(currentView);
      } finally {
        setBusy($("refreshButton"), false);
      }
    });

    $("period")?.addEventListener("change", loadDashboard);
    $("refreshEmergency")?.addEventListener("click", loadEmergencies);
    $("refreshVisitors")?.addEventListener("click", loadVisitors);

    $("incidentSearch")?.addEventListener("input", renderIncidents);
    $("incidentStatusFilter")?.addEventListener("change", renderIncidents);
    $("emergencySearch")?.addEventListener("input", renderEmergencies);
    $("emergencyStatusFilter")?.addEventListener("change", renderEmergencies);
    $("visitorSearch")?.addEventListener("input", renderVisitors);
    $("visitorStatusFilter")?.addEventListener("change", renderVisitors);

    $("toggleIncidentForm")?.addEventListener("click", () => {
      setIncidentForm(Boolean($("incidentFormPanel")?.hidden));
    });

    $("cancelIncidentForm")?.addEventListener("click", () => {
      resetIncidentForm();
      setIncidentForm(false);
      $("toggleIncidentForm")?.focus();
    });

    $("incidentForm")?.addEventListener("submit", submitIncident);

    if (!ALLOW_ANONYMOUS && $("anonymousLabel")) {
      $("anonymousLabel").hidden = true;
    }

    if (!VISITORS_INCLUDE_HISTORY && $("visitorStatusFilter")) {
      $("visitorStatusFilter")
        .querySelector('option[value="checked-out"]')?.remove();
    }
  }

  function start() {
    if (!sessionStorage.getItem("csrs_token")) {
      redirectToLogin();
      return;
    }

    bindEvents();
    setSidebar(false);
    updateUserDisplay();
    resetIncidentForm();
    showView(location.hash.slice(1) || "overview");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
