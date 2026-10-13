/* CSRS frontend: dependency-free SPA (hash routing). All user content goes through esc(). */
'use strict';

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const STAFF = ['admin', 'head_security', 'security_officer'];
const state = { token: store.get('csrs_token'), user: null, meta: null, es: null, unread: 0, lang: store.get('csrs_lang') || 'en' };

// ---------- i18n (English / Kinyarwanda). Have a native speaker review the rw strings. ----------
const I18N = {
  en: {},
  rw: {
    'Report an incident': 'Tanga raporo y\'ikibazo', 'Report anonymously': 'Tanga raporo utivuze', 'Track my report': 'Kurikirana raporo yanjye',
    'Log in': 'Injira', 'Log out': 'Sohoka', 'Home': 'Ahabanza', 'Dashboard': 'Imbonerahamwe', 'Incidents': 'Ibibazo', 'My reports': 'Raporo zanjye',
    'Lost & Found': 'Ibyatakaye & Ibyabonetse', 'Announcements': 'Amatangazo', 'Gate': 'Irembo', 'Patrol': 'Irondo', 'Reports': 'Raporo', 'Users': 'Abakoresha',
    'Emergency': 'Ibyihutirwa', 'Submit report': 'Ohereza raporo', 'Category': 'Ubwoko', 'Location': 'Aho byabereye', 'Description': 'Ibisobanuro',
    'Password': 'Ijambobanga', 'Register': 'Iyandikishe', 'Status': 'Imiterere', 'Search': 'Shakisha', 'Save': 'Bika', 'Cancel': 'Bireke',
  },
};
const t = (s) => (I18N[state.lang] && I18N[state.lang][s]) || s;

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let body = opts.body;
  if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body }); }
  catch { throw new Error('Cannot reach the server. Check your connection and try again.'); }
  if (opts.raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !opts.noAuthRedirect) { logout(true); throw new Error(data.error || 'Please log in again.'); }
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong. Please try again.'); e.status = res.status; e.data = data; throw e; }
  return data;
}

function toast(msg, cls = '', link) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = msg;
  el.onclick = () => { if (link) location.hash = link; el.remove(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), cls === 'emergency' ? 20000 : 6000);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((d) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + d); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.18);
    });
  } catch { /* audio blocked */ }
}

// ---------- auth / session ----------
function setSession(token, user) { state.token = token; state.user = user; store.set('csrs_token', token); connectStream(); }
function logout(expired) {
  state.token = null; state.user = null; store.del('csrs_token');
  if (state.es) { state.es.close(); state.es = null; }
  renderChrome();
  location.hash = '#/login' + (expired ? '?expired=1' : '');
}

function connectStream() {
  if (state.es || !state.token) return;
  const es = new EventSource('/api/stream?token=' + encodeURIComponent(state.token));
  state.es = es;
  es.addEventListener('notification', (e) => {
    const n = JSON.parse(e.data); state.unread++; renderChrome();
    toast(n.title + (n.body ? ' — ' + n.body : ''), n.type === 'emergency' ? 'emergency' : '', n.link);
  });
  es.addEventListener('emergency', (e) => {
    const a = JSON.parse(e.data);
    beep(); toast(`🚨 EMERGENCY: ${a.full_name} ${a.phone || ''}`, 'emergency', '#/alerts');
    if (location.hash.startsWith('#/alerts')) route();
  });
  es.addEventListener('alert-update', () => { if (location.hash.startsWith('#/alerts')) route(); });
  es.onerror = () => { /* browser auto-reconnects; token expiry surfaces on next API call */ };
}

// ---------- chrome (top bar, SOS) ----------
function navItems() {
  const r = state.user && state.user.role;
  if (!r) return [];
  const n = [['#/', 'Home']];
  if (['admin', 'head_security', 'management'].includes(r)) n.push(['#/dashboard', 'Dashboard']);
  if (['admin', 'head_security', 'security_officer', 'management', 'dean'].includes(r)) n.push(['#/incidents', 'Incidents']);
  else n.push(['#/incidents', 'My reports']);
  if (['admin', 'head_security', 'security_officer', 'management'].includes(r)) n.push(['#/alerts', 'Emergency']);
  n.push(['#/lostfound', 'Lost & Found']);
  if (STAFF.includes(r) || ['management', 'dean'].includes(r)) n.push(['#/gate', 'Gate']);
  if (STAFF.includes(r)) n.push(['#/patrol', 'Patrol']);
  if (['admin', 'head_security', 'management', 'dean'].includes(r)) n.push(['#/reports', 'Reports']);
  n.push(['#/announcements', 'Announcements']);
  if (r === 'admin') n.push(['#/users', 'Users']);
  return n;
}

function renderChrome() {
  const cur = location.hash || '#/';
  const nav = navItems().map(([h, l]) => `<a href="${h}" class="${cur === h || (h !== '#/' && cur.startsWith(h)) ? 'active' : ''}">${esc(t(l))}</a>`).join('');
  $('#topbar').innerHTML = `
    <a class="brand" href="#/">🛡 CSRS · RP Musanze</a>
    <nav>${nav}</nav>
    <select id="lang" aria-label="Language" style="width:auto;padding:.2rem">${['en', 'rw'].map((l) => `<option value="${l}" ${state.lang === l ? 'selected' : ''}>${l === 'en' ? 'English' : 'Kinyarwanda'}</option>`).join('')}</select>
    ${state.user ? `<button id="bell" title="Notifications">🔔${state.unread ? `<span class="badge">${state.unread}</span>` : ''}</button>
      <button id="out">${esc(t('Log out'))} (${esc(state.user.full_name.split(' ')[0])})</button>` : `<a class="btn sm ghost" href="#/login" style="background:#fff">${esc(t('Log in'))}</a>`}`;
  $('#lang').onchange = (e) => { state.lang = e.target.value; store.set('csrs_lang', state.lang); renderChrome(); route(); };
  if (state.user) {
    $('#out').onclick = () => logout();
    $('#bell').onclick = showNotifications;
  }
  $('#sos').classList.toggle('hidden', !state.user);
}

