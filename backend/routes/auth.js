const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired } = require('../middleware/auth');

const router = express.Router();

// Register a new participant
router.post('/register', async (req, res) => {
  try {
    const { full_name, phone, email, password } = req.body || {};
    if (!full_name || !phone || !password) {
      return res.status(400).json({ error: 'الاسم ورقم الهاتف وكلمة المرور مطلوبة' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const exists = await db.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'رقم الهاتف مسجل مسبقاً' });
    }

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (full_name, phone, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, phone, email, is_admin`,
      [full_name, phone, email || null, hash]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Login (works for participants and the admin)
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};
    if (!phone || !password) {
      return res.status(400).json({ error: 'رقم الهاتف وكلمة المرور مطلوبان' });
    }
    const { rows } = await db.query(
      'SELECT id, full_name, phone, email, password_hash, is_admin FROM users WHERE phone = $1',
      [phone]
    );
    if (!rows.length) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });

    delete user.password_hash;
    const token = signToken(user);
    res.json({ token, user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// Current user profile
router.get('/me', authRequired, async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, full_name, phone, email, is_admin, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  res.json({ user: rows[0] || null });
});

module.exports = router;
