const loginForm = document.getElementById("login");
const usernameInput = document.getElementById("u");
const passwordInput = document.getElementById("p");
const messageBox = document.getElementById("msg");
const submitButton = document.getElementById("submitBtn");
const togglePassword = document.getElementById("togglePassword");
const year = document.getElementById("year");

if (year) year.textContent = String(new Date().getFullYear());

if (window.CSRS?.getToken()) {
  window.location.replace(window.CSRS.homePath());
}

if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", () => {
    const show = passwordInput.type === "password";
    passwordInput.type = show ? "text" : "password";
    togglePassword.textContent = show ? "Hide" : "Show";
    togglePassword.setAttribute("aria-pressed", String(show));
    togglePassword.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    showMessage("Enter your username and password.", "err");
    return;
  }

  setLoading(true);
  showMessage("");

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(
        data.error || "Sign-in failed. Check your credentials and try again.",
        "err"
      );
      return;
    }

    if (!data.token || !data.user) {
      showMessage("The server returned an invalid login response.", "err");
      return;
    }

    window.CSRS.setSession(data.token, data.user);
    showMessage("Sign-in successful. Opening your workspace...", "success");
    window.location.assign(window.CSRS.homePath(data.user.role));
  } catch (error) {
    console.error("Login request failed:", error);
    showMessage(
      "Unable to connect to the server. Check that CSRS is running.",
      "err"
    );
  } finally {
    setLoading(false);
  }
});

function showMessage(message, type = "") {
  messageBox.textContent = message;
  messageBox.className = type;
}

function setLoading(loading) {
  submitButton.disabled = loading;
  submitButton.setAttribute("aria-busy", String(loading));
  const label = submitButton.querySelector(".btn-label");
  if (label) {
    label.textContent = loading ? "Signing in..." : "Sign in";
  }
}
