
"use strict";

/* =========================================================
   CSRS DASHBOARD
   Rwanda Polytechnic - Musanze College

   Uses config.js for the API URL and optional route overrides.
   ========================================================= */

const CONFIG = window.CSRS_CONFIG || {};
const API_BASE = String(CONFIG.apiBaseUrl || "").replace(/\/+$/, "");
const ROUTES = CONFIG.routes || {};

const TOKEN_KEY = "csrs_token";
const USER_KEY = "csrs_user";

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  page: "overview",
  incidents: [],
  categories: [],
  locations: [],
  users: [],
  lostFound: [],
  emergencies: [],
  visitors: [],
  gateRecords: [],
  patrols: [],
  auditLogs: [],
  busy: false
};

const PAGE_INFO = {
  overview: ["Overview", "Campus security overview"],
  users: ["User Management", "Review registration requests and manage accounts"],
  incidents: ["Incident Management", "Report and track security incidents"],
  "lost-found": ["Lost and Found", "Manage lost property and found items"],
  emergency: ["Emergency Alerts", "Monitor emergency reports"],
  gate: ["Gate Management", "Review campus access records"],
  visitors: ["Visitor Management", "Manage campus visitors"],
  patrols: ["Security Patrols", "Monitor patrol activities"],
  reports: ["Reports", "Review security activity"],
  "audit-logs": ["Audit Logs", "Review administrative activity"],
  settings: ["System Settings", "Manage college contact details and account registration"],
  profile: ["My Profile", "View account information"]
};

const PAGE_I18N = {
  overview: ["dashboard_overview", "dashboard_overview_description"],
  users: ["dashboard_users", "dashboard_users_description"],
  incidents: ["dashboard_incidents", "dashboard_incidents_description"],
  "lost-found": ["dashboard_lost_found", "dashboard_lost_found_description"],
  emergency: ["dashboard_emergency", "dashboard_emergency_description"],
  gate: ["dashboard_gate", "dashboard_gate_description"],
  visitors: ["dashboard_visitors", "dashboard_visitors_description"],
  patrols: ["dashboard_patrols", "dashboard_patrols_description"],
  reports: ["dashboard_reports", "dashboard_reports_description"],
  "audit-logs": ["dashboard_audit_logs", "dashboard_audit_logs_description"],
  settings: ["system_settings", "system_settings_description"],
  profile: ["dashboard_profile", "dashboard_profile_description"]
};

function translated(key, fallback) {
  return window.CSRS_TRANSLATIONS?.[key] || fallback;
}

const PAGE_ENDPOINTS = {
  dashboard: ROUTES.dashboard || "/api/dashboard",
  incidents: ROUTES.incidents || "/api/incidents",
  categories: ROUTES.categories || "/api/incident-categories",
  locations: ROUTES.locations || "/api/locations",
  emergency: ROUTES.emergency || "/api/emergency",
  visitors: ROUTES.visitors || "/api/visitors",
  gate: ROUTES.gate || "/api/gate/on-campus",
  users: ROUTES.users || "",
  lostFound: ROUTES.lostFound || "",
  patrols: ROUTES.patrols || "",
  auditLogs: ROUTES.auditLogs || ""
};

/* =========================================================
   AUTHENTICATION AND API HELPERS
   ========================================================= */

function readUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function roleOf(user = state.user) {
  return String(
    user?.role ||
    user?.user_role ||
    user?.account_role ||
    ""
  ).toLowerCase().replace(/[\s-]+/g, "_");
}

function isAdmin() {
  return ["admin", "administrator", "super_admin", "superadmin"].includes(
    roleOf()
  );
}

function canManageLostFoundAndEmergencies() {
  return ["admin", "administrator", "super_admin", "superadmin", "head_security", "security_officer"]
    .includes(roleOf());
}

function canUseSecurityOperations() {
  return ["admin", "administrator", "super_admin", "superadmin", "head_security", "security_officer"]
    .includes(roleOf());
}

function canManagePatrols() {
  return ["admin", "administrator", "super_admin", "superadmin", "head_security"]
    .includes(roleOf());
}

function userName() {
  const user = state.user || {};
  return (
    user.full_name ||
    user.name ||
    user.username ||
    user.first_name ||
    user.email ||
    "User"
  );
}

function escapeText(value) {
  return String(value ?? "");
}

function showMessage(message, type = "success") {
  const errorBox = $("errorBox");
  const noticeBox = $("noticeBox");

  if (errorBox) {
    errorBox.hidden = true;
    errorBox.textContent = "";
  }

  if (noticeBox) {
    noticeBox.hidden = true;
    noticeBox.textContent = "";
  }

  const target = type === "error" ? errorBox : noticeBox;
  if (!target) return;

  target.textContent = message;
  target.hidden = false;
}

function clearMessages() {
  ["errorBox", "noticeBox"].forEach((id) => {
    const element = $(id);
    if (element) {
      element.hidden = true;
      element.textContent = "";
    }
  });
}

function normalizePath(path) {
  if (!path) return "";
  return String(path);
}

async function api(path, options = {}) {
  if (!API_BASE) {
    throw new Error("API base URL is missing from config.js.");
  }

  if (!path) {
    throw new Error("This feature has no API route configured yet.");
  }

  const token = getToken();
  const headers = new Headers(options.headers || {});

  headers.set("Accept", "application/json");

  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response;

  try {
    response = await fetch(`${API_BASE}${normalizePath(path)}`, {
      ...options,
      headers
    });
  } catch {
    throw new Error(
      "Cannot reach the CSRS backend. Check your connection and API URL."
    );
  }

  const contentType = response.headers.get("content-type") || "";
  let result = null;

  if (contentType.includes("application/json")) {
    result = await response.json().catch(() => null);
  } else {
    result = await response.text().catch(() => "");
  }

  if (response.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.location.replace("/home.html");
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    const message =
      result?.message ||
      result?.error ||
      (typeof result === "string" && result) ||
      `Request failed (${response.status}).`;

    throw new Error(message);
  }

  return result;
}

function unwrap(result, keys = []) {
  if (Array.isArray(result)) return result;

  for (const key of keys) {
    if (Array.isArray(result?.[key])) return result[key];
    if (Array.isArray(result?.data?.[key])) return result.data[key];
  }

  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.results)) return result.results;

  return [];
}

function getValue(object, keys, fallback = "—") {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return fallback;
}

