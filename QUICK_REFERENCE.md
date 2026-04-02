# S4A Analytics - Quick Reference

## 🚀 Get Started in 3 Steps

### 1. Start App
```bash
cd /Users/ck/.openclaw/workspace/spotify-sync-app
npm run dev
```

### 2. Open Browser
```
http://localhost:3000/s4a-analytics
```

### 3. Collect Metrics
- Click "Initialize Session" (first time only)
- Select artist
- Click "🚀 Start Collection"
- Wait ~30-60 seconds
- View results → Export CSV/HTML

## 🎤 Available Artists

1. Jean-Baptiste
2. Off Key.
3. Spitz Aura Records
4. A S Team
5. Amélie Cochon
6. Chowchow Records

## 📊 What Gets Collected

```
Track Name, Artist, Released, Days Since,
Streams, Listeners, Saves, Save Ratio,
Radio Streams, % Radio, Playlist Added,
S/L Ratio, Impressions, Reach, Engagement
```

## 💾 Export Options

**CSV** - Opens in Excel/Sheets
```bash
# Downloaded automatically, or via:
curl http://localhost:3000/api/s4a/export/{artist-id}/csv -o metrics.csv
```

**HTML** - Opens in browser
```bash
# Downloaded automatically, or via:
curl http://localhost:3000/api/s4a/export/{artist-id}/html -o metrics.html
```

## 🔍 Check Progress

View in real-time on page, or via API:
```bash
curl http://localhost:3000/api/s4a/job/{job-id}
```

## 🐛 Troubleshooting

### Session Issues
```bash
rm -rf .s4a-session/
# Then restart: npm run dev
```

### View Logs
```bash
# Real-time logs
tail -f /tmp/spotify-sync-error.log

# Or check console during npm run dev
```

### Database Issues
```bash
# Check what's stored
sqlite3 spotify-sync.db "SELECT COUNT(*) FROM s4a_analytics;"

# Reset database
rm spotify-sync.db
# App will recreate on restart
```

## ⚙️ Configuration

Settings in `.env`:
```
S4A_LOGIN_EMAIL=info@spitzaura.io
S4A_LOGIN_PASSWORD=Anthony_1!2@3#
S4A_HEADLESS=true
```

Change `S4A_HEADLESS=false` to see browser during collection.

## 📈 Performance

- **First init:** 3-5 seconds
- **Cached init:** <1 second
- **Per artist:** 30-60 seconds
- **Export:** <1 second

## 🔗 API Endpoints

```
POST   /api/s4a/init-session              Initialize
POST   /api/s4a/collect/:artistId         Start collection
GET    /api/s4a/job/:jobId                Check status
GET    /api/s4a/metrics/:artistId         Get metrics
GET    /api/s4a/export/:artistId/csv      Download CSV
GET    /api/s4a/export/:artistId/html     Download HTML
POST   /api/s4a/match-playlist            Match tracks
POST   /api/s4a/close-session             Cleanup
```

## 📖 Full Documentation

- **[S4A_ANALYTICS_README.md](./S4A_ANALYTICS_README.md)** - Complete feature guide
- **[SETUP_S4A.md](./SETUP_S4A.md)** - Step-by-step testing
- **[INTEGRATION.md](./INTEGRATION.md)** - Architecture details
- **[COMPLETION_SUMMARY.md](./COMPLETION_SUMMARY.md)** - What was built

## ❓ FAQ

**Q: How often should I collect?**
A: As needed. Each collection overwrites previous data for the same artist.

**Q: Can I collect multiple artists at once?**
A: Yes, but recommended to do one at a time to avoid browser resource issues.

**Q: Where is data stored?**
A: In SQLite database `spotify-sync.db` in the `s4a_analytics` table.

**Q: Can I delete old metrics?**
A: Yes, query the database directly:
```bash
sqlite3 spotify-sync.db "DELETE FROM s4a_analytics WHERE artist_id = 'id';"
```

**Q: How much storage do metrics use?**
A: ~1KB per track. 100 tracks ≈ 100KB.

## 🎯 Typical Workflow

```
1. npm run dev
2. Open http://localhost:3000/s4a-analytics
3. Select "Jean-Baptiste"
4. Click "Start Collection" → Wait ~40 seconds
5. View results in table
6. Click "Export CSV" → Metrics saved to Downloads
7. Click "Collect Another" → Select next artist
8. Repeat for all artists
9. Done! All metrics exported
```

## 🛠️ Maintenance

### Daily
- Collect metrics for active artists
- Export and analyze results

### Weekly
- Check disk usage: `du -h spotify-sync.db`
- Review error logs: `tail /tmp/spotify-sync-error.log`

### Monthly
- Archive old data (optional)
- Update artist roster if needed

## 📞 Getting Help

1. **Check logs first:**
   ```bash
   tail -f /tmp/spotify-sync-error.log
   ```

2. **Reset if stuck:**
   ```bash
   rm -rf .s4a-session/
   npm run dev
   ```

3. **Read docs:**
   - [S4A_ANALYTICS_README.md](./S4A_ANALYTICS_README.md)
   - [SETUP_S4A.md](./SETUP_S4A.md)

## ✅ Status Check

```bash
# Test health
curl http://localhost:3000/api/health

# Test S4A
curl -X POST http://localhost:3000/api/s4a/init-session

# Check database
sqlite3 spotify-sync.db ".tables"
```

All should return success ✅

---

**That's it! You're ready to go.** 🚀

Questions? Check the docs or logs!
