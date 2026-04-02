/**
 * S4A Scraper Routes
 * 
 * Handles:
 * - Scraper initiation and progress streaming
 * - Results storage and export
 * - Playlist URL extraction and matching
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const spotify = require('./spotify');

const router = express.Router();
const SCRAPER_SCRIPT = path.join(__dirname, 's4a_scraper.py');

// Store active scrape sessions for progress tracking
const activeSessions = new Map();

/**
 * POST /api/s4a/scrape
 * Start scraping S4A metrics for given URLs or artist
 * 
 * Body: {
 *   urls?: string[] - Array of S4A song URLs
 *   artist_ids?: string[] - Array of artist IDs
 *   headless?: boolean - Run browser headless
 * }
 */
router.post('/api/s4a/scrape', (req, res) => {
  const { urls, artist_ids, headless = true } = req.body;
  
  if ((!urls || urls.length === 0) && (!artist_ids || artist_ids.length === 0)) {
    return res.status(400).json({ error: 'urls or artist_ids required' });
  }
  
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    status: 'starting',
    urls: urls || [],
    artist_ids: artist_ids || [],
    results: [],
    progress: { current: 0, total: urls?.length || 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };
  
  activeSessions.set(sessionId, session);
  
  // Send SSE header
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial response
  res.write(`data: ${JSON.stringify({ type: 'session-started', sessionId })}\n\n`);
  
  // Start scraper in background
  startScraper(sessionId, urls || [], artist_ids?.[0], headless, res);
});

/**
 * GET /api/s4a/scrape/:sessionId
 * Get progress for a scraping session
 */
router.get('/api/s4a/scrape/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    id: sessionId,
    status: session.status,
    progress: session.progress,
    results_count: session.results.length,
    started_at: session.startedAt,
    completed_at: session.completedAt,
    error: session.error
  });
});

/**
 * GET /api/s4a/scrape/:sessionId/results
 * Get full results from completed scrape
 */
router.get('/api/s4a/scrape/:sessionId/results', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  if (session.status !== 'completed') {
    return res.status(400).json({ error: 'Scrape not completed yet' });
  }
  
  res.json({
    session_id: sessionId,
    status: session.status,
    total: session.results.length,
    results: session.results
  });
});

/**
 * GET /api/s4a/scrape/:sessionId/export/csv
 * Export results as CSV
 */