function formatDate(value) {
  if (!value || value === "—") return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString();
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function makeElement(tag, text, className) {
  const element = document.createElement(tag);

  if (text !== undefined && text !== null) {
    element.textContent = String(text);
  }

  if (className) element.className = className;
  return element;
}

function makeCell(row, value, className) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "—");

  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function makeButton(label, className, onClick) {
  const button = makeElement("button", label, `button ${className}`);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function renderEmpty(tbodyId, columns, message) {
  const tbody = $(tbodyId);
  if (!tbody) return;

  tbody.replaceChildren();

  const row = document.createElement("tr");
  const cell = makeElement("td", message, "empty-cell");
  cell.colSpan = columns;
  row.appendChild(cell);
  tbody.appendChild(row);
}

function renderStatusCell(row, value, label = "") {
  const cell = document.createElement("td");
  if (label) cell.dataset.label = label;
  const status = String(value || "Unknown");
  const badge = makeElement("span", status, "badge");

  const cssStatus = status.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  badge.classList.add(cssStatus);
  cell.appendChild(badge);
  row.appendChild(cell);
}

function renderSeverityCell(row, value) {
  const cell = document.createElement("td");
  const severity = String(value || "Unknown");
  const badge = makeElement("span", severity, "badge");

  badge.classList.add(
    severity.toLowerCase().replace(/[^a-z0-9]+/g, "-")
  );

  cell.appendChild(badge);
  row.appendChild(cell);
}

function filtered(items, query, fields, status = "", statusFields = []) {
  const q = normalized(query);
  const wantedStatus = normalized(status);

  return items.filter((item) => {
    const matchesText =
      !q ||
      fields.some((field) => normalized(item?.[field]).includes(q));

    const matchesStatus =
      !wantedStatus ||
      statusFields.some((field) => normalized(item?.[field]) === wantedStatus);

    return matchesText && matchesStatus;
  });
}

/* =========================================================
   ROLE-BASED NAVIGATION
   ========================================================= */

function canOpenPage(page) {
  if (["users", "audit-logs", "settings"].includes(page) && !isAdmin()) {
    return false;
  }
  if (["gate", "visitors", "patrols"].includes(page) && !canUseSecurityOperations()) return false;
  if (page === "emergency" && !canUseSecurityOperations()) return false;

  return Boolean(PAGE_INFO[page]);
}

function showPage(page, updateHash = true) {
  if (!canOpenPage(page)) {
    showMessage("You are not authorized to access that page.", "error");
    page = "overview";
  }

  state.page = page;

  document.querySelectorAll(".page-section").forEach((section) => {
    section.hidden = section.id !== `page-${page}`;
  });

  document.querySelectorAll("[data-page]").forEach((link) => {
    const active = link.dataset.page === page;

    if (link.classList.contains("nav-link")) {
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  });

  const [title, subtitle] = PAGE_INFO[page];
  const [titleKey, subtitleKey] = PAGE_I18N[page] || [];

  if ($("pageTitle")) $("pageTitle").textContent = translated(titleKey, title);
  if ($("breadcrumbPage")) $("breadcrumbPage").textContent = translated(titleKey, title);

  const description = document.querySelector(`#page-${page} .page-description`);
  if (description && subtitle) description.textContent = translated(subtitleKey, subtitle);

  closeMobileSidebar();

  if (updateHash && location.hash !== `#${page}`) {
    history.replaceState(null, "", `#${page}`);
  }

  clearMessages();
  loadPage(page);
}

function openInitialPage() {
  const requested = location.hash.replace(/^#/, "");
  showPage(PAGE_INFO[requested] ? requested : "overview", false);
}

function openMobileSidebar() {
  $("sidebar")?.classList.add("open");

  const backdrop = $("sidebarBackdrop");
  if (backdrop) backdrop.hidden = false;

  $("menuButton")?.setAttribute("aria-expanded", "true");
}

function closeMobileSidebar() {
  $("sidebar")?.classList.remove("open");

  const backdrop = $("sidebarBackdrop");
  if (backdrop) backdrop.hidden = true;

  $("menuButton")?.setAttribute("aria-expanded", "false");
}

function applyRoleVisibility() {
  document.querySelectorAll("[data-admin-only]").forEach((element) => {
    element.hidden = !isAdmin();
  });
  document.querySelectorAll("[data-security-only]").forEach((element) => {
    element.hidden = !canUseSecurityOperations();
  });
  document.querySelectorAll("[data-patrol-manager]").forEach((element) => {
    element.hidden = !canManagePatrols();
  });
  document.querySelectorAll("[data-emergency-responders]").forEach((element) => {
    element.hidden = !canUseSecurityOperations();
  });
}

/* =========================================================
   PROFILE
   ========================================================= */

function renderProfile() {
  const user = state.user || {};
  const name = userName();
  const role = roleOf(user) || "user";
  const initial = name.charAt(0).toUpperCase() || "U";

  const assignments = {
    overviewName: name,
    welcomeName: name,
    sidebarUsername: name,
    sidebarRole: role.replace(/_/g, " "),
    profileName: name,
    profileRole: role.replace(/_/g, " "),
    profileEmail: getValue(user, ["email"]),
    profileRegistration: getValue(user, [
      "registration_number",
      "registration_no",
      "reg_no",
      "student_id"
    ]),
    profileStatus: getValue(user, ["status", "account_status"], "Unknown"),
    profileRoleDetail: role.replace(/_/g, " ")
  };

  Object.entries(assignments).forEach(([id, value]) => {
    if ($(id)) $(id).textContent = value;
  });

  ["userAvatar", "topAvatar", "profileAvatar"].forEach((id) => {
    if ($(id)) $(id).textContent = initial;
  });
}

/* =========================================================
   DASHBOARD OVERVIEW
   ========================================================= */

async function loadOverview() {
  const tasks = [
    api(PAGE_ENDPOINTS.dashboard).catch(() => null),
    api(PAGE_ENDPOINTS.incidents).catch(() => null)
  ];

  const [dashboardResult, incidentsResult] = await Promise.all(tasks);

  const dashboard = dashboardResult?.data || dashboardResult || {};
  state.incidents = unwrap(incidentsResult, ["incidents"]);

  const incidentCount =
    dashboard.total_incidents ??
    dashboard.totalIncidents ??
    dashboard.stats?.total_incidents ??
    dashboard.stats?.totalIncidents ??
    state.incidents.length;

  if ($("totalIncidents")) {
    $("totalIncidents").textContent = incidentCount;
  }

  const activeAlerts =
    dashboard.pending_alerts ??
    dashboard.active_alerts ??
    dashboard.activeAlerts ??
    dashboard.stats?.pending_alerts ??
    dashboard.stats?.active_alerts;

  if ($("pendingAlerts")) {
    $("pendingAlerts").textContent =
      activeAlerts === undefined ? "—" : activeAlerts;
  }

  const totalUsers =
    dashboard.registered_users ??
    dashboard.total_users ??
    dashboard.registeredUsers ??
    dashboard.stats?.registered_users;

  if ($("registeredUsers")) {
    $("registeredUsers").textContent =
      totalUsers === undefined ? "—" : totalUsers;
  }

  const pendingUsers =
    dashboard.pending_registrations ??
    dashboard.pending_users ??
    dashboard.pendingRegistrations ??
    dashboard.stats?.pending_registrations;

  if ($("pendingRegistrations")) {
    $("pendingRegistrations").textContent =
      pendingUsers === undefined ? "—" : pendingUsers;
  }

  if ($("usersPendingCount")) {
    $("usersPendingCount").textContent =
      pendingUsers === undefined ? "—" : pendingUsers;
  }

  renderRecentIncidents();
  renderOverviewCharts(dashboard);
  renderHotspotMap(dashboard.hotspots || []);
}

let hotspotMap;
let hotspotLayer;
function renderHotspotMap(points) {
  const status = $("hotspotMapStatus");
  const container = $("hotspotMap");
  if (!container || !status) return;
  if (!window.L) {
    status.textContent = "The map library could not be loaded. Check your connection.";
    return;
  }
  const valid = points.filter((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
  if (!hotspotMap) {
    const center = valid.length ? [Number(valid[0].lat), Number(valid[0].lng)] : [-1.5, 29.6];
    hotspotMap = L.map(container).setView(center, valid.length ? 14 : 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(hotspotMap);
  } else {
    hotspotMap.invalidateSize();
    if (hotspotLayer) hotspotMap.removeLayer(hotspotLayer);
  }
  hotspotLayer = L.layerGroup();
  const bounds = [];
  valid.forEach((point) => {
    const coords = [Number(point.lat), Number(point.lng)];
    bounds.push(coords);
    const count = Number(point.incidents) || 1;
    const marker = L.circleMarker(coords, {
      radius: Math.min(22, 7 + Math.sqrt(count) * 2),
      color: "#8f202b",
      fillColor: "#c6343d",
      fillOpacity: 0.7
    });
    const popup = document.createElement("div");
    const label = document.createElement("strong");
    label.textContent = String(point.location || "Campus location");
    const details = document.createElement("p");
    details.textContent = `${count} reported incident${count === 1 ? "" : "s"}`;
    popup.append(label, details);
    marker.bindPopup(popup).addTo(hotspotLayer);
  });
  hotspotLayer.addTo(hotspotMap);
  if (bounds.length) hotspotMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
  status.textContent = valid.length
    ? `${valid.length} mapped location${valid.length === 1 ? "" : "s"} in the selected period.`
    : "No incident coordinates are available for the selected period.";
}

function renderRecentIncidents() {
  const tbody = $("recentIncidentsTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!state.incidents.length) {
    renderEmpty("recentIncidentsTable", 5, "No incidents have been recorded.");
    return;
  }

  state.incidents.slice(0, 6).forEach((incident) => {
    const row = document.createElement("tr");

    makeCell(row, getValue(incident, ["reference_no", "reference", "incident_id", "id"]));
    makeCell(row, getValue(incident, ["category_name", "category"]));
    renderSeverityCell(row, getValue(incident, ["severity"], "Medium"));
    renderStatusCell(row, getValue(incident, ["status"], "Submitted"));
    makeCell(row, formatDate(getValue(incident, ["incident_datetime", "created_at", "date"])));

    tbody.appendChild(row);
  });
}

function renderChart(containerId, items) {
  const container = $(containerId);
  if (!container) return;

  container.replaceChildren();

  if (!items.length) {
    container.appendChild(
      makeElement("p", "No statistics are available.", "empty-cell")
    );
    return;
  }

  const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));

  items.forEach((item) => {
    const row = makeElement("div", undefined, "chart-row");
    const label = makeElement("span", item.label);
    const track = makeElement("div", undefined, "chart-track");
    const fill = makeElement("div", undefined, "chart-fill");
    const value = makeElement("span", item.value, "chart-value");

    fill.style.width = `${Math.max(0, (Number(item.value) / max) * 100)}%`;
    track.appendChild(fill);

    row.append(label, track, value);
    container.appendChild(row);
  });
}

function renderOverviewCharts(dashboard) {
  const severityCounts = {};
  const statusCounts = {};

  state.incidents.forEach((incident) => {
    const severity = getValue(incident, ["severity"], "Unknown");
    const status = getValue(incident, ["status"], "Unknown");

    severityCounts[severity] = (severityCounts[severity] || 0) + 1;
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  const suppliedSeverity =
    dashboard.severity_breakdown ||
    dashboard.severityBreakdown ||
    dashboard.stats?.severity_breakdown;

  const suppliedStatus =
    dashboard.status_breakdown ||
    dashboard.statusBreakdown ||
    dashboard.stats?.status_breakdown;

  const severityData = Array.isArray(suppliedSeverity)
    ? suppliedSeverity.map((item) => ({
        label: item.severity || item.label || item.name || "Unknown",
        value: Number(item.count ?? item.total ?? item.value ?? 0)
      }))
    : Object.entries(severityCounts).map(([label, value]) => ({ label, value }));

  const statusData = Array.isArray(suppliedStatus)
    ? suppliedStatus.map((item) => ({
        label: item.status || item.label || item.name || "Unknown",
        value: Number(item.count ?? item.total ?? item.value ?? 0)
      }))
    : Object.entries(statusCounts).map(([label, value]) => ({ label, value }));

  renderChart("severityChart", severityData);
  renderChart("statusChart", statusData);
}

/* =========================================================
   INCIDENT MANAGEMENT
   ========================================================= */

async function loadIncidentLookups() {
  const [categoriesResult, locationsResult] = await Promise.all([
    api(PAGE_ENDPOINTS.categories).catch(() => null),
    api(PAGE_ENDPOINTS.locations).catch(() => null)
  ]);

  state.categories = unwrap(categoriesResult, ["categories"]);
  state.locations = unwrap(locationsResult, ["locations"]);

  populateSelect(
    "incidentCategory",
    state.categories,
    ["category_id", "id"],
    ["category_name", "name"],
    "Select category"
  );

  populateSelect(
    "incidentLocation",
    state.locations,
    ["location_id", "id"],
    ["location_name", "name"],
    "Select location"
  );
}

function populateSelect(id, items, idFields, nameFields, placeholder) {
  const select = $(id);
  if (!select) return;

  const previousValue = select.value;
  select.replaceChildren();

  const firstOption = document.createElement("option");
  firstOption.value = "";
  firstOption.textContent = placeholder;
  select.appendChild(firstOption);

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = getValue(item, idFields, "");
    option.textContent = getValue(item, nameFields, "Unnamed");

    select.appendChild(option);
  });

  if ([...select.options].some((option) => option.value === previousValue)) {
    select.value = previousValue;
  }
}

async function loadIncidents() {
  const result = await api(PAGE_ENDPOINTS.incidents);
  state.incidents = unwrap(result, ["incidents"]);

  renderIncidentsTable();
  renderRecentIncidents();
}

function renderIncidentsTable() {
  const query = $("incidentSearch")?.value || "";
  const status = $("incidentStatusFilter")?.value || "";

  const items = filtered(
    state.incidents,
    query,
    ["reference_no", "reference", "category_name", "category", "description", "location_name"],
    status,
    ["status"]
  );

  const tbody = $("incidentsTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("incidentsTable", 6, "No matching incidents found.");
    return;
  }

  items.forEach((incident) => {
    const row = document.createElement("tr");

    makeCell(row, getValue(incident, ["reference_no", "reference", "incident_id", "id"]));
    makeCell(row, getValue(incident, ["category_name", "category"]));
    makeCell(row, getValue(incident, ["location_name", "location"]));
    renderSeverityCell(row, getValue(incident, ["severity"], "Medium"));
    renderStatusCell(row, getValue(incident, ["status"], "Submitted"));
    makeCell(row, formatDate(getValue(incident, ["incident_datetime", "created_at"])));

    tbody.appendChild(row);
  });
}

async function submitIncident(event) {
  event.preventDefault();
  clearMessages();

  const form = $("incidentForm");
  if (!form || !form.reportValidity()) return;

  const payload = {
    category_id: $("incidentCategory")?.value,
    location_id: $("incidentLocation")?.value,
    incident_datetime: $("incidentDateTime")?.value,
    description: $("incidentDescription")?.value.trim(),
    severity: $("incidentSeverity")?.value,
    is_anonymous: Boolean($("incidentAnonymous")?.checked)
  };

  const submitButton = form.querySelector('[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    await api(PAGE_ENDPOINTS.incidents, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    form.reset();
    $("incidentFormPanel").hidden = true;

    showMessage("Incident report submitted successfully.");
    await loadIncidents();
    await loadOverview();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

/* =========================================================
   USER MANAGEMENT
   Requires the actual users and approval routes in config.js.
   ========================================================= */

async function loadUsers() {
  if (!isAdmin()) {
    showMessage("Only administrators can manage users.", "error");
    return;
  }

  if (!PAGE_ENDPOINTS.users) {
    renderEmpty(
      "usersTable",
      6,
      "User API is not configured. Set routes.users in config.js to your real backend endpoint."
    );
    updateUserCounts();
    return;
  }

  try {
    const result = await api(PAGE_ENDPOINTS.users);
    state.users = unwrap(result, ["users", "accounts", "registrations"]);
    renderUsersTable();
    updateUserCounts();
  } catch (error) {
    renderEmpty("usersTable", 6, error.message);
    showMessage(`Unable to load users: ${error.message}`, "error");
  }
}

function userStatus(user) {
  return String(
    getValue(user, ["status", "account_status", "approval_status"], "Unknown")
  );
}

function isPendingUser(user) {
  return ["pending", "awaiting_approval", "awaiting approval"].includes(
    normalized(userStatus(user))
  );
}

function appendUserRoleControl(actionsCell, user, id, name) {
  const role = getValue(user, ["role", "requested_role", "user_role"]);
  const currentUser = Number(id) === Number(state.user?.id);
  const roleSelect = document.createElement("select");
  roleSelect.className = "user-role-select";
  roleSelect.setAttribute("aria-label", `Role for ${name}`);
  roleSelect.disabled = currentUser;
  [
    ["student", "Student"], ["staff", "Staff"], ["dean", "Dean"],
    ["management", "College management"], ["security_officer", "Security officer"],
    ["head_security", "Head of Security"], ["admin", "Administrator"]
  ].forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = normalized(role) === value;
    roleSelect.appendChild(option);
  });
  actionsCell.appendChild(roleSelect);
  if (!currentUser) {
    actionsCell.appendChild(makeButton("Save role", "secondary", () => saveUserRole(id, roleSelect.value)));
  }
}

function updateUserCounts() {
  const pending = state.users.filter(isPendingUser).length;
  const active = state.users.filter((user) =>
    ["active", "approved"].includes(normalized(userStatus(user)))
  ).length;

  if ($("usersPendingCount")) $("usersPendingCount").textContent = pending;
  if ($("usersActiveCount")) $("usersActiveCount").textContent = active;
  if ($("usersTotalCount")) $("usersTotalCount").textContent = state.users.length;

  const badge = $("pendingUsersBadge");
  if (badge) {
    badge.textContent = pending;
    badge.hidden = !isAdmin() || pending === 0;
  }

  if ($("pendingRegistrations")) {
    $("pendingRegistrations").textContent = pending;
  }
}

function renderUsersTable() {
  const query = $("userSearch")?.value || "";
  const status = $("userStatusFilter")?.value || "";

  const items = state.users.filter((user) => {
    const text = [
      user.full_name,
      user.name,
      user.username,
      user.email,
      user.registration_number,
      user.registration_no
    ].some((value) => normalized(value).includes(normalized(query)));

    const statusMatches =
      !status || normalized(userStatus(user)) === normalized(status);

    return text && statusMatches;
  });

  const tbody = $("usersTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("usersTable", 6, "No matching users found.");
    return;
  }

  items.forEach((user) => {
    const row = document.createElement("tr");
    row.className = "user-row";
    const name = getValue(user, ["full_name", "name", "username"]);
    const email = getValue(user, ["email"]);
    const registration = getValue(user, [
      "registration_number",
      "registration_no",
      "reg_no"
    ]);
    const role = getValue(user, ["role", "requested_role", "user_role"]);
    const statusValue = userStatus(user);

    makeCell(row, name).dataset.label = "Name";
    makeCell(row, email).dataset.label = "Email";
    makeCell(row, registration).dataset.label = "Registration number";
    makeCell(row, role).dataset.label = "Account role";
    renderStatusCell(row, statusValue, "Status");

    const actionsCell = document.createElement("td");
    actionsCell.dataset.label = "Actions";

    if (isPendingUser(user) && isAdmin()) {
      const approveRoute = ROUTES.approveUser;
      const rejectRoute = ROUTES.rejectUser;
      const id = getValue(user, ["user_id", "id"], "");

      if (approveRoute && rejectRoute && id !== "") {
        actionsCell.append(
          makeButton("Approve", "primary", () =>
            changeUserStatus(id, "approve", approveRoute)
          ),
          makeButton("Reject", "secondary", () =>
            changeUserStatus(id, "reject", rejectRoute)
          )
        );
      } else {
        actionsCell.textContent = "Configure approval routes";
      }
      appendUserRoleControl(actionsCell, user, id, name);
    } else if (isAdmin()) {
      const id = getValue(user, ["user_id", "id"], "");
      const active = user.is_active === true || user.is_active === "true";
      const currentUser = Number(id) === Number(state.user?.id);
      appendUserRoleControl(actionsCell, user, id, name);
      if (!currentUser) {
        actionsCell.appendChild(makeButton("Reset password", "secondary", () => resetUserPassword(id, name)));
      }
      const route = active ? ROUTES.deactivateUser : ROUTES.activateUser;
      if (route && !(currentUser && active)) {
        actionsCell.appendChild(makeButton(active ? "Deactivate" : "Activate", active ? "button-danger" : "primary", () => {
          changeUserStatus(id, active ? "deactivate" : "activate", route);
        }));
      }
    } else {
      actionsCell.textContent = "No actions available.";
    }

    row.appendChild(actionsCell);
    tbody.appendChild(row);
  });
}

async function changeUserStatus(userId, action, routeTemplate) {
  if (!isAdmin()) {
    showMessage("Only administrators can manage user accounts.", "error");
    return;
  }

  const prompts = {
    approve: "Approve this registration?",
    reject: "Reject this registration? This permanently deletes the pending request.",
    activate: "Activate this account?",
    deactivate: "Deactivate this account? The user will no longer be able to sign in."
  };
  const confirmed = window.confirm(prompts[action] || "Continue with this account change?");

  if (!confirmed) return;

  try {
    const route = routeTemplate.replace(
      ":id",
      encodeURIComponent(String(userId))
    );

    await api(route, {
      method: "POST",
      body: JSON.stringify({})
    });

    const successMessages = {
      approve: "Registration approved.", reject: "Registration rejected.",
      activate: "Account activated.", deactivate: "Account deactivated."
    };
    showMessage(successMessages[action] || "User account updated.");

    await loadUsers();
    await loadOverview();
  } catch (error) {
    showMessage(`Registration update failed: ${error.message}`, "error");
  }
}

async function saveUserRole(userId, role) {
  if (!isAdmin()) return showMessage("Only administrators can change user roles.", "error");
  try {
    await api(`/api/users/${encodeURIComponent(userId)}`, {
      method: "PATCH", body: JSON.stringify({ role })
    });
    showMessage("User role updated. They must sign out and sign in again for the new role permissions to take effect.");
    await loadUsers();
  } catch (error) {
    showMessage(`Unable to update user role: ${error.message}`, "error");
  }
}

async function resetUserPassword(userId, name) {
  if (!isAdmin()) return showMessage("Only administrators can reset user passwords.", "error");
  if (!window.confirm(`Create a temporary password for ${name}? They must change it at next sign-in.`)) return;
  try {
    const result = await api(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST", body: JSON.stringify({})
    });
    showMessage(`Temporary password for ${result.user?.username || name}: ${result.temporary_password}. Share it securely; it will not be shown again.`);
  } catch (error) {
    showMessage(`Unable to reset password: ${error.message}`, "error");
  }
}

/* =========================================================
   LOST AND FOUND
   Requires routes.lostFound and compatible backend endpoints.
   ========================================================= */

async function loadLostFound() {
  if (!PAGE_ENDPOINTS.lostFound) {
    renderEmpty(
      "lostFoundTable",
      6,
      "Lost and Found API is not configured. Set routes.lostFound in config.js."
    );
    return;
  }

  try {
    const result = await api(PAGE_ENDPOINTS.lostFound);
    state.lostFound = unwrap(result, ["items", "records", "lostFound"]);
    renderLostFound();
  } catch (error) {
    renderEmpty("lostFoundTable", 6, error.message);
    showMessage(`Unable to load Lost and Found: ${error.message}`, "error");
  }
}

function renderLostFound() {
  const query = $("lostFoundSearch")?.value || "";
  const status = $("lostFoundStatusFilter")?.value || "";

  const items = filtered(
    state.lostFound,
    query,
    ["item_name", "name", "description", "location", "reference_no"],
    status,
    ["status", "type"]
  );

  const tbody = $("lostFoundTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("lostFoundTable", 6, "No matching property records found.");
    return;
  }

  items.forEach((item) => {
    const row = document.createElement("tr");

    const kind = String(getValue(item, ["kind", "type", "item_type"], "lost")).toLowerCase();
    makeCell(row, `${getValue(item, ["item_name", "name", "title"])} (#${item.id})`);
    makeCell(row, kind);
    makeCell(row, getValue(item, ["location", "location_lost", "location_found", "location_name"]));
    makeCell(row, formatDate(getValue(item, ["date", "date_lost", "date_found", "event_date", "created_at", "reported_at"])));
    renderStatusCell(row, getValue(item, ["status"], "Open"));

    const actions = document.createElement("td");
    if (canManageLostFoundAndEmergencies() && kind === "found" && item.id) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button secondary button-small";
      action.textContent = String(item.status).toLowerCase() === "matched"
        ? translated("mark_collected", "Mark collected")
        : translated("match_item", "Match lost report");
      action.disabled = !["open", "matched"].includes(String(item.status || "open").toLowerCase());
      action.addEventListener("click", () => String(item.status).toLowerCase() === "matched"
        ? collectMatchedItem(item)
        : matchFoundItem(item));
      actions.appendChild(action);
    } else {
      actions.textContent = "—";
    }
    row.appendChild(actions);

    tbody.appendChild(row);
  });
}

async function matchFoundItem(foundItem) {
  const candidates = state.lostFound.filter((item) =>
    String(getValue(item, ["kind", "type", "item_type"], "")).toLowerCase() === "lost" &&
    String(item.status || "").toLowerCase() === "open"
  );
  if (!candidates.length) {
    showMessage("There are no open lost reports to match yet.", "error");
    return;
  }
  const choices = candidates.map((item) => `#${item.id} — ${getValue(item, ["item_name", "title"], "Unnamed item")}`).join("\n");
  const answer = window.prompt(`Enter the ID of the lost report that matches found item #${foundItem.id}:\n${choices}`);
  if (answer === null) return;
  const lostItem = candidates.find((item) => String(item.id) === answer.trim().replace(/^#/, ""));
  if (!lostItem) {
    showMessage("Enter one of the listed lost report IDs.", "error");
    return;
  }
  try {
    await api(`${PAGE_ENDPOINTS.lostFound.replace(/\/+$/, "")}/match`, {
      method: "POST",
      body: JSON.stringify({ lost_id: Number(lostItem.id), found_id: Number(foundItem.id) })
    });
    showMessage("Items matched. The person who reported the lost item was notified.");
    await loadLostFound();
  } catch (error) {
    showMessage(`Unable to match items: ${error.message}`, "error");
  }
}

async function collectMatchedItem(foundItem) {
  const lostItem = state.lostFound.find((item) => Number(item.id) === Number(foundItem.matched_item_id));
  if (!lostItem?.user_id) {
    showMessage("The matched lost report owner could not be identified. Refresh the records and retry.", "error");
    return;
  }
  if (!window.confirm("Confirm that the claimant's identity was checked and the item is being handed over?")) return;
  try {
    await api(`${PAGE_ENDPOINTS.lostFound.replace(/\/+$/, "")}/found/${foundItem.id}/collect`, {
      method: "POST",
      body: JSON.stringify({ user_id: Number(lostItem.user_id) })
    });
    showMessage("Item marked as collected and the lost report was closed.");
    await loadLostFound();
  } catch (error) {
    showMessage(`Unable to record collection: ${error.message}`, "error");
  }
}

async function submitLostFound(event) {
  event.preventDefault();

  const form = $("lostFoundForm");
  if (!form || !form.reportValidity()) return;

  if (!PAGE_ENDPOINTS.lostFound) {
    showMessage("Configure the Lost and Found backend route before submitting.", "error");
    return;
  }

  const kind = $("lostFoundType").value === "found" ? "found" : "lost";
  const route = `${PAGE_ENDPOINTS.lostFound.replace(/\/+$/, "")}/${kind}`;
  const payload = {
    item_name: $("lostFoundItemName").value.trim(),
    [kind === "found" ? "location_found" : "location_lost"]:
      $("lostFoundLocation").value.trim(),
    [kind === "found" ? "date_found" : "date_lost"]:
      $("lostFoundDate").value,
    description: $("lostFoundDescription").value.trim()
  };

  try {
    await api(route, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    form.reset();
    $("lostFoundFormPanel").hidden = true;
    showMessage("Property record saved.");
    await loadLostFound();
  } catch (error) {
    const detail = error.message === "Not found"
      ? `The live server is missing POST ${route}. Deploy the latest backend code, then retry.`
      : error.message;
    showMessage(`Unable to save record: ${detail}`, "error");
  }
}

/* =========================================================
   EMERGENCY ALERTS
   ========================================================= */

async function loadEmergency() {
  const result = await api(PAGE_ENDPOINTS.emergency);
  state.emergencies = unwrap(result, ["alerts", "emergencies"]);
  renderEmergency();
}

async function performEmergencyAction(alert, action) {
  const prompts = {
    acknowledge: "Confirm that a responder is taking responsibility for this alert?",
    arrive: "Confirm that responders have arrived at the reported location?",
    resolve: "Confirm that this emergency has been handled and can be closed?"
  };
  if (!window.confirm(prompts[action])) return;
  try {
    await api(`${PAGE_ENDPOINTS.emergency}/${alert.id}/${action}`, { method: "PATCH" });
    showMessage(`Emergency alert #${alert.id} updated.`);
    await loadEmergency();
  } catch (error) {
    showMessage(`Unable to update emergency alert: ${error.message}`, "error");
  }
}

function renderEmergency() {
  const query = $("emergencySearch")?.value || "";
  const status = $("emergencyStatusFilter")?.value || "";

  const items = filtered(
    state.emergencies,
    query,
    ["title", "message", "description", "location", "alert_type"],
    status,
    ["status"]
  );

  const tbody = $("emergencyTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("emergencyTable", 6, "No matching emergency alerts found.");
    return;
  }

  items.forEach((alert) => {
    const row = document.createElement("tr");

    const summary = getValue(alert, ["message", "title", "alert_type", "description"], "Emergency assistance requested");
    const reporter = alert.username || alert.full_name || "Campus user";
    makeCell(row, `#${alert.id} · ${reporter}: ${summary}`);
    const location = getValue(alert, ["location", "location_name"], null) ||
      (alert.lat != null && alert.lng != null ? `${alert.lat}, ${alert.lng}` : "Location unavailable");
    makeCell(row, location);
    renderSeverityCell(row, getValue(alert, ["severity", "priority"], "Critical"));
    renderStatusCell(row, getValue(alert, ["status"], "Unknown"));
    makeCell(row, formatDate(getValue(alert, ["triggered_at", "created_at", "createdAt", "timestamp"])));

    const actions = document.createElement("td");
    if (canManageLostFoundAndEmergencies() && alert.id) {
      const current = String(alert.status || "").toLowerCase();
      const nextActions = current === "triggered"
        ? [["acknowledge", "Acknowledge"], ["resolve", "Resolve"]]
        : current === "acknowledged"
          ? [["arrive", "Mark arrived"], ["resolve", "Resolve"]]
          : current === "arrived"
            ? [["resolve", "Resolve"]]
            : [];
      nextActions.forEach(([action, label]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button secondary button-small";
        const labelKeys = { acknowledge: "acknowledge_alert", arrive: "mark_arrived", resolve: "resolve_alert" };
        button.textContent = translated(labelKeys[action], label);
        button.addEventListener("click", () => performEmergencyAction(alert, action));
        actions.appendChild(button);
      });
      if (!actions.childElementCount) actions.textContent = "—";
    } else {
      actions.textContent = "—";
    }
    row.appendChild(actions);

    tbody.appendChild(row);
  });
}

/* =========================================================
   VISITORS AND GATE RECORDS
   ========================================================= */

async function checkoutVisitor(visitorId) {
  if (!visitorId) return showMessage("This visitor record has no valid ID.", "error");
  try {
    await api(`/api/gate/${encodeURIComponent(visitorId)}/check-out`, { method: "POST" });
    showMessage("Visitor checked out successfully.");
    await Promise.all([loadVisitors(), loadGate()]);
  } catch (error) {
    showMessage(`Unable to check out visitor: ${error.message}`, "error");
  }
}

async function loadVisitors() {
  const [result, onCampusResult] = await Promise.all([
    api("/api/gate/logs?limit=200"),
    api("/api/gate/on-campus")
  ]);
  state.visitors = unwrap(result, ["visitors", "records"]);
  const currentCount = unwrap(onCampusResult, ["visitors", "records"]).length;
  if ($("visitorCampusCount")) {
    $("visitorCampusCount").textContent = `${currentCount} ${currentCount === 1 ? "visitor is" : "visitors are"} currently on campus.`;
  }
  renderVisitors();
}

async function loadVisitorHosts() {
  const select = $("dashboardVisitorHost");
  if (!select || !canUseSecurityOperations()) return;
  const hosts = unwrap(await api("/api/users/hosts"), ["hosts", "users"]);
  fillSelect(select, hosts, "Select the person being visited", (host) => {
    const name = host.full_name || host.username || `User #${host.id}`;
    return host.role ? `${name} · ${host.role}` : name;
  }, (host) => host.id);
  if (!hosts.length && $("dashboardVisitorFormMessage")) {
    $("dashboardVisitorFormMessage").textContent = "No active visitor hosts were found.";
  }
}

async function submitDashboardVisitorCheckIn(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  if ($("dashboardVisitorFormMessage")) $("dashboardVisitorFormMessage").textContent = "Registering visitor...";
  try {
    const payload = formObject(form);
    payload.host_user_id = Number(payload.host_user_id);
    const visitor = await api("/api/gate/check-in", { method: "POST", body: JSON.stringify(payload) });
    form.reset();
    if ($("dashboardVisitorFormMessage")) {
      $("dashboardVisitorFormMessage").textContent = `Visitor checked in. Badge number: ${visitor.badge_no || visitor.badge_number || "issued"}.`;
    }
    await Promise.all([loadVisitors(), loadGate()]);
  } catch (error) {
    if ($("dashboardVisitorFormMessage")) $("dashboardVisitorFormMessage").textContent = `Unable to check in visitor: ${error.message}`;
  } finally { button.disabled = false; }
}

function renderVisitors() {
  const query = $("visitorSearch")?.value || "";
  const status = $("visitorStatusFilter")?.value || "";

  const items = filtered(
    state.visitors,
    query,
    ["visitor_name", "name", "email", "purpose", "host_name"],
    status,
    ["status"]
  );

  const tbody = $("visitorsTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("visitorsTable", 6, "No matching visitor records found.");
    return;
  }

  items.forEach((visitor) => {
    const row = document.createElement("tr");
    row.className = "responsive-data-row";

    makeCell(row, getValue(visitor, ["visitor_name", "name", "full_name"])).dataset.label = "Visitor";
    makeCell(row, getValue(visitor, ["purpose", "visit_purpose"])).dataset.label = "Purpose";
    makeCell(row, getValue(visitor, ["host_name", "host", "person_to_visit"])).dataset.label = "Host";
    makeCell(row, formatDate(getValue(visitor, ["entry_at", "entry_time", "check_in", "created_at"]))).dataset.label = "Entry time";
    renderStatusCell(row, getValue(visitor, ["status"], "On Campus"), "Status");

    const actions = document.createElement("td");
    actions.dataset.label = "Actions";
    if (visitor.status === "On Campus") actions.appendChild(makeButton("Check out", "secondary", () => checkoutVisitor(visitor.id)));
    else actions.textContent = "—";
    row.appendChild(actions);

    tbody.appendChild(row);
  });
}

async function loadGate() {
  const result = await api("/api/gate/logs?limit=200");
  state.gateRecords = unwrap(result, ["records", "visitors", "entries"]);
  renderGate();
}

function renderGate() {
  const query = $("gateSearch")?.value || "";
  const status = $("gateStatusFilter")?.value || "";

  const items = filtered(
    state.gateRecords,
    query,
    ["name", "visitor_name", "person_name", "gate_name", "recorded_by"],
    status,
    ["record_type", "type", "direction"]
  );

  const tbody = $("gateTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("gateTable", 6, "No matching gate records found.");
    return;
  }

  items.forEach((record) => {
    const row = document.createElement("tr");
    row.className = "responsive-data-row";

    makeCell(row, getValue(record, ["person_name", "visitor_name", "full_name", "name"])).dataset.label = "Person";
    makeCell(row, getValue(record, ["record_type", "type", "direction"])).dataset.label = "Record type";
    makeCell(row, getValue(record, ["gate_name", "gate", "location"])).dataset.label = "Gate";
    makeCell(row, getValue(record, ["recorded_by", "officer_name"])).dataset.label = "Recorded by";
    makeCell(row, formatDate(getValue(record, ["exit_at", "entry_at", "created_at", "timestamp", "entry_time"]))).dataset.label = "Date and time";

    const actions = document.createElement("td");
    actions.dataset.label = "Actions";
    if (record.status === "On Campus") actions.appendChild(makeButton("Check out", "secondary", () => checkoutVisitor(record.id)));
    else actions.textContent = "—";
    row.appendChild(actions);

    tbody.appendChild(row);
  });
}

/* =========================================================
   PATROLS AND AUDIT LOGS
   ========================================================= */

async function loadPatrols() {
  if (!PAGE_ENDPOINTS.patrols) {
    renderEmpty("patrolsTable", 6, "Patrol API is not configured in config.js.");
    return;
  }

  const result = await api(`${PAGE_ENDPOINTS.patrols}/logs?limit=200`);
  state.patrols = unwrap(result, ["patrols", "records"]);
  renderPatrols();
}

function fillSelect(select, rows, placeholder, labelOf, valueOf) {
  if (!select) return;
  select.replaceChildren(new Option(placeholder, ""));
  rows.forEach((row) => select.add(new Option(labelOf(row), String(valueOf(row)))));
}

async function loadPatrolSetup() {
  if (!canManagePatrols()) return;
  const [routesResult, locationsResult, officersResult, rostersResult] = await Promise.all([
    api(`${PAGE_ENDPOINTS.patrols}/routes`),
    api(PAGE_ENDPOINTS.locations),
    api("/api/users/officers"),
    api(`${PAGE_ENDPOINTS.patrols}/rosters`)
  ]);
  const routes = unwrap(routesResult, ["routes"]);
  const locations = unwrap(locationsResult, ["locations"]);
  const officers = unwrap(officersResult, ["officers", "users"]);
  const rosters = unwrap(rostersResult, ["rosters"]);
  fillSelect($("patrolCheckpointRoute"), routes, "Select route", (r) => r.name, (r) => r.id);
  fillSelect($("patrolRosterRoute"), routes, "No route assigned", (r) => r.name, (r) => r.id);
  fillSelect($("patrolCheckpointLocation"), locations, "Select location", (r) => r.name, (r) => r.id);
  fillSelect($("patrolRosterOfficer"), officers, "Select officer", (u) => u.full_name || u.username, (u) => u.id);
  renderPatrolRosters(rosters, routes);
}

function renderPatrolRosters(rosters, routes) {
  const tbody = $("patrolRostersTable");
  if (!tbody) return;
  tbody.replaceChildren();
  if (!rosters.length) {
    renderEmpty("patrolRostersTable", 6, "No duty assignments found.");
    return;
  }
  const routeNames = new Map(routes.map((route) => [String(route.id), route.name]));
  rosters.forEach((roster) => {
    const row = document.createElement("tr");
    makeCell(row, roster.officer).dataset.label = "Officer";
    makeCell(row, routeNames.get(String(roster.route_id)) || "Unassigned").dataset.label = "Route";
    makeCell(row, formatDate(roster.start_at)).dataset.label = "Shift starts";
    makeCell(row, formatDate(roster.end_at)).dataset.label = "Shift ends";
    makeCell(row, roster.handover_notes || "—").dataset.label = "Handover notes";
    const actions = document.createElement("td");
    actions.dataset.label = "Actions";
    actions.appendChild(makeButton("Cancel duty", "danger", async () => {
      if (!window.confirm("Cancel this duty assignment?")) return;
      try {
        await api(`${PAGE_ENDPOINTS.patrols}/rosters/${encodeURIComponent(roster.id)}`, { method: "DELETE" });
        showMessage("Duty assignment cancelled.");
        await loadPatrolSetup();
      } catch (error) { showMessage(`Unable to cancel duty: ${error.message}`, "error"); }
    }));
    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setupPatrolActions() {
  on("patrolScanForm", "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const body = formObject(form);
      await api(`${PAGE_ENDPOINTS.patrols}/scan`, { method: "POST", body: JSON.stringify(body) });
      form.reset();
      if ($("patrolActionMessage")) $("patrolActionMessage").textContent = "Checkpoint scan recorded.";
      await loadPatrols();
    } catch (error) {
      if ($("patrolActionMessage")) $("patrolActionMessage").textContent = `Unable to record scan: ${error.message}`;
    } finally { submit.disabled = false; }
  });

  on("patrolRouteForm", "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await api(`${PAGE_ENDPOINTS.patrols}/routes`, { method: "POST", body: JSON.stringify(formObject(form)) });
      form.reset();
      showMessage("Patrol route created.");
      await loadPatrolSetup();
    } catch (error) { showMessage(`Unable to create route: ${error.message}`, "error"); }
    finally { submit.disabled = false; }
  });

  on("patrolCheckpointForm", "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const body = formObject(form);
      const checkpoint = await api(`${PAGE_ENDPOINTS.patrols}/routes/${encodeURIComponent(body.route_id)}/checkpoints`, {
        method: "POST", body: JSON.stringify({ name: body.name, location_id: body.location_id })
      });
      form.reset();
      if ($("checkpointCreatedCode")) {
        $("checkpointCreatedCode").textContent = `Checkpoint added. Print this QR code for the checkpoint: ${checkpoint.qr_code}`;
      }
      await loadPatrolSetup();
    } catch (error) { showMessage(`Unable to add checkpoint: ${error.message}`, "error"); }
    finally { submit.disabled = false; }
  });

  on("patrolRosterForm", "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const body = formObject(form);
      if (!body.route_id) delete body.route_id;
      await api(`${PAGE_ENDPOINTS.patrols}/rosters`, { method: "POST", body: JSON.stringify(body) });
      form.reset();
      showMessage("Duty assignment saved and the officer has been notified.");
      await loadPatrolSetup();
    } catch (error) { showMessage(`Unable to assign duty: ${error.message}`, "error"); }
    finally { submit.disabled = false; }
  });
}

