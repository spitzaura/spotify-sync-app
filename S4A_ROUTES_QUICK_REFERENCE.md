# S4A Scraper Routes - Quick Reference

## Endpoint Summary

| Method | Endpoint | Purpose | Returns |
|--------|----------|---------|---------|
| GET | `/api/s4a/artists` | List label artists | JSON array of 4-6 artists |
| POST | `/api/s4a/scrape` | Launch scraper batch | **SSE Stream** (real-time progress) |
| POST | `/api/s4a/download/csv` | Export to CSV | **File** (text/csv) |
| POST | `/api/s4a/download/excel` | Export to Excel | **File** (application/xlsx) |

---

## Quick Start

### 1. List Available Artists
```bash
curl http://localhost:3001/api/s4a/artists
```

**Response:**
```json
{
  "total": 6,
  "artists": [
    {"id": "5k8iZVVPpZ8mPKo9XKh8p9", "name": "Jean-Baptiste", "spotifyId": "5k8iZVVPpZ8mPKo9XKh8p9"},
    {"id": "2Bvvd2VZ4YvBl3Hd5n8p3K", "name": "Off Key.", "spotifyId": "2Bvvd2VZ4YvBl3Hd5n8p3K"}
  ],
  "timestamp": "2026-03-26T20:14:00Z"
}
```

---

### 2. Start Scraper (with Progress Streaming)

#### Option A: cURL with EventSource
```bash
curl -X POST http://localhost:3001/api/s4a/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "artistIds": ["5k8iZVVPpZ8mPKo9XKh8p9", "2Bvvd2VZ4YvBl3Hd5n8p3K"],
    "playlistUrls": ["https://open.spotify.com/playlist/37i9dQZF1DX4..."],
    "accountId": "your-account-id"
  }'
```

#### Option B: JavaScript (Recommended)
```javascript
const eventSource = new EventSource('/api/s4a/scrape', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    artistIds: ['5k8iZVVPpZ8mPKo9XKh8p9', '2Bvvd2VZ4YvBl3Hd5n8p3K'],
    playlistUrls: ['https://open.spotify.com/playlist/...'],
    accountId: 'your-account-id'
  })
});

eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  
  if (event.type === 'progress') {
    console.log(`${event.current}/${event.total}: ${event.message}`);
    // Update progress bar UI
  }
  
  if (event.type === 'result') {
    console.log(`✅ ${event.artistName}: ${event.tracksStored} tracks`);
  }
  
  if (event.type === 'error') {
    console.error(`❌ ${event.artistName}: ${event.error}`);
  }
  
  if (event.type === 'complete') {
    console.log(`✅ Done! ${event.totalProcessed} tracks collected`);
    console.log('Download:', event.downloadUrls);
    eventSource.close();
  }
};

eventSource.onerror = (e) => {
  console.error('SSE Error:', e);
  eventSource.close();
};
```

---

### 3. Download Results

#### CSV Export
```javascript
fetch('/api/s4a/download/csv', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'your-session-id' })
})
.then(r => r.blob())
.then(blob => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 's4a-metrics.csv';
  a.click();
});
```

#### Excel Export
```javascript
fetch('/api/s4a/download/excel', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'your-session-id' })
})
.then(r => r.blob())
.then(blob => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 's4a-metrics.xlsx';
  a.click();
});
```

---

## Event Types & Payloads

### init
**When:** Session starts  
**Payload:**
```json
{
  "type": "init",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Scraper session initialized",
  "timestamp": "2026-03-26T20:14:00Z"
}
```

### progress
**When:** Artist processing updates  
**Payload:**
```json
{
  "type": "progress",
  "status": "Collecting metrics for Jean-Baptiste",
  "current": 1,
  "total": 2,
  "artistId": "5k8iZVVPpZ8mPKo9XKh8p9",
  "artistName": "Jean-Baptiste",
  "message": "Extracting track data...",
  "timestamp": "2026-03-26T20:15:00Z"
}
```

### result
**When:** Artist batch completes  
**Payload:**
```json
{
  "type": "result",
  "artistId": "5k8iZVVPpZ8mPKo9XKh8p9",
  "artistName": "Jean-Baptiste",
  "tracksProcessed": 87,
  "tracksStored": 87,
  "sampleTracks": [
    {"name": "Falling Down", "streams": 50000, "listeners": 2000},
    {"name": "Lost", "streams": 35000, "listeners": 1500}
  ]
}
```

### error
**When:** Artist processing fails  
**Payload:**
```json
{
  "type": "error",
  "artistId": "5k8iZVVPpZ8mPKo9XKh8p9",
  "artistName": "Jean-Baptiste",
  "error": "Failed to process artist Jean-Baptiste: timeout after 30s",
  "timestamp": "2026-03-26T20:15:30Z"
}
```

### complete
**When:** All artists processed  
**Payload:**
```json
{
  "type": "complete",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "totalProcessed": 350,
  "errors": 1,
  "errorDetails": [
    {"artistId": "...", "artistName": "...", "error": "..."}
  ],
  "downloadUrls": {
    "csv": "/api/s4a/download/csv?sessionId=550e8400-e29b-41d4-a716-446655440000",
    "excel": "/api/s4a/download/excel?sessionId=550e8400-e29b-41d4-a716-446655440000"
  },
  "message": "Scraping complete: 350 tracks collected",
  "timestamp": "2026-03-26T20:20:00Z",
  "duration": 360
}
```

