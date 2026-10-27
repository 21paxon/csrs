// End-to-end check of the whole API against a RUNNING server.
//   1. npm run db:init && npm run seed:admin && npm run dev      (in one terminal)
//   2. npm run smoke                                              (in another)
// Uses ADMIN_USERNAME / ADMIN_PASSWORD from .env. Creates test users with a random suffix, so it can be re-run.
require('dotenv').config();

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const sfx = Date.now().toString(36);
let passed = 0, failed = 0;

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}`, extra !== undefined ? JSON.stringify(extra) : ''); }
}

async function login(username, password) {
  const r = await call('POST', '/api/auth/login', { body: { username, password } });
  return r.data.token;
}

(async () => {
  console.log(`Smoke test against ${BASE}\n`);
  const health = await call('GET', '/api/health');
  check('server is up', health.status === 200, health);
  if (health.status !== 200) { console.log('\nStart the server first (npm run dev).'); process.exit(1); }

  console.log('\nAuth and users');
  const admin = await login(process.env.ADMIN_USERNAME || 'admin', process.env.ADMIN_PASSWORD);
  check('admin can log in', !!admin);
  if (!admin) { console.log('\nRun `npm run seed:admin` and check ADMIN_* in .env.'); process.exit(1); }
  check('bad password rejected', (await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password' } })).status === 401);

  const pw = 'TestPass#2026';
  const ids = {};
  const tokens = {};
  for (const [key, role] of [['head', 'Head of Security'], ['officer', 'Security Officer'], ['officer2', 'Security Officer'], ['student', 'Student'], ['staff', 'Staff']]) {
    const r = await call('POST', '/api/users', { token: admin, body: { username: `${key}_${sfx}`, email: `${key}_${sfx}@test.rw`, password: pw, role, fullName: `Test ${key}`, phone: '0780000000' } });
    check(`admin creates ${role}`, r.status === 201, r.data);
    ids[key] = r.data.id;
    tokens[key] = await login(`${key}_${sfx}`, pw);
  }
  check('student cannot list users', (await call('GET', '/api/users', { token: tokens.student })).status === 403);
  check('Head of Security cannot administer users', (await call('GET', '/api/users', { token: tokens.head })).status === 403);
  check('Head of Security cannot view database backups', (await call('GET', '/api/admin/backups/status', { token: tokens.head })).status === 403);

  console.log('\nIncidents');
  const cats = (await call('GET', '/api/categories')).data;
  const locs = (await call('POST', '/api/locations', { token: tokens.head, body: { name: `Library ${sfx}`, building: 'Main' } })).data;
  check('categories are seeded', Array.isArray(cats) && cats.length === 10);
  check('head creates location', !!locs.id, locs);
  const when = new Date().toISOString();

  const named = await call('POST', '/api/incidents', { token: tokens.student, body: { category_id: cats[0].id, location_id: locs.id, description: 'Laptop stolen', incident_datetime: when, severity: 'High' } });
  check('student reports a named incident', named.status === 201 && named.data.reference_no, named.data);

  const anon = await call('POST', '/api/incidents', { body: { category_id: cats[3].id, location_id: locs.id, description: 'Exit blocked', incident_datetime: when, severity: 'Critical' } });
  check('anonymous report works without login', anon.status === 201 && anon.data.access_code, anon.data);
  const track = await call('GET', `/api/incidents/track/${anon.data.reference_no}`, { headers: { 'x-access-code': anon.data.access_code } });
  check('anonymous reporter can track with the code', track.status === 200 && track.data.status === 'Submitted', track.data);
  check('wrong access code is refused', (await call('GET', `/api/incidents/track/${anon.data.reference_no}`, { headers: { 'x-access-code': 'WRONG' } })).status === 404);
  check('anonymous reply accepted', (await call('POST', `/api/incidents/track/${anon.data.reference_no}/reply`, { headers: { 'x-access-code': anon.data.access_code }, body: { message: 'It is the east door' } })).status === 201);

  check('student sees only own incidents', (await call('GET', '/api/incidents', { token: tokens.student })).data.every((i) => i.reporter_id === ids.student));
  check('head sees all incidents', (await call('GET', '/api/incidents', { token: tokens.head })).data.length >= 2);
  check('staff cannot open someone else\'s incident', (await call('GET', `/api/incidents/${named.data.id}`, { token: tokens.staff })).status === 403);
  check('officer cannot update unassigned incident', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.officer, body: { status: 'Verified' } })).status === 403);
  check('HoS cannot close an incident before it is resolved', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.head, body: { status: 'Closed', resolution_summary: 'Premature close' } })).status === 409);

  check('head assigns officer', (await call('POST', `/api/incidents/${named.data.id}/assign`, { token: tokens.head, body: { officer_id: ids.officer } })).status === 201);
  check('assigned officer sees assigned incident', (await call('GET', `/api/incidents?assigned_to=${ids.officer}`, { token: tokens.officer })).data.some((incident) => incident.id === named.data.id));
  check('head reassigns incident', (await call('POST', `/api/incidents/${named.data.id}/assign`, { token: tokens.head, body: { officer_id: ids.officer2 } })).status === 201);
  check('previously assigned officer loses access after reassignment', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.officer, body: { notes: 'Should no longer be allowed' } })).status === 403);
  check('newly assigned officer can add progress notes', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.officer2, body: { notes: 'Started the investigation.' } })).status === 200);
  check('resolution requires a summary', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.officer2, body: { status: 'Resolved', notes: 'Laptop recovered' } })).status === 400);
  check('assigned officer resolves with summary', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.officer2, body: { status: 'Resolved', notes: 'Laptop recovered', resolution_summary: 'Laptop recovered and returned to its owner.' } })).status === 200);
  check('HoS approves resolved incident closure', (await call('PATCH', `/api/incidents/${named.data.id}`, { token: tokens.head, body: { status: 'Closed' } })).status === 200);
  const detail = await call('GET', `/api/incidents/${named.data.id}`, { token: tokens.student });
  check('reporter sees closed status and history', detail.data.status === 'Closed' && detail.data.updates.length >= 3, detail.data.status);
  check('reporter was notified', (await call('GET', '/api/notifications?unread=true', { token: tokens.student })).data.unread >= 1);

  console.log('\nEmergency alerts');
  const alert = await call('POST', '/api/emergency', { token: tokens.student, body: { latitude: -1.4998, longitude: 29.6349 } });
  check('student triggers panic alert', alert.status === 201, alert.data);
  check('officer was notified', (await call('GET', '/api/notifications?unread=true', { token: tokens.officer })).data.notifications.some((n) => n.title === 'EMERGENCY ALERT'));
  check('officer acknowledges', (await call('PATCH', `/api/emergency/${alert.data.id}/acknowledge`, { token: tokens.officer })).status === 200);
  check('officer resolves', (await call('PATCH', `/api/emergency/${alert.data.id}/resolve`, { token: tokens.officer })).status === 200);
  check('student cannot list alerts', (await call('GET', '/api/emergency', { token: tokens.student })).status === 403);

  console.log('\nLost and found');
  const lost = await call('POST', '/api/lost-found/lost', { token: tokens.student, body: { item_name: `Blue backpack ${sfx}`, description: 'Has a laptop charger', location_lost: 'Library', date_lost: '2026-10-10' } });
  check('student reports lost item', lost.status === 201, lost.data);
  const found = await call('POST', '/api/lost-found/found', { token: tokens.officer, body: { item_name: `Blue backpack ${sfx}`, description: 'charger inside', location_found: 'Library', date_found: '2026-10-11' } });
  check('officer registers found item', found.status === 201, found.data);
  check('found items are searchable', (await call('GET', `/api/lost-found/found?q=backpack`, { token: tokens.student })).data.length >= 1);
  check('officer matches items', (await call('POST', '/api/lost-found/match', { token: tokens.officer, body: { lost_id: lost.data.id, found_id: found.data.id } })).status === 200);
  check('officer records collection', (await call('POST', `/api/lost-found/found/${found.data.id}/collect`, { token: tokens.officer, body: { user_id: ids.student } })).status === 200);

  console.log('\nVisitors and gate');
  const idn = `ID${sfx}`;
  const vis = await call('POST', '/api/gate/check-in', { token: tokens.officer, body: { full_name: 'Jean Test', id_number: idn, phone: '0781111111', purpose: 'Meeting', host_user_id: ids.staff, vehicle_number: 'RAB123C' } });
  check('officer checks a visitor in', vis.status === 201 && vis.data.badge_number, vis.data);
  check('host was notified', (await call('GET', '/api/notifications', { token: tokens.staff })).data.notifications.some((n) => n.title === 'Visitor arrived'));
  check('visitor shows as on campus', (await call('GET', '/api/gate/on-campus', { token: tokens.officer })).data.some((l) => l.id === vis.data.id));
  check('officer checks visitor out', (await call('POST', `/api/gate/${vis.data.id}/check-out`, { token: tokens.officer })).status === 200);
  check('head blacklists visitor', (await call('PATCH', `/api/gate/visitors/${vis.data.visitor_id}/blacklist`, { token: tokens.head, body: { blacklisted: true } })).status === 200);
  check('blacklisted visitor is refused', (await call('POST', '/api/gate/check-in', { token: tokens.officer, body: { full_name: 'Jean Test', id_number: idn, phone: '0781111111', purpose: 'Again', host_user_id: ids.staff } })).status === 403);

  console.log('\nPatrols and rosters');
  const route = await call('POST', '/api/patrol/routes', { token: tokens.head, body: { name: `Perimeter ${sfx}` } });
  const cp = await call('POST', `/api/patrol/routes/${route.data.id}/checkpoints`, { token: tokens.head, body: { name: 'Main gate post', location_id: locs.id } });
  check('head creates route and checkpoint', route.status === 201 && cp.status === 201, [route.data, cp.data]);
  check('officer scans checkpoint', (await call('POST', '/api/patrol/scan', { token: tokens.officer, body: { qr_code: cp.data.qr_code } })).status === 201);
  check('unknown QR rejected', (await call('POST', '/api/patrol/scan', { token: tokens.officer, body: { qr_code: 'nope' } })).status === 404);
  check('head views patrol performance', (await call('GET', '/api/patrol/performance', { token: tokens.head })).data.length >= 1);
  check('head creates roster', (await call('POST', '/api/patrol/rosters', { token: tokens.head, body: { officer_id: ids.officer, shift_date: '2026-10-20', shift_start_time: '06:00', shift_end_time: '14:00', shift_type: 'Morning' } })).status === 201);
  check('officer sees own roster', (await call('GET', '/api/patrol/rosters', { token: tokens.officer })).data.length >= 1);

  console.log('\nAnnouncements, dashboard, reports, audit');
  check('head sends announcement', (await call('POST', '/api/notifications/announcements', { token: tokens.head, body: { title: 'Drill', message: 'Fire drill at 10:00', roles: ['Student'] } })).status === 201);
  const dash = await call('GET', '/api/dashboard', { token: tokens.head });
  check('dashboard returns hotspots and totals', dash.status === 200 && Array.isArray(dash.data.hotspots) && dash.data.incidents.total >= 2, dash.data);
  check('student cannot open dashboard', (await call('GET', '/api/dashboard', { token: tokens.student })).status === 403);
  const csv = await call('GET', '/api/reports/incidents?format=csv', { token: tokens.head });
  check('incident report exports as CSV', csv.status === 200 && String(csv.data).startsWith('reference_no'), String(csv.data).slice(0, 80));
  const auditRes = await call('GET', '/api/audit-logs?action=ASSIGN', { token: admin });
  check('audit log recorded the assignment', auditRes.status === 200 && auditRes.data.length >= 1, auditRes.data);
  check('Head of Security can read audit logs', (await call('GET', '/api/audit-logs', { token: tokens.head })).status === 200);
  check('audit records cannot be changed through the API', (await call('POST', '/api/audit-logs', { token: tokens.head, body: { action: 'EDIT' } })).status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nSmoke test crashed:', e.message); process.exit(1); });
