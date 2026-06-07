const express = require('express');
const db = require('../db');

const router = express.Router();

// Public homepage counters (no auth)
router.get('/stats', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE is_admin = FALSE)      AS members,
        (SELECT COUNT(DISTINCT wilaya) FROM participations)      AS wilayas,
        (SELECT COUNT(*) FROM participations)                    AS participations,
        (SELECT COALESCE(SUM(num_birds),0) FROM participations)  AS birds
    `);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Public breeds library (no auth)
router.get('/breeds', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, image_url, description FROM breeds ORDER BY sort_order ASC, id ASC'
    );
    res.json({ breeds: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
