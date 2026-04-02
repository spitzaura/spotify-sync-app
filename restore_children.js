const fs = require('fs');
const Database = require('better-sqlite3');

const backupPath = '/Users/ck/.openclaw/workspace/spotify-sync-app/BACKUP_data.json';
const dbPath = '/Users/ck/.openclaw/workspace/spotify-sync-app/spotify-sync.db';

// Read backup
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const backupAccounts = JSON.parse(backup.find(r => r.table_name === 'accounts').data);
const childData = backup.find(r => r.table_name === 'child_playlists');

if (!childData) {
  console.error('No child_playlists data in backup');
  process.exit(1);
}

const children = JSON.parse(childData.data);
console.log(`Found ${children.length} children in backup`);

// Connect to DB
const db = new Database(dbPath);

// Build mapping: old account ID → new account ID (by email)
const accountMap = {};
const currentAccounts = db.prepare("SELECT id, email FROM accounts WHERE email IS NOT NULL AND email != ''").all();

for (const oldAcc of backupAccounts) {
  const newAcc = currentAccounts.find(a => a.email === oldAcc.email);
  if (newAcc) {
    accountMap[oldAcc.id] = newAcc.id;
    console.log(`Map: ${oldAcc.email} (${oldAcc.id}) → ${newAcc.id}`);
  } else {
    console.warn(`⚠️  No match for ${oldAcc.email} (${oldAcc.id})`);
  }
}

// Clear existing children
db.prepare('DELETE FROM child_playlists').run();
console.log('Cleared existing children');

// Insert all children with mapped account IDs
const stmt = db.prepare(`
  INSERT INTO child_playlists (id, group_id, playlist_id, playlist_name, account_id)
  VALUES (?, ?, ?, ?, ?)
`);

const insert = db.transaction(children => {
  let inserted = 0;
  let skipped = 0;
  
  for (const child of children) {
    const newAccountId = accountMap[child.account_id];
    if (!newAccountId) {
      console.warn(`Skipping child (no account mapping): ${child.playlist_name}`);
      skipped++;
      continue;
    }
    stmt.run(child.id, child.group_id, child.playlist_id, child.playlist_name, newAccountId);
    inserted++;
  }
  
  console.log(`Inserted: ${inserted}, Skipped: ${skipped}`);
});

insert(children);

// Verify
const count = db.prepare('SELECT COUNT(*) as c FROM child_playlists').get().c;
console.log(`✅ Database now has ${count} children`);

db.close();
