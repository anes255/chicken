'use strict';

// Standalone script to (re)create the database schema. Run with: npm run init-db
const { initDb, pool } = require('./db');

initDb()
  .then(() => {
    console.log('Done.');
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
