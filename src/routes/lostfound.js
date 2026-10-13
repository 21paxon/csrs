const router = require('express').Router();
const { q } = require('../db');
const { auth, requireRole } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { notifyUsers } = require('../lib/notify');

const STAFF = ['admin', 'head_security', 'security_officer'];

// Anyone logged in can report lost items and search registered FOUND items.
router.post('/', auth, async (req, res) => {
  const b = req.body || {};
  const kind = b.kind === 'found' ? 'found' : 'lost';
  if (kind === 'found' && !STAFF.includes(req.user.role))
    return res.status(403).json({ error: 'Found items are registered by the security office. Please hand the item in at the security office.' });
  if (!b.title) return res.status(400).json({ error: 'Give the item a short title (e.g. "Black HP laptop").' });
  const { rows } = await q(
    `INSERT INTO items(kind,title,description,category,location_text,event_date,reported_by,contact_phone)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [kind, b.title, b.description || null, b.category || null, b.location_text || null, b.event_date || null, req.user.id, b.contact_phone || req.user.phone || null]);
  await audit(req, 'ITEM_REGISTERED', 'item', rows[0].id, { kind });
  res.status(201).json(rows[0]);
});

router.get('/', auth, async (req, res) => {
  const { kind, status, search } = req.query;
  const where = []; const p = [];
  const add = (sql, v) => { p.push(v); where.push(sql.replace('?', '$' + p.length)); };
  if (!STAFF.includes(req.user.role)) {
    // Regular users: found items (to find their stuff) + their own lost reports
    p.push(req.user.id); where.push(`(kind='found' OR reported_by=$${p.length})`);
    where.push("status <> 'collected'");
  }
  if (kind) add('kind = ?', kind);
  if (status) add('status = ?', status);
  if (search) { p.push('%' + search + '%'); const n = '$' + p.length; where.push(`(title ILIKE ${n} OR description ILIKE ${n} OR category ILIKE ${n})`); }
  const sql = `SELECT id,kind,title,description,category,location_text,event_date,status,matched_item_id,created_at,
                      reported_by ${STAFF.includes(req.user.role) ? ',contact_phone,collected_by_name,collected_at' : ''}
                 FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`;
  res.json((await q(sql, p)).rows);
});

// Match a lost item with a found item
router.post('/:id(\\d+)/match', auth, requireRole(...STAFF), async (req, res) => {
  const { found_id } = req.body || {};
  const { rows } = await q('SELECT * FROM items WHERE id=ANY($1)', [[Number(req.params.id), Number(found_id)]]);
  const lost = rows.find((r) => r.kind === 'lost'); const found = rows.find((r) => r.kind === 'found');
  if (!lost || !found) return res.status(400).json({ error: 'Pick one lost item and one found item to match.' });
  await q("UPDATE items SET status='matched', matched_item_id=$2 WHERE id=$1", [lost.id, found.id]);
  await q("UPDATE items SET status='matched', matched_item_id=$2 WHERE id=$1", [found.id, lost.id]);
  await audit(req, 'ITEM_MATCHED', 'item', lost.id, { found_id: found.id });
  await notifyUsers([lost.reported_by], 'Possible match for your lost item', `"${found.title}" may be yours. Visit the security office with ID.`, 'lostfound', '#/lostfound');
  res.json({ ok: true });
});

// Record collection and owner verification
router.post('/:id(\\d+)/collect', auth, requireRole(...STAFF), async (req, res) => {
  const { name, id_no } = req.body || {};
  if (!name || !id_no) return res.status(400).json({ error: 'Enter the owner\'s name and ID number to verify collection.' });
  const { rows } = await q('SELECT * FROM items WHERE id=$1', [req.params.id]);
  const it = rows[0];
  if (!it) return res.status(404).json({ error: 'Item not found.' });
  const ids = [it.id, it.matched_item_id].filter(Boolean);
  await q("UPDATE items SET status='collected', collected_by_name=$2, collected_id_no=$3, collected_at=now() WHERE id=ANY($1)", [ids, name, id_no]);
  await audit(req, 'ITEM_COLLECTED', 'item', it.id, { name });
  res.json({ ok: true });
});

module.exports = router;
