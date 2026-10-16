const { requireAuth, getUser, roleOf, postLoginPath, apiUrl, setSession } = window.CSRS;

if (requireAuth()) {
  const form = document.getElementById("passwordForm");
  const message = document.getElementById("message");
  const button = document.getElementById("savePassword");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (newPassword !== confirmPassword) {
      message.textContent = "The new passwords do not match.";
      message.className = "form-message error";
      return;
    }

    button.disabled = true;
    message.textContent = "Updating password...";
    message.className = "form-message";

    try {
      const response = await fetch(apiUrl("/api/auth/change-password"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${window.CSRS.getToken()}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Password update failed.");
      }

      const user = getUser();
      setSession(window.CSRS.getToken(), { ...user, mustChangePassword: false });
      message.textContent = "Password updated successfully.";
      message.className = "form-message success";
      window.setTimeout(() => {
        window.location.assign(postLoginPath(roleOf(user)));
      }, 500);
    } catch (error) {
      message.textContent = error.message;
      message.className = "form-message error";
    } finally {
      button.disabled = false;
    }
  });
}
