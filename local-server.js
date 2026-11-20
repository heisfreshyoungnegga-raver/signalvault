// local-server.js — run the SignalVault API locally without Vercel.
// Serves the same Express app from api/index.js that Vercel runs in production.
// The TanStack frontend (repo root) runs separately (`bun run dev`) and calls
// this API via VITE_API_BASE_URL=http://localhost:8080.
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const express = require('express');
const apiApp = require('./api/index.js');

const app = express();
const PORT = process.env.PORT || 8080;

// NOTE: apiApp's own routes already start with "/api/..." (e.g.
// app.post('/api/auth/register', ...)), so it's mounted at the root here,
// not under an extra '/api' prefix — mounting it at '/api' would double it
// up into '/api/api/auth/register'.
app.use(apiApp);

app.listen(PORT, () => {
  console.log(`\n  SignalVault API running locally: http://localhost:${PORT}`);
  console.log(`  API health check:                http://localhost:${PORT}/api/payment/plans\n`);
});
