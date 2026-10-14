
// ============================================
// CSRS - Student Dashboard
// Rwanda Polytechnic, Musanze College
// ============================================

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

// ============================================
// Authentication
// ============================================

function logout() {
  sessionStorage.removeItem("csrs_token");
  sessionStorage.removeItem("csrs_user");
  window.location.replace("/index.html");
}

$("logoutLink").addEventListener("click", event => {
  event.preventDefault();
  logout();
});

if (!token) {
  window.location.replace("/index.html");
} else {
  $("welcome").textContent =
    `Welcome, ${currentUser.username || "Student"}`;

  $("profileUsername").textContent =
    currentUser.username || "Not available";

  $("profileEmail").textContent =
    currentUser.email || "Not available";

  $("profileRole").textContent =
    currentUser.role || "Student";

  loadStudentDashboard();
}

// ============================================
// API Helper
// ============================================

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    throw new Error("Your session has expired. Please log in again.");
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed with status ${response.status}`
    );
  }

  return data;
}

// ============================================
// General Helpers
// ============================================

function displayDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function textValue(value, fallback = "—") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  return String(value);
}

function normalise(value) {
  return String(value || "").trim().toLowerCase();
}

function createCell(value, className = "") {
  const cell = document.createElement("td");

  if (className) {
    cell.className = className;
  }

  cell.textContent = textValue(value);

  return cell;
}

function createStatus(value) {
  const cell = document.createElement("td");
  const badge = document.createElement("span");

  const status = textValue(value, "Unknown");

  badge.className = "status";

  const cssStatus = normalise(status).replace(/\s+/g, "-");

  if (
    ["closed", "resolved", "returned", "found"].includes(cssStatus)
  ) {
    badge.classList.add("closed");
  } else if (
    ["pending", "open", "triggered", "escalated"].includes(cssStatus)
  ) {
    badge.classList.add("pending");
  } else if (
    ["rejected", "critical"].includes(cssStatus)
  ) {
    badge.classList.add("critical");
  }

  badge.textContent = status;
  cell.appendChild(badge);

  return cell;
}

function showTableMessage(elementId, message, columnCount = 4) {
  const body = $(elementId);
  body.replaceChildren();

  const row = document.createElement("tr");
  const cell = document.createElement("td");

  cell.colSpan = columnCount;
  cell.className = "empty";
  cell.textContent = message;

  row.appendChild(cell);
  body.appendChild(row);
}

function showError(message) {
  $("errorBox").textContent = message;
  $("errorBox").hidden = false;
}

function showNotice(message) {
  $("noticeBox").textContent = message;
  $("noticeBox").hidden = false;
}

// ============================================
// Load Dashboard
// ============================================

$("refreshButton").addEventListener(
  "click",
  loadStudentDashboard
);

$("refreshItemsButton").addEventListener(
  "click",
  loadLostAndFound
);

async function loadStudentDashboard() {
  if (!token) return;

  $("errorBox").hidden = true;
  $("noticeBox").hidden = true;

  const button = $("refreshButton");
  button.disabled = true;
  button.textContent = "Loading...";

  try {
    await loadMyReports();
    await loadLostAndFound();

    showNotice("Your student dashboard has been updated.");
  } catch (error) {
    console.error("Student dashboard error:", error);
    showError(error.message || "Could not load dashboard information.");
  } finally {
    button.disabled = false;
    button.textContent = "Refresh Dashboard";
  }
}

// ============================================
// My Incident Reports
// GET /api/incidents
// ============================================

async function loadMyReports() {
  const reports = await apiRequest("/api/incidents");

  if (!Array.isArray(reports)) {
    throw new Error("The incidents API returned an unexpected response.");
  }

  $("totalReports").textContent = reports.length.toLocaleString();

  const openCount = reports.filter(report => {
    return normalise(report.status) !== "closed";
  }).length;

  $("openReports").textContent = openCount.toLocaleString();

  renderMyReports(reports);
}

function renderMyReports(reports) {
  const body = $("reportsBody");
  body.replaceChildren();

  if (!reports.length) {
    showTableMessage(
      "reportsBody",
      "You have not submitted any incident reports yet.",
      5
    );
    return;
  }

  reports.forEach(report => {
    const row = document.createElement("tr");

    row.appendChild(
      createCell(
        report.reference_no || report.reference || report.id
      )
    );

    row.appendChild(
      createCell(
        report.category_name ||
        report.category ||
        report.category_title
      )
    );

    row.appendChild(
      createCell(report.severity)
    );

    row.appendChild(
      createStatus(report.status)
    );

    row.appendChild(
      createCell(
        displayDate(
          report.reported_datetime ||
          report.created_at
        )
      )
    );

    body.appendChild(row);
  });
}

// ============================================
// Lost and Found
// GET /api/lost-found/lost
// GET /api/lost-found/found
// ============================================

async function loadLostAndFound() {
  const results = await Promise.allSettled([
    apiRequest("/api/lost-found/lost"),
    apiRequest("/api/lost-found/found")
  ]);

  const lostResult = results[0];
  const foundResult = results[1];

  if (lostResult.status === "fulfilled") {
    const lostItems = lostResult.value;

    if (!Array.isArray(lostItems)) {
      showTableMessage(
        "lostBody",
        "Unexpected response from the lost-items service."
      );
      $("lostItems").textContent = "—";
    } else {
      $("lostItems").textContent = lostItems.length.toLocaleString();
      renderLostItems(lostItems);
    }
  } else {
    showTableMessage(
      "lostBody",
      "Could not load your lost items."
    );

    $("lostItems").textContent = "—";
    console.error("Lost items error:", lostResult.reason);
  }

  if (foundResult.status === "fulfilled") {
    const foundItems = foundResult.value;

    if (Array.isArray(foundItems)) {
      renderFoundItems(foundItems);
    } else {
      showTableMessage(
        "foundBody",
        "Unexpected response from the found-items service."
      );
    }
  } else {
    showTableMessage(
      "foundBody",
      "Could not load found items."
    );

    console.error("Found items error:", foundResult.reason);
  }
}

function renderLostItems(items) {
  const body = $("lostBody");
  body.replaceChildren();

  if (!items.length) {
    showTableMessage(
      "lostBody",
      "You have not reported any lost items.",
      4
    );
    return;
  }

  items.forEach(item => {
    const row = document.createElement("tr");

    row.appendChild(
      createCell(item.item_name || item.title)
    );

    row.appendChild(
      createCell(item.location_lost || item.location_text)
    );

    row.appendChild(
      createCell(
        displayDate(item.date_lost || item.event_date)
      )
    );

    row.appendChild(
      createStatus(item.status)
    );

    body.appendChild(row);
  });
}

function renderFoundItems(items) {
  const body = $("foundBody");
  body.replaceChildren();

  if (!items.length) {
    showTableMessage(
      "foundBody",
      "No found items are currently available.",
      4
    );
    return;
  }

  items.forEach(item => {
    const row = document.createElement("tr");

    row.appendChild(
      createCell(item.item_name || item.title)
    );

    row.appendChild(
      createCell(item.description, "description")
    );

    row.appendChild(
      createCell(
        item.location_found || item.location_text
      )
    );

    row.appendChild(
      createCell(
        displayDate(item.date_found || item.event_date)
      )
    );

    body.appendChild(row);
  });
}

// ============================================
// Emergency Centre
// POST /api/emergency
// ============================================

$("emergencyButton").addEventListener(
  "click",
  submitEmergencyAlert
);

async function submitEmergencyAlert() {
  const button = $("emergencyButton");
  const result = $("emergencyResult");
  const message = $("emergencyMessage").value.trim();

  const confirmed = window.confirm(
    "Do you need urgent campus security assistance? " +
    "This will send an emergency alert to campus security."
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Sending Alert...";
  result.textContent = "";

  try {
    const alert = await apiRequest("/api/emergency", {
      method: "POST",
      body: JSON.stringify({
        message: message || "Emergency assistance requested"
      })
    });

    result.textContent =
      `Emergency alert sent successfully. Alert ID: ${alert.id}. ` +
      "Campus security has been notified.";

    $("emergencyMessage").value = "";
  } catch (error) {
    console.error("Emergency alert error:", error);

    result.textContent =
      error.message || "Unable to send the emergency alert.";
  } finally {
    button.disabled = false;
    button.textContent = "Request Emergency Assistance";
  }
}
