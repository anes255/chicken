'use strict';

const { Pool } = require('pg');
require('dotenv').config();

// The database connection string MUST come from the DATABASE_URL environment
// variable. No credentials are stored in the source code.
function cleanConnString(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  // Paste-proofing: strip a `psql ` wrapper and surrounding quotes.
  s = s.replace(/^psql\s+/i, '').replace(/^['"]|['"]$/g, '').trim();
  // `channel_binding=require` breaks the node-postgres driver — drop it.
  s = s.replace(/([?&])channel_binding=[^&]*/i, '$1').replace(/[?&]$/, '');
  return s;
}

const connectionString = cleanConnString(process.env.DATABASE_URL);
if (!connectionString) {
  console.error('FATAL: DATABASE_URL environment variable is not set.');
  throw new Error('DATABASE_URL is required');
}

// Pool sized for a persistent host (Render). The Neon `-pooler` endpoint
// (PgBouncer) multiplexes these across many concurrent requests.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

// Default fancy / ornamental chicken breeds shown in the registration list.
// Seeded only when the breeds table is empty, so admin edits persist.
const DEFAULT_BREEDS = [
  'براهما (Brahma)', 'كوشن (Cochin)', 'سيلكي / الحرير (Silkie)', 'سيبرايت (Sebright)',
  'بولندي (Polish)', 'وايندوت (Wyandotte)', 'أوربينغتون (Orpington)', 'ليغهورن (Leghorn)',
  'مارانس (Marans)', 'فافرول (Faverolles)', 'سيراما (Serama)', 'فينيكس (Phoenix)',
  'هامبورغ (Hamburg)', 'ساسكس (Sussex)', 'أراوكانا (Araucana)', 'رود آيلاند (Rhode Island)',
  'باندا (Bantam)', 'أيام سيماني (Ayam Cemani)', 'فيومي (Fayoumi)', 'أخرى',
];

/**
 * Create the database schema if it does not yet exist (idempotent migrations).
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
      breed        TEXT,
      notes        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Migrations for existing databases.
  await pool.query("ALTER TABLE participants ALTER COLUMN breed TYPE TEXT;");
  await pool.query("ALTER TABLE participants ADD COLUMN IF NOT EXISTS entries JSONB NOT NULL DEFAULT '[]'::jsonb;");
  await pool.query('CREATE INDEX IF NOT EXISTS idx_participants_wilaya ON participants (wilaya);');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_participants_created ON participants (created_at DESC);');
  // GIN index makes the breed-containment filter (entries @> ...) fast at scale.
  await pool.query('CREATE INDEX IF NOT EXISTS idx_participants_entries ON participants USING GIN (entries);');

  // Reference list of breeds, managed by the admin.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS breeds (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(160) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM breeds');
  if (rows[0].n === 0) {
    await pool.query(
      `INSERT INTO breeds (name) SELECT UNNEST($1::text[]) ON CONFLICT (name) DO NOTHING`,
      [DEFAULT_BREEDS]
    );
  }

  // Additional admin accounts (the primary admin stays in env vars).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id         SERIAL PRIMARY KEY,
      full_name  VARCHAR(160) NOT NULL,
      phone      VARCHAR(30) UNIQUE NOT NULL,
      password   VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('✓ Database schema ready (participants + breeds + admins).');
}

module.exports = { pool, initDb };
