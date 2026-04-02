const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// SSE subscription helper for sync progress
function subscribeSyncProgress(groupId, { childIds, onProgress, onComplete, onError }) {
  let url = `${API_BASE}/groups/${groupId}/sync/stream`;
  if (childIds && childIds.length > 0) {
    url += `?childIds=${childIds.join(',')}`;
  }

  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    if (event.data === '[DONE]') {
      eventSource.close();
      return;
    }
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'complete') {
        if (onComplete) onComplete(data);
        eventSource.close();
      } else if (data.type === 'error') {
        if (onError) onError(data.error);
        eventSource.close();
      } else {
        if (onProgress) onProgress(data);
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    if (onError) onError('Connection lost');
    eventSource.close();
  };

  return eventSource;
}

export const api = {
  // Accounts
  getAccounts: () => request('/accounts'),
  deleteAccount: (id) => request(`/accounts/${id}`, { method: 'DELETE' }),
  getPlaylists: (accountId) => request(`/accounts/${accountId}/playlists`),

  // Groups
  getGroups: () => request('/groups'),
  createGroup: (name) => request('/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id, data) => request(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteGroup: (id) => request(`/groups/${id}`, { method: 'DELETE' }),

  // Master / Children
  setMaster: (groupId, data) => request(`/groups/${groupId}/master`, { method: 'PUT', body: JSON.stringify(data) }),
  addChild: (groupId, data) => request(`/groups/${groupId}/children`, { method: 'POST', body: JSON.stringify(data) }),
  removeChild: (groupId, childId) => request(`/groups/${groupId}/children/${childId}`, { method: 'DELETE' }),

  // Bulk import
  bulkImportChildren: (groupId, urls, accountId) =>
    request(`/groups/${groupId}/children/bulk`, {
      method: 'POST',
      body: JSON.stringify({ urls, accountId }),
    }),

  // Duplicate detection
  getDuplicates: (groupId) => request(`/groups/${groupId}/duplicates`),

  // Sync (classic — non-SSE)
  syncGroup: (groupId, childIds) =>
    request(`/groups/${groupId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ childIds }),
    }),

  // Sync (SSE — live progress)
  syncGroupSSE: subscribeSyncProgress,

  // Logs
  getSyncLogs: (groupId) => request(`/groups/${groupId}/logs`),

  // Trades
  getTrades: () => request('/trades'),
  createTrade: (data) => request('/trades', { method: 'POST', body: JSON.stringify(data) }),
  cancelTrade: (id) => request(`/trades/${id}`, { method: 'DELETE' }),
  extendTrade: (id, days) => request(`/trades/${id}/extend`, { method: 'PUT', body: JSON.stringify({ days }) }),
  cleanupTrades: () => request('/trades/cleanup', { method: 'POST' }),
  getTrackInfo: (url) => request(`/trades/track-info?url=${encodeURIComponent(url)}`),
  scanTrackInPlaylists: (uri) => request(`/trades/scan?uri=${encodeURIComponent(uri)}`),
  quickScanTrack: (uri, groupId) => request(`/trades/quick-scan?uri=${encodeURIComponent(uri)}&groupId=${encodeURIComponent(groupId)}`),
  removeTrackFromPlaylist: (accountId, playlistId, trackUri) =>
    request('/trades/remove-from-playlist', { method: 'POST', body: JSON.stringify({ accountId, playlistId, trackUri }) }),

  // Curation
  fetchTracks: (input, accountId) => request('/curation/tracks', { method: 'POST', body: JSON.stringify({ input, accountId }) }),
  fetchPlaylistTracks: (playlistId, accountId) => request('/curation/playlist-tracks', { method: 'POST', body: JSON.stringify({ playlistId, accountId }) }),
  scrapePlaylist: (url) => request('/curation/scrape', { method: 'POST', body: JSON.stringify({ url }) }),
  getAudioFeatures: (trackIds, accountId) => request('/curation/audio-features', { method: 'POST', body: JSON.stringify({ trackIds, accountId }) }),
  detectDuplicates: (myTracks, famousTracks) => request('/curation/duplicates', { method: 'POST', body: JSON.stringify({ myTracks, famousTracks }) }),
  applyCuration: (data) => request('/curation/apply', { method: 'POST', body: JSON.stringify(data) }),
  applyCurationOrdered: (data) => request('/curation/apply-ordered', { method: 'POST', body: JSON.stringify(data) }),

  // Playlist Analysis
  analyzePlaylist: (url) => request(`/playlists/analyze?url=${encodeURIComponent(url)}`),

  // Spotify for Artists (S4A)
  s4aGetRoster: () => request('/s4a/roster'),
  s4aManualSync: (playlistId, playlistData) => request('/s4a/manual-sync', {
    method: 'POST',
    body: JSON.stringify({ playlistId, playlistData })
  }),
  s4aGetArtistSongs: (artistId, period = '28day') => request(`/s4a/artist/${artistId}/songs?period=${period}`),
  s4aGetSongPlaylists: (artistId, trackId) => request(`/s4a/artist/${artistId}/song/${trackId}/playlists`),
  s4aGetSongStats: (artistId, trackId, from, to) => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    return request(`/s4a/song-stats/${artistId}/${trackId}${params.toString() ? '?' + params.toString() : ''}`);
  },
  s4aGetToken: () => request('/s4a/token'),
  s4aEnrichTracks: (trackIds) => request('/s4a/enrich-tracks', { method: 'POST', body: JSON.stringify({ trackIds }) }),
  s4aPushTrackStats: (tracks) => request('/s4a/push-track-stats', { method: 'POST', body: JSON.stringify({ tracks }) }),

  // S4A Scraping (new)
  startS4AScrape: (playlistUrls, artistIds, accountId) =>
    request('/s4a/scrape', {
      method: 'POST',
      body: JSON.stringify({ playlistUrls, artistIds, accountId }),
    }),

  // S4A Scrape SSE subscription
  subscribeS4AScrapeProgress: (taskId, { onProgress, onComplete, onError, onLog }) => {
    const url = `/api/s4a/scrape-stream/${taskId}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'complete') {
          if (onComplete) onComplete(data);
          eventSource.close();
        } else if (data.type === 'error') {
          if (onError) onError(data.error);
          eventSource.close();
        } else if (data.type === 'log') {
          if (onLog) onLog(data.message);
        } else {
          if (onProgress) onProgress(data);
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      if (onError) onError('Connection lost');
      eventSource.close();
    };

    return eventSource;
  },
};
