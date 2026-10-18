(() => {
  "use strict";

  // --------------------------------------------------
  // 1. CONFIGURATION
  // --------------------------------------------------

  const $ = id => document.getElementById(id);

  const config = window.CSRS_CONFIG || {};
  const API_BASE = String(config.apiBaseUrl || "").replace(/\/+$/, "");

  // Every route can be overridden from config.js, for example:
  //   window.CSRS_CONFIG = {
  //     apiBaseUrl: "https://api.example.com",
  //     emergencyPath: "/api/emergency-alerts",
  //     visitorsPath: "/api/gate/visitors",
  //     visitorsIncludeCheckedOut: true,   // set when visitorsPath returns history
  //     allowAnonymous: true,              // false hides the anonymous checkbox
  //     loginPath: "/home.html"
  //   };
  const PATHS = {
    dashboard: config.dashboardPath || "/api/dashboard",
    incidents: config.incidentsPath || "/api/incidents",
    categories: config.categoriesPath || "/api/incident-categories",
    locations: config.locationsPath || "/api/locations",
    emergency: config.emergencyPath || "/api/emergency",
    visitors: config.visitorsPath || "/api/gate/on-campus"
  };
  const LOGIN_PATH = config.loginPath || "/home.html";
  const VISITORS_INCLUDE_HISTORY = config.visitorsIncludeCheckedOut === true;
  const ALLOW_ANONYMOUS = config.allowAnonymous !== false;

  const VIEWS = {
    overview: ["Security Dashboard", "Campus security overview"],
    incidents: ["Incident Monitoring", "Review and report incidents"],
    emergency: ["Emergency Centre", "Monitor emergency alerts"],
    visitors: ["Campus Visitors", "Review visitor activity"]
  };

  let incidents = [];
  let emergencies = [];
  let visitors = [];
  let currentView = "overview";
  let requestInProgress = false;

  // Guards against slow, older responses overwriting newer ones.
  const latestRequest = {};
  const beginRequest = key => (latestRequest[key] = (latestRequest[key] || 0) + 1);
  const isStale = (key, id) => latestRequest[key] !== id;

  // --------------------------------------------------
  // 2. HELPERS
  // --------------------------------------------------

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

  // Safe to place inside a class attribute.
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
      console[type === "error" ? "error" : "log"](message);
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

  function setBusy(button, busy, busyLabel) {
    if (!button) return;

    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      if (busyLabel) button.textContent = busyLabel;
    } else {
      button.disabled = false;
      if (button.dataset.label) {
        button.textContent = button.dataset.label;
        delete button.dataset.label;
      }
    }
  }

  function displayDate(value) {
    if (!value) return "—";

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "—"
      : date.toLocaleString();
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

  // Value for a datetime-local input, in the user's local time.
  function localInputValue(date = new Date()) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  // --------------------------------------------------
  // 3. API REQUESTS
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
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;

    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch {
      throw new Error(
        "Cannot connect to the CSRS backend. Check your internet connection and backend URL."
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
      throw new Error("You do not have permission to view this information.");
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

  // --------------------------------------------------
  // 4. NAVIGATION AND SIDEBAR
  // --------------------------------------------------

  const mobileQuery = window.matchMedia("(max-width: 760px)");

  function setSidebar(open) {
    const sidebar = $("sidebar");
    if (!sidebar) return;

    const isOpen = open && mobileQuery.matches;

    sidebar.classList.toggle("open", isOpen);
    // Keeps hidden links out of the keyboard tab order on small screens.
    sidebar.inert = mobileQuery.matches && !isOpen;

    if ($("sidebarBackdrop")) $("sidebarBackdrop").hidden = !isOpen;
    if ($("menuButton")) {
      $("menuButton").setAttribute("aria-expanded", String(isOpen));
    }
  }

  function showView(name, { focus = false } = {}) {
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

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    setText("pageTitle", VIEWS[view][0]);
    setText("pageSubtitle", VIEWS[view][1]);
    document.title = `CSRS | ${VIEWS[view][0]}`;

    if (location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }

    setSidebar(false);
    clearMessage();

    if (focus && $("main")) $("main").focus({ preventScroll: true });

    loadView(view);
  }

  function loadView(view) {
    if (view === "overview") return loadDashboard();
    if (view === "incidents") return loadIncidents();
    if (view === "emergency") return loadEmergencies();
    if (view === "visitors") return loadVisitors();
    return Promise.resolve();
  }

  document.querySelectorAll("[data-view]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();
      showView(link.dataset.view, { focus: true });
    });
  });

  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (view !== currentView) showView(view);
  });

  if ($("menuButton")) {
    $("menuButton").addEventListener("click", () => {
      setSidebar(!$("sidebar")?.classList.contains("open"));
    });
  }

  if ($("sidebarBackdrop")) {
    $("sidebarBackdrop").addEventListener("click", () => setSidebar(false));
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("sidebar")?.classList.contains("open")) {
      setSidebar(false);
      $("menuButton")?.focus();
    }
  });

  mobileQuery.addEventListener("change", () => setSidebar(false));

  if ($("logoutButton")) {
    $("logoutButton").addEventListener("click", redirectToLogin);
  }

  if ($("refreshButton")) {
    $("refreshButton").addEventListener("click", async () => {
      const button = $("refreshButton");
      setBusy(button, true, "Refreshing...");
      try {
        await loadView(currentView);
      } finally {
        setBusy(button, false);
      }
    });
  }

  if ($("period")) {
    $("period").addEventListener("change", loadDashboard);
  }

  if ($("refreshEmergency")) {
    $("refreshEmergency").addEventListener("click", async () => {
      setBusy($("refreshEmergency"), true, "Refreshing...");
      try { await loadEmergencies(); } finally { setBusy($("refreshEmergency"), false); }
    });
  }

  if ($("refreshVisitors")) {
    $("refreshVisitors").addEventListener("click", async () => {
      setBusy($("refreshVisitors"), true, "Refreshing...");
      try { await loadVisitors(); } finally { setBusy($("refreshVisitors"), false); }
    });
  }

  // --------------------------------------------------
  // 5. DASHBOARD OVERVIEW
  // --------------------------------------------------

  function drawBars(elementId, entries) {
    const element = $(elementId);
    if (!element) return;

    const values = (Array.isArray(entries) ? entries : []).map(item => ({
      label: String(valueOf(
        item,
        "label",
        "name",
        "status",
        "category",
        "category_name",
        "severity",
        "date",
        "day",
        "location_name"
      ) || "Other"),
      value: Number(valueOf(item, "count", "total", "value") || 0)
    }));

    if (!values.length) {
      element.innerHTML = '<p class="empty-cell">No data available.</p>';
      return;
    }

    const max = Math.max(1, ...values.map(item => item.value));

    element.innerHTML = values.map(item => {
      const width = Math.max(0, Math.min(100, (item.value / max) * 100));

      return `
        <div class="chart-row">
          <span title="${escapeHTML(item.label)}">${escapeHTML(item.label)}</span>
          <div class="chart-track" role="img"
               aria-label="${escapeHTML(item.label)}: ${escapeHTML(item.value)}">
            <div class="chart-fill" style="width:${width}%"></div>
          </div>
          <span class="chart-value">${escapeHTML(formatNumber(item.value))}</span>
        </div>
      `;
    }).join("");
  }

  function resetStats() {
    ["totalIncidents", "pendingAlerts", "visitors", "highSeverity"]
      .forEach(id => setText(id, "—"));
  }

  async function loadDashboard() {
    const request = beginRequest("dashboard");

    if (!API_BASE) {
      showError(new Error("Missing backend URL in config.js."));
      return;
    }

    try {
      const days = encodeURIComponent($("period")?.value || "30");
      const data = await api(`${PATHS.dashboard}?days=${days}`);

      if (isStale("dashboard", request)) return;

      const totals = data.incidents || data.stats || {};

      setText("totalIncidents", formatNumber(valueOf(
        totals, "total", "count", "total_incidents", "total_incident"
      )));

      setText("pendingAlerts", formatNumber(valueOf(
        data, "pending_emergency_alerts", "open_alerts", "pending_alerts"
      )));

      setText("visitors", formatNumber(valueOf(
        data, "visitors_on_campus", "active_visitors", "current_visitors"
      )));

      setText("highSeverity", formatNumber(valueOf(
        totals, "open_critical", "critical", "critical_incidents"
      )));

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
                <td>${escapeHTML(valueOf(item, "location", "location_name", "name") || "Unknown")}</td>
                <td>${escapeHTML(formatNumber(valueOf(item, "count", "total")))}</td>
              </tr>
            `).join("")
          : emptyRow(2, "No incident hotspots found.")
      );

      updateUserDisplay();
      setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
      if ($("errorBox")) $("errorBox").hidden = true;
    } catch (error) {
      if (isStale("dashboard", request)) return;
      resetStats();
      showError(error);
    }
  }

  function updateUserDisplay() {
    const user = getUser();
    const username = String(user.username || user.full_name || "User");
    const role = user.role || "Staff";

    setText("welcomeName", username);
    setText("sidebarUsername", username);
    setText("sidebarRole", role);
    setText("userAvatar", username.charAt(0).toUpperCase());
  }

  // --------------------------------------------------
  // 6. INCIDENT MONITORING
  // --------------------------------------------------

  async function loadIncidents() {
    const request = beginRequest("incidents");

    setHTML("incidentsTable", emptyRow(6, "Loading incidents..."));

    try {
      const results = await Promise.all([
        api(PATHS.incidents),
        api(PATHS.categories).catch(error => {
          console.warn("CSRS: could not load categories:", error.message);
          return [];
        }),
        api(PATHS.locations).catch(error => {
          console.warn("CSRS: could not load locations:", error.message);
          return [];
        })
      ]);

      if (isStale("incidents", request)) return;

      const raw = results[0];

      incidents = rowsFrom(raw, ["incidents", "data", "items", "rows", "results"])
        .slice()
        .sort((a, b) =>
          timeOf(valueOf(b, "incident_datetime", "created_at")) -
          timeOf(valueOf(a, "incident_datetime", "created_at"))
        );

      // Diagnostics: shows what the backend actually returned.
      console.info("CSRS: GET", PATHS.incidents, "->", raw);

      if (!incidents.length && raw && typeof raw === "object" && !Array.isArray(raw)) {
        console.warn("CSRS: response has no list of incidents. Keys found:", Object.keys(raw));
        showMessage(
          `The server replied, but no incident list was found (keys: ${Object.keys(raw).join(", ") || "none"}).`,
          "error"
        );
      } else if (incidents.length) {
        console.info("CSRS: first incident fields:", Object.keys(incidents[0]));
      }

      populateSelect(
        "incidentCategory",
        rowsFrom(results[1], ["categories", "data", "items"]),
        "category_id",
        "category_name",
        "Select category"
      );

      populateSelect(
        "incidentLocation",
        rowsFrom(results[2], ["locations", "data", "items"]),
        "location_id",
        "location_name",
        "Select location"
      );

      renderIncidents();
      setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      if (isStale("incidents", request)) return;
      showError(error);
      setHTML("incidentsTable", emptyRow(6, error.message));
    }
  }

  function populateSelect(elementId, records, idKey, labelKey, placeholder) {
    const select = $(elementId);
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = `<option value="">${escapeHTML(placeholder)}</option>`;

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
              <td>${badge(item.severity)}</td>
              <td>${badge(item.status)}</td>
              <td>${escapeHTML(displayDate(item.incident_datetime))}</td>
            </tr>
          `).join("")
        : emptyRow(6, "No matching incidents found.")
    );
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
    const form = $("incidentForm");
    if (!form) return;

    form.hidden = !open;

    if ($("toggleIncidentForm")) {
      $("toggleIncidentForm").setAttribute("aria-expanded", String(open));
    }

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

  if ($("anonymousLabel") && !ALLOW_ANONYMOUS) {
    $("anonymousLabel").hidden = true;
  }

  if ($("incidentSearch")) {
    $("incidentSearch").addEventListener("input", renderIncidents);
  }

  if ($("incidentStatusFilter")) {
    $("incidentStatusFilter").addEventListener("change", renderIncidents);
  }

  if ($("toggleIncidentForm") && $("incidentForm")) {
    $("toggleIncidentForm").addEventListener("click", () => {
      setIncidentForm($("incidentForm").hidden);
    });
  }

  if ($("cancelIncidentForm") && $("incidentForm")) {
    $("cancelIncidentForm").addEventListener("click", () => {
      resetIncidentForm();
      setIncidentForm(false);
      $("toggleIncidentForm")?.focus();
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

      if (date.getTime() > Date.now() + 60000) {
        showMessage("The incident date and time cannot be in the future.", "error");
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

      requestInProgress = true;

      const submitButton = $("incidentForm").querySelector('button[type="submit"]');
      setBusy(submitButton, true, "Submitting...");

      try {
        await api(PATHS.incidents, {
          method: "POST",
          body: JSON.stringify(payload)
        });

        resetIncidentForm();
        setIncidentForm(false);

        showMessage("Incident report submitted successfully.");

        await loadIncidents();
      } catch (error) {
        showError(error);
      } finally {
        requestInProgress = false;
        setBusy(submitButton, false);
      }
    });
  }

  // --------------------------------------------------
  // 7. EMERGENCY ALERTS
  // --------------------------------------------------

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
      setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
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
              <td>${badge(item.status)}</td>
              <td>${escapeHTML(displayDate(valueOf(item, "created_at", "created_on")))}</td>
            </tr>
          `).join("")
        : emptyRow(5, "No emergency alerts found.")
    );
  }

  if ($("emergencySearch")) {
    $("emergencySearch").addEventListener("input", renderEmergencies);
  }

  if ($("emergencyStatusFilter")) {
    $("emergencyStatusFilter").addEventListener("change", renderEmergencies);
  }

  // --------------------------------------------------
  // 8. CAMPUS VISITORS
  // --------------------------------------------------

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
      setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
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
              <td>${escapeHTML(displayDate(checkoutOf(item)))}</td>
              <td>${badge(checkoutOf(item) ? "Checked out" : "On campus")}</td>
            </tr>
          `).join("")
        : emptyRow(6, "No matching visitor records found.")
    );
  }

  // The default endpoint only lists people still on campus, so the
  // "Checked out" filter would always be empty. Hide it unless the
  // configured endpoint is known to include past visitors.
  if (!VISITORS_INCLUDE_HISTORY && $("visitorStatusFilter")) {
    const option = $("visitorStatusFilter").querySelector('option[value="checked-out"]');
    if (option) option.remove();
  }

  if ($("visitorSearch")) {
    $("visitorSearch").addEventListener("input", renderVisitors);
  }

  if ($("visitorStatusFilter")) {
    $("visitorStatusFilter").addEventListener("change", renderVisitors);
  }

  // --------------------------------------------------
  // 9. START APPLICATION
  // --------------------------------------------------

  function start() {
    if (!sessionStorage.getItem("csrs_token")) {
      redirectToLogin();
      return;
    }

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