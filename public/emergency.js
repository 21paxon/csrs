
"use strict";

const token = sessionStorage.getItem("csrs_token");

const form = document.getElementById("alertForm");
const formMessage = document.getElementById("formMessage");
const listMessage = document.getElementById("listMessage");
const alertsBody = document.getElementById("alertsBody");
const responderSection = document.getElementById("responderSection");
const triggerBtn = document.getElementById("triggerBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusFilter = document.getElementById("statusFilter");

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
    sessionStorage.removeItem("csrs_token");
    sessionStorage.removeItem("csrs_user");
    window.location.href = "/index.html";
    throw new Error("Session expired. Please log in again.");
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error ||
      `Request failed (${response.status})`;

    throw new Error(message);
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

// Trigger an emergency alert.
form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!token) {
    window.location.href = "/index.html";
    return;
  }

  const message = document.getElementById("alertMessage").value.trim();
  const latInput = document.getElementById("latitude").value.trim();
  const lngInput = document.getElementById("longitude").value.trim();

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

    // Refresh the list if the current user has responder permission.
    await loadAlerts();
  } catch (error) {
    showMessage(formMessage, error.message, true);
  } finally {
    triggerBtn.disabled = false;
  }
});

// Load alerts for authorized responders.
async function loadAlerts() {
  if (!token) {
    window.location.href = "/index.html";
    return;
  }

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

    responderSection.classList.remove("hidden");

    if (alerts.length === 0) {
      alertsBody.innerHTML =
        '<tr><td colspan="7">No emergency alerts found.</td></tr>';
      return;
    }

    alertsBody.innerHTML = alerts.map(alert => {
      const hasLocation =
        alert.lat != null && alert.lng != null;

      let actions = "";

      if (alert.status === "Acknowledged") {
        actions += `
          <button class="success" data-action="arrive"
            data-id="${Number(alert.id)}">Mark Arrived</button>`;
      }

      if (["Triggered", "Acknowledged", "Arrived"].includes(alert.status)) {
        actions += `
          <button class="danger" data-action="resolve"
            data-id="${Number(alert.id)}">Resolve</button>`;
      }

      if (!actions) {
        actions = '<span class="muted">No actions available</span>';
      }

      return `
        <tr>
          <td>${Number(alert.id)}</td>
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

    if (error.message.includes("403")) {
      showMessage(
        listMessage,
        "Only authorized security responders can view emergency alerts.",
        true
      );
    } else {
      showMessage(listMessage, error.message, true);
    }
  }
}

// Handle supported responder actions.
alertsBody.addEventListener("click", async event => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;

  if (!Number.isInteger(id) || id < 1) return;
  if (!["arrive", "resolve"].includes(action)) return;

  const confirmed = window.confirm(
    `Are you sure you want to ${action} emergency alert #${id}?`
  );

  if (!confirmed) return;

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

document.getElementById("logoutBtn").addEventListener("click", event => {
  event.preventDefault();
  sessionStorage.removeItem("csrs_token");
  sessionStorage.removeItem("csrs_user");
  window.location.href = "/index.html";
});

// Initial load.
if (!token) {
  window.location.href = "/index.html";
} else {
  loadAlerts();
}
