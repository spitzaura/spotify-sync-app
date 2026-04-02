const express = require('express');
const { v4: uuidv4 } = require('uuid');
const store = require('./store');
const spotify = require('./spotify');
const fs = require('fs');
const s4aRoutes = require('./s4a-route');

const router = express.Router();

// Mount S4A scraper routes
router.use(s4aRoutes);

// Error logging helper
function logError(err, context) {
  const msg = `[${new Date().toISOString()}] ${context}: ${err.stack || err.message}\n`;
  console.error(msg);
  try { fs.appendFileSync('/tmp/spotify-sync-error.log', msg); } catch (e) { /* ignore */ }
}

// Wrap async route handlers for crash safety
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(err => {
      logError(err, `${req.method} ${req.originalUrl}`);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  };
}

// ═══════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════

router.get('/auth/spotify', (req, res) => {
  try {
    const state = uuidv4();
    res.cookie('spotify_auth_state', state, { httpOnly: true, maxAge: 600000 });
    const appKey = req.query.app || 'default';
    res.cookie('spotify_auth_app', appKey, { httpOnly: true, maxAge: 600000 });
    res.redirect(spotify.getAuthUrl(state, appKey));
  } catch (err) {
    logError(err, 'GET /auth/spotify');
    res.status(500).send('Auth error');
  }
});

router.get('/auth/spotify/reauth', (req, res) => {
  try {
    const state = uuidv4();
    res.cookie('spotify_auth_state', state, { httpOnly: true, maxAge: 600000 });
    res.redirect(spotify.getAuthUrl(state));
  } catch (err) {
    logError(err, 'GET /auth/spotify/reauth');
    res.status(500).send('Reauth error');
  }
});

router.get('/auth/spotify/callback', asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = req.cookies?.spotify_auth_state;

  if (error) {
    return res.redirect(`http://127.0.0.1:3000/?error=${encodeURIComponent(error)}`);
  }

  if (!state || state !== storedState) {
    return res.redirect('http://127.0.0.1:3000/?error=state_mismatch');
  }

  res.clearCookie('spotify_auth_state');

  const appKey = req.cookies?.spotify_auth_app || 'default';
  res.clearCookie('spotify_auth_app');
  const tokens = await spotify.exchangeCode(code, appKey);
  const expiresAt = Date.now() + (tokens.expires_in * 1000);

  let profile;
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` },
  });
  
  if (!profileRes.ok) {
    console.warn('Profile fetch failed:', profileRes.status, '— using appKey as fallback');
    profile = {
      id: appKey.split('@')[0] || 'unknown',
      display_name: appKey.split('@')[0] || 'Unknown',
      email: appKey !== 'default' ? appKey : '',
    };
  } else {
    profile = await profileRes.json();
  }

  // AUTO-CORRECTION: If user re-auths without specifying app, use their email to find dedicated app
  let finalAppKey = appKey;
  if (appKey === 'default' && profile.email) {
    // Check if this email has a dedicated Spotify app
    const dedicatedApps = require('./spotify').ACCOUNT_APPS || {};
    if (dedicatedApps[profile.email]) {
      finalAppKey = profile.email;
      console.log(`[AUTO-CORRECT] Re-auth detected for ${profile.email} → mapped to dedicated app (was default)`);
    }
  }

  // Check if account already exists (re-auth case) — use existing email if available
  const existingAccounts = store.getAllAccounts();
  let existingAccount = existingAccounts.find(a => a.spotify_user_id === profile.id);
  
  const accountId = existingAccount?.id || uuidv4();
  
  // IMPORTANT: Save which app was used for auth - needed for token refresh
  store.upsertAccount({
    id: accountId,
    spotifyUserId: profile.id,
    displayName: profile.display_name || profile.id,
    email: profile.email || '',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    authAppKey: finalAppKey, // AUTO-CORRECT: Use dedicated app for this email, not 'default'
  });
  
  console.log(`[AUTH] Account ${profile.display_name} (${profile.email}) authenticated with app: ${finalAppKey}`);

  res.redirect('http://127.0.0.1:3000/?connected=true');
}));

// ═══════════════════════════════════════════
// ACCOUNT ROUTES
// ═══════════════════════════════════════════

router.get('/api/accounts', asyncHandler(async (req, res) => {
  const accounts = store.getAllAccounts();
  res.json(accounts);
}));

// Quick re-auth helper — returns URLs for accounts needing refresh
router.get('/api/accounts/reauth-urls', asyncHandler(async (req, res) => {
  const accounts = store.getAllAccounts();
  const needingReauth = accounts.filter(a => {
    const expiresAt = new Date(a.token_expires_at);
    return expiresAt < new Date();
  });
  
  const urls = needingReauth.map(acc => ({
    email: acc.email,
    name: acc.display_name,
    url: `http://127.0.0.1:3000/auth/spotify?app=${encodeURIComponent(acc.email)}`
  }));
  
  res.json({ needingReauth: urls, count: urls.length });
}));

router.delete('/api/accounts/:id', asyncHandler(async (req, res) => {
  store.deleteAccount(req.params.id);
  res.json({ ok: true });
}));

router.get('/api/accounts/:id/playlists', asyncHandler(async (req, res) => {
  const playlists = await spotify.getAccountPlaylists(req.params.id);
  res.json(playlists);
}));

router.get('/api/app-keys', asyncHandler(async (req, res) => {
  const keys = ['default', ...Object.keys(require('./spotify').ACCOUNT_APPS || {})];
  res.json(keys);
}));

// Token status for debugging account auth issues
router.get('/api/accounts/debug/token-status', asyncHandler(async (req, res) => {
  const accounts = store.getAllAccounts();
  const now = Date.now();
  
  const status = accounts.map(acc => ({
    id: acc.id,
    name: acc.display_name,
    email: acc.email,
    authAppKey: acc.auth_app_key,
    expiresInSeconds: Math.floor((acc.token_expires_at - now) / 1000),
    needsRefresh: (acc.token_expires_at - now) < (5 * 60 * 1000),
    tokenExpiresAt: new Date(acc.token_expires_at).toISOString(),
  }));
  
  res.json({ accounts: status, now: new Date(now).toISOString() });
}));

// AUTO-CORRECT: Fix any legacy accounts with auth_app_key='default' by mapping to dedicated apps
router.post('/api/accounts/fix-legacy-mapping', asyncHandler(async (req, res) => {
  const accounts = store.getAllAccounts();
  const dedicatedApps = require('./spotify').ACCOUNT_APPS || {};
  let fixed = 0;
  let errors = [];
  
  for (const acc of accounts) {
    if (acc.auth_app_key === 'default' && acc.email && dedicatedApps[acc.email]) {
      try {
        // Update this account to use its dedicated app
        store.upsertAccount({
          id: acc.id,
          spotifyUserId: acc.spotify_user_id,
          displayName: acc.display_name,
          email: acc.email,
          accessToken: acc.access_token,
          refreshToken: acc.refresh_token,
          expiresAt: acc.token_expires_at,
          authAppKey: acc.email, // Map to dedicated app
        });
        fixed++;
        console.log(`[FIXED] ${acc.display_name} (${acc.email}): default → ${acc.email}`);
      } catch (err) {
        errors.push(`Failed to fix ${acc.email}: ${err.message}`);
      }
    }
  }
  
  res.json({
    message: `Fixed ${fixed} account${fixed !== 1 ? 's' : ''}`,
    fixed,
    errors,
    totalAccounts: accounts.length,
    timestamp: new Date().toISOString(),
  });
}));

// ═══════════════════════════════════════════
// GROUP ROUTES
// ═══════════════════════════════════════════

router.get('/api/groups', asyncHandler(async (req, res) => {
  const groups = store.getAllGroups();
  res.json(groups);
}));

router.post('/api/groups', asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const group = store.createGroup(uuidv4(), name);
  res.json(group);
}));

router.put('/api/groups/:id', asyncHandler(async (req, res) => {
  const group = store.updateGroup(req.params.id, req.body);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  res.json(group);
}));

router.delete('/api/groups/:id', asyncHandler(async (req, res) => {
  store.deleteGroup(req.params.id);
  res.json({ ok: true });
}));

router.put('/api/groups/:id/master', asyncHandler(async (req, res) => {
  const { playlistId, playlistName, accountId } = req.body;
  if (!playlistId || !accountId) {
    return res.status(400).json({ error: 'playlistId and accountId are required' });
  }
  const group = store.updateGroup(req.params.id, {
    masterPlaylistId: playlistId,
    masterPlaylistName: playlistName,
    masterAccountId: accountId,
  });
  res.json(group);
}));

router.post('/api/groups/:id/children', asyncHandler(async (req, res) => {
  const { playlistId, playlistName, accountId } = req.body;
  if (!playlistId || !accountId) {
    return res.status(400).json({ error: 'playlistId and accountId are required' });
  }
  const childId = uuidv4();
  store.addChildPlaylist(childId, req.params.id, playlistId, playlistName, accountId);
  const group = store.getGroupById(req.params.id);
  res.json(group);
}));

router.delete('/api/groups/:groupId/children/:childId', asyncHandler(async (req, res) => {
  store.removeChildPlaylist(req.params.childId);
  const group = store.getGroupById(req.params.groupId);
  res.json(group);
}));

// ═══════════════════════════════════════════
// BULK IMPORT ROUTE
// ═══════════════════════════════════════════

router.post('/api/groups/:id/children/bulk', asyncHandler(async (req, res) => {
  const { urls, accountId } = req.body;
  if (!urls || !accountId) {
    return res.status(400).json({ error: 'urls and accountId are required' });
  }

  const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
  const results = [];

  for (const url of urlList) {
    const match = url.match(/playlist[/:]([a-zA-Z0-9]+)/);
    if (!match) {
      results.push({ url, error: 'Invalid URL format', status: 'error' });
      continue;
    }
    const playlistId = match[1];

    try {
      const data = await spotify.spotifyFetch(accountId, `/playlists/${playlistId}?fields=name`);
      const playlistName = data?.name || playlistId;

      const childId = uuidv4();
      store.addChildPlaylist(childId, req.params.id, playlistId, playlistName, accountId);
      results.push({ url, playlistId, playlistName, status: 'success' });
    } catch (err) {
      results.push({ url, playlistId, error: err.message, status: 'error' });
    }
  }

  const group = store.getGroupById(req.params.id);
  res.json({ group, importResults: results });
}));

// ═══════════════════════════════════════════
// DUPLICATE DETECTION ROUTE
// ═══════════════════════════════════════════

router.get('/api/groups/:id/duplicates', asyncHandler(async (req, res) => {
  const result = await spotify.getMasterDuplicates(req.params.id);
  res.json(result);
}));

// ═══════════════════════════════════════════
// SYNC ROUTES
// ═══════════════════════════════════════════

// TEST ONLY: Populate cache without syncing (safe way to test Quick Scan)
router.post('/api/groups/:id/cache-test', asyncHandler(async (req, res) => {
  const group = store.getGroupById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.master_playlist_id || !group.master_account_id) {
    return res.status(400).json({ error: 'Group has no master playlist' });
  }

  // Load master tracks (NO sync to children)
  const masterTracks = await spotify.getAllPlaylistTracks(group.master_account_id, group.master_playlist_id);
  
  // Cache the master playlist tracks
  const masterCacheKey = `sync_cache_${group.master_playlist_id}`;
  store.setCache(masterCacheKey, {
    trackUris: masterTracks,
    trackCount: masterTracks.length,
    cachedAt: new Date().toISOString(),
    image: null,
  }, 60);

  res.json({
    message: `✅ Test cache populated: ${masterTracks.length} tracks cached for Quick Scan (no children synced)`,
    masterTrackCount: masterTracks.length,
    cacheKey: masterCacheKey,
    cachedAt: new Date().toISOString(),
  });
}));

router.post('/api/groups/:id/sync', asyncHandler(async (req, res) => {
  const { childIds } = req.body || {};
  const results = await spotify.syncGroup(req.params.id, { childIds });
  res.json({ ok: true, results });
}));

