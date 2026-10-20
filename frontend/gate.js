const C = window.CSRS;
const { $, requireAuth, canGate, roleOf, api, mountShell, formatDate,
  showMessage, setLoading, addCell, emptyRow } = C;

if (!requireAuth()) {
  /* redirected */
} else if (canGate(roleOf())) {
  // Keep every visitor workflow in the role-aware dashboard.
  window.location.replace("/dashboard.html#visitors");
} else {
  mountShell({ current: "gate" });
  $("deniedPanel").hidden = false;
  $("gateWorkspace").hidden = true;
}

function startGate() {
  const form = $("checkInForm");
  const hostSelect = $("host_user_id");

  async function loadHosts() {
    const hosts = await api("/api/users/hosts");
    hostSelect.replaceChildren(new Option("Select the person being visited", ""));
    hosts.forEach((host) => {
      const name = host.full_name || host.username || ("User #" + host.id);
      hostSelect.add(new Option(name + (host.role ? " · " + host.role : ""), host.id));
    });
    if (!hosts.length) {
      showMessage($("formMessage"), "No active visitor hosts were found.", "error");
    }
  }

  async function loadVisitors() {
    const rows = $("visitorRows");
    rows.replaceChildren();
    try {
      const visitors = await api("/api/gate/on-campus");
      $("visitorCount").textContent =
        visitors.length + (visitors.length === 1 ? " visitor on campus" : " visitors on campus");

      if (!visitors.length) {
        rows.appendChild(emptyRow(8, "No visitors are currently checked in."));
        return;
      }

      visitors.forEach((visitor) => {
        const tr = document.createElement("tr");
        addCell(tr, visitor.full_name);
        addCell(tr, visitor.id_number);
        addCell(tr, visitor.phone);
        addCell(tr, visitor.purpose);
        addCell(tr, visitor.host_text || ("Host #" + (visitor.host_user_id || "—")));
        addCell(tr, visitor.badge_no || visitor.badge_number);
        addCell(tr, formatDate(visitor.entry_at || visitor.entry_time, true));

        const action = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Check out";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await api("/api/gate/" + encodeURIComponent(visitor.id || visitor.log_id) + "/check-out", {
              method: "POST"
            });
            showMessage($("pageMessage"), "Visitor checked out successfully.", "ok");
            await loadVisitors();
          } catch (error) {
            showMessage($("pageMessage"), error.message, "error");
            button.disabled = false;
          }
        });
        action.appendChild(button);
        tr.appendChild(action);
        rows.appendChild(tr);
      });
      showMessage($("listMessage"), "");
    } catch (error) {
      $("visitorCount").textContent = "Visitor list unavailable";
      rows.appendChild(emptyRow(8, "Could not load visitors."));
      showMessage($("listMessage"), error.message, "error");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = $("checkInButton");
    setLoading(button, true, "Register and check in", "Registering…");
    showMessage($("formMessage"), "Registering visitor…");
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.host_user_id = Number(payload.host_user_id);
    try {
      const visitor = await api("/api/gate/check-in", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      form.reset();
      showMessage(
        $("formMessage"),
        "Visitor checked in. Badge number: " + (visitor.badge_no || visitor.badge_number || "issued"),
        "ok"
      );
      await loadVisitors();
    } catch (error) {
      showMessage($("formMessage"), error.message, "error");
    } finally {
      setLoading(button, false, "Register and check in");
    }
  });

  $("refreshVisitors").addEventListener("click", loadVisitors);
  Promise.all([loadHosts(), loadVisitors()]).catch((error) => {
    showMessage($("pageMessage"), error.message, "error");
  });
}
