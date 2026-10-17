
(() => {
  "use strict";

  // --------------------------------------------------
  // 1. CONFIGURATION
  // --------------------------------------------------

  const $ = id => document.getElementById(id);

  const config = window.CSRS_CONFIG || {};
  const API_BASE = String(config.apiBaseUrl || "").replace(/\/+$/, "");

  let incidents = [];
  let emergencies = [];
  let visitors = [];
  let categories = [];
  let locations = [];
  let currentView = "overview";
  let requestInProgress = false;

  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem("csrs_user") || "{}");
    } catch {
      return {};
    }
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

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value ?? "";
  }

  function setHTML(id, value) {
    const element = $(id);
    if (element) element.innerHTML = value;
  }

  function showMessage(message, type = "success") {
    const box = $(type === "error" ? "errorBox" : "noticeBox");
    const other = $(type === "error" ? "noticeBox" : "errorBox");

    if (other) other.hidden = true;

    if (box) {
      box.textContent = message;
      box.hidden = false;
    } else {
      console[type === "error" ? "error" : "log"](message);
    }
  }

  function clearMessage() {
    if ($("errorBox")) $("errorBox").hidden = true;
    if ($("noticeBox")) $("noticeBox").hidden = true;
  }

  function showError(error) {
    console.error("CSRS:", error);
    showMessage(error.message || "Something went wrong.", "error");
  }

  // --------------------------------------------------
  // 2. API REQUESTS
  // --------------------------------------------------

  async function api(path, options = {}) {
    if (!API_BASE) {
      throw new Error(
        "API URL is missing. Check that config.js loads before dashboard.js."
      );
    }

    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    };

    const token = sessionStorage.getItem("csrs_token");

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response;

    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
      });
    } catch {
      throw new Error(
        "Cannot connect to the CSRS backend. Check your internet connection and backend URL."
      );
    }

    const contentType = response.headers.get("content-type") || "";
    let data;

    if (contentType.includes("application/json")) {
      data = await response.json().catch(() => ({}));
    } else {
      data = await response.text().catch(() => "");
    }

    if (response.status === 401) {
      sessionStorage.removeItem("csrs_token");
      sessionStorage.removeItem("csrs_user");
      window.location.replace("/index.html");
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null
          ? data.error || data.message
          : "";

      throw new Error(
        message || `API request failed: HTTP ${response.status} (${path})`
      );
    }

    return data;
  }

  function rowsFrom(data, keys = []) {
    if (Array.isArray(data)) return data;

    if (!data || typeof data !== "object") return [];

    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }

    return [];
  }

  function displayDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString();
  }

  function valueOf(object, ...keys) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null) {
        return object[key];
      }
    }

    return "";
  }

  // --------------------------------------------------
  // 3. NAVIGATION
  // --------------------------------------------------

  function showView(name) {
    const allowedViews = [
      "overview",
      "incidents",
      "emergency",
      "visitors"
    ];

    const view = allowedViews.includes(name) ? name : "overview";
    currentView = view;

    document.querySelectorAll("[data-view-panel]").forEach(panel => {
      panel.hidden = panel.dataset.viewPanel !== view;
    });

    document.querySelectorAll("[data-view]").forEach(link => {
      const active = link.dataset.view === view;

      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    const titles = {
      overview: [
        "Security Dashboard",
        "Campus security overview"
      ],
      incidents: [
        "Incident Monitoring",
        "Review and report incidents"
      ],
      emergency: [
        "Emergency Centre",
        "Monitor emergency alerts"
      ],
      visitors: [
        "Campus Visitors",
        "Review visitor activity"
      ]
    };

    setText("pageTitle", titles[view][0]);
    setText("pageSubtitle", titles[view][1]);

    if (location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }

    if ($("sidebar")) $("sidebar").classList.remove("open");
    if ($("menuButton")) {
      $("menuButton").setAttribute("aria-expanded", "false");
    }

    clearMessage();

    if (view === "overview") loadDashboard();
    if (view === "incidents") loadIncidents();
    if (view === "emergency") loadEmergencies();
    if (view === "visitors") loadVisitors();
  }

  document.querySelectorAll("[data-view]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      showView(link.dataset.view);
    });
  });

  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (view !== currentView) showView(view);
  });

  if ($("menuButton")) {
    $("menuButton").addEventListener("click", () => {
      const open = $("sidebar")?.classList.toggle("open") || false;

      $("menuButton").setAttribute("aria-expanded", String(open));
    });
  }

  if ($("logoutButton")) {
    $("logoutButton").addEventListener("click", () => {
      sessionStorage.removeItem("csrs_token");
      sessionStorage.removeItem("csrs_user");
      window.location.replace("/index.html");
    });
  }

  if ($("refreshButton")) {
    $("refreshButton").addEventListener("click", () => {
      showView(currentView);
    });
  }

  if ($("period")) {
    $("period").addEventListener("change", loadDashboard);
  }

  if ($("refreshEmergency")) {
    $("refreshEmergency").addEventListener("click", loadEmergencies);
  }

  if ($("refreshVisitors")) {
    $("refreshVisitors").addEventListener("click", loadVisitors);
  }

  // --------------------------------------------------
  // 4. DASHBOARD OVERVIEW
  // --------------------------------------------------

  function drawBars(elementId, entries) {
    const element = $(elementId);
    if (!element) return;

    const values = (Array.isArray(entries) ? entries : []).map(item => ({
      label: valueOf(
        item,
        "label",
        "name",
        "status",
        "category",
        "location_name"
      ) || "Other",
      value: Number(valueOf(item, "count", "total", "value") || 0)
    }));

    if (!values.length) {
      element.innerHTML =
        '<p class="empty-cell">No data available.</p>';
      return;
    }

    const max = Math.max(1, ...values.map(item => item.value));

    element.innerHTML = values.map(item => {
      const width = Math.max(
        0,
        Math.min(100, (item.value / max) * 100)
      );

      return `
        <div class="chart-row">
          <span>${escapeHTML(item.label)}</span>
          <div class="chart-track">
            <div class="chart-fill" style="width:${width}%"></div>
          </div>
          <span class="chart-value">${escapeHTML(item.value)}</span>
        </div>
      `;
    }).join("");
  }

  async function loadDashboard() {
    if (!API_BASE) {
      showError(new Error("Missing backend URL in config.js."));
      return;
    }

    try {
      const days = encodeURIComponent($("period")?.value || "30");
      const data = await api(`/api/dashboard?days=${days}`);

      const totals = data.incidents || data.stats || {};

      setText(
        "totalIncidents",
        Number(valueOf(
          totals,
          "total",
          "count",
          "total_incidents",
          "total_incident"
        ) || 0).toLocaleString()
      );

      setText(
        "pendingAlerts",
        Number(valueOf(
          data,
          "pending_emergency_alerts",
          "open_alerts",
          "pending_alerts"
        ) || 0).toLocaleString()
      );

      setText(
        "visitors",
        Number(valueOf(
          data,
          "visitors_on_campus",
          "active_visitors",
          "current_visitors"
        ) || 0).toLocaleString()
      );

      setText(
        "highSeverity",
        Number(valueOf(
          totals,
          "open_critical",
          "critical",
          "critical_incidents"
        ) || 0).toLocaleString()
      );

      drawBars("severityChart", data.by_severity);
      drawBars("statusChart", data.by_status);
      drawBars("categoryChart", data.by_category);
      drawBars("trendChart", data.daily_trend);

      const hotspots = rowsFrom(data.hotspots, ["hotspots", "data"]);

      setHTML(
        "hotspotsTable",
        hotspots.length
          ? hotspots.map(item => `
              <tr>
                <td>${escapeHTML(valueOf(
                  item,
                  "location",
                  "location_name",
                  "name"
                ) || "Unknown")}</td>
                <td>${escapeHTML(valueOf(item, "count", "total") || 0)}</td>
              </tr>
            `).join("")
          : '<tr><td colspan="2" class="empty-cell">No incident hotspots found.</td></tr>'
      );

      updateUserDisplay();

      setText(
        "lastUpdated",
        `Updated ${new Date().toLocaleTimeString()}`
      );

      if ($("errorBox")) $("errorBox").hidden = true;
    } catch (error) {
      showError(error);
    }
  }

  function updateUserDisplay() {
    const user = getUser();
    const username = user.username || user.full_name || "User";
    const role = user.role || "Staff";

    setText("welcomeName", username);
    setText("sidebarUsername", username);
    setText("sidebarRole", role);
    setText("userAvatar", username.charAt(0).toUpperCase());
  }

  // --------------------------------------------------
  // 5. INCIDENT MONITORING
  // --------------------------------------------------

  async function loadIncidents() {
    try {
      const results = await Promise.all([
        api("/api/incidents"),
        api("/api/incident-categories").catch(() => []),
        api("/api/locations").catch(() => [])
      ]);

      incidents = rowsFrom(results[0], ["incidents", "data", "items"]);
      categories = rowsFrom(results[1], ["categories", "data", "items"]);
      locations = rowsFrom(results[2], ["locations", "data", "items"]);

      populateSelect(
        "incidentCategory",
        categories,
        "category_id",
        "category_name"
      );

      populateSelect(
        "incidentLocation",
        locations,
        "location_id",
        "location_name"
      );

      renderIncidents();
    } catch (error) {
      showError(error);
      setHTML(
        "incidentsTable",
        `<tr><td colspan="6" class="empty-cell">${escapeHTML(error.message)}</td></tr>`
      );
    }
  }

  function populateSelect(elementId, records, idKey, labelKey) {
    const select = $(elementId);
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = '<option value="">Select an option</option>';

    records.forEach(item => {
      const id = valueOf(item, idKey, "id");
      const label = valueOf(item, labelKey, "name");

      if (id === "") return;

      const option = document.createElement("option");
      option.value = id;
      option.textContent = label || `Option ${id}`;
      select.appendChild(option);
    });

    if ([...select.options].some(option => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  function renderIncidents() {
    const search = ($("incidentSearch")?.value || "").trim().toLowerCase();
    const status = ($("incidentStatusFilter")?.value || "").toLowerCase();

    const filtered = incidents.filter(item => {
      const text = [
        item.reference_no,
        item.category_name,
        item.location_name,
        item.description,
        item.status,
        item.severity
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status || String(item.status || "").toLowerCase() === status);
    });

    setHTML(
      "incidentsTable",
      filtered.length
        ? filtered.map(item => `
            <tr>
              <td>${escapeHTML(valueOf(item, "reference_no", "id") || "—")}</td>
              <td>${escapeHTML(valueOf(item, "category_name", "category") || "—")}</td>
              <td>${escapeHTML(valueOf(item, "location_name", "location") || "—")}</td>
              <td>
                <span class="badge ${escapeHTML(
                  String(item.severity || "").toLowerCase()
                )}">
                  ${escapeHTML(item.severity || "—")}
                </span>
              </td>
              <td>
                <span class="badge ${escapeHTML(
                  String(item.status || "").toLowerCase().replace(/\s+/g, "-")
                )}">
                  ${escapeHTML(item.status || "—")}
                </span>
              </td>
              <td>${escapeHTML(displayDate(item.incident_datetime))}</td>
            </tr>
          `).join("")
        : '<tr><td colspan="6" class="empty-cell">No matching incidents found.</td></tr>'
    );
  }

  if ($("incidentSearch")) {
    $("incidentSearch").addEventListener("input", renderIncidents);
  }

  if ($("incidentStatusFilter")) {
    $("incidentStatusFilter").addEventListener("change", renderIncidents);
  }

  if ($("toggleIncidentForm") && $("incidentForm")) {
    $("toggleIncidentForm").addEventListener("click", () => {
      $("incidentForm").hidden = !$("incidentForm").hidden;
    });
  }

  if ($("cancelIncidentForm") && $("incidentForm")) {
    $("cancelIncidentForm").addEventListener("click", () => {
      $("incidentForm").reset();
      $("incidentForm").hidden = true;
    });
  }

  if ($("incidentForm")) {
    $("incidentForm").addEventListener("submit", async event => {
      event.preventDefault();

      if (requestInProgress) return;

      const categoryId = $("incidentCategory")?.value;
      const locationId = $("incidentLocation")?.value;
      const dateValue = $("incidentDateTime")?.value;
      const description = $("incidentDescription")?.value.trim();

      if (!categoryId || !locationId) {
        showMessage("Please select a category and location.", "error");
        return;
      }

      if (!description) {
        showMessage("Please enter an incident description.", "error");
        return;
      }

      const date = dateValue ? new Date(dateValue) : new Date();

      if (Number.isNaN(date.getTime())) {
        showMessage("Please enter a valid incident date and time.", "error");
        return;
      }

      const payload = {
        category_id: Number(categoryId),
        location_id: Number(locationId),
        severity: $("incidentSeverity")?.value || "Medium",
        incident_datetime: date.toISOString(),
        description,
        is_anonymous: Boolean($("incidentAnonymous")?.checked)
      };

      requestInProgress = true;

      const submitButton = $("incidentForm").querySelector(
        'button[type="submit"]'
      );

      if (submitButton) submitButton.disabled = true;

      try {
        await api("/api/incidents", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        $("incidentForm").reset();
        $("incidentForm").hidden = true;

        showMessage("Incident report submitted successfully.");

        await loadIncidents();
      } catch (error) {
        showError(error);
      } finally {
        requestInProgress = false;
        if (submitButton) submitButton.disabled = false;
      }
    });
  }

  // --------------------------------------------------
  // 6. EMERGENCY ALERTS
  // --------------------------------------------------

  async function loadEmergencies() {
    try {
      // Change this path if your backend uses another route.
      const data = await api("/api/emergency");

      emergencies = rowsFrom(
        data,
        ["emergencies", "alerts", "data", "items"]
      );

      renderEmergencies();
    } catch (error) {
      showError(error);

      setHTML(
        "emergencyTable",
        `<tr><td colspan="5" class="empty-cell">${escapeHTML(error.message)}</td></tr>`
      );
    }
  }

  function renderEmergencies() {
    const search = ($("emergencySearch")?.value || "").trim().toLowerCase();
    const status = ($("emergencyStatusFilter")?.value || "").toLowerCase();

    const filtered = emergencies.filter(item => {
      const text = [
        item.reference_no,
        item.type,
        item.title,
        item.location_name,
        item.description,
        item.status
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status || String(item.status || "").toLowerCase() === status);
    });

    setHTML(
      "emergencyTable",
      filtered.length
        ? filtered.map(item => `
            <tr>
              <td>${escapeHTML(valueOf(item, "reference_no", "id") || "—")}</td>
              <td>${escapeHTML(valueOf(item, "type", "title", "description") || "—")}</td>
              <td>${escapeHTML(valueOf(item, "location_name", "location") || "—")}</td>
              <td>${escapeHTML(item.status || "—")}</td>
              <td>${escapeHTML(displayDate(valueOf(item, "created_at", "created_on")))}</td>
            </tr>
          `).join("")
        : '<tr><td colspan="5" class="empty-cell">No emergency alerts found.</td></tr>'
    );
  }

  if ($("emergencySearch")) {
    $("emergencySearch").addEventListener("input", renderEmergencies);
  }

  if ($("emergencyStatusFilter")) {
    $("emergencyStatusFilter").addEventListener("change", renderEmergencies);
  }

  // --------------------------------------------------
  // 7. CAMPUS VISITORS
  // --------------------------------------------------

  async function loadVisitors() {
    try {
      // Change this path if your backend uses another route.
      const data = await api("/api/gate/on-campus");

      visitors = rowsFrom(
        data,
        ["visitors", "records", "data", "items"]
      );

      renderVisitors();
    } catch (error) {
      showError(error);

      setHTML(
        "visitorsTable",
        `<tr><td colspan="6" class="empty-cell">${escapeHTML(error.message)}</td></tr>`
      );
    }
  }

  function renderVisitors() {
    const search = ($("visitorSearch")?.value || "").trim().toLowerCase();
    const status = $("visitorStatusFilter")?.value || "";

    const filtered = visitors.filter(item => {
      const checkout = valueOf(
        item,
        "check_out_time",
        "checked_out_at",
        "checkout_time"
      );

      const checkedOut = Boolean(checkout);

      const text = [
        item.visitor_name,
        item.name,
        item.purpose,
        item.host_name,
        item.host
      ].join(" ").toLowerCase();

      return text.includes(search) &&
        (!status ||
          (status === "checked-out" && checkedOut) ||
          (status === "on-campus" && !checkedOut));
    });

    setHTML(
      "visitorsTable",
      filtered.length
        ? filtered.map(item => `
            <tr>
              <td>${escapeHTML(valueOf(item, "visitor_name", "name") || "—")}</td>
              <td>${escapeHTML(item.purpose || "—")}</td>
              <td>${escapeHTML(valueOf(item, "host_name", "host") || "—")}</td>
              <td>${escapeHTML(displayDate(valueOf(item, "check_in_time", "checked_in_at", "checkin_time")))}</td>
              <td>${escapeHTML(displayDate(valueOf(item, "check_out_time", "checked_out_at", "checkout_time")))}</td>
              <td>${checkedOutLabel(item)}</td>
            </tr>
          `).join("")
        : '<tr><td colspan="6" class="empty-cell">No matching visitor records found.</td></tr>'
    );
  }

  function checkedOutLabel(item) {
    const checkout = valueOf(
      item,
      "check_out_time",
      "checked_out_at",
      "checkout_time"
    );

    return checkout ? "Checked out" : "On campus";
  }

  if ($("visitorSearch")) {
    $("visitorSearch").addEventListener("input", renderVisitors);
  }

  if ($("visitorStatusFilter")) {
    $("visitorStatusFilter").addEventListener("change", renderVisitors);
  }

  // --------------------------------------------------
  // 8. START APPLICATION
  // --------------------------------------------------

  function start() {
    if (!sessionStorage.getItem("csrs_token")) {
      window.location.replace("/index.html");
      return;
    }

    updateUserDisplay();

    const initialView = location.hash.slice(1) || "overview";
    showView(initialView);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