router.get('/api/groups/:id/sync/stream', asyncHandler(async (req, res) => {
  const childIds = req.query.childIds ? req.query.childIds.split(',') : undefined;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let closed = false;
  req.on('close', () => { closed = true; });

  try {
    await spotify.syncGroup(req.params.id, {
      childIds,
      onProgress: (event) => {
        if (!closed) sendEvent(event);
      },
    });
  } catch (err) {
    if (!closed) {
      sendEvent({ type: 'error', error: err.message });
    }
    logError(err, `SSE sync group ${req.params.id}`);
  } finally {
    if (!closed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}));

router.get('/api/groups/:id/logs', asyncHandler(async (req, res) => {
  const logs = store.getSyncLogs(req.params.id);
  res.json(logs);
}));

// Add a single track to master + all synced playlists (no bulk update)
router.post('/api/groups/:id/add-single-track', asyncHandler(async (req, res) => {
  const { trackUri, trackName, artistName } = req.body;
  if (!trackUri) return res.status(400).json({ error: 'trackUri required' });

  const group = store.getGroupById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.master_playlist_id || !group.master_account_id) {
    return res.status(400).json({ error: 'Group has no master playlist' });
  }

  try {
    // 1. Add to master
    await spotify.addTracksToPlaylist(group.master_account_id, group.master_playlist_id, [trackUri]);

    // 2. Get all children
    const children = store.getGroupChildren(req.params.id);
    if (!children || children.length === 0) {
      return res.json({
        message: `✅ Track added to master (${trackName || trackUri})`,
        masterAdded: true,
        childrenCount: 0,
        childrenUpdated: [],
      });
    }

    // 3. Add to all children (fast, no removals)
    const childResults = [];
    for (const child of children) {
      try {
        await spotify.addTracksToPlaylist(child.account_id, child.playlist_id, [trackUri]);
        childResults.push({
          playlistId: child.playlist_id,
          playlistName: child.playlist_name,
          status: 'success',
        });
      } catch (err) {
        childResults.push({
          playlistId: child.playlist_id,
          playlistName: child.playlist_name,
          status: 'error',
          error: err.message,
        });
      }
    }

    res.json({
      message: `✅ Track added: ${trackName || trackUri}`,
      masterAdded: true,
      childrenCount: children.length,
      childrenUpdated: childResults,
      successCount: childResults.filter(r => r.status === 'success').length,
    });
  } catch (err) {
    logError(err, `POST /api/groups/:id/add-single-track`);
    res.status(500).json({ error: err.message });
  }
}));

// Add a trade (quick add track to multiple playlists with optional position)
router.post('/api/trades/add-trade', asyncHandler(async (req, res) => {
  const { trackUri, playlists, position } = req.body;
  if (!trackUri || !playlists || !playlists.length) {
    return res.status(400).json({ error: 'trackUri and playlists array required' });
  }

  const results = [];
  let successCount = 0;

  for (const pl of playlists) {
    try {
      // Add track with optional position (0-indexed)
      if (position !== undefined && position >= 0) {
        await spotify.addTracksToPlaylist(pl.accountId, pl.playlistId, [trackUri], position);
      } else {
        await spotify.addTracksToPlaylist(pl.accountId, pl.playlistId, [trackUri]);
      }
      results.push({
        playlistId: pl.playlistId,
        playlistName: pl.playlistName,
        status: 'success',
      });
      successCount++;
    } catch (err) {
      results.push({
        playlistId: pl.playlistId,
        playlistName: pl.playlistName,
        status: 'error',
        error: err.message,
      });
    }
  }

  res.json({
    message: `✅ Trade added`,
    trackUri,
    targetCount: playlists.length,
    successCount,
    results,
  });
}));

// ═══════════════════════════════════════════
// TRADE ROUTES
// ═══════════════════════════════════════════

// List all trades (with computed days_remaining)
router.get('/api/trades', asyncHandler(async (req, res) => {
  const trades = store.getAllTrades();
  const now = new Date();
  const enriched = trades.map(t => {
    const expiresAt = new Date(t.expires_at + 'Z');
    const daysRemaining = Math.max(0, Math.ceil((expiresAt - now) / 86400000));
    return {
      ...t,
      track_uris: JSON.parse(t.track_uris),
      playlist_ids: JSON.parse(t.playlist_ids),
      days_remaining: t.status === 'active' ? daysRemaining : 0,
    };
  });
  res.json(enriched);
}));

// Create a new trade
router.post('/api/trades', asyncHandler(async (req, res) => {
  const { name, trackInput, playlistIds, durationDays, notes, _expiresAt } = req.body;

  // For past trades, allow empty trackInput and playlistIds
  const isPastTrade = notes?.includes('[PAST TRADE]');
  
  if (!trackInput && !isPastTrade) {
    return res.status(400).json({ error: 'trackInput is required' });
  }
  if ((!playlistIds || !playlistIds.length) && !isPastTrade) {
    return res.status(400).json({ error: 'playlistIds are required' });
  }

  // For past trades, skip actual API operations
  if (isPastTrade) {
    const duration = durationDays || 28;
    
    // Use passed expiry date if provided, else calculate
    const expiresAtStr = _expiresAt || (() => {
      const expiresAt = new Date(Date.now() + duration * 86400000);
      return expiresAt.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];
    })();
    
    const trade = store.createTrade({
      id: uuidv4(),
      name: name || `Trade ${new Date().toLocaleDateString()}`,
      trackUris: JSON.stringify([]),
      playlistIds: JSON.stringify([]),
      durationDays: duration,
      expiresAt: expiresAtStr,
      notes: notes || null,
    });
    
    return res.json({ trade, addResults: [], isPastTrade: true });
  }

  // Parse track URIs from input (support URLs, URIs, and plain IDs)
  const lines = trackInput.split('\n').map(l => l.trim()).filter(Boolean);
  const trackUris = [];
  for (const line of lines) {
    const urlMatch = line.match(/track[/:]([a-zA-Z0-9]+)/);
    if (urlMatch) {
      trackUris.push(`spotify:track:${urlMatch[1]}`);
    } else if (line.startsWith('spotify:track:')) {
      trackUris.push(line);
    } else if (/^[a-zA-Z0-9]{22}$/.test(line)) {
      trackUris.push(`spotify:track:${line}`);
    }
  }

  if (trackUris.length === 0) {
    return res.status(400).json({ error: 'No valid track URIs found in input' });
  }

  const duration = durationDays || 28;
  const expiresAt = new Date(Date.now() + duration * 86400000);
  const expiresAtStr = expiresAt.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

  // Add tracks to all target playlists
  const addResults = [];
  for (const target of playlistIds) {
    try {
      await spotify.addTracksToPlaylist(target.accountId, target.playlistId, trackUris);
      addResults.push({ playlistId: target.playlistId, playlistName: target.playlistName, status: 'success', added: trackUris.length });
    } catch (err) {
      addResults.push({ playlistId: target.playlistId, playlistName: target.playlistName, status: 'error', error: err.message });
    }
  }

  // Store the trade
  const trade = store.createTrade({
    id: uuidv4(),
    name: name || `Trade ${new Date().toLocaleDateString()}`,
    trackUris: JSON.stringify(trackUris),
    playlistIds: JSON.stringify(playlistIds),
    durationDays: duration,
    expiresAt: expiresAtStr,
    notes: notes || null,
  });

  res.json({ trade, addResults });
}));

// Cancel a trade early (removes tracks immediately FROM ALL PLAYLISTS)
router.delete('/api/trades/:id', asyncHandler(async (req, res) => {
  const trade = store.getTradeById(req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  const trackUris = JSON.parse(trade.track_uris);
  const removeResults = [];
  let totalRemoved = 0;

  // 🔥 CHANGE: Remove from ALL playlists, not just the 2 in the trade
  try {
    const uniquePlaylists = new Map();

    // Find ALL playlists containing ANY of the tracks
    for (const trackUri of trackUris) {
      const found = await spotify.findTrackInPlaylists(trackUri);
      for (const item of found) {
        const key = `${item.accountId}:${item.playlistId}`;
        uniquePlaylists.set(key, item);
      }
    }

    console.log(`Trade ${trade.id} cancelled: removing from ${uniquePlaylists.size} total playlists`);

    // Remove from all found playlists
    for (const [key, item] of uniquePlaylists.entries()) {
      try {
        await spotify.removeTracksFromPlaylist(item.accountId, item.playlistId, trackUris);
        removeResults.push({ 
          playlistId: item.playlistId, 
          playlistName: item.playlistName,
          status: 'success', 
          removed: trackUris.length 
        });
        totalRemoved += trackUris.length;
      } catch (err) {
        removeResults.push({ 
          playlistId: item.playlistId, 
          playlistName: item.playlistName,
          status: 'error', 
          error: err.message 
        });
      }
    }
  } catch (err) {
    removeResults.push({ status: 'error', error: 'Removal failed: ' + err.message });
  }

  store.updateTradeStatus(req.params.id, 'cancelled');
  res.json({ ok: true, totalRemoved, removeResults });
}));

// Extend a trade
router.put('/api/trades/:id/extend', asyncHandler(async (req, res) => {
  const { days } = req.body;
  if (!days || days < 1) return res.status(400).json({ error: 'days must be >= 1' });

  const trade = store.extendTrade(req.params.id, days);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });

  res.json(trade);
}));

// Run cleanup on expired trades
router.post('/api/trades/cleanup', asyncHandler(async (req, res) => {
  const results = await spotify.cleanupExpiredTrades();
  res.json({ ok: true, cleaned: results.length, results });
}));

// Get track info from Spotify
router.get('/api/trades/track-info', asyncHandler(async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });

  // Parse track ID from URL/URI
  const match = url.match(/track[/:]([a-zA-Z0-9]+)/);
  const trackId = match ? match[1] : (url.startsWith('spotify:track:') ? url.split(':')[2] : (/^[a-zA-Z0-9]{22}$/.test(url.trim()) ? url.trim() : null));
  if (!trackId) return res.status(400).json({ error: 'Invalid track URL/URI' });

  // Use first available account
  const accounts = store.getAllAccounts();
  if (accounts.length === 0) return res.status(400).json({ error: 'No accounts connected' });

  const info = await spotify.getTrackInfo(accounts[0].id, trackId);
  res.json(info);
}));

// Scan all playlists for a track
router.get('/api/trades/scan', asyncHandler(async (req, res) => {
  const { uri } = req.query;
  if (!uri) return res.status(400).json({ error: 'uri is required' });
  const found = await spotify.findTrackInPlaylists(uri);
  res.json(found);
}));

// Quick scan: Check if track is in cached sync data (NO API CALLS)
router.get('/api/trades/quick-scan', asyncHandler(async (req, res) => {
  const { uri, groupId } = req.query;
  if (!uri || !groupId) return res.status(400).json({ error: 'uri and groupId required' });
  
  const group = store.getGroupById(groupId);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  
  const found = [];
  const playlistIds = new Set();
  
  // Add master playlist
  if (group.master_playlist_id && group.master_account_id) {
    playlistIds.add(group.master_playlist_id);
  }
  
  // Add all synced children
  for (const child of (group.children || [])) {
    playlistIds.add(child.playlist_id);
  }
  
  // Check cached sync data (NO API CALLS)
  for (const playlistId of playlistIds) {
    let accountId = group.master_account_id;
    let playlistName = 'Unknown';
    
    if (group.master_playlist_id !== playlistId) {
      const child = group.children.find(c => c.playlist_id === playlistId);
      if (child) {
        accountId = child.account_id;
        playlistName = child.playlist_name || 'Unknown';
      }
    } else {
      playlistName = group.name || 'Master';
    }
    
    if (!accountId) continue;
    
    // Check sync cache for this playlist
    const cacheKey = `sync_cache_${playlistId}`;
    const cached = store.getCache(cacheKey);
    
    if (cached && cached.trackUris && cached.trackUris.includes(uri)) {
      found.push({
        accountId,
        accountName: (store.getAccountById(accountId) || {}).display_name || 'Unknown',
        playlistId,
        playlistName,
        trackCount: cached.trackCount || 0,
        image: cached.image || null,
        cached: true,
        cachedAt: cached.cachedAt,
      });
    }
  }
  
  res.json(found);
}));

