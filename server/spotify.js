const store = require('./store');

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const REDIRECT_URI = 'http://127.0.0.1:3000/auth/spotify/callback';
const SCOPES = 'playlist-read-private playlist-modify-public playlist-modify-private user-read-private user-read-email';

// Per-account app credentials mapping (email -> {clientId, clientSecret})
const ACCOUNT_APPS = {
  'info@spitzaura.io':              { clientId: '05205d8fa31c4e9489523bc8957e6ee1', clientSecret: '542ba7526480423cad56417b559925d6' },
  'ax2.records@gmail.com':          { clientId: '059f19f069bc4bbc8ce26ca3145fde21', clientSecret: '14ca28837aa14fdfa4879a4479fd9111' },
  'spitzaura96@gmail.com':          { clientId: 'c96f6edfcefb428e897c8c9f6a3116c7', clientSecret: '17913a9ea04b4fbcb20a2a7f6d2b0ec9' },
  'dupontsebastien388@gmail.com':   { clientId: '3857f499477c4829b29f0b3aed56c571', clientSecret: '6fd1cf37865d44febf86ae718ed033e4' },
  'unmodernized.submissions@gmail.com': { clientId: '0f0b4ac87f8544289fecff6934d509bb', clientSecret: '12a273192d854153b5203d2678c54986' },
  'chowchowrecords96@gmail.com':    { clientId: '479651d2f5e04f6298286afae658c3ef', clientSecret: '4649faa186594e48855146daa021a8dc' },
  'chowchowrecords.submissions@gmail.com': { clientId: '87b37d5181f541489dbf38f2d9598737', clientSecret: '7e12339281f14e37acc0864ca96bf6da' },
};

// Default app (for OAuth login flow + accounts not in the map)
const DEFAULT_APP = {
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
};

