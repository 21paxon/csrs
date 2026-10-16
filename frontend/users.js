const C = window.CSRS;
const { $, requireAuth, roleOf, api, mountShell, showMessage, statusCell, homePath } = C;

if (!requireAuth()) {
  /* redirected */
} else if (roleOf() !== "admin") {
  window.location.replace(homePath());
} else {
  mountShell({ current: "dashboard" });
  loadUsers();
  $("refreshUsers").addEventListener("click", loadUsers);
  $("createUserForm").addEventListener("submit", createUser);
}

async function loadUsers() {
  showMessage($("listMessage"), "Loading users...");
  try {
    const users = await api("/api/users");
    const body = $("usersBody");
    body.replaceChildren();
    if (!users.length) {
      body.appendChild(emptyRow("No user accounts found."));
    } else {
      users.forEach((user) => body.appendChild(userRow(user)));
    }
    showMessage($("listMessage"), `${users.length} user account(s) loaded.`, "ok");
  } catch (error) {
    showMessage($("listMessage"), error.message, "error");
  }
}

async function createUser(event) {
  event.preventDefault();
  const password = $("password").value;
  if (password !== $("confirmPassword").value) {
    showMessage($("formMessage"), "The passwords do not match.", "error");
    return;
  }

  const button = $("createUserButton");
  button.disabled = true;
  showMessage($("formMessage"), "Creating user...");
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        fullName: $("fullName").value.trim(),
        username: $("username").value.trim(),
        email: $("email").value.trim().toLowerCase(),
        registrationNumber: $("registrationNumber").value.trim() || undefined,
        phone: $("phone").value.trim() || undefined,
        role: $("role").value,
        password
      })
    });
    $("createUserForm").reset();
    showMessage($("formMessage"), "User account created successfully.", "ok");
    await loadUsers();
  } catch (error) {
    showMessage($("formMessage"), error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function userRow(user) {
  const row = document.createElement("tr");
  addCell(row, user.full_name || "—");
  addCell(row, user.username || "—");
  addCell(row, user.email || "—");
  addCell(row, C.roleLabel(user.role));
  row.appendChild(statusCell(user.is_active ? "Active" : "Pending approval"));

  const actions = document.createElement("td");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = user.is_active ? "danger" : "success";
  toggle.textContent = user.is_active ? "Deactivate" : "Approve account";
  toggle.addEventListener("click", () => updateUser(user, !user.is_active));
  actions.appendChild(toggle);

  if (user.id !== Number(C.getUser()?.id)) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ghost";
    reset.textContent = "Reset password";
    reset.addEventListener("click", () => resetPassword(user));
    actions.appendChild(reset);
  }
  row.appendChild(actions);
  return row;
}

async function updateUser(user, isActive) {
  if (!window.confirm(`${isActive ? "Activate" : "Deactivate"} ${user.username}?`)) return;
  try {
    await api(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive })
    });
    await loadUsers();
  } catch (error) {
    showMessage($("listMessage"), error.message, "error");
  }
}

async function resetPassword(user) {
  if (!window.confirm(`Reset the password for ${user.username}?`)) return;
  try {
    const result = await api(`/api/users/${user.id}/reset-password`, { method: "POST" });
    window.alert(`Temporary password for ${user.username}:\n\n${result.temporary_password}\n\nDeliver it securely and require the user to change it.`);
    await loadUsers();
  } catch (error) {
    showMessage($("listMessage"), error.message, "error");
  }
}

function addCell(row, value) {
  const cell = document.createElement("td");
  cell.textContent = value == null ? "" : String(value);
  row.appendChild(cell);
}

function emptyRow(message) {
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 6;
  cell.className = "empty";
  cell.textContent = message;
  row.appendChild(cell);
  return row;
}
