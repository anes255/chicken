const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/participations', require('./routes/participations'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/public', require('./routes/public'));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Optionally serve the frontend if it sits next to the backend
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND_DIR));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Chicken Expo API running on http://localhost:${PORT}`);
});