async function showNotifications() {
  const d = await api('/notifications');
  await api('/notifications/read', { method: 'POST' }); state.unread = 0; renderChrome();
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div><h2 style="margin-top:0">Notifications</h2>${d.items.length ? d.items.slice(0, 15).map((n) => `<p><b>${esc(n.title)}</b><br><span class="muted">${esc(n.body || '')} · ${fmt(n.created_at)}</span></p>`).join('') : '<p class="muted">Nothing yet.</p>'}<button class="btn" id="x">Close</button></div>`;
  document.body.appendChild(m); m.onclick = (e) => { if (e.target === m || e.target.id === 'x') m.remove(); };
}

// ---------- SOS ----------
$('#sos').addEventListener('click', async () => {
  const m = document.createElement('div'); m.className = 'modal';
  m.innerHTML = `<div><h2 style="margin-top:0;color:var(--red)">Send emergency alert?</h2>
    <p>Security will be told who you are and where you are right now. Alerts are logged; please use only for real emergencies.</p>
    <label>What is happening? (optional)</label><input id="smsg" maxlength="300" placeholder="e.g. Fire in Block A">
    <div class="row" style="margin-top:1rem"><button class="btn red" id="go">SEND ALERT NOW</button><button class="btn ghost" id="no">Cancel</button></div>
    <div id="sres"></div><p class="muted">Call security directly if you can. Police 112 · Ambulance 912 · Fire 111</p></div>`;
  document.body.appendChild(m);
  $('#no', m).onclick = () => m.remove();
  $('#go', m).onclick = async (ev) => {
    ev.target.disabled = true;
    const pos = await new Promise((r) => {
      if (!navigator.geolocation) return r(null);
      navigator.geolocation.getCurrentPosition((p) => r(p.coords), () => r(null), { timeout: 4000, maximumAge: 10000 });
    });
    try {
      const r = await api('/alerts', { method: 'POST', body: { lat: pos && pos.latitude, lng: pos && pos.longitude, message: $('#smsg', m).value } });
      $('#sres', m).innerHTML = `<div class="ok">${esc(r.message)}${pos ? '' : ' (Location unavailable; tell the officer where you are.)'}</div>`;
      $('#go', m).remove();
    } catch (e) { $('#sres', m).innerHTML = `<div class="err">${esc(e.message)} Call the security office directly.</div>`; ev.target.disabled = false; }
  };
});

// ---------- tiny UI helpers ----------
const pill = (v, extra = '') => (v ? `<span class="pill ${esc(String(v).replace(/ /g, ''))} ${extra}">${esc(v)}</span>` : '');
const err = (m) => `<div class="err" role="alert">${esc(m)}</div>`;
const optionList = (arr, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : '') + arr.map((o) => `<option value="${esc(o.id)}" ${String(o.id) === String(sel) ? 'selected' : ''}>${esc(o.name || o.full_name)}</option>`).join('');
const bars = (rows, labelKey = 'label') => {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return rows.length ? rows.map((r) => `<div class="bar"><span title="${esc(r[labelKey])}">${esc(r[labelKey])}</span><i style="width:${Math.round((r.n / max) * 100)}%"></i><b>${r.n}</b></div>`).join('') : '<p class="muted">No data yet.</p>';
};
function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); const box = form.querySelector('.msg') || form.appendChild(Object.assign(document.createElement('div'), { className: 'msg' }));
    box.innerHTML = ''; if (btn) btn.disabled = true;
    try { await handler(new FormData(form), box, form); } catch (ex) { box.innerHTML = err(ex.message); }
    if (btn) btn.disabled = false;
  });
}
async function download(path, filename) {
  const res = await api(path, { raw: true });
  if (!res.ok) { toast('Download failed'); return; }
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function openFile(id) {
  const res = await api('/incidents/evidence/' + id, { raw: true });
  if (!res.ok) return toast('Could not open file');
  window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
}

// ---------- pages ----------
const pages = {};
const $app = () => $('#app');
const set = (html) => { $app().innerHTML = html; };

pages.home = async () => {
  const u = state.user;
  if (!u) {
    set(`<div class="hero"><h1>Campus Security and Reporting System</h1><p>Rwanda Polytechnic · Musanze College. Report incidents, get help fast, and follow up on your report.</p></div>
      <div class="actions">
        <a class="tile red" href="#/report-anon">${esc(t('Report anonymously'))}</a>
        <a class="tile light" href="#/track">${esc(t('Track my report'))}</a>
        <a class="tile" href="#/login">${esc(t('Log in'))} / ${esc(t('Register'))}</a></div>
      <div class="card" style="margin-top:1rem"><b>Your identity stays protected.</b><p class="muted">Anonymous reports need no login and store no name, phone or device details. You get a reference number and secret code to check progress.</p></div>`);
    return;
  }
  const mine = await api('/incidents?mine=true&size=5');
  let extra = '';
  if (STAFF.includes(u.role)) {
    const [al, inc] = await Promise.all([api('/alerts?active=true'), api('/incidents?size=8')]);
    extra = `${al.length ? `<div class="err"><b>${al.length} active emergency alert(s)</b> — <a href="#/alerts">open</a></div>` : ''}
      <h2>${u.role === 'security_officer' ? 'Assigned to you' : 'Latest incidents'}</h2>${incTable(inc.items)}`;
  }
  set(`<h1>Welcome, ${esc(u.full_name)}</h1>
    <div class="actions"><a class="tile" href="#/report">${esc(t('Report an incident'))}</a>
      <a class="tile light" href="#/report?anon=1">${esc(t('Report anonymously'))}</a>
      <a class="tile light" href="#/lostfound">${esc(t('Lost & Found'))}</a></div>
    ${extra}<h2>${esc(t('My reports'))}</h2>${incTable(mine.items, 'You have not submitted any reports.')}`);
  bindRows();
};

function incTable(items, emptyMsg = 'No incidents found.') {
  if (!items.length) return `<div class="card muted">${esc(emptyMsg)}</div>`;
  return `<div class="card tablewrap"><table><thead><tr><th>Reference</th><th>Category</th><th>Location</th><th>Severity</th><th>Status</th><th>Reported</th></tr></thead><tbody>
    ${items.map((i) => `<tr class="click" data-href="#/incident/${i.id}"><td><b>${esc(i.reference_no)}</b></td><td>${esc(i.category)}</td><td>${esc(i.location)}</td><td>${pill(i.severity)}</td>
    <td>${pill(i.status)} ${i.overdue ? '<span class="pill overdue">OVERDUE</span>' : ''}</td><td>${fmt(i.reported_datetime)}</td></tr>`).join('')}</tbody></table></div>`;
}
function bindRows() { document.querySelectorAll('tr.click').forEach((r) => (r.onclick = () => (location.hash = r.dataset.href))); }

// Login / register
pages.login = async (q) => {
  set(`<div class="grid g2"><div class="card"><h1>${esc(t('Log in'))}</h1>${q.get('expired') ? err('Your session expired. Please log in again.') : ''}
    <form id="lf"><label>Email, registration number or username</label><input name="identifier" autocomplete="username" required>
    <label>${esc(t('Password'))}</label><input name="password" type="password" autocomplete="current-password" required>
    <p><button class="btn" type="submit">${esc(t('Log in'))}</button></p></form></div>
    <div class="card"><h1>${esc(t('Register'))}</h1><p class="muted">Students and staff. Security staff accounts are created by the administrator.</p>
    <form id="rf"><label>Full name</label><input name="full_name" required>
    <label>Registration number (students)</label><input name="reg_no"><label>Email</label><input name="email" type="email">
    <label>Phone</label><input name="phone" type="tel"><label>I am a</label><select name="role"><option value="student">Student</option><option value="staff">Staff / Lecturer</option></select>
    <label>${esc(t('Password'))} (8+ characters)</label><input name="password" type="password" minlength="8" autocomplete="new-password" required>
    <p><button class="btn green" type="submit">${esc(t('Register'))}</button></p></form></div></div>`);
  const done = (d) => { setSession(d.token, d.user); renderChrome(); location.hash = '#/'; };
  bindForm($('#lf'), async (f) => done(await api('/auth/login', { body: Object.fromEntries(f), noAuthRedirect: true })));
  bindForm($('#rf'), async (f) => done(await api('/auth/register', { body: Object.fromEntries(f), noAuthRedirect: true })));
};

// Report form (named + anonymous)
async function reportPage(q, forceAnon) {
  const anon = forceAnon || q.get('anon') === '1';
  if (!anon && !state.user) { location.hash = '#/login'; return; }
  const m = state.meta;
  set(`<h1>${anon ? esc(t('Report anonymously')) : esc(t('Report an incident'))}</h1>
    ${anon ? '<div class="card"><b>How anonymity works.</b><p class="muted">We do not ask for your name and do not store your name, phone or device in the report. You will get a reference number and a secret access code. Limits: if you describe details only you could know, people may guess who you are. Keep the code safe; it cannot be recovered.</p></div>' : ''}
    <form class="card" id="rep"><label>${esc(t('Category'))} *</label><select name="category_id" required>${optionList(m.categories, '', 'Select a category')}</select>
    <label>${esc(t('Location'))} *</label><select name="location_id">${optionList(m.locations, '', 'Select a campus location')}</select>
    <label>Or describe the place (if not listed)</label><input name="location_text" maxlength="200">
    <div id="map" class="hidden"></div><input type="hidden" name="lat"><input type="hidden" name="lng">
    <label>When did it happen? *</label><input type="datetime-local" name="incident_datetime" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}">
    <label>${esc(t('Description'))} * (what happened, who/what was involved)</label><textarea name="description" required minlength="10"></textarea>
    <label>Evidence (photo, video, audio, PDF — up to 5 files)</label><input type="file" name="evidence" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx">
    ${anon ? '<input type="hidden" name="is_anonymous" value="true">' : '<label class="chk"><input type="checkbox" name="is_anonymous" value="true"> Submit anonymously (I will get a code instead of an account link)</label><label class="chk"><input type="checkbox" name="hide_identity" value="true"> Hide my name from everyone except security staff</label>'}
    <p><button class="btn" type="submit">${esc(t('Submit report'))}</button></p></form>`);

  // optional map pin
  if (window.L) {
    const mapEl = $('#map'); mapEl.classList.remove('hidden');
    const map = L.map(mapEl).setView([-1.4996, 29.6346], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    let pin; map.on('click', (e) => { if (pin) pin.remove(); pin = L.marker(e.latlng).addTo(map); $('input[name=lat]').value = e.latlng.lat; $('input[name=lng]').value = e.latlng.lng; });
    $('#rep label:nth-of-type(3)').insertAdjacentHTML('afterend', '<div class="muted">Tap the map to pin the exact spot (optional).</div>');
  }

  bindForm($('#rep'), async (f, box, form) => {
    const out = new FormData();
    for (const [k, v] of f.entries()) if (k !== 'evidence' && v !== '') out.append(k, v);
    for (const file of form.querySelector('[name=evidence]').files) out.append('evidence', file);
    if (out.get('incident_datetime')) out.set('incident_datetime', new Date(out.get('incident_datetime')).toISOString());
    const r = await api('/incidents', { method: 'POST', body: out });
    box.innerHTML = `<div class="ok"><b>${esc(r.message)}</b><p>Reference number: <b>${esc(r.reference_no)}</b></p>
      ${r.access_code ? `<p>Your secret access code (shown only once — write it down):</p><p><span class="code">${esc(r.access_code)}</span></p><a class="btn ghost" href="#/track">Track this report</a>` : `<a class="btn" href="#/incident/${esc(r.id)}">View my report</a>`}</div>`;
    form.querySelector('button[type=submit]').remove();
  });
}
pages.report = (q) => reportPage(q, false);
pages['report-anon'] = (q) => reportPage(q, true);

// Anonymous tracking
pages.track = async () => {
  set(`<h1>${esc(t('Track my report'))}</h1><div class="card"><form id="tf"><label>Reference number (e.g. INC-2026-0001)</label><input name="reference_no" required>
    <label>Secret access code</label><input name="access_code" required autocomplete="off"><p><button class="btn" type="submit">Check status</button></p></form><div id="tres"></div></div>`);
  let creds = null;
  const show = (d) => {
    $('#tres').innerHTML = `<h2>${esc(d.reference_no)} ${pill(d.status)}</h2><ul class="timeline">${d.updates.map((u) => `<li><b>${esc(u.new_status || (u.from_reporter ? 'You wrote' : 'Security update'))}</b> <span class="muted">${fmt(u.created_at)}</span><br>${esc(u.note || '')}</li>`).join('')}</ul>
      <form id="rp"><label>Reply to security (they cannot see who you are)</label><textarea name="message" required></textarea><p><button class="btn green" type="submit">Send</button></p></form>`;
    bindForm($('#rp'), async (f, box, form) => { await api('/incidents/track/reply', { body: { ...creds, message: f.get('message') } }); box.innerHTML = '<div class="ok">Sent.</div>'; form.reset(); show(await api('/incidents/track', { body: creds })); });
  };
  bindForm($('#tf'), async (f) => { creds = Object.fromEntries(f); show(await api('/incidents/track', { body: creds })); });
};

// Incident list
pages.incidents = async (q) => {
  const staff = ['admin', 'head_security', 'security_officer', 'management', 'dean'].includes(state.user.role);
  const params = new URLSearchParams(q); const m = state.meta;
  const data = await api('/incidents?' + params);
  set(`<h1>${staff ? esc(t('Incidents')) : esc(t('My reports'))}</h1>
    ${staff ? `<form class="card row" id="flt"><input class="grow" name="ref" placeholder="Reference no." value="${esc(q.get('ref') || '')}">
      <select name="status"><option value="">Any status</option>${['Submitted', 'Verified', 'In Progress', 'Resolved', 'Closed'].map((s) => `<option ${q.get('status') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select name="severity"><option value="">Any severity</option>${['Critical', 'High', 'Medium', 'Low'].map((s) => `<option ${q.get('severity') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select name="category_id">${optionList(m.categories, q.get('category_id'), 'Any category')}</select>
      <select name="location_id">${optionList(m.locations, q.get('location_id'), 'Any location')}</select>
      <input type="date" name="from" value="${esc(q.get('from') || '')}" aria-label="From"><input type="date" name="to" value="${esc(q.get('to') || '')}" aria-label="To">
      <button class="btn" type="submit">${esc(t('Search'))}</button></form>` : ''}
    <p class="muted">${data.total} found</p>${incTable(data.items, 'No reports found.')}
    <div class="row">${data.page > 1 ? `<a class="btn ghost sm" href="#/incidents?${new URLSearchParams({ ...Object.fromEntries(q), page: data.page - 1 })}">‹ Prev</a>` : ''}${data.total > data.page * 25 ? `<a class="btn ghost sm" href="#/incidents?${new URLSearchParams({ ...Object.fromEntries(q), page: data.page + 1 })}">Next ›</a>` : ''}</div>`);
  bindRows();
  const f = $('#flt');
  if (f) f.onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(); new FormData(f).forEach((v, k) => v && p.set(k, v)); location.hash = '#/incidents?' + p; };
};

// Incident detail + actions
pages.incident = async (q, id) => {
  const i = await api('/incidents/' + id);
  const u = state.user; const head = ['head_security', 'admin'].includes(u.role); const officer = u.role === 'security_officer';
  const canWork = head || officer;
  let officers = [];
  if (head) officers = (await api('/admin/directory')).filter((d) => d.role === 'security_officer');
  const nextStatuses = { Verified: ['In Progress'], 'In Progress': ['Resolved'], Resolved: head ? ['Closed', 'In Progress'] : [], Submitted: [], Closed: [] }[i.status] || [];

  set(`<p><a href="#/incidents">‹ Back</a></p><h1>${esc(i.reference_no)} ${pill(i.severity)} ${pill(i.status)} ${i.referred_to_discipline ? '<span class="pill">Discipline</span>' : ''}</h1>
    <div class="grid g2"><div class="card"><h2 style="margin-top:0">Details</h2>
      <p><b>${esc(i.category)}</b> · ${esc(i.location || i.location_text || '')}</p><p>${esc(i.description).replace(/\n/g, '<br>')}</p>
      <p class="muted">Happened ${fmt(i.incident_datetime)} · Reported ${fmt(i.reported_datetime)}${i.due_at ? ` · Respond by ${fmt(i.due_at)}` : ''}</p>
      <p class="muted">Reporter: ${i.is_anonymous ? '<b>Anonymous</b>' : i.reporter ? esc(i.reporter.full_name) + (i.reporter.phone ? ' · ' + esc(i.reporter.phone) : '') : 'Hidden'}</p>
      <p class="muted">Officers: ${i.officers.length ? i.officers.map((o) => esc(o.name)).join(', ') : 'Not assigned yet'}</p>
      ${i.resolution_summary ? `<div class="ok"><b>Resolution:</b> ${esc(i.resolution_summary)}</div>` : ''}
      <h2>Evidence</h2>${i.evidence.length ? i.evidence.map((e) => `<div><a href="#" data-ev="${e.id}">📎 ${esc(e.original_name)}</a> <span class="muted">${Math.round(e.size_bytes / 1024)} KB</span></div>`).join('') : '<p class="muted">None attached.</p>'}
      ${canWork || i.reporter ? `<form id="evf" class="row" style="margin-top:.6rem"><input class="grow" type="file" name="evidence" multiple><button class="btn sm ghost" type="submit">Upload</button></form>` : ''}</div>
    <div class="card"><h2 style="margin-top:0">History</h2><ul class="timeline">${i.updates.map((x) => `<li class="${x.is_public ? '' : 'private'}"><b>${esc(x.new_status ? x.old_status ? `${x.old_status} → ${x.new_status}` : x.new_status : x.author || '')}</b> <span class="muted">${esc(x.author || '')} · ${fmt(x.created_at)}${x.is_public ? '' : ' · internal'}</span><br>${esc(x.note || '')}</li>`).join('')}</ul></div></div>
    ${canWork || u.role === 'dean' ? `<div class="card"><h2 style="margin-top:0">Actions</h2>
      ${head ? `<form id="clf" class="row"><select name="severity" required><option value="">Set severity…</option>${['Critical', 'High', 'Medium', 'Low'].map((s) => `<option ${i.severity === s ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn sm" type="submit">Verify &amp; classify</button></form>
      <form id="asf" class="row" style="margin-top:.6rem"><select name="officer" required>${optionList(officers, '', 'Assign to officer…')}</select><button class="btn sm" type="submit">Assign</button></form>
      <form id="esf" class="row" style="margin-top:.6rem"><select name="to"><option value="management">Escalate to management</option><option value="dean">Refer to Dean of Students</option><option value="external">Escalate to external authorities</option></select><input class="grow" name="note" placeholder="Reason"><button class="btn sm ghost" type="submit">Escalate</button></form>` : ''}
      ${canWork && nextStatuses.length ? `<form id="stf" style="margin-top:.8rem"><div class="row"><select name="status">${nextStatuses.map((s) => `<option>${s}</option>`).join('')}</select></div>
        <label>Resolution summary (required for Resolved / Closed)</label><textarea name="resolution_summary" style="min-height:70px"></textarea><button class="btn sm green" type="submit">Update status</button></form>` : ''}
      <form id="ntf" style="margin-top:.8rem"><label>Add note</label><textarea name="note" required style="min-height:70px"></textarea>
        ${u.role !== 'dean' ? '<label class="chk"><input type="checkbox" name="is_public" value="true"> Visible to the reporter (they will be notified)</label>' : ''}<button class="btn sm" type="submit">Add note</button></form></div>` : ''}`);

  document.querySelectorAll('[data-ev]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openFile(a.dataset.ev); }));
  const reload = () => route();
  const bind = (sel, fn) => { const f = $(sel); if (f) bindForm(f, async (fd, box, form) => { await fn(fd, form); reload(); }); };
  bind('#clf', (f) => api(`/incidents/${id}/classify`, { body: { severity: f.get('severity') } }));
  bind('#asf', (f) => api(`/incidents/${id}/assign`, { body: { officer_ids: [Number(f.get('officer'))] } }));
  bind('#esf', (f) => api(`/incidents/${id}/escalate`, { body: { to: f.get('to'), note: f.get('note') } }));
  bind('#stf', (f) => api(`/incidents/${id}/status`, { body: { status: f.get('status'), resolution_summary: f.get('resolution_summary') } }));
  bind('#ntf', (f) => api(`/incidents/${id}/notes`, { body: { note: f.get('note'), is_public: f.get('is_public') === 'true' } }));
  bind('#evf', (f, form) => { const o = new FormData(); for (const x of form.querySelector('input').files) o.append('evidence', x); return api(`/incidents/${id}/evidence`, { method: 'POST', body: o }); });
};

// Emergency alerts (security)
pages.alerts = async () => {
  const rows = await api('/alerts');
  const contacts = await api('/alerts/emergency-contacts');
  const canAct = ['head_security', 'security_officer'].includes(state.user.role);
  set(`<h1>Emergency alerts</h1><div class="card row">${contacts.map((c) => `<span><b>${esc(c.name)}</b> ${esc(c.phone)}</span>`).join(' · ')}</div>
    <div class="card tablewrap"><table><thead><tr><th>Who</th><th>Phone</th><th>Where</th><th>Status</th><th>Triggered</th><th>Ack.</th><th></th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td><b>${esc(a.full_name)}</b><br><span class="muted">${esc(a.reg_no || '')}</span></td><td>${esc(a.phone || '—')}</td>
      <td>${a.lat ? `<a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${esc(a.lat)}&mlon=${esc(a.lng)}#map=18/${esc(a.lat)}/${esc(a.lng)}">Map</a>` : 'Unknown'}<br>${esc(a.message || '')}</td>
      <td>${pill(a.status)}</td><td>${fmt(a.triggered_at)}</td><td>${esc(a.acknowledged_by_name || '')}</td>
      <td>${canAct && a.status !== 'Resolved' ? `<div class="row">${a.status === 'Triggered' ? `<button class="btn sm" data-a="${a.id}/acknowledge">Acknowledge</button>` : ''}${a.status === 'Acknowledged' ? `<button class="btn sm" data-a="${a.id}/arrived">Arrived</button>` : ''}<button class="btn sm green" data-a="${a.id}/resolve">Resolve</button></div>` : ''}</td></tr>`).join('') || '<tr><td colspan=7 class="muted">No alerts.</td></tr>'}</tbody></table></div>`);
  document.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api(`/alerts/${b.dataset.a}`, { method: 'POST' }); route(); } catch (e) { toast(e.message); b.disabled = false; } }));
};

