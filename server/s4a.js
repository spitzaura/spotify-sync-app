const fs = require('fs');
const path = require('path');

/**
 * Spotify for Artists (S4A) Integration — Lightweight Token + Hardcoded Roster
 * 
 * Architecture:
 * - Token is saved to s4a-token.json (refreshed by OpenClaw agent when needed)
 * - Roster is hardcoded (rarely changes)
 * - Song stats API works from browser context only (CORS)
 * - Playlist breakdown must be scraped from rendered page
 * - For page scraping: POST playlist data directly via /api/s4a/push-playlists
 *   (OpenClaw agent scrapes via its browser and pushes results)
 * 
 * This avoids fighting Spotify's bot detection entirely.
 */

const TOKEN_FILE = path.join(__dirname, '..', 's4a-token.json');
const CACHE_DIR = path.join(__dirname, '..', '.s4a-cache');

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Known artist roster
const ARTIST_ROSTER = [
  { artistId: '0GtIiJsJ7SVpIEc7GiyT1i', name: 'Très Moyen' },
  { artistId: '2St70IK3exs92SScvCgLht', name: 'Après Minuit' },
  { artistId: '4QYT90Tu0je9KY9NXNIKDz', name: 'afterhours.' },
  { artistId: '3BlmQ8a15iQIMAuZUpchgO', name: 'between.' },
  { artistId: '4N1e39WEH57zXVa3ipIifH', name: 'elsewhere.' },
  { artistId: '48d57DceYSqLNKZy4fnfgh', name: 'Sans Effort' },
  { artistId: '7vmo6lKXJ9aHxlz8YTHHUF', name: 'I Overdid It' },
  { artistId: '2v0fVlWah8Dmy5Zx64cXfP', name: 'Clipping Again' },
  { artistId: '2rvWBVV3VjtxFjF0yz6b0l', name: 'Too Much Kick' },
  { artistId: '7tlcApvb4qbIqOeLt1JGDl', name: 'Speedy Kenzo' },
  { artistId: '1Gx750YKXf6W3vrXKNL6qd', name: 'Ayla Sahar.' },
  { artistId: '6VpoAaQPf4Q07RroGa9wXZ', name: 'Demoiselle Rima.' },
  { artistId: '11rDoMkiYCjXKmNdjd6Gar', name: 'Distortion Issue' }
];

class S4AClient {
  constructor() {
    this.token = null;
    this.tokenUpdatedAt = null;
    this._loadToken();
  }

  _loadToken() {
    try {
      const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
      this.token = data.token;
      this.tokenUpdatedAt = data.updatedAt;
    } catch {}
  }

  saveToken(token) {
    this.token = token;
    this.tokenUpdatedAt = new Date().toISOString();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ 
      token, updatedAt: this.tokenUpdatedAt 
    }, null, 2));
    console.log('💾 S4A token saved');
  }

  getToken() {
    if (this.token) return this.token;
    this._loadToken();
    return this.token;
  }

  getArtistRoster() {
    return ARTIST_ROSTER;
  }

  // Cache playlist data pushed by the agent
  cachePlaylistData(artistId, trackId, data) {
    const key = `${artistId}_${trackId}`;
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      ...data,
      cachedAt: new Date().toISOString()
    }, null, 2));
    console.log(`💾 Cached playlist data for ${key} (${data.playlists?.length || 0} playlists)`);
  }

  getCachedPlaylistData(artistId, trackId) {
    const key = `${artistId}_${trackId}`;
    const filePath = path.join(CACHE_DIR, `${key}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return data;
    } catch {
      return null;
    }
  }

  // Cache song list data
  cacheSongData(artistId, data) {
    const filePath = path.join(CACHE_DIR, `songs_${artistId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      ...data,
      cachedAt: new Date().toISOString()
    }, null, 2));
  }

  getCachedSongData(artistId) {
    const filePath = path.join(CACHE_DIR, `songs_${artistId}.json`);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Cache per-track stats (streams, listeners, saves, radio, playlist adds)
  cacheTrackStats(trackId, data) {
    const filePath = path.join(CACHE_DIR, `track_${trackId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      ...data,
      trackId,
      cachedAt: new Date().toISOString()
    }, null, 2));
  }

  getCachedTrackStats(trackId) {
    const filePath = path.join(CACHE_DIR, `track_${trackId}.json`);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  // Bulk cache track stats (from Excel import or scrape)
  bulkCacheTrackStats(tracks) {
    let count = 0;
    for (const t of tracks) {
      if (t.trackId) {
        this.cacheTrackStats(t.trackId, t);
        count++;
      }
    }
    return count;
  }

  // Look up multiple tracks at once — returns map of trackId → stats
  getMultipleTrackStats(trackIds) {
    const result = {};
    for (const id of trackIds) {
      const stats = this.getCachedTrackStats(id);
      if (stats) result[id] = stats;
    }
    return result;
  }

  // Cache playlist data manually (Master provides S4A playlist data)
  cachePlaylistManualSync(playlistId, playlistData) {
    const filePath = path.join(CACHE_DIR, `playlist_manual_${playlistId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({
      playlistId,
      data: playlistData || [],
      cachedAt: new Date().toISOString()
    }, null, 2));
    console.log(`💾 Manually cached S4A data for playlist ${playlistId} (${playlistData ? playlistData.length : 0} tracks)`);
  }

  // Retrieve manually cached playlist data
  getCachedManualPlaylistData(playlistId) {
    const filePath = path.join(CACHE_DIR, `playlist_manual_${playlistId}.json`);
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  async close() {
    // Nothing to close — no browser
  }
}

let s4aClient = null;
function getS4AClient() {
  if (!s4aClient) s4aClient = new S4AClient();
  return s4aClient;
}

module.exports = { getS4AClient };
