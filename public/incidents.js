const C = window.CSRS;
const { $, getToken, api, mountShell, formatDate, addCell, statusCell, emptyRow,
  showMessage, setLoading } = C;

mountShell({ current: "incidents" });

function addOptions(select, records, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  records.forEach((record) => {
    select.add(new Option(record.name, record.id));
  });
}

async function loadReferenceData() {
  try {
    const [categories, locations] = await Promise.all([
      api("/api/categories"),
      api("/api/locations")
    ]);
    addOptions($("category"), categories, "Select category");
    addOptions($("location"), locations, "Select location");
    if (!categories.length || !locations.length) {
      showMessage($("formMessage"), "Some categories or locations have not been configured yet.", "error");
    }
  } catch (error) {
    showMessage($("formMessage"), "Could not load categories and locations: " + error.message, "error");
  }
}

async function loadIncidents() {
  if (!getToken()) {
    $("incidentRows").replaceChildren();
    $("incidentRows").appendChild(emptyRow(6, "Sign in to view incident records for your account."));
    showMessage($("listMessage"), "");
    return;
  }

  showMessage($("listMessage"), "Loading records...");
  $("incidentRows").replaceChildren();

  try {
    const records = await api("/api/incidents");
    if (!Array.isArray(records) || records.length === 0) {
      $("incidentRows").appendChild(emptyRow(6, "No incidents are available to display."));
    } else {
      records.forEach((incident) => {
        const tr = document.createElement("tr");
        addCell(tr, incident.reference_no);
        addCell(tr, incident.category);
        addCell(tr, incident.location);
        addCell(tr, incident.severity);
        tr.appendChild(statusCell(incident.status));
        addCell(tr, formatDate(incident.reported_datetime, true));
        $("incidentRows").appendChild(tr);
      });
    }
    showMessage($("listMessage"), "Records loaded from the server.", "ok");
  } catch (error) {
    $("incidentRows").appendChild(emptyRow(6, "Unable to load incident records."));
    showMessage($("listMessage"), error.message, "error");
  }
}

$("incidentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("submitButton");
  const message = $("formMessage");
  setLoading(button, true, "Submit incident", "Submitting...");
  showMessage(message, "");

  try {
    const dateValue = $("incidentDate").value;
    if (!dateValue) throw new Error("Please select when the incident happened.");

    const categoryId = $("category").value;
    const locationId = $("location").value;
    const description = $("description").value.trim();
    if (!categoryId || !locationId) throw new Error("Please select a category and location.");
    if (!description) throw new Error("Please enter an incident description.");

    const files = $("evidence").files;
    let incident;

    if (files && files.length) {
      const form = new FormData();
      form.append("category_id", categoryId);
      form.append("location_id", locationId);
      form.append("incident_datetime", new Date(dateValue).toISOString());
      form.append("severity", $("severity").value);
      form.append("description", description);
      form.append("is_anonymous", $("anonymous").checked ? "true" : "false");
      Array.from(files).slice(0, 5).forEach((file) => form.append("evidence", file));
      incident = await api("/api/incidents", { method: "POST", body: form });
    } else {
      incident = await api("/api/incidents", {
        method: "POST",
        body: JSON.stringify({
          category_id: Number(categoryId),
          location_id: Number(locationId),
          incident_datetime: new Date(dateValue).toISOString(),
          severity: $("severity").value,
          description,
          is_anonymous: $("anonymous").checked
        })
      });
    }

    let text = "Incident submitted successfully.\nReference: " + (incident.reference_no || "Not provided");
    if (incident.access_code) {
      text += "\nAnonymous access code: " + incident.access_code + "\nKeep this code. You will need it to track the report.";
    }
    if (incident.notice) text += "\n" + incident.notice;
    showMessage(message, text, "ok");
    $("incidentForm").reset();
    await loadIncidents();
  } catch (error) {
    showMessage(message, "Submission failed: " + error.message, "error");
  } finally {
    setLoading(button, false, "Submit incident");
  }
});

$("trackForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ref = $("trackRef").value.trim();
  const code = $("trackCode").value.trim();
  const box = $("trackMessage");
  showMessage(box, "Checking...");

  try {
    const result = await api("/api/incidents/track/" + encodeURIComponent(ref), {
      headers: { "x-access-code": code }
    });
    const updates = Array.isArray(result.updates) && result.updates.length
      ? result.updates.map((item) =>
        formatDate(item.created_at, true) + " · " + (item.new_status || "") + (item.note ? " — " + item.note : "")
      ).join("\n")
      : "No public updates yet.";
    showMessage(
      box,
      "Status: " + result.status +
        "\nSeverity: " + result.severity +
        "\nReported: " + formatDate(result.reported_datetime, true) +
        "\n\nUpdates:\n" + updates,
      "ok"
    );
  } catch (error) {
    showMessage(box, error.message, "error");
  }
});

$("refreshButton").addEventListener("click", loadIncidents);
loadReferenceData();
loadIncidents();
