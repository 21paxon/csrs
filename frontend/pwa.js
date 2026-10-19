(() => {
  const canInstallWorker = 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || location.hostname === 'localhost');
  const languageKey = 'csrs_language';
  let currentStrings = {};
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'csrsLanguageToggle';
  button.style.cssText = 'border:1px solid #d9e2ef;border-radius:8px;padding:.55rem .8rem;background:#fff;color:#123b70;font:600 13px system-ui;cursor:pointer';
  button.setAttribute('aria-label', 'Change language');
  document.body.appendChild(button);

  const pushButton = document.createElement('button');
  pushButton.type = 'button';
  pushButton.id = 'csrsPushToggle';
  pushButton.textContent = 'Enable push alerts';
  pushButton.setAttribute('aria-label', 'Enable web push alerts');
  pushButton.style.cssText = button.style.cssText;
  const controls = document.createElement('div');
  controls.className = 'csrs-header-controls';
  controls.style.cssText = 'display:flex;align-items:center;gap:.5rem;flex-wrap:wrap';
  controls.appendChild(button);
  if (sessionStorage.getItem('csrs_token')) controls.appendChild(pushButton);
  const pushStatus = document.createElement('span');
  pushStatus.id = 'csrsPushStatus';
  pushStatus.setAttribute('role', 'status');
  pushStatus.setAttribute('aria-live', 'polite');
  pushStatus.style.cssText = 'display:none;grid-column:1/-1;max-width:340px;color:#8f1d18;font:500 12px/1.4 system-ui';
  controls.appendChild(pushStatus);
  const dashboardHeader = document.querySelector('.topbar-right');
  const siteNavigation = document.querySelector('.header-container .nav-links');
  const dashboardTopbar = document.querySelector('.topbar');
  if (dashboardHeader) dashboardHeader.prepend(controls);
  else if (siteNavigation) siteNavigation.appendChild(controls);
  else if (dashboardTopbar) dashboardTopbar.appendChild(controls);
  else {
    controls.style.cssText += ';position:fixed;left:1rem;bottom:1rem;z-index:9999;padding:.35rem;background:#f4f7fb;border-radius:10px;box-shadow:0 2px 12px #0003';
    document.body.appendChild(controls);
  }

  const updatePushLabel = (key, fallback) => {
    if (pushButton.isConnected) pushButton.textContent = currentStrings[key] || fallback;
  };

  function base64UrlBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }

  async function responseJson(response) {
    return response.json().catch(() => ({}));
  }

  function showPushStatus(message, isError = true) {
    pushStatus.textContent = message;
    pushStatus.style.display = message ? 'block' : 'none';
    pushStatus.style.color = isError ? '#8f1d18' : '#17603c';
  }

  pushButton.addEventListener('click', async () => {
    try {
      if (!canInstallWorker || !('PushManager' in window) || !('Notification' in window)) throw new Error('Web push requires a supported browser and a secure HTTPS connection.');
      const token = sessionStorage.getItem('csrs_token');
      if (!token) throw new Error('Your session has expired. Sign in again, then enable push alerts.');
      const base = String(window.CSRS_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');
      const keyResponse = await fetch(`${base}/api/notifications/push-public-key`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const keyData = await responseJson(keyResponse);
      const publicKey = keyData.public_key;
      if (!keyResponse.ok) throw new Error(keyData.error || keyData.message || `Could not check push settings (HTTP ${keyResponse.status}).`);
      if (pushButton.dataset.state === 'enabled') {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const removed = await fetch(`${base}/api/notifications/push-subscriptions`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: subscription.endpoint })
          });
          if (!removed.ok) throw new Error('Could not remove your push subscription from the server.');
          await subscription.unsubscribe();
        }
        pushButton.dataset.state = '';
        pushButton.disabled = false;
        updatePushLabel('push_enable', 'Enable push alerts');
        showPushStatus('Push alerts are turned off.', false);
        return;
      }
      if (!publicKey) throw new Error('Push alerts are not configured: set VAPID_PUBLIC_KEY on the backend.');
      if (!keyData.delivery_configured) throw new Error('Push delivery is not configured. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the backend (or configure PUSH_API_URL and PUSH_API_KEY).');
      if (Notification.permission === 'denied') throw new Error('Notifications are blocked in browser settings. Allow notifications for this site, then retry.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notification permission was not granted.');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlBytes(publicKey)
        });
      }
      const saved = await fetch(`${base}/api/notifications/push-subscriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      });
      if (!saved.ok) {
        const savedData = await responseJson(saved);
        throw new Error(savedData.error || savedData.message || `The push subscription could not be saved (HTTP ${saved.status}).`);
      }
      updatePushLabel('push_disable', 'Turn off push alerts');
      pushButton.dataset.state = 'enabled';
      pushButton.disabled = false;
      showPushStatus('Push alerts are enabled on this device.', false);
    } catch (error) {
      pushButton.dataset.state = 'error';
      pushButton.dataset.error = error.message || 'Push alerts could not be enabled';
      updatePushLabel('push_unavailable', 'Push alerts could not be enabled');
      pushButton.title = pushButton.dataset.error;
      showPushStatus(pushButton.dataset.error);
    }
  });

  async function setLanguage(language) {
    const safeLanguage = language === 'rw' ? 'rw' : 'en';
    const response = await fetch(`/i18n/${safeLanguage}.json`);
    if (!response.ok) return;
    const strings = await response.json();
    currentStrings = strings;
    window.CSRS_TRANSLATIONS = strings;
    document.documentElement.lang = safeLanguage;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      const value = strings[element.dataset.i18n];
      if (!value) return;
      if (element.matches('.nav-link')) {
        const labelNode = Array.from(element.childNodes).find((node) =>
          node.nodeType === Node.TEXT_NODE && node.textContent.trim()
        );
        if (labelNode) labelNode.textContent = ` ${value}`;
      } else {
        element.textContent = value;
      }
    });
    document.querySelectorAll('[data-i18n-text]').forEach((element) => {
      const value = strings[element.dataset.i18nText];
      if (value) element.textContent = value;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
      const value = strings[element.dataset.i18nPlaceholder];
      if (value) element.setAttribute('placeholder', value);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      const value = strings[element.dataset.i18nAriaLabel];
      if (value) element.setAttribute('aria-label', value);
    });
    button.textContent = strings.language_switch;
    pushButton.setAttribute('aria-label', strings.push_aria_label || 'Enable web push alerts');
    if (pushButton.dataset.state === 'enabled') updatePushLabel('push_disable', 'Turn off push alerts');
    else if (pushButton.dataset.state === 'error') updatePushLabel('push_unavailable', 'Push alerts could not be enabled');
    else updatePushLabel('push_enable', 'Enable push alerts');
    localStorage.setItem(languageKey, safeLanguage);
    window.dispatchEvent(new CustomEvent('csrs:language-changed', { detail: { language: safeLanguage } }));
  }

  button.addEventListener('click', () => {
    const next = localStorage.getItem(languageKey) === 'rw' ? 'en' : 'rw';
    setLanguage(next).catch(() => {});
  });
  setLanguage(localStorage.getItem(languageKey) || 'en').catch(() => {});
  window.addEventListener('load', () => {
    if (!canInstallWorker) return;
    navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' }).then((registration) => {
      registration.update().catch(() => {});
    }).catch((error) => {
      console.warn('CSRS offline support could not start:', error.message);
    });
  });
})();
