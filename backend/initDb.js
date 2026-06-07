// Creates tables and seeds the admin account. Run: npm run init-db
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,
  phone         TEXT UNIQUE NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS participations (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wilaya      TEXT NOT NULL,
  baladya     TEXT NOT NULL,
  breed       TEXT,
  num_birds   INTEGER NOT NULL DEFAULT 0,
  num_cages   INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_participations_wilaya ON participations(wilaya);

CREATE TABLE IF NOT EXISTS breeds (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  image_url   TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrations for databases that already had an older "users" table
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$
DECLARE col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['password','wilaya','baladiya','num_birds','num_cages','bird_types','notes','updated_at']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='users' AND column_name=col AND is_nullable='NO') THEN
      EXECUTE format('ALTER TABLE users ALTER COLUMN %I DROP NOT NULL', col);
    END IF;
  END LOOP;
END $$;
`;

async function main() {
  console.log('Creating tables...');
  await db.query(SCHEMA);

  const phone = process.env.ADMIN_PHONE || '0779452212';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);

  // Upsert the admin user
  await db.query(
    `INSERT INTO users (full_name, phone, password_hash, is_admin)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (phone) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, is_admin = TRUE`,
    ['مدير المعرض', phone, hash]
  );

  // Seed the breeds library once (only if empty)
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM breeds');
  if (rows[0].n === 0) {
    const seed = [
      ['براهما', 'assets/breed-brahma.jpg', 'سلالة عملاقة هادئة الطباع، من أبرز سلالات الزينة.', 1],
      ['كوشين', 'assets/breed-cochin.jpg', 'سلالة كثيفة الريش بأرجل مكسوّة بالريش.', 2],
      ['سيلكي', 'assets/breed-silkie.jpg', 'سلالة بريش حريري ناعم ولون جلد داكن.', 3],
      ['بولندي', 'assets/breed-polish.jpg', 'سلالة مميزة بعرفها الريشي الكبير.', 4],
    ];
    for (const [name, image_url, description, sort_order] of seed) {
      await db.query(
        'INSERT INTO breeds (name, image_url, description, sort_order) VALUES ($1,$2,$3,$4)',
        [name, image_url, description, sort_order]
      );
    }
    console.log('Seeded breeds library.');
  }

  console.log(`Done. Admin ready -> phone: ${phone}  password: ${password}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
