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
    statusCell,
    addCell,
    emptyRow,
    setLoading,
    getDeviceLocation
  } = C;

  const setText = (id, value) => {
    const element = $(id);
    if (element) element.textContent = value ?? "";
  };

  const showMessage = (id, message, show = true) => {
    const element = $(id);
    if (!element) return;

    element.textContent = message;
    element.hidden = !show;
  };

  const safeArray = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.incidents)) return data.incidents;
    if (Array.isArray(data?.items)) return data.items;
    return null;
  };

  if (!requireAuth()) return;

  if (!isPortalRole()) {
    window.location.replace(homePath());
    return;
  }

  initPortal();

  function initPortal() {
    const user = getUser() || {};
    const role = roleOf(user);
    const isStaff = role === "staff";

    setText("welcome", `Welcome, ${user.username || "User"} · ${roleLabel(role)}`);
    setText("portalHeading", isStaff ? "Staff portal" : "Student dashboard");
    setText(
      "portalBannerTitle",
      isStaff
        ? "Campus safety tools for staff"
        : "Welcome to your campus safety portal"
    );

    document.title = isStaff
      ? "CSRS | Staff Portal"
      : "CSRS | Student Dashboard";

    setText("profileUsername", user.username || "Not available");
    setText("profileEmail", user.email || "Not available");
    setText("profileRole", roleLabel(role));

    // Hide anything this role may not use, and keep start-hidden panels closed.
    document.querySelectorAll("[data-role-any]").forEach((element) => {
      const allowed = element.dataset.roleAny
        .split(",")
        .map((value) => value.trim());

      if (!allowed.includes(role) || element.hasAttribute("data-start-hidden")) {
        element.hidden = true;
      }
    });

    $("logoutLink")?.addEventListener("click", (event) => {
      event.preventDefault();
      logout();
    });

    $("refreshButton")?.addEventListener("click", () => loadPortal(true));
    $("emergencyButton")?.addEventListener("click", submitEmergencyAlert);

    $("closeReportDetails")?.addEventListener("click", () => {
      const panel = $("report-details");
      if (panel) panel.hidden = true;
    });

    $("closeIncidentWorkspace")?.addEventListener("click", () => {
      closeWorkspace($("incident-workspace"));
    });

    document.querySelectorAll("[data-open-report]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        openWorkspace($("incident-workspace"));
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;

      const workspace = document.querySelector(".workspace-overlay:not([hidden])");
      if (workspace) closeWorkspace(workspace);
    });

    setupSectionNav();

    loadPortal();
    loadProfile();
  }

  // --------------------------------------------------
  // Navigation: updates the content area only.
  // --------------------------------------------------

  function setupSectionNav() {
    const links = document.querySelectorAll(".nav-item[data-view]");
    const views = document.querySelectorAll(
      "[data-dashboard-view]:not([data-view-detail])"
    );
    const validViews = ["overview", "reports", "emergency", "lost-found", "profile"];

    function showView(view, updateUrl = true) {
      const selectedView = validViews.includes(view) ? view : "overview";

      document.body.classList.toggle("lost-found-mode", selectedView === "lost-found");

      // Close the report details panel when changing sections.
      const details = $("report-details");
      if (details) details.hidden = true;

      views.forEach((element) => {
        const selected = element.dataset.dashboardView === selectedView;

        element.hidden = !selected;
        element.classList.toggle("dashboard-view-hidden", !selected);
      });

      links.forEach((link) => {
        const active = link.dataset.view === selectedView;

        link.classList.toggle("active", active);

        if (active) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      });

      if (updateUrl) {
        history.replaceState(null, "", `#${selectedView}`);
      }
    }

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        showView(link.dataset.view);
      });
    });

    window.addEventListener("hashchange", () => {
      showView(window.location.hash.slice(1), false);
    });

    showView(window.location.hash.slice(1), false);
  }

  // --------------------------------------------------
  // Workspace handling
  // --------------------------------------------------

  function openWorkspace(workspace) {
    if (!workspace) return;

    workspace.classList.add("workspace-overlay");
    workspace.hidden = false;
    document.body.classList.add("workspace-open");
  }

  function closeWorkspace(workspace) {
    if (!workspace) return;

    workspace.hidden = true;
    workspace.classList.remove("workspace-overlay");

    if (!document.querySelector(".workspace-overlay:not([hidden])")) {
      document.body.classList.remove("workspace-open");
    }
  }

  // --------------------------------------------------
  // Profile
  // --------------------------------------------------

  async function loadProfile() {
    try {
      const me = await api("/api/auth/me");

      setText("profileUsername", me.username || me.full_name || "Not available");
      setText("profileEmail", me.email || "Not available");
      setText("profileRole", roleLabel(me.role));

      if (me.full_name) {
        setText("welcome", `Welcome, ${me.full_name} · ${roleLabel(me.role)}`);
      }
    } catch (error) {
      console.warn("Could not refresh profile information:", error);
    }
  }

  // --------------------------------------------------
  // Dashboard refresh
  // --------------------------------------------------

  async function loadPortal(manual = false) {
    showMessage("errorBox", "", false);
    showMessage("noticeBox", "", false);

    const button = $("refreshButton");

    if (button) {
      setLoading(button, true, "Refresh Dashboard", "Loading...");
    }

    const results = await Promise.allSettled([
      loadMyReports(),
      loadLostItemCount()
    ]);

    const failed = results.filter((result) => result.status === "rejected");

    if (failed.length) {
      const message = failed
        .map((result) => result.reason?.message)
        .filter(Boolean)
        .join(" ");

      showMessage("errorBox", message || "Some dashboard information could not be loaded.");
    } else if (manual) {
      showMessage("noticeBox", "Your portal has been updated.");
    }

    if (button) {
      setLoading(button, false, "Refresh Dashboard");
    }
  }

  function closedStatus(status) {
    return ["closed", "resolved", "rejected", "duplicate"].includes(
      String(status || "").trim().toLowerCase()
    );
  }

  // --------------------------------------------------
  // Incident reports
  // --------------------------------------------------

  async function loadMyReports() {
    const response = await api("/api/incidents");
    const reports = safeArray(response);

    if (!reports) {
      throw new Error("The incidents API returned an unexpected response.");
    }

    setText("totalReports", reports.length.toLocaleString());
    setText(
      "openReports",
      reports.filter((report) => !closedStatus(report.status)).length.toLocaleString()
    );

    renderMyReports(reports);
  }

  function renderMyReports(reports) {
    const body = $("reportsBody");
    if (!body) return;

    body.replaceChildren();

    if (!reports.length) {
      body.appendChild(emptyRow(6, "You have not submitted any incident reports yet."));
      return;
    }

    reports.forEach((report) => {
      const row = document.createElement("tr");

      addCell(row, report.reference_no || report.id || "—");
      addCell(row, report.category || report.category_name || "—");
      addCell(row, report.severity || "—");

      row.appendChild(statusCell(report.status));

      addCell(
        row,
        formatDate(
          report.reported_datetime || report.incident_datetime || report.created_at,
          true
        )
      );

      const actionCell = document.createElement("td");
      const button = document.createElement("button");

      button.type = "button";
      button.className = "button";
      button.textContent = "Track report";
      button.addEventListener("click", () => {
        loadReportDetails(report.id || report.incident_id);
      });

      actionCell.appendChild(button);
      row.appendChild(actionCell);
      body.appendChild(row);
    });
  }

  async function loadReportDetails(id) {
    if (!id) {
      showMessage("errorBox", "This report has no available ID.");
      return;
    }

    const panel = $("report-details");
    const summary = $("reportDetailsSummary");
    const details = $("reportDetailsBody");

    if (!panel || !summary || !details) return;

    panel.hidden = false;
    summary.textContent = "Loading report history...";
    details.replaceChildren();

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

      const heading = document.createElement("h3");
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

  // --------------------------------------------------
  // Lost items count (the Lost & Found page has its own workspace)
  // --------------------------------------------------

  async function loadLostItemCount() {
    try {
      const items = safeArray(await api("/api/lost-found/lost"));
      setText("lostItems", items ? items.length.toLocaleString() : "—");
    } catch (error) {
      setText("lostItems", "—");
      console.warn("Could not load lost items:", error);
    }
  }

  // --------------------------------------------------
  // Emergency assistance
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
    } catch (error) {
      result.textContent = error.message || "Unable to send the emergency alert.";
    } finally {
      setLoading(button, false, "Request Emergency Assistance");
    }
  }
})();