// Get the app credentials for a specific account
function getAppForAccount(accountId) {
  const account = store.getAccountById(accountId);
  if (account && account.email && ACCOUNT_APPS[account.email]) {
    return ACCOUNT_APPS[account.email];
  }
  return DEFAULT_APP;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Get a valid access token for an account
// CRITICAL: Use the SAME APP that issued the token (stored in auth_app_key)
async function getValidToken(accountId) {
  const account = store.getAccountById(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  const nowMs = Date.now();
  const refreshThresholdMs = 5 * 60 * 1000; // 5 minutes
  const expiresInMs = account.token_expires_at - nowMs;
  const needsRefresh = expiresInMs < refreshThresholdMs;

  console.log(`[TOKEN] Account: ${account.display_name} | Email: ${account.email} | Auth Key: ${account.auth_app_key || 'null'} | Expires in: ${Math.floor(expiresInMs / 1000)}s | Needs Refresh: ${needsRefresh}`);

  // Refresh if token expires within 5 minutes
  if (needsRefresh) {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refresh_token,
    });

    // Get the app that was used for THIS account's auth
    const appKey = account.auth_app_key || 'default';
    let appCredentials;
    let appSource = 'DEFAULT_APP';
    
    if (appKey === 'default') {
      appCredentials = DEFAULT_APP;
    } else if (ACCOUNT_APPS[appKey]) {
      appCredentials = ACCOUNT_APPS[appKey];
      appSource = `ACCOUNT_APPS[${appKey}]`;
    } else {
      // Fallback: try to use email as key
      appCredentials = ACCOUNT_APPS[account.email] || DEFAULT_APP;
      appSource = account.email && ACCOUNT_APPS[account.email] ? `ACCOUNT_APPS[${account.email}]` : 'DEFAULT_APP (fallback)';
      console.log(`[TOKEN] ⚠️ Auth key '${appKey}' not found in ACCOUNT_APPS, trying email: ${appSource}`);
    }
    
    console.log(`[TOKEN] 🔄 Refreshing token using: ${appSource} (clientId: ${appCredentials.clientId.substring(0, 8)}...)`);

    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${appCredentials.clientId}:${appCredentials.clientSecret}`
        ).toString('base64'),
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`[TOKEN] ❌ FAILED: Status ${response.status} | Account: ${account.display_name} | Source: ${appSource}`);
      console.error(`[TOKEN] Error response: ${err}`);
      throw new Error(`Token refresh failed for ${account.display_name}: ${err}`);
    }

    const data = await response.json();
    const expiresAt = Date.now() + (data.expires_in * 1000);
    console.log(`[TOKEN] ✅ Success for ${account.display_name} via ${appSource} | New expiry: ${data.expires_in}s from now`);
    
    store.updateTokens(
      account.id,
      data.access_token,
      data.refresh_token || account.refresh_token,
      expiresAt
    );

    return data.access_token;
  }

  return account.access_token;
}

// Make an authenticated Spotify API call
async function spotifyFetch(accountId, endpoint, options = {}) {
  const token = await getValidToken(accountId);
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  // Handle rate limiting — track when accounts are blocked
  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get('retry-after') || '3', 10);
    const rateLimitKey = `rate_limit_${accountId}`;
    store.setCache(rateLimitKey, { blockedUntil: Date.now() + (retryAfter * 1000) }, Math.ceil(retryAfter / 60));
    
    if (retryAfter > 60) {
      throw new Error(`Rate limited for ${retryAfter}s — too long, skipping`);
    }
    console.log(`Rate limited (account ${accountId}), waiting ${retryAfter}s...`);
    await delay(retryAfter * 1000);
    return spotifyFetch(accountId, endpoint, options);
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Spotify API error: ${response.status} for account=${accountId} endpoint=${url}`);
    console.error(`Response: ${errText}`);
    throw new Error(`Spotify API error ${response.status}: ${errText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// Get all tracks from a playlist (handles pagination)
async function getAllPlaylistTracks(accountId, playlistId) {
  const tracks = [];
  let url = `/playlists/${playlistId}/items?limit=100`;

  while (url) {
    const data = await spotifyFetch(accountId, url);
    for (const entry of data.items) {
      const track = entry.item || entry.track;
      if (track && track.uri) {
        tracks.push(track.uri);
      }
    }
    url = data.next || null;
    if (url) await delay(200);
  }

  return tracks;
}

// Get playlists for an account
async function getAccountPlaylists(accountId) {
  const playlists = [];
  let url = '/me/playlists?limit=50';

  while (url) {
    const data = await spotifyFetch(accountId, url);
    if (!data || !data.items) break;
    for (const pl of data.items) {
      if (!pl) continue;
      playlists.push({
        id: pl.id,
        name: pl.name,
        owner: pl.owner?.display_name || 'Unknown',
        trackCount: pl.tracks?.total || 0,
        image: pl.images?.[0]?.url || null,
      });
    }
    url = data.next || null;
    if (url) await delay(200);
  }

  return playlists;
}

// Detect duplicate track URIs in a list
function findDuplicates(trackUris) {
  const seen = {};
  const duplicates = {};
  for (const uri of trackUris) {
    seen[uri] = (seen[uri] || 0) + 1;
    if (seen[uri] > 1) {
      duplicates[uri] = seen[uri];
    }
  }
  return duplicates;
}

// Check if account is currently rate limited
function isAccountRateLimited(accountId) {
  const rateLimitKey = `rate_limit_${accountId}`;
  const cached = store.getCache(rateLimitKey);
  if (!cached) return false;
  const isBlocked = cached.blockedUntil > Date.now();
  if (!isBlocked) {
    store.clearCache(rateLimitKey); // Clear expired block
  }
  return isBlocked;
}

// Get list of available (non-rate-limited) accounts
function getAvailableAccounts() {
  const allAccounts = store.getAllAccounts();
  return allAccounts.filter(acc => !isAccountRateLimited(acc.id));
}

// Sync: nuke all child tracks, re-add from master (fresh "just added" dates)
// Each account uses its own Client ID = its own rate limit
async function syncGroup(groupId, { onProgress, childIds } = {}) {
  const group = store.getGroupById(groupId);
  if (!group) throw new Error('Group not found');
  if (!group.master_playlist_id || !group.master_account_id) {
    throw new Error('Group has no master playlist configured');
  }
  if (!group.children || group.children.length === 0) {
    throw new Error('Group has no child playlists');
  }
  
  // Check if any accounts are available (not rate limited)
  const availableAccounts = getAvailableAccounts();
  if (availableAccounts.length === 0) {
    throw new Error('All Spotify accounts are rate-limited. Please wait ~24 hours and try again.');
  }
  console.log(`Available accounts for sync: ${availableAccounts.length}/${store.getAllAccounts().length}`);

  // Filter children if childIds provided
  const childrenToSync = childIds && childIds.length > 0
    ? group.children.filter(c => childIds.includes(c.id))
    : group.children;

  if (childrenToSync.length === 0) {
    throw new Error('No matching child playlists to sync');
  }

  // Get master tracks (try with master account first, then fallback to other accounts if rate limited)
  let masterTracks;
  let fetchAccountId = group.master_account_id;
  
  try {
    masterTracks = await getAllPlaylistTracks(group.master_account_id, group.master_playlist_id);
  } catch (err) {
    if (err.message.includes('Rate limited')) {
      console.log(`Rate limited on master account, trying with other accounts...`);
      const allAccounts = store.getAllAccounts();
      for (const account of allAccounts) {
        if (account.id === group.master_account_id) continue; // Skip master
        try {
          masterTracks = await getAllPlaylistTracks(account.id, group.master_playlist_id);
          fetchAccountId = account.id;
          console.log(`Successfully fetched master tracks with fallback account: ${account.email}`);
          break;
        } catch (e) {
          continue;
        }
      }
    }
    if (!masterTracks) throw err;
  }
  
  console.log(`Syncing group "${group.name}": ${masterTracks.length} master tracks → ${childrenToSync.length} children (fetched with account: ${fetchAccountId})`);

  // Cache the master playlist tracks (24-hour TTL to avoid unnecessary API calls)
  const masterCacheKey = `sync_cache_${group.master_playlist_id}`;
  store.setCache(masterCacheKey, {
    trackUris: masterTracks,
    trackCount: masterTracks.length,
    cachedAt: new Date().toISOString(),
    image: null,
  }, 1440); // 24 hours

  // Check for duplicates
  const duplicates = findDuplicates(masterTracks);
  const hasDuplicates = Object.keys(duplicates).length > 0;

  if (onProgress) {
    onProgress({ type: 'start', total: childrenToSync.length, masterTrackCount: masterTracks.length, hasDuplicates });
  }

  const results = [];
  let completedCount = 0;

  // Sync children in parallel per-account (each account has its own rate limit)
  // Group children by account
  const childrenByAccount = {};
  for (const child of childrenToSync) {
    if (!childrenByAccount[child.account_id]) {
      childrenByAccount[child.account_id] = [];
    }
    childrenByAccount[child.account_id].push(child);
  }

  // Process each account's children in parallel
  const accountPromises = Object.entries(childrenByAccount).map(async ([accountId, children]) => {
    for (const child of children) {
      try {
        console.log(`  Syncing: ${child.playlist_name} (${child.account_name})`);

        // Get current child tracks
        const childTracks = await getAllPlaylistTracks(child.account_id, child.playlist_id);

        // Step 1: Remove ALL existing tracks
        if (childTracks.length > 0) {
          for (let i = 0; i < childTracks.length; i += 100) {
            const batch = childTracks.slice(i, i + 100);
            if (batch.length === 0) continue;
            await spotifyFetch(child.account_id, `/playlists/${child.playlist_id}/items`, {
              method: 'DELETE',
              body: JSON.stringify({
                items: batch.map(uri => ({ uri })),
              }),
            });
            await delay(300);
          }
        }

        // Step 2: Add ALL master tracks (preserves master order)
        if (masterTracks.length > 0) {
          for (let i = 0; i < masterTracks.length; i += 100) {
            const batch = masterTracks.slice(i, i + 100);
            if (batch.length === 0) continue;
            await spotifyFetch(child.account_id, `/playlists/${child.playlist_id}/items`, {
              method: 'POST',
              body: JSON.stringify({ uris: batch }),
            });
            await delay(300);
          }
        }

        console.log(`  ✅ ${child.playlist_name}: removed ${childTracks.length}, added ${masterTracks.length}`);

        // Update last_synced_at and track_count
        store.updateChildLastSynced(child.id, masterTracks.length);

        // Cache the synced track list (1-hour TTL) — avoids API calls on quick-scan
        const cacheKey = `sync_cache_${child.playlist_id}`;
        store.setCache(cacheKey, {
          trackUris: masterTracks,
          trackCount: masterTracks.length,
          cachedAt: new Date().toISOString(),
          image: null,
        }, 60);

        const result = {
          playlist: child.playlist_name,
          childId: child.id,
          account: child.account_name,
          added: masterTracks.length,
          removed: childTracks.length,
          status: 'success',
        };
        results.push(result);
        completedCount++;

        if (onProgress) {
          onProgress({ type: 'child_done', completed: completedCount, total: childrenToSync.length, result });
        }

        // Small delay between playlists on the same account
        await delay(1000);

      } catch (err) {
        console.error(`  ❌ ${child.playlist_name}: ${err.message}`);
        const result = {
          playlist: child.playlist_name,
          childId: child.id,
          account: child.account_name,
          error: err.message,
          status: 'error',
        };
        results.push(result);
        completedCount++;

        if (onProgress) {
          onProgress({ type: 'child_done', completed: completedCount, total: childrenToSync.length, result });
        }
      }
    }
  });

  // Wait for all accounts to finish
  await Promise.all(accountPromises);

  console.log(`Sync complete: ${results.filter(r => r.status === 'success').length}/${results.length} succeeded`);

  const allSuccess = results.every(r => r.status === 'success');
  store.addSyncLog(groupId, allSuccess ? 'success' : 'partial', JSON.stringify(results));

  if (onProgress) {
    onProgress({ type: 'complete', results });
  }

  return results;
}

// Get app by key (email-based key or 'default')
function getAppByKey(appKey) {
  if (!appKey || appKey === 'default') return DEFAULT_APP;
  for (const [email, app] of Object.entries(ACCOUNT_APPS)) {
    if (email === appKey || email.split('@')[0] === appKey) return app;
  }
  return DEFAULT_APP;
}

// Build the OAuth authorization URL
function getAuthUrl(state, appKey, loginHint = null) {
  const app = getAppByKey(appKey);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state,
    show_dialog: 'true',
  });
  
  // Pre-fill email if provided (appKey is usually the email for re-auth)
  if (loginHint || (appKey && appKey.includes('@'))) {
    params.append('login_hint', loginHint || appKey);
  }
  
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

// Exchange auth code for tokens
async function exchangeCode(code, appKey) {
  const app = getAppByKey(appKey);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(
        `${app.clientId}:${app.clientSecret}`
      ).toString('base64'),
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return response.json();
}

// Get duplicates in a group's master playlist
async function getMasterDuplicates(groupId) {
  const group = store.getGroupById(groupId);
  if (!group || !group.master_playlist_id || !group.master_account_id) {
    return { duplicates: {}, trackNames: {} };
  }
  const masterTracks = await getAllPlaylistTracks(group.master_account_id, group.master_playlist_id);
  const duplicates = findDuplicates(masterTracks);

  // Fetch track names for duplicates if any
  const trackNames = {};
  const dupUris = Object.keys(duplicates);
  if (dupUris.length > 0) {
    const trackIds = dupUris.map(uri => uri.replace('spotify:track:', ''));
    // Fetch in batches of 50
    for (let i = 0; i < trackIds.length; i += 50) {
      const batch = trackIds.slice(i, i + 50);
      try {
        const data = await spotifyFetch(group.master_account_id, `/tracks?ids=${batch.join(',')}`);
        if (data && data.tracks) {
          for (const track of data.tracks) {
            if (track) {
              trackNames[`spotify:track:${track.id}`] = `${track.name} — ${track.artists?.map(a => a.name).join(', ')}`;
            }
          }
        }
      } catch (e) {
        console.error('Error fetching track names for duplicates:', e.message);
      }
    }
  }

  return { duplicates, trackNames };
}

// Add tracks to a playlist (used by trades)
async function addTracksToPlaylist(accountId, playlistId, trackUris, position) {
  const results = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    if (batch.length === 0) continue;
    
    // If position is specified, add all tracks at that position
    // Spotify inserts at the specified position, shifting others down
    const body = { uris: batch };
    if (position !== undefined && position >= 0) {
      body.position = position;
    }
    
    await spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    results.push(...batch);
    await delay(300);
  }
  return results;
}

// Remove specific tracks from a playlist (used by trades)
async function removeTracksFromPlaylist(accountId, playlistId, trackUris) {
  const results = [];
  for (let i = 0; i < trackUris.length; i += 100) {
    const batch = trackUris.slice(i, i + 100);
    if (batch.length === 0) continue;
    await spotifyFetch(accountId, `/playlists/${playlistId}/items`, {
      method: 'DELETE',
      body: JSON.stringify({
        tracks: batch.map(uri => ({ uri })),
      }),
    });
    results.push(...batch);
    await delay(300);
  }
  return results;
}

// Run trade cleanup — find expired trades, remove tracks, update status
async function cleanupExpiredTrades() {
  const expired = store.getExpiredActiveTrades();
  const results = [];

  for (const trade of expired) {
    const trackUris = JSON.parse(trade.track_uris);
    const tradeResults = { tradeId: trade.id, name: trade.name, playlists: [], totalRemoved: 0 };

    // 🔥 CHANGE: Remove from ALL playlists where tracks appear, not just the 2 in the trade
    try {
      const allPlaylists = await findTrackInPlaylists(trackUris[0]); // Get sample to find all locations
      const uniquePlaylists = new Map();

      // Get ALL playlists containing ANY of the tracks
      for (const trackUri of trackUris) {
        const found = await findTrackInPlaylists(trackUri);
        for (const item of found) {
          const key = `${item.accountId}:${item.playlistId}`;
          uniquePlaylists.set(key, item);
        }
      }

      console.log(`Trade ${trade.id} expired: removing from ${uniquePlaylists.size} total playlists`);

      // Remove from all found playlists
      for (const [key, item] of uniquePlaylists.entries()) {
        try {
          await removeTracksFromPlaylist(item.accountId, item.playlistId, trackUris);
          tradeResults.playlists.push({ 
            playlistId: item.playlistId, 
            playlistName: item.playlistName,
            status: 'success', 
            removed: trackUris.length 
          });
          tradeResults.totalRemoved += trackUris.length;
        } catch (err) {
          console.error(`Trade cleanup error for ${trade.id} playlist ${item.playlistId}:`, err.message);
          tradeResults.playlists.push({ 
            playlistId: item.playlistId, 
            playlistName: item.playlistName,
            status: 'error', 
            error: err.message 
          });
        }
      }
    } catch (err) {
      console.error(`Trade ${trade.id} cleanup failed:`, err.message);
      tradeResults.playlists.push({ status: 'error', error: 'Cleanup failed: ' + err.message });
    }

    store.updateTradeStatus(trade.id, 'expired');
    results.push(tradeResults);
  }

  return results;
}

// Get track info from Spotify API
async function getTrackInfo(accountId, trackId) {
  const data = await spotifyFetch(accountId, `/tracks/${trackId}`);
  return {
    id: data.id,
    uri: data.uri,
    name: data.name,
    artists: data.artists?.map(a => a.name).join(', ') || 'Unknown',
    album: data.album?.name || '',
    image: data.album?.images?.[0]?.url || null,
    duration_ms: data.duration_ms,
    popularity: data.popularity,
  };
}

// Scan all playlists across all accounts for a specific track URI
async function findTrackInPlaylists(trackUri) {
  const accounts = store.getAllAccounts();
  const found = [];

  for (const account of accounts) {
    try {
      // Timeout per account: 30 seconds
      const accountPromise = (async () => {
        const playlists = await getAccountPlaylists(account.id);
        for (const pl of playlists) {
          try {
            const tracks = await getAllPlaylistTracks(account.id, pl.id);
            if (tracks.includes(trackUri)) {
              found.push({
                accountId: account.id,
                accountName: account.display_name || account.email,
                playlistId: pl.id,
                playlistName: pl.name,
                trackCount: pl.trackCount,
                image: pl.image,
              });
            }
          } catch (err) {
            // Skip playlists we can't read
          }
          await delay(100);
        }
      })();

      // Race against 30 second timeout
      await Promise.race([
        accountPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
      ]);
    } catch (err) {
      console.warn(`Scan skipping ${account.display_name || account.email}: ${err.message}`);
      // Continue to next account instead of crashing
    }
  }

  return found;
}

// ═══════════════════════════════════════════
// PROACTIVE TOKEN REFRESH (KEEPS ACCOUNTS ALIVE)
// ═══════════════════════════════════════════

async function refreshAllTokens() {
  console.log(`[CRON] 🔄 Starting proactive token refresh for all accounts...`);
  const accounts = store.getAllAccounts();
  
  let refreshed = 0;
  let failed = 0;
  const results = [];

  for (const account of accounts) {
    if (!account.email) continue; // Skip dummy accounts
    
    try {
      const token = await getValidToken(account.id);
      refreshed++;
      console.log(`[CRON] ✅ Refreshed: ${account.display_name}`);
      results.push({ account: account.display_name, status: 'success' });
    } catch (err) {
      failed++;
      console.error(`[CRON] ❌ Failed: ${account.display_name} — ${err.message}`);
      results.push({ account: account.display_name, status: 'failed', error: err.message });
    }
    
    // Small delay between refreshes to avoid hammering Spotify
    await delay(200);
  }

  console.log(`[CRON] 📊 Token refresh complete: ${refreshed} success, ${failed} failed`);
  return { refreshed, failed, results };
}

module.exports = {
  getAuthUrl,
  exchangeCode,
  spotifyFetch,
  getAccountPlaylists,
  getAllPlaylistTracks,
  syncGroup,
  getValidToken,
  getMasterDuplicates,
  findDuplicates,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  cleanupExpiredTrades,
  getTrackInfo,
  findTrackInPlaylists,
  refreshAllTokens,
  ACCOUNT_APPS,
};