---

## CSV Format

**Headers:** Song, Artist, Released, Days Since, Streams, Listeners, Saves, Save Ratio, Radio Streams, % Radio, Playlist Added, S/L, Impressions, Reach, Engagement, Source, Collected At

**Sample:**
```csv
"Song Name","Artist Name","2024-06-15",254,50000,2000,500,0.01,15000,30.0,100,25.0,100000,50000,50000,"spotify_for_artists_session","3/26/2026, 8:15:00 PM"
```

---

## Excel Format

**Worksheet:** "S4A Analytics"  
**Columns:** 17 (Song, Artist, Released, Days Since, Streams, Listeners, Saves, Save Ratio, Radio Streams, % Radio, Playlists Added, S/L Ratio, Impressions, Reach, Engagement, Source, Collected)

**Features:**
- ✅ Spotify green header (#1DB954)
- ✅ Frozen header row
- ✅ Alternating row colors
- ✅ Number formatting (thousands separator, %)
- ✅ Optimal column widths

---

## Common Use Cases

### Use Case 1: Quick Quality Check
```javascript
// 1. Get artists
const artists = await fetch('/api/s4a/artists').then(r => r.json());

// 2. Check specific artist
const targetArtist = artists.artists[0]; // First artist

// 3. Scrape only that artist
const sse = new EventSource('/api/s4a/scrape', {
  method: 'POST',
  body: JSON.stringify({
    artistIds: [targetArtist.id],
    playlistUrls: [],
    accountId: 'default'
  })
});

// 4. Download after complete
sse.addEventListener('complete', (e) => {
  const { downloadUrls } = JSON.parse(e.data);
  window.location = downloadUrls.csv; // Auto-download
});
```

### Use Case 2: Batch Export All Artists
```javascript
// 1. Get all artists
const resp = await fetch('/api/s4a/artists').then(r => r.json());
const allArtistIds = resp.artists.map(a => a.id);

// 2. Scrape all
const sse = new EventSource('/api/s4a/scrape', {
  method: 'POST',
  body: JSON.stringify({
    artistIds: allArtistIds,
    playlistUrls: [],
    accountId: 'default'
  })
});

// 3. Show progress in UI
let progressCount = 0;
sse.addEventListener('result', (e) => {
  progressCount++;
  updateProgressBar(progressCount, allArtistIds.length);
});

// 4. Export both formats on complete
sse.addEventListener('complete', async (e) => {
  const { downloadUrls } = JSON.parse(e.data);
  
  // Download CSV
  const csv = await fetch(downloadUrls.csv).then(r => r.blob());
  downloadFile(csv, 's4a-all-artists.csv');
  
  // Download Excel
  const xlsx = await fetch(downloadUrls.excel).then(r => r.blob());
  downloadFile(xlsx, 's4a-all-artists.xlsx');
});
```

### Use Case 3: Store in Database
```javascript
// After scraping completes, results are automatically in SQLite
// To retrieve later without re-scraping:

const artistId = '5k8iZVVPpZ8mPKo9XKh8p9';

// Export stored metrics for specific artist
fetch('/api/s4a/download/csv', {
  method: 'POST',
  body: JSON.stringify({ artistId })
})
.then(r => r.blob())
.then(blob => downloadFile(blob, 'artist-metrics.csv'));
```

---

## Error Handling

### Network Timeout
```javascript
const timeout = new Promise((_, reject) => 
  setTimeout(() => reject(new Error('Timeout')), 600000) // 10 min
);

Promise.race([
  new Promise(resolve => {
    eventSource.addEventListener('complete', (e) => {
      resolve(JSON.parse(e.data));
      eventSource.close();
    });
  }),
  timeout
]).catch(err => {
  console.error('Scraping timeout:', err);
  eventSource.close();
});
```

### Graceful Partial Completion
```javascript
const results = [];
eventSource.addEventListener('result', (e) => {
  results.push(JSON.parse(e.data));
});

eventSource.addEventListener('complete', (e) => {
  const complete = JSON.parse(e.data);
  
  if (complete.errors > 0) {
    console.warn(`Completed with ${complete.errors} errors:`);
    complete.errorDetails.forEach(err => {
      console.warn(`- ${err.artistName}: ${err.error}`);
    });
  }
  
  // Still offer downloads even with errors
  console.log(`Downloaded ${complete.totalProcessed} tracks`);
});
```

---

## Performance Tips

1. **Large Batches:** Stream SSE instead of waiting for full response
2. **Multiple Downloads:** Use sessionId to avoid re-scraping
3. **Database Queries:** Results cached in SQLite after scrape
4. **Memory:** Streaming prevents buffer overflow on large exports
5. **Parallel Users:** Each SSE connection is independent

---

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| No SSE events | Browser doesn't support EventSource | Use fetch with ReadableStream or polyfill |
| Empty results | Wrong artistIds | Verify with GET /api/s4a/artists |
| Database timeout | Too many concurrent scrapes | Serialize with queue system |
| Excel file corrupted | ExcelJS memory issue | Reduce batch size (<10k rows) |
| Download fails | CORS issue | Check headers: Access-Control-Allow-Origin |

---

## API Contract

**Base URL:** `http://localhost:3001` (development) or deployed server  
**Auth:** None required (extends existing auth system)  
**Rate Limit:** None (implement if needed)  
**Timeout:** SSE connection: 600s, Single artist: 120s  

---

**Last Updated:** March 26, 2026
