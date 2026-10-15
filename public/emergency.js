const C = window.CSRS;
const { $, requireAuth, roleOf, canSecurityOps, api, mountShell, formatDate,
  showMessage, setLoading, emptyRow, getDeviceLocation } = C;

if (!requireAuth()) {
  /* redirected */
} else {
  mountShell({ current: "emergency" });
  initialize();
}

async function initialize() {
  if (canSecurityOps(roleOf())) {
    $("responderSection").classList.remove("hidden");
    $("refreshBtn").addEventListener("click", loadAlerts);
    $("statusFilter").addEventListener("change", loadAlerts);
    $("alertsBody").addEventListener("click", onAlertAction);
    await loadAlerts();
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