// Lost & Found
pages.lostfound = async (q) => {
  const search = q.get('search') || '';
  const items = await api('/items?' + new URLSearchParams(search ? { search } : {}));
  const staff = STAFF.includes(state.user.role);
  const found = items.filter((x) => x.kind === 'found' && x.status === 'open');
  set(`<h1>${esc(t('Lost & Found'))}</h1><form class="card row" id="sf"><input class="grow" name="search" placeholder="Search items (e.g. black laptop, ID card)" value="${esc(search)}"><button class="btn" type="submit">${esc(t('Search'))}</button></form>
    <div class="grid g2"><form class="card" id="lf"><h2 style="margin-top:0">${staff ? 'Register an item' : 'Report a lost item'}</h2>
      ${staff ? '<label>Type</label><select name="kind"><option value="found">Found item (handed in)</option><option value="lost">Lost item (on behalf of someone)</option></select>' : ''}
      <label>Item *</label><input name="title" required placeholder="Black HP laptop"><label>Description</label><textarea name="description" style="min-height:70px"></textarea>
      <label>Where / when</label><input name="location_text" placeholder="Library, 2nd floor"><input type="date" name="event_date" style="margin-top:.4rem"><label>Contact phone</label><input name="contact_phone" type="tel">
      <p><button class="btn" type="submit">Save</button></p></form>
    <div class="card"><h2 style="margin-top:0">Found items awaiting owners</h2>${found.length ? found.map((x) => `<p><b>${esc(x.title)}</b> <span class="muted">${esc(x.location_text || '')} · ${fmt(x.created_at)}</span><br>${esc(x.description || '')}</p>`).join('') : '<p class="muted">Nothing registered yet.</p>'}
    <p class="muted">Think one is yours? Visit the security office with your ID.</p></div></div>
    <h2>${staff ? 'All items' : 'Your reports and matches'}</h2><div class="card tablewrap"><table><thead><tr><th>Type</th><th>Item</th><th>Status</th><th>Date</th>${staff ? '<th>Actions</th>' : ''}</tr></thead><tbody>
    ${items.map((x) => `<tr><td>${esc(x.kind)}</td><td><b>${esc(x.title)}</b><br><span class="muted">${esc(x.description || '')}</span></td><td>${pill(x.status)}</td><td>${fmt(x.created_at)}</td>
      ${staff ? `<td>${x.status === 'open' && x.kind === 'lost' ? `<button class="btn sm ghost" data-match="${x.id}">Match</button> ` : ''}${['open', 'matched'].includes(x.status) && x.kind === 'found' ? `<button class="btn sm green" data-collect="${x.id}">Collected</button>` : ''}</td>` : ''}</tr>`).join('') || '<tr><td colspan=5 class="muted">No items.</td></tr>'}</tbody></table></div>`);
  $('#sf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/lostfound' + (e.target.search.value ? '?search=' + encodeURIComponent(e.target.search.value) : ''); };
  bindForm($('#lf'), async (f, box, form) => { await api('/items', { body: Object.fromEntries([...f].filter(([, v]) => v)) }); route(); });
  document.querySelectorAll('[data-match]').forEach((b) => (b.onclick = async () => {
    const foundId = prompt('Enter the ID number of the FOUND item to match with this lost item:\n' + found.map((x) => `${x.id}: ${x.title}`).join('\n'));
    if (foundId) try { await api(`/items/${b.dataset.match}/match`, { body: { found_id: Number(foundId) } }); route(); } catch (e) { toast(e.message); }
  }));
  document.querySelectorAll('[data-collect]').forEach((b) => (b.onclick = async () => {
    const name = prompt('Owner full name:'); if (!name) return; const id_no = prompt('Owner ID number (verified):'); if (!id_no) return;
    try { await api(`/items/${b.dataset.collect}/collect`, { body: { name, id_no } }); route(); } catch (e) { toast(e.message); }
  }));
};