function renderPatrols() {
  const query = $("patrolSearch")?.value || "";
  const status = $("patrolStatusFilter")?.value || "";

  const items = filtered(
    state.patrols,
    query,
    ["name", "patrol_name", "officer_name", "checkpoint"],
    status,
    ["status"]
  );

  const tbody = $("patrolsTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("patrolsTable", 6, "No matching patrol records found.");
    return;
  }

  items.forEach((patrol) => {
    const row = document.createElement("tr");
    row.className = "responsive-data-row";

    makeCell(row, getValue(patrol, ["route", "patrol_name", "name", "reference_no"], `Scan #${patrol.id || ""}`)).dataset.label = "Patrol";
    makeCell(row, getValue(patrol, ["officer_name", "officer"])).dataset.label = "Officer";
    makeCell(row, getValue(patrol, ["checkpoint", "location"])).dataset.label = "Checkpoint";
    renderStatusCell(row, getValue(patrol, ["status"], "Unknown"), "Status");
    makeCell(row, formatDate(getValue(patrol, ["scanned_at", "start_time", "created_at"]))).dataset.label = "Start time";

    const actions = document.createElement("td");
    actions.dataset.label = "Notes";
    actions.textContent = patrol.notes || "—";
    row.appendChild(actions);

    tbody.appendChild(row);
  });
}

