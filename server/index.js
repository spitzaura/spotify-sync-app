require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════
// CRASH-PROOF HANDLERS
// ═══════════════════════════════════════════

function logCrash(type, err) {
  const msg = `[${new Date().toISOString()}] ${type}: ${err.stack || err.message || err}\n`;
  console.error(msg);
  try { fs.appendFileSync('/tmp/spotify-sync-error.log', msg); } catch (e) { /* ignore */ }
}

process.on('uncaughtException', (err) => {
  logCrash('UNCAUGHT_EXCEPTION', err);
  // Don't exit — keep the server running
});

process.on('unhandledRejection', (reason) => {
  logCrash('UNHANDLED_REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
  // Don't exit — keep the server running
});

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use(routes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Cache-busting middleware
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  } else if (req.path.includes('/assets/')) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});

// Serve React frontend
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  logCrash(`EXPRESS_ERROR ${req.method} ${req.originalUrl}`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`🎵 Spotify Sync Manager running on http://localhost:${PORT}`);

  const spotify = require('./spotify');

  // ═══════════════════════════════════════════
  // STARTUP TASKS
  // ═══════════════════════════════════════════

  // 1. Clean up expired trades
  spotify.cleanupExpiredTrades()
    .then(results => {
      if (results.length > 0) {
        console.log(`🧹 Cleaned up ${results.length} expired trade(s) on startup`);
      }
    })
    .catch(err => logCrash('STARTUP_TRADE_CLEANUP', err));

  // 2. Refresh all tokens on startup (ensures fresh tokens)
  spotify.refreshAllTokens()
    .then(result => {
      console.log(`[STARTUP] Token refresh: ${result.refreshed} success, ${result.failed} failed`);
    })
    .catch(err => logCrash('STARTUP_TOKEN_REFRESH', err));

  // ═══════════════════════════════════════════
  // BACKGROUND CRON JOBS
  // ═══════════════════════════════════════════

  // Refresh all tokens daily (keeps refresh tokens alive forever)
  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(() => {
    spotify.refreshAllTokens()
      .then(result => {
        console.log(`[CRON] Daily token refresh: ${result.refreshed} ✅, ${result.failed} ❌`);
      })
      .catch(err => logCrash('CRON_TOKEN_REFRESH', err));
  }, REFRESH_INTERVAL);

  console.log(`⏲️  Cron: Token refresh scheduled every 24 hours`);
});