// Gate / visitors
pages.gate = async () => {
  const dir = STAFF.includes(state.user.role) ? await api('/admin/directory') : [];
  const rows = await api('/gate/visitors?on_campus=true');
  const log = await api('/gate/visitors?date=' + new Date().toISOString().slice(0, 10));
  const canReg = STAFF.includes(state.user.role);
  set(`<h1>Gate &amp; visitors</h1><div class="grid g4"><div class="card stat"><b>${rows.length}</b><span>On campus now</span></div><div class="card stat"><b>${log.length}</b><span>Entries today</span></div></div>
    ${canReg ? `<form class="card" id="vf"><h2 style="margin-top:0">Register visitor</h2><div class="grid g2"><div><label>Full name *</label><input name="full_name" required><label>ID number</label><input name="id_number"><label>Phone</label><input name="phone" type="tel"></div>
      <div><label>Purpose</label><input name="purpose"><label>Visiting (staff)</label><select name="host_user_id">${optionList(dir.filter((d) => d.role !== 'security_officer'), '', 'Select host (optional)')}</select><label>Badge no.</label><input name="badge_no"><label>Vehicle plate</label><input name="vehicle_plate"></div></div>
      <p><button class="btn" type="submit">Record entry</button></p></form>` : ''}
    <h2>Currently on campus</h2><div class="card tablewrap"><table><thead><tr><th>Name</th><th>ID</th><th>Purpose</th><th>Host</th><th>Badge</th><th>Entered</th><th></th></tr></thead><tbody>
    ${rows.map((v) => `<tr><td><b>${esc(v.full_name)}</b></td><td>${esc(v.id_number || '')}</td><td>${esc(v.purpose || '')}</td><td>${esc(v.host_name || '')}</td><td>${esc(v.badge_no || '')}</td><td>${fmt(v.entry_at)}</td><td>${canReg ? `<button class="btn sm" data-exit="${v.id}">Record exit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan=7 class="muted">Nobody.</td></tr>'}</tbody></table></div>
    ${['head_security', 'admin'].includes(state.user.role) ? '<h2>Restricted persons</h2><div id="bl" class="card"></div>' : ''}`);
  if (canReg) bindForm($('#vf'), async (f, box, form) => {
    try { await api('/gate/visitors', { body: Object.fromEntries([...f].filter(([, v]) => v)) }); route(); }
    catch (e) { box.innerHTML = err(e.message); if (e.data && e.data.blacklisted) toast('RESTRICTED PERSON AT GATE', 'emergency'); }
  });
  document.querySelectorAll('[data-exit]').forEach((b) => (b.onclick = async () => { try { await api(`/gate/visitors/${b.dataset.exit}/exit`, { method: 'POST' }); route(); } catch (e) { toast(e.message); } }));
  if ($('#bl')) {
    const bl = await api('/gate/blacklist');
    $('#bl').innerHTML = `${bl.map((b) => `<div class="row"><span class="grow"><b>${esc(b.full_name || '')}</b> ${esc(b.id_number)} — ${esc(b.reason || '')}</span><button class="btn sm ghost" data-rm="${b.id}">Remove</button></div>`).join('') || '<p class="muted">None.</p>'}
      <form id="blf" class="row"><input name="full_name" placeholder="Name"><input name="id_number" placeholder="ID number" required><input class="grow" name="reason" placeholder="Reason"><button class="btn sm" type="submit">Add</button></form>`;
    bindForm($('#blf'), async (f) => { await api('/gate/blacklist', { body: Object.fromEntries(f) }); route(); });
    document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await api('/gate/blacklist/' + b.dataset.rm, { method: 'DELETE' }); route(); }));
  }
};