// Remove a track from a specific playlist (manual removal)
router.post('/api/trades/remove-from-playlist', asyncHandler(async (req, res) => {
  const { accountId, playlistId, trackUri } = req.body;
  if (!accountId || !playlistId || !trackUri) return res.status(400).json({ error: 'accountId, playlistId, trackUri required' });
  await spotify.removeTracksFromPlaylist(accountId, playlistId, [trackUri]);
  res.json({ ok: true });
}));

// Count how many synced playlists contain a song (for trades)
// Simply counts all synced playlists (they sync trades to all children)
router.get('/api/trades/count-playlists', asyncHandler(async (req, res) => {
  const groups = store.getAllGroups();
  const found = [];
  
  for (const group of groups) {
    if (group.children && Array.isArray(group.children)) {
      for (const child of group.children) {
        found.push({
          accountId: child.account_id,
          playlistId: child.playlist_id,
          playlistName: child.playlist_name,
          groupName: group.name,
        });
      }
    }
  }
  
  res.json(found);
}));

// ═══════════════════════════════════════════
// CURATION ROUTES
// ═══════════════════════════════════════════

// Scrape tracks from public Spotify playlist (no auth needed)
router.post('/api/curation/scrape', asyncHandler(async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  const match = url.match(/playlist[/:]([a-zA-Z0-9]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid playlist URL' });
  const playlistId = match[1];

  try {
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
    const resp = await fetch(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
    });
    if (!resp.ok) throw new Error(`Spotify returned ${resp.status}`);

    const html = await resp.text();

    // Extract JSON from last <script> tag (Next.js pageProps)
    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    let entity = null;

    for (const sm of scriptMatches) {
      const content = sm[1].trim();
      if (content.length < 500) continue;
      try {
        const parsed = JSON.parse(content);
        if (parsed?.props?.pageProps?.state?.data?.entity) {
          entity = parsed.props.pageProps.state.data.entity;
          break;
        }
      } catch (_) {}
    }

    if (!entity || !entity.trackList) {
      throw new Error('Could not parse playlist data from Spotify page');
    }

    const tracks = entity.trackList.map(t => ({
      uri: t.uri,
      id: t.uri?.split(':').pop() || '',
      name: t.title || 'Unknown',
      artists: t.subtitle || 'Unknown',
      album: '',
      image: null,
      duration_ms: t.duration || 0,
    }));

    res.json({
      name: entity.name || entity.title || 'Playlist',
      description: entity.subtitle || '',
      coverArt: entity.coverArt?.sources?.[0]?.url || null,
      trackCount: tracks.length,
      tracks,
    });
  } catch (err) {
    logError(err, 'Public playlist scrape');
    res.status(500).json({ error: err.message });
  }
}));

// Fetch track details from Spotify by URIs/URLs
router.post('/api/curation/tracks', asyncHandler(async (req, res) => {
  const { input, accountId } = req.body;
  if (!input || !accountId) return res.status(400).json({ error: 'input and accountId required' });

  const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
  const trackIds = [];
  for (const line of lines) {
    const match = line.match(/track[/:]([a-zA-Z0-9]+)/);
    if (match) trackIds.push(match[1]);
    else if (/^[a-zA-Z0-9]{22}$/.test(line)) trackIds.push(line);
  }

  if (trackIds.length === 0) return res.json([]);

  const tracks = [];
  for (let i = 0; i < trackIds.length; i += 50) {
    const batch = trackIds.slice(i, i + 50);
    try {
      const data = await spotify.spotifyFetch(accountId, `/tracks?ids=${batch.join(',')}`);
      if (data && data.tracks) {
        for (const t of data.tracks) {
          if (t) {
            tracks.push({
              uri: t.uri,
              id: t.id,
              name: t.name,
              artists: t.artists?.map(a => a.name).join(', ') || 'Unknown',
              album: t.album?.name || '',
              image: t.album?.images?.[t.album.images.length - 1]?.url || null,
              duration_ms: t.duration_ms,
            });
          }
        }
      }
    } catch (err) {
      logError(err, 'Curation track fetch');
    }
  }

  res.json(tracks);
}));

// Fetch tracks from a playlist
router.post('/api/curation/playlist-tracks', asyncHandler(async (req, res) => {
  const { playlistId, accountId } = req.body;
  if (!playlistId || !accountId) return res.status(400).json({ error: 'playlistId and accountId required' });

  const allTracks = [];
  let url = `/playlists/${playlistId}/items?limit=100`;

  while (url) {
    const data = await spotify.spotifyFetch(accountId, url);
    for (const entry of data.items || []) {
      const t = entry.track || entry.item;
      if (t && t.uri) {
        allTracks.push({
          uri: t.uri,
          id: t.id,
          name: t.name,
          artists: t.artists?.map(a => a.name).join(', ') || 'Unknown',
          album: t.album?.name || '',
          image: t.album?.images?.[t.album.images.length - 1]?.url || null,
          duration_ms: t.duration_ms,
        });
      }
    }
    url = data.next || null;
    if (url) await new Promise(r => setTimeout(r, 200));
  }

  res.json(allTracks);
}));

// Detect duplicates (fuzzy title matching)
router.post('/api/curation/duplicates', asyncHandler(async (req, res) => {
  const { myTracks, famousTracks } = req.body;
  const all = [
    ...(myTracks || []).map(t => ({ ...t, side: 'mine' })),
    ...(famousTracks || []).map(t => ({ ...t, side: 'famous' })),
  ];

  // Normalize title for comparison: lowercase, remove common suffixes/tags
  function normalizeTitle(name) {
    return name
      .toLowerCase()
      .replace(/\(.*?\)/g, '')       // remove parentheses content
      .replace(/\[.*?\]/g, '')       // remove brackets content
      .replace(/\bft\.?\b/g, '')
      .replace(/\bfeat\.?\b/g, '')
      .replace(/\bremix\b/gi, '')
      .replace(/\bversion\b/gi, '')
      .replace(/\bedit\b/gi, '')
      .replace(/\bcover\b/gi, '')
      .replace(/\bdeep\s*house\b/gi, '')
      .replace(/\bchill\b/gi, '')
      .replace(/\bacoustic\b/gi, '')
      .replace(/\blive\b/gi, '')
      .replace(/\boriginal\b/gi, '')
      .replace(/\bmix\b/gi, '')
      .replace(/\bextended\b/gi, '')
      .replace(/\bradio\b/gi, '')
      .replace(/\bvip\b/gi, '')
      .replace(/\binstrumental\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')   // remove special chars
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Simple similarity check (Dice coefficient on bigrams)
  function bigrams(str) {
    const s = str.toLowerCase();
    const b = new Set();
    for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2));
    return b;
  }

  function similarity(a, b) {
    const ba = bigrams(a);
    const bb = bigrams(b);
    let intersection = 0;
    for (const x of ba) { if (bb.has(x)) intersection++; }
    return (2.0 * intersection) / (ba.size + bb.size) || 0;
  }

  const groups = [];
  const used = new Set();

  for (let i = 0; i < all.length; i++) {
    if (used.has(i)) continue;
    const norm1 = normalizeTitle(all[i].name);
    const group = [all[i]];

    for (let j = i + 1; j < all.length; j++) {
      if (used.has(j)) continue;
      const norm2 = normalizeTitle(all[j].name);

      // Exact normalized match OR high similarity
      if (norm1 === norm2 || similarity(norm1, norm2) > 0.75) {
        group.push(all[j]);
        used.add(j);
      }
    }

    if (group.length > 1) {
      used.add(i);
      groups.push(group);
    }
  }

  res.json(groups);
}));

// Interleave tracks and push to playlist
// Fetch audio features for tracks (needs auth)
router.post('/api/curation/audio-features', asyncHandler(async (req, res) => {
  const { trackIds, accountId } = req.body;
  if (!trackIds || !accountId) return res.status(400).json({ error: 'trackIds and accountId required' });

  const features = {};
  // Spotify audio-features accepts up to 100 IDs at once
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    try {
      const data = await spotify.spotifyFetch(accountId, `/audio-features?ids=${batch.join(',')}`);
      if (data && data.audio_features) {
        for (const af of data.audio_features) {
          if (af) {
            features[af.id] = {
              energy: af.energy,
              danceability: af.danceability,
              valence: af.valence,       // happiness/positivity
              tempo: af.tempo,           // BPM
              acousticness: af.acousticness,
              instrumentalness: af.instrumentalness,
              key: af.key,
              mode: af.mode,             // 0=minor, 1=major
              loudness: af.loudness,
            };
          }
        }
      }
    } catch (err) {
      logError(err, 'Audio features fetch');
    }
    if (i + 100 < trackIds.length) await new Promise(r => setTimeout(r, 200));
  }

  res.json(features);
}));

router.post('/api/curation/apply', asyncHandler(async (req, res) => {
  const { myTracks, famousTracks, playlistId, accountId, famousLeadCount } = req.body;
  if (!playlistId || !accountId) return res.status(400).json({ error: 'playlistId and accountId required' });

  const mine = myTracks || [];
  const famous = famousTracks || [];
  const lead = famousLeadCount || 15;

  // Build interleaved order: first N famous, then alternate
  const result = [];
  let fi = 0; // famous index
  let mi = 0; // mine index

  // Phase 1: Lead with famous songs
  while (fi < famous.length && fi < lead) {
    result.push(famous[fi]);
    fi++;
  }

  // Phase 2: Interleave remaining
  const remainFamous = famous.slice(fi);
  const remainMine = mine.slice(mi);

  if (remainMine.length === 0) {
    // No songs of mine left, just add remaining famous
    result.push(...remainFamous);
  } else if (remainFamous.length === 0) {
    // No famous left, just add mine
    result.push(...remainMine);
  } else {
    // Calculate ratio: how many famous per 1 mine
    const ratio = remainFamous.length / remainMine.length;

    if (ratio >= 1) {
      // More famous than mine: space mine evenly
      // Pattern: ceil(ratio) famous, 1 mine
      let fIdx = 0;
      let mIdx = 0;
      while (mIdx < remainMine.length || fIdx < remainFamous.length) {
        // Add batch of famous
        const batchSize = Math.ceil((remainFamous.length - fIdx) / (remainMine.length - mIdx || 1));
        for (let k = 0; k < batchSize && fIdx < remainFamous.length; k++) {
          result.push(remainFamous[fIdx++]);
        }
        // Add one mine
        if (mIdx < remainMine.length) {
          result.push(remainMine[mIdx++]);
        }
      }
      // Any remaining famous
      while (fIdx < remainFamous.length) {
        result.push(remainFamous[fIdx++]);
      }
    } else {
      // More mine than famous: space famous evenly
      const invRatio = remainMine.length / remainFamous.length;
      let fIdx = 0;
      let mIdx = 0;
      while (fIdx < remainFamous.length || mIdx < remainMine.length) {
        // Add one famous
        if (fIdx < remainFamous.length) {
          result.push(remainFamous[fIdx++]);
        }
        // Add batch of mine
        const batchSize = Math.ceil((remainMine.length - mIdx) / (remainFamous.length - (fIdx - 1) || 1));
        for (let k = 0; k < batchSize && mIdx < remainMine.length; k++) {
          result.push(remainMine[mIdx++]);
        }
      }
      while (mIdx < remainMine.length) {
        result.push(remainMine[mIdx++]);
      }
    }
  }

  // Now push to playlist: nuke existing, re-add in new order
  const trackUris = result.map(t => t.uri);

  // Delete all existing
  const existing = await spotify.getAllPlaylistTracks(accountId, playlistId);
  if (existing.length > 0) {
    for (let i = 0; i < existing.length; i += 100) {
      const batch = existing.slice(i, i + 100);
      await spotify.spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ items: batch.map(uri => ({ uri })) }),
      });
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Add in new order
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    await spotify.spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: batch }),
    });
    await new Promise(r => setTimeout(r, 300));
  }

  res.json({ ok: true, totalTracks: result.length, order: result.map(t => ({ name: t.name, artists: t.artists, side: t.side || 'unknown' })) });
}));

