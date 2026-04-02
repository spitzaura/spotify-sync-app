/**
 * S4A Analytics Utilities
 * 
 * Handles:
 * - Data enrichment with Spotify Web API
 * - CSV/Excel export
 * - URI matching and deduplication
 * - Track metadata management
 */

const db = require('./db');
const { v4: uuidv4 } = require('uuid');

/**
 * Enrich S4A metrics with Spotify Web API data
 * Fetches URIs, IDs, and release dates for tracks
 */
async function enrichMetricsWithSpotifyAPI(metrics, spotifyFetch, accountId) {
  const enriched = [];

  for (const metric of metrics) {
    try {
      let enrichmentData = {};

      // Try to find track by name
      if (metric.track_name && metric.artist_name) {
        const query = `track:"${metric.track_name}" artist:"${metric.artist_name}"`;
        const results = await spotifyFetch(accountId, `/search?q=${encodeURIComponent(query)}&type=track&limit=1`);

        if (results.tracks?.items?.length > 0) {
          const track = results.tracks.items[0];
          enrichmentData = {
            spotify_uri: track.uri,
            track_id: track.id,
            released_date: track.album?.release_date,
            artist_id: track.artists?.[0]?.id,
          };
        }
      }

      enriched.push({ ...metric, ...enrichmentData });
    } catch (err) {
      console.warn(`⚠️ Could not enrich "${metric.track_name}": ${err.message}`);
      enriched.push(metric);
    }
  }

  return enriched;
}

/**
 * Calculate derived fields (days_since_release, save_ratio, etc.)
 */