async function loadAuditLogs() {
  if (!isAdmin()) {
    showMessage("Only administrators can view audit logs.", "error");
    return;
  }

  if (!PAGE_ENDPOINTS.auditLogs) {
    renderEmpty("auditLogsTable", 5, "Audit log API is not configured in config.js.");
    return;
  }

  const result = await api(PAGE_ENDPOINTS.auditLogs);
  state.auditLogs = unwrap(result, ["logs", "audit_logs", "records"]);
  renderAuditLogs();
}

function renderAuditLogs() {
  const query = $("auditSearch")?.value || "";
  const items = state.auditLogs.filter((item) =>
    [
      item.actor,
      item.actor_name,
      item.action,
      item.resource,
      item.details
    ].some((value) => normalized(value).includes(normalized(query)))
  );

  const tbody = $("auditLogsTable");
  if (!tbody) return;

  tbody.replaceChildren();

  if (!items.length) {
    renderEmpty("auditLogsTable", 5, "No matching audit records found.");
    return;
  }

  items.forEach((log) => {
    const row = document.createElement("tr");

    makeCell(row, getValue(log, ["actor_name", "actor", "username"]));
    makeCell(row, getValue(log, ["action", "event_type"]));
    makeCell(row, getValue(log, ["resource", "entity_type"]));
    makeCell(row, getValue(log, ["details", "description", "message"]));
    makeCell(row, formatDate(getValue(log, ["created_at", "timestamp"])));

    tbody.appendChild(row);
  });
}

