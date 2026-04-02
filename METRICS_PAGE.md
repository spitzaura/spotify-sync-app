# 📊 Song Performance Metrics - Unified Page

## Overview

The **Song Performance Metrics** page (`/metrics`) is a comprehensive, three-section workflow for tracking and enriching song performance data across Spotify.

### Access
- **URL**: `http://localhost:5173/metrics`
- **Navigation**: Main app sidebar → "📊 Metrics"

---

## 🎵 Section 1: Extract URIs

**Purpose**: Extract track URIs from Spotify playlists and auto-fetch metadata.

### Workflow
1. **Select Account**: Choose which Spotify account owns the playlists
2. **Paste URLs**: Add one or more Spotify playlist URLs
   - Formats: `https://open.spotify.com/playlist/xxxxx` or `spotify:playlist:xxxxx`
   - Can add multiple playlists
   - Duplicates are automatically removed
3. **Extract**: System fetches all tracks from the playlists
   - Auto-retrieves: track name, artist, release date
   - Handles pagination automatically
4. **Save to Metrics**: Adds extracted tracks to the song_metrics table

### API Endpoints Used
- `POST /api/extract-playlist-uris` - Extract URIs from playlist
- `POST /api/song-metrics/bulk` - Save URIs to metrics table

### Output
- List of extracted Spotify track URIs
- Display shows: URI count, preview of URIs
- Button to save directly to Metrics table

---

## 📈 Section 2: S4A Analytics

**Purpose**: Enrich song data with performance statistics from Spotify for Artists.

### Two Modes

#### Mode A: Enrich Existing Songs
1. Select which songs in the metrics table to enrich
2. System fetches S4A data for selected tracks:
   - Streams
   - Listeners
   - Saves
   - Save Ratio (saves/listeners)
   - Radio % and Radio Streams
   - Playlist Adds
3. Updates the metrics table with new data

#### Mode B: Paste S4A URLs
1. Paste Spotify for Artists URLs
   - Format: `https://artists.spotify.com/c/artist/.../song/...`
2. System scrapes S4A pages to extract performance data
3. Results can be saved to metrics table

### Features
- **Live Progress**: Real-time scraping progress with logs
- **Session Management**: Tracks scraping sessions
- **Error Handling**: Clear error messages and recovery
- **Results Preview**: Shows scraped data in table format

### API Endpoints Used
- `POST /api/s4a/scrape-metrics` - Scrape S4A for selected tracks (SSE)
- `POST /api/s4a/scrape` - Scrape S4A URLs (SSE)
- `GET /api/s4a/scrape/{sessionId}/results` - Fetch scrape results

### Output
- Updated metrics table with enriched performance data
- Live logs of scraping progress
- Results preview table

---

## 📋 Section 3: Metrics Table

**Purpose**: View, manage, and analyze all song metrics in one place.

### Features

#### Display Columns
| Column | Description |
|--------|-------------|
| Song | Track name + artist |
| Streams | Total Spotify streams |
| Listeners | Unique listeners |
| Saves | Total saves |
| Save % | Saves/Listeners ratio |
| Radio % | Radio play percentage |
| Playlists | Playlist additions |
| Actions | Delete button |

#### Controls

**Add Single Song**
- Manual entry form for individual tracks
- Auto-fetch metadata from URI
- Fields: URI, name, artist, streams, listeners, saves, ratios

**Search**
- Real-time search by song name or artist
- Case-insensitive matching

**Sort**
- 6 sort options:
  - Streams (default)
  - Listeners
  - Saves
  - Save Ratio
  - Radio %
  - Playlists Added

**Delete**
- Remove songs from metrics table
- Confirmation dialog

#### Summary Stats
When songs are displayed, shows:
- Total Streams
- Total Listeners
- Total Saves
- Average Save %
- Song Count

---

## 📊 Database Schema