// Apply pre-ordered tracks to a playlist (exact order from frontend)
router.post('/api/curation/apply-ordered', asyncHandler(async (req, res) => {
  const { uris, playlistId, accountId } = req.body;
  if (!playlistId || !accountId || !uris) return res.status(400).json({ error: 'uris, playlistId, and accountId required' });

  // Delete all existing tracks
  const existing = await spotify.getAllPlaylistTracks(accountId, playlistId);
  if (existing.length > 0) {
    for (let i = 0; i < existing.length; i += 100) {
      const batch = existing.slice(i, i + 100);
      await spotify.spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
        method: 'DELETE',
        body: JSON.stringify({ items: batch.map(uri => ({ uri })) }),
      });
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Add in exact order
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    await spotify.spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: batch }),
    });
    await new Promise(r => setTimeout(r, 300));
  }

  res.json({ ok: true, totalTracks: uris.length });
}));

// ═══════════════════════════════════════════
// BACKUP & EXPORT ROUTES
// ═══════════════════════════════════════════

router.get('/api/backup/groups', asyncHandler(async (req, res) => {
  const groups = store.getAllGroups();
  const backup = {
    exportedAt: new Date().toISOString(),
    totalGroups: groups.length,
    groups: groups.map(g => ({
      id: g.id,
      name: g.name,
      masterAccount: g.master_account_name,
      masterPlaylistId: g.master_playlist_id,
      masterPlaylistName: g.master_playlist_name,
      childCount: (g.children || []).length,
      children: (g.children || []).map(c => ({
        id: c.id,
        playlistId: c.playlist_id,
        playlistName: c.playlist_name,
        account: (store.getAccountById(c.account_id) || {}).display_name || 'Unknown',
        accountId: c.account_id,
      })),
    })),
  };
  
  // Also save to file
  const fs = require('fs');
  const backupPath = '/Users/ck/.openclaw/workspace/groups_backup.json';
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  
  res.json({ ...backup, savedToFile: backupPath });
}));

// ═══════════════════════════════════════════
// SPOTIFY FOR ARTISTS (S4A) ROUTES
// ═══════════════════════════════════════════

const { getS4AClient } = require('./s4a');

// Get all artists from the roster
router.get('/api/s4a/roster', asyncHandler(async (req, res) => {
  const client = getS4AClient();
  const artists = client.getArtistRoster();
  res.json({ artists });
}));

// Get songs for an artist (from cache — push via POST /api/s4a/push-songs)
router.get('/api/s4a/artist/:artistId/songs', asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const client = getS4AClient();
  const cached = client.getCachedSongData(artistId);
  if (!cached) {
    return res.json({ songs: [], artistId, cached: false, 
      message: 'No cached data. Agent needs to scrape and push via POST /api/s4a/push-songs' });
  }
  res.json({ ...cached, artistId, cached: true });
}));

// Get playlist breakdown (from cache — push via POST /api/s4a/push-playlists)
router.get('/api/s4a/artist/:artistId/song/:trackId/playlists', asyncHandler(async (req, res) => {
  const { artistId, trackId } = req.params;
  const client = getS4AClient();
  const cached = client.getCachedPlaylistData(artistId, trackId);
  if (!cached) {
    return res.json({ playlists: [], artistId, trackId, cached: false,
      message: 'No cached data. Agent needs to scrape and push via POST /api/s4a/push-playlists' });
  }
  res.json({ ...cached, artistId, trackId, cached: true });
}));

// Push scraped playlist data (from OpenClaw agent browser)
router.post('/api/s4a/push-playlists', asyncHandler(async (req, res) => {
  const { artistId, trackId, playlists, totalPlaylists, showing } = req.body;
  if (!artistId || !trackId || !playlists) {
    return res.status(400).json({ error: 'artistId, trackId, and playlists required' });
  }
  const client = getS4AClient();
  client.cachePlaylistData(artistId, trackId, { playlists, totalPlaylists, showing });
  res.json({ success: true, count: playlists.length });
}));

// Push scraped song data
router.post('/api/s4a/push-songs', asyncHandler(async (req, res) => {
  const { artistId, songs } = req.body;
  if (!artistId || !songs) {
    return res.status(400).json({ error: 'artistId and songs required' });
  }
  const client = getS4AClient();
  client.cacheSongData(artistId, { songs });
  res.json({ success: true, count: songs.length });
}));

// Enrich tracks with S4A stats — POST { trackIds: ['id1', 'id2', ...] }
router.post('/api/s4a/enrich-tracks', asyncHandler(async (req, res) => {
  const { trackIds } = req.body;
  if (!trackIds || !Array.isArray(trackIds)) {
    return res.status(400).json({ error: 'trackIds array required' });
  }
  const client = getS4AClient();
  const stats = client.getMultipleTrackStats(trackIds);
  res.json({ stats, found: Object.keys(stats).length, total: trackIds.length });
}));

// Push track stats (bulk import from scraper/Excel)
// Body: { tracks: [{ trackId, streams, listeners, saves, radioStreams, radioPercent, playlistAdds, songName, ... }] }
router.post('/api/s4a/push-track-stats', asyncHandler(async (req, res) => {
  const { tracks } = req.body;
  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ error: 'tracks array required' });
  }
  const client = getS4AClient();
  const count = client.bulkCacheTrackStats(tracks);
  res.json({ success: true, cached: count });
}));

// 🔥 Manual sync: Accept S4A playlist data from Master's browser
// Master navigates to S4A playlist page, copies table data, pastes here
// Body: { playlistId, playlistData: [{ name, madeBy, streams, dateAdded }, ...] }
router.post('/api/s4a/manual-sync', asyncHandler(async (req, res) => {
  const { playlistId, playlistData } = req.body;
  if (!playlistId) return res.status(400).json({ error: 'playlistId required' });
  
  const client = getS4AClient();
  
  // Cache the playlist data (simple caching by playlistId)
  // This is used later when matching tracks
  client.cachePlaylistManualSync(playlistId, playlistData || []);
  
  res.json({ 
    success: true, 
    playlistId,
    cached: playlistData ? playlistData.length : 0,
    message: 'S4A playlist data cached. Go back and analyze your playlist to see enriched tracks.'
  });
}));

// 🔥 Analyze a playlist + per-track S4A data (save ratio = saves/listeners)
router.get('/api/playlists/analyze', asyncHandler(async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  
  // Extract playlist ID from URL
  const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
  if (!match) return res.status(400).json({ error: 'Invalid playlist URL' });
  
  const playlistId = match[1];
  
  // Get first account (for API access)
  const accounts = store.getAllAccounts();
  if (!accounts || accounts.length === 0) {
    return res.status(400).json({ error: 'No Spotify accounts connected' });
  }
  
  const accountId = accounts[0].id;
  
  try {
    // Fetch playlist via Spotify API
    const playlistData = await spotify.spotifyFetch(accountId, `/playlists/${playlistId}`);
    
    const followers = playlistData.followers?.total || 0;
    const description = playlistData.description || '';
    const name = playlistData.name || 'Unknown';
    const totalTracks = playlistData.tracks?.total || 0;
    const image = playlistData.images?.[0]?.url || null;
    
    // Estimate stream potential based on playlist size
    const streamEstimate = (() => {
      if (followers < 100) return followers * 0.5;
      if (followers < 1000) return followers * 1;
      if (followers < 10000) return followers * 2;
      if (followers < 100000) return followers * 3;
      return followers * 4;
    })();
    
    // Saves ratio heuristic
    const savesRatio = description.toLowerCase().includes('save') ? 0.08 : 0.03;
    const estimatedSaves = Math.round(followers * savesRatio);
    
    // Categorize playlist
    let category = 'small';
    if (followers >= 100000) category = 'mega';
    else if (followers >= 10000) category = 'large';
    else if (followers >= 1000) category = 'medium';
    else if (followers >= 100) category = 'small';
    
    // Get S4A client for track lookup
    const s4aClient = getS4AClient();
    const roster = s4aClient.getArtistRoster();
    
    // Build S4A cache lookup (trackId → track data with saves/listeners)
    const s4aByTrackId = {};
    for (const artist of roster) {
      try {
        const songs = s4aClient.getCachedSongData(artist.artistId);
        if (songs && songs.songs) {
          for (const song of songs.songs) {
            if (song.id) {
              s4aByTrackId[song.id] = {
                artist: artist.name,
                song: song.name,
                streams: song.streams || 0,
                listeners: song.listeners || 0,
                saves: song.saves || 0,
                adds: song.playlistAdds || 0,
                radio: song.radioStreams || 0,
                saveRatio: song.listeners ? ((song.saves || 0) / song.listeners).toFixed(4) : 0
              };
            }
          }
        }
      } catch (err) {
        // Skip artist if cache load fails
      }
    }
    
    // Attempt to fetch playlist tracks (try up to 50)
    const trackEstimates = [];
    try {
      const pageData = await spotify.spotifyFetch(accountId, `/playlists/${playlistId}/items?offset=0&limit=50`);
      if (pageData.items) {
        for (const item of pageData.items) {
          const track = item.track;
          if (!track) continue;
          
          const trackId = track.id;
          const trackName = track.name;
          const artists = track.artists?.map(a => a.name).join(', ') || 'Unknown';
          const trackImage = track.album?.images?.[0]?.url || null;
          
          // Estimate streams for THIS track in THIS playlist
          let trackStreamEstimate = 0;
          if (followers < 100) {
            trackStreamEstimate = followers * 0.05;
          } else if (followers < 1000) {
            trackStreamEstimate = followers * 0.3;
          } else if (followers < 10000) {
            trackStreamEstimate = followers * 0.8;
          } else if (followers < 100000) {
            trackStreamEstimate = followers * 1.5;
          } else {
            trackStreamEstimate = followers * 2;
          }
          
          // Look up S4A data for this track
          const s4aData = s4aByTrackId[trackId];
          
          trackEstimates.push({
            trackId,
            name: trackName,
            artists,
            image: trackImage,
            estimatedStreams: Math.round(trackStreamEstimate),
            estimatedStreamsRange: [
              Math.round(trackStreamEstimate * 0.6),
              Math.round(trackStreamEstimate * 1.4)
            ],
            hasS4AData: !!s4aData,
            s4aStreams: s4aData?.streams || null,
            s4aListeners: s4aData?.listeners || null,
            s4aSaves: s4aData?.saves || null,
            s4aAdds: s4aData?.adds || null,
            s4aRadio: s4aData?.radio || null,
            saveRatio: s4aData ? `${(parseFloat(s4aData.saveRatio) * 100).toFixed(2)}%` : null,
            s4aArtist: s4aData?.artist || null
          });
        }
      }
    } catch (err) {
      console.warn('Could not fetch tracks:', err.message);
      // Continue without tracks
    }
    
    res.json({
      success: true,
      playlistId,
      name,
      followers,
      totalTracks,
      image,
      category,
      savesRatio: `${(savesRatio * 100).toFixed(1)}%`,
      estimatedSaves,
      estimatedStreams: Math.round(streamEstimate),
      estimatedStreamsRange: [
        Math.round(streamEstimate * 0.7),
        Math.round(streamEstimate * 1.3)
      ],
      tracks: trackEstimates,
      description: description.substring(0, 100) + (description.length > 100 ? '...' : '')
    });
  } catch (err) {
    console.error('Playlist fetch error:', err.message);
    return res.status(400).json({ error: 'Could not fetch playlist: ' + err.message });
  }
}));

