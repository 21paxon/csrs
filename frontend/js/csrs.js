/* Shared CSRS frontend: session, roles, API, navigation. */
(() => {
  const TOKEN_KEY = "csrs_token";
  const USER_KEY = "csrs_user";

  const ROLES = {
    ADMIN: "admin",
    HEAD_OF_SECURITY: "head_security",
    SECURITY_OFFICER: "security_officer",
    MANAGEMENT: "management",
    DEAN: "dean",
    STAFF: "staff",
    STUDENT: "student"
  };

  const ROLE_LABELS = {
    admin: "Administrator",
    head_security: "Head of Security",
    security_officer: "Security Officer",
    management: "College Management",
    dean: "Dean of Students",
    staff: "Staff",
    student: "Student"
  };

  const ANALYTICS_ROLES = [
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.MANAGEMENT,
    ROLES.DEAN
  ];

  const SECURITY_ROLES = [
    ROLES.ADMIN,
    ROLES.HEAD_OF_SECURITY,
    ROLES.SECURITY_OFFICER
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function getUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user || {}));
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  }

  function roleOf(user) {
    return String((user || getUser() || {}).role || "").toLowerCase();
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || "User";
  }

  function canAnalytics(role) {
    return ANALYTICS_ROLES.includes(role || roleOf());
  }

  function canSecurityOps(role) {
    return SECURITY_ROLES.includes(role || roleOf());
  }

  function canGate(role) {
    return canSecurityOps(role);
  }

  function isPortalRole(role) {
    const value = role || roleOf();
    return value === ROLES.STUDENT || value === ROLES.STAFF;
  }

  function homePath(role) {
    const value = role || roleOf();
    if (!value) return "/home.html";
    return isPortalRole(value) ? "/student-dashboard.html" : "/dashboard.html";
  }

  function logout() {
    clearSession();
    window.location.replace("/home.html");
  }

  function currentPath() {
    return window.location.pathname + window.location.search + window.location.hash;
  }

  function apiUrl(path) {
    const base = String(window.CSRS_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");
    const normalizedPath = String(path || "").startsWith("/")
      ? String(path)
      : "/" + String(path);
    return base + normalizedPath;
  }

  function isSafeReturnPath(value) {
    return typeof value === "string" &&
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !value.startsWith("/index.html");
  }

  function postLoginPath(role) {
    const requested = new URLSearchParams(window.location.search).get("returnTo");
    return isSafeReturnPath(requested) ? requested : homePath(role);
  }

  function requireAuth() {
    if (!getToken()) {
      const returnTo = encodeURIComponent(currentPath());
      window.location.replace("/home.html?signin=1&returnTo=" + returnTo);
      return false;
    }
    return true;
  }

  async function api(url, options = {}) {
    const token = getToken();
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };

    if (token) headers.Authorization = "Bearer " + token;

    const body = options.body;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;

    if (body && !isForm && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    let response;
    try {
      response = await fetch(apiUrl(url), { ...options, headers, body });
    } catch (networkError) {
      throw new Error(
        "Cannot reach the server. It may be starting up — wait about 30 seconds and try again."
      );
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && token) {
      logout();
      throw new Error("Your session has expired. Please sign in again.");
    }

    if (!response.ok) {
      const message =
        data.error ||
        data.message ||
        (response.status >= 500
          ? "Server is starting or unavailable. Wait 30 seconds and try again."
          : "Request failed (HTTP " + response.status + ").");
      throw new Error(message);
    }

    return data;
  }

  function formatDate(value, withTime = false) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return withTime
      ? date.toLocaleString()
      : date.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric"
        });
  }

  function statusClass(value) {
    const status = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
    if (["closed", "resolved", "returned", "claimed", "available"].includes(status)) {
      return "ok";
    }
    if (["rejected", "critical", "triggered"].includes(status)) return "danger";
    if (
      [
        "pending",
        "pending-approval",
        "submitted",
        "verified",
        "in-progress",
        "escalated",
        "acknowledged",
        "arrived",
        "matched"
      ].includes(status)
    ) {
      return "warn";
    }
    return "";
  }

  function showMessage(element, text, type = "") {
    if (!element) return;
    element.textContent = text || "";
    element.className = "message" + (type ? " " + type : "");
  }

  function setLoading(button, loading, idleLabel, busyLabel) {
    if (!button) return;
    button.disabled = Boolean(loading);
    button.setAttribute("aria-busy", String(Boolean(loading)));
    if (idleLabel || busyLabel) {
      button.textContent = loading ? busyLabel || "Working…" : idleLabel;
    }
  }

  function emptyRow(colspan, text) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.className = "empty";
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }

  function addCell(row, value, className) {
    const td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = value == null || value === "" ? "—" : String(value);
    row.appendChild(td);
    return td;
  }

  function statusCell(value) {
    const td = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + statusClass(value);
    badge.textContent = value || "Unknown";
    td.appendChild(badge);
    return td;
  }

  function navItems(role, loggedIn) {
    if (!loggedIn) {
      return [
        { id: "home", href: "/home.html", label: "Home" },
        { id: "incidents", href: "/incidents.html", label: "Report incident" },
        { id: "emergency", href: "/emergency.html", label: "Emergency" },
        { id: "help", href: "/help.html", label: "Help guide" },
        { id: "signin", href: "/home.html?signin=1", label: "Sign in" },
        { id: "register", href: "/register.html", label: "Register" }
      ];
    }

    const items = [
      {
        id: "dashboard",
        href: homePath(role),
        label: isPortalRole(role) ? "My portal" : "Dashboard"
      },
      { id: "incidents", href: "/incidents.html", label: "Incidents" },
      { id: "emergency", href: "/emergency.html", label: "Emergency" },
      { id: "lost-found", href: "/lost-found.html", label: "Lost & Found" }
    ];

    if (canGate(role)) {
      items.push({ id: "gate", href: "/dashboard.html#visitors", label: "Visitors" });
    }

    items.push({ id: "help", href: "/help.html", label: "Help guide" });
    items.push({ id: "logout", href: "#logout", label: "Sign out" });
    return items;
  }

  function mountShell({ current } = {}) {
    const user = getUser();
    const token = getToken();
    const role = roleOf(user);
    const nav = $("appNav");

    if (nav) {
      nav.replaceChildren();
      navItems(role, Boolean(token)).forEach((item) => {
        const link = document.createElement("a");
        link.href = item.href;
        link.textContent = item.label;
        link.className = "app-nav-link";
        if (item.id === current) {
          link.classList.add("active");
          link.setAttribute("aria-current", "page");
        }
        if (item.id === "logout") {
          link.addEventListener("click", (event) => {
            event.preventDefault();
            logout();
          });
        }
        nav.appendChild(link);
      });
    }

    const who = $("appUser");
    if (who) {
      who.textContent = token && user
        ? (user.username || "User") + " · " + roleLabel(role)
        : "Guest";
    }

    const year = $("currentYear");
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function mountHelpDialog() {
    if (document.getElementById("csrsHelpDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "csrsHelpDialog";
    dialog.setAttribute("aria-labelledby", "csrsHelpTitle");
    dialog.style.cssText = "width:min(1000px,94vw);max-width:none;max-height:90vh;padding:0;border:0;border-radius:14px;box-shadow:0 20px 70px #071a3380;color:var(--text,#182b43)";
    dialog.innerHTML = '<div style="position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:14px 20px;background:#123b70;color:white"><h2 id="csrsHelpTitle" style="margin:0;font-size:1.2rem">CSRS Help Guide</h2><button type="button" aria-label="Close help guide" style="border:1px solid #ffffff80;border-radius:7px;background:transparent;color:white;padding:7px 12px;cursor:pointer">Close</button></div><div id="csrsHelpContent" style="padding:18px 22px;overflow:auto"></div>';
    document.body.appendChild(dialog);
    dialog.querySelector("button").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });

    let loaded = false;
    document.addEventListener("click", async (event) => {
      const link = event.target.closest('a[href]');
      if (!link) return;
      const url = new URL(link.href, window.location.href);
      if (url.pathname !== "/help.html" || url.origin !== window.location.origin) return;
      event.preventDefault();
      if (!loaded) {
        const response = await fetch("/help.html");
        if (!response.ok) {
          window.location.assign("/help.html");
          return;
        }
        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
        const content = dialog.querySelector("#csrsHelpContent");
        const styles = doc.querySelector("head style");
        if (styles) content.appendChild(styles.cloneNode(true));
        const main = doc.querySelector("main");
        if (main) content.append(...Array.from(main.childNodes, (node) => node.cloneNode(true)));
        loaded = true;
      }
      const role = roleOf(getUser());
      dialog.querySelectorAll("[data-help-role]").forEach((card) => {
        card.hidden = !card.dataset.helpRole.split(",").map((value) => value.trim()).includes(role);
      });
      const dashboardLink = dialog.querySelector("#helpDashboardLink");
      if (dashboardLink && getToken()) {
        dashboardLink.href = homePath(role);
        dashboardLink.hidden = false;
      }
      dialog.showModal();
    });
  }

  function getDeviceLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  /* Floating Emergency button (SRS: reachable from every main screen) */
  function mountEmergencyFab() {
    if (document.getElementById("csrsEmergencyFab")) return;

    const path = String(window.location.pathname || "");
    if (path.includes("emergency.html")) return;

    const link = document.createElement("a");
    link.id = "csrsEmergencyFab";
    link.className = "csrs-fab-emergency";
    link.href = "/emergency.html";
    link.setAttribute("aria-label", "Open emergency centre");
    link.innerHTML = '<span aria-hidden="true">!</span><span>Emergency</span>';
    document.body.appendChild(link);
  }

  window.CSRS = {
    ROLES,
    $,
    getToken,
    getUser,
    setSession,
    clearSession,
    roleOf,
    roleLabel,
    canAnalytics,
    canSecurityOps,
    canGate,
    isPortalRole,
    homePath,
    postLoginPath,
    logout,
    requireAuth,
    apiUrl,
    api,
    formatDate,
    statusClass,
    showMessage,
    setLoading,
    emptyRow,
    addCell,
    statusCell,
    navItems,
    mountShell,
    getDeviceLocation,
    mountEmergencyFab
  };

  document.addEventListener("DOMContentLoaded", () => {
    mountEmergencyFab();
    mountHelpDialog();
  });
})();