### song_metrics Table
```sql
id              UUID PRIMARY KEY
spotify_uri     VARCHAR UNIQUE
track_name      VARCHAR
artist_name     VARCHAR
released_date   DATE
streams         INTEGER (default 0)
listeners       INTEGER (default 0)
saves           INTEGER (default 0)
save_ratio      DECIMAL (default 0)
radio_streams   INTEGER (default 0)
radio_percent   DECIMAL (default 0)
playlists_added INTEGER (default 0)
s4a_data        JSON (optional)
last_updated    TIMESTAMP
created_at      TIMESTAMP
```

---

## 🔄 Workflow Examples

### Example 1: Extract & View
1. Go to **Section 1**
2. Select account "Spitz Aura Records"
3. Paste playlist URL
4. Click "Extract URIs"
5. See 50+ tracks extracted
6. Click "Save to Metrics"
7. Go to **Section 3** to view the new metrics table

### Example 2: Enrich with S4A Data
1. Go to **Section 2**
2. Select "Enrich Existing"
3. Check 5-10 songs from the list
4. Click "Start Enrichment"
5. Watch live progress logs
6. Metrics table updates with streams, saves, etc.

### Example 3: Manual Add + Custom Data
1. Go to **Section 3**
2. Click "Add Single Song"
3. Paste Spotify URI
4. Metadata auto-fills
5. Enter custom stream/save counts
6. Click "Add"
7. Song appears in table

---

## 🎯 Use Cases

### Case 1: Release Tracking
- Extract all tracks from release playlist
- Enrich with S4A data weekly
- Monitor performance trends

### Case 2: Catalog Management
- Build master metrics table across all artists
- Track which songs are gaining traction
- Identify underperformers

### Case 3: Playlist Analytics
- Extract tracks from multiple playlists
- Compare performance across playlists
- Identify best performers

---

## ⚙️ Technical Details

### Component Structure
- **Parent**: SongMetrics.jsx (1200+ lines)
- **Sections**: Tab-based navigation
- **State Management**: React hooks (useState, useEffect)
- **API Integration**: Fetch API + SSE for real-time updates

### Key Features
- ✅ Automatic metadata fetching
- ✅ Real-time progress with SSE
- ✅ Session management
- ✅ Duplicate removal
- ✅ Bulk operations
- ✅ Search & sort
- ✅ Multi-account support
- ✅ Error handling & recovery

### Performance
- Pagination support (auto-handled by backend)
- Efficient filtering and sorting on client
- Minimal re-renders with proper hook dependencies

---

## 🚀 Getting Started

### Step 1: Access the Page
```
Navigate to: http://localhost:5173/metrics
```

### Step 2: Authenticate
- Ensure you have Spotify accounts connected
- Page loads with available accounts

### Step 3: Choose Your Workflow
- **Extract**: Start with Section 1 to get URIs
- **Enrich**: Use Section 2 to add performance data
- **Manage**: Use Section 3 to view and organize

---

## 📝 Notes

### Important Limits
- Playlist extraction: Handles pagination automatically
- S4A scraping: Limited by S4A rate limits (~100 URLs per session)
- Table display: Shows all metrics (performance optimized for <10k records)

### Data Accuracy
- Spotify metadata from Spotify Web API
- S4A data scraped directly from S4A pages
- Save ratios calculated from saves/listeners
- Data is as current as the last update

### Troubleshooting

**"No songs found in playlists"**
- Check playlist URL format
- Verify account has access to playlist
- Ensure playlist isn't empty

**"S4A scrape failed"**
- Check S4A URLs are valid and public
- May need to retry (rate limiting)
- Check browser console for details

**"Metrics not updating"**
- Refresh the page
- Check browser network tab for API errors
- Ensure server is running

---

## 🔗 Related Features

- **URIExtractor.jsx**: Standalone URI extraction (superseded by Section 1)
- **S4AAnalytics.jsx**: Standalone S4A scraper (superseded by Section 2)
- **Backend API**: `/api/song-metrics`, `/api/s4a/*` routes

---

## 🎨 UI/UX Design

- **Color Scheme**: Dark theme with Spotify green accents
- **Responsive**: Works on desktop (mobile view not optimized)
- **Accessibility**: Semantic HTML, ARIA labels where needed
- **Feedback**: Clear success/error messages, progress indicators

---

**Last Updated**: 2026-03-26
**Status**: Production Ready ✅
