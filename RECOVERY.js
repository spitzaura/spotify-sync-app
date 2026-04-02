#!/usr/bin/env node

/**
 * RECOVERY SCRIPT
 * 
 * Restores all playlists from backup if DB gets corrupted or lost.
 * 
 * Usage:
 *   node RECOVERY.js --restore
 *   node RECOVERY.js --verify
 * 
 * This reads BACKUP_data.json and BACKUP_spotify-sync.db and restores:
 * - All accounts (with auth keys)
 * - All master groups + master playlist assignments
 * - All child playlists + group assignments
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const BACKUP_DIR = __dirname;
const BACKUP_JSON = path.join(BACKUP_DIR, 'BACKUP_data.json');
const BACKUP_DB = path.join(BACKUP_DIR, 'BACKUP_spotify-sync.db');
const CURRENT_DB = path.join(BACKUP_DIR, 'spotify-sync.db');

function logInfo(msg) { console.log(`[✓] ${msg}`); }
function logWarn(msg) { console.warn(`[!] ${msg}`); }
function logError(msg) { console.error(`[✗] ${msg}`); }
function logSection(msg) { console.log(`\n${'═'.repeat(60)}\n${msg}\n${'═'.repeat(60)}`); }

function verify() {
  logSection('VERIFICATION');
  
  // Check backup files exist
  const jsonExists = fs.existsSync(BACKUP_JSON);
  const dbExists = fs.existsSync(BACKUP_DB);
  
  logInfo(`Backup JSON: ${jsonExists ? '✅ EXISTS' : '❌ MISSING'}`);
  logInfo(`Backup DB: ${dbExists ? '✅ EXISTS' : '❌ MISSING'}`);
  
  if (!jsonExists || !dbExists) {
    logError('Backups incomplete — recovery not possible');
    process.exit(1);
  }
  
  // Parse JSON
  let backupData;
  try {
    backupData = JSON.parse(fs.readFileSync(BACKUP_JSON, 'utf8'));
    logInfo('Backup JSON is valid');
  } catch (e) {
    logError(`Invalid JSON: ${e.message}`);
    process.exit(1);
  }
  
  // Count entities
  const accounts = backupData.find(r => r.table_name === 'accounts')?.data || [];
  const groups = backupData.find(r => r.table_name === 'master_groups')?.data || [];
  const children = backupData.find(r => r.table_name === 'child_playlists')?.data || [];
  
  logInfo(`Backup contains:`);
  console.log(`   • ${accounts.length} accounts`);
  console.log(`   • ${groups.length} master groups`);
  console.log(`   • ${children.length} child playlists`);
  
  // Check DB
  try {
    const backupDb = new Database(BACKUP_DB);
    const accountCount = backupDb.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
    const groupCount = backupDb.prepare('SELECT COUNT(*) as c FROM master_groups').get().c;
    const childCount = backupDb.prepare('SELECT COUNT(*) as c FROM child_playlists').get().c;
    backupDb.close();
    
    logInfo(`Backup DB contains:`);
    console.log(`   • ${accountCount} accounts`);
    console.log(`   • ${groupCount} master groups`);
    console.log(`   • ${childCount} child playlists`);
    
    if (accounts.length !== accountCount || groups.length !== groupCount || children.length !== childCount) {
      logWarn('JSON and DB counts mismatch — check backup integrity');
    } else {
      logInfo('JSON and DB match ✅');
    }
  } catch (e) {
    logError(`Backup DB error: ${e.message}`);
  }
  
  logSection('DONE');
  process.exit(0);
}

function restore() {
  logSection('RECOVERY - RESTORING FROM BACKUP');
  
  // Verify backups exist
  if (!fs.existsSync(BACKUP_JSON) || !fs.existsSync(BACKUP_DB)) {
    logError('Backup files missing — cannot recover');
    process.exit(1);
  }
  
  // Check if current DB exists
  const dbExists = fs.existsSync(CURRENT_DB);
  if (dbExists) {
    logWarn(`Current DB exists at ${CURRENT_DB}`);
    console.log('Options:');
    console.log('  1. Restore will OVERWRITE it');
    console.log('  2. Current DB will be backed up as spotify-sync.db.old');
    
    // Backup current
    const oldPath = CURRENT_DB + '.old';
    if (fs.existsSync(oldPath)) {
      logWarn(`Previous backup exists at ${oldPath} — will be replaced`);
    }
    try {
      fs.copyFileSync(CURRENT_DB, oldPath);
      logInfo(`✅ Current DB backed up to ${oldPath}`);
    } catch (e) {
      logError(`Failed to backup current DB: ${e.message}`);
      process.exit(1);
    }
  }
  
  // Restore DB file
  try {
    fs.copyFileSync(BACKUP_DB, CURRENT_DB);
    logInfo(`✅ Restored DB: ${CURRENT_DB}`);
  } catch (e) {
    logError(`Failed to restore DB: ${e.message}`);
    process.exit(1);
  }
  
  // Verify restoration
  try {
    const db = new Database(CURRENT_DB);
    const accountCount = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c;
    const groupCount = db.prepare('SELECT COUNT(*) as c FROM master_groups').get().c;
    const childCount = db.prepare('SELECT COUNT(*) as c FROM child_playlists').get().c;
    db.close();
    
    logInfo('✅ Restoration verified:');
    console.log(`   • ${accountCount} accounts restored`);
    console.log(`   • ${groupCount} master groups restored`);
    console.log(`   • ${childCount} child playlists restored`);
  } catch (e) {
    logError(`Restoration verification failed: ${e.message}`);
    process.exit(1);
  }
  
  logSection('RECOVERY COMPLETE');
  console.log('\n✅ All playlists and accounts have been restored!');
  console.log('\nNext steps:');
  console.log('  1. Restart the server: npm start');
  console.log('  2. All groups and children should reappear in the UI');
  console.log('  3. Verify in the dashboard\n');
  
  process.exit(0);
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === '--restore') {
  restore();
} else if (cmd === '--verify') {
  verify();
} else {
  console.log('Spotify Sync App — Recovery Tool\n');
  console.log('Usage:');
  console.log('  node RECOVERY.js --verify   Check backup integrity');
  console.log('  node RECOVERY.js --restore  Restore from backup\n');
  console.log('Backups stored at:');
  console.log(`  • JSON: ${BACKUP_JSON}`);
  console.log(`  • DB: ${BACKUP_DB}\n`);
  process.exit(0);
}