/* =========================================================
   REPORTS
   ========================================================= */

async function loadIncidentReport() {
  try {
    await loadIncidents();

    const output = $("incidentReportOutput");
    if (!output) return;

    output.replaceChildren();

    const counts = {};
    state.incidents.forEach((item) => {
      const key = getValue(item, ["status"], "Unknown");
      counts[key] = (counts[key] || 0) + 1;
    });

    renderChart(
      "incidentReportOutput",
      Object.entries(counts).map(([label, value]) => ({ label, value }))
    );
  } catch (error) {
    showMessage(`Unable to load incident report: ${error.message}`, "error");
  }
}

async function loadAccessReport() {
  try {
    await loadVisitors();

    const output = $("accessReportOutput");
    if (!output) return;

    output.replaceChildren();

    const counts = {};
    state.visitors.forEach((visitor) => {
      const key = getValue(visitor, ["status"], "Unknown");
      counts[key] = (counts[key] || 0) + 1;
    });

    renderChart(
      "accessReportOutput",
      Object.entries(counts).map(([label, value]) => ({ label, value }))
    );
  } catch (error) {
    showMessage(`Unable to load access report: ${error.message}`, "error");
  }
}

async function downloadReport(type, format) {
  try {
    const query = new URLSearchParams({ format });
    if (type === "incident") {
      const reference = $("reportReference")?.value.trim();
      if (!reference) throw new Error("Enter the incident reference number.");
      query.set("reference_no", reference);
    }
    if (type === "incident-summary") query.set("period", $("reportPeriod")?.value || "month");
    const token = getToken();
    const response = await fetch(`${API_BASE}/api/reports/${encodeURIComponent(type)}?${query}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Report download failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `csrs-${type}-report.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showMessage(`Unable to download report: ${error.message}`, 'error');
  }
}

async function loadBackupStatus() {
  const output = $("backupStatusOutput");
  if (!output) return;
  try {
    const runs = await api("/api/admin/backups/status");
    output.replaceChildren();
    if (!Array.isArray(runs) || !runs.length) {
      output.textContent = "No backup runs recorded yet.";
      return;
    }
    runs.forEach((run) => {
      const entry = document.createElement("p");
      entry.textContent = `${run.status.toUpperCase()} · ${run.backup_name} · ${formatDate(run.started_at, true)}${run.error_message ? ` · ${run.error_message}` : ""}`;
      output.appendChild(entry);
    });
  } catch (error) {
    output.textContent = `Unable to load backup status: ${error.message}`;
  }
}

async function loadSystemSettings() {
  const result = await api('/api/admin/settings');
  const settings = result.settings || {};
  if ($('settingSupportEmail')) $('settingSupportEmail').value = settings.support_email || '';
  if ($('settingEmergencyPhone')) $('settingEmergencyPhone').value = settings.emergency_phone || '';
  if ($('settingRegistrationEnabled')) $('settingRegistrationEnabled').checked = Boolean(settings.registration_enabled);
  const status = $('integrationStatus');
  if (status) {
    status.replaceChildren();
    const labels = { email: 'Email delivery', sms: 'SMS delivery', push: 'Browser push', public_app_url: 'Password reset links' };
    Object.entries(labels).forEach(([key, label]) => {
      const row = document.createElement('p');
      row.className = 'profile-note';
      row.textContent = `${label}: ${result.integrations?.[key] ? 'Configured' : 'Not configured'}`;
      status.appendChild(row);
    });
  }
}

async function saveSystemSettings(event) {
  event.preventDefault();
  const form = $('systemSettingsForm');
  if (!form?.reportValidity()) return;
  try {
    await api('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        support_email: $('settingSupportEmail').value.trim(),
        emergency_phone: $('settingEmergencyPhone').value.trim(),
        registration_enabled: $('settingRegistrationEnabled').checked
      })
    });
    showMessage('System settings saved.');
    await loadSystemSettings();
  } catch (error) {
    showMessage(`Unable to save system settings: ${error.message}`, 'error');
  }
}

