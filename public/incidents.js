
const token = sessionStorage.getItem("csrs_token");
const $ = id => document.getElementById(id);

if (token) {
  $("signInLink").hidden = true;
  $("logoutLink").hidden = false;
}

$("logoutLink").addEventListener("click", event => {
  event.preventDefault();
  sessionStorage.removeItem("csrs_token");
  sessionStorage.removeItem("csrs_user");
  window.location.replace("/index.html");
});

function authHeaders() {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && token) {
    sessionStorage.removeItem("csrs_token");
    sessionStorage.removeItem("csrs_user");
    window.location.replace("/index.html");
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    throw new Error(
      data.error || "Request failed (HTTP " + response.status + ")."
    );
  }

  return data;
}

function addOptions(select, records, placeholder) {
  select.replaceChildren(new Option(placeholder, ""));
  records.forEach(record => {
    select.add(new Option(record.name, record.id));
  });
}

async function loadReferenceData() {
  try {
    const [categories, locations] = await Promise.all([
      request("/api/categories"),
      request("/api/locations")
    ]);

    addOptions($("category"), categories, "Select category");
    addOptions($("location"), locations, "Select location");

    if (!categories.length || !locations.length) {
      $("formMessage").textContent =
        "Some categories or locations have not been configured yet.";
      $("formMessage").className = "message error";
    }
  } catch (error) {
    $("formMessage").textContent =
      "Could not load categories and locations: " + error.message;
    $("formMessage").className = "message error";
  }
}

async function loadIncidents() {
  $("listMessage").textContent = "Loading records...";
  $("listMessage").className = "message";
  $("incidentRows").replaceChildren();

  try {
    const records = await request("/api/incidents");

    if (!Array.isArray(records) || records.length === 0) {
      $("incidentRows").innerHTML =
        '<tr><td colspan="6">No incidents are available to display.</td></tr>';
    } else {
      records.forEach(incident => {
        const tr = document.createElement("tr");

        const values = [
          incident.reference_no,
          incident.category,
          incident.location,
          incident.severity,
          incident.status,
          incident.reported_datetime
            ? new Date(incident.reported_datetime).toLocaleString()
            : "—"
        ];

        values.forEach(value => {
          const td = document.createElement("td");
          td.textContent = value ?? "—";
          tr.appendChild(td);
        });

        $("incidentRows").appendChild(tr);
      });
    }

    $("listMessage").textContent = "Records loaded from the server.";
    $("listMessage").className = "message success";
  } catch (error) {
    $("incidentRows").innerHTML =
      '<tr><td colspan="6">Unable to load incident records.</td></tr>';
    $("listMessage").textContent = error.message;
    $("listMessage").className = "message error";
  }
}

$("incidentForm").addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("submitButton");
  const message = $("formMessage");

  button.disabled = true;
  button.textContent = "Submitting...";
  message.textContent = "";
  message.className = "message";

  try {
    const dateValue = $("incidentDate").value;

    if (!dateValue) {
      throw new Error("Please select when the incident happened.");
    }

    const payload = {
      category_id: Number($("category").value),
      location_id: Number($("location").value),
      incident_datetime: new Date(dateValue).toISOString(),
      severity: $("severity").value,
      description: $("description").value.trim(),
      is_anonymous: $("anonymous").checked
    };

    if (!payload.category_id || !payload.location_id) {
      throw new Error("Please select a category and location.");
    }

    if (!payload.description) {
      throw new Error("Please enter an incident description.");
    }

    const incident = await request("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    message.className = "message success";
    message.textContent =
      "Incident submitted successfully.\nReference: " +
      (incident.reference_no || "Not provided") +
      (incident.access_code
        ? "\nAnonymous access code: " + incident.access_code
        : "") +
      (incident.notice ? "\n" + incident.notice : "");

    $("incidentForm").reset();
    await loadIncidents();
  } catch (error) {
    message.className = "message error";
    message.textContent = "Submission failed: " + error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Submit Incident";
  }
});

$("refreshButton").addEventListener("click", loadIncidents);

loadReferenceData();
loadIncidents();
