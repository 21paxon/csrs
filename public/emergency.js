

const token = sessionStorage.getItem("csrs_token");
const $ = id => document.getElementById(id);

const form = $("alertForm");
const formMessage = $("formMessage");
const listMessage = $("listMessage");
const alertsBody = $("alertsBody");
const responderSection = $("responderSection");
const triggerBtn = $("triggerBtn");
const refreshBtn = $("refreshBtn");
const statusFilter = $("statusFilter");

const RESPONDER_ROLES = [
  "admin",
  "head_security",
  "security_officer"
];

let user = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.className = `message ${isError ? "error" : "ok"}`;
}

function logout() {
  sessionStorage.removeItem("csrs_token");
  sessionStorage.removeItem("csrs_user");
  window.location.replace("/index.html");
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (response.status === 401) {
    logout();
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      `Request failed (${response.status}).`
    );
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString();
}

function isResponder() {
  return Boolean(user && RESPONDER_ROLES.includes(user.role));
}

async function initialize() {
  if (!token) {
    window.location.replace("/index.html");
    return;
  }

  try {
    user = await apiRequest("/api/auth/me");

    if (!user) {
      logout();
      return;
    }

    if (!isResponder()) {
      responderSection.classList.add("hidden");
      showMessage(
        formMessage,
        "You can request emergency assistance here. The security response team will be notified."
      );
      return;
    }

    responderSection.classList.remove("hidden");
    await loadAlerts();
  } catch (error) {
    showMessage(formMessage, error.message, true);
  }
}

// Submit an emergency alert.
form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!token) {
    window.location.replace("/index.html");
    return;
  }

  const message = $("alertMessage").value.trim();
  const latInput = $("latitude").value.trim();
  const lngInput = $("longitude").value.trim();

  if (!message) {
    showMessage(formMessage, "Enter the emergency details.", true);
    return;
  }

  if ((latInput && !lngInput) || (!latInput && lngInput)) {
    showMessage(
      formMessage,
      "Enter both coordinates or leave both empty.",
      true
    );
    return;
  }

  const payload = { message };

  if (latInput && lngInput) {
    payload.latitude = Number(latInput);
    payload.longitude = Number(lngInput);

    if (
      !Number.isFinite(payload.latitude) ||
      !Number.isFinite(payload.longitude) ||
      payload.latitude < -90 ||
      payload.latitude > 90 ||
      payload.longitude < -180 ||
      payload.longitude > 180
    ) {
      showMessage(formMessage, "Invalid coordinates.", true);
      return;
    }
  }

  triggerBtn.disabled = true;
  showMessage(formMessage, "Submitting emergency alert...");

  try {
    const alert = await apiRequest("/api/emergency", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    form.reset();

    showMessage(
      formMessage,
      `Emergency alert #${alert.id} submitted successfully.`
    );

    if (isResponder()) {
      await loadAlerts();
    }
  } catch (error) {
    showMessage(formMessage, error.message, true);
  } finally {
    triggerBtn.disabled = false;
  }
});

// Load alerts for authorized responders.
async function loadAlerts() {
  if (!isResponder()) return;

  alertsBody.innerHTML =
    '<tr><td colspan="7">Loading alerts...</td></tr>';

  listMessage.textContent = "";

  const status = statusFilter.value;
  const query = status
    ? `?status=${encodeURIComponent(status)}`
    : "";

  try {
    const alerts = await apiRequest(`/api/emergency${query}`);

    if (!Array.isArray(alerts)) {
      throw new Error("Unexpected response from the emergency API.");
    }

    if (alerts.length === 0) {
      alertsBody.innerHTML =
        '<tr><td colspan="7">No emergency alerts found.</td></tr>';
      return;
    }

    alertsBody.innerHTML = alerts.map(alert => {
      const hasLocation = alert.lat != null && alert.lng != null;
      const id = Number(alert.id);
      let actions = "";

      if (alert.status === "Triggered") {
        actions += `
          <button class="success" data-action="acknowledge"
            data-id="${id}">Acknowledge Alert</button>`;
      }

      if (alert.status === "Acknowledged") {
        actions += `
          <button class="success" data-action="arrive"
            data-id="${id}">Mark Arrived</button>`;
      }

      if (["Triggered", "Acknowledged", "Arrived"].includes(alert.status)) {
        actions += `
          <button class="danger" data-action="resolve"
            data-id="${id}">Resolve</button>`;
      }

      if (!actions) {
        actions = '<span class="muted">No actions available</span>';
      }

      return `
        <tr>
          <td>${id}</td>
          <td>
            ${escapeHtml(alert.username || `User ${alert.user_id}`)}
            <br>
            <span class="muted">${escapeHtml(alert.phone || "")}</span>
          </td>
          <td>${escapeHtml(alert.message)}</td>
          <td>${hasLocation
            ? `${escapeHtml(alert.lat)}, ${escapeHtml(alert.lng)}`
            : "Not provided"}</td>
          <td class="status">${escapeHtml(alert.status)}</td>
          <td>${escapeHtml(formatDate(alert.triggered_at))}</td>
          <td><div class="actions">${actions}</div></td>
        </tr>`;
    }).join("");
  } catch (error) {
    alertsBody.innerHTML =
      '<tr><td colspan="7">Unable to load alerts.</td></tr>';

    showMessage(listMessage, error.message, true);
  }
}

// Handle responder actions.
alertsBody.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button || !isResponder()) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  if (
    !Number.isInteger(id) ||
    id < 1 ||
    !["acknowledge", "arrive", "resolve"].includes(action)
  ) {
    return;
  }

  const labels = {
    acknowledge: "acknowledge",
    arrive: "mark as arrived",
    resolve: "resolve"
  };

  if (!window.confirm(
    `Are you sure you want to ${labels[action]} alert #${id}?`
  )) {
    return;
  }

  button.disabled = true;

  try {
    await apiRequest(`/api/emergency/${id}/${action}`, {
      method: "PATCH"
    });

    showMessage(
      listMessage,
      `Alert #${id} updated successfully.`
    );

    await loadAlerts();
  } catch (error) {
    showMessage(listMessage, error.message, true);
    button.disabled = false;
  }
});

refreshBtn.addEventListener("click", loadAlerts);
statusFilter.addEventListener("change", loadAlerts);

$("logoutBtn").addEventListener("click", event => {
  event.preventDefault();
  logout();
});

// Start the page.
initialize();