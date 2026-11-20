// lib/db.js
//
// Database access for the serverless backend, using Neon's HTTP driver
// (@neondatabase/serverless). This is used instead of a pooled TCP client
// (e.g. `pg`) because Vercel functions are stateless/short-lived and can run
// with high concurrency — a traditional connection pool would exhaust
// Postgres' connection limit very quickly. The Neon HTTP driver issues each
// query as a single HTTPS request and needs no connection management.
//
// Required env var: DATABASE_URL (Neon connection string, e.g.
//   postgres://user:pass@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
// If you provision via the Vercel Postgres (Neon) integration, Vercel sets
// POSTGRES_URL automatically — we fall back to that too.

const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  // Don't throw at import time in case this file is loaded during build
  // introspection — throw lazily on first real query instead.
  console.warn('[db] DATABASE_URL / POSTGRES_URL is not set. Queries will fail until it is configured.');
}

const sql = connectionString ? neon(connectionString) : null;

function getSql() {
  if (!sql) {
    throw new Error(
      'Database is not configured. Set DATABASE_URL (or POSTGRES_URL) in your Vercel project environment variables.'
    );
  }
  return sql;
}

module.exports = { sql: getSql };