/* =========================================================
   PAGE LOADING
   ========================================================= */

async function safeLoad(label, callback) {
  try {
    await callback();
  } catch (error) {
    showMessage(`${label}: ${error.message}`, "error");
  }
}

async function loadPage(page) {
  if (state.busy) return;

  state.busy = true;

  try {
    switch (page) {
      case "overview":
        await safeLoad("Unable to load overview", loadOverview);
        break;

      case "users":
        await safeLoad("Unable to load users", loadUsers);
        break;

      case "incidents":
        await safeLoad("Unable to load incidents", async () => {
          await Promise.all([loadIncidents(), loadIncidentLookups()]);
        });
        break;

      case "lost-found":
        await safeLoad("Unable to load Lost and Found", loadLostFound);
        break;

      case "emergency":
        await safeLoad("Unable to load alerts", loadEmergency);
        break;

      case "gate":
        await safeLoad("Unable to load gate records", loadGate);
        break;

      case "visitors":
        await safeLoad("Unable to load visitors", async () => {
          await Promise.all([loadVisitors(), loadVisitorHosts()]);
        });
        break;

      case "patrols":
        await safeLoad("Unable to load patrols", async () => {
          await Promise.all([loadPatrols(), loadPatrolSetup()]);
        });
        break;

      case "audit-logs":
        await safeLoad("Unable to load audit logs", loadAuditLogs);
        break;
      case "settings":
        await safeLoad("Unable to load system settings", loadSystemSettings);
        break;

      case "reports":
        break;

      case "profile":
        renderProfile();
        break;
    }
  } finally {
    state.busy = false;
  }
}

