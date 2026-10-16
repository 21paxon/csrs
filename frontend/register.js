

const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const registerForm = document.getElementById("registerForm");
const registerButton = document.getElementById("registerButton");
const messageBox = document.getElementById("message");

const accountTypeInput = document.getElementById("accountType");
const accountTypeHint = document.getElementById("accountTypeHint");
const fullNameInput = document.getElementById("fullName");
const registrationNumberInput = document.getElementById("registrationNumber");
const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const phoneInput = document.getElementById("phone");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");

accountTypeInput.addEventListener("change", updateAccountTypeHint);
updateAccountTypeHint();

function updateAccountTypeHint() {
  const isStudent = accountTypeInput.value === "student";
  accountTypeHint.textContent = isStudent
    ? "Student accounts can sign in after registration."
    : "This access request will remain inactive until an administrator approves it.";
}

// Password visibility controls.
document.querySelectorAll(".show-password").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    const showing = input.type === "text";

    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
    button.setAttribute("aria-pressed", String(!showing));
    button.setAttribute(
      "aria-label",
      showing ? "Show password" : "Hide password"
    );
  });
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage();

  const fullName = fullNameInput.value.trim();
  const accountType = accountTypeInput.value;
  const registrationNumber = registrationNumberInput.value.trim();
  const username = usernameInput.value.trim();
  const email = emailInput.value.trim().toLowerCase();
  const phone = phoneInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!fullName || !username || !email || !password || !confirmPassword) {
    showMessage("Please complete all required fields.", "error");
    return;
  }

  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    showMessage(
      "Username must be 3–50 characters and use only letters, numbers, dots, underscores or hyphens.",
      "error"
    );
    usernameInput.focus();
    return;
  }

  if (password.length < 12) {
    showMessage("Your password must contain at least 12 characters.", "error");
    passwordInput.focus();
    return;
  }

  if (password !== confirmPassword) {
    showMessage("The passwords do not match.", "error");
    confirmPasswordInput.focus();
    return;
  }

  setLoading(true);

  try {
    const response = await fetch(
      (window.CSRS?.apiUrl || ((path) => path))("/api/auth/register"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fullName,
          registrationNumber,
          username,
          email,
          phone,
          password,
          accountType
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      showMessage(
        data.error || "Registration failed. Please try again.",
        "error"
      );
      return;
    }

    registerForm.reset();

    showMessage(
      data.message || "Account created successfully. You can now sign in.",
      "success"
    );

    registerButton.textContent = "Account created";

    window.setTimeout(() => {
      window.location.assign("/home.html?signin=1");
    }, 1800);
  } catch (error) {
    console.error("Registration request failed:", error);

    showMessage(
      "Unable to connect to the server. Check that CSRS is running.",
      "error"
    );
  } finally {
    setLoading(false);
  }
});

function showMessage(message, type) {
  messageBox.textContent = message;
  messageBox.className = `message ${type}`;
}

function hideMessage() {
  messageBox.textContent = "";
  messageBox.className = "message";
}

function setLoading(loading) {
  registerButton.disabled = loading;
  registerButton.setAttribute("aria-busy", String(loading));

  if (loading) {
    registerButton.textContent = "Creating account...";
  } else {
    registerButton.textContent = "Submit registration";
  }
}