function calculateDerivedFields(metric) {
  const result = { ...metric };

  // days_since_release
  if (metric.released_date) {
    const releaseDate = new Date(metric.released_date);
    const now = new Date();
    const diffMs = now - releaseDate;
    result.days_since_release = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // save_ratio
  if (metric.saves && metric.streams) {
    result.save_ratio = (metric.saves / metric.streams).toFixed(6);
  }

  // streams_per_listener
  if (metric.streams && metric.listeners) {
    result.streams_per_listener = (metric.streams / metric.listeners).toFixed(2);
  }

  return result;
}

/**
 * Store S4A metrics in database
 */
function storeMetrics(artistId, artistName, metrics) {
  const stored = [];
  const stmtInsert = db.prepare(`
    INSERT OR REPLACE INTO s4a_analytics (
      id, spotify_uri, track_name, artist_id, artist_name, track_id,
      released_date, days_since_release, streams, listeners, saves,
      save_ratio, radio_streams, radio_percentage, playlist_adds,
      streams_per_listener, impressions, reach, engagement,
      raw_s4a_data, source, collected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const metric of metrics) {
    try {
      const enriched = calculateDerivedFields(metric);
      
      const result = stmtInsert.run(
        uuidv4(),
        enriched.spotify_uri || null,
        enriched.track_name,
        artistId,
        artistName,
        enriched.track_id || null,
        enriched.released_date || null,
        enriched.days_since_release || null,
        enriched.streams || 0,
        enriched.listeners || 0,
        enriched.saves || 0,
        enriched.save_ratio || null,
        enriched.radio_streams || 0,
        enriched.radio_percentage || null,
        enriched.playlist_adds || 0,
        enriched.streams_per_listener || null,
        enriched.impressions || 0,
        enriched.reach || 0,
        enriched.engagement || 0,
        JSON.stringify(enriched),
        'spotify_for_artists_session',
        new Date().toISOString()
      );

      stored.push(enriched);
    } catch (err) {
      console.warn(`⚠️ Could not store metric for "${metric.track_name}": ${err.message}`);
    }
  }

  return stored;
}

/**
 * Retrieve stored metrics for an artist
 */
function getMetricsForArtist(artistId) {
  const stmt = db.prepare(`
    SELECT * FROM s4a_analytics
    WHERE artist_id = ?
    ORDER BY streams DESC
  `);

  return stmt.all(artistId);
}

/**
 * Generate CSV output for metrics
 */
function generateCSV(metrics) {
  const headers = [
    'Spotify URI',
    'Song',
    'Artist',
    'Released',
    'Days Since',
    'Streams',
    'Listeners',
    'Saves',
    'Save Ratio',
    'Radio Streams',
    '% Radio',
    'Playlist Added',
    'S/L',
    'Impressions',
    'Reach',
    'Engagement',
    'Source',
    'Collected At'
  ];

  let csv = headers.join(',') + '\n';

  for (const m of metrics) {
    const row = [
      `"${m.spotify_uri || ''}"`,
      `"${m.track_name || ''}"`,
      `"${m.artist_name || ''}"`,
      `"${m.released_date || ''}"`,
      m.days_since_release || '',
      m.streams || '',
      m.listeners || '',
      m.saves || '',
      m.save_ratio || '',
      m.radio_streams || '',
      m.radio_percentage || '',
      m.playlist_adds || '',
      m.streams_per_listener || '',
      m.impressions || '',
      m.reach || '',
      m.engagement || '',
      m.source || 'spotify_for_artists_session',
      m.collected_at ? new Date(m.collected_at).toISOString() : ''
    ];
    csv += row.join(',') + '\n';
  }

  return csv;
}

/**
 * Generate HTML table for display
 */
function generateHTMLTable(metrics, title = 'S4A Analytics') {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #1DB954; color: white; font-weight: bold; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        tr:hover { background-color: #e0e0e0; }
        .metric-num { text-align: right; }
        .header { background-color: #191414; color: #1DB954; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
        h1 { margin: 0; }
        .subtitle { font-size: 14px; margin-top: 5px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${title}</h1>
        <div class="subtitle">Generated ${new Date().toLocaleString()}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Song</th>
            <th>Artist</th>
            <th>Released</th>
            <th>Days</th>
            <th class="metric-num">Streams</th>
            <th class="metric-num">Listeners</th>
            <th class="metric-num">Saves</th>
            <th class="metric-num">Save %</th>
            <th class="metric-num">Radio</th>
            <th class="metric-num">Playlists</th>
            <th class="metric-num">S/L</th>
          </tr>
        </thead>
        <tbody>
  `;

  for (const m of metrics) {
    html += `
      <tr>
        <td><strong>${m.track_name || 'N/A'}</strong></td>
        <td>${m.artist_name || 'N/A'}</td>
        <td>${m.released_date || 'N/A'}</td>
        <td class="metric-num">${m.days_since_release || '-'}</td>
        <td class="metric-num">${m.streams?.toLocaleString() || '0'}</td>
        <td class="metric-num">${m.listeners?.toLocaleString() || '0'}</td>
        <td class="metric-num">${m.saves?.toLocaleString() || '0'}</td>
        <td class="metric-num">${m.save_ratio ? (parseFloat(m.save_ratio) * 100).toFixed(2) + '%' : '-'}</td>
        <td class="metric-num">${m.radio_streams?.toLocaleString() || '0'}</td>
        <td class="metric-num">${m.playlist_adds || '0'}</td>
        <td class="metric-num">${m.streams_per_listener || '-'}</td>
      </tr>
    `;
  }

  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;

  return html;
}

/**
 * Match tracks from playlist to S4A metrics
 * Uses URI first, then falls back to name + artist matching
 */
function matchPlaylistTracksToMetrics(playlistTracks, allMetrics) {
  const matched = [];
  const metricsMap = new Map();

  // Build lookup maps
  for (const m of allMetrics) {
    if (m.spotify_uri) {
      metricsMap.set(m.spotify_uri, m);
    }
    const nameKey = `${m.track_name}|${m.artist_name}`.toLowerCase();
    metricsMap.set(nameKey, m);
  }

  for (const track of playlistTracks) {
    let metric = null;

    // Try URI first
    if (track.uri && metricsMap.has(track.uri)) {
      metric = metricsMap.get(track.uri);
    }

    // Fallback to name + artist
    if (!metric && track.name) {
      const artists = track.artists?.join(', ') || '';
      const nameKey = `${track.name}|${artists}`.toLowerCase();
      metric = metricsMap.get(nameKey);
    }

    matched.push({
      ...track,
      ...metric,
      source: metric ? 'spotify_for_artists' : 'spotify_api'
    });
  }

  return matched;
}

/**
 * Create a collection job for tracking progress
 */
function createCollectionJob(artistId, artistName) {
  const jobId = uuidv4();
  const stmt = db.prepare(`
    INSERT INTO s4a_collection_jobs (id, artist_id, artist_name, status)
    VALUES (?, ?, ?, 'running')
  `);

  stmt.run(jobId, artistId, artistName);
  return jobId;
}

/**
 * Update collection job progress
 */
function updateCollectionJob(jobId, updates) {
  const { status, total_tracks, processed_tracks, error_message } = updates;
  const fields = [];
  const values = [];

  if (status) {
    fields.push('status = ?');
    values.push(status);
  }
  if (total_tracks !== undefined) {
    fields.push('total_tracks = ?');
    values.push(total_tracks);
  }
  if (processed_tracks !== undefined) {
    fields.push('processed_tracks = ?');
    values.push(processed_tracks);
  }
  if (error_message) {
    fields.push('error_message = ?');
    values.push(error_message);
  }
  if (status === 'completed') {
    fields.push('completed_at = datetime("now")');
  }

  if (fields.length === 0) return;

  values.push(jobId);
  const sql = `UPDATE s4a_collection_jobs SET ${fields.join(', ')}, updated_at = datetime("now") WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
}

/**
 * Get collection job status
 */
function getCollectionJob(jobId) {
  const stmt = db.prepare('SELECT * FROM s4a_collection_jobs WHERE id = ?');
  return stmt.get(jobId);
}

module.exports = {
  enrichMetricsWithSpotifyAPI,
  calculateDerivedFields,
  storeMetrics,
  getMetricsForArtist,
  generateCSV,
  generateHTMLTable,
  matchPlaylistTracksToMetrics,
  createCollectionJob,
  updateCollectionJob,
  getCollectionJob,
};
