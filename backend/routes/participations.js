const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Get my participation (if any)
router.get('/me', authRequired, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM participations WHERE user_id = $1',
    [req.user.id]
  );
  res.json({ participation: rows[0] || null });
});

// Create or update my participation
router.post('/', authRequired, async (req, res) => {
  try {
    const { wilaya, baladya, breed, num_birds, num_cages, notes } = req.body || {};
    if (!wilaya || !baladya) {
      return res.status(400).json({ error: 'الولاية والبلدية مطلوبتان' });
    }
    const birds = Math.max(0, parseInt(num_birds, 10) || 0);
    const cages = Math.max(0, parseInt(num_cages, 10) || 0);

    const { rows } = await db.query(
      `INSERT INTO participations (user_id, wilaya, baladya, breed, num_birds, num_cages, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         wilaya = EXCLUDED.wilaya,
         baladya = EXCLUDED.baladya,
         breed = EXCLUDED.breed,
         num_birds = EXCLUDED.num_birds,
         num_cages = EXCLUDED.num_cages,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING *`,
      [req.user.id, wilaya, baladya, breed || null, birds, cages, notes || null]
    );
    res.json({ participation: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