router.get('/api/s4a/scrape/:sessionId/export/csv', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session || session.status !== 'completed') {
    return res.status(400).json({ error: 'Session not found or not completed' });
  }
  
  try {
    const csv = generateCSV(session.results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="s4a-${sessionId.substring(0, 8)}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/s4a/store-results
 * Store scraped results in database
 */
router.post('/api/s4a/store-results', (req, res) => {
  const { sessionId, artist_id, artist_name, results } = req.body;
  
  if (!artist_id || !artist_name || !results || !Array.isArray(results)) {
    return res.status(400).json({ error: 'artist_id, artist_name, and results array required' });
  }
  
  try {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO s4a_analytics (
        id, spotify_uri, track_name, artist_id, artist_name, track_id,
        streams, listeners, saves, radio_streams, radio_percentage,
        playlist_adds, impressions, reach, raw_s4a_data,
        source, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let stored = 0;
    for (const result of results) {
      try {
        stmt.run(
          uuidv4(),
          result.spotify_uri || null,
          result.track_name || 'Unknown',
          artist_id,
          artist_name,
          result.track_id || null,
          result.streams || 0,
          result.listeners || 0,
          result.saves || 0,
          result.radio_streams || 0,
          result.radio_percentage || 0,
          result.playlist_adds || 0,
          result.impressions || 0,
          result.reach || 0,
          JSON.stringify(result),
          's4a_scraper',
          new Date().toISOString()
        );
        stored++;
      } catch (err) {
        console.warn(`Could not store result for ${result.track_name}:`, err.message);
      }
    }
    
    res.json({
      stored,
      total: results.length,
      message: `Stored ${stored} results for ${artist_name}`
    });
  } catch (err) {
    console.error('Store results error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/s4a/metrics/:artist_id
 * Get stored metrics for an artist
 */
router.get('/api/s4a/metrics/:artist_id', (req, res) => {
  const { artist_id } = req.params;
  
  try {
    const stmt = db.prepare(`
      SELECT * FROM s4a_analytics
      WHERE artist_id = ?
      ORDER BY streams DESC
    `);
    
    const metrics = stmt.all(artist_id);
    
    res.json({
      artist_id,
      count: metrics.length,
      metrics
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * START SCRAPER SUBPROCESS
 */
function startScraper(sessionId, urls, artistId, headless, res) {
  const session = activeSessions.get(sessionId);
  
  // Write URLs to temp file
  const tempFile = path.join('/tmp', `s4a_urls_${sessionId}.txt`);
  fs.writeFileSync(tempFile, urls.join('\n'));
  
  // Build Python command
  const pythonArgs = [SCRAPER_SCRIPT, tempFile];
  if (artistId) pythonArgs.push(artistId);
  if (headless) pythonArgs.push('--headless');
  
  console.log(`[S4A] Starting scraper for ${urls.length} URLs, session ${sessionId}`);
  
  const scraper = spawn('python3', pythonArgs, {
    cwd: path.dirname(SCRAPER_SCRIPT),
    timeout: 3600000 // 1 hour max
  });
  
  let progressCount = 0;
  
  scraper.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const message = JSON.parse(line);
        
        if (message.type === 'progress') {
          // Progress update
          session.progress = {
            current: message.current,
            total: message.total,
            percentage: message.percentage,
            message: message.message
          };
          
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            ...session.progress
          })}\n\n`);
          
          progressCount = message.current;
        } else if (message.level) {
          // Log message
          res.write(`data: ${JSON.stringify({
            type: 'log',
            level: message.level,
            message: message.message
          })}\n\n`);
        }
      } catch (e) {
        // Not JSON, just log it
        console.log(`[S4A-${sessionId}] ${line}`);
      }
    }
  });
  
  scraper.stderr.on('data', (data) => {
    const msg = data.toString();
    console.error(`[S4A-ERROR-${sessionId}] ${msg}`);
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: msg
    })}\n\n`);
  });
  
  scraper.on('close', (code) => {
    if (code === 0) {
      session.status = 'completed';
      session.completedAt = new Date().toISOString();
      console.log(`[S4A] Scraper completed successfully for session ${sessionId}`);
      
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        message: 'Scraping completed',
        session_id: sessionId
      })}\n\n`);
    } else {
      session.status = 'failed';
      session.error = `Process exited with code ${code}`;
      session.completedAt = new Date().toISOString();
      console.error(`[S4A] Scraper failed with code ${code} for session ${sessionId}`);
      
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: `Scraper failed with exit code ${code}`
      })}\n\n`);
    }
    
    res.end();
    
    // Cleanup
    try {
      fs.unlinkSync(tempFile);
    } catch (e) {
      // Ignore
    }
    
    // Keep session for 1 hour for result retrieval
    setTimeout(() => {
      activeSessions.delete(sessionId);
      console.log(`[S4A] Cleaned up session ${sessionId}`);
    }, 3600000);
  });
}

/**
 * POST /api/s4a/scrape-enrich
 * Enrich song_metrics by scraping S4A data
 * Takes track_ids, queries spotify_uri from song_metrics, calls s4a_fast_scraper, updates DB
 * 
 * Body: {
 *   track_ids: string[] - Array of track IDs to scrape
 * }
 * 
 * Streams SSE progress events
 */
router.post('/api/s4a/scrape-enrich', (req, res) => {
  const { track_ids } = req.body;
  
  if (!track_ids || !Array.isArray(track_ids) || track_ids.length === 0) {
    return res.status(400).json({ error: 'track_ids array required' });
  }
  
  const sessionId = uuidv4();
  const session = {
    id: sessionId,
    status: 'initializing',
    track_ids,
    results: [],
    progress: { current: 0, total: track_ids.length, percentage: 0 },
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null
  };
  
  activeSessions.set(sessionId, session);
  
  // Send SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Send initial response
  res.write(`data: ${JSON.stringify({ type: 'session-started', sessionId })}\n\n`);
  
  // Start enrichment in background
  startEnrichmentProcess(sessionId, track_ids, res);
});

/**
 * START ENRICHMENT PROCESS
 * Queries DB, builds S4A URLs, calls scraper, parses results, updates DB
 */
function startEnrichmentProcess(sessionId, track_ids, res) {
  const session = activeSessions.get(sessionId);
  
  (async () => {
    try {
      const s4aFastScraperScript = path.join(__dirname, 's4a_fast_scraper.py');
      
      // Step 1: Resolve track info and build S4A URLs
      const s4aUrls = [];
      const trackLookup = {}; // Map URL to track_id for later
      
      for (const track_id of track_ids) {
        try {
          // Query song_metrics for this track
          const trackRecord = db.prepare(`
            SELECT id, spotify_uri, track_name, artist_name FROM song_metrics
            WHERE id = ? OR spotify_uri LIKE ?
            LIMIT 1
          `).get(track_id, `%${track_id}%`);
          
          if (!trackRecord) {
            sendLog(res, 'warn', `Track ${track_id} not found in song_metrics, skipping`);
            continue;
          }
          
          // Extract track_id from spotify_uri (format: spotify:track:XXXXX)
          let spotifyTrackId = track_id;
          if (trackRecord.spotify_uri) {
            const match = trackRecord.spotify_uri.match(/spotify:track:([a-zA-Z0-9]+)/);
            if (match) {
              spotifyTrackId = match[1];
            }
          }
          
          // Need to get artist_id for S4A URL. Try to fetch from Spotify API
          let artist_id = null;
          
          try {
            // Query Spotify API for track details
            const account = db.prepare(`
              SELECT access_token FROM accounts LIMIT 1
            `).get();
            
            if (account && account.access_token) {
              const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${spotifyTrackId}`, {
                headers: { 'Authorization': `Bearer ${account.access_token}` }
              });
              
              if (trackRes.ok) {
                const trackData = await trackRes.json();
                if (trackData.artists && trackData.artists.length > 0) {
                  artist_id = trackData.artists[0].id;
                  sendLog(res, 'info', `Got artist_id for ${spotifyTrackId}: ${artist_id}`);
                }
              }
            }
          } catch (err) {
            sendLog(res, 'warn', `Could not fetch artist info from Spotify API: ${err.message}`);
          }
          
          if (!artist_id) {
            sendLog(res, 'warn', `Could not determine artist_id for ${track_id}, skipping`);
            continue;
          }
          
          // Build S4A URL: artists.spotify.com/c/artist/{artist_id}/song/{spotifyTrackId}/playlists
          const s4aUrl = `https://artists.spotify.com/c/artist/${artist_id}/song/${spotifyTrackId}/playlists`;
          s4aUrls.push(s4aUrl);
          trackLookup[s4aUrl] = {
            track_id,
            spotify_track_id: spotifyTrackId,
            artist_id,
            track_name: trackRecord.track_name,
            artist_name: trackRecord.artist_name,
            spotify_uri: trackRecord.spotify_uri
          };
          
          sendLog(res, 'info', `Queued ${track_id} → ${s4aUrl}`);
        } catch (err) {
          sendLog(res, 'error', `Error processing track ${track_id}: ${err.message}`);
        }
      }
      
      if (s4aUrls.length === 0) {
        sendLog(res, 'error', 'No valid tracks found to scrape');
        session.status = 'failed';
        session.error = 'No valid tracks found';
        session.completedAt = new Date().toISOString();
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          message: 'No valid tracks to scrape',
          session_id: sessionId
        })}\n\n`);
        res.end();
        return;
      }
      
      sendLog(res, 'info', `Prepared ${s4aUrls.length} URLs for scraping`);
      session.progress.total = s4aUrls.length;
      
      // Step 2: Write URLs to temp file
      const tempUrlFile = path.join('/tmp', `s4a_urls_enrich_${sessionId}.txt`);
      fs.writeFileSync(tempUrlFile, s4aUrls.join('\n'));
      sendLog(res, 'info', `Wrote URLs to temp file: ${tempUrlFile}`);
      
      // Step 3: Run scraper subprocess
      sendLog(res, 'info', 'Starting S4A fast scraper...');
      
      const scraper = spawn('python3', [s4aFastScraperScript], {
        cwd: path.dirname(s4aFastScraperScript),
        env: {
          ...process.env,
          S4A_INPUT_FILE: tempUrlFile,
          S4A_OUTPUT_FILE: path.join(path.dirname(s4aFastScraperScript), 'spotify_song_stats_fast.csv')
        },
        timeout: 3600000 // 1 hour max
      });
      
      let scraperOutput = '';
      let errors = '';
      
      scraper.stdout.on('data', (data) => {
        scraperOutput += data.toString();
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            console.log(`[S4A-${sessionId}] ${line}`);
            // Optionally parse progress from scraper output
            if (line.includes('[') && line.includes('/')) {
              const match = line.match(/\[(\d+)\/(\d+)\]/);
              if (match) {
                const current = parseInt(match[1]);
                const total = parseInt(match[2]);
                session.progress.current = current;
                session.progress.percentage = Math.round((current / total) * 100);
                sendProgress(res, current, total, session.progress.percentage);
              }
            }
          }
        }
      });
      
      scraper.stderr.on('data', (data) => {
        const msg = data.toString();
        errors += msg;
        console.error(`[S4A-ERROR-${sessionId}] ${msg}`);
        sendLog(res, 'error', msg);
      });
      
      scraper.on('close', async (code) => {
        try {
          if (code !== 0) {
            throw new Error(`Scraper exited with code ${code}`);
          }
          
          sendLog(res, 'info', 'Scraper completed, parsing results...');
          
          // Step 4: Parse CSV results
          const csvPath = path.join(path.dirname(s4aFastScraperScript), 'spotify_song_stats_fast.csv');
          
          if (!fs.existsSync(csvPath)) {
            throw new Error(`CSV output not found at ${csvPath}`);
          }
          
          const csvContent = fs.readFileSync(csvPath, 'utf-8');
          const lines = csvContent.trim().split('\n');
          const headers = lines[0].split(',');
          
          const results = [];
          let updatedCount = 0;
          
          for (let i = 1; i < lines.length; i++) {
            try {
              const values = parseCSVLine(lines[i]);
              
              const row = {};
              for (let j = 0; j < headers.length; j++) {
                row[headers[j].trim()] = values[j];
              }
              
              const url = row['Playlist URL'];
              if (!url || !trackLookup[url]) {
                sendLog(res, 'warn', `Unknown URL in CSV: ${url}`);
                continue;
              }
              
              const trackInfo = trackLookup[url];
              
              // Parse numeric values
              const streams = parseInt(row['Streams (28d)']?.replace(/,/g, '') || '0') || 0;
              const listeners = parseInt(row['Listeners (28d)']?.replace(/,/g, '') || '0') || 0;
              const saves = parseInt(row['Saves (28d)']?.replace(/,/g, '') || '0') || 0;
              const playlist_adds = parseInt(row['Playlist Adds']?.replace(/,/g, '') || '0') || 0;
              const radio_streams = parseInt(row['Radio Streams']?.replace(/,/g, '') || '0') || 0;
              
              // Calculate radio_percent if we have data
              let radio_percent = 0;
              if (streams > 0 && radio_streams > 0) {
                radio_percent = (radio_streams / streams) * 100;
              }
              
              // Step 5: Update song_metrics table
              const updateStmt = db.prepare(`
                UPDATE song_metrics
                SET
                  streams = ?,
                  listeners = ?,
                  saves = ?,
                  radio_streams = ?,
                  radio_percent = ?,
                  playlists_added = ?,
                  save_ratio = CASE WHEN listeners > 0 THEN CAST(saves AS FLOAT) / listeners ELSE 0 END,
                  s4a_data = ?,
                  last_updated = datetime('now')
                WHERE id = ? OR spotify_uri = ?
              `);
              
              updateStmt.run(
                streams,
                listeners,
                saves,
                radio_streams,
                radio_percent,
                playlist_adds,
                JSON.stringify(row),
                trackInfo.track_id,
                trackInfo.spotify_uri
              );
              
              updatedCount++;
              
              sendLog(res, 'info', `Updated ${trackInfo.track_name}: ${streams} streams, ${listeners} listeners, ${saves} saves`);
              
              results.push({
                track_id: trackInfo.track_id,
                track_name: trackInfo.track_name,
                streams,
                listeners,
                saves,
                playlist_adds,
                radio_streams,
                radio_percent
              });
              
              // Update progress
              session.progress.current = i - 1;
              session.progress.percentage = Math.round(((i - 1) / (lines.length - 1)) * 100);
              sendProgress(res, i - 1, lines.length - 1, session.progress.percentage);
              
            } catch (err) {
              sendLog(res, 'error', `Error parsing CSV line ${i}: ${err.message}`);
            }
          }
          
          // Final update
          session.status = 'completed';
          session.completedAt = new Date().toISOString();
          session.results = results;
          
          sendLog(res, 'info', `✅ Successfully updated ${updatedCount} tracks`);
          
          res.write(`data: ${JSON.stringify({
            type: 'complete',
            message: `Successfully enriched ${updatedCount} tracks`,
            session_id: sessionId,
            updated_count: updatedCount,
            total_count: s4aUrls.length
          })}\n\n`);
          
        } catch (err) {
          console.error(`[S4A] Enrichment error: ${err.message}`);
          sendLog(res, 'error', `Enrichment failed: ${err.message}`);
          
          session.status = 'failed';
          session.error = err.message;
          session.completedAt = new Date().toISOString();
          
          res.write(`data: ${JSON.stringify({
            type: 'error',
            message: err.message,
            session_id: sessionId
          })}\n\n`);
        } finally {
          res.end();
          
          // Cleanup temp files
          try {
            fs.unlinkSync(tempUrlFile);
          } catch (e) {
            // Ignore
          }
          
          // Keep session for 1 hour for result retrieval
          setTimeout(() => {
            activeSessions.delete(sessionId);
            console.log(`[S4A] Cleaned up enrichment session ${sessionId}`);
          }, 3600000);
        }
      });
    } catch (err) {
      console.error(`[S4A] Fatal error in enrichment: ${err.message}`);
      sendLog(res, 'error', `Fatal error: ${err.message}`);
      
      session.status = 'failed';
      session.error = err.message;
      session.completedAt = new Date().toISOString();
      
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: err.message,
        session_id: sessionId
      })}\n\n`);
      res.end();
      
      setTimeout(() => {
        activeSessions.delete(sessionId);
      }, 3600000);
    }
  })();
}

/**
 * GENERATE CSV FROM RESULTS
 */
function generateCSV(results) {
  const headers = [
    'URL',
    'Artist ID',
    'Track ID',
    'Streams',
    'Listeners',
    'Saves',
    'Radio Streams',
    'Radio %',
    'Playlist Adds',
    'Impressions',
    'Reach'
  ];
  
  let csv = headers.join(',') + '\n';
  
  for (const r of results) {
    csv += [
      `"${r.url || ''}"`,
      r.artist_id || '',
      r.track_id || '',
      r.streams || 0,
      r.listeners || 0,
      r.saves || 0,
      r.radio_streams || 0,
      r.radio_percentage || 0,
      `"${r.playlist_adds || 'N/A'}"`,
      r.impressions || 0,
      r.reach || 0
    ].join(',') + '\n';
  }
  
  return csv;
}

/**
 * HELPER: Send progress SSE event
 */
function sendProgress(res, current, total, percentage) {
  res.write(`data: ${JSON.stringify({
    type: 'progress',
    current,
    total,
    percentage: Math.round(percentage)
  })}\n\n`);
}

/**
 * HELPER: Send log SSE event
 */
function sendLog(res, level, message) {
  res.write(`data: ${JSON.stringify({
    type: 'log',
    level,
    message,
    timestamp: new Date().toISOString()
  })}\n\n`);
}

/**
 * HELPER: Parse CSV line respecting quoted fields
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * POST /api/metrics/fetch-from-spotify
 * Fetch track data directly from Spotify Web API and store in song_metrics
 * 
 * Body: {
 *   playlist_url: "https://open.spotify.com/playlist/xxxxx"
 * } OR {
 *   uris: ["spotify:track:xxx", "spotify:track:yyy"]
 * }
 * 
 * Returns: {
 *   inserted: number,
 *   skipped: number,
 *   results: [
 *     { uri, track_name, artist_name, status, error? }
 *   ]
 * }
 */
router.post('/api/metrics/fetch-from-spotify', async (req, res) => {
  try {
    const { playlist_url, uris } = req.body;
    
    if (!playlist_url && (!uris || !Array.isArray(uris) || uris.length === 0)) {
      return res.status(400).json({
        error: 'Either playlist_url or uris array is required'
      });
    }
    
    // Get first available account for API calls
    const account = db.prepare('SELECT id FROM accounts LIMIT 1').get();
    if (!account) {
      return res.status(400).json({ error: 'No Spotify account configured' });
    }
    
    const accountId = account.id;
    const results = [];
    let trackUris = [];
    
    // Parse input: either playlist URL or direct URIs
    if (playlist_url) {
      // Extract playlist ID from URL: https://open.spotify.com/playlist/{ID}
      const match = playlist_url.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid playlist URL format' });
      }
      const playlistId = match[1];
      
      // Fetch all tracks from playlist
      try {
        trackUris = await spotify.getAllPlaylistTracks(accountId, playlistId);
        console.log(`[SPOTIFY-FETCH] Fetched ${trackUris.length} tracks from playlist ${playlistId}`);
      } catch (err) {
        return res.status(400).json({
          error: `Could not fetch playlist: ${err.message}`
        });
      }
    } else {
      // Use provided URIs directly
      trackUris = uris;
    }
    
    // Extract track IDs from URIs
    const trackIds = trackUris.map(uri => {
      const match = uri.match(/spotify:track:([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }).filter(id => id !== null);
    
    if (trackIds.length === 0) {
      return res.status(400).json({ error: 'No valid track IDs found' });
    }
    
    console.log(`[SPOTIFY-FETCH] Processing ${trackIds.length} tracks`);
    
    // Fetch track data from Spotify API (batches of 50)
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO song_metrics (
        id, spotify_uri, track_name, artist_name, released_date, 
        duration_ms, popularity, album_image_url, preview_url,
        created_at, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let inserted = 0;
    let skipped = 0;
    
    // Process in batches of 50 (Spotify API limit)
    for (let i = 0; i < trackIds.length; i += 50) {
      const batch = trackIds.slice(i, i + 50);
      
      try {
        // Fetch batch from Spotify API
        const batchUrl = `/tracks?ids=${batch.join(',')}`;
        const data = await spotify.spotifyFetch(accountId, batchUrl);
        
        if (!data || !data.tracks) {
          console.warn(`[SPOTIFY-FETCH] No tracks returned for batch ${i / 50 + 1}`);
          skipped += batch.length;
          continue;
        }
        
        for (const track of data.tracks) {
          try {
            if (!track) {
              skipped++;
              continue;
            }
            
            const trackId = uuidv4();
            const artistName = track.artists && track.artists.length > 0
              ? track.artists.map(a => a.name).join(', ')
              : 'Unknown';
            
            const albumImageUrl = track.album && track.album.images && track.album.images.length > 0
              ? track.album.images[0].url
              : null;
            
            const now = new Date().toISOString();
            
            insertStmt.run(
              trackId,
              track.uri,
              track.name,
              artistName,
              track.release_date || null,
              track.duration_ms || 0,
              track.popularity || 0,
              albumImageUrl,
              track.preview_url || null,
              now,
              now
            );
            
            results.push({
              uri: track.uri,
              track_name: track.name,
              artist_name: artistName,
              status: 'inserted'
            });
            
            inserted++;
            
          } catch (err) {
            console.warn(`[SPOTIFY-FETCH] Error processing track ${track.id}: ${err.message}`);
            skipped++;
            results.push({
              uri: track.uri || 'unknown',
              track_name: track.name || 'unknown',
              artist_name: 'unknown',
              status: 'error',
              error: err.message
            });
          }
        }
        
        // Small delay between API calls to avoid rate limiting
        if (i + 50 < trackIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
      } catch (err) {
        console.error(`[SPOTIFY-FETCH] Batch error at index ${i}: ${err.message}`);
        skipped += batch.length;
        for (const trackId of batch) {
          results.push({
            uri: `spotify:track:${trackId}`,
            track_name: 'unknown',
            artist_name: 'unknown',
            status: 'error',
            error: err.message
          });
        }
      }
    }
    
    console.log(`[SPOTIFY-FETCH] Complete: ${inserted} inserted, ${skipped} skipped`);
    
    res.json({
      inserted,
      skipped,
      total: trackIds.length,
      results
    });
    
  } catch (err) {
    console.error('[SPOTIFY-FETCH] Fatal error:', err);
    res.status(500).json({
      error: err.message,
      inserted: 0,
      skipped: 0,
      results: []
    });
  }
});

module.exports = router;