/* =========================================================
   EVENT HANDLERS
   ========================================================= */

function on(id, event, callback) {
  $(id)?.addEventListener(event, callback);
}

function setupNavigation() {
  document.querySelectorAll("[data-page]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(element.dataset.page);
    });
  });

  on("menuButton", "click", () => {
    if ($("sidebar")?.classList.contains("open")) closeMobileSidebar();
    else openMobileSidebar();
  });

  on("sidebarBackdrop", "click", closeMobileSidebar);

  window.addEventListener("hashchange", () => {
    const page = location.hash.replace(/^#/, "");
    if (PAGE_INFO[page] && page !== state.page) showPage(page, false);
  });

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.location.replace("/home.html");
  };
  on("topLogoutButton", "click", signOut);
}

function setupIncidentForm() {
  on("toggleIncidentForm", "click", () => {
    const panel = $("incidentFormPanel");
    if (panel) panel.hidden = !panel.hidden;
  });

  on("cancelIncidentForm", "click", () => {
    if ($("incidentFormPanel")) $("incidentFormPanel").hidden = true;
  });

  on("incidentForm", "submit", submitIncident);

  on("incidentSearch", "input", renderIncidentsTable);
  on("incidentStatusFilter", "change", renderIncidentsTable);

  on("refreshButton", "click", () =>
    safeLoad("Unable to refresh incidents", loadIncidents)
  );
}

