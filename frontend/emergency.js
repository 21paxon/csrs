// Purpose: Browser-side behavior for the emergency workflow.
const C = window.CSRS;
let previousAlertIds = null;
const { $, requireAuth, roleOf, canSecurityOps, api, mountShell, formatDate,
  showMessage, setLoading, emptyRow, getDeviceLocation } = C;

if (!requireAuth()) {
  /* redirected */
} else {
  mountShell({ current: "emergency" });
  void loadEmergencyContacts();
  initialize();
}

async function loadEmergencyContacts() {
  const list = $("emergencyContacts");
  try {
    const contacts = await api("/api/emergency-contacts");
    list.replaceChildren();
    if (!contacts.length) {
      list.textContent = "Emergency contact numbers have not been configured.";
      return;
    }
    contacts.forEach((contact) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      const dial = String(contact.phone_number).replace(/[^0-9+*#]/g, "");
      link.href = `tel:${dial}`;
      link.textContent = `${contact.name}: ${contact.phone_number}`;
      item.appendChild(link);
      if (contact.description) {
        const description = document.createElement("span");
        description.textContent = ` — ${contact.description}`;
        item.appendChild(description);
      }
      list.appendChild(item);
    });
  } catch (error) {
    list.textContent = `Emergency contacts could not be loaded: ${error.message}`;
  }
}

async function initialize() {
  if (canSecurityOps(roleOf())) {
    $("responderSection").classList.remove("hidden");
    $("refreshBtn").addEventListener("click", loadAlerts);
    $("enableDesktopAlerts").addEventListener("click", async () => {
      if (!("Notification" in window)) {
        showMessage($("listMessage"), "Desktop notifications are not supported by this browser.", "error");
        return;
      }
      const permission = await Notification.requestPermission();
      showMessage($("listMessage"), permission === "granted"
        ? "Desktop emergency alerts are enabled while this page is open."
        : "Desktop notifications were not enabled.", permission === "granted" ? "ok" : "error");
    });
    $("statusFilter").addEventListener("change", loadAlerts);
    $("alertsBody").addEventListener("click", onAlertAction);
    await loadAlerts();
    window.setInterval(() => { if (!document.hidden) void loadAlerts(); }, 10000);
  } else {
    showMessage($("formMessage"), "You can request emergency assistance here. The security team will be notified.");
  }
}

$("alertForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("alertMessage").value.trim();
  if (!message) {
    showMessage($("formMessage"), "Enter the emergency details.", "error");
    return;
  }

  const button = $("triggerBtn");
  setLoading(button, true, "Trigger emergency alert", "Submitting...");
  showMessage($("formMessage"), "Submitting emergency alert...");

  try {
    const coords = await getDeviceLocation();
    const payload = { message };
    if (coords) {
      payload.latitude = coords.latitude;
      payload.longitude = coords.longitude;
      $("locationNote").textContent = "Location attached: " + coords.latitude.toFixed(5) + ", " + coords.longitude.toFixed(5);
    } else {
      $("locationNote").textContent = "Location was not available. The alert will still be sent.";
    }

    const alert = await api("/api/emergency", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    $("alertForm").reset();
    showMessage($("formMessage"), "Emergency alert #" + alert.id + " submitted successfully.", "ok");
    if (canSecurityOps()) await loadAlerts();
  } catch (error) {
    showMessage($("formMessage"), error.message, "error");
  } finally {
    setLoading(button, false, "Trigger emergency alert");
  }
});

async function loadAlerts() {
  const body = $("alertsBody");
  body.replaceChildren();
  body.appendChild(emptyRow(7, "Loading alerts..."));
  showMessage($("listMessage"), "");

  const status = $("statusFilter").value;
  const query = status ? "?status=" + encodeURIComponent(status) : "";

  try {
    const alerts = await api("/api/emergency" + query);
    const activeIds = new Set(alerts.filter((alert) => alert.status === "Triggered").map((alert) => alert.id));
    if (previousAlertIds && "Notification" in window && Notification.permission === "granted") {
      alerts.filter((alert) => alert.status === "Triggered" && !previousAlertIds.has(alert.id))
        .forEach((alert) => new Notification("CSRS emergency alert", { body: `Alert #${alert.id} needs acknowledgement.` }));
    }
    previousAlertIds = activeIds;
    if (!Array.isArray(alerts) || alerts.length === 0) {
      body.replaceChildren();
      body.appendChild(emptyRow(7, "No emergency alerts found."));
      return;
    }

    body.replaceChildren();
    alerts.forEach((alert) => {
      const tr = document.createElement("tr");
      C.addCell(tr, alert.id);
      C.addCell(tr, (alert.username || ("User " + alert.user_id)) + (alert.phone ? " · " + alert.phone : ""));
      C.addCell(tr, alert.message);
      C.addCell(tr, alert.lat != null && alert.lng != null ? alert.lat + ", " + alert.lng : "Not provided");
      tr.appendChild(C.statusCell(alert.status));
      C.addCell(tr, formatDate(alert.triggered_at, true));

      const td = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";

      if (alert.status === "Triggered") {
        actions.appendChild(actionButton("acknowledge", alert.id, "Acknowledge", "success"));
      }
      if (alert.status === "Acknowledged") {
        actions.appendChild(actionButton("arrive", alert.id, "Mark arrived", "success"));
      }
      if (["Triggered", "Acknowledged", "Arrived"].includes(alert.status)) {
        actions.appendChild(actionButton("resolve", alert.id, "Resolve", "danger"));
      }
      if (!actions.children.length) {
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = "No actions available";
        actions.appendChild(span);
      }
      td.appendChild(actions);
      tr.appendChild(td);
      body.appendChild(tr);
    });
  } catch (error) {
    body.replaceChildren();
    body.appendChild(emptyRow(7, "Unable to load alerts."));
    showMessage($("listMessage"), error.message, "error");
  }
}

function actionButton(action, id, label, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.action = action;
  button.dataset.id = String(id);
  button.textContent = label;
  return button;
}

async function onAlertAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;
  const labels = { acknowledge: "acknowledge", arrive: "mark as arrived", resolve: "resolve" };

  if (!window.confirm("Are you sure you want to " + labels[action] + " alert #" + id + "?")) {
    return;
  }

  button.disabled = true;
  try {
    await api("/api/emergency/" + id + "/" + action, { method: "PATCH" });
    showMessage($("listMessage"), "Alert #" + id + " updated successfully.", "ok");
    await loadAlerts();
  } catch (error) {
    showMessage($("listMessage"), error.message, "error");
    button.disabled = false;
  }
}
