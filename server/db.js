const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'spotify-sync.db'));

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    spotify_user_id TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS master_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    master_playlist_id TEXT,
    master_playlist_name TEXT,
    master_account_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (master_account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS synced_playlists (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    playlist_id TEXT NOT NULL,
    playlist_name TEXT,
    account_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES master_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (group_id) REFERENCES master_groups(id) ON DELETE CASCADE
  );
`);

// Trades table
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    name TEXT,
    track_uris TEXT NOT NULL,
    playlist_ids TEXT NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 28,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    notes TEXT
  );
`);

// Migrate accounts table: add auth_app_key column if missing
try {
  db.exec(`ALTER TABLE accounts ADD COLUMN auth_app_key TEXT DEFAULT 'default'`);
} catch (e) {
  // Column already exists
}

// Add last_synced_at and track_count columns if they don't exist
try {
  db.exec(`ALTER TABLE synced_playlists ADD COLUMN last_synced_at TEXT`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE synced_playlists ADD COLUMN track_count INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists
}

// Trades table
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    name TEXT,
    track_uris TEXT NOT NULL,
    playlist_targets TEXT NOT NULL,
    duration_days INTEGER NOT NULL DEFAULT 28,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    notes TEXT
  );
`);

// Song Performance Metrics table
db.exec(`
  CREATE TABLE IF NOT EXISTS song_metrics (
    id TEXT PRIMARY KEY,
    spotify_uri TEXT NOT NULL UNIQUE,
    track_name TEXT,
    artist_name TEXT,
    released_date TEXT,
    streams INTEGER DEFAULT 0,
    listeners INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_ratio REAL DEFAULT 0,
    radio_streams INTEGER DEFAULT 0,
    radio_percent REAL DEFAULT 0,
    playlists_added INTEGER DEFAULT 0,
    s_l_ratio REAL DEFAULT 0,
    s4a_data TEXT,
    last_updated TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add new columns to song_metrics if they don't exist
try {
  db.exec(`ALTER TABLE song_metrics ADD COLUMN duration_ms INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE song_metrics ADD COLUMN popularity INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE song_metrics ADD COLUMN album_image_url TEXT`);
} catch (e) {
  // Column already exists
}
try {
  db.exec(`ALTER TABLE song_metrics ADD COLUMN preview_url TEXT`);
} catch (e) {
  // Column already exists
}

// S4A Analytics table (from Selenium scraper)
db.exec(`
  CREATE TABLE IF NOT EXISTS s4a_analytics (
    id TEXT PRIMARY KEY,
    spotify_uri TEXT,
    track_name TEXT,
    artist_id TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    track_id TEXT,
    streams INTEGER DEFAULT 0,
    listeners INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    radio_streams INTEGER DEFAULT 0,
    radio_percentage REAL DEFAULT 0,
    playlist_adds TEXT,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    raw_s4a_data TEXT,
    source TEXT DEFAULT 's4a_scraper',
    collected_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(artist_id, track_id)
  );
`);

// S4A Analytics Metrics table
db.exec(`
  CREATE TABLE IF NOT EXISTS s4a_analytics (
    id TEXT PRIMARY KEY,
    spotify_uri TEXT,
    track_name TEXT NOT NULL,
    artist_id TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    track_id TEXT,
    released_date TEXT,
    days_since_release INTEGER,
    streams INTEGER DEFAULT 0,
    listeners INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    save_ratio REAL DEFAULT 0,
    radio_streams INTEGER DEFAULT 0,
    radio_percentage REAL DEFAULT 0,
    playlist_adds INTEGER DEFAULT 0,
    streams_per_listener REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    engagement REAL DEFAULT 0,
    raw_s4a_data TEXT,
    source TEXT DEFAULT 'spotify_for_artists_session',
    collected_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(artist_id, track_name)
  );
`);

// S4A Session Management table
db.exec(`
  CREATE TABLE IF NOT EXISTS s4a_sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    is_authenticated INTEGER DEFAULT 0,
    cookie_data TEXT,
    last_login_at TEXT,
    last_activity_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// S4A Collection Jobs table
db.exec(`
  CREATE TABLE IF NOT EXISTS s4a_collection_jobs (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tracks INTEGER DEFAULT 0,
    processed_tracks INTEGER DEFAULT 0,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (artist_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
`);

// S4A Metrics table (new: dedicated S4A metric storage with validation)
db.exec(`
  CREATE TABLE IF NOT EXISTS s4a_metrics (
    id TEXT PRIMARY KEY,
    spotify_uri TEXT UNIQUE,
    artist_id TEXT,
    track_id TEXT,
    song_name TEXT,
    artist_name TEXT,
    playlist_adds INTEGER,
    radio_streams INTEGER,
    streams_28d INTEGER,
    listeners_28d INTEGER,
    saves_28d INTEGER,
    release_date TEXT,
    days_since_release INTEGER,
    save_ratio REAL,
    streams_per_listener REAL,
    source TEXT DEFAULT 'spotify_for_artists_session',
    collected_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

module.exports = db;
