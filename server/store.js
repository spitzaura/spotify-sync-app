const db = require('./db');

// ── Persistent cache (stored in SQLite, 1-hour TTL) ──
const CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

db.exec(CACHE_TABLE);

function setCache(key, value, ttlMinutes = 60) {
  const expiresAt = Date.now() + (ttlMinutes * 60 * 1000);
  db.prepare(`
    INSERT OR REPLACE INTO cache (key, value, expires_at)
    VALUES (?, ?, ?)
  `).run(key, JSON.stringify(value), expiresAt);
}

function getCache(key) {
  const row = db.prepare(`
    SELECT value, expires_at FROM cache WHERE key = ?
  `).get(key);
  
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM cache WHERE key = ?').run(key);
    return null;
  }
  return JSON.parse(row.value);
}

function clearCache(key) {
  db.prepare('DELETE FROM cache WHERE key = ?').run(key);
}

// ── Accounts ──

function getAllAccounts() {
  return db.prepare(`
    SELECT id, spotify_user_id, display_name, email, token_expires_at, auth_app_key, created_at, updated_at
    FROM accounts ORDER BY created_at DESC
  `).all();
}

function getAccountById(id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function getAccountBySpotifyId(spotifyUserId) {
  return db.prepare('SELECT * FROM accounts WHERE spotify_user_id = ?').get(spotifyUserId);
}

function upsertAccount({ id, spotifyUserId, displayName, email, accessToken, refreshToken, expiresAt, authAppKey }) {
  const existing = getAccountBySpotifyId(spotifyUserId);
  if (existing) {
    // Update existing account, preserve auth_app_key if not provided
    db.prepare(`
      UPDATE accounts
      SET display_name = ?, email = ?, access_token = ?, refresh_token = ?, token_expires_at = ?, auth_app_key = COALESCE(?, auth_app_key), updated_at = datetime('now')
      WHERE spotify_user_id = ?
    `).run(displayName, email, accessToken, refreshToken, expiresAt, authAppKey || null, spotifyUserId);
    return existing.id;
  } else {
    db.prepare(`
      INSERT INTO accounts (id, spotify_user_id, display_name, email, access_token, refresh_token, token_expires_at, auth_app_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, spotifyUserId, displayName, email, accessToken, refreshToken, expiresAt, authAppKey || 'default');
    return id;
  }
}

function updateTokens(id, accessToken, refreshToken, expiresAt) {
  db.prepare(`
    UPDATE accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(accessToken, refreshToken, expiresAt, id);
}

function deleteAccount(id) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

// ── Master Groups ──

function getAllGroups() {
  const groups = db.prepare(`
    SELECT mg.*, a.display_name as master_account_name
    FROM master_groups mg
    LEFT JOIN accounts a ON mg.master_account_id = a.id
    ORDER BY mg.created_at DESC
  `).all();

  for (const group of groups) {
    group.children = db.prepare(`
      SELECT cp.*, a.display_name as account_name
      FROM synced_playlists cp
      JOIN accounts a ON cp.account_id = a.id
      WHERE cp.group_id = ?
    `).all(group.id);
  }

  return groups;
}

function getGroupById(id) {
  const group = db.prepare(`
    SELECT mg.*, a.display_name as master_account_name
    FROM master_groups mg
    LEFT JOIN accounts a ON mg.master_account_id = a.id
    WHERE mg.id = ?
  `).get(id);

  if (group) {
    group.children = db.prepare(`
      SELECT cp.*, a.display_name as account_name
      FROM synced_playlists cp
      JOIN accounts a ON cp.account_id = a.id
      WHERE cp.group_id = ?
    `).all(group.id);
  }

  return group;
}

function createGroup(id, name) {
  db.prepare('INSERT INTO master_groups (id, name) VALUES (?, ?)').run(id, name);
  return getGroupById(id);
}

function updateGroup(id, { name, masterPlaylistId, masterPlaylistName, masterAccountId }) {
  db.prepare(`
    UPDATE master_groups
    SET name = COALESCE(?, name),
        master_playlist_id = COALESCE(?, master_playlist_id),
        master_playlist_name = COALESCE(?, master_playlist_name),
        master_account_id = COALESCE(?, master_account_id),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(name, masterPlaylistId, masterPlaylistName, masterAccountId, id);
  return getGroupById(id);
}

function deleteGroup(id) {
  db.prepare('DELETE FROM master_groups WHERE id = ?').run(id);
}

// ── Child Playlists ──

function addChildPlaylist(id, groupId, playlistId, playlistName, accountId) {
  db.prepare(`
    INSERT INTO synced_playlists (id, group_id, playlist_id, playlist_name, account_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, groupId, playlistId, playlistName, accountId);
}

function removeChildPlaylist(id) {
  db.prepare('DELETE FROM synced_playlists WHERE id = ?').run(id);
}

function updateChildLastSynced(childId, trackCount) {
  db.prepare(`
    UPDATE synced_playlists SET last_synced_at = datetime('now'), track_count = ? WHERE id = ?
  `).run(trackCount, childId);
}

function getChildById(childId) {
  return db.prepare('SELECT * FROM synced_playlists WHERE id = ?').get(childId);
}

// ── Sync Logs ──

function addSyncLog(groupId, status, details) {
  db.prepare('INSERT INTO sync_logs (group_id, status, details) VALUES (?, ?, ?)').run(groupId, status, details);
}

function getSyncLogs(groupId, limit = 10) {
  return db.prepare('SELECT * FROM sync_logs WHERE group_id = ? ORDER BY created_at DESC LIMIT ?').all(groupId, limit);
}

// ── Trades ──

function getAllTrades() {
  return db.prepare('SELECT * FROM trades ORDER BY created_at DESC').all();
}

function getActiveTrades() {
  return db.prepare("SELECT * FROM trades WHERE status = 'active' ORDER BY expires_at ASC").all();
}

function getExpiredActiveTrades() {
  return db.prepare("SELECT * FROM trades WHERE status = 'active' AND expires_at < datetime('now')").all();
}

function getTradeById(id) {
  return db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
}

function createTrade({ id, name, trackUris, playlistIds, durationDays, expiresAt, notes }) {
  db.prepare(`
    INSERT INTO trades (id, name, track_uris, playlist_ids, duration_days, expires_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name || null, JSON.stringify(trackUris), JSON.stringify(playlistIds), durationDays, expiresAt, notes || null);
  return getTradeById(id);
}

function updateTradeStatus(id, status) {
  db.prepare("UPDATE trades SET status = ? WHERE id = ?").run(status, id);
}

function extendTrade(id, additionalDays) {
  const trade = getTradeById(id);
  if (!trade) return null;
  const currentExpiry = new Date(trade.expires_at + 'Z');
  const newExpiry = new Date(currentExpiry.getTime() + additionalDays * 86400000);
  db.prepare("UPDATE trades SET expires_at = ?, duration_days = duration_days + ? WHERE id = ?")
    .run(newExpiry.toISOString().replace('T', ' ').replace('Z', '').split('.')[0], additionalDays, id);
  return getTradeById(id);
}

// ═══════════════════════════════════════════
// SONG METRICS (Performance Tracking)
// ═══════════════════════════════════════════

function getSongMetrics(spotifyUri) {
  const stmt = db.prepare('SELECT * FROM song_metrics WHERE spotify_uri = ?');
  return stmt.get(spotifyUri);
}

function getAllSongMetrics() {
  const stmt = db.prepare('SELECT * FROM song_metrics ORDER BY last_updated DESC');
  return stmt.all();
}

function upsertSongMetric(id, data) {
  try {
    const {
      spotify_uri,
      track_name,
      artist_name,
      released_date,
      streams,
      listeners,
      saves,
      save_ratio,
      radio_streams,
      radio_percent,
      playlists_added,
      s_l_ratio,
      s4a_data
    } = data;

    if (!spotify_uri) throw new Error('spotify_uri is required');

    const existing = getSongMetrics(spotify_uri);
    
    if (existing) {
      const stmt = db.prepare(`
        UPDATE song_metrics 
        SET track_name = ?, artist_name = ?, released_date = ?, streams = ?, listeners = ?, 
            saves = ?, save_ratio = ?, radio_streams = ?, radio_percent = ?, playlists_added = ?, 
            s_l_ratio = ?, s4a_data = ?, last_updated = datetime('now')
        WHERE spotify_uri = ?
      `);
      stmt.run(track_name, artist_name, released_date, streams, listeners, saves, save_ratio, 
               radio_streams, radio_percent, playlists_added, s_l_ratio, s4a_data, spotify_uri);
    } else {
      const stmt = db.prepare(`
        INSERT INTO song_metrics (id, spotify_uri, track_name, artist_name, released_date, streams, 
                                  listeners, saves, save_ratio, radio_streams, radio_percent, 
                                  playlists_added, s_l_ratio, s4a_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(id, spotify_uri, track_name, artist_name, released_date, streams, listeners, saves, 
               save_ratio, radio_streams, radio_percent, playlists_added, s_l_ratio, s4a_data);
    }
    
    return getSongMetrics(spotify_uri);
  } catch (err) {
    console.error(`[DB] upsertSongMetric error:`, err.message, `URI:`, data?.spotify_uri);
    throw err;
  }
}

function updateSongMetric(spotifyUri, data) {
  return upsertSongMetric(null, { spotify_uri: spotifyUri, ...data });
}

function deleteSongMetric(spotifyUri) {
  const stmt = db.prepare('DELETE FROM song_metrics WHERE spotify_uri = ?');
  stmt.run(spotifyUri);
}

// ═══════════════════════════════════════════
// S4A METRICS (Spotify for Artists Analytics)
// ═══════════════════════════════════════════

/**
 * Calculate derived metrics with validation
 */
function calculateDerivedMetrics(data) {
  const result = { ...data };
  
  // Calculate save_ratio (saves / listeners) if both present
  if (data.saves_28d !== undefined && data.listeners_28d && data.listeners_28d > 0) {
    result.save_ratio = data.saves_28d / data.listeners_28d;
  }
  
  // Calculate streams_per_listener if both present
  if (data.streams_28d !== undefined && data.listeners_28d && data.listeners_28d > 0) {
    result.streams_per_listener = data.streams_28d / data.listeners_28d;
  }
  
  // Calculate days_since_release if date present
  if (data.release_date) {
    try {
      const releaseDate = new Date(data.release_date);
      const now = new Date();
      const diffMs = now - releaseDate;
      result.days_since_release = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    } catch (err) {
      // Invalid date, leave null
    }
  }
  
  return result;
}

/**
 * Insert or update a single S4A metric
 */
function upsertS4AMetric(data) {
  const {
    id,
    spotify_uri,
    artist_id,
    track_id,
    song_name,
    artist_name,
    playlist_adds,
    radio_streams,
    streams_28d,
    listeners_28d,
    saves_28d,
    release_date,
    source
  } = data;
  
  // Validate required field
  if (!spotify_uri) {
    throw new Error('spotify_uri is required');
  }
  
  // Validate numeric fields
  const numericFields = {
    playlist_adds,
    radio_streams,
    streams_28d,
    listeners_28d,
    saves_28d
  };
  
  for (const [key, value] of Object.entries(numericFields)) {
    if (value !== undefined && value !== null && isNaN(value)) {
      throw new Error(`${key} must be a valid number`);
    }
  }
  
  // Calculate derived metrics
  const derived = calculateDerivedMetrics(data);
  
  const existing = db.prepare('SELECT id FROM s4a_metrics WHERE spotify_uri = ?').get(spotify_uri);
  
  if (existing) {
    // Update existing
    const stmt = db.prepare(`
      UPDATE s4a_metrics 
      SET artist_id = ?, track_id = ?, song_name = ?, artist_name = ?, 
          playlist_adds = ?, radio_streams = ?, streams_28d = ?, listeners_28d = ?, saves_28d = ?,
          release_date = ?, days_since_release = ?, save_ratio = ?, streams_per_listener = ?,
          source = ?, updated_at = datetime('now')
      WHERE spotify_uri = ?
    `);
    
    stmt.run(
      artist_id || null,
      track_id || null,
      song_name || null,
      artist_name || null,
      playlist_adds || null,
      radio_streams || null,
      streams_28d || null,
      listeners_28d || null,
      saves_28d || null,
      release_date || null,
      derived.days_since_release || null,
      derived.save_ratio || null,
      derived.streams_per_listener || null,
      source || 'spotify_for_artists_session',
      spotify_uri
    );
  } else {
    // Insert new
    const { v4: uuidv4 } = require('uuid');
    const metricId = id || uuidv4();
    
    const stmt = db.prepare(`
      INSERT INTO s4a_metrics 
      (id, spotify_uri, artist_id, track_id, song_name, artist_name, 
       playlist_adds, radio_streams, streams_28d, listeners_28d, saves_28d,
       release_date, days_since_release, save_ratio, streams_per_listener, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      metricId,
      spotify_uri,
      artist_id || null,
      track_id || null,
      song_name || null,
      artist_name || null,
      playlist_adds || null,
      radio_streams || null,
      streams_28d || null,
      listeners_28d || null,
      saves_28d || null,
      release_date || null,
      derived.days_since_release || null,
      derived.save_ratio || null,
      derived.streams_per_listener || null,
      source || 'spotify_for_artists_session'
    );
  }
  
  return getS4AMetricByURI(spotify_uri);
}

/**
 * Get a single S4A metric by Spotify URI
 */
function getS4AMetricByURI(uri) {
  const stmt = db.prepare('SELECT * FROM s4a_metrics WHERE spotify_uri = ?');
  return stmt.get(uri);
}

/**
 * Get all S4A metrics
 */
function getAllS4AMetrics() {
  const stmt = db.prepare('SELECT * FROM s4a_metrics ORDER BY updated_at DESC');
  return stmt.all();
}

/**
 * Delete a single S4A metric by URI
 */
function deleteS4AMetric(uri) {
  const stmt = db.prepare('DELETE FROM s4a_metrics WHERE spotify_uri = ?');
  stmt.run(uri);
}

/**
 * Bulk upsert multiple S4A metrics (for pipeline integration)
 */
function bulkUpsertS4AMetrics(results) {
  if (!Array.isArray(results)) {
    throw new Error('results must be an array');
  }
  
  const inserted = [];
  const errors = [];
  
  // Wrap in transaction for performance
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      try {
        const result = upsertS4AMetric(item);
        inserted.push(result);
      } catch (err) {
        errors.push({
          data: item,
          error: err.message
        });
      }
    }
  });
  
  insertMany(results);
  
  return {
    inserted: inserted.length,
    errors: errors.length,
    results: inserted,
    errorDetails: errors
  };
}

// ── Group Metrics (B2B data) ──

function getMasterGroupsWithPlaylists() {
  return db.prepare(`
    SELECT id, name FROM master_groups ORDER BY name
  `).all();
}

function getGroupMetricsData(groupId) {
  // Get B2B playlists mapped to this group
  const mappedPlaylists = db.prepare(`
    SELECT DISTINCT b2b_playlist FROM b2b_playlist_mapping WHERE group_id = ?
  `).all(groupId);
  
  const playlistNames = mappedPlaylists.map(p => p.b2b_playlist);
  
  if (playlistNames.length === 0) {
    return [];
  }
  
  // Get all songs in the B2B data for these group's playlists
  // Aggregate completion% across all playlists in this group
  const placeholders = playlistNames.map(() => '?').join(',');
  const query = `
    SELECT 
      sm.id,
      sm.spotify_uri,
      sm.track_name,
      sm.artist_name,
      sm.released_date,
      sm.days_since_release,
      sm.streams,
      sm.listeners,
      sm.saves,
      sm.save_ratio,
      sm.radio_streams,
      sm.radio_percent,
      sm.playlists_added,
      ROUND(AVG(sbpd.completion_percent), 1) as group_completion
    FROM song_metrics sm
    JOIN song_b2b_playlist_data sbpd ON sm.track_name = sbpd.song
    WHERE sbpd.playlist IN (${placeholders})
    GROUP BY sm.id
    ORDER BY group_completion DESC NULLS LAST
  `;
  
  return db.prepare(query).all(...playlistNames);
}

module.exports = {
  getAllAccounts,
  getAccountById,
  getAccountBySpotifyId,
  upsertAccount,
  updateTokens,
  deleteAccount,
  getAllGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  addChildPlaylist,
  removeChildPlaylist,
  updateChildLastSynced,
  getChildById,
  addSyncLog,
  getSyncLogs,
  getAllTrades,
  getActiveTrades,
  getExpiredActiveTrades,
  getTradeById,
  createTrade,
  updateTradeStatus,
  extendTrade,
  setCache,
  getCache,
  clearCache,
  getSongMetrics,
  getAllSongMetrics,
  upsertSongMetric,
  updateSongMetric,
  deleteSongMetric,
  upsertS4AMetric,
  getS4AMetricByURI,
  getAllS4AMetrics,
  deleteS4AMetric,
  bulkUpsertS4AMetrics,
  getMasterGroupsWithPlaylists,
  getGroupMetricsData,
};
