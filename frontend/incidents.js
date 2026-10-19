const C = window.CSRS;
const { $, getToken, getUser, roleOf, api, mountShell, formatDate, addCell, statusCell, emptyRow,
  showMessage, setLoading } = C;
const role = roleOf();
const canReview = ["admin", "head_security", "security_officer"].includes(role);
const canAssign = ["admin", "head_security"].includes(role);
let selectedIncident = null;
let incidentMap;
let mapMarker;

mountShell({ current: "incidents" });

function addOptions(select, records, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  records.forEach((record) => {
    select.add(new Option(record.name, record.id));
  });
}

async function openIncidentDetails(id) {
  showMessage($("incidentDetailsMessage"), "Loading incident details...");
  $("incidentDetailsPanel").hidden = false;
  $("incidentDetailsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    selectedIncident = await api("/api/incidents/" + encodeURIComponent(id));
    renderIncidentDetails(selectedIncident);
  } catch (error) {
    showMessage($("incidentDetailsMessage"), error.message, "error");
  }
}

function renderIncidentDetails(incident) {
  $("incidentDetailsTitle").textContent = `Incident ${incident.reference_no}`;
  $("incidentDetailsSummary").textContent =
    `${incident.category || "Uncategorised"} · ${incident.location || "Location not recorded"} · ${incident.severity}`;
  const body = $("incidentDetailsBody");
  body.replaceChildren();
  const info = document.createElement("div");
  info.className = "grid";
  addDetail(info, "Status", incident.status);
  addDetail(info, "Reported", formatDate(incident.reported_datetime, true));
  addDetail(info, "Incident time", formatDate(incident.incident_datetime, true));
  addDetail(info, "Assigned officer", incident.assigned_officer);
  addDetail(info, "Description", incident.description);

  const evidenceTitle = document.createElement("h3");
  evidenceTitle.textContent = "Evidence";
  info.appendChild(evidenceTitle);
  const evidenceList = document.createElement("ul");
  (incident.evidence || []).forEach((file) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#evidence";
    link.textContent = file.original_name;
    link.addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const response = await fetch(
          C.apiUrl(`/api/incidents/${incident.id}/evidence/${file.id}`),
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        if (!response.ok) throw new Error("Evidence could not be downloaded.");
        const blobUrl = URL.createObjectURL(await response.blob());
        const download = document.createElement("a");
        download.href = blobUrl;
        download.download = file.original_name;
        download.click();
        URL.revokeObjectURL(blobUrl);
      } catch (error) {
        showMessage($("incidentDetailsMessage"), error.message, "error");
      }
    });
    item.appendChild(link);
    evidenceList.appendChild(item);
  });
  if (!incident.evidence?.length) evidenceList.textContent = "No evidence attached.";
  info.appendChild(evidenceList);

  const historyTitle = document.createElement("h3");
  historyTitle.textContent = "Review history";
  info.appendChild(historyTitle);
  const history = document.createElement("div");
  (incident.updates || []).forEach((update) => {
    const item = document.createElement("p");
    item.textContent = `${formatDate(update.created_at, true)} · ${update.new_status || "Note"}${update.note ? ` — ${update.note}` : ""}`;
    history.appendChild(item);
  });
  if (!incident.updates?.length) history.textContent = "No review updates yet.";
  info.appendChild(history);
  body.appendChild(info);

  const form = $("incidentUpdateForm");
  form.hidden = !canReview || (role === "security_officer" && incident.assigned_to !== getUser()?.id);
  $("incidentAssignment").hidden = !canAssign;
  showMessage($("incidentDetailsMessage"), "");
  if (canAssign) loadOfficers();
}

async function loadOfficers() {
  try {
    const officers = await api("/api/users/officers");
    const select = $("incidentOfficer");
    select.replaceChildren(new Option("Select an officer", ""));
    officers.forEach((officer) => {
      select.add(new Option(
        `${officer.full_name || officer.username}${officer.phone ? ` · ${officer.phone}` : ""}`,
        officer.id
      ));
    });
  } catch (error) {
    showMessage($("incidentDetailsMessage"), "Could not load security officers: " + error.message, "error");
  }
}

function addDetail(container, label, value) {
  const item = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = label;
  const content = document.createElement("p");
  content.textContent = value || "Not recorded";
  item.append(heading, content);
  container.appendChild(item);
}

$("closeIncidentDetails").addEventListener("click", () => {
  $("incidentDetailsPanel").hidden = true;
  selectedIncident = null;
});

$("assignIncident").addEventListener("click", async () => {
  if (!selectedIncident || !$("incidentOfficer").value) {
    showMessage($("incidentDetailsMessage"), "Select a security officer first.", "error");
    return;
  }

  const button = $("assignIncident");
  setLoading(button, true, "Assign case", "Assigning...");
  try {
    await api(`/api/incidents/${selectedIncident.id}/assign`, {
      method: "POST",
      body: JSON.stringify({ officer_id: Number($("incidentOfficer").value) })
    });
    showMessage($("incidentDetailsMessage"), "Incident assigned. The officer has been notified.", "ok");
    await loadIncidents();
    await openIncidentDetails(selectedIncident.id);
  } catch (error) {
    showMessage($("incidentDetailsMessage"), error.message, "error");
  } finally {
    setLoading(button, false, "Assign case");
  }
});

