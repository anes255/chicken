'use strict';

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { pool, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'brahma-club-maaradh-secret-2026';

// Admin credentials (as specified by the organisers).
const ADMIN_PHONE = process.env.ADMIN_PHONE || '0779452212';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json());

// Lazily initialise the schema once per (warm) serverless instance, so the API
// works both as a long-running server and as a Vercel serverless function.
let dbReady = null;
app.use(async (_req, _res, next) => {
  try {
    if (!dbReady) dbReady = initDb();
    await dbReady;
    next();
  } catch (e) {
    dbReady = null; // allow retry on next request
    next(e);
  }
});

// --- Helpers ---------------------------------------------------------------

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function normalizePhone(phone) {
  return String(phone || '').replace(/[\s\-]/g, '').trim();
}

// Normalise the per-breed entries array: [{breed, birds, cages}, ...].
// Falls back to a single legacy {breed, numBirds, numCages} entry when needed.
function normalizeEntries(body) {
  let list = Array.isArray(body.entries) ? body.entries : [];
  list = list
    .map((e) => ({
      breed: String(e.breed || '').trim(),
      birds: Math.max(0, parseInt(e.birds, 10) || 0),
      cages: Math.max(0, parseInt(e.cages, 10) || 0),
    }))
    .filter((e) => e.breed);
  // Backward compatibility with the old single-breed form.
  if (list.length === 0 && (body.breed || body.numBirds || body.numCages)) {
    list = [{
      breed: String(body.breed || 'غير محدد').trim(),
      birds: Math.max(0, parseInt(body.numBirds, 10) || 0),
      cages: Math.max(0, parseInt(body.numCages, 10) || 0),
    }];
  }
  const totalBirds = list.reduce((a, e) => a + e.birds, 0);
  const totalCages = list.reduce((a, e) => a + e.cages, 0);
  const breedLabel = list.map((e) => e.breed).join('، ');
  return { list, totalBirds, totalCages, breedLabel };
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    wilaya: row.wilaya,
    baladya: row.baladya,
    numBirds: row.num_birds,
    numCages: row.num_cages,
    breed: row.breed,
    entries: Array.isArray(row.entries) ? row.entries : [],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Auth middleware -----------------------------------------------------------

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'انتهت الجلسة، يرجى إعادة تسجيل الدخول' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'هذه الصفحة مخصصة للإدارة فقط' });
  }
  next();
}

// --- Routes ----------------------------------------------------------------

app.get('/', (_req, res) => {
  res.json({
    name: 'المعرض الوطني لدجاج الزينة - Brahma Club Algeria API',
    status: 'running',
    endpoints: ['/api/health', '/api/register', '/api/login', '/api/me', '/api/admin/*'],
  });
});

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'down', message: e.message });
  }
});

// Register a new participant.
app.post('/api/register', async (req, res) => {
  try {
    let { fullName, phone, email, password, wilaya, baladya, notes } = req.body;
    phone = normalizePhone(phone);

    if (!fullName || !phone || !password || !wilaya || !baladya) {
      return res.status(400).json({ error: 'يرجى ملء جميع الحقول المطلوبة' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const { list, totalBirds, totalCages, breedLabel } = normalizeEntries(req.body);
    if (list.length === 0) {
      return res.status(400).json({ error: 'يرجى إضافة سلالة واحدة على الأقل مع عدد الطيور والأقفاص' });
    }
    const hash = await bcrypt.hash(String(password), 10);

    const { rows } = await pool.query(
      `INSERT INTO participants
         (full_name, phone, email, password, wilaya, baladya, num_birds, num_cages, breed, entries, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       RETURNING *`,
      [fullName.trim(), phone, email || null, hash, wilaya, baladya, totalBirds, totalCages, breedLabel || null, JSON.stringify(list), notes || null]
    );

    const user = publicUser(rows[0]);
    const token = signToken({ id: user.id, phone: user.phone, role: 'participant' });
    res.status(201).json({ token, user, role: 'participant' });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'رقم الهاتف مسجّل مسبقاً' });
    }
    console.error('register error:', e.message);
    res.status(500).json({ error: 'حدث خطأ أثناء التسجيل' });
  }
});