// Patrol
pages.patrol = async () => {
  const head = ['head_security', 'admin'].includes(state.user.role);
  const [cps, routes, roster, logs, missed, dir] = await Promise.all([api('/patrol/checkpoints'), api('/patrol/routes'), api('/patrol/roster'), api('/patrol/logs'), api('/patrol/missed'), head ? api('/admin/directory') : []]);
  set(`<h1>Patrol &amp; shifts</h1>${missed.length ? `<div class="err"><b>Missed checkpoints</b><br>${missed.map((m) => `${esc(m.officer)} · ${esc(m.checkpoint)}`).join('<br>')}</div>` : ''}
    <form class="card row" id="ci"><select name="code" class="grow" required><option value="">Checkpoint scanned…</option>${cps.map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}</select><input name="notes" class="grow" placeholder="Notes (optional)"><button class="btn green" type="submit">Check in</button></form>
    <p class="muted">At a checkpoint, scan its QR code (it encodes the checkpoint code) or choose it above. Print codes from your checkpoint list.</p>
    <div class="grid g2"><div class="card"><h2 style="margin-top:0">Duty roster</h2>${roster.map((r) => `<p><b>${esc(r.officer)}</b> · ${esc(r.route || 'No route')}<br><span class="muted">${fmt(r.start_at)} – ${fmt(r.end_at)}</span></p>`).join('') || '<p class="muted">No shifts.</p>'}
      ${head ? `<form id="rf"><label>Officer</label><select name="officer_id" required>${optionList(dir.filter((d) => d.role === 'security_officer'), '', 'Choose officer')}</select><label>Route</label><select name="route_id">${optionList(routes, '', 'No route')}</select>
      <label>Start</label><input type="datetime-local" name="start_at" required><label>End</label><input type="datetime-local" name="end_at" required><p><button class="btn sm" type="submit">Add shift</button></p></form>` : ''}</div>
    <div class="card"><h2 style="margin-top:0">Recent check-ins</h2>${logs.slice(0, 15).map((l) => `<p><b>${esc(l.officer)}</b> @ ${esc(l.checkpoint)}<br><span class="muted">${fmt(l.scanned_at)}</span></p>`).join('') || '<p class="muted">None yet.</p>'}</div></div>`);
  bindForm($('#ci'), async (f, box, form) => { await api('/patrol/checkin', { body: Object.fromEntries(f) }); route(); });
  const rf = $('#rf');
  if (rf) bindForm(rf, async (f) => { const o = Object.fromEntries([...f].filter(([, v]) => v)); o.start_at = new Date(o.start_at).toISOString(); o.end_at = new Date(o.end_at).toISOString(); await api('/patrol/roster', { body: o }); route(); });
};

