# Spotify Direct Data Fetcher Endpoint

## Overview
New endpoint: **POST /api/metrics/fetch-from-spotify**

Fetches track data directly from Spotify Web API and stores all metadata in the `song_metrics` table. No scraping, no S4A, pure Spotify data.

## Usage

### Option 1: Fetch from Playlist URL
```bash
curl -X POST http://localhost:3000/api/metrics/fetch-from-spotify \
  -H "Content-Type: application/json" \
  -d '{
    "playlist_url": "https://open.spotify.com/playlist/37i9dQZF1DX7KNqlDKtnxx"
  }'
```

### Option 2: Fetch from Direct URIs
```bash
curl -X POST http://localhost:3000/api/metrics/fetch-from-spotify \
  -H "Content-Type: application/json" \
  -d '{
    "uris": [
      "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp",
      "spotify:track:3n3Ppam7vgaVa1iaRUc9Lq"
    ]
  }'
```

## Response Format
```json
{
  "inserted": 42,
  "skipped": 3,
  "total": 45,
  "results": [
    {
      "uri": "spotify:track:...",
      "track_name": "Song Name",
      "artist_name": "Artist 1, Artist 2",
      "status": "inserted"
    },
    {
      "uri": "spotify:track:...",
      "track_name": "Failed Track",
      "artist_name": "unknown",
      "status": "error",
      "error": "Error message"
    }
  ]
}
```

## Data Stored
For each track, the following fields are populated in `song_metrics`:
- `track_name` - Track name from Spotify
- `artist_name` - Comma-separated list of all artists
- `released_date` - Album release date (YYYY-MM-DD)
- `duration_ms` - Track duration in milliseconds
- `popularity` - Spotify popularity score (0-100)
- `album_image_url` - URL to album artwork
- `preview_url` - URL to 30-second preview (if available)
- `spotify_uri` - Unique Spotify URI
- `created_at` / `last_updated` - Timestamps

## Features
✅ Handles both playlist URLs and direct URIs  
✅ Batch processing (50 tracks at a time from Spotify API)  
✅ Rate limit protection (200ms delay between batches)  
✅ Error handling per track (insert continues on individual failures)  
✅ Uses existing Spotify account credentials  
✅ Returns detailed results with success/error status  
✅ Lightning fast - no browser, no scraping  

## Required Setup
- At least one Spotify account must be configured in the `accounts` table
- Account must have valid access token (handled by existing refresh mechanism)

## Notes
- No SSE streaming needed - fast JSON response
- Spotify API batches limited to 50 tracks per request
- Uses `INSERT OR REPLACE` - re-running is safe (won't duplicate, will update)
- All timestamps in ISO 8601 format
