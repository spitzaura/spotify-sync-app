# S4A Analytics Setup & Testing Guide

Complete instructions for setting up, testing, and deploying the Spotify for Artists analytics collector.

## ✅ Pre-Flight Checklist

Before starting, ensure:
- [ ] Node.js v20+ installed
- [ ] npm dependencies installed: `npm install`
- [ ] Playwright installed: `npm list playwright`
- [ ] SQLite3 available: `sqlite3 --version`
- [ ] `.env` file configured with S4A credentials
- [ ] Spotify account with S4A access (info@spitzaura.io)

## 📦 Installation

### 1. Install Dependencies
```bash
cd /Users/ck/.openclaw/workspace/spotify-sync-app
npm install
npm install -g concurrently
```

Verify Playwright is installed:
```bash
npm list playwright
# Output: playwright@1.58.2
```

### 2. Build Frontend
```bash
cd client
npm install
npm run build
```

### 3. Verify Database
The app automatically creates tables on first run. To manually initialize:
```bash
sqlite3 spotify-sync.db
.tables
# Should show: accounts, master_groups, synced_playlists, trades, song_metrics, s4a_analytics, s4a_sessions, s4a_collection_jobs
.quit
```

## 🚀 Running the Application

### Option A: Development Mode (with hot reload)
```bash
npm run dev
```

This starts:
- Backend server on `http://localhost:3000`
- Frontend dev server with hot reload
- Both services log to console

### Option B: Production Mode
```bash
# Build frontend
npm run build

# Start server only
npm run server
```

Visit: `http://localhost:3000`

### Option C: Debug Mode (Playwright visible)
```bash
S4A_HEADLESS=false npm run server
```

The browser will be visible during S4A operations for debugging.

## 🧪 Testing

### 1. Health Check
```bash
curl http://localhost:3000/api/health
# Response: {"status":"ok","time":"2026-03-26T12:00:00Z"}
```

### 2. Initialize S4A Session
```bash
curl -X POST http://localhost:3000/api/s4a/init-session
# Response:
# {
#   "status": "authenticated",
#   "artists": [...],
#   "message": "S4A session initialized successfully"
# }
```

### 3. Collect Analytics for an Artist
```bash
curl -X POST http://localhost:3000/api/s4a/collect/5k8iZVVPpZ8mPKo9XKh8p9 \
  -H "Content-Type: application/json" \
  -d '{"artistName": "Jean-Baptiste"}'

# Response:
# {
#   "jobId": "550e8400-e29b-41d4-a716-446655440000",
#   "status": "started",
#   "message": "Collecting metrics for Jean-Baptiste..."
# }
```

Save the `jobId` for next step.

### 4. Check Job Progress
```bash
curl http://localhost:3000/api/s4a/job/550e8400-e29b-41d4-a716-446655440000

# Response:
# {
#   "id": "550e8400-e29b-41d4-a716-446655440000",
#   "artist_id": "5k8iZVVPpZ8mPKo9XKh8p9",
#   "artist_name": "Jean-Baptiste",
#   "status": "running",
#   "total_tracks": 0,
#   "processed_tracks": 0,
#   "error_message": null,
#   "started_at": "2026-03-26T12:00:00Z",
#   "completed_at": null
# }
```

Poll every 2-3 seconds until `status` is `completed` or `failed`.

### 5. Get Collected Metrics
```bash
curl http://localhost:3000/api/s4a/metrics/5k8iZVVPpZ8mPKo9XKh8p9

# Response:
# {
#   "artist_id": "5k8iZVVPpZ8mPKo9XKh8p9",
#   "count": 42,
#   "metrics": [
#     {
#       "id": "uuid",
#       "track_name": "Song Name",
#       "streams": 1000000,
#       ...
#     }
#   ]
# }
```

### 6. Export as CSV
```bash
curl http://localhost:3000/api/s4a/export/5k8iZVVPpZ8mPKo9XKh8p9/csv \
  -o s4a-metrics.csv

# Opens file with: open s4a-metrics.csv
```

### 7. Export as HTML
```bash
curl http://localhost:3000/api/s4a/export/5k8iZVVPpZ8mPKo9XKh8p9/html \
  -o s4a-metrics.html

# Opens in browser: open s4a-metrics.html
```

### 8. Close Session
```bash
curl -X POST http://localhost:3000/api/s4a/close-session

# Response:
# {
#   "status": "closed",
#   "message": "S4A session closed"
# }
```

## 🎨 Frontend Testing

### 1. Navigate to S4A Analytics
Open browser: `http://localhost:3000/s4a-analytics`

### 2. UI Test Sequence
- [ ] Page loads with "Select Artist" section
- [ ] Artists list displays all available artists
- [ ] Click an artist - it highlights with green border
- [ ] Click "🚀 Start Collection" button
- [ ] Page transitions to "Collecting" stage
- [ ] Progress bar appears and updates
- [ ] Status shows "Scraping S4A dashboard..."
- [ ] Metrics count increases (or shows completed message)
- [ ] Page transitions to "Results" stage
- [ ] Metrics table displays with data
- [ ] Statistics cards show totals (streams, listeners, saves, playlists)
- [ ] "📥 Export CSV" button works
- [ ] "📊 Export HTML" button works
- [ ] "🔄 Collect Another" returns to artist selection

### 3. Error Handling Tests
- [ ] Close session before starting collection (should auto-reinit)
- [ ] Try invalid artist ID (should show error)
- [ ] Disconnect internet mid-collection (should show error with retry option)
- [ ] Session expires (should prompt re-login)

