
const loginForm = document.getElementById("login");
const usernameInput = document.getElementById("u");
const passwordInput = document.getElementById("p");
const messageBox = document.getElementById("msg");
const submitButton = document.getElementById("submitBtn");

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
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(
        data.error ||
          "Sign-in failed. Check your credentials and try again.",
        "err"
      );
      return;
    }

    if (!data.token || !data.user) {
      showMessage(
        "The server returned an invalid login response.",
        "err"
      );
      return;
    }

    // Store authentication details for API requests.
    sessionStorage.setItem("csrs_token", data.token);
    sessionStorage.setItem(
      "csrs_user",
      JSON.stringify(data.user)
    );

    showMessage(
      "Sign-in successful. Opening your dashboard...",
      "success"
    );

    // Redirect according to the account's role.
    const role = String(data.user.role || "").toLowerCase();

    if (role === "student") {
      window.location.assign("/student-dashboard.html");
    } else {
      window.location.assign("/dashboard.html");
    }
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

  submitButton.textContent = loading
    ? "Signing in..."
    : "Sign in";
}