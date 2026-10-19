const resetForm = document.getElementById('resetPasswordForm');
resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  const message = document.getElementById('resetMessage');
  const button = document.getElementById('saveNewPassword');
  if (password !== confirm) {
    message.textContent = 'The new passwords do not match.';
    return;
  }
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ||
    new URLSearchParams(location.search).get('token');
  if (!token) {
    message.textContent = 'The reset link is invalid or has expired. Request a new link.';
    return;
  }
  button.disabled = true;
  message.textContent = 'Updating password…';
  try {
    const result = await window.CSRS.api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password })
    });
    message.textContent = result.message;
    resetForm.hidden = true;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
