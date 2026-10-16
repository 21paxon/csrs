const C = window.CSRS;
const { $, requireAuth, getUser, canSecurityOps, api, mountShell, formatDate,
  showMessage, addCell, statusCell, emptyRow } = C;

if (!requireAuth()) {
  /* redirected */
} else {
  mountShell({ current: "lost-found" });
  startLostFound();
}

function startLostFound() {
  const user = getUser() || {};
  if (canSecurityOps(user.role)) {
    $("foundFormWrap").classList.remove("hidden");
  }

  function renderLost(items) {
    const body = $("lostRows");
    body.replaceChildren();
    if (!items.length) {
      body.appendChild(emptyRow(5, "No lost-item reports found."));
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement("tr");
      addCell(tr, item.item_name);
      addCell(tr, item.category);
      addCell(tr, item.location_lost);
      addCell(tr, formatDate(item.date_lost));
      tr.appendChild(statusCell(item.status));
      body.appendChild(tr);
    });
  }

  function renderFound(items) {
    const body = $("foundRows");
    body.replaceChildren();
    if (!items.length) {
      body.appendChild(emptyRow(5, "No open found items are listed."));
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement("tr");
      addCell(tr, item.item_name);
      addCell(tr, item.category);
      addCell(tr, item.location_found);
      addCell(tr, formatDate(item.date_found));
      addCell(tr, item.description);
      body.appendChild(tr);
    });
  }

  async function loadLost() {
    const items = await api("/api/lost-found/lost");
    renderLost(items);
  }

  async function loadFound() {
    const items = await api("/api/lost-found/found");
    renderFound(items);
  }

  async function submitMultipart(url, form, button, messageId, success) {
    button.disabled = true;
    showMessage($(messageId), "Submitting…");
    try {
      await api(url, { method: "POST", body: new FormData(form) });
      form.reset();
      showMessage($(messageId), success, "ok");
      await Promise.all([loadLost(), loadFound()]);
    } catch (error) {
      showMessage($(messageId), error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  $("lostForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitMultipart("/api/lost-found/lost", event.currentTarget, $("lostSubmit"), "lostMessage", "Lost-item report submitted.");
  });

  $("foundForm").addEventListener("submit", (event) => {
    event.preventDefault();
    submitMultipart("/api/lost-found/found", event.currentTarget, $("foundSubmit"), "foundMessage", "Found item registered.");
  });

  $("matchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const lost_id = Number(form.elements.lost_id.value);
    const found_id = Number(form.elements.found_id.value);
    try {
      await api("/api/lost-found/match", {
        method: "POST",
        body: JSON.stringify({ lost_id, found_id })
      });
      form.reset();
      showMessage($("matchMessage"), "Items matched successfully.", "ok");
      await Promise.all([loadLost(), loadFound()]);
    } catch (error) {
      showMessage($("matchMessage"), error.message, "error");
    }
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((item) => {
        const selected = item === button;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-selected", String(selected));
      });
      $("lostPanel").classList.toggle("hidden", tab !== "lost");
      $("foundPanel").classList.toggle("hidden", tab !== "found");
    });
  });

  Promise.all([loadLost(), loadFound()]).catch((error) => {
    showMessage($("pageMessage"), error.message, "error");
  });
}