// 🔥 NEW: Bulk cache from auto-roster scraper output
// Body: { data: [{ artist, song, url, adds, radio, streams, listeners, saves }, ...] }
// Extracts track IDs from URLs and caches everything
router.post('/api/s4a/cache-bulk-data', asyncHandler(async (req, res) => {
  const { data } = req.body;
  if (!data || !Array.isArray(data)) {
    return res.status(400).json({ error: 'data array required (from scraper output)' });
  }
  
  const client = getS4AClient();
  let cached = 0;
  
  // Group by artist for easy lookup
  const byArtist = {};
  
  for (const entry of data) {
    const { artist, song, url, adds, radio, streams, listeners, saves } = entry;
    
    // Extract track ID from URL: /song/{trackId}/playlists
    const match = url.match(/\/song\/([a-zA-Z0-9]+)\/playlists/);
    if (!match) continue;
    
    const trackId = match[1];
    
    // Group by artist
    if (!byArtist[artist]) {
      byArtist[artist] = [];
    }
    
    byArtist[artist].push({
      id: trackId,
      name: song,
      streams: parseInt(streams) || 0,
      listeners: parseInt(listeners) || 0,
      saves: parseInt(saves) || 0,
      radioStreams: parseInt(radio) || 0,
      playlistAdds: parseInt(adds) || 0,
      trackId
    });
  }
  
  // Cache songs per artist
  for (const [artist, songs] of Object.entries(byArtist)) {
    // Find artist ID from roster
    const rosterArtists = client.getArtistRoster();
    const artistObj = rosterArtists.find(a => a.name === artist);
    
    if (artistObj) {
      // Cache song data for this artist
      client.cacheSongData(artistObj.id, { 
        songs: songs,
        cachedAt: new Date().toISOString()
      });
      cached += songs.length;
    }
  }
  
  res.json({ 
    success: true, 
    totalCached: cached,
    artists: Object.keys(byArtist).length,
    message: `Cached ${cached} songs across ${Object.keys(byArtist).length} artists`
  });
}));

// Token management
router.get('/api/s4a/token', asyncHandler(async (req, res) => {
  const client = getS4AClient();
  const token = client.getToken();
  res.json({ 
    token: token ? token.substring(0, 20) + '...' : null,
    updatedAt: client.tokenUpdatedAt
  });
}));

router.post('/api/s4a/refresh-token', asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required in body' });
  const client = getS4AClient();
  client.saveToken(token);
  res.json({ success: true, updatedAt: client.tokenUpdatedAt });
}));

// Debug
router.get('/api/s4a/debug', asyncHandler(async (req, res) => {
  const client = getS4AClient();
  const token = client.getToken();
  res.json({ 
    hasToken: !!token, 
    tokenUpdatedAt: client.tokenUpdatedAt,
    rosterCount: client.getArtistRoster().length
  });
}));

// Trade scan: Check cache first, fall back to API
router.get('/api/trades/cache-scan', asyncHandler(async (req, res) => {
  const { uri } = req.query;
  if (!uri) return res.status(400).json({ error: 'uri required' });
  
  const found = [];
  const groups = store.getAllGroups();
  
  // Search all groups + playlists
  for (const group of groups) {
    const playlistIds = new Set();
    
    if (group.master_playlist_id) {
      playlistIds.add(group.master_playlist_id);
    }
    
    for (const child of (group.children || [])) {
      playlistIds.add(child.playlist_id);
    }
    
    for (const playlistId of playlistIds) {
      let accountId = group.master_account_id;
      let playlistName = 'Unknown';
      let foundInPlaylist = false;
      
      if (group.master_playlist_id !== playlistId) {
        const child = group.children.find(c => c.playlist_id === playlistId);
        if (child) {
          accountId = child.account_id;
          playlistName = child.playlist_name || 'Unknown';
        }
      } else {
        playlistName = group.name || 'Master';
      }
      
      if (!accountId) continue;
      
      // Check cache first (FAST)
      const cacheKey = `sync_cache_${playlistId}`;
      const cached = store.getCache(cacheKey);
      
      if (cached && cached.trackUris) {
        foundInPlaylist = cached.trackUris.includes(uri);
      } else {
        // Cache miss - hit API (SLOWER but accurate)
        try {
          const tracks = await spotify.getAllPlaylistTracks(accountId, playlistId);
          foundInPlaylist = tracks.includes(uri);
        } catch (err) {
          console.warn(`Trade scan API error for ${playlistId}: ${err.message}`);
          foundInPlaylist = false;
        }
      }
      
      if (foundInPlaylist) {
        found.push({
          groupId: group.id,
          groupName: group.name,
          accountId,
          accountName: (store.getAccountById(accountId) || {}).display_name || 'Unknown',
          playlistId,
          playlistName,
        });
      }
    }
  }
  
  res.json(found);
}));

// ═══════════════════════════════════════════
// SONG METRICS (Performance Tracking)
// ═══════════════════════════════════════════

// Get all song metrics
router.get('/api/song-metrics', asyncHandler(async (req, res) => {
  const metrics = store.getAllSongMetrics();
  res.json(metrics || []);
}));

// Get single song metric
router.get('/api/song-metrics/:uri', asyncHandler(async (req, res) => {
  const uri = `spotify:track:${req.params.uri}`;
  const metric = store.getSongMetrics(uri);
  if (!metric) return res.status(404).json({ error: 'Song metric not found' });
  res.json(metric);
}));

// Fetch track details from Spotify by track ID
router.get('/api/song-metrics/track-info/:trackId', asyncHandler(async (req, res) => {
  const { trackId } = req.params;
  
  // Get first account to make the API call
  const accounts = store.getAllAccounts();
  if (!accounts || accounts.length === 0) {
    return res.status(400).json({ error: 'No Spotify accounts configured' });
  }

  try {
    const accountId = accounts[0].id;
    const trackData = await spotify.spotifyFetch(accountId, `/tracks/${trackId}`);
    
    if (trackData) {
      res.json({
        name: trackData.name,
        artists: trackData.artists || [],
        album: trackData.album?.name || '',
        release_date: trackData.album?.release_date || '',
        uri: trackData.uri,
      });
    } else {
      res.status(404).json({ error: 'Track not found' });
    }
  } catch (err) {
    logError(err, 'GET /api/song-metrics/track-info/:trackId');
    res.status(500).json({ error: err.message });
  }
}));

// Import songs from Spotify playlist(s)
router.post('/api/song-metrics/import-playlist', asyncHandler(async (req, res) => {
  const { playlistUrls, accountId: providedAccountId } = req.body;
  if (!playlistUrls || !Array.isArray(playlistUrls) || playlistUrls.length === 0) {
    return res.status(400).json({ error: 'playlistUrls array required' });
  }

  const accounts = store.getAllAccounts();
  if (!accounts || accounts.length === 0) {
    return res.status(400).json({ error: 'No Spotify accounts configured' });
  }

  // Use provided account or find by email
  let accountId = providedAccountId;
  if (!accountId) {
    // Try to find spitzaura96@gmail.com, fallback to first account
    const spitzAccount = accounts.find(a => a.email === 'spitzaura96@gmail.com');
    accountId = spitzAccount ? spitzAccount.id : accounts[0].id;
  }
  
  const results = [];
  let totalImported = 0;

  for (const url of playlistUrls) {
    try {
      // Extract playlist ID from URL
      const match = url.match(/playlist[/:]([a-zA-Z0-9]+)/);
      if (!match) {
        results.push({ status: 'error', url, error: 'Invalid playlist URL' });
        continue;
      }

      const playlistId = match[1];

      // Fetch all tracks from playlist
      const allTracks = [];
      let offset = 0;
      let total = 1;

      console.log(`[IMPORT] Fetching playlist ${playlistId} with account ${accountId}`);

      let nextUrl = `/playlists/${playlistId}/items?limit=50`;
      
      while (nextUrl) {
        try {
          const playlistData = await spotify.spotifyFetch(accountId, nextUrl);
          
          if (!playlistData || !playlistData.items || playlistData.items.length === 0) break;

          for (const item of playlistData.items) {
            const track = item.track || item.item;
            
            if (!track || !track.uri) continue;
            
            allTracks.push({
              uri: track.uri,
              name: track.name || 'Unknown',
              artists: track.artists?.map(a => a.name).join(', ') || 'Unknown',
              release_date: track.album?.release_date || '',
            });
          }

          // Use pagination URL from response
          nextUrl = playlistData.next ? playlistData.next.replace('https://api.spotify.com/v1', '') : null;
        } catch (err) {
          console.error(`[IMPORT] Error:`, err.message);
          break;
        }
      }
      
      console.log(`[IMPORT] Total tracks extracted: ${allTracks.length}`);

      // Insert all tracks into metrics
      console.log(`[IMPORT] About to insert ${allTracks.length} tracks`);
      for (const track of allTracks) {
        try {
          const result = store.upsertSongMetric(uuidv4(), {
            spotify_uri: track.uri,
            track_name: track.name,
            artist_name: track.artists,
            released_date: track.release_date,
            streams: 0,
            listeners: 0,
            saves: 0,
            save_ratio: 0,
            radio_streams: 0,
            radio_percent: 0,
            playlists_added: 0,
            s_l_ratio: 0,
          });
          totalImported++;
        } catch (err) {
          console.error(`[IMPORT] Failed to insert ${track.name} (${track.uri}):`, err.message);
        }
      }
      console.log(`[IMPORT] ✅ Total imported: ${totalImported}`);

      results.push({ status: 'success', url, imported: allTracks.length });
    } catch (err) {
      results.push({ status: 'error', url, error: err.message });
    }
  }

  res.json({ imported: totalImported, results });
}));

// Add or update song metric
router.post('/api/song-metrics', asyncHandler(async (req, res) => {
  const { id, spotify_uri, track_name, artist_name, released_date, streams, listeners, saves, save_ratio, radio_streams, radio_percent, playlists_added, s_l_ratio, s4a_data } = req.body;
  
  if (!spotify_uri) return res.status(400).json({ error: 'spotify_uri required' });

  const metric = store.upsertSongMetric(id || uuidv4(), {
    spotify_uri,
    track_name,
    artist_name,
    released_date,
    streams: streams || 0,
    listeners: listeners || 0,
    saves: saves || 0,
    save_ratio: save_ratio || 0,
    radio_streams: radio_streams || 0,
    radio_percent: radio_percent || 0,
    playlists_added: playlists_added || 0,
    s_l_ratio: s_l_ratio || 0,
    s4a_data: s4a_data ? JSON.stringify(s4a_data) : null,
  });

  res.json(metric);
}));

// Bulk upload song metrics (from Excel/CSV)
router.post('/api/song-metrics/bulk', asyncHandler(async (req, res) => {
  const { songs, accountId } = req.body;
  if (!Array.isArray(songs)) return res.status(400).json({ error: 'songs array required' });

  const results = [];
  let successCount = 0;

  // Get account for metadata fetching
  let defaultAccountId = accountId;
  if (!defaultAccountId) {
    const accounts = store.getAllAccounts();
    if (accounts && accounts.length > 0) {
      defaultAccountId = accounts[0].id;
    }
  }

  for (const song of songs) {
    try {
      // Support multiple column name formats (both CSV and JSON)
      const spotifyUri = song.spotify_uri || song.URI || song.uri;
      if (!spotifyUri) {
        results.push({ status: 'error', error: 'spotify_uri required' });
        continue;
      }

      let trackName = song.track_name || song.Song || song.track || '';
      let artistName = song.artist_name || song.Artist || '';
      let releaseDate = song.released_date || song.Released || song.release_date || '';

      // Auto-fetch metadata if names are missing and we have an account
      if ((!trackName || !artistName) && defaultAccountId) {
        try {
          const trackId = spotifyUri.split(':')[2];
          const trackData = await spotify.spotifyFetch(defaultAccountId, `/tracks/${trackId}`);
          
          if (trackData) {
            trackName = trackName || trackData.name || '';
            artistName = artistName || (trackData.artists?.map(a => a.name).join(', ') || '');
            releaseDate = releaseDate || (trackData.album?.release_date || '');
          }
        } catch (err) {
          console.warn(`[BULK] Could not fetch metadata for ${spotifyUri}:`, err.message);
        }
      }

      const metric = store.upsertSongMetric(uuidv4(), {
        spotify_uri: spotifyUri,
        track_name: trackName,
        artist_name: artistName,
        released_date: releaseDate,
        streams: parseInt(song.streams || song.Streams) || 0,
        listeners: parseInt(song.listeners || song.Listeners) || 0,
        saves: parseInt(song.saves || song.Saves) || 0,
        save_ratio: parseFloat(song.save_ratio || song['Save Ratio'] || song['save_ratio %']) || 0,
        radio_streams: parseInt(song.radio_streams) || 0,
        radio_percent: parseFloat(song.radio_percent || song['% Radio'] || song['radio %']) || 0,
        playlists_added: parseInt(song.playlists_added || song.Playlists) || 0,
        s_l_ratio: parseFloat(song.s_l_ratio) || 0,
      });
      successCount++;
      results.push({ status: 'success', track: metric?.track_name || 'Unknown' });
    } catch (err) {
      console.error(`[BULK] Error upserting ${song.track_name}:`, err.message);
      results.push({ status: 'error', error: err.message });
    }
  }

  res.json({ imported: successCount, total: songs.length, results });
}));

