const path = require('path');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const SECRET = process.env.JWT_SECRET || 'dev_secret';

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'جلسة غير صالحة' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
    next();
  });
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, full_name: user.full_name, is_admin: user.is_admin },
    SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = { authRequired, adminRequired, signToken, SECRET };
