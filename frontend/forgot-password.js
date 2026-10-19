const forgotForm = document.getElementById('forgotPasswordForm');
forgotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('sendResetLink');
  const message = document.getElementById('resetMessage');
  button.disabled = true;
  message.textContent = 'Sending request…';
  try {
    const result = await window.CSRS.api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ identifier: document.getElementById('identifier').value.trim() })
    });
    message.textContent = result.message;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
