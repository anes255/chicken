'use strict';

const { Pool } = require('pg');
require('dotenv').config();

// Connection string can be overridden via the DATABASE_URL environment
// variable (recommended on Render / Railway / Vercel). Falls back to the
// project's Neon database so the API works out of the box.
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_D6axtk1hSEUv@ep-gentle-bread-apa1bojz-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Create the database schema if it does not yet exist.
 */
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS participants (
      id           SERIAL PRIMARY KEY,
      full_name    VARCHAR(255) NOT NULL,
      phone        VARCHAR(30)  UNIQUE NOT NULL,
      email        VARCHAR(255),
      password     VARCHAR(255) NOT NULL,
      wilaya       VARCHAR(120) NOT NULL,
      baladya      VARCHAR(120) NOT NULL,
      num_birds    INTEGER NOT NULL DEFAULT 0 CHECK (num_birds >= 0),
      num_cages    INTEGER NOT NULL DEFAULT 0 CHECK (num_cages >= 0),
      breed        VARCHAR(255),
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_participants_wilaya ON participants (wilaya);'
  );
  console.log('✓ Database schema ready (participants table).');
}

module.exports = { pool, initDb };