// Dashboard
pages.dashboard = async (q) => {
  const days = Number(q.get('days')) || 30;
  const d = await api('/dashboard?days=' + days);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  set(`<h1>Security dashboard</h1><div class="tabs">${[7, 30, 90, 365].map((n) => `<a href="#/dashboard?days=${n}" class="${n === days ? 'active' : ''}">${n === 365 ? '1 year' : n + ' days'}</a>`).join('')}</div>
    <div class="grid g4"><div class="card stat"><b>${d.counts.new_count}</b><span>New</span></div><div class="card stat"><b>${d.counts.open_count}</b><span>Open</span></div><div class="card stat"><b>${d.counts.closed_count}</b><span>Closed</span></div>
    <div class="card stat ${d.overdue ? 'warn' : ''}"><b>${d.overdue}</b><span>Overdue</span></div><div class="card stat ${d.active_alerts ? 'warn' : ''}"><b>${d.active_alerts}</b><span>Active alerts</span></div>
    <div class="card stat"><b>${d.timings.avg_response_min ?? '—'}</b><span>Avg response (min)</span></div><div class="card stat"><b>${d.timings.avg_resolution_hours ?? '—'}</b><span>Avg resolution (h)</span></div>
    <div class="card stat"><b>${d.officers_on_duty.length}</b><span>Officers on duty</span></div><div class="card stat"><b>${d.visitors_on_campus}</b><span>Visitors on campus</span></div></div>
    <div class="grid g2"><div class="card"><h2 style="margin-top:0">By category</h2>${bars(d.by_category)}</div><div class="card"><h2 style="margin-top:0">By severity</h2>${bars(d.by_severity)}</div>
    <div class="card"><h2 style="margin-top:0">Hotspots (locations)</h2>${bars(d.hotspots)}</div>
    <div class="card"><h2 style="margin-top:0">By hour of day</h2>${bars(d.by_hour.map((r) => ({ label: String(r.h).padStart(2, '0') + ':00', n: r.n })))}</div>
    <div class="card"><h2 style="margin-top:0">By weekday</h2>${bars(d.by_weekday.map((r) => ({ label: wd[r.d], n: r.n })))}</div><div class="card"><h2 style="margin-top:0">By month</h2>${bars(d.by_month.map((r) => ({ label: r.m, n: r.n })))}</div></div>
    <div class="card"><h2 style="margin-top:0">Incident hotspot map</h2><div id="map"></div></div>`);
  if (window.L) {
    const map = L.map('map').setView([-1.4996, 29.6346], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    d.hotspots.filter((h) => h.lat).forEach((h) => L.circleMarker([h.lat, h.lng], { radius: 8 + h.n * 3, color: '#c62828', fillOpacity: 0.35 }).addTo(map).bindPopup(`${esc(h.label)}: ${h.n} incident(s)`));
  } else $('#map').innerHTML = '<p class="muted">Map unavailable offline.</p>';
};

// Reports
pages.reports = async () => {
  const list = await api('/reports');
  const today = new Date().toISOString().slice(0, 10); const m = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  set(`<h1>Reports</h1><form class="card" id="rpf"><div class="row"><div><label>Report</label><select name="type">${list.map((r) => `<option value="${r}">${esc(r.replace(/_/g, ' '))}</option>`).join('')}</select></div>
    <div><label>From</label><input type="date" name="from" value="${m}"></div><div><label>To</label><input type="date" name="to" value="${today}"></div></div>
    <p class="row"><button class="btn" type="submit">Preview</button><button class="btn green" type="button" id="csv">Download CSV (Excel)</button></p></form><div id="rpres"></div>`);
  const params = () => { const f = new FormData($('#rpf')); return [f.get('type'), new URLSearchParams({ from: f.get('from'), to: f.get('to') })]; };
  $('#rpf').onsubmit = async (e) => {
    e.preventDefault(); const [type, p] = params();
    try {
      const d = await api(`/reports/${type}?${p}`); const cols = d.rows[0] ? Object.keys(d.rows[0]) : [];
      $('#rpres').innerHTML = `<div class="card tablewrap"><p class="muted">${d.rows.length} rows</p><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.slice(0, 200).map((r) => `<tr>${cols.map((c) => `<td>${esc(typeof r[c] === 'string' && /^\d{4}-\d\d-\d\dT/.test(r[c]) ? fmt(r[c]) : r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } catch (ex) { $('#rpres').innerHTML = err(ex.message); }
  };
  $('#csv').onclick = () => { const [type, p] = params(); p.set('format', 'csv'); download(`/reports/${type}?${p}`, `${type}.csv`); };
};

// Announcements
pages.announcements = async () => {
  const list = await api('/announcements'); const can = ['admin', 'head_security', 'management'].includes(state.user.role);
  set(`<h1>${esc(t('Announcements'))}</h1>${can ? `<form class="card" id="af"><label>Title</label><input name="title" required><label>Message</label><textarea name="body" required></textarea>
    <div class="row"><select name="audience"><option value="all">Everyone</option><option value="student">Students</option><option value="staff">Staff</option><option value="security_officer">Security officers</option></select>
    <label class="chk" style="margin:0"><input type="checkbox" name="sms" value="true"> Also send SMS</label><button class="btn" type="submit">Send</button></div></form>` : ''}
    ${list.map((a) => `<div class="card"><b>${esc(a.title)}</b> <span class="muted">${fmt(a.created_at)} · ${esc(a.author || '')}</span><p>${esc(a.body).replace(/\n/g, '<br>')}</p></div>`).join('') || '<div class="card muted">No announcements.</div>'}`);
  const f = $('#af'); if (f) bindForm(f, async (fd) => { await api('/announcements', { body: { title: fd.get('title'), body: fd.get('body'), audience: fd.get('audience'), sms: fd.get('sms') === 'true' } }); route(); });
};

// Admin: users + audit
pages.users = async (q) => {
  const users = await api('/admin/users?' + new URLSearchParams(q.get('search') ? { search: q.get('search') } : {}));
  const audit = await api('/admin/audit?limit=30');
  const roles = ['admin', 'head_security', 'security_officer', 'management', 'dean', 'staff', 'student'];
  set(`<h1>Users &amp; audit</h1><form class="card row" id="usf"><input class="grow" name="search" placeholder="Search name, email, reg no." value="${esc(q.get('search') || '')}"><button class="btn" type="submit">${esc(t('Search'))}</button></form>
    <form class="card" id="nuf"><h2 style="margin-top:0">Create user</h2><div class="row"><input name="full_name" placeholder="Full name" required><input name="email" type="email" placeholder="Email"><input name="reg_no" placeholder="Reg / staff no."><input name="phone" placeholder="Phone">
    <select name="role">${roles.map((r) => `<option>${r}</option>`).join('')}</select><button class="btn sm" type="submit">Create</button></div></form>
    <form class="card" id="imf"><h2 style="margin-top:0">Import from college records</h2><p class="muted">Paste CSV with header: full_name,reg_no,email,phone,role (role = student or staff)</p><textarea name="csv" style="min-height:80px"></textarea><button class="btn sm" type="submit">Import</button></form>
    <div class="card tablewrap"><table><thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td><b>${esc(u.full_name)}</b></td><td>${esc(u.email || u.reg_no || u.username)}</td>
    <td><select data-role="${u.id}">${roles.map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${u.is_active ? 'Yes' : 'No'}</td>
    <td><div class="row"><button class="btn sm ghost" data-toggle="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Deactivate' : 'Activate'}</button><button class="btn sm ghost" data-reset="${u.id}">Reset password</button></div></td></tr>`).join('')}</tbody></table></div>
    <h2>Audit log (latest)</h2><div class="card tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>IP</th><th>Result</th></tr></thead><tbody>${audit.map((a) => `<tr><td>${fmt(a.created_at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity || '')} ${esc(a.entity_id || '')}</td><td>${esc(a.ip || '')}</td><td>${esc(a.status)}</td></tr>`).join('')}</tbody></table></div>`);
  $('#usf').onsubmit = (e) => { e.preventDefault(); location.hash = '#/users' + (e.target.search.value ? '?search=' + encodeURIComponent(e.target.search.value) : ''); };
  bindForm($('#nuf'), async (f, box) => { const r = await api('/admin/users', { body: Object.fromEntries([...f].filter(([, v]) => v)) }); box.innerHTML = `<div class="ok">Created. Temporary password: <span class="code" style="font-size:1rem">${esc(r.temporary_password || '(as set)')}</span></div>`; });
  bindForm($('#imf'), async (f, box) => {
    const lines = f.get('csv').trim().split(/\r?\n/); const head = lines.shift().split(',').map((s) => s.trim());
    const list = lines.filter(Boolean).map((l) => { const c = l.split(','); return Object.fromEntries(head.map((h, i) => [h, (c[i] || '').trim()])); });
    const r = await api('/admin/users/import', { body: { users: list } });
    box.innerHTML = `<div class="ok">Created ${r.created}, skipped ${r.skipped}. Shared initial password: <span class="code" style="font-size:1rem">${esc(r.default_password || '')}</span> (tell users to change it).</div>`;
  });
  document.querySelectorAll('[data-role]').forEach((s) => (s.onchange = async () => { try { await api('/admin/users/' + s.dataset.role, { method: 'PATCH', body: { role: s.value } }); toast('Role updated'); } catch (e) { toast(e.message); route(); } }));
  document.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = async () => { try { await api('/admin/users/' + b.dataset.toggle, { method: 'PATCH', body: { is_active: b.dataset.active !== 'true' } }); route(); } catch (e) { toast(e.message); } }));
  document.querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => { if (!confirm('Reset this user\'s password?')) return; const r = await api(`/admin/users/${b.dataset.reset}/reset-password`, { method: 'POST' }); prompt('Temporary password (copy it now):', r.temporary_password); }));
};

// ---------- router ----------
const PUBLIC = ['home', 'login', 'report-anon', 'track'];
async function route() {
  const hash = location.hash.slice(1) || '/';
  const [pathPart, qs] = hash.split('?'); const q = new URLSearchParams(qs || '');
  const seg = pathPart.split('/').filter(Boolean);
  let name = seg[0] || 'home'; const arg = seg[1];
  if (!pages[name]) name = 'home';
  renderChrome();
  if (!PUBLIC.includes(name) && !state.user) { location.hash = '#/login'; return; }
  const staffOnly = { dashboard: ['admin', 'head_security', 'management'], alerts: ['admin', 'head_security', 'security_officer', 'management'], patrol: STAFF, users: ['admin'], reports: ['admin', 'head_security', 'management', 'dean'], gate: [...STAFF, 'management', 'dean'] };
  if (staffOnly[name] && !staffOnly[name].includes(state.user.role)) { set(err('You do not have permission to view this page.')); return; }
  set('<p class="muted">Loading…</p>');
  try { await pages[name](q, arg); window.scrollTo(0, 0); }
  catch (e) { set(err(e.message || 'Something went wrong.') + '<p><a href="#/">‹ Home</a></p>'); }
}
window.addEventListener('hashchange', route);

// ---------- boot ----------
(async function boot() {
  try { state.meta = await api('/meta'); } catch (e) { set(err(e.message)); return; }
  if (state.token) {
    try {
      state.user = (await api('/auth/me', { noAuthRedirect: true })).user;
      connectStream();
      api('/notifications').then((d) => { state.unread = d.unread; renderChrome(); }).catch(() => {});
    } catch { state.token = null; store.del('csrs_token'); }
  }
  route();
})();