## 🔍 Debugging

### View Logs
```bash
# Realtime logs
tail -f /tmp/spotify-sync-error.log

# Server console output (when running npm run dev)
# Logs show [TIMESTAMP] [LEVEL] [CONTEXT] message format
```

### Debug Database
```bash
sqlite3 spotify-sync.db

# Show all tables
.tables

# View S4A analytics data
SELECT artist_id, track_name, streams, listeners FROM s4a_analytics LIMIT 10;

# View collection jobs
SELECT * FROM s4a_collection_jobs;

# Export to CSV for analysis
.mode csv
.output export.csv
SELECT * FROM s4a_analytics;
.quit
```

### Debug Session
```bash
# Check session cache
ls -la .s4a-session/

# View cached cookies
cat .s4a-session/cookies.json | jq '.'

# View browser user data
ls -la .s4a-session/browser-data/

# Clear session to force re-login
rm -rf .s4a-session/

# Run with visible browser
S4A_HEADLESS=false npm run server
```

### Debug Network
```bash
# Monitor API requests
open http://localhost:3000
# Press Cmd+Opt+I to open DevTools
# Go to Network tab
# Trigger collection and monitor requests

# Check server errors
curl -v http://localhost:3000/api/s4a/init-session
```

## 📊 Performance Testing

### Single Artist Collection Time
```bash
time curl -X POST http://localhost:3000/api/s4a/collect/artist-id \
  -H "Content-Type: application/json" \
  -d '{"artistName":"Test"}'
  
# Monitor job until completion
while true; do
  curl http://localhost:3000/api/s4a/job/JOB_ID | jq '.status'
  sleep 2
done
```

Expected times:
- Session init (first run): 3-5 seconds
- Session init (cached): <1 second
- Per-artist collection: 30-60 seconds
- Data extraction: ~50-100ms per page scroll

### Load Testing
```bash
# Test concurrent collections (requires multiple artist IDs)
for artist in "id1" "id2" "id3" "id4"; do
  curl -X POST http://localhost:3000/api/s4a/collect/$artist \
    -H "Content-Type: application/json" \
    -d "{\"artistName\":\"Artist\"}" &
done
wait

# Monitor database size
du -h spotify-sync.db
```

## 🔐 Security Testing

### 1. Credential Security
```bash
# Verify no plaintext passwords in code
grep -r "Anthony_1" . --exclude-dir=node_modules --exclude-dir=.git

# Verify passwords only in .env
grep -r "S4A_LOGIN" . --exclude-dir=node_modules
# Should only find: .env file
```

### 2. Session Security
```bash
# Verify cookies are properly scoped
cat .s4a-session/cookies.json | jq '.[].sameSite'

# Verify no sensitive data in logs
grep -i "password\|token\|secret" /tmp/spotify-sync-error.log

# Verify database file permissions
ls -la spotify-sync.db
# Should be: -rw-r--r--
```

## 📋 Validation Checklist

- [ ] All S4A modules load without errors
- [ ] Database tables created successfully
- [ ] API endpoints respond with correct status codes
- [ ] Frontend page renders without JavaScript errors
- [ ] Session initialization works (first run and cached)
- [ ] Artist switching works correctly
- [ ] Track metrics extracted accurately
- [ ] Pagination/scrolling handles all tracks
- [ ] Error handling shows user-friendly messages
- [ ] CSV export generates valid file
- [ ] HTML export displays correctly in browser
- [ ] Database queries run efficiently
- [ ] No crashes with 100+ track catalog
- [ ] Handles network interruptions gracefully
- [ ] Logging is comprehensive and useful

## 🚀 Deployment

### Production Setup
1. Build frontend: `npm run build`
2. Set environment variables in `.env`
3. Run server: `npm run server`
4. Monitor logs: `tail -f /tmp/spotify-sync-error.log`
5. Keep process alive: Use `pm2` or similar

### PM2 Configuration
```bash
npm install -g pm2

# Start with PM2
pm2 start server/index.js --name "spotify-sync"

# Auto-restart on crash
pm2 restart spotify-sync

# Monitor
pm2 monit
pm2 logs
```

## 🎯 Troubleshooting Common Issues

### Issue: "S4A session failed to authenticate"
**Solution:**
1. Delete `.s4a-session/` directory
2. Verify `.env` has correct credentials
3. Check S4A account is active (login to artists.spotify.com manually)
4. Run with visible browser: `S4A_HEADLESS=false npm run server`

### Issue: "No tracks extracted"
**Solution:**
1. Verify artist has published tracks
2. Check browser console for JavaScript errors
3. Verify S4A dashboard loads correctly
4. Check network requests in DevTools

### Issue: "Database locked" error
**Solution:**
```bash
# Close all connections
pkill -f "node.*server"
rm spotify-sync.db-wal
rm spotify-sync.db-shm
npm run server
```

### Issue: "Port 3000 already in use"
**Solution:**
```bash
# Find process using port
lsof -i :3000

# Kill it
kill -9 <PID>

# Or use different port
PORT=3001 npm run server
```

## 📞 Support Contacts

- **S4A Account Issues:** info@spitzaura.io
- **Technical Issues:** Check `/tmp/spotify-sync-error.log`
- **Database Issues:** `sqlite3 spotify-sync.db`.tables`
- **Browser Issues:** Use `S4A_HEADLESS=false` to debug

---

**Last Updated:** 2026-03-26
**Status:** Production Ready ✅
