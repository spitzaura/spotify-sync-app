/**
 * S4A URI Extractor
 * 
 * Handles:
 * - Extraction of track URIs from playlist URLs
 * - URI parsing and validation
 * - Integration with S4A metrics matching
 */

const spotify = require('./spotify');
const store = require('./store');

/**
 * Extract track URIs from a Spotify playlist URL or ID
 */
async function extractPlaylistURIs(playlistIdOrUrl, accountId) {
  let playlistId = playlistIdOrUrl;

  // Parse URL if needed
  if (playlistIdOrUrl.includes('spotify.com')) {
    const match = playlistIdOrUrl.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Invalid Spotify playlist URL');
    }
    playlistId = match[1];
  }

  // Validate ID format
  if (!/^[a-zA-Z0-9]{22}$/.test(playlistId)) {
    throw new Error('Invalid playlist ID format');
  }

  console.log(`[EXTRACTOR] Extracting URIs from playlist ${playlistId}`);

  const allUris = [];
  let nextUrl = `/playlists/${playlistId}/items?limit=50`;
  let pageCount = 0;

  // Paginate through all tracks
  while (nextUrl && pageCount < 100) {
    pageCount++;
    console.log(`[EXTRACTOR] Fetching page ${pageCount}...`);

    const playlistData = await spotify.spotifyFetch(accountId, nextUrl);

    if (!playlistData || !playlistData.items) {
      console.log(`[EXTRACTOR] No items in response`);
      break;
    }

    // Extract URIs from each track
    for (const item of playlistData.items) {
      try {
        const track = item.track || item.item;
        
        // Skip null/unavailable tracks
        if (!track || !track.uri || track.is_local) {
          continue;
        }

        // Ensure it's a valid track URI
        if (typeof track.uri === 'string' && track.uri.startsWith('spotify:track:')) {
          allUris.push({
            uri: track.uri,
            name: track.name,
            artists: track.artists?.map(a => a.name) || [],
            id: track.id,
            album: track.album?.name,
            releaseDate: track.album?.release_date,
            popularity: track.popularity,
          });
        }
      } catch (err) {
        console.warn(`[EXTRACTOR] Skipping track:`, err.message);
      }
    }

    console.log(`[EXTRACTOR] Page ${pageCount}: found ${playlistData.items.length} items, total so far: ${allUris.length}`);

    // Check for next page
    nextUrl = playlistData.next ? playlistData.next.replace('https://api.spotify.com/v1', '') : null;
  }

  console.log(`[EXTRACTOR] ✅ Complete. Total URIs extracted: ${allUris.length}`);
  return allUris;
}

/**
 * Extract artist ID from URL or parse it directly
 */
function parseArtistId(artistIdOrUrl) {
  if (artistIdOrUrl.includes('spotify.com')) {
    const match = artistIdOrUrl.match(/artist\/([a-zA-Z0-9]+)/);
    if (!match) {
      throw new Error('Invalid Spotify artist URL');
    }
    return match[1];
  }

  if (!/^[a-zA-Z0-9]{22}$/.test(artistIdOrUrl)) {
    throw new Error('Invalid artist ID format');
  }

  return artistIdOrUrl;
}

/**
 * Get enriched track data from Spotify API
 */
async function enrichTrackData(uri, accountId) {
  if (!uri.startsWith('spotify:track:')) {
    throw new Error('Invalid track URI');
  }

  const trackId = uri.split(':')[2];

  try {
    const trackData = await spotify.spotifyFetch(accountId, `/tracks/${trackId}`);
    
    return {
      uri,
      id: trackData.id,
      name: trackData.name,
      artists: trackData.artists?.map(a => ({ name: a.name, id: a.id })) || [],
      album: trackData.album?.name,
      releaseDate: trackData.album?.release_date,
      popularity: trackData.popularity,
      durationMs: trackData.duration_ms,
      explicit: trackData.explicit,
    };
  } catch (err) {
    console.warn(`Could not enrich ${uri}:`, err.message);
    return { uri, id: trackId };
  }
}

/**
 * Batch enrich multiple tracks
 */
async function enrichMultipleTracks(uris, accountId) {
  const enriched = [];

  for (const uri of uris) {
    try {
      const data = await enrichTrackData(uri, accountId);
      enriched.push(data);
    } catch (err) {
      console.warn(`Failed to enrich ${uri}:`, err.message);
      enriched.push({ uri });
    }
  }

  return enriched;
}

/**
 * Validate that all URIs are valid Spotify track URIs
 */
function validateURIs(uris) {
  const valid = [];
  const invalid = [];

  for (const uri of uris) {
    if (typeof uri === 'string' && uri.match(/^spotify:track:[a-zA-Z0-9]+$/)) {
      valid.push(uri);
    } else {
      invalid.push(uri);
    }
  }

  return { valid, invalid };
}

/**
 * Generate report of extraction
 */
function generateExtractionReport(uris, enrichedData = null) {
  const report = {
    total_uris: uris.length,
    extraction_time: new Date().toISOString(),
    sample_uris: uris.slice(0, 5),
    uris,
  };

  if (enrichedData) {
    report.enriched_count = enrichedData.length;
    report.enriched_data = enrichedData;
  }

  return report;
}

module.exports = {
  extractPlaylistURIs,
  parseArtistId,
  enrichTrackData,
  enrichMultipleTracks,
  validateURIs,
  generateExtractionReport,
};