// Login (participant or admin).
app.post('/api/login', async (req, res) => {
  try {
    let { phone, password } = req.body;
    phone = normalizePhone(phone);
    if (!phone || !password) {
      return res.status(400).json({ error: 'يرجى إدخال رقم الهاتف وكلمة المرور' });
    }

    // Admin path.
    if (phone === ADMIN_PHONE && password === ADMIN_PASSWORD) {
      const token = signToken({ id: 0, phone, role: 'admin' });
      return res.json({ token, role: 'admin', user: { fullName: 'إدارة المعرض', phone, role: 'admin' } });
    }

    const { rows } = await pool.query('SELECT * FROM participants WHERE phone = $1', [phone]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }
    const ok = await bcrypt.compare(String(password), rows[0].password);
    if (!ok) {
      return res.status(401).json({ error: 'رقم الهاتف أو كلمة المرور غير صحيحة' });
    }

    const user = publicUser(rows[0]);
    const token = signToken({ id: user.id, phone: user.phone, role: 'participant' });
    res.json({ token, user, role: 'participant' });
  } catch (e) {
    console.error('login error:', e.message);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول' });
  }
});

// Current participant profile.
app.get('/api/me', auth, async (req, res) => {
  if (req.user.role === 'admin') {
    return res.json({ user: { fullName: 'إدارة المعرض', phone: req.user.phone, role: 'admin' }, role: 'admin' });
  }
  const { rows } = await pool.query('SELECT * FROM participants WHERE id = $1', [req.user.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'الحساب غير موجود' });
  res.json({ user: publicUser(rows[0]), role: 'participant' });
});

// Update own profile.
app.put('/api/me', auth, async (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ error: 'غير مسموح' });
  try {
    const { fullName, email, wilaya, baladya, notes } = req.body;
    const { list, totalBirds, totalCages, breedLabel } = normalizeEntries(req.body);
    if (list.length === 0) {
      return res.status(400).json({ error: 'يرجى إضافة سلالة واحدة على الأقل' });
    }
    const { rows } = await pool.query(
      `UPDATE participants SET
         full_name = COALESCE($1, full_name),
         email = $2, wilaya = COALESCE($3, wilaya), baladya = COALESCE($4, baladya),
         num_birds = $5, num_cages = $6, breed = $7, entries = $8::jsonb, notes = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [fullName, email || null, wilaya, baladya, totalBirds, totalCages, breedLabel || null, JSON.stringify(list), notes || null, req.user.id]
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    console.error('update me error:', e.message);
    res.status(500).json({ error: 'تعذّر تحديث البيانات' });
  }
});

// --- Breeds (public list + admin management) -------------------------------

app.get('/api/breeds', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, name FROM breeds ORDER BY name');
    res.json({ breeds: rows });
  } catch (e) {
    res.status(500).json({ error: 'تعذّر تحميل قائمة السلالات' });
  }
});

app.post('/api/admin/breeds', auth, adminOnly, async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'يرجى إدخال اسم السلالة' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO breeds (name) VALUES ($1) RETURNING id, name', [name]
    );
    res.status(201).json({ breed: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'هذه السلالة موجودة مسبقاً' });
    res.status(500).json({ error: 'تعذّر إضافة السلالة' });
  }
});

app.delete('/api/admin/breeds/:id', auth, adminOnly, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM breeds WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'السلالة غير موجودة' });
  res.json({ ok: true });
});

// --- Admin routes ----------------------------------------------------------

app.get('/api/admin/participants', auth, adminOnly, async (req, res) => {
  const { search, wilaya, breed } = req.query;
  const clauses = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(full_name ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }
  if (wilaya) {
    params.push(wilaya);
    clauses.push(`wilaya = $${params.length}`);
  }
  if (breed) {
    params.push(breed);
    // Match participants who declared this breed in any of their entries.
    clauses.push(`entries @> jsonb_build_array(jsonb_build_object('breed', $${params.length}::text))`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM participants ${where} ORDER BY created_at DESC`,
    params
  );
  res.json({ participants: rows.map(publicUser) });
});

