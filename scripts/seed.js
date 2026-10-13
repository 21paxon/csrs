const bcrypt = require('bcryptjs');
const { pool, q } = require('../src/db');

const categories = [
  ['Theft', 'Stolen laptop, phone, or personal belongings'],
  ['Violence / Assault', 'Fighting, threats, bullying'],
  ['Harassment', 'Sexual harassment, intimidation, discrimination'],
  ['Fire / Safety Hazard', 'Fire outbreak, faulty electrical wiring, blocked exits'],
  ['Medical Emergency', 'Accident, sudden illness, injury'],
  ['Vandalism / Property Damage', 'Damaged equipment, broken windows'],
  ['Suspicious Activity', 'Unknown persons, unauthorized entry'],
  ['Drug / Alcohol Abuse', 'Possession or use of prohibited substances on campus'],
  ['Cyber Incident', 'Account hacking, online harassment'],
  ['Other', 'Any other security concern'],
];

// Edit these to match the real campus. Coordinates are approximate placeholders around Musanze.
const locations = [
  ['Main Gate', -1.4996, 29.6346], ['Administration Block', -1.4990, 29.6352],
  ['Library', -1.4985, 29.6358], ['Lecture Block A', -1.4981, 29.6349],
  ['Lecture Block B', -1.4978, 29.6355], ['Computer Labs', -1.4975, 29.6362],
  ['Student Hostels', -1.5002, 29.6368], ['Cafeteria', -1.4993, 29.6364],
  ['Sports Field', -1.5008, 29.6355], ['Parking Area', -1.4999, 29.6340],
];

const users = [
  ['System Admin', 'admin@rpmusanze.ac.rw', 'ADMIN001', 'admin', 'admin'],
  ['Head of Security', 'head.security@rpmusanze.ac.rw', 'SEC000', 'head_security', 'head_security'],
  ['Officer One', 'officer1@rpmusanze.ac.rw', 'SEC001', 'officer1', 'security_officer'],
  ['Officer Two', 'officer2@rpmusanze.ac.rw', 'SEC002', 'officer2', 'security_officer'],
  ['Principal', 'principal@rpmusanze.ac.rw', 'MGT001', 'principal', 'management'],
  ['Dean of Students', 'dean@rpmusanze.ac.rw', 'DEAN001', 'dean', 'dean'],
  ['Demo Lecturer', 'lecturer@rpmusanze.ac.rw', 'STF001', 'lecturer', 'staff'],
  ['Demo Student', 'student@rpmusanze.ac.rw', '26RP00000', 'student', 'student'],
];

(async () => {
  const pw = process.env.SEED_PASSWORD || 'ChangeMe@123';
  const hash = await bcrypt.hash(pw, 12);
  for (const [n, d] of categories)
    await q('INSERT INTO incident_categories(name,description) VALUES($1,$2) ON CONFLICT DO NOTHING', [n, d]);
  for (const [n, la, ln] of locations)
    await q('INSERT INTO locations(name,lat,lng) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [n, la, ln]);
  for (const [name, email, reg, username, role] of users)
    await q(
      `INSERT INTO users(full_name,email,reg_no,username,password_hash,role)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [name, email, reg, username, hash, role]
    );
  // Sample patrol checkpoints / route
  for (const [i, loc] of ['Main Gate', 'Student Hostels', 'Library'].entries())
    await q(
      `INSERT INTO checkpoints(name,code,location_id)
       SELECT $1,$2,id FROM locations WHERE name=$1 ON CONFLICT DO NOTHING`,
      [loc, 'CP-' + (i + 1)]
    );
  await q(`INSERT INTO patrol_routes(name) VALUES('Night Route A') ON CONFLICT DO NOTHING`);
  await q(
    `INSERT INTO route_checkpoints(route_id,checkpoint_id,seq)
     SELECT r.id,c.id,row_number() OVER (ORDER BY c.id) FROM patrol_routes r, checkpoints c
     WHERE r.name='Night Route A' ON CONFLICT DO NOTHING`
  );
  console.log('Seeded. Demo password for all users:', pw, '(CHANGE IT after first login)');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
