/**
 * S4A Analytics Data Pipeline
 * 
 * Unified pipeline for:
 * 1. Matching scraped S4A data to Spotify URIs
 * 2. Enriching with Spotify Web API metadata
 * 3. Normalizing to standard output schema
 * 4. Calculating derived fields
 * 5. Exporting to CSV/Excel
 * 6. Storing to database
 */

const spotify = require('./spotify');
const store = require('./store');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ═══════════════════════════════════════════
// 1. URI MATCHING
// ═══════════════════════════════════════════

/**
 * Match scraped track data to Spotify track URIs
 * 
 * Strategy:
 * 1. For each scraped result, use track_id/track_name to search Spotify API
 * 2. Get the track URI from the API response
 * 3. Match to the extractedURIs list if provided
 * 4. Merge all data together
 * 
 * @param {Array} scrapedResults - [{ track_id, track_name, artist_name, streams, listeners, ... }]
 * @param {Array} extractedURIs - Optional array of ['spotify:track:xxxxx', ...]
 * @param {String} accountId - Account ID for Spotify API calls
 * @returns {Array} Matched tracks with URIs
 */
async function matchScrapedToURIs(scrapedResults, extractedURIs = [], accountId) {
  console.log(`[PIPELINE] 🔗 Matching ${scrapedResults.length} scraped results to URIs...`);
  
  const matched = [];
  const uriMap = {};
  
  // Build map of track_id → uri from extractedURIs (if provided)
  if (extractedURIs && extractedURIs.length > 0) {
    for (const uriData of extractedURIs) {
      const uri = typeof uriData === 'string' ? uriData : uriData.uri;
      if (uri && uri.startsWith('spotify:track:')) {
        const trackId = uri.split(':')[2];
        uriMap[trackId] = uri;
      }
    }
    console.log(`[PIPELINE] Built map of ${Object.keys(uriMap).length} URIs from extracted data`);
  }
  
  // Match each scraped result
  for (let i = 0; i < scrapedResults.length; i++) {
    const scraped = scrapedResults[i];
    const matchResult = { ...scraped };
    
    try {
      // First, check if we already have a URI match
      if (scraped.track_id && uriMap[scraped.track_id]) {
        matchResult.spotify_uri = uriMap[scraped.track_id];
        console.log(`[PIPELINE] ✓ Matched ${scraped.track_id} via URI map`);
        matched.push(matchResult);
        continue;
      }
      
      // Otherwise, search Spotify API
      if (scraped.track_name && scraped.artist_name) {
        const query = `track:"${scraped.track_name}" artist:"${scraped.artist_name}"`;
        const results = await spotify.spotifyFetch(accountId, `/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
        
        if (results?.tracks?.items?.length > 0) {
          const track = results.tracks.items[0];
          matchResult.spotify_uri = track.uri;
          matchResult.track_id = track.id;
          console.log(`[PIPELINE] ✓ Found URI for ${scraped.track_name} via search: ${track.uri}`);
        } else {
          console.warn(`[PIPELINE] ⚠ No URI found for ${scraped.track_name} by ${scraped.artist_name}`);
        }
      } else if (scraped.track_id) {
        // Try to fetch by track_id directly
        try {
          const track = await spotify.spotifyFetch(accountId, `/tracks/${scraped.track_id}`);
          if (track && track.uri) {
            matchResult.spotify_uri = track.uri;
            console.log(`[PIPELINE] ✓ Found URI for track ID ${scraped.track_id}: ${track.uri}`);
          }
        } catch (err) {
          console.warn(`[PIPELINE] ⚠ Could not fetch track ${scraped.track_id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.warn(`[PIPELINE] ⚠ Error matching ${scraped.track_name}: ${err.message}`);
    }
    
    matched.push(matchResult);
  }
  
  console.log(`[PIPELINE] ✅ Matching complete. Matched ${matched.filter(m => m.spotify_uri).length}/${matched.length} tracks`);
  return matched;
}

// ═══════════════════════════════════════════
// 2. WEB API ENRICHMENT
// ═══════════════════════════════════════════

/**
 * Enrich matched tracks with Spotify Web API metadata
 * 
 * @param {Array} matchedTracks - Tracks with optional spotify_uri
 * @param {String} accountId - Account ID for API calls
 * @returns {Array} Enriched tracks with API metadata
 */
async function enrichWithWebAPI(matchedTracks, accountId) {
  console.log(`[PIPELINE] 🔀 Enriching ${matchedTracks.length} tracks with Spotify Web API metadata...`);
  
  const enriched = [];
  
  for (const track of matchedTracks) {
    const enrichedTrack = { ...track };
    
    if (!track.spotify_uri) {
      console.warn(`[PIPELINE] ⚠ Skipping enrichment for ${track.track_name} (no URI)`);
      enriched.push(enrichedTrack);
      continue;
    }
    
    try {
      const trackId = track.spotify_uri.split(':')[2];
      const apiTrack = await spotify.spotifyFetch(accountId, `/tracks/${trackId}`);
      
      if (apiTrack) {
        // Extract metadata from API response
        enrichedTrack.spotify_uri = apiTrack.uri;
        enrichedTrack.track_id = apiTrack.id;
        enrichedTrack.track_name = apiTrack.name;
        enrichedTrack.artist_name = apiTrack.artists?.[0]?.name || enrichedTrack.artist_name;
        enrichedTrack.artist_id = apiTrack.artists?.[0]?.id || enrichedTrack.artist_id;
        enrichedTrack.album_name = apiTrack.album?.name;
        enrichedTrack.release_date = apiTrack.album?.release_date;
        enrichedTrack.popularity = apiTrack.popularity;
        enrichedTrack.duration_ms = apiTrack.duration_ms;
        enrichedTrack.explicit = apiTrack.explicit;
        enrichedTrack.artist_link = apiTrack.artists?.[0]?.external_urls?.spotify;
        
        console.log(`[PIPELINE] ✓ Enriched ${enrichedTrack.track_name}`);
      }
    } catch (err) {
      console.warn(`[PIPELINE] ⚠ Enrichment failed for ${track.spotify_uri}: ${err.message}`);
    }
    
    enriched.push(enrichedTrack);
  }
  
  console.log(`[PIPELINE] ✅ Enrichment complete`);
  return enriched;
}

// ═══════════════════════════════════════════
// 3. CALCULATED FIELDS
// ═══════════════════════════════════════════

/**
 * Calculate derived analytics fields
 * 
 * @param {Object} track - Track data with base metrics
 * @returns {Object} Track with calculated fields
 */
function calculateDerivedFields(track) {
  const result = { ...track };
  
  // save_ratio = saves / streams
  if (typeof track.saves === 'number' && typeof track.streams === 'number' && track.streams > 0) {
    result.save_ratio = track.saves / track.streams;
  }
  
  // streams_per_listener = streams / listeners
  if (typeof track.streams === 'number' && typeof track.listeners === 'number' && track.listeners > 0) {
    result.streams_per_listener = track.streams / track.listeners;
  }
  
  // days_since_release = now - release_date
  if (track.release_date) {
    try {
      const releaseDate = new Date(track.release_date);
      const now = new Date();
      const diffMs = now - releaseDate;
      result.days_since = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    } catch (err) {
      console.warn(`[PIPELINE] Could not parse release date: ${track.release_date}`);
    }
  }
  
  // radio_percent = (radio_streams / streams) * 100
  if (typeof track.radio_streams === 'number' && typeof track.streams === 'number' && track.streams > 0) {
    result.radio_percent = (track.radio_streams / track.streams) * 100;
  }
  
  return result;
}

// ═══════════════════════════════════════════
// 4. DATA NORMALIZATION
// ═══════════════════════════════════════════

/**
 * Normalize track data to final output schema
 * 
 * Final schema:
 * {
 *   spotify_uri, song, artist, released, days_since,
 *   streams, listeners, saves, save_ratio,
 *   radio_streams, radio_percent, playlists_added, streams_per_listener,
 *   artist_link, source, collected_at, ...otherMetadata
 * }
 * 
 * @param {Array} enrichedTracks - Enriched track data
 * @returns {Array} Normalized tracks
 */
function normalizeData(enrichedTracks) {
  console.log(`[PIPELINE] 📊 Normalizing ${enrichedTracks.length} tracks to final schema...`);
  
  const normalized = [];
  
  for (const track of enrichedTracks) {
    // Calculate derived fields first
    const withCalculations = calculateDerivedFields(track);
    
    // Map to final output schema
    const normalized_track = {
      // Core identifiers
      spotify_uri: track.spotify_uri || null,
      track_id: track.track_id || null,
      
      // Metadata
      song: track.track_name || null,
      artist: track.artist_name || null,
      artist_id: track.artist_id || null,
      album: track.album_name || null,
      released: track.release_date || null,
      days_since: withCalculations.days_since || null,
      popularity: track.popularity || null,
      explicit: track.explicit || false,
      duration_ms: track.duration_ms || null,
      
      // Metrics (from scraper)
      streams: track.streams || 0,
      listeners: track.listeners || 0,
      saves: track.saves || 0,
      
      // Calculated ratios
      save_ratio: withCalculations.save_ratio || null,
      streams_per_listener: withCalculations.streams_per_listener || null,
      
      // Radio metrics
      radio_streams: track.radio_streams || 0,
      radio_percent: withCalculations.radio_percent || null,
      
      // Playlist metrics
      playlists_added: track.playlists_added || 0,
      
      // Additional metrics (if available from S4A)
      impressions: track.impressions || 0,
      reach: track.reach || 0,
      engagement: track.engagement || 0,
      
      // Links
      artist_link: track.artist_link || null,
      
      // Metadata
      source: track.source || 'spotify_for_artists_session',
      collected_at: track.collected_at || new Date().toISOString(),
      
      // Preserve raw S4A data
      s4a_raw: track.s4a_raw || null,
    };
    
    // Remove null values for cleaner output (optional)
    const cleaned = {};
    for (const [key, value] of Object.entries(normalized_track)) {
      if (value !== null) {
        cleaned[key] = value;
      }
    }
    
    normalized.push(cleaned);
  }
  
  console.log(`[PIPELINE] ✅ Normalization complete`);
  return normalized;
}

// ═══════════════════════════════════════════
// 5. EXPORT FUNCTIONS
// ═══════════════════════════════════════════

/**
 * Export normalized tracks to CSV format
 * 
 * @param {Array} results - Normalized track data
 * @returns {String} CSV content
 */
function exportToCSV(results) {
  console.log(`[PIPELINE] 📄 Exporting ${results.length} tracks to CSV...`);
  
  if (results.length === 0) {
    return 'No data to export';
  }
  
  // Get all unique keys from all tracks
  const allKeys = new Set();
  for (const track of results) {
    Object.keys(track).forEach(key => allKeys.add(key));
  }
  
  const headers = Array.from(allKeys).sort();
  const headerRow = headers.join(',');
  
  // Build CSV rows
  const rows = [headerRow];
  for (const track of results) {
    const values = headers.map(header => {
      const value = track[header];
      if (value === undefined || value === null) {
        return '';
      }
      // Escape quotes and wrap in quotes if contains comma/quotes/newlines
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    rows.push(values.join(','));
  }
  
  const csv = rows.join('\n');
  console.log(`[PIPELINE] ✅ CSV export complete (${rows.length} rows)`);
  return csv;
}

/**
 * Export normalized tracks to Excel format
 * 
 * @param {Array} results - Normalized track data
 * @returns {Buffer} Excel file buffer (requires xlsx package)
 */
function exportToExcel(results) {
  console.log(`[PIPELINE] 📊 Exporting ${results.length} tracks to Excel...`);
  
  try {
    const xlsx = require('xlsx');
    
    if (results.length === 0) {
      return null;
    }
    
    // Create workbook
    const ws = xlsx.utils.json_to_sheet(results);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'S4A Analytics');
    
    // Auto-size columns
    const maxWidth = 50;
    const colWidths = [];
    for (const key of Object.keys(results[0] || {})) {
      const maxLen = Math.max(
        key.length,
        ...results.map(r => String(r[key] || '').length)
      );
      colWidths.push({ wch: Math.min(maxLen + 2, maxWidth) });
    }
    ws['!cols'] = colWidths;
    
    console.log(`[PIPELINE] ✅ Excel export complete`);
    return xlsx.write(wb, { type: 'buffer' });
  } catch (err) {
    console.warn(`[PIPELINE] ⚠ Excel export requires 'xlsx' package: ${err.message}`);
    return null;
  }
}

/**
 * Export to JSON format
 * 
 * @param {Array} results - Normalized track data
 * @returns {String} JSON string
 */
function exportToJSON(results) {
  console.log(`[PIPELINE] 📋 Exporting ${results.length} tracks to JSON...`);
  return JSON.stringify(results, null, 2);
}

// ═══════════════════════════════════════════
// 6. DATABASE STORAGE
// ═══════════════════════════════════════════

/**
 * Store normalized tracks to database
 * 
 * @param {Array} normalizedTracks - Normalized track data
 * @returns {Array} Stored tracks with IDs
 */
async function storeToDatabase(normalizedTracks) {
  console.log(`[PIPELINE] 💾 Storing ${normalizedTracks.length} tracks to database...`);
  
  const stored = [];
  
  for (const track of normalizedTracks) {
    try {
      // Use store.upsertSongMetric to save
      const id = uuidv4();
      const trackId = track.spotify_uri?.split(':')[2] || id;
      
      const result = store.upsertSongMetric(id, {
        spotify_uri: track.spotify_uri,
        track_name: track.song,
        artist_name: track.artist,
        released_date: track.released,
        streams: track.streams,
        listeners: track.listeners,
        saves: track.saves,
        save_ratio: track.save_ratio,
        radio_streams: track.radio_streams,
        radio_percent: track.radio_percent,
        playlists_added: track.playlists_added,
        s_l_ratio: track.streams_per_listener,
        s4a_data: JSON.stringify(track), // Store complete normalized data as JSON
      });
      
      stored.push(result);
    } catch (err) {
      console.warn(`[PIPELINE] ⚠ Could not store ${track.song}: ${err.message}`);
    }
  }
  
  console.log(`[PIPELINE] ✅ Stored ${stored.length}/${normalizedTracks.length} tracks`);
  return stored;
}

// ═══════════════════════════════════════════
// 7. MAIN ORCHESTRATOR
// ═══════════════════════════════════════════

/**
 * Main pipeline orchestrator
 * 
 * Flow:
 * 1. Match scraped results to Spotify URIs
 * 2. Enrich with Spotify Web API metadata
 * 3. Normalize to final schema + calculate fields
 * 4. Store to database
 * 5. Export to CSV/Excel/JSON
 * 
 * @param {Array} scrapedResults - S4A scraped track data
 * @param {Array} extractedURIs - Optional Spotify playlist URIs
 * @param {String} accountId - Account ID for Spotify API
 * @returns {Object} { normalized, csv, json, excel?, stored }
 */
async function processS4AData(scrapedResults, extractedURIs, accountId) {
  const startTime = Date.now();
  console.log(`\n═══════════════════════════════════════════════════════════`);
  console.log(`[PIPELINE] 🚀 Starting S4A Analytics Data Pipeline`);
  console.log(`[PIPELINE] Input: ${scrapedResults.length} scraped, ${extractedURIs?.length || 0} URIs`);
  console.log(`═══════════════════════════════════════════════════════════\n`);
  
  try {
    // Step 1: Match
    console.log(`\n[STEP 1] URI Matching...`);
    const matched = await matchScrapedToURIs(scrapedResults, extractedURIs, accountId);
    console.log(`Result: ${matched.length} tracks`);
    
    // Step 2: Enrich
    console.log(`\n[STEP 2] Web API Enrichment...`);
    const enriched = await enrichWithWebAPI(matched, accountId);
    console.log(`Result: ${enriched.length} tracks enriched`);
    
    // Step 3: Normalize + Calculate
    console.log(`\n[STEP 3] Normalization & Calculations...`);
    const normalized = normalizeData(enriched);
    console.log(`Result: ${normalized.length} normalized tracks`);
    
    // Step 4: Store to DB
    console.log(`\n[STEP 4] Database Storage...`);
    const stored = await storeToDatabase(normalized);
    console.log(`Result: ${stored.length} tracks stored`);
    
    // Step 5: Export
    console.log(`\n[STEP 5] Export Generation...`);
    const csv = exportToCSV(normalized);
    const json = exportToJSON(normalized);
    const excel = exportToExcel(normalized);
    
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`[PIPELINE] ✅ Complete in ${elapsedSec}s`);
    console.log(`[PIPELINE] Output: ${normalized.length} normalized, ${csv.length} bytes CSV, ${json.length} bytes JSON`);
    console.log(`═══════════════════════════════════════════════════════════\n`);
    
    return {
      normalized,
      csv,
      json,
      excel,
      stored,
      stats: {
        totalProcessed: normalized.length,
        matched: matched.filter(m => m.spotify_uri).length,
        stored: stored.length,
        elapsedSeconds: parseFloat(elapsedSec),
      },
    };
  } catch (err) {
    console.error(`[PIPELINE] ❌ Pipeline failed: ${err.message}`);
    console.error(err.stack);
    throw err;
  }
}

// ═══════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════

module.exports = {
  // Individual functions
  matchScrapedToURIs,
  enrichWithWebAPI,
  calculateDerivedFields,
  normalizeData,
  exportToCSV,
  exportToExcel,
  exportToJSON,
  storeToDatabase,
  
  // Main orchestrator
  processS4AData,
};
