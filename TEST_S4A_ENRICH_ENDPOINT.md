# S4A Enrich Endpoint Test

## Endpoint Details

**Route:** `POST /api/s4a/scrape-enrich`

**Location:** `/Users/ck/.openclaw/workspace/spotify-sync-app/server/s4a-route.js` (lines 337-454)

**Mount Point:** Imported in `/server/routes.js` as S4A routes module

## Request Format

```json
{
  "track_ids": ["id1", "id2", ...]
}
```

Example with real track IDs:
```json
{
  "track_ids": ["31b257ee-96b3-4056-b357-045f8eb47b96"]
}
```

## Response Format (SSE Stream)

The endpoint returns Server-Sent Events (SSE) with the following message types:

### 1. Session Started
```json
{
  "type": "session-started",
  "sessionId": "uuid"
}
```

### 2. Progress Updates
```json
{
  "type": "progress",
  "current": 1,
  "total": 5,
  "percentage": 20
}
```

### 3. Log Messages
```json
{
  "type": "log",
  "level": "info|warn|error",
  "message": "...",
  "timestamp": "2026-03-26T19:36:07.123Z"
}
```

### 4. Completion
```json
{
  "type": "complete",
  "message": "Successfully enriched X tracks",
  "session_id": "uuid",
  "updated_count": 5,
  "total_count": 5
}
```

### 5. Error
```json
{
  "type": "error",
  "message": "Error description",
  "session_id": "uuid"
}
```

## Processing Steps

1. **Query Database:** For each track_id, queries `song_metrics` table to get:
   - `spotify_uri` (format: `spotify:track:{track_id}`)
   - `track_name`
   - `artist_name`

2. **Get Artist ID:** Calls Spotify Web API to fetch full track info and extract `artist_id`

3. **Build S4A URLs:** Constructs URLs in format:
   ```
   https://artists.spotify.com/c/artist/{artist_id}/song/{track_id}/playlists
   ```

4. **Run Scraper:** Executes `s4a_fast_scraper.py` with:
   - Environment variables: `S4A_INPUT_FILE`, `S4A_OUTPUT_FILE`
   - Input: Text file with one S4A URL per line
   - Output: CSV file with columns:
     - `Playlist URL`
     - `Artist ID`
     - `Track ID`
     - `Playlist Adds`
     - `Radio Streams`
     - `Streams (28d)`
     - `Listeners (28d)`
     - `Saves (28d)`

5. **Parse CSV Results:** Reads output CSV and extracts metrics

6. **Update Database:** Updates `song_metrics` table with:
   - `streams`
   - `listeners`
   - `saves`
   - `radio_streams`
   - `radio_percent` (calculated from ratio)
   - `playlists_added`
   - `save_ratio` (calculated)
   - `s4a_data` (raw JSON)
   - `last_updated`

## Error Handling

- ✅ Continues on errors (logs but doesn't fail entire batch)
- ✅ Logs each step for debugging
- ✅ Streams progress in real-time via SSE
- ✅ Graceful cleanup of temp files
- ✅ Session persistence for 1 hour for result retrieval

## Dependencies

### Node.js Packages (already in project)
- express
- better-sqlite3
- child_process (built-in)

### Python Packages (installed)
- selenium==4.41.0
- webdriver-manager==4.0.2
- pandas==3.0.1

### Environment Variables (in s4a_fast_scraper.py)
- `S4A_INPUT_FILE` - Input text file with URLs (overrides default "mix9.txt")
- `S4A_OUTPUT_FILE` - Output CSV file (default: "spotify_song_stats_fast.csv")
- `S4A_PARTIAL_FILE` - Backup CSV file (default: "spotify_partial_backup.csv")
- `S4A_RESTART_EVERY` - Restart browser every N scrapes (default: 25)
- `S4A_MAX_WAIT` - Max wait time for page elements in seconds (default: 12)

## Test Command

### Using curl with SSE streaming:
```bash
curl -X POST http://localhost:3000/api/s4a/scrape-enrich \
  -H "Content-Type: application/json" \
  -d '{"track_ids": ["31b257ee-96b3-4056-b357-045f8eb47b96"]}' \
  -N
```

### Using JavaScript fetch (frontend):
```javascript
const eventSource = new EventSource('/api/s4a/scrape-enrich', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track_ids: ['31b257ee-96b3-4056-b357-045f8eb47b96']
  })
});

eventSource.addEventListener('message', (e) => {
  const data = JSON.parse(e.data);
  console.log('SSE:', data.type, data);
});
```

## Frontend Integration

The frontend (unified Metrics page) already has an SSE listener ready. The endpoint integrates with existing infrastructure:
- Streams progress events
- Updates can be displayed in real-time
- Session results can be retrieved after completion

## Notes

- Scraper auto-logs in if needed (user may see browser briefly)
- Scraper auto-refreshes token on API errors
- Browser persists auth in `~/.selenium_chrome_profile`
- Scraper disabled automation detection to avoid Spotify blocks
- Only 1 page navigation per song (uses Spotify internal APIs for most data)
- Results automatically saved to database

## Database Schema

### song_metrics table
```sql
CREATE TABLE song_metrics (
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
)
```
