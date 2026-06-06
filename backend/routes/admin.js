const express = require('express');
const db = require('../db');
const { adminRequired } = require('../middleware/auth');

const router = express.Router();

// Dashboard statistics
router.get('/stats', adminRequired, async (req, res) => {
  try {
    const totals = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = FALSE)                AS total_users,
        (SELECT COUNT(*) FROM participations)                             AS total_participations,
        (SELECT COALESCE(SUM(num_birds),0) FROM participations)           AS total_birds,
        (SELECT COALESCE(SUM(num_cages),0) FROM participations)           AS total_cages,
        (SELECT COUNT(DISTINCT wilaya) FROM participations)               AS total_wilayas,
        (SELECT COUNT(DISTINCT breed) FROM participations WHERE breed IS NOT NULL AND breed <> '') AS total_breeds
    `);

    const byWilaya = await db.query(`
      SELECT wilaya,
             COUNT(*)                  AS participants,
             COALESCE(SUM(num_birds),0) AS birds,
             COALESCE(SUM(num_cages),0) AS cages
      FROM participations
      GROUP BY wilaya
      ORDER BY participants DESC, birds DESC
    `);

    const byBreed = await db.query(`
      SELECT COALESCE(NULLIF(breed,''),'غير محدد') AS breed,
             COUNT(*) AS participants,
             COALESCE(SUM(num_birds),0) AS birds
      FROM participations
      GROUP BY COALESCE(NULLIF(breed,''),'غير محدد')
      ORDER BY birds DESC
    `);

    res.json({
      totals: totals.rows[0],
      byWilaya: byWilaya.rows,
      byBreed: byBreed.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// List all users + their participation
router.get('/users', adminRequired, async (req, res) => {
  const q = (req.query.q || '').trim();
  const params = [];
  let where = 'WHERE u.is_admin = FALSE';
  if (q) {
    params.push(`%${q}%`);
    where += ` AND (u.full_name ILIKE $1 OR u.phone ILIKE $1 OR p.wilaya ILIKE $1 OR p.baladya ILIKE $1)`;
  }
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.phone, u.email, u.created_at,
            p.wilaya, p.baladya, p.breed, p.num_birds, p.num_cages, p.notes, p.status, p.updated_at
     FROM users u
     LEFT JOIN participations p ON p.user_id = u.id
     ${where}
     ORDER BY u.created_at DESC`,
    params
  );
  res.json({ users: rows });
});

// Update a participation status
router.patch('/participations/:userId/status', adminRequired, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending', 'approved', 'rejected'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  await db.query('UPDATE participations SET status = $1, updated_at = NOW() WHERE user_id = $2', [
    status,
    req.params.userId,
  ]);
  res.json({ ok: true });
});

// Delete a user (and cascade their participation)
router.delete('/users/:userId', adminRequired, async (req, res) => {
  if (String(req.params.userId) === String(req.user.id)) {
    return res.status(400).json({ error: 'لا يمكن حذف حساب المدير الحالي' });
  }
  await db.query('DELETE FROM users WHERE id = $1 AND is_admin = FALSE', [req.params.userId]);
  res.json({ ok: true });
});

module.exports = router;
