/**
 * S4A Fast Scraper Wrapper
 * 
 * Integrates the proven s4a_fast_scraper.py into the backend.
 * - Uses internal Spotify API for stats (fast)
 * - Only 1 page navigation per song (not 3)
 * - Persistent Chrome session
 * - Restarts every 25 scrapes for stability
 * - Proven to work by Master's friend
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { v4: uuidv4 } = require('uuid');

const SCRAPER_SCRIPT = path.join(__dirname, 's4a_fast_scraper.py');

/**
 * Simple CSV parser (no external dependency)
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));
    
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    
    if (obj['Track ID'] || obj['Playlist URL']) {
      results.push(obj);
    }
  }
  
  return results;
}

/**
 * Convert S4A URLs to generate list file
 */
function createUrlsFile(urls) {
  const tempFile = path.join('/tmp', `s4a_urls_${uuidv4()}.txt`);
  fs.writeFileSync(tempFile, urls.join('\n'));
  return tempFile;
}

/**
 * Start the proven scraper
 * Returns: sessionId and streaming response writer
 */
function startFastScraper(urls, onProgress, onLog, onComplete, onError) {
  const tempUrlFile = createUrlsFile(urls);
  const outputFile = path.join('/tmp', `s4a_output_${uuidv4()}.csv`);
  
  console.log(`[S4A-FAST] Starting scraper for ${urls.length} URLs`);
  console.log(`[S4A-FAST] URLs file: ${tempUrlFile}`);
  console.log(`[S4A-FAST] Output file: ${outputFile}`);
  
  // Modify the scraper to use our output file
  const pythonArgs = [SCRAPER_SCRIPT];
  
  // Pass env vars to override input/output files
  const env = {
    ...process.env,
    S4A_INPUT_FILE: tempUrlFile,
    S4A_OUTPUT_FILE: outputFile,
    PYTHONUNBUFFERED: '1'
  };
  
  const scraper = spawn('python3', pythonArgs, {
    cwd: path.dirname(SCRAPER_SCRIPT),
    env,
    timeout: 5400000, // 90 minutes
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let currentUrl = 0;
  let allOutput = '';
  
  scraper.stdout.on('data', (data) => {
    const text = data.toString();
    allOutput += text;
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      // Parse scraper output
      if (line.includes('[') && line.includes(']')) {
        // Progress line like: "🔍 [5/50] https://..."
        const match = line.match(/\[(\d+)\/(\d+)\]/);
        if (match) {
          currentUrl = parseInt(match[1]);
          const total = parseInt(match[2]);
          const percentage = Math.round((currentUrl / total) * 100);
          
          onProgress({
            current: currentUrl,
            total,
            percentage,
            message: line.substring(0, 100)
          });
        }
      }
      
      // Log any output
      if (line.trim()) {
        onLog({
          message: line,
          level: line.includes('❌') ? 'ERROR' : 
                 line.includes('⚠️') ? 'WARN' : 'INFO'
        });
      }
    }
  });
  
  scraper.stderr.on('data', (data) => {
    const msg = data.toString();
    console.error(`[S4A-FAST-ERR] ${msg}`);
    onError(msg);
  });
  
  scraper.on('close', (code) => {
    console.log(`[S4A-FAST] Scraper exited with code ${code}`);
    
    if (code === 0) {
      // Read CSV output
      setTimeout(() => {
        try {
          if (fs.existsSync(outputFile)) {
            const csvData = fs.readFileSync(outputFile, 'utf-8');
            const results = parseCSV(csvData);
            
            onComplete({
              success: true,
              results,
              outputFile
            });
          } else {
            onError('Output file not created');
            onComplete({ success: false, results: [], outputFile });
          }
        } catch (err) {
          onError(`Failed to read output: ${err.message}`);
          onComplete({ success: false, results: [], outputFile });
        } finally {
          // Cleanup
          try {
            fs.unlinkSync(tempUrlFile);
            if (fs.existsSync(outputFile)) {
              fs.unlinkSync(outputFile);
            }
          } catch (e) {
            console.warn(`[S4A-FAST] Cleanup failed: ${e.message}`);
          }
        }
      }, 2000); // Wait for file flush
    } else {
      onError(`Scraper exited with code ${code}`);
      onComplete({ success: false, results: [], outputFile });
    }
  });
  
  return scraper;
}

/**
 * Convert CSV results to metrics and save to database
 */
function saveResultsToMetrics(results, callback) {
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO song_metrics (
        spotify_uri, track_name, artist_name, 
        streams, listeners, saves, save_ratio,
        radio_streams, radio_percent, playlists_added,
        last_updated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let saved = 0;
    let skipped = 0;
    
    for (const row of results) {
      try {
        // Extract Spotify URI from URL
        // Format: https://artists.spotify.com/c/artist/ID/song/TRACK_ID
        const trackIdMatch = row['Track ID'] || (row['Playlist URL'] && row['Playlist URL'].match(/song\/([^/]+)/)?.[1]);
        
        if (!trackIdMatch) {
          console.warn(`Skipping row: no track ID found`, row);
          skipped++;
          continue;
        }
        
        const spotify_uri = `spotify:track:${trackIdMatch}`;
        const streams = parseInt(row['Streams (28d)']?.replace(/,/g, '') || '0') || 0;
        const listeners = parseInt(row['Listeners (28d)']?.replace(/,/g, '') || '0') || 0;
        const saves = parseInt(row['Saves (28d)']?.replace(/,/g, '') || '0') || 0;
        const radio_streams = parseInt(row['Radio Streams']?.replace(/,/g, '') || '0') || 0;
        const playlists_added = parseInt(row['Playlist Adds']?.replace(/,/g, '') || '0') || 0;
        
        // Calculate ratios
        const save_ratio = listeners > 0 ? (saves / listeners) * 100 : 0;
        const radio_percent = streams > 0 ? (radio_streams / streams) * 100 : 0;
        
        const now = new Date().toISOString();
        
        stmt.run(
          spotify_uri,
          row['Track ID'] || 'Unknown',
          row['Artist ID'] || 'Unknown',
          streams,
          listeners,
          saves,
          save_ratio,
          radio_streams,
          radio_percent,
          playlists_added,
          now,
          now
        );
        
        saved++;
        console.log(`[S4A-FAST] Saved: ${spotify_uri} (${streams} streams)`);
      } catch (err) {
        console.warn(`[S4A-FAST] Failed to save row:`, err.message, row);
        skipped++;
      }
    }
    
    callback({
      saved,
      total: results.length,
      skipped,
      message: `Saved ${saved} metrics to database`
    });
  } catch (err) {
    console.error('[S4A-FAST] Save error:', err);
    callback({
      saved: 0,
      total: results.length,
      error: err.message
    });
  }
}

/**
 * Get track IDs from metrics table for enrichment
 */
function getTrackUrlsFromMetrics(trackIds, callback) {
  try {
    if (!trackIds || trackIds.length === 0) {
      callback([]);
      return;
    }
    
    const placeholders = trackIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT spotify_uri, track_name, artist_name FROM song_metrics 
      WHERE id IN (${placeholders})
      LIMIT 100
    `);
    
    const rows = stmt.all(...trackIds);
    console.log(`[S4A-FAST] Found ${rows.length} tracks to enrich`);
    
    callback(rows);
  } catch (err) {
    console.error('[S4A-FAST] Error getting tracks:', err);
    callback([]);
  }
}

module.exports = {
  startFastScraper,
  saveResultsToMetrics,
  getTrackUrlsFromMetrics,
  SCRAPER_SCRIPT
};
