(() => {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const languageKey = 'csrs_language';
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'csrsLanguageToggle';
  button.style.cssText = 'position:fixed;left:1rem;bottom:1rem;z-index:9999;border:0;border-radius:999px;padding:.7rem 1rem;background:#fff;color:#123b70;box-shadow:0 2px 12px #0003;font:600 14px system-ui;cursor:pointer';
  button.setAttribute('aria-label', 'Change language');
  document.body.appendChild(button);

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
    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('CSRS offline support could not start:', error.message);
    });
  });
})();
