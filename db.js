'use strict';

const { Pool } = require('pg');
require('dotenv').config();

// Connection string can be overridden via the DATABASE_URL environment
// variable (recommended on Render / Railway / Vercel). Falls back to the
// project's Neon database so the API works out of the box.
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_D6axtk1hSEUv@ep-gentle-bread-apa1bojz-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require';

// Small pool — friendly to serverless (Vercel) where many instances may run.
// The Neon `-pooler` endpoint (PgBouncer) handles fan-out.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
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
  console.log('✓ Database schema ready (participants + breeds).');
}

module.exports = { pool, initDb };
