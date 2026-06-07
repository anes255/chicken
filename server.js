'use strict';

const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { pool, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;

// JWT secret MUST be provided in production. If missing, generate a strong
// random one at boot so the public default secret can never be used to forge
// admin tokens. (A random per-boot secret simply invalidates old sessions.)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠  JWT_SECRET not set — generated a random one. Set JWT_SECRET in env to keep sessions across restarts.');
}

// Admin credentials (overridable via env; defaults match the organisers').
const ADMIN_PHONE = process.env.ADMIN_PHONE || '0779452212';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Behind Render/Vercel's proxy — required for correct client IPs (rate limiting).
app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- Security & performance middleware -------------------------------------

app.use(helmet({
  contentSecurityPolicy: false,                       // API returns JSON, not HTML
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow the browser frontend to read responses
}));
app.use(compression());

// CORS allowlist: any *.vercel.app, localhost, and anything in CORS_ORIGINS env.
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // non-browser clients (curl, health checks)
    try {
      const host = new URL(origin).hostname;
      if (host === 'localhost' || host === '127.0.0.1') return cb(null, true);
      if (/(^|\.)vercel\.app$/.test(host)) return cb(null, true);
      if (extraOrigins.includes(origin)) return cb(null, true);
    } catch (_) { /* malformed origin */ }
    return cb(null, false); // unknown origin → no CORS headers → browser blocks
  },
}));

app.use(express.json({ limit: '32kb' })); // cap body size to blunt payload-based DoS

// Rate limiting (per IP). Tunable via env for high-traffic venue days.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_API, 10) || 1000,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'عدد كبير من الطلبات، يرجى المحاولة بعد قليل' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_AUTH, 10) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'محاولات كثيرة، يرجى المحاولة بعد قليل' },
});
app.use('/api/', apiLimiter);

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

// Trim a value to a maximum length (defends against oversized inputs).
function clip(v, max) {
  const s = v == null ? '' : String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

const MAX_ENTRIES = 50;       // max breeds per participant
const MAX_COUNT = 100000;     // sane upper bound for birds/cages

// Normalise the per-breed entries array: [{breed, birds, cages}, ...].
// Falls back to a single legacy {breed, numBirds, numCages} entry when needed.
function normalizeEntries(body) {
  let list = Array.isArray(body.entries) ? body.entries : [];
  list = list
    .slice(0, MAX_ENTRIES)
    .map((e) => ({
      breed: clip(e && e.breed, 160),
      birds: Math.min(MAX_COUNT, Math.max(0, parseInt(e && e.birds, 10) || 0)),
      cages: Math.min(MAX_COUNT, Math.max(0, parseInt(e && e.cages, 10) || 0)),
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
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    let { fullName, phone, email, password, wilaya, baladya, notes } = req.body;
    phone = normalizePhone(phone);
    fullName = clip(fullName, 120);
    email = clip(email, 160);
    wilaya = clip(wilaya, 120);
    baladya = clip(baladya, 120);
    notes = clip(notes, 1000);

    if (!fullName || !phone || !password || !wilaya || !baladya) {
      return res.status(400).json({ error: 'يرجى ملء جميع الحقول المطلوبة' });
    }
    if (!/^[0-9]{8,15}$/.test(phone)) {
      return res.status(400).json({ error: 'رقم الهاتف غير صالح' });
    }
    const pw = String(password);
    if (pw.length < 6 || pw.length > 200) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون بين 6 و200 حرفاً' });
    }

    const { list, totalBirds, totalCages, breedLabel } = normalizeEntries(req.body);
    if (list.length === 0) {
      return res.status(400).json({ error: 'يرجى إضافة سلالة واحدة على الأقل مع عدد الطيور والأقفاص' });
    }
    const hash = await bcrypt.hash(pw, 10);

    const { rows } = await pool.query(
      `INSERT INTO participants
         (full_name, phone, email, password, wilaya, baladya, num_birds, num_cages, breed, entries, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
       RETURNING *`,
      [fullName, phone, email || null, hash, wilaya, baladya, totalBirds, totalCages, breedLabel || null, JSON.stringify(list), notes || null]
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
app.post('/api/login', authLimiter, async (req, res) => {
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

// Short in-memory cache for the public breeds list (read-heavy, rarely changes).
let breedsCache = { at: 0, data: null };
const BREEDS_TTL = 60 * 1000;

app.get('/api/breeds', async (_req, res) => {
  try {
    if (breedsCache.data && Date.now() - breedsCache.at < BREEDS_TTL) {
      return res.json({ breeds: breedsCache.data });
    }
    const { rows } = await pool.query('SELECT id, name FROM breeds ORDER BY name');
    breedsCache = { at: Date.now(), data: rows };
    res.json({ breeds: rows });
  } catch (e) {
    res.status(500).json({ error: 'تعذّر تحميل قائمة السلالات' });
  }
});

app.post('/api/admin/breeds', auth, adminOnly, async (req, res) => {
  const name = clip(req.body.name, 160);
  if (!name) return res.status(400).json({ error: 'يرجى إدخال اسم السلالة' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO breeds (name) VALUES ($1) RETURNING id, name', [name]
    );
    breedsCache = { at: 0, data: null };
    res.status(201).json({ breed: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'هذه السلالة موجودة مسبقاً' });
    res.status(500).json({ error: 'تعذّر إضافة السلالة' });
  }
});

app.delete('/api/admin/breeds/:id', auth, adminOnly, async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM breeds WHERE id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'السلالة غير موجودة' });
  breedsCache = { at: 0, data: null };
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
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'معرّف غير صالح' });
  try {
    const { list, totalBirds, totalCages, breedLabel } = normalizeEntries(req.body);
    const fullName = clip(req.body.fullName, 120);
    const phone = normalizePhone(req.body.phone);
    const email = clip(req.body.email, 160);
    const wilaya = clip(req.body.wilaya, 120);
    const baladya = clip(req.body.baladya, 120);
    const notes = clip(req.body.notes, 1000);
    const { rows } = await pool.query(
      `UPDATE participants SET
         full_name=$1, phone=$2, email=$3, wilaya=$4, baladya=$5,
         num_birds=$6, num_cages=$7, breed=$8, entries=$9::jsonb, notes=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [fullName, phone, email || null, wilaya, baladya, totalBirds, totalCages, breedLabel || null, JSON.stringify(list), notes || null, id]
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
