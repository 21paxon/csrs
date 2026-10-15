(() => {
  const token = sessionStorage.getItem("csrs_token");
  const $ = id => document.getElementById(id);
  const form = $("checkInForm");
  const formMessage = $("formMessage");
  const pageMessage = $("pageMessage");
  const listMessage = $("listMessage");
  const rows = $("visitorRows");
  const hostSelect = $("host_user_id");

  function logout() {
    sessionStorage.removeItem("csrs_token");
    sessionStorage.removeItem("csrs_user");
    window.top.location.replace("/index.html");
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(options.body instanceof FormData ? {} : options.body ? {"Content-Type":"application/json"} : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { logout(); throw new Error("Your session expired. Sign in again."); }
    if (!response.ok) throw new Error(data.error || data.message || "Request failed (HTTP " + response.status + ").");
    return data;
  }

  function message(el, text, error = false) {
    el.textContent = text;
    el.className = "message " + (error ? "error" : "ok");
  }

  function cell(row, value) {
    const td = document.createElement("td");
    td.textContent = value == null || value === "" ? "—" : String(value);
    row.appendChild(td);
    return td;
  }

  function date(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  }

  async function loadHosts() {
    const hosts = await api("/api/users/hosts");
    hostSelect.replaceChildren(new Option("Select the person being visited", ""));
    hosts.forEach(host => {
      const name = host.full_name || host.username || ("User #" + host.id);
      hostSelect.add(new Option(name + (host.role ? " · " + host.role : ""), host.id));
    });
    if (!hosts.length) message(formMessage, "No active visitor hosts were found. Ask an administrator to check staff accounts.", true);
  }

  async function loadVisitors() {
    rows.replaceChildren();
    cellMessage("Loading current visitors…");
    try {
      const visitors = await api("/api/gate/on-campus");
      $("visitorCount").textContent = visitors.length + (visitors.length === 1 ? " visitor on campus" : " visitors on campus");
      if (!visitors.length) {
        const tr = document.createElement("tr"); const td = document.createElement("td");
        td.colSpan = 8; td.textContent = "No visitors are currently checked in."; tr.appendChild(td); rows.appendChild(tr);
      }
      visitors.forEach(visitor => {
        const tr = document.createElement("tr");
        cell(tr, visitor.full_name); cell(tr, visitor.id_number); cell(tr, visitor.phone);
        cell(tr, visitor.purpose); cell(tr, visitor.host_text || ("Host #" + (visitor.host_user_id || "—")));
        cell(tr, visitor.badge_no || visitor.badge_number); cell(tr, date(visitor.entry_at || visitor.entry_time));
        const action = document.createElement("td");
        const button = document.createElement("button"); button.type = "button"; button.textContent = "Check out";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try { await api("/api/gate/" + encodeURIComponent(visitor.id || visitor.visitor_id) + "/check-out", {method:"POST"}); message(pageMessage, "Visitor checked out successfully."); await loadVisitors(); }
          catch (error) { message(pageMessage, error.message, true); button.disabled = false; }
        });
        action.appendChild(button); tr.appendChild(action); rows.appendChild(tr);
      });
      message(listMessage, "");
    } catch (error) {
      $("visitorCount").textContent = "Visitor list unavailable";
      message(listMessage, error.message, true);
      if (!rows.children.length) { const tr=document.createElement("tr"); const td=document.createElement("td"); td.colSpan=8; td.textContent="Could not load visitors."; tr.appendChild(td); rows.appendChild(tr); }
    }
  }

  function cellMessage(text) { listMessage.textContent = text; listMessage.className = "message"; }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("checkInButton");
    button.disabled = true;
    message(formMessage, "Registering visitor…");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.host_user_id = Number(payload.host_user_id);
    try {
      const visitor = await api("/api/gate/check-in", {method:"POST", body:JSON.stringify(payload)});
      form.reset();
      message(formMessage, "Visitor checked in. Badge number: " + (visitor.badge_no || visitor.badge_number || "issued"));
      await loadVisitors();
    } catch (error) { message(formMessage, error.message, true); }
    finally { button.disabled = false; }
  });

  $("refreshVisitors").addEventListener("click", loadVisitors);
  if (!token) { window.top.location.replace("/index.html"); return; }
  Promise.all([loadHosts(), loadVisitors()]).catch(error => message(pageMessage, error.message, true));
})();