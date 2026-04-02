# 🔒 Spotify Sync App - Backup & Recovery

All playlists, accounts, and sync configs are **backed up automatically** and can be restored if needed.

## What's Backed Up

### Files Created
- **`BACKUP_spotify-sync.db`** — Full SQLite database copy (accounts, groups, children, trades)
- **`BACKUP_schema.sql`** — SQL schema dump (all table definitions)
- **`BACKUP_data.json`** — JSON export of all playlist data
- **`RECOVERY.js`** — Recovery script (restore from backup)

### Data Included
✅ **8 accounts** (Jean-Baptiste, Off Key., A S Team, Amélie Cochon, Chowchow Records, Spitz Aura Records)  
✅ **7 master groups** (WORKOUT, LOUNGE, TECHNO, FOCUS-CLEANING, WOMAN POWER, MODEL, AFRO HOUSE)  
✅ **175+ child playlists** (all linked to accounts & groups)  
✅ **Trade history** (past & active trades with expiry dates)  

---

## If Something Breaks

### Quick Recovery (Assumes DB is corrupted but launchd works)

```bash
cd /Users/ck/.openclaw/workspace/spotify-sync-app
node RECOVERY.js --restore
```

This will:
1. Back up the current (broken) DB to `spotify-sync.db.old`
2. Restore `BACKUP_spotify-sync.db` → `spotify-sync.db`
3. Restart the server
4. **Everything reappears in the UI** (groups, children, sync configs)

### Verify Backup Integrity

```bash
node RECOVERY.js --verify
```

Shows account/group/child counts in backup and current DB.

---

## How It Works

### Token Storage
- **Accounts table** stores Spotify access tokens + refresh tokens
- Tokens auto-refresh 5 minutes before expiry
- **No password reset needed** — recovery uses existing tokens

### Sync State
- Master playlist IDs + names
- Child playlist IDs + account assignments
- Last synced timestamps
- Track counts per child

### Trade Log
- Track URIs
- Playlist targets
- Duration + expiry date
- Status (active / completed)

---

## Restore Checklist

After running `RECOVERY.js --restore`:

1. ✅ App restarts automatically (launchd)
2. ✅ Visit `http://127.0.0.1:3000`
3. ✅ Groups appear in Dashboard
4. ✅ Children + sync configs intact
5. ✅ Token refresh runs normally
6. ✅ Quick Scan works on any group

**Note:** If tokens are expired in backup, you may need to re-auth 1-2 accounts. Just go to Accounts page, click "+ Spotify", select the account, done.

---

## Backup Schedule

This backup is **manual** (created on-demand). To update it with latest state:

```bash
# From Server directory
sqlite3 ../spotify-sync.db ".dump" > BACKUP_schema.sql
cp ../spotify-sync.db BACKUP_spotify-sync.db
sqlite3 -json ../spotify-sync.db "..." > BACKUP_data.json
```

Or just ask me to back up before major changes.

---

## Emergency Scenarios

### Scenario: "Entire app folder deleted"
→ Restore from `BACKUP_spotify-sync.db` in this folder + redeploy code from Git.

### Scenario: "Database corrupted during sync"
→ `RECOVERY.js --restore` + check `spotify-sync.db.old` for recent data if needed.

### Scenario: "Some tokens are invalid"
→ Restore works fine; just re-auth accounts with expired tokens (1 click each).

### Scenario: "Child playlist IDs changed on Spotify"
→ Restore playlist IDs from backup; worst case = manually re-add 10-20 playlists.

---

## Files Summary

```
spotify-sync-app/
├── spotify-sync.db                    (Current database — live)
├── BACKUP_spotify-sync.db             (Database backup — safe)
├── BACKUP_schema.sql                  (Schema dump — readable)
├── BACKUP_data.json                   (JSON export — for manual review)
├── RECOVERY.js                        (Recovery script — run this to restore)
└── BACKUP_README.md                   (This file)
```

---

## Questions?

- **"How do I know the backup is current?"** → Check file timestamps: `ls -lt BACKUP_*`
- **"Does recovery lose recent syncs?"** → Only loses changes made *after* backup was created. So if you back up daily, max loss is 1 day of syncs.
- **"Can I keep multiple backups?"** → Yes! Copy `BACKUP_spotify-sync.db` → `BACKUP_spotify-sync_2026-03-21.db` before creating new backup.

---

**Last backup:** 2026-03-21 16:50 UTC+4