// Update single song metric
router.patch('/api/song-metrics/:uri', asyncHandler(async (req, res) => {
  const uri = `spotify:track:${req.params.uri}`;
  const metric = store.updateSongMetric(uri, req.body);
  if (!metric) return res.status(404).json({ error: 'Song metric not found' });
  res.json(metric);
}));

// Delete song metric
router.delete('/api/song-metrics/:uri', asyncHandler(async (req, res) => {
  const uri = `spotify:track:${req.params.uri}`;
  store.deleteSongMetric(uri);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════
// GROUP-FILTERED B2B METRICS
// ═══════════════════════════════════════════

router.get('/api/group-metrics/:groupId', asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const results = store.getGroupMetricsData(groupId);
  res.json(results || []);
}));

router.get('/api/master-groups', asyncHandler(async (req, res) => {
  const groups = store.getMasterGroupsWithPlaylists();
  res.json(groups || []);
}));

// ═══════════════════════════════════════════
// S4A AUTO-SCRAPE FROM METRICS (Auto-load & run)
// ═══════════════════════════════════════════

router.post('/api/s4a/scrape-metrics', asyncHandler(async (req, res) => {
  const { accountId } = req.body;
  
  if (!accountId) {
    return res.status(400).json({ error: 'accountId required' });
  }

  const account = store.getAccountById(accountId);
  if (!account) {
    return res.status(400).json({ error: 'Account not found' });
  }

  // Send streaming response for progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => {
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  };

  try {
    // 1. Fetch all song metrics from database
    const metrics = store.getAllSongMetrics();
    if (!metrics || metrics.length === 0) {
      send('error', { message: 'No songs in metrics table' });
      res.end();
      return;
    }

    send('progress', { message: `Found ${metrics.length} songs, enriching with artist IDs...` });

    // 2. Enrich each with artist ID and build S4A URLs
    const s4aUrls = [];
    for (let i = 0; i < metrics.length; i++) {
      try {
        const metric = metrics[i];
        const uri = metric.spotify_uri;
        if (!uri || !uri.startsWith('spotify:track:')) continue;

        const trackId = uri.split(':')[2];
        
        // Fetch track info from Spotify API to get artist ID
        const trackData = await spotify.spotifyFetch(accountId, `/tracks/${trackId}`);
        if (trackData && trackData.artists && trackData.artists.length > 0) {
          const artistId = trackData.artists[0].id;
          const s4aUrl = `https://artists.spotify.com/c/${artistId}/song/${trackId}`;
          s4aUrls.push(s4aUrl);
          
          if ((i + 1) % 10 === 0) {
            send('progress', { current: i + 1, total: metrics.length, message: `Enriched ${i + 1}/${metrics.length}` });
          }
        }
      } catch (err) {
        console.warn(`[S4A_AUTO] Could not enrich ${metrics[i].spotify_uri}:`, err.message);
      }
    }

    if (s4aUrls.length === 0) {
      send('error', { message: 'Could not enrich any tracks with artist IDs' });
      res.end();
      return;
    }

    send('progress', { message: `✅ Ready: ${s4aUrls.length} S4A URLs prepared` });
    send('complete', { s4a_urls: s4aUrls, count: s4aUrls.length });
    res.end();

  } catch (err) {
    console.error(`[S4A_AUTO] Error:`, err.message);
    send('error', { message: err.message || 'Failed to prepare S4A scrape' });
    res.end();
  }
}));

// ═══════════════════════════════════════════
// SPOTIFY URI EXTRACTOR
// ═══════════════════════════════════════════

router.post('/api/extract-playlist-uris', asyncHandler(async (req, res) => {
  const { playlistId, accountId } = req.body;

  if (!playlistId || !accountId) {
    return res.status(400).json({ error: 'playlistId and accountId required' });
  }

  // Validate playlist ID format (Spotify IDs are 22 chars alphanumeric)
  if (!/^[a-zA-Z0-9]{22}$/.test(playlistId)) {
    return res.status(400).json({ error: 'Invalid playlist ID format' });
  }

  const account = store.getAccountById(accountId);
  if (!account) {
    return res.status(400).json({ error: 'Account not found' });
  }

  try {
    const allUris = [];
    let nextUrl = `/playlists/${playlistId}/items?limit=50`;
    let pageCount = 0;

    console.log(`[URI_EXTRACT] Starting extraction for playlist ${playlistId}, account ${accountId}`);

    // Paginate through all tracks
    while (nextUrl && pageCount < 100) {
      pageCount++;
      console.log(`[URI_EXTRACT] Fetching page ${pageCount}`);

      const playlistData = await spotify.spotifyFetch(accountId, nextUrl);

      if (!playlistData || !playlistData.items) {
        console.log(`[URI_EXTRACT] No items in response`);
        break;
      }

      // Extract URIs from each track
      for (const item of playlistData.items) {
        try {
          const track = item.track || item.item;
          
          // Skip null/unavailable tracks
          if (!track || !track.uri || track.is_local) {
            continue;
          }

          // Ensure it's a valid track URI
          if (typeof track.uri === 'string' && track.uri.startsWith('spotify:track:')) {
            allUris.push(track.uri);
          }
        } catch (err) {
          // Skip individual track errors, continue with others
          console.warn(`[URI_EXTRACT] Skipping track:`, err.message);
        }
      }

      console.log(`[URI_EXTRACT] Page ${pageCount}: found ${playlistData.items.length} items, total so far: ${allUris.length}, next URL: ${playlistData.next ? 'YES' : 'NO'}`);

      // Check for next page
      nextUrl = playlistData.next ? playlistData.next.replace('https://api.spotify.com/v1', '') : null;
      
      // Safety: if no next URL but we have items, might be end of playlist
      if (!nextUrl && playlistData.items.length > 0) {
        console.log(`[URI_EXTRACT] End of playlist reached (no next URL)`);
      }
    }

    console.log(`[URI_EXTRACT] ✅ Complete. Total URIs extracted: ${allUris.length}`);

    if (allUris.length === 0) {
      return res.status(200).json({ 
        error: 'No valid tracks found in playlist', 
        uris: [] 
      });
    }

    res.json({ uris: allUris, count: allUris.length });
  } catch (err) {
    console.error(`[URI_EXTRACT] Error:`, err.message);
    res.status(500).json({ error: err.message || 'Failed to extract URIs from playlist' });
  }
}));

// ═══════════════════════════════════════════
// S4A ANALYTICS ROUTES
// ═══════════════════════════════════════════

const s4aAnalytics = require('./s4a-analytics');
const s4aUtils = require('./s4a-utils');

/**
 * Initialize S4A session (with optional login)
 */
