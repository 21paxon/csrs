(() => {
  const canInstallWorker = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost');
  const languageKey = 'csrs_language';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'csrsLanguageToggle';
  button.style.cssText = 'position:fixed;left:1rem;bottom:1rem;z-index:9999;border:0;border-radius:999px;padding:.7rem 1rem;background:#fff;color:#123b70;box-shadow:0 2px 12px #0003;font:600 14px system-ui;cursor:pointer';
  button.setAttribute('aria-label', 'Change language');
  document.body.appendChild(button);

  const pushButton = document.createElement('button');
  pushButton.type = 'button';
  pushButton.id = 'csrsPushToggle';
  pushButton.textContent = 'Enable push alerts';
  pushButton.setAttribute('aria-label', 'Enable web push alerts');
  pushButton.style.cssText = button.style.cssText.replace('bottom:1rem', 'bottom:4rem');
  if (sessionStorage.getItem('csrs_token')) document.body.appendChild(pushButton);

  function base64UrlBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }

  pushButton.addEventListener('click', async () => {
    try {
      if (!canInstallWorker || !('PushManager' in window)) throw new Error('Web push is not available in this browser or connection.');
      const token = sessionStorage.getItem('csrs_token');
      const base = String(window.CSRS_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
      const keyResponse = await fetch(`${base}/api/notifications/push-public-key`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const { public_key: publicKey } = await keyResponse.json();
      if (!keyResponse.ok || !publicKey) throw new Error('Push notifications are not configured by the college.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlBytes(publicKey)
      });
      const saved = await fetch(`${base}/api/notifications/push-subscriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });
      if (!saved.ok) throw new Error('The push subscription could not be saved.');
      pushButton.textContent = 'Push alerts enabled';
      pushButton.disabled = true;
    } catch (error) {
      pushButton.textContent = error.message;
    }
  });

  async function setLanguage(language) {
    const safeLanguage = language === 'rw' ? 'rw' : 'en';
    const response = await fetch(`/i18n/${safeLanguage}.json`);
    if (!response.ok) return;
    const strings = await response.json();
    document.documentElement.lang = safeLanguage;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const value = strings[element.dataset.i18n];
      if (value) element.textContent = value;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const value = strings[element.dataset.i18nPlaceholder];
      if (value) element.setAttribute('placeholder', value);
    });
    button.textContent = strings.language_switch;
    localStorage.setItem(languageKey, safeLanguage);
  }

  button.addEventListener('click', () => {
    const next = localStorage.getItem(languageKey) === 'rw' ? 'en' : 'rw';
    setLanguage(next).catch(() => {});
  });
  setLanguage(localStorage.getItem(languageKey) || 'en').catch(() => {});
  window.addEventListener('load', () => {
    if (!canInstallWorker) return;
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('CSRS offline support could not start:', error.message);
    });
  });
})();
