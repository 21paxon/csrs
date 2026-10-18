const C = window.CSRS;
const { $, requireAuth, getUser, canSecurityOps, api, mountShell, formatDate,
  showMessage, addCell, statusCell, emptyRow } = C;

// When this page is shown inside the student dashboard it must not add its own
// sidebar and header. The "embedded" class lets the stylesheet trim padding.
const embedded = window.self !== window.top;

if (requireAuth()) {
  if (embedded) {
    document.documentElement.classList.add("embedded");
    reportHeight();
  } else {
    mountShell({ current: "lost-found" });
  }

  startLostFound();
}

// Tells the dashboard how tall this page is, so its frame fits the content
// instead of showing a second scrollbar.
function reportHeight() {
  const main = document.querySelector(".app-main") || document.body;

  const send = () => {
    const height = main.offsetTop + main.offsetHeight + 24;

    try {
      window.parent.postMessage(
        { type: "csrs:frame-height", height },
        window.location.origin
      );
    } catch {
      // Not critical.
    }
  };

  if ("ResizeObserver" in window) new ResizeObserver(send).observe(main);

  window.addEventListener("load", send);
  send();
}

function startLostFound() {
  const user = getUser() || {};

  if (canSecurityOps(user.role)) {
    $("foundFormWrap")?.classList.remove("hidden");
  }

  // Lost and found dates cannot be in the future.
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  document.querySelectorAll('input[type="date"]').forEach((input) => {
    input.max = today;
  });

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  // Accepts a plain array or a wrapped response such as { data: [...] }.
  function toList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }

  const text = (value) =>
    value === undefined || value === null || value === "" ? "—" : value;

  // Tells the dashboard around this page that its numbers may have changed.
  function announceUpdate() {
    if (!embedded) return;

    try {
      window.parent.postMessage(
        { type: "csrs:lost-found-updated" },
        window.location.origin
      );
    } catch {
      // Not critical.
    }
  }

  // --------------------------------------------------
  // Rendering
  // --------------------------------------------------

  function renderLost(items) {
    const body = $("lostRows");
    if (!body) return;

    body.replaceChildren();

    if (!items.length) {
      body.appendChild(emptyRow(5, "No lost-item reports found."));
      return;
    }

    items.forEach((item) => {
      const tr = document.createElement("tr");

      addCell(tr, text(item.item_name));
      addCell(tr, text(item.category));
      addCell(tr, text(item.location_lost));
      addCell(tr, formatDate(item.date_lost));
      tr.appendChild(statusCell(item.status));

      body.appendChild(tr);
    });
  }

  function renderFound(items) {
    const body = $("foundRows");
    if (!body) return;

    body.replaceChildren();

    if (!items.length) {
      body.appendChild(emptyRow(5, "No open found items are listed."));
      return;
    }

    items.forEach((item) => {
      const tr = document.createElement("tr");

      addCell(tr, text(item.item_name));
      addCell(tr, text(item.category));
      addCell(tr, text(item.location_found));
      addCell(tr, formatDate(item.date_found));
      addCell(tr, text(item.description));

      body.appendChild(tr);
    });
  }

  // --------------------------------------------------
  // Loading
  // --------------------------------------------------

  let refreshId = 0;

  // Loads both lists. One failing does not stop the other from showing, and an
  // older, slower response can never overwrite a newer one.
  async function refresh() {
    const id = ++refreshId;

    const [lost, found] = await Promise.allSettled([
      api("/api/lost-found/lost"),
      api("/api/lost-found/found")
    ]);

    if (id !== refreshId) return;

    const errors = [];

    if (lost.status === "fulfilled") {
      renderLost(toList(lost.value));
    } else {
      errors.push(`Lost items: ${lost.reason?.message || "could not be loaded."}`);
    }

    if (found.status === "fulfilled") {
      renderFound(toList(found.value));
    } else {
      errors.push(`Found items: ${found.reason?.message || "could not be loaded."}`);
    }

    if (errors.length) {
      showMessage($("pageMessage"), errors.join(" "), "error");
    } else {
      showMessage($("pageMessage"), "");
    }
  }

  // --------------------------------------------------
  // Forms
  // --------------------------------------------------

  async function submitMultipart(url, form, button, messageId, success) {
    if (button.disabled) return;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    button.disabled = true;
    showMessage($(messageId), "Submitting…");

    let saved = false;

    try {
      await api(url, { method: "POST", body: new FormData(form) });
      saved = true;
      form.reset();
      showMessage($(messageId), success, "ok");
    } catch (error) {
      showMessage($(messageId), error.message, "error");
    } finally {
      button.disabled = false;
    }

    // Reloading is separate, so a list problem is never reported as a failed save.
    if (saved) {
      announceUpdate();
      await refresh();
    }
  }

  $("lostForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMultipart(
      "/api/lost-found/lost",
      event.currentTarget,
      $("lostSubmit"),
      "lostMessage",
      "Lost-item report submitted."
    );
  });

  $("foundForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitMultipart(
      "/api/lost-found/found",
      event.currentTarget,
      $("foundSubmit"),
      "foundMessage",
      "Found item registered."
    );
  });

  $("matchForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const lost_id = Number(form.elements.lost_id.value);
    const found_id = Number(form.elements.found_id.value);

    if (!Number.isInteger(lost_id) || lost_id < 1 ||
        !Number.isInteger(found_id) || found_id < 1) {
      showMessage($("matchMessage"), "Enter a valid lost item ID and found item ID.", "error");
      return;
    }

    if (button) {
      if (button.disabled) return;
      button.disabled = true;
    }

    showMessage($("matchMessage"), "Matching…");

    let saved = false;

    try {
      await api("/api/lost-found/match", {
        method: "POST",
        body: JSON.stringify({ lost_id, found_id })
      });
      saved = true;
      form.reset();
      showMessage($("matchMessage"), "Items matched successfully.", "ok");
    } catch (error) {
      showMessage($("matchMessage"), error.message, "error");
    } finally {
      if (button) button.disabled = false;
    }

    if (saved) {
      announceUpdate();
      await refresh();
    }
  });

  // --------------------------------------------------
  // Tabs (click, plus Left/Right/Home/End keys)
  // --------------------------------------------------

  const tabs = [...document.querySelectorAll("[data-tab]")];

  function selectTab(button, moveFocus = false) {
    const tab = button.dataset.tab;

    tabs.forEach((item) => {
      const selected = item === button;

      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });

    $("lostPanel")?.classList.toggle("hidden", tab !== "lost");
    $("foundPanel")?.classList.toggle("hidden", tab !== "found");

    if (moveFocus) button.focus();
  }

  tabs.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(button));

    button.addEventListener("keydown", (event) => {
      let target = null;

      if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") target = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") target = tabs[0];
      if (event.key === "End") target = tabs[tabs.length - 1];

      if (target) {
        event.preventDefault();
        selectTab(target, true);
      }
    });
  });

  const activeTab = tabs.find((item) => item.classList.contains("active")) || tabs[0];
  if (activeTab) selectTab(activeTab);

  refresh();
}