router.post('/api/s4a/init-session', asyncHandler(async (req, res) => {
  try {
    const session = await s4aAnalytics.getS4ASession(true);
    
    if (!session.isAuthenticated) {
      return res.status(401).json({ error: 'S4A session failed to authenticate' });
    }

    const artists = await session.getAvailableArtists();
    res.json({ 
      status: 'authenticated',
      artists,
      message: 'S4A session initialized successfully'
    });
  } catch (err) {
    console.error('[S4A] Session init failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

/**
 * Collect analytics for a specific artist
 */
router.post('/api/s4a/collect/:artistId', asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const { artistName } = req.body;

  if (!artistId || !artistName) {
    return res.status(400).json({ error: 'artistId and artistName required' });
  }

  try {
    // Create tracking job
    const jobId = s4aUtils.createCollectionJob(artistId, artistName);

    // Run in background
    (async () => {
      try {
        const session = await s4aAnalytics.getS4ASession(true);
        
        // Switch to artist
        await session.switchArtist(artistId, artistName);
        
        // Navigate to songs
        await session.navigateToSongs();
        
        // Extract metrics
        const metrics = await session.extractTrackMetrics();
        
        s4aUtils.updateCollectionJob(jobId, {
          total_tracks: metrics.length,
          processed_tracks: metrics.length
        });

        // Store in database
        const stored = s4aUtils.storeMetrics(artistId, artistName, metrics);
        
        s4aUtils.updateCollectionJob(jobId, {
          status: 'completed',
          processed_tracks: stored.length
        });

        console.log(`✅ S4A collection complete for ${artistName}: ${stored.length} tracks`);
      } catch (err) {
        console.error(`❌ S4A collection failed for ${artistName}:`, err.message);
        s4aUtils.updateCollectionJob(jobId, {
          status: 'failed',
          error_message: err.message
        });
      }
    })();

    res.json({ jobId, status: 'started', message: `Collecting metrics for ${artistName}...` });
  } catch (err) {
    console.error('[S4A] Collection request failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

/**
 * Get collection job status
 */
router.get('/api/s4a/job/:jobId', asyncHandler(async (req, res) => {
  const { jobId } = req.params;
  const job = s4aUtils.getCollectionJob(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
}));

/**
 * Get collected metrics for an artist
 */
router.get('/api/s4a/metrics/:artistId', asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const metrics = s4aUtils.getMetricsForArtist(artistId);

  res.json({
    artist_id: artistId,
    count: metrics.length,
    metrics
  });
}));

/**
 * Export metrics as CSV
 */
router.get('/api/s4a/export/:artistId/csv', asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const metrics = s4aUtils.getMetricsForArtist(artistId);

  if (metrics.length === 0) {
    return res.status(404).json({ error: 'No metrics found for this artist' });
  }

  const csv = s4aUtils.generateCSV(metrics);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="s4a-${artistId}-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
}));

/**
 * Export metrics as HTML table
 */
router.get('/api/s4a/export/:artistId/html', asyncHandler(async (req, res) => {
  const { artistId } = req.params;
  const metrics = s4aUtils.getMetricsForArtist(artistId);

  if (metrics.length === 0) {
    return res.status(404).json({ error: 'No metrics found for this artist' });
  }

  const artist = metrics[0]?.artist_name || artistId;
  const html = s4aUtils.generateHTMLTable(metrics, `S4A Analytics - ${artist}`);
  
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

/**
 * Match playlist tracks to S4A metrics
 */
router.post('/api/s4a/match-playlist', asyncHandler(async (req, res) => {
  const { playlistTracks, includeArtistIds } = req.body;

  if (!Array.isArray(playlistTracks)) {
    return res.status(400).json({ error: 'playlistTracks must be an array' });
  }

  try {
    // Collect all metrics for specified artists or all artists
    let allMetrics = [];
    
    if (includeArtistIds && Array.isArray(includeArtistIds)) {
      for (const artistId of includeArtistIds) {
        const metrics = s4aUtils.getMetricsForArtist(artistId);
        allMetrics.push(...metrics);
      }
    } else {
      // Get all metrics from database
      const stmt = require('./db').prepare('SELECT * FROM s4a_analytics');
      allMetrics = stmt.all();
    }

    const matched = s4aUtils.matchPlaylistTracksToMetrics(playlistTracks, allMetrics);
    
    res.json({
      total: playlistTracks.length,
      matched: matched.filter(t => t.streams !== undefined).length,
      tracks: matched
    });
  } catch (err) {
    console.error('[S4A] Match failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

/**
 * Close S4A session (cleanup)
 */
router.post('/api/s4a/close-session', asyncHandler(async (req, res) => {
  try {
    await s4aAnalytics.closeS4ASession();
    res.json({ status: 'closed', message: 'S4A session closed' });
  } catch (err) {
    console.error('[S4A] Close failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

// ═══════════════════════════════════════════
// S4A METRICS DATABASE API
// ═══════════════════════════════════════════

/**
 * POST /api/s4a/metrics/save
 * Save scraped S4A metrics to database (bulk or single)
 * Body: { metrics: [{ spotify_uri, artist_id, track_id, song_name, artist_name, ... }] } or single metric
 */
router.post('/api/s4a/metrics/save', asyncHandler(async (req, res) => {
  const { metrics } = req.body;
  
  if (!metrics) {
    return res.status(400).json({ error: 'metrics array or object required' });
  }
  
  try {
    const metricsArray = Array.isArray(metrics) ? metrics : [metrics];
    
    if (metricsArray.length === 0) {
      return res.status(400).json({ error: 'metrics array cannot be empty' });
    }
    
    // Validate at least one has spotify_uri
    const hasValidUri = metricsArray.some(m => m.spotify_uri);
    if (!hasValidUri) {
      return res.status(400).json({ error: 'At least one metric must have spotify_uri' });
    }
    
    // Bulk upsert with transaction
    const result = store.bulkUpsertS4AMetrics(metricsArray);
    
    res.json({
      success: true,
      inserted: result.inserted,
      errors: result.errors,
      message: `Saved ${result.inserted} metric${result.inserted !== 1 ? 's' : ''} to database`,
      errorDetails: result.errors > 0 ? result.errorDetails : undefined
    });
  } catch (err) {
    logError(err, 'POST /api/s4a/metrics/save');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * GET /api/s4a/metrics
 * Fetch all S4A metrics from database
 */
router.get('/api/s4a/metrics', asyncHandler(async (req, res) => {
  try {
    const metrics = store.getAllS4AMetrics();
    res.json({
      success: true,
      count: metrics.length,
      metrics: metrics || []
    });
  } catch (err) {
    logError(err, 'GET /api/s4a/metrics');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * GET /api/s4a/metrics/uri/:uri
 * Fetch a single S4A metric by Spotify URI
 * URI format: spotify:track:xxxxxx (must be URL encoded)
 */
router.get('/api/s4a/metrics/uri/:uri', asyncHandler(async (req, res) => {
  try {
    const uri = decodeURIComponent(req.params.uri);
    
    if (!uri.startsWith('spotify:track:')) {
      return res.status(400).json({ error: 'Invalid Spotify URI format' });
    }
    
    const metric = store.getS4AMetricByURI(uri);
    
    if (!metric) {
      return res.status(404).json({ error: 'Metric not found for URI: ' + uri });
    }
    
    res.json({
      success: true,
      metric
    });
  } catch (err) {
    logError(err, 'GET /api/s4a/metrics/uri/:uri');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * DELETE /api/s4a/metrics/uri/:uri
 * Delete a single S4A metric by Spotify URI
 */
router.delete('/api/s4a/metrics/uri/:uri', asyncHandler(async (req, res) => {
  try {
    const uri = decodeURIComponent(req.params.uri);
    
    if (!uri.startsWith('spotify:track:')) {
      return res.status(400).json({ error: 'Invalid Spotify URI format' });
    }
    
    const metric = store.getS4AMetricByURI(uri);
    if (!metric) {
      return res.status(404).json({ error: 'Metric not found for URI: ' + uri });
    }
    
    store.deleteS4AMetric(uri);
    
    res.json({
      success: true,
      message: 'Metric deleted: ' + uri
    });
  } catch (err) {
    logError(err, 'DELETE /api/s4a/metrics/uri/:uri');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * POST /api/s4a/metrics/export
 * Export S4A metrics to CSV or Excel (JSON)
 * Query params: ?format=csv or ?format=json (default: csv)
 */
router.post('/api/s4a/metrics/export', asyncHandler(async (req, res) => {
  try {
    const format = req.query.format || 'csv';
    const metrics = store.getAllS4AMetrics();
    
    if (!metrics || metrics.length === 0) {
      return res.status(404).json({ error: 'No S4A metrics to export' });
    }
    
    if (format === 'json') {
      // Export as JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="s4a-metrics-${new Date().toISOString().split('T')[0]}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        count: metrics.length,
        metrics
      });
    } else if (format === 'csv') {
      // Export as CSV
      const headers = [
        'id',
        'spotify_uri',
        'artist_id',
        'track_id',
        'song_name',
        'artist_name',
        'playlist_adds',
        'radio_streams',
        'streams_28d',
        'listeners_28d',
        'saves_28d',
        'release_date',
        'days_since_release',
        'save_ratio',
        'streams_per_listener',
        'source',
        'collected_at',
        'updated_at'
      ];
      
      const rows = metrics.map(m => [
        m.id,
        m.spotify_uri,
        m.artist_id || '',
        m.track_id || '',
        m.song_name || '',
        m.artist_name || '',
        m.playlist_adds || '',
        m.radio_streams || '',
        m.streams_28d || '',
        m.listeners_28d || '',
        m.saves_28d || '',
        m.release_date || '',
        m.days_since_release || '',
        m.save_ratio || '',
        m.streams_per_listener || '',
        m.source || '',
        m.collected_at || '',
        m.updated_at || ''
      ]);
      
      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(v => {
          // Escape CSV values that contain commas, quotes, or newlines
          const str = String(v);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(','))
      ].join('\n');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="s4a-metrics-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      res.status(400).json({ error: 'Invalid format. Use csv or json.' });
    }
  } catch (err) {
    logError(err, 'POST /api/s4a/metrics/export');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * POST /api/s4a/metrics/import
 * Import S4A metrics from CSV/JSON (bulk import)
 * Accepts multipart file upload or JSON body
 */
router.post('/api/s4a/metrics/import', asyncHandler(async (req, res) => {
  try {
    let metrics = [];
    
    // Check if JSON body
    if (req.body && Array.isArray(req.body.metrics)) {
      metrics = req.body.metrics;
    } else if (req.body && req.body.data) {
      metrics = Array.isArray(req.body.data) ? req.body.data : [req.body.data];
    } else {
      return res.status(400).json({ error: 'metrics array required in body or file' });
    }
    
    if (metrics.length === 0) {
      return res.status(400).json({ error: 'No metrics to import' });
    }
    
    // Validate each metric has at least spotify_uri
    const invalid = metrics.filter(m => !m.spotify_uri);
    if (invalid.length > 0) {
      return res.status(400).json({
        error: `${invalid.length} metrics missing spotify_uri`,
        invalidCount: invalid.length
      });
    }
    
    // Bulk import
    const result = store.bulkUpsertS4AMetrics(metrics);
    
    res.json({
      success: true,
      imported: result.inserted,
      errors: result.errors,
      message: `Imported ${result.inserted} metric${result.inserted !== 1 ? 's' : ''} from file`,
      errorDetails: result.errors > 0 ? result.errorDetails : undefined
    });
  } catch (err) {
    logError(err, 'POST /api/s4a/metrics/import');
    res.status(500).json({ error: err.message });
  }
}));

/**
 * GET /api/s4a/metrics/stats
 * Get aggregate statistics for S4A metrics (summary stats)
 */
router.get('/api/s4a/metrics/stats', asyncHandler(async (req, res) => {
  try {
    const metrics = store.getAllS4AMetrics();
    
    if (!metrics || metrics.length === 0) {
      return res.json({
        success: true,
        count: 0,
        stats: {}
      });
    }
    
    // Calculate aggregate stats
    const stats = {
      totalMetrics: metrics.length,
      totalStreams: metrics.reduce((sum, m) => sum + (m.streams_28d || 0), 0),
      totalListeners: metrics.reduce((sum, m) => sum + (m.listeners_28d || 0), 0),
      totalSaves: metrics.reduce((sum, m) => sum + (m.saves_28d || 0), 0),
      totalPlaylistAdds: metrics.reduce((sum, m) => sum + (m.playlist_adds || 0), 0),
      totalRadioStreams: metrics.reduce((sum, m) => sum + (m.radio_streams || 0), 0),
      avgStreams: 0,
      avgListeners: 0,
      avgSaveRatio: 0,
      avgStreamsPerListener: 0,
      topTrack: null,
      oldestMetric: null,
      newestMetric: null
    };
    
    // Calculate averages
    const metricsWithStreams = metrics.filter(m => m.streams_28d);
    const metricsWithListeners = metrics.filter(m => m.listeners_28d);
    const metricsWithSaveRatio = metrics.filter(m => m.save_ratio);
    const metricsWithSPL = metrics.filter(m => m.streams_per_listener);
    
    if (metricsWithStreams.length > 0) {
      stats.avgStreams = Math.round(stats.totalStreams / metricsWithStreams.length);
    }
    if (metricsWithListeners.length > 0) {
      stats.avgListeners = Math.round(stats.totalListeners / metricsWithListeners.length);
    }
    if (metricsWithSaveRatio.length > 0) {
      stats.avgSaveRatio = metricsWithSaveRatio.reduce((sum, m) => sum + (m.save_ratio || 0), 0) / metricsWithSaveRatio.length;
    }
    if (metricsWithSPL.length > 0) {
      stats.avgStreamsPerListener = metricsWithSPL.reduce((sum, m) => sum + (m.streams_per_listener || 0), 0) / metricsWithSPL.length;
    }
    
    // Find top track (by streams)
    const topTrack = metrics.reduce((prev, curr) => {
      const prevStreams = prev.streams_28d || 0;
      const currStreams = curr.streams_28d || 0;
      return currStreams > prevStreams ? curr : prev;
    });
    stats.topTrack = topTrack;
    
    // Find oldest and newest
    const sortedByDate = metrics.sort((a, b) => new Date(a.collected_at) - new Date(b.collected_at));
    stats.oldestMetric = sortedByDate[0];
    stats.newestMetric = sortedByDate[sortedByDate.length - 1];
    
    res.json({
      success: true,
      stats
    });
  } catch (err) {
    logError(err, 'GET /api/s4a/metrics/stats');
    res.status(500).json({ error: err.message });
  }
}));

// ═══════════════════════════════════════════════════════════════
// S4A SCRAPER ORCHESTRATION ROUTES (BATCH PROCESSING)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/s4a/artists
 * List available artists from the label roster (hardcoded)
 * Returns: { total, artists: [{ id, name, spotifyId }], timestamp }
 */
router.get('/api/s4a/artists', asyncHandler(async (req, res) => {
  try {
    const { ARTIST_ROSTER } = require('./s4a-analytics');
    
    const artists = ARTIST_ROSTER.map(artist => ({
      id: artist.id,
      name: artist.name,
      spotifyId: artist.id
    }));

    res.json({
      total: artists.length,
      artists,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[S4A] Get artists failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

/**
 * POST /api/s4a/scrape
 * Main scraper endpoint - launches S4A data collection with SSE progress streaming
 * 
 * Request body:
 * {
 *   "playlistUrls": ["https://open.spotify.com/playlist/...", ...],
 *   "artistIds": ["spotify-artist-id-1", ...],
 *   "accountId": "spotify-account-id",
 *   "sessionId": "optional-session-id-for-streaming"
 * }
 * 
 * Returns: Server-Sent Events stream with progress updates
 * Event types: init, progress, result, error, complete
 */
router.post('/api/s4a/scrape', asyncHandler(async (req, res) => {
  const { playlistUrls = [], artistIds = [], accountId } = req.body;
  const sessionId = req.body.sessionId || uuidv4();

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const startTime = Date.now();
  const sendSSE = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendSSE({
      type: 'init',
      sessionId,
      message: 'Scraper session initialized',
      timestamp: new Date().toISOString()
    });

    // Parse playlist URLs to extract playlist IDs
    const playlistIds = playlistUrls.map(url => {
      const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }).filter(Boolean);

    sendSSE({
      type: 'progress',
      status: 'Parsing URLs',
      current: 0,
      total: artistIds.length,
      message: `Found ${playlistIds.length} playlists and ${artistIds.length} artists to scrape`,
      timestamp: new Date().toISOString()
    });

    // Initialize S4A session
    const session = await s4aAnalytics.getS4ASession(true);
    sendSSE({
      type: 'progress',
      status: 'Session initialized',
      current: 0,
      total: artistIds.length,
      message: 'S4A browser session started',
      timestamp: new Date().toISOString()
    });

    const allResults = [];
    const errors = [];

    // Process each artist
    for (let i = 0; i < artistIds.length; i++) {
      const artistId = artistIds[i];
      const artist = s4aAnalytics.ARTIST_ROSTER.find(a => a.id === artistId);
      const artistName = artist ? artist.name : `Artist ${artistId}`;

      try {
        sendSSE({
          type: 'progress',
          status: `Collecting metrics for ${artistName}`,
          current: i,
          total: artistIds.length,
          artistId,
          artistName,
          message: `Switching to artist and navigating to songs...`,
          timestamp: new Date().toISOString()
        });

        // Switch to artist
        await session.switchArtist(artistId, artistName);
        
        // Navigate to songs section
        await session.navigateToSongs();

        sendSSE({
          type: 'progress',
          status: `Extracting metrics for ${artistName}`,
          current: i,
          total: artistIds.length,
          artistId,
          artistName,
          message: `Extracting track data...`,
          timestamp: new Date().toISOString()
        });

        // Extract track metrics
        const metrics = await session.extractTrackMetrics();

        sendSSE({
          type: 'progress',
          status: `Processing metrics for ${artistName}`,
          current: i + 1,
          total: artistIds.length,
          artistId,
          artistName,
          tracksFound: metrics.length,
          message: `Found ${metrics.length} tracks`,
          timestamp: new Date().toISOString()
        });

        // Store in database
        const stored = s4aUtils.storeMetrics(artistId, artistName, metrics);
        allResults.push(...stored);

        sendSSE({
          type: 'result',
          artistId,
          artistName,
          tracksProcessed: metrics.length,
          tracksStored: stored.length,
          sampleTracks: metrics.slice(0, 3).map(t => ({
            name: t.name,
            streams: t.streams,
            listeners: t.listeners
          }))
        });

      } catch (artistErr) {
        const errMsg = `Failed to process artist ${artistName}: ${artistErr.message}`;
        console.error('[S4A]', errMsg);
        errors.push({ artistId, artistName, error: artistErr.message });
        
        sendSSE({
          type: 'error',
          artistId,
          artistName,
          error: errMsg,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Cleanup
    try {
      await s4aAnalytics.closeS4ASession();
    } catch (closeErr) {
      console.warn('[S4A] Warning: could not close session cleanly:', closeErr.message);
    }

    // Final completion message
    const duration = Math.round((Date.now() - startTime) / 1000);
    sendSSE({
      type: 'complete',
      sessionId,
      totalProcessed: allResults.length,
      errors: errors.length,
      errorDetails: errors,
      downloadUrls: {
        csv: `/api/s4a/download/csv?sessionId=${sessionId}`,
        excel: `/api/s4a/download/excel?sessionId=${sessionId}`
      },
      message: `Scraping complete: ${allResults.length} tracks collected`,
      timestamp: new Date().toISOString(),
      duration
    });

    res.end();

  } catch (err) {
    console.error('[S4A] Scrape failed:', err.message);
    sendSSE({
      type: 'error',
      error: `Fatal error: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      timestamp: new Date().toISOString()
    });
    
    try {
      await s4aAnalytics.closeS4ASession();
    } catch (closeErr) {
      console.warn('[S4A] Could not close session:', closeErr.message);
    }
    
    res.end();
  }
}));

/**
 * POST /api/s4a/download/csv
 * Export S4A metrics to CSV file
 * 
 * Request body:
 * {
 *   "sessionId": "session-id-from-scrape",
 *   "artistId": "optional-filter-by-artist",
 *   "results": "optional-raw-results-array"
 * }
 */
router.post('/api/s4a/download/csv', asyncHandler(async (req, res) => {
  const { sessionId, artistId, results: rawResults } = req.body;

  try {
    let metrics = [];

    // If raw results provided, use those
    if (Array.isArray(rawResults)) {
      metrics = rawResults;
    } 
    // If artist ID provided, fetch from database
    else if (artistId) {
      metrics = s4aUtils.getMetricsForArtist(artistId);
    }
    // Otherwise get all metrics
    else {
      const db = require('./db');
      const stmt = db.prepare('SELECT * FROM s4a_analytics ORDER BY artist_name, streams DESC');
      metrics = stmt.all();
    }

    if (metrics.length === 0) {
      return res.status(404).json({ error: 'No metrics found to export' });
    }

    // Generate CSV
    const csv = s4aUtils.generateCSV(metrics);

    // Set response headers for download
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `s4a-metrics-${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (err) {
    console.error('[S4A] CSV export failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));

/**
 * POST /api/s4a/download/excel
 * Export S4A metrics to Excel (.xlsx) file with formatting
 * 
 * Request body:
 * {
 *   "sessionId": "session-id-from-scrape",
 *   "artistId": "optional-filter-by-artist",
 *   "results": "optional-raw-results-array"
 * }
 */
router.post('/api/s4a/download/excel', asyncHandler(async (req, res) => {
  const { sessionId, artistId, results: rawResults } = req.body;

  try {
    let metrics = [];

    // If raw results provided, use those
    if (Array.isArray(rawResults)) {
      metrics = rawResults;
    }
    // If artist ID provided, fetch from database
    else if (artistId) {
      metrics = s4aUtils.getMetricsForArtist(artistId);
    }
    // Otherwise get all metrics
    else {
      const db = require('./db');
      const stmt = db.prepare('SELECT * FROM s4a_analytics ORDER BY artist_name, streams DESC');
      metrics = stmt.all();
    }

    if (metrics.length === 0) {
      return res.status(404).json({ error: 'No metrics found to export' });
    }

    // Generate Excel file using exceljs
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('S4A Analytics');

    // Set up columns
    const columns = [
      { header: 'Song', key: 'track_name', width: 30 },
      { header: 'Artist', key: 'artist_name', width: 20 },
      { header: 'Released', key: 'released_date', width: 12 },
      { header: 'Days Since', key: 'days_since_release', width: 12 },
      { header: 'Streams', key: 'streams', width: 15, numFmt: '#,##0' },
      { header: 'Listeners', key: 'listeners', width: 15, numFmt: '#,##0' },
      { header: 'Saves', key: 'saves', width: 12, numFmt: '#,##0' },
      { header: 'Save Ratio', key: 'save_ratio', width: 12, numFmt: '0.00%' },
      { header: 'Radio Streams', key: 'radio_streams', width: 15, numFmt: '#,##0' },
      { header: '% Radio', key: 'radio_percentage', width: 12, numFmt: '0.00%' },
      { header: 'Playlists Added', key: 'playlist_adds', width: 15, numFmt: '#,##0' },
      { header: 'S/L Ratio', key: 'streams_per_listener', width: 12, numFmt: '0.00' },
      { header: 'Impressions', key: 'impressions', width: 15, numFmt: '#,##0' },
      { header: 'Reach', key: 'reach', width: 12, numFmt: '#,##0' },
      { header: 'Engagement', key: 'engagement', width: 12, numFmt: '#,##0' },
      { header: 'Source', key: 'source', width: 20 },
      { header: 'Collected', key: 'collected_at', width: 20 }
    ];

    worksheet.columns = columns;

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1DB954' } // Spotify green
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'center' };

    // Add data rows
    for (const metric of metrics) {
      worksheet.addRow({
        track_name: metric.track_name || 'N/A',
        artist_name: metric.artist_name || 'N/A',
        released_date: metric.released_date || 'N/A',
        days_since_release: metric.days_since_release || '-',
        streams: metric.streams || 0,
        listeners: metric.listeners || 0,
        saves: metric.saves || 0,
        save_ratio: metric.save_ratio ? parseFloat(metric.save_ratio) : null,
        radio_streams: metric.radio_streams || 0,
        radio_percentage: metric.radio_percentage || 0,
        playlist_adds: metric.playlist_adds || 0,
        streams_per_listener: metric.streams_per_listener || null,
        impressions: metric.impressions || 0,
        reach: metric.reach || 0,
        engagement: metric.engagement || 0,
        source: metric.source || 'spotify_for_artists_session',
        collected_at: metric.collected_at ? new Date(metric.collected_at).toLocaleString() : ''
      });
    }

    // Apply alternating row colors
    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      if (i % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF5F5F5' }
        };
      }
    }

    // Freeze header row
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Set response headers
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `s4a-metrics-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);

  } catch (err) {
    console.error('[S4A] Excel export failed:', err.message);
    res.status(500).json({ error: err.message });
  }
}));


// ═══════════════════════════════════════════════════════════════════════════════
// S4A FAST SCRAPER ENDPOINT (Proven, Optimized)
// ═══════════════════════════════════════════════════════════════════════════════

const fastWrapper = require('./s4a-fast-wrapper');

/**
 * POST /api/s4a/scrape-enrich
 * 
 * Enrich selected tracks from metrics table with S4A data using PROVEN fast scraper.
 * Only 1 page navigation per song instead of 3 (uses internal Spotify API).
 * 
 * Body: {
 *   track_ids?: string[] - Array of track IDs from song_metrics table
 *   urls?: string[] - Array of S4A song URLs
 * }
 * 
 * Returns: SSE stream with progress
 */
router.post('/api/s4a/scrape-enrich', asyncHandler(async (req, res) => {
  const { track_ids, urls } = req.body;
  
  // Validate input
  if ((!track_ids || track_ids.length === 0) && (!urls || urls.length === 0)) {
    return res.status(400).json({ 
      error: 'Either track_ids (from metrics table) or urls (S4A URLs) required' 
    });
  }
  
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };
  
  try {
    // Determine URLs to scrape
    let urlsToScrape = urls || [];
    
    if (urlsToScrape.length === 0) {
      send('error', { message: 'No valid URLs to scrape' });
      res.end();
      return;
    }
    
    send('progress', { 
      message: `Starting scrape of ${urlsToScrape.length} songs...`,
      current: 0,
      total: urlsToScrape.length,
      percentage: 0
    });
    
    // Start the PROVEN fast scraper
    fastWrapper.startFastScraper(
      urlsToScrape,
      // onProgress callback
      (progress) => {
        send('progress', {
          current: progress.current,
          total: progress.total,
          percentage: progress.percentage,
          message: `Processing: ${progress.message}`
        });
      },
      // onLog callback
      (log) => {
        send('log', {
          message: log.message,
          level: log.level
        });
      },
      // onComplete callback
      (result) => {
        if (result.success && result.results.length > 0) {
          send('progress', { 
            message: `Saving ${result.results.length} results to database...`,
            current: result.results.length,
            total: result.results.length,
            percentage: 100
          });
          
          // Save to song_metrics table
          fastWrapper.saveResultsToMetrics(result.results, (saveResult) => {
            send('complete', {
              message: `✅ Enriched ${saveResult.saved} songs`,
              saved: saveResult.saved,
              total: saveResult.total,
              skipped: saveResult.skipped
            });
            
            res.end();
          });
        } else {
          send('error', { 
            message: 'Scraping failed or no results returned'
          });
          res.end();
        }
      },
      // onError callback
      (error) => {
        send('error', { message: error });
      }
    );
    
  } catch (err) {
    console.error('[S4A-ENRICH] Error:', err);
    send('error', { message: err.message });
    res.end();
  }
}));


module.exports = router;
