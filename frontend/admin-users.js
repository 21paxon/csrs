// Purpose: Browser-side behavior for the admin users workflow.

(() => {
  "use strict";

  const config = window.CSRS_CONFIG || {};
  const routes = config.routes || {};
  const apiBase = (config.apiBaseUrl || "").replace(/\/$/, "");

  const tokenKeys = ["csrs_token"];
  const getToken = () => {
    for (const key of tokenKeys) {
      const token =
        sessionStorage.getItem(key) || localStorage.getItem(key);
      if (token) return token;
    }
    return null;
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  function showMessage(message, error = false) {
    let box = $("#adminActionMessage");

    if (!box) {
      box = document.createElement("div");
      box.id = "adminActionMessage";
      box.setAttribute("role", "status");
      box.style.cssText =
        "padding:12px;margin:12px 0;border-radius:6px;";
      ($("#adminUsersPanel") || $("main") || document.body)
        .prepend(box);
    }

    box.textContent = message;
    box.style.background = error ? "#fee2e2" : "#dcfce7";
    box.style.color = error ? "#991b1b" : "#166534";
  }

  async function api(path, options = {}) {
    if (!path) throw new Error("The API route is missing in config.js.");

    const token = getToken();
    if (!token) throw new Error("Please sign in again.");

    const response = await fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: options.body
        ? JSON.stringify(options.body)
        : undefined
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  }

  function makeCell(value) {
    const td = document.createElement("td");
    td.textContent = value == null || value === ""
      ? "—"
      : String(value);
    return td;
  }

  function makeButton(label, action, userId) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.userId = String(userId);
    button.style.cssText = "margin:3px;padding:6px 10px;cursor:pointer;";
    return button;
  }

  function route(template, id) {
    if (!template) throw new Error("This action's route is not configured.");
    return template.replace(":id", encodeURIComponent(String(id)));
  }

  async function loadStats() {
    if (!routes.userStats) return;

    const data = await api(routes.userStats);
    const stats = data.stats || data;

    const mappings = {
      usersTotalCount: stats.total,
      usersActiveCount: stats.active,
      usersPendingCount: stats.pending,
      usersInactiveCount: stats.inactive,
      pendingUsersBadge: stats.pending
    };

    for (const [id, value] of Object.entries(mappings)) {
      const element = document.getElementById(id);
      if (element && value != null) element.textContent = String(value);
    }
  }

  async function loadUsers() {
    const table = $("#usersTable");
    if (!table) {
      showMessage("User table not found. Add id=\"usersTable\" to your table.", true);
      return;
    }

    const tbody = $("tbody", table);
    if (!tbody) {
      showMessage("The users table needs a tbody element.", true);
      return;
    }

    const filter = $("#userStatusFilter");
    const status = filter?.value || "all";

    tbody.replaceChildren();
    const loadingRow = document.createElement("tr");
    const loadingCell = makeCell("Loading users...");
    loadingCell.colSpan = 7;
    loadingRow.appendChild(loadingCell);
    tbody.appendChild(loadingRow);

    try {
      const data = await api(
        `${routes.users}?status=${encodeURIComponent(status)}`
      );

      const users = Array.isArray(data.users) ? data.users : [];
      tbody.replaceChildren();

      if (users.length === 0) {
        const row = document.createElement("tr");
        const cell = makeCell("No users found.");
        cell.colSpan = 7;
        row.appendChild(cell);
        tbody.appendChild(row);
      }

      for (const user of users) {
        const row = document.createElement("tr");

        row.append(
          makeCell(user.full_name),
          makeCell(user.username),
          makeCell(user.email),
          makeCell(user.reg_no),
          makeCell(user.role),
          makeCell(user.is_active ? "Active" : "Inactive / Pending")
        );

        const actions = document.createElement("td");

        if (user.is_active) {
          actions.appendChild(
            makeButton("Deactivate", "deactivate", user.id)
          );
        } else {
          actions.append(
            makeButton("Approve", "approve", user.id),
            makeButton("Reject", "reject", user.id)
          );
          actions.lastChild.style.background = "#fee2e2";
        }

        row.appendChild(actions);
        tbody.appendChild(row);
      }

      await loadStats();
    } catch (error) {
      tbody.replaceChildren();
      const row = document.createElement("tr");
      const cell = makeCell(error.message);
      cell.colSpan = 7;
      row.appendChild(cell);
      tbody.appendChild(row);
      showMessage(error.message, true);
    }
  }

  async function performAction(action, id, button) {
    const settings = {
      approve: {
        label: "Approve this user?",
        method: "POST",
        endpoint: routes.approveUser
      },
      reject: {
        label: "Permanently delete this pending user?",
        method: "DELETE",
        endpoint: routes.rejectUser
      },
      activate: {
        label: "Activate this user?",
        method: "POST",
        endpoint: routes.activateUser
      },
      deactivate: {
        label: "Deactivate this user?",
        method: "POST",
        endpoint: routes.deactivateUser
      }
    };

    const selected = settings[action];
    if (!selected) return;

    if (!window.confirm(selected.label)) return;

    button.disabled = true;

    try {
      await api(route(selected.endpoint, id), {
        method: selected.method
      });

      showMessage("User action completed successfully.");
      await loadUsers();
    } catch (error) {
      showMessage(error.message, true);
      button.disabled = false;
    }
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    performAction(
      button.dataset.action,
      button.dataset.userId,
      button
    );
  });

  document.addEventListener("DOMContentLoaded", () => {
    $("#userStatusFilter")?.addEventListener("change", loadUsers);
    $("#refreshUsers")?.addEventListener("click", loadUsers);

    if ($("#usersTable")) loadUsers();
  });

  window.CSRSAdminUsers = {
    loadUsers,
    loadStats
  };
})();