app.get('/api/admin/stats', auth, adminOnly, async (_req, res) => {
  const totals = await pool.query(
    `SELECT COUNT(*)::int AS total_participants,
            COALESCE(SUM(num_birds),0)::int AS total_birds,
            COALESCE(SUM(num_cages),0)::int AS total_cages
       FROM participants`
  );
  const byWilaya = await pool.query(
    `SELECT wilaya,
            COUNT(*)::int AS participants,
            COALESCE(SUM(num_birds),0)::int AS birds,
            COALESCE(SUM(num_cages),0)::int AS cages
       FROM participants GROUP BY wilaya ORDER BY participants DESC`
  );
  // Per-breed analytics: unnest the JSONB entries and aggregate.
  const byBreed = await pool.query(
    `SELECT e->>'breed' AS breed,
            COUNT(DISTINCT p.id)::int AS participants,
            COALESCE(SUM((e->>'birds')::int),0)::int AS birds,
            COALESCE(SUM((e->>'cages')::int),0)::int AS cages
       FROM participants p, jsonb_array_elements(p.entries) e
      GROUP BY e->>'breed'
      ORDER BY birds DESC, participants DESC`
  );
  // Participants declaring more than one breed.
  const multi = await pool.query(
    `SELECT COUNT(*)::int AS n FROM participants WHERE jsonb_array_length(entries) > 1`
  );
  const recent = await pool.query(
    `SELECT * FROM participants ORDER BY created_at DESC LIMIT 5`
  );

  const t = totals.rows[0];
  const breeds = byBreed.rows;
  const analytics = {
    distinctBreeds: breeds.length,
    multiBreedParticipants: multi.rows[0].n,
    topBreed: breeds[0] ? breeds[0].breed : null,
    avgBirdsPerParticipant: t.total_participants ? +(t.total_birds / t.total_participants).toFixed(1) : 0,
    avgCagesPerParticipant: t.total_participants ? +(t.total_cages / t.total_participants).toFixed(1) : 0,
    birdsPerCage: t.total_cages ? +(t.total_birds / t.total_cages).toFixed(1) : 0,
  };

  res.json({
    totals: t,
    byWilaya: byWilaya.rows,
    byBreed: breeds,
    analytics,
    recent: recent.rows.map(publicUser),
  });
});

app.put('/api/admin/participants/:id', auth, adminOnly, async (req, res) => {
  try {
    const { fullName, phone, email, wilaya, baladya, notes } = req.body;
    const { list, totalBirds, totalCages, breedLabel } = normalizeEntries(req.body);
    const { rows } = await pool.query(
      `UPDATE participants SET
         full_name=$1, phone=$2, email=$3, wilaya=$4, baladya=$5,
         num_birds=$6, num_cages=$7, breed=$8, entries=$9::jsonb, notes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [fullName, normalizePhone(phone), email || null, wilaya, baladya, totalBirds, totalCages, breedLabel || null, JSON.stringify(list), notes || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'المشارك غير موجود' });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'رقم الهاتف مستعمل من طرف مشارك آخر' });
    res.status(500).json({ error: 'تعذّر التعديل' });
  }
});

app.delete('/api/admin/participants/:id', auth, adminOnly, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM participants WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'المشارك غير موجود' });
  res.json({ ok: true });
});

// --- Start -----------------------------------------------------------------

// Error handler (JSON).
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'حدث خطأ في الخادم' });
});

// Only start a listener when run directly (local / Render / Railway).
// On Vercel the app is imported as a serverless handler instead.
if (require.main === module) {
  app.listen(PORT, () => console.log(`✓ API running on port ${PORT}`));
}

module.exports = app;
