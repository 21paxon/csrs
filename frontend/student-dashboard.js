// Purpose: Browser-side behavior for the student dashboard workflow.
(() => {
  "use strict";

  const C = window.CSRS;

  if (!C) {
    console.error("CSRS helper library was not loaded. Check /js/csrs.js.");
    return;
  }

  const {
    $,
    requireAuth,
    getUser,
    roleOf,
    roleLabel,
    isPortalRole,
    homePath,
    logout,
    api,
    formatDate,
    setLoading,
    getDeviceLocation
  } = C;

  if (!requireAuth()) return;

  if (!isPortalRole()) {
    window.location.replace(homePath());
    return;
  }

  // --------------------------------------------------
  // 1. SETUP
  // --------------------------------------------------

  const user = getUser() || {};
  const role = roleOf(user);
  const isStaff = role === "staff";

  const VIEWS = {
    overview: [
      isStaff ? "Staff Portal" : "Student Dashboard",
      "Your campus safety overview"
    ],
    reports: ["My Reports", "Track the incidents you have reported"],
    emergency: ["Emergency Centre", "Request urgent help from campus security"],
    "lost-found": ["Lost & Found", "Report lost items and check found property"],
    profile: ["My Profile", "Your account details"]
  };

  let currentView = "overview";
  let portalRequest = 0;

  // --------------------------------------------------
  // 2. HELPERS
  // --------------------------------------------------

  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value ?? "";
  };

  function showMessage(message, type = "success") {
    const box = $(type === "error" ? "errorBox" : "noticeBox");
    const other = $(type === "error" ? "noticeBox" : "errorBox");

    if (other) other.hidden = true;

    if (box) {
      box.textContent = message;
      box.hidden = false;
    }
  }

  function clearMessage() {
    if ($("errorBox")) $("errorBox").hidden = true;
    if ($("noticeBox")) $("noticeBox").hidden = true;
  }

  const safeArray = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.incidents)) return data.incidents;
    if (Array.isArray(data?.items)) return data.items;
    return null;
  };

  const slug = (value) =>
    String(value ?? "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

  const timeOf = (value) => {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  const closedStatus = (status) =>
    ["closed", "resolved", "rejected", "duplicate"].includes(
      String(status || "").trim().toLowerCase()
    );

  function cell(row, text) {
    const td = document.createElement("td");
    td.textContent = text;
    row.appendChild(td);
    return td;
  }

  function badgeCell(row, value) {
    const td = document.createElement("td");
    const text = String(value ?? "").trim();

    if (text) {
      const span = document.createElement("span");
      span.className = `badge ${slug(text)}`;
      span.textContent = text;
      td.appendChild(span);
    } else {
      td.textContent = "—";
    }

    row.appendChild(td);
  }

  function emptyRow(columns, message) {
    const row = document.createElement("tr");
    const td = document.createElement("td");

    td.colSpan = columns;
    td.className = "empty-cell";
    td.textContent = message;
    row.appendChild(td);

    return row;
  }

  // --------------------------------------------------
  // 3. SIDEBAR AND NAVIGATION (same behaviour as the security dashboard)
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

    document.querySelectorAll("[data-view-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== view;
    });

    document.querySelectorAll(".nav-link[data-view]").forEach((link) => {
      const active = link.dataset.view === view;

      link.classList.toggle("active", active);

      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    const translationKeys = {
      overview: ["student_dashboard", "student_overview_description"],
      reports: ["my_reports", "student_reports_description"],
      emergency: ["emergency_centre", "student_emergency_description"],
      "lost-found": ["dashboard_lost_found", "dashboard_lost_found_description"],
      profile: ["profile", "student_profile_description"]
    };
    const strings = window.CSRS_TRANSLATIONS || {};
    const keys = translationKeys[view];
    const title = strings[keys[0]] || VIEWS[view][0];
    setText("pageTitle", title);
    setText("pageSubtitle", strings[keys[1]] || VIEWS[view][1]);
    document.title = `CSRS | ${title}`;

    if (location.hash !== `#${view}`) {
      history.replaceState(null, "", `#${view}`);
    }

    if ($("reportDetails")) $("reportDetails").hidden = true;
    if (view === "lost-found") loadLostFound();

    setSidebar(false);
    clearMessage();

    if (focus && $("main")) $("main").focus({ preventScroll: true });
  }

  window.addEventListener("csrs:language-changed", () => showView(currentView));

  document.querySelectorAll("[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showView(link.dataset.view, { focus: true });
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("sidebar")?.classList.contains("open")) {
      setSidebar(false);
      $("menuButton")?.focus();
    }
  });

  mobileQuery.addEventListener("change", () => setSidebar(false));

  $("topLogoutButton")?.addEventListener("click", () => logout());
  $("refreshButton")?.addEventListener("click", () => loadPortal(true));

  // --------------------------------------------------
  // 4. USER DETAILS
  // --------------------------------------------------

  function showUser(details) {
    const name = String(details.full_name || details.username || "User");
    const roleName = roleLabel(details.role || role);

    setText("welcomeName", name);
    setText("sidebarUsername", name);
    setText("sidebarRole", roleName);
    setText("userAvatar", name.charAt(0).toUpperCase());

    setText("profileUsername", details.username || details.full_name || "Not available");
    setText("profileEmail", details.email || "Not available");
    setText("profileRole", roleName);
  }

  async function loadProfile() {
    try {
      const me = await api("/api/auth/me");
      showUser({ ...user, ...me });
    } catch (error) {
      console.warn("Could not refresh profile information:", error);
    }
  }

  // --------------------------------------------------
  // 5. PORTAL DATA
  // --------------------------------------------------

  async function loadPortal(manual = false) {
    const request = ++portalRequest;
    const button = $("refreshButton");

    clearMessage();

    if (button) setLoading(button, true, "Refresh", "Refreshing...");

    const results = await Promise.allSettled([
      loadMyReports(request),
      loadLostItemCount(request)
    ]);

    if (request === portalRequest) {
      const failed = results.filter((result) => result.status === "rejected");

      if (failed.length) {
        showMessage(
          failed.map((result) => result.reason?.message).filter(Boolean).join(" ") ||
            "Some dashboard information could not be loaded.",
          "error"
        );
      } else {
        if (manual) showMessage("Your portal has been updated.");
        setText("lastUpdated", `Updated ${new Date().toLocaleTimeString()}`);
      }
    }

    if (button) setLoading(button, false, "Refresh");
  }

  async function loadMyReports(request) {
    const reports = safeArray(await api("/api/incidents"));

    if (request !== portalRequest) return;

    if (!reports) {
      throw new Error("The incidents API returned an unexpected response.");
    }

    reports.sort(
      (a, b) =>
        timeOf(b.reported_datetime || b.incident_datetime || b.created_at) -
        timeOf(a.reported_datetime || a.incident_datetime || a.created_at)
    );

    setText("totalReports", reports.length.toLocaleString());
    setText(
      "openReports",
      reports.filter((report) => !closedStatus(report.status)).length.toLocaleString()
    );

    renderReports(reports);
  }

  async function loadLostItemCount(request) {
    try {
      const items = safeArray(await api("/api/lost-found/lost"));

      if (request !== portalRequest) return;

      setText("lostItems", items ? items.length.toLocaleString() : "—");
    } catch (error) {
      if (request !== portalRequest) return;

      setText("lostItems", "—");
      console.warn("Could not load lost items:", error);
    }
  }

  function fillSelect(select, records, placeholder) {
    if (!select) return;
    select.replaceChildren(new Option(placeholder, ""));
    records.forEach((record) => select.add(new Option(record.name, record.id)));
  }

  async function loadIncidentOptions() {
    try {
      const [categories, locations] = await Promise.all([
        api("/api/categories"),
        api("/api/locations")
      ]);
      fillSelect($("incidentCategory"), safeArray(categories) || [], "Select category");
      fillSelect($("incidentLocation"), safeArray(locations) || [], "Select campus location");
    } catch (error) {
      const message = $("incidentFormMessage");
      if (message) message.textContent = `Could not load categories and locations: ${error.message}`;
    }
  }

  $("dashboardIncidentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("incidentSubmit");
    const message = $("incidentFormMessage");
    if (!form.reportValidity() || button.disabled) return;

    setLoading(button, true, "Submit incident", "Submitting...");
    if (message) message.textContent = "Submitting incident...";
    try {
      const files = $("incidentEvidence").files;
      let incident;
      if (files.length) {
        const body = new FormData();
        body.append("category_id", $("incidentCategory").value);
        body.append("location_id", $("incidentLocation").value);
        body.append("incident_datetime", new Date($("incidentDate").value).toISOString());
        body.append("severity", $("incidentSeverity").value);
        body.append("description", $("incidentDescription").value.trim());
        body.append("is_anonymous", $("incidentAnonymous").checked ? "true" : "false");
        Array.from(files).slice(0, 5).forEach((file) => body.append("evidence", file));
        incident = await api("/api/incidents", { method: "POST", body });
      } else {
        incident = await api("/api/incidents", {
          method: "POST",
          body: JSON.stringify({
            category_id: Number($("incidentCategory").value),
            location_id: Number($("incidentLocation").value),
            incident_datetime: new Date($("incidentDate").value).toISOString(),
            severity: $("incidentSeverity").value,
            description: $("incidentDescription").value.trim(),
            is_anonymous: $("incidentAnonymous").checked
          })
        });
      }
      form.reset();
      if (message) message.textContent = `Incident submitted. Reference: ${incident.reference_no || "Not provided"}${incident.access_code ? ` | Anonymous access code: ${incident.access_code} (save this code to track the report)` : ""}`;
      await loadPortal();
    } catch (error) {
      if (message) message.textContent = `Submission failed: ${error.message}`;
    } finally {
      setLoading(button, false, "Submit incident");
    }
  });

  function renderLostFoundRows(id, items, found = false) {
    const body = $(id);
    if (!body) return;
    body.replaceChildren();
    if (!items.length) {
      body.appendChild(emptyRow(5, found ? "No open found items are listed." : "No lost-item reports found."));
      return;
    }
    items.forEach((item) => {
      const row = document.createElement("tr");
      const values = found
        ? [item.item_name || item.title, item.category, item.location_found, formatDate(item.date_found), item.description]
        : [item.item_name || item.title, item.category, item.location_lost, formatDate(item.date_lost), item.status];
      values.forEach((value) => cell(row, value == null || value === "" ? "—" : String(value)));
      body.appendChild(row);
    });
  }

  let lostFoundRequest = 0;
  async function loadLostFound() {
    const request = ++lostFoundRequest;
    const message = $("lostFoundMessage");
    if (message) message.textContent = "Loading lost and found items...";
    const results = await Promise.allSettled([
      api("/api/lost-found/lost"),
      api("/api/lost-found/found")
    ]);
    if (request !== lostFoundRequest) return;
    if (results[0].status === "fulfilled") renderLostFoundRows("studentLostRows", safeArray(results[0].value) || []);
    if (results[1].status === "fulfilled") renderLostFoundRows("studentFoundRows", safeArray(results[1].value) || [], true);
    const errors = results.filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || "Could not load items.");
    if (message) message.textContent = errors.length ? errors.join(" ") : "Lost and found items are up to date.";
  }

  $("dashboardLostForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $("lostItemSubmit");
    if (!form.reportValidity() || button.disabled) return;
    setLoading(button, true, "Submit lost-item report", "Submitting...");
    const message = $("lostFoundMessage");
    if (message) message.textContent = "Submitting lost-item report...";
    try {
      await api("/api/lost-found/lost", { method: "POST", body: new FormData(form) });
      form.reset();
      await loadLostFound();
      await loadPortal();
      if (message) message.textContent = "Lost-item report submitted.";
    } catch (error) {
      const detail = error.message === "Not found"
        ? "The live server is missing POST /api/lost-found/lost. Deploy the latest backend code, then retry."
        : error.message;
      if (message) message.textContent = `Could not submit report: ${detail}`;
    } finally {
      setLoading(button, false, "Submit lost-item report");
    }
  });

  $("lostItemsTab")?.addEventListener("click", () => {
    $("studentLostPanel").hidden = false;
    $("studentFoundPanel").hidden = true;
    $("lostItemsTab").setAttribute("aria-selected", "true");
    $("foundItemsTab").setAttribute("aria-selected", "false");
  });
  $("foundItemsTab")?.addEventListener("click", () => {
    $("studentLostPanel").hidden = true;
    $("studentFoundPanel").hidden = false;
    $("lostItemsTab").setAttribute("aria-selected", "false");
    $("foundItemsTab").setAttribute("aria-selected", "true");
  });
  $("refreshLostFound")?.addEventListener("click", loadLostFound);

  function renderReports(reports) {
    const body = $("reportsBody");
    if (!body) return;

    body.replaceChildren();

    if (!reports.length) {
      body.appendChild(emptyRow(6, "You have not submitted any incident reports yet."));
      return;
    }

    reports.forEach((report) => {
      const row = document.createElement("tr");

      cell(row, report.reference_no || report.id || "—");
      cell(row, report.category || report.category_name || "—");
      badgeCell(row, report.severity);
      badgeCell(row, report.status);
      cell(
        row,
        formatDate(
          report.reported_datetime || report.incident_datetime || report.created_at,
          true
        )
      );

      const actionCell = document.createElement("td");
      const button = document.createElement("button");

      button.type = "button";
      button.className = "button secondary";
      button.textContent = "Track report";
      button.addEventListener("click", () => {
        loadReportDetails(report.id || report.incident_id);
      });

      actionCell.appendChild(button);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  // --------------------------------------------------
  // 6. REPORT TRACKING
  // --------------------------------------------------

  async function loadReportDetails(id) {
    if (!id) {
      showMessage("This report has no available ID.", "error");
      return;
    }

    const panel = $("reportDetails");
    const summary = $("reportDetailsSummary");
    const details = $("reportDetailsBody");

    if (!panel || !summary || !details) return;

    panel.hidden = false;
    summary.textContent = "Loading report history...";
    details.replaceChildren();
    panel.focus({ preventScroll: false });

    try {
      const report = await api("/api/incidents/" + encodeURIComponent(id));

      summary.textContent =
        `${report.reference_no || "Incident"} · ${report.status || "Status unavailable"}`;

      const overview = document.createElement("p");
      overview.className = "subtitle";
      overview.textContent =
        `Severity: ${report.severity || "Not set"} · Reported: ${
          formatDate(report.reported_datetime || report.incident_datetime, true)
        }`;
      details.appendChild(overview);

      const heading = document.createElement("h4");
      heading.className = "section-label";
      heading.textContent = "Status history";
      details.appendChild(heading);

      const updates = Array.isArray(report.updates) ? report.updates : [];

      if (!updates.length) {
        const message = document.createElement("p");
        message.className = "subtitle";
        message.textContent = "No status updates have been recorded yet.";
        details.appendChild(message);
        return;
      }

      const list = document.createElement("ol");
      list.className = "report-history";

      updates.forEach((update) => {
        const item = document.createElement("li");

        item.textContent =
          `${formatDate(update.created_at, true)} · ${update.new_status || "Update"}${
            update.note ? " — " + update.note : ""
          }`;

        list.appendChild(item);
      });

      details.appendChild(list);
    } catch (error) {
      summary.textContent = "Could not load report tracking.";

      const message = document.createElement("p");
      message.className = "message error";
      message.textContent =
        error.message || "An error occurred while loading this report.";
      details.appendChild(message);
    }
  }

  $("closeReportDetails")?.addEventListener("click", () => {
    if ($("reportDetails")) $("reportDetails").hidden = true;
  });

  // --------------------------------------------------
  // 7. NEW INCIDENT REPORT
  // --------------------------------------------------

  function setReportForm(open) {
    const panel = $("reportFormPanel");
    if (!panel) return;

    panel.hidden = !open;
    $("newReportButton")?.setAttribute("aria-expanded", String(open));

    if (open) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      // Pick up anything that was just submitted.
      loadPortal();
    }
  }

  $("newReportButton")?.addEventListener("click", () => {
    setReportForm($("reportFormPanel")?.hidden !== false);
  });

  $("closeReportForm")?.addEventListener("click", () => {
    setReportForm(false);
    $("newReportButton")?.focus();
  });

  $("reportAction")?.addEventListener("click", (event) => {
    event.preventDefault();
    showView("reports", { focus: true });
    setReportForm(true);
  });

  // --------------------------------------------------
  // 8. EMERGENCY ASSISTANCE
  // --------------------------------------------------

  async function submitEmergencyAlert() {
    const button = $("emergencyButton");
    const result = $("emergencyResult");
    const messageField = $("emergencyMessage");

    if (!button || !result || !messageField) return;

    if (
      !window.confirm(
        "Do you need urgent campus security assistance? This will send an emergency alert."
      )
    ) {
      return;
    }

    setLoading(button, true, "Request Emergency Assistance", "Sending Alert...");
    result.textContent = "Sending alert...";

    try {
      let coords = null;

      try {
        coords = await getDeviceLocation();
      } catch {
        // Location permission is optional.
      }

      const payload = {
        message: messageField.value.trim() || "Emergency assistance requested"
      };

      if (coords) {
        payload.latitude = coords.latitude;
        payload.longitude = coords.longitude;
      }

      const alert = await api("/api/emergency", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      result.textContent =
        "Emergency alert sent successfully." +
        (alert?.id ? ` Alert ID: ${alert.id}.` : "") +
        (coords
          ? " Your location was attached."
          : " Your location was not available.") +
        " Please follow campus security instructions.";

      messageField.value = "";
      loadMyEmergencyAlerts();
    } catch (error) {
      result.textContent = error.message || "Unable to send the emergency alert.";
    } finally {
      setLoading(button, false, "Request Emergency Assistance");
    }
  }

  $("emergencyButton")?.addEventListener("click", submitEmergencyAlert);

  // Load only the signed-in user's emergency requests and response status.
  function emergencyStatusDescription(status) {
    return ({
      Triggered: "Sent — waiting for campus security to respond.",
      Acknowledged: "Security has received your request and is responding.",
      Arrived: "Security has arrived at the reported location.",
      Resolved: "Resolved — the response has been completed."
    })[status] || status || "Status unavailable";
  }

  async function loadMyEmergencyAlerts() {
    const body = $("myEmergencyRows");
    const message = $("myEmergencyMessage");
    if (!body || !message) return;

    message.textContent = "Loading your emergency requests...";
    body.innerHTML = '<tr><td colspan="5" class="empty-cell">Loading...</td></tr>';

    try {
      const alerts = safeArray(await api("/api/emergency/mine")) || [];
      if (!alerts.length) {
        message.textContent = "Your emergency requests and their response updates will appear here.";
        body.innerHTML = '<tr><td colspan="5" class="empty-cell">You have not sent an emergency alert.</td></tr>';
        return;
      }

      message.textContent = "Status updates are provided by campus security.";
      body.replaceChildren(...alerts.map((alert) => {
        const row = document.createElement("tr");
        const details = alert.message || "Emergency assistance requested";
        const location = alert.lat != null && alert.lng != null
          ? `${Number(alert.lat).toFixed(5)}, ${Number(alert.lng).toFixed(5)}`
          : "Location not available";
        const updatedAt = alert.resolved_at || alert.arrived_at || alert.acknowledged_at || alert.triggered_at;
        const cells = [
          `Alert #${alert.id}`,
          details,
          location,
          emergencyStatusDescription(alert.status),
          updatedAt ? new Date(updatedAt).toLocaleString() : "—"
        ];
        for (const value of cells) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }
        return row;
      }));
    } catch (error) {
      message.textContent = error.message || "Unable to load your emergency status.";
      body.innerHTML = '<tr><td colspan="5" class="empty-cell">Status could not be loaded.</td></tr>';
    }
  }

  $("refreshMyEmergencies")?.addEventListener("click", loadMyEmergencyAlerts);

  // --------------------------------------------------
  // 9. START
  // --------------------------------------------------

  setSidebar(false);
  showUser(user);
  loadIncidentOptions();
  showView(location.hash.slice(1) || "overview");
  loadPortal();
  loadMyEmergencyAlerts();
  loadProfile();
})();