function setupUserManagement() {
  on("refreshUsers", "click", () => safeLoad("Unable to refresh users", loadUsers));
  on("userSearch", "input", renderUsersTable);
  on("userStatusFilter", "change", renderUsersTable);
  const template = $('downloadUserImportTemplate');
  if (template) template.href = URL.createObjectURL(new Blob([
    'registration_number,full_name,email,phone,role\nRP-0001,Sample Student,student@example.edu,+250700000000,student\n'
  ], { type: 'text/csv;charset=utf-8' }));
  on('userImportForm', 'submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const result = $('userImportResult');
    const output = $('userImportCredentials');
    if (result) result.textContent = 'Importing accounts...';
    if (output) { output.replaceChildren(); output.hidden = true; }
    try {
      const response = await api('/api/users/import', { method: 'POST', body: new FormData(form) });
      if (result) result.textContent = `Imported ${response.created} account(s); skipped ${response.skipped?.length || 0} row(s). Temporary passwords are displayed once below.`;
      if (output && response.accounts?.length) {
        const table = document.createElement('table');
        const head = document.createElement('thead');
        const header = document.createElement('tr');
        ['Username', 'Temporary password'].forEach((label) => {
          const cell = document.createElement('th'); cell.textContent = label; header.appendChild(cell);
        });
        head.appendChild(header); table.appendChild(head);
        const body = document.createElement('tbody');
        response.accounts.forEach((account) => {
          const row = document.createElement('tr');
          [account.username, account.temporary_password].forEach((value) => {
            const cell = document.createElement('td'); cell.textContent = value; row.appendChild(cell);
          });
          body.appendChild(row);
        });
        table.appendChild(body); output.appendChild(table); output.hidden = false;
      }
      if (response.skipped?.length && result) {
        result.textContent += ` Skipped: ${response.skipped.map((item) => `${item.record || 'row'} — ${item.reason}`).join('; ')}`;
      }
      form.reset();
      await loadUsers();
    } catch (error) {
      if (result) result.textContent = `Import failed: ${error.message}`;
    }
  });
}

function setupSystemSettings() {
  on('systemSettingsForm', 'submit', saveSystemSettings);
  on('refreshSystemSettings', 'click', () => safeLoad('Unable to refresh system settings', loadSystemSettings));
}

async function loadMfaStatus() {
  const result = await api('/api/auth/mfa/status');
  if ($('mfaStatus')) $('mfaStatus').textContent = result.enabled
    ? 'Enabled. Sign-in requires a code from your authenticator app.'
    : 'Optional. Add an authenticator code as a second sign-in step.';
  if ($('startMfaSetup')) $('startMfaSetup').hidden = Boolean(result.enabled);
  if ($('mfaPasswordForm')) $('mfaPasswordForm').hidden = Boolean(result.enabled);
  if ($('disableMfaForm')) $('disableMfaForm').hidden = !result.enabled;
  if ($('mfaSetupPanel')) $('mfaSetupPanel').hidden = true;
  if ($('mfaRecoveryPanel')) $('mfaRecoveryPanel').hidden = true;
}

function setupMfaControls() {
  void loadMfaStatus().catch((error) => {
    if ($('mfaStatus')) $('mfaStatus').textContent = `Unable to load MFA status: ${error.message}`;
  });
  on('startMfaSetup', 'click', () => {
    if ($('mfaPasswordForm')) $('mfaPasswordForm').hidden = false;
    $('mfaCurrentPassword')?.focus();
  });
  on('mfaPasswordForm', 'submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
      const result = await api('/api/auth/mfa/setup', {
        method: 'POST', body: JSON.stringify({ password: $('mfaCurrentPassword').value })
      });
      $('mfaSecret').textContent = result.secret;
      $('mfaSetupPanel').hidden = false;
      $('mfaPasswordForm').hidden = true;
      $('mfaMessage').textContent = 'Add this key to your authenticator app, then verify a code to finish setup.';
      $('enableMfaCode')?.focus();
    } catch (error) {
      $('mfaMessage').textContent = error.message;
    }
  });
  on('enableMfaForm', 'submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    try {
      const result = await api('/api/auth/mfa/enable', {
        method: 'POST', body: JSON.stringify({ code: $('enableMfaCode').value.trim() })
      });
      $('mfaRecoveryCodes').textContent = result.recovery_codes.join('\n');
      $('mfaRecoveryPanel').hidden = false;
      $('mfaSetupPanel').hidden = true;
      $('mfaMessage').textContent = 'Two-factor sign-in is enabled. Save your one-time recovery codes now.';
      await loadMfaStatus();
      $('mfaRecoveryPanel').hidden = false;
    } catch (error) {
      $('mfaMessage').textContent = error.message;
    }
  });
  on('disableMfaForm', 'submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !window.confirm('Turn off two-factor sign-in for your account?')) return;
    try {
      await api('/api/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password: $('disableMfaPassword').value, code: $('disableMfaCode').value.trim() })
      });
      $('mfaMessage').textContent = 'Two-factor sign-in is turned off.';
      form.reset();
      await loadMfaStatus();
    } catch (error) {
      $('mfaMessage').textContent = error.message;
    }
  });
  on('copyMfaRecovery', 'click', async () => {
    try {
      await navigator.clipboard.writeText($('mfaRecoveryCodes').textContent);
      $('mfaMessage').textContent = 'Recovery codes copied.';
    } catch (_) {
      $('mfaMessage').textContent = 'Copy was blocked. Select and copy the recovery codes manually.';
    }
  });
}

function setupLostFound() {
  const foundOption = $("lostFoundType")?.querySelector('option[value="found"]');
  if (foundOption && !canManageLostFoundAndEmergencies()) {
    foundOption.disabled = true;
    foundOption.hidden = true;
  }

  on("toggleLostFoundForm", "click", () => {
    const panel = $("lostFoundFormPanel");
    if (panel) panel.hidden = !panel.hidden;
  });

  on("cancelLostFoundForm", "click", () => {
    if ($("lostFoundFormPanel")) $("lostFoundFormPanel").hidden = true;
  });

  on("lostFoundForm", "submit", submitLostFound);
  on("lostFoundSearch", "input", renderLostFound);
  on("lostFoundStatusFilter", "change", renderLostFound);

  on("refreshLostFound", "click", () =>
    safeLoad("Unable to refresh Lost and Found", loadLostFound)
  );
}

function setupOtherPages() {
  on("refreshEmergency", "click", () =>
    safeLoad("Unable to refresh alerts", loadEmergency)
  );
  on("emergencySearch", "input", renderEmergency);
  on("emergencyStatusFilter", "change", renderEmergency);

  on("refreshVisitors", "click", () =>
    safeLoad("Unable to refresh visitors", loadVisitors)
  );
  on("dashboardVisitorCheckInForm", "submit", submitDashboardVisitorCheckIn);
  on("visitorSearch", "input", renderVisitors);
  on("visitorStatusFilter", "change", renderVisitors);

  on("refreshGate", "click", () =>
    safeLoad("Unable to refresh gate records", loadGate)
  );
  on("gateSearch", "input", renderGate);
  on("gateStatusFilter", "change", renderGate);

  on("refreshPatrols", "click", () =>
    safeLoad("Unable to refresh patrols", loadPatrols)
  );
  setupPatrolActions();
  on("patrolSearch", "input", renderPatrols);
  on("patrolStatusFilter", "change", renderPatrols);

  on("refreshAuditLogs", "click", () =>
    safeLoad("Unable to refresh audit logs", loadAuditLogs)
  );
  on("auditSearch", "input", renderAuditLogs);

  on("loadIncidentReport", "click", loadIncidentReport);
  on("loadAccessReport", "click", loadAccessReport);
  on("refreshBackupStatus", "click", loadBackupStatus);
  on("downloadSelectedReport", "click", () => {
    downloadReport($("reportType")?.value, $("reportFormat")?.value || "pdf");
  });
  document.querySelectorAll("[data-download-report]").forEach((button) => {
    button.addEventListener("click", () => downloadReport(button.dataset.downloadReport, button.dataset.format));
  });
}

/* =========================================================
   INITIALIZATION
   ========================================================= */

function initDashboard() {
  const token = getToken();
  state.user = readUser();

  if (!token) {
    window.location.replace("/home.html");
    return;
  }

  renderProfile();
  applyRoleVisibility();

  setupNavigation();
  setupIncidentForm();
  setupUserManagement();
  setupSystemSettings();
  setupMfaControls();
  setupLostFound();
  setupOtherPages();

  openInitialPage();
  window.setInterval(() => {
    if (state.page === "emergency" && !document.hidden) void loadEmergency();
  }, 10000);
}

document.addEventListener("DOMContentLoaded", initDashboard);