$("incidentUpdateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedIncident) return;
  const button = $("saveIncidentUpdate");
  setLoading(button, true, "Save review update", "Saving...");
  try {
    await api(`/api/incidents/${selectedIncident.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: $("incidentStatus").value || undefined,
        notes: $("incidentNotes").value.trim() || undefined,
        internal: $("incidentInternal").checked
      })
    });

    $("incidentNotes").value = "";
    $("incidentStatus").value = "";
    showMessage($("incidentDetailsMessage"), "Review update saved and permitted reporters were notified.", "ok");
    await loadIncidents();
    await openIncidentDetails(selectedIncident.id);
  } catch (error) {
    showMessage($("incidentDetailsMessage"), error.message, "error");
  } finally {
    setLoading(button, false, "Save review update");
  }
});

async function loadReferenceData() {
  try {
    const [categories, locations] = await Promise.all([
      api("/api/categories"),
      api("/api/locations")
    ]);
    addOptions($("category"), categories, "Select category");
    addOptions($("location"), locations, "Select location");
    if (!categories.length) {
      showMessage($("formMessage"), "Incident categories have not been configured yet.", "error");
    }
    initializeIncidentMap(locations);
  } catch (error) {
    showMessage($("formMessage"), "Could not load categories and locations: " + error.message, "error");
  }
}

function initializeIncidentMap(locations) {
  if (!window.L || !$('incidentMap')) return;
  const mapped = locations.filter((location) => Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng)));
  const center = mapped.length
    ? [Number(mapped[0].lat), Number(mapped[0].lng)]
    : [-1.5, 29.6];
  incidentMap = L.map('incidentMap').setView(center, mapped.length ? 15 : 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(incidentMap);
  mapped.forEach((location) => L.marker([Number(location.lat), Number(location.lng)])
    .bindPopup(location.name).addTo(incidentMap));
  incidentMap.on('click', (event) => setMapPoint(event.latlng.lat, event.latlng.lng));
  $('location').addEventListener('change', () => {
    $('mapLat').value = '';
    $('mapLng').value = '';
    $('mapLocationStatus').textContent = $('location').value
      ? 'Configured campus location selected.'
      : 'Choose a configured campus location or tap the map.';
    if (mapMarker) { incidentMap.removeLayer(mapMarker); mapMarker = null; }
  });
  $('useCurrentLocation').addEventListener('click', () => {
    if (!navigator.geolocation) {
      $('mapLocationStatus').textContent = 'This browser does not provide location access.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        incidentMap.setView([latitude, longitude], 17);
        setMapPoint(latitude, longitude);
      },
      () => { $('mapLocationStatus').textContent = 'Location was not available. Choose a point on the map or select a campus location.'; },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
  window.setTimeout(() => incidentMap.invalidateSize(), 0);
}

function setMapPoint(lat, lng) {
  $('location').value = '';
  $('mapLat').value = String(lat);
  $('mapLng').value = String(lng);
  $('mapLocationStatus').textContent = `Map point selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (mapMarker) incidentMap.removeLayer(mapMarker);
  mapMarker = L.marker([lat, lng]).addTo(incidentMap).bindPopup('Selected incident location');
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
        tr.className = "clickable-row";
        tr.tabIndex = 0;
        tr.title = "Open incident details";
        tr.addEventListener("click", () => openIncidentDetails(incident.id));
        tr.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openIncidentDetails(incident.id);
          }
        });
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
    const lat = $("mapLat").value;
    const lng = $("mapLng").value;
    const description = $("description").value.trim();
    if (!categoryId || (!locationId && (!lat || !lng))) throw new Error("Please select a category and a campus location or map point.");
    if (!description) throw new Error("Please enter an incident description.");

    const files = $("evidence").files;
    let incident;

    if (files && files.length) {
      const form = new FormData();
      form.append("category_id", categoryId);
      form.append("location_id", locationId);
      if (lat && lng) { form.append("lat", lat); form.append("lng", lng); form.append("location_text", "Map pin"); }
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
          ...(lat && lng ? { lat: Number(lat), lng: Number(lng), location_text: "Map pin" } : {}),
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

$("incidentForm").addEventListener("reset", () => {
  window.setTimeout(() => {
    if (mapMarker && incidentMap) incidentMap.removeLayer(mapMarker);
    mapMarker = null;
    if ($("mapLocationStatus")) {
      $("mapLocationStatus").textContent = "Choose a configured campus location or tap the map.";
    }
  }, 0);
});

$("refreshButton").addEventListener("click", loadIncidents);
loadReferenceData();
loadIncidents();
