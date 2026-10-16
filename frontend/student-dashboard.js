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

  $("profileUsername").textContent = user.username || "Not available";
  $("profileEmail").textContent = user.email || "Not available";
  $("profileRole").textContent = roleLabel(role);

  $("logoutLink").addEventListener("click", (event) => {
    event.preventDefault();
    logout();
  });

  $("refreshButton").addEventListener("click", loadPortal);
  $("refreshItemsButton").addEventListener("click", loadLostAndFound);
  $("emergencyButton").addEventListener("click", submitEmergencyAlert);

  setupSectionNav();
  loadPortal();
  loadProfile();
}

function setupSectionNav() {
  const links = {};
  document.querySelectorAll('.nav-item[href^="#"]').forEach((anchor) => {
    const id = anchor.getAttribute("href").slice(1);
    if (id) links[id] = anchor;
  });

  function setActive(id) {
    Object.keys(links).forEach((key) => {
      const on = key === id;
      links[key].classList.toggle("active", on);
      if (on) links[key].setAttribute("aria-current", "page");
      else links[key].removeAttribute("aria-current");
    });
  }

  if (!("IntersectionObserver" in window)) return;

  const ids = ["overview", "my-reports", "found-items", "emergency", "profile"];
  const visible = {};
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visible[entry.target.id] = entry.isIntersecting;
    });
    const current = ids.find((id) => id !== "overview" && visible[id]) || "overview";
    setActive(current);
  }, { rootMargin: "-20% 0px -60% 0px" });

  ids.slice(1).forEach((id) => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
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
    body.appendChild(row);
  });
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
