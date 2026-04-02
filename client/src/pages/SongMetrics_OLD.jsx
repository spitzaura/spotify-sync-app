import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';

export default function SongMetrics() {
  const { accounts } = useApp();
  
  // ============== METRICS TABLE STATE ==============
  const [metrics, setMetrics] = useState([]);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [showAddMetric, setShowAddMetric] = useState(false);
  const [sortBy, setSortBy] = useState('streams');
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'
  const [filterText, setFilterText] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 50;
  const [metricForm, setMetricForm] = useState({
    spotify_uri: '',
    track_name: '',
    artist_name: '',
    released_date: '',
    streams: 0,
    listeners: 0,
    saves: 0,
    save_ratio: 0,
    radio_streams: 0,
    radio_percent: 0,
    playlists_added: 0,
    s_l_ratio: 0,
  });
  const [fetchingTrackInfo, setFetchingTrackInfo] = useState(false);

  // ============== URI EXTRACTOR STATE ==============
  const [uriCollapsed, setUriCollapsed] = useState(false);
  const [playlistUrls, setPlaylistUrls] = useState(['']);
  const [uriLoading, setUriLoading] = useState(false);
  const [uris, setUris] = useState([]);
  const [uriError, setUriError] = useState(null);
  const [selectedUriAccountId, setSelectedUriAccountId] = useState('');
  const [uriCopyFeedback, setUriCopyFeedback] = useState(false);
  const [savingUrisToMetrics, setSavingUrisToMetrics] = useState(false);
  const [uriSaveFeedback, setUriSaveFeedback] = useState(null);

  // ============== S4A ANALYTICS STATE ==============
  const [s4aCollapsed, setS4aCollapsed] = useState(false);
  const [s4aStage, setS4aStage] = useState('input'); // input, scraping, results
  const [s4aInputMode, setS4aInputMode] = useState('urls'); // urls or artist
  const [s4aUrlInput, setS4aUrlInput] = useState('');
  const [s4aSelectedArtist, setS4aSelectedArtist] = useState(null);
  const [s4aSessionId, setS4aSessionId] = useState(null);
  const [s4aProgress, setS4aProgress] = useState({ current: 0, total: 0, percentage: 0, message: '' });
  const [s4aLogs, setS4aLogs] = useState([]);
  const [s4aResults, setS4aResults] = useState([]);
  const [s4aError, setS4aError] = useState(null);
  const [s4aLoading, setS4aLoading] = useState(false);
  const [s4aEnrichingMetrics, setS4aEnrichingMetrics] = useState(false);
  const [s4aArtists] = useState([
    { id: '1', name: 'Jean-Baptiste' },
    { id: '2', name: 'Off Key.' },
    { id: '3', name: 'Spitz Aura Records' },
    { id: '4', name: 'A S Team' },
    { id: '5', name: 'Amélie Cochon' },
    { id: '6', name: 'Chowchow Records' }
  ]);
  const s4aLogsEndRef = useRef(null);

  // ============== INITIAL DATA FETCH ==============
  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch('/api/song-metrics');
      const data = await res.json();
      setMetrics(data);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  };

  // ============== METRICS TABLE METHODS ==============
  const handleMetricUriChange = async (uri) => {
    setMetricForm({ ...metricForm, spotify_uri: uri });

    if (uri.startsWith('spotify:track:') || uri.match(/track[/:]([a-zA-Z0-9]+)/)) {
      setFetchingTrackInfo(true);
      try {
        const match = uri.match(/([a-zA-Z0-9]{22})/);
        if (match) {
          const trackId = match[1];
          const res = await fetch(`/api/song-metrics/track-info/${trackId}`);
          if (res.ok) {
            const data = await res.json();
            setMetricForm(prev => ({
              ...prev,
              spotify_uri: `spotify:track:${trackId}`,
              track_name: data.name || '',
              artist_name: data.artists?.map(a => a.name).join(', ') || '',
              released_date: data.release_date || '',
            }));
          }
        }
      } catch (err) {
        console.warn('Could not fetch track info:', err.message);
      } finally {
        setFetchingTrackInfo(false);
      }
    }
  };

  const handleAddMetric = async () => {
    if (!metricForm.spotify_uri.trim()) {
      alert('Spotify URI required');
      return;
    }

    try {
      const res = await fetch('/api/song-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metricForm),
      });
      const data = await res.json();
      if (res.ok) {
        setMetrics([...metrics, data]);
        setMetricForm({
          spotify_uri: '',
          track_name: '',
          artist_name: '',
          released_date: '',
          streams: 0,
          listeners: 0,
          saves: 0,
          save_ratio: 0,
          radio_streams: 0,
          radio_percent: 0,
          playlists_added: 0,
          s_l_ratio: 0,
        });
        setShowAddMetric(false);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleMetricDelete = async (uri) => {
    if (!confirm('Delete this song metric?')) return;
    try {
      const trackId = uri.split(':')[2];
      await fetch(`/api/song-metrics/${trackId}`, { method: 'DELETE' });
      setMetrics(metrics.filter(m => m.spotify_uri !== uri));
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  // ============== URI EXTRACTOR METHODS ==============
  const extractPlaylistId = (url) => {
    try {
      if (url.includes('open.spotify.com/playlist/')) {
        const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
      }
      if (url.includes('spotify:playlist:')) {
        const match = url.match(/spotify:playlist:([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  const handleUriExtract = async () => {
    setUriError(null);
    setUris([]);

    const validUrls = playlistUrls.filter(u => u.trim());
    if (validUrls.length === 0) {
      setUriError('Please paste at least one Spotify playlist URL');
      return;
    }

    const uniquePlaylistIds = new Set();
    const uniqueUrls = [];
    for (const url of validUrls) {
      const id = extractPlaylistId(url);
      if (id && !uniquePlaylistIds.has(id)) {
        uniquePlaylistIds.add(id);
        uniqueUrls.push(url);
      }
    }

    if (uniqueUrls.length === 0) {
      setUriError('No valid playlist URLs found');
      return;
    }

    if (!selectedUriAccountId) {
      setUriError('Please select a Spotify account');
      return;
    }

    setUriLoading(true);
    const allUris = [];

    try {
      for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        const playlistId = extractPlaylistId(url);
        
        if (!playlistId) {
          setUriError(`Playlist ${i + 1}: Invalid URL format`);
          setUriLoading(false);
          return;
        }

        const res = await fetch('/api/extract-playlist-uris', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistId, accountId: selectedUriAccountId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setUriError(`Playlist ${i + 1}: ${data.error || 'Failed to extract'}`);
          setUriLoading(false);
          return;
        }

        if (data.uris && data.uris.length > 0) {
          allUris.push(...data.uris);
        }
      }

      if (allUris.length === 0) {
        setUriError('No tracks found in any playlists');
        return;
      }

      setUris(allUris);
      setUriCollapsed(true);
    } catch (err) {
      setUriError(`Error: ${err.message}`);
    } finally {
      setUriLoading(false);
    }
  };

  const addPlaylistUrl = () => {
    setPlaylistUrls([...playlistUrls, '']);
  };

  const removePlaylistUrl = (idx) => {
    setPlaylistUrls(playlistUrls.filter((_, i) => i !== idx));
  };

  const updatePlaylistUrl = (idx, val) => {
    const updated = [...playlistUrls];
    updated[idx] = val;
    setPlaylistUrls(updated);
  };

  const uriCopyToClipboard = async () => {
    const text = uris.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setUriCopyFeedback(true);
      setTimeout(() => setUriCopyFeedback(false), 2000);
    } catch (err) {
      alert('Failed to copy to clipboard');
    }
  };

  const uriDownloadCSV = () => {
    const csv = uris.map((uri, i) => `${i + 1},${uri}`).join('\n');
    const header = 'Index,Spotify URI\n';
    const blob = new Blob([header + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playlist-uris-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uriDownloadTXT = () => {
    const text = uris.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playlist-uris-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveUrisToMetrics = async () => {
    setSavingUrisToMetrics(true);
    setUriSaveFeedback(null);

    try {
      const songs = uris.map(uri => ({
        spotify_uri: uri,
      }));

      const res = await fetch('/api/song-metrics/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs, accountId: selectedUriAccountId }),
      });

      const data = await res.json();

      if (res.ok && data.imported > 0) {
        setUriSaveFeedback({
          status: 'success',
          message: `✅ Saved ${data.imported} songs to Metrics with metadata (name, artist, release date)`,
        });
        fetchMetrics();
        setTimeout(() => {
          setUriSaveFeedback(null);
          setUris([]);
          setPlaylistUrls(['']);
        }, 3000);
      } else {
        setUriSaveFeedback({
          status: 'error',
          message: `Error: ${data.error || 'Failed to save'}`,
        });
      }
    } catch (err) {
      setUriSaveFeedback({
        status: 'error',
        message: `Error: ${err.message}`,
      });
    } finally {
      setSavingUrisToMetrics(false);
    }
  };

  // ============== S4A ANALYTICS METHODS ==============
  const s4aAddLog = (message, level = 'info') => {
    setS4aLogs(prev => [...prev, { message, level, time: new Date().toLocaleTimeString() }]);
  };

  const s4aParseUrlList = (text) => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.startsWith('http') || line.includes('artist') || line.includes('song')))
      .slice(0, 100);
  };

  useEffect(() => {
    s4aLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [s4aLogs]);

  const s4aStartScrape = async () => {
    let urls = [];
    let artistId = null;

    if (s4aInputMode === 'urls') {
      urls = s4aParseUrlList(s4aUrlInput);
      if (urls.length === 0) {
        setS4aError('Please paste at least one valid Spotify for Artists URL');
        return;
      }
    } else {
      if (!s4aSelectedArtist) {
        setS4aError('Please select an artist');
        return;
      }
      artistId = s4aSelectedArtist.id;
      s4aAddLog(`Scraping for artist: ${s4aSelectedArtist.name}`);
    }

    setS4aError(null);
    setS4aLogs([]);
    setS4aResults([]);
    setS4aStage('scraping');
    setS4aLoading(true);

    try {
      s4aAddLog(`🚀 Starting scrape (${s4aInputMode === 'urls' ? urls.length + ' URLs' : 'Artist: ' + s4aSelectedArtist.name})`);

      // Use PROVEN fast scraper endpoint
      const response = await fetch(`/api/s4a/scrape-enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: s4aInputMode === 'urls' ? urls : undefined,
          artist_ids: s4aInputMode === 'artist' ? [artistId] : undefined,
          headless: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start scraper');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const message = JSON.parse(jsonStr);

              if (message.type === 'session-started') {
                setS4aSessionId(message.sessionId);
                s4aAddLog(`📊 Session started: ${message.sessionId.substring(0, 8)}...`);
              } else if (message.type === 'progress') {
                setS4aProgress({
                  current: message.current,
                  total: message.total,
                  percentage: message.percentage,
                  message: message.message
                });
                s4aAddLog(`⏳ ${message.current}/${message.total} (${message.percentage}%)`);
              } else if (message.type === 'log') {
                const logMsg = message.message;
                s4aAddLog(logMsg, message.level.toLowerCase());
              } else if (message.type === 'error') {
                s4aAddLog(`❌ ${message.message}`, 'error');
              } else if (message.type === 'complete') {
                s4aAddLog(`✅ ${message.message}`);
                if (message.saved) {
                  s4aAddLog(`✅ Enriched ${message.saved} of ${message.total} songs`);
                }
                // Auto-refresh metrics table
                await fetchMetrics();
              }
            } catch (e) {
              console.error('Parse error:', e, jsonStr);
            }
          }
        }
      }
    } catch (err) {
      setS4aError(err.message);
      s4aAddLog(`❌ Error: ${err.message}`, 'error');
    } finally {
      setS4aLoading(false);
    }
  };

  const s4aFetchResults = async (sid) => {
    try {
      const response = await fetch(`/api/s4a/scrape/${sid}/results`);
      if (response.ok) {
        const data = await response.json();
        setS4aResults(data.results || []);
        setS4aStage('results');
        s4aAddLog(`✅ Retrieved ${data.total} results - Ready to enrich metrics`);
        setS4aCollapsed(true);
      }
    } catch (err) {
      s4aAddLog(`⚠️ Could not fetch results: ${err.message}`, 'warn');
    }
  };

  const s4aExportCSV = async () => {
    if (!s4aSessionId) return;
    try {
      const response = await fetch(`/api/s4a/scrape/${s4aSessionId}/export/csv`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `s4a-${s4aSessionId.substring(0, 8)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      s4aAddLog('📥 CSV exported');
    } catch (err) {
      setS4aError(err.message);
    }
  };

  // Extract track ID from Spotify URI
  const extractTrackId = (uri) => {
    const match = uri.match(/([a-zA-Z0-9]{22})/);
    return match ? match[1] : null;
  };

  // Enrich metrics with S4A performance data
  const s4aEnrichMetrics = async () => {
    if (s4aResults.length === 0) {
      setS4aError('No scrape results to enrich with');
      return;
    }

    setS4aEnrichingMetrics(true);
    setS4aError(null);

    try {
      s4aAddLog('🔄 Matching S4A data to metrics...');
      
      let matched = 0;
      let unmatched = 0;
      const updatedMetrics = [...metrics];

      // For each S4A result, find matching metric by track_id
      for (const result of s4aResults) {
        // Try to find metric with matching track_id
        const metricIndex = updatedMetrics.findIndex(m => {
          const trackId = extractTrackId(m.spotify_uri);
          return trackId === result.track_id;
        });

        if (metricIndex !== -1) {
          // Update the metric with performance data
          updatedMetrics[metricIndex] = {
            ...updatedMetrics[metricIndex],
            streams: parseInt(result.streams) || updatedMetrics[metricIndex].streams || 0,
            listeners: parseInt(result.listeners) || updatedMetrics[metricIndex].listeners || 0,
            saves: parseInt(result.saves) || updatedMetrics[metricIndex].saves || 0,
            save_ratio: parseFloat(result.save_ratio) || updatedMetrics[metricIndex].save_ratio || 0,
            radio_streams: parseInt(result.radio_streams) || updatedMetrics[metricIndex].radio_streams || 0,
            radio_percent: parseFloat(result.radio_percent) || updatedMetrics[metricIndex].radio_percent || 0,
            playlists_added: parseInt(result.playlist_adds) || updatedMetrics[metricIndex].playlists_added || 0,
          };
          matched++;
          s4aAddLog(`✅ Matched: ${updatedMetrics[metricIndex].track_name}`);
        } else {
          unmatched++;
          s4aAddLog(`⚠️ No match found for track ${result.track_id}`, 'warn');
        }
      }

      // Send all updated metrics to backend
      for (const metric of updatedMetrics) {
        if (metric.id) {
          await fetch(`/api/song-metrics/${metric.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metric),
          });
        }
      }

      s4aAddLog(`💾 Updated ${matched} metrics in database`);
      if (unmatched > 0) {
        s4aAddLog(`⚠️ ${unmatched} S4A results had no matching track in metrics`, 'warn');
      }

      // Refresh metrics table
      await fetchMetrics();
      
      // Reset S4A section
      setTimeout(() => {
        setS4aResults([]);
        setS4aStage('input');
        setS4aUrlInput('');
        setS4aSelectedArtist(null);
        setS4aLogs([]);
        setS4aCollapsed(false);
        s4aAddLog(`✅ Done! Your metrics table is now enriched with performance data.`);
      }, 2000);

    } catch (err) {
      setS4aError(`Error enriching metrics: ${err.message}`);
      s4aAddLog(`❌ Error: ${err.message}`, 'error');
    } finally {
      setS4aEnrichingMetrics(false);
    }
  };

  // ============== HELPER METHODS ==============
  const parseCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const songs = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const values = [];
      let current = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
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
        obj[h] = values[idx];
      });
      if (obj.spotify_uri || obj.track_uri) songs.push(obj);
    }
    return songs;
  };

  // ============== HELPER: Calculate Days Since Release ==============
  const calculateDaysSince = (releaseDate) => {
    if (!releaseDate) return null;
    const release = new Date(releaseDate);
    const today = new Date();
    const diffTime = Math.abs(today - release);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // ============== HELPER: Format Numbers with Commas ==============
  const formatNumber = (num) => {
    return (num || 0).toLocaleString();
  };

  // ============== HELPER: Calculate Save Ratio ==============
  const calculateSaveRatio = (saves, listeners) => {
    if (!listeners || listeners === 0) return 0;
    return ((saves / listeners) * 100).toFixed(2);
  };

  // ============== HELPER: Get Color for Streams ==============
  const getStreamColor = (streams, maxStreams) => {
    if (!streams || maxStreams === 0) return 'text-gray-400';
    const ratio = streams / maxStreams;
    if (ratio >= 0.75) return 'text-green-400 font-semibold';
    if (ratio >= 0.5) return 'text-blue-400';
    if (ratio >= 0.25) return 'text-yellow-400';
    return 'text-gray-500';
  };

  // ============== FILTERING & SORTING ==============
  const maxStreams = Math.max(...metrics.map(m => m.streams || 0), 1);
  
  const filtered = metrics
    .filter(m => 
      m.track_name?.toLowerCase().includes(filterText.toLowerCase()) ||
      m.artist_name?.toLowerCase().includes(filterText.toLowerCase())
    )
    .sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      // Handle special cases
      if (sortBy === 'days_since') {
        aVal = calculateDaysSince(a.released_date) || 0;
        bVal = calculateDaysSince(b.released_date) || 0;
      } else if (sortBy === 'save_ratio') {
        aVal = calculateSaveRatio(a.saves, a.listeners);
        bVal = calculateSaveRatio(b.saves, b.listeners);
      }

      aVal = aVal || 0;
      bVal = bVal || 0;

      const result = typeof aVal === 'number' 
        ? aVal - bVal 
        : String(aVal).localeCompare(String(bVal));

      return sortDirection === 'desc' ? -result : result;
    });

  // ============== PAGINATION ==============
  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
  const endIdx = startIdx + ROWS_PER_PAGE;
  const paginatedMetrics = filtered.slice(startIdx, endIdx);

  // ============== RENDER ==============
  if (metricsLoading) return <div className="text-center py-12">Loading...</div>;

  return (
    <div className="max-w-7xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">📊 Unified Metrics Dashboard</h1>
        <p className="text-gray-400">Extract URIs from playlists → Enrich with S4A performance data → View complete metrics</p>
      </div>

      {/* ============== SECTION 1: URI EXTRACTOR ============== */}
      <div className="mb-6 bg-spotify-gray rounded-xl border border-blue-700/30 overflow-hidden">
        <div
          onClick={() => setUriCollapsed(!uriCollapsed)}
          className="px-6 py-4 bg-gradient-to-r from-blue-700/30 to-blue-600/20 border-b border-blue-700/30 cursor-pointer hover:bg-blue-700/40 transition flex justify-between items-center"
        >
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>{uriCollapsed ? '▶' : '▼'}</span>
            🎵 STEP 1: EXTRACT PLAYLIST URIs
          </h2>
          {uris.length > 0 && <span className="text-sm text-blue-300">{uris.length} URIs ready</span>}
        </div>

        {!uriCollapsed && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-400">Extract track URIs from Spotify playlists. Metadata (name, artist, release date) will be auto-fetched and saved to metrics.</p>

            {/* Account Selection */}
            <div>
              <label className="block text-sm font-semibold mb-2">Account</label>
              <select
                value={selectedUriAccountId}
                onChange={e => setSelectedUriAccountId(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a Spotify account...</option>
                {accounts.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.display_name} ({acc.email})
                  </option>
                ))}
              </select>
            </div>

            {/* Playlist URLs */}
            <div>
              <label className="block text-sm font-semibold mb-2">Playlist URLs</label>
              <div className="space-y-2 mb-3">
                {playlistUrls.map((url, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Paste: https://open.spotify.com/playlist/xxxxx or spotify:playlist:xxxxx"
                      value={url}
                      onChange={e => updatePlaylistUrl(idx, e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleUriExtract()}
                      className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {playlistUrls.length > 1 && (
                      <button
                        onClick={() => removePlaylistUrl(idx)}
                        className="px-3 py-2 bg-red-900/40 text-red-300 rounded-lg text-sm hover:bg-red-800/50 transition"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={addPlaylistUrl}
                className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-blue-500 hover:text-blue-400 transition text-sm"
              >
                + Add Another Playlist
              </button>
            </div>

            <button
              onClick={handleUriExtract}
              disabled={uriLoading}
              className={`w-full px-6 py-3 rounded-lg font-semibold transition text-sm ${
                uriLoading
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}
            >
              {uriLoading ? '⏳ Extracting...' : '🎵 Extract URIs from Playlist'}
            </button>

            {uriError && (
              <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
                <p className="text-red-400 text-sm">❌ {uriError}</p>
              </div>
            )}

            {/* Results */}
            {uris.length > 0 && (
              <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div className="bg-gray-700/50 px-6 py-4 border-b border-gray-700">
                  <div className="flex justify-between items-center flex-wrap gap-3">
                    <h3 className="text-lg font-bold">✅ Found {uris.length} track{uris.length !== 1 ? 's' : ''}</h3>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={saveUrisToMetrics}
                        disabled={savingUrisToMetrics}
                        className={`px-4 py-2 rounded-lg text-white font-semibold text-sm transition ${
                          savingUrisToMetrics
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-600 hover:bg-blue-500'
                        }`}
                      >
                        {savingUrisToMetrics ? '⏳ Saving...' : '💾 Save to Metrics'}
                      </button>
                      <button
                        onClick={uriCopyToClipboard}
                        className="px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-500 transition text-sm font-semibold"
                      >
                        {uriCopyFeedback ? '✓ Copied!' : '📋 Copy All'}
                      </button>
                      <button
                        onClick={uriDownloadCSV}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition text-sm font-semibold"
                      >
                        📥 CSV
                      </button>
                      <button
                        onClick={uriDownloadTXT}
                        className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition text-sm font-semibold"
                      >
                        📄 TXT
                      </button>
                    </div>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto p-6 space-y-2">
                  {uris.map((uri, idx) => (
                    <div
                      key={idx}
                      className="bg-gray-700/30 rounded-lg px-4 py-3 text-xs text-gray-300 font-mono hover:bg-gray-700/50 transition"
                    >
                      <span className="text-gray-500 mr-3">{idx + 1}.</span>
                      {uri}
                    </div>
                  ))}
                </div>

                {uriSaveFeedback && (
                  <div className={`mx-6 my-3 p-3 rounded-lg text-sm ${
                    uriSaveFeedback.status === 'success'
                      ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                      : 'bg-red-900/20 border border-red-700/30 text-red-400'
                  }`}>
                    {uriSaveFeedback.message}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============== SECTION 2: S4A ANALYTICS (ENRICH METRICS) ============== */}
      <div className="mb-6 bg-spotify-gray rounded-xl border border-green-700/30 overflow-hidden">
        <div
          onClick={() => setS4aCollapsed(!s4aCollapsed)}
          className="px-6 py-4 bg-gradient-to-r from-green-700/30 to-green-600/20 border-b border-green-700/30 cursor-pointer hover:bg-green-700/40 transition flex justify-between items-center"
        >
          <h2 className="text-lg font-bold flex items-center gap-2">
            <span>{s4aCollapsed ? '▶' : '▼'}</span>
            🎤 STEP 2: ENRICH WITH S4A PERFORMANCE DATA
          </h2>
          {s4aResults.length > 0 && <span className="text-sm text-green-300">{s4aResults.length} results ready</span>}
        </div>

        {!s4aCollapsed && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-400">Scrape Spotify for Artists data, then match & enrich your metrics with performance stats (streams, listeners, saves, radio %, etc.)</p>

            {s4aStage === 'input' && (
              <>
                <div className="flex gap-4">
                  <button
                    onClick={() => setS4aInputMode('urls')}
                    className={`flex-1 p-4 rounded-lg border-2 transition ${
                      s4aInputMode === 'urls'
                        ? 'border-green-500 bg-green-500/10'
                        : 'border-gray-600 hover:border-green-500 bg-gray-700/30'
                    }`}
                  >
                    <div className="font-bold">📋 Paste S4A URLs</div>
                    <div className="text-sm text-gray-400">Spotify for Artists song pages</div>
                  </button>
                  <button
                    onClick={() => setS4aInputMode('artist')}
                    className={`flex-1 p-4 rounded-lg border-2 transition ${
                      s4aInputMode === 'artist'
                        ? 'border-green-500 bg-green-500/10'
                        : 'border-gray-600 hover:border-green-500 bg-gray-700/30'
                    }`}
                  >
                    <div className="font-bold">🎤 Scrape Artist</div>
                    <div className="text-sm text-gray-400">All songs from artist</div>
                  </button>
                </div>

                {s4aInputMode === 'urls' ? (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-300">Paste Spotify for Artists URLs</span>
                      <textarea
                        value={s4aUrlInput}
                        onChange={(e) => setS4aUrlInput(e.target.value)}
                        placeholder="https://artists.spotify.com/c/artist/ARTIST_ID/song/TRACK_ID&#10;One URL per line..."
                        className="w-full h-32 mt-2 bg-gray-700 text-white p-3 rounded border border-gray-600 focus:border-green-500 outline-none text-sm"
                      />
                    </label>
                    <div className="text-sm text-gray-400">
                      {s4aParseUrlList(s4aUrlInput).length} valid URLs detected (max 100)
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-sm font-medium text-gray-300">Select Artist to Scrape</span>
                      <select
                        value={s4aSelectedArtist?.id || ''}
                        onChange={(e) => {
                          const artist = s4aArtists.find(a => a.id === e.target.value);
                          setS4aSelectedArtist(artist);
                        }}
                        className="w-full mt-2 bg-gray-700 text-white p-3 rounded border border-gray-600 focus:border-green-500 outline-none"
                      >
                        <option value="">-- Select Artist --</option>
                        {s4aArtists.map(artist => (
                          <option key={artist.id} value={artist.id}>
                            {artist.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                <button
                  onClick={s4aStartScrape}
                  disabled={s4aLoading || (s4aInputMode === 'urls' && s4aUrlInput.trim() === '') || (s4aInputMode === 'artist' && !s4aSelectedArtist)}
                  className={`w-full px-6 py-3 rounded-lg font-semibold transition text-sm ${
                    s4aLoading || (s4aInputMode === 'urls' && s4aUrlInput.trim() === '') || (s4aInputMode === 'artist' && !s4aSelectedArtist)
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-500'
                  }`}
                >
                  {s4aLoading ? '⏳ Starting...' : '🚀 Start S4A Scrape'}
                </button>

                {s4aError && (
                  <div className="bg-red-900/20 border border-red-700/30 rounded-lg p-4">
                    <p className="text-red-400 text-sm">❌ {s4aError}</p>
                  </div>
                )}
              </>
            )}

            {s4aStage === 'scraping' && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold">📊 Scraping Spotify for Artists...</h3>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Progress</span>
                    <span className="font-bold">
                      {s4aProgress.current}/{s4aProgress.total} ({s4aProgress.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-green-500 h-full transition-all"
                      style={{ width: `${s4aProgress.percentage}%` }}
                    />
                  </div>
                </div>

                {s4aProgress.message && (
                  <div className="text-center text-gray-400 py-2">
                    {s4aProgress.message}
                  </div>
                )}

                <div className="bg-gray-900 rounded p-4 max-h-64 overflow-y-auto font-mono text-xs space-y-1">
                  {s4aLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`${
                        log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                          ? 'text-yellow-400'
                          : 'text-gray-300'
                      }`}
                    >
                      <span className="text-gray-600">[{log.time}]</span> {log.message}
                    </div>
                  ))}
                  <div ref={s4aLogsEndRef} />
                </div>
              </div>
            )}

            {s4aStage === 'results' && s4aResults.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold">✅ Scrape Complete - Ready to Enrich Metrics</h3>
                  <button
                    onClick={() => setS4aStage('input')}
                    className="text-gray-400 hover:text-white transition text-sm"
                  >
                    ← Start Over
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-gray-700/30 p-3 rounded">
                    <div className="text-gray-400 text-sm">Total Streams</div>
                    <div className="font-bold text-lg">
                      {s4aResults.reduce((sum, r) => sum + (r.streams || 0), 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-700/30 p-3 rounded">
                    <div className="text-gray-400 text-sm">Total Listeners</div>
                    <div className="font-bold text-lg">
                      {s4aResults.reduce((sum, r) => sum + (r.listeners || 0), 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-700/30 p-3 rounded">
                    <div className="text-gray-400 text-sm">Total Saves</div>
                    <div className="font-bold text-lg">
                      {s4aResults.reduce((sum, r) => sum + (r.saves || 0), 0).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-gray-700/30 p-3 rounded">
                    <div className="text-gray-400 text-sm">Playlist Adds</div>
                    <div className="font-bold text-lg">
                      {s4aResults.reduce((sum, r) => {
                        const adds = parseInt(r.playlist_adds) || 0;
                        return sum + (isNaN(adds) ? 0 : adds);
                      }, 0).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={s4aEnrichMetrics}
                    disabled={s4aEnrichingMetrics}
                    className={`font-bold py-2 px-4 rounded transition text-sm ${
                      s4aEnrichingMetrics
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {s4aEnrichingMetrics ? '⏳ Enriching Metrics...' : '✨ Enrich Metrics with This Data'}
                  </button>
                  <button
                    onClick={s4aExportCSV}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition text-sm"
                  >
                    📥 Export CSV
                  </button>
                  <button
                    onClick={() => setS4aStage('input')}
                    className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition text-sm"
                  >
                    🔄 Scrape Again
                  </button>
                </div>

                <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-700/50 border-b border-gray-600">
                        <tr>
                          <th className="px-4 py-2 text-left">Track ID</th>
                          <th className="px-4 py-2 text-right">Streams</th>
                          <th className="px-4 py-2 text-right">Listeners</th>
                          <th className="px-4 py-2 text-right">Saves</th>
                          <th className="px-4 py-2 text-right">Radio</th>
                          <th className="px-4 py-2 text-right">Adds</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s4aResults.slice(0, 50).map((result, idx) => (
                          <tr key={idx} className="border-t border-gray-700 hover:bg-gray-700/30 transition">
                            <td className="px-4 py-2 font-mono text-xs">{result.track_id}</td>
                            <td className="px-4 py-2 text-right text-gray-400">
                              {(result.streams || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-400">
                              {(result.listeners || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-400">
                              {(result.saves || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-400">
                              {(result.radio_streams || 0).toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right text-gray-400">
                              {result.playlist_adds || 'N/A'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {s4aResults.length > 50 && (
                      <div className="p-4 text-center text-gray-400 text-sm">
                        Showing first 50 of {s4aResults.length} results
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============== SECTION 3: METRICS TABLE (COMPREHENSIVE) ============== */}
      <div className="bg-spotify-gray rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-6 py-4 bg-gray-800 border-b border-gray-700">
          <h2 className="text-lg font-bold mb-4">📈 STEP 3: COMPLETE METRICS DATABASE</h2>
          <p className="text-sm text-gray-400 mb-4">Your master data: All extracted tracks with full performance metrics. Click column headers to sort.</p>

          {/* Action Buttons */}
          <div className="mb-4 flex gap-2 flex-wrap">
            <button
              onClick={() => setShowAddMetric(!showAddMetric)}
              className="px-4 py-2 rounded-lg font-semibold bg-blue-600 text-white hover:bg-blue-500 transition text-sm"
            >
              ➕ Add Single Song
            </button>
          </div>

          {/* Add Single Song Form */}
          {showAddMetric && (
            <div className="mb-4 bg-gray-700/30 rounded-lg p-4 border border-blue-700/30">
              <h3 className="text-sm font-bold mb-3">➕ Add Song Metric</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="col-span-2 relative">
                  <input
                    type="text"
                    placeholder="Spotify URI (spotify:track:xxxxx) or URL"
                    value={metricForm.spotify_uri}
                    onChange={e => handleMetricUriChange(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {fetchingTrackInfo && <span className="absolute right-3 top-2.5 text-xs text-blue-400">⏳ Fetching...</span>}
                </div>
                <input
                  type="text"
                  placeholder="Track Name"
                  value={metricForm.track_name}
                  onChange={e => setMetricForm({ ...metricForm, track_name: e.target.value })}
                  className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Artist Name"
                  value={metricForm.artist_name}
                  onChange={e => setMetricForm({ ...metricForm, artist_name: e.target.value })}
                  className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input type="date" placeholder="Released Date" value={metricForm.released_date} onChange={e => setMetricForm({ ...metricForm, released_date: e.target.value })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Streams" value={metricForm.streams} onChange={e => setMetricForm({ ...metricForm, streams: parseInt(e.target.value) || 0 })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Listeners" value={metricForm.listeners} onChange={e => setMetricForm({ ...metricForm, listeners: parseInt(e.target.value) || 0 })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Saves" value={metricForm.saves} onChange={e => setMetricForm({ ...metricForm, saves: parseInt(e.target.value) || 0 })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Radio Streams" value={metricForm.radio_streams} onChange={e => setMetricForm({ ...metricForm, radio_streams: parseInt(e.target.value) || 0 })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
                <input type="number" placeholder="Playlists Added" value={metricForm.playlists_added} onChange={e => setMetricForm({ ...metricForm, playlists_added: parseInt(e.target.value) || 0 })} className="bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddMetric} className="px-4 py-2 rounded-lg font-semibold bg-blue-600 text-white hover:bg-blue-500 transition text-sm">➕ Add</button>
                <button onClick={() => setShowAddMetric(false)} className="px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-500 transition text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Filters & Sort */}
          <div className="flex gap-3 mb-4">
            <input
              type="text"
              placeholder="Search song or artist..."
              value={filterText}
              onChange={e => {
                setFilterText(e.target.value);
                setCurrentPage(1); // Reset to first page on search
              }}
              className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Results Info */}
          <div className="flex justify-between items-center text-xs text-gray-400">
            <span>Showing {filtered.length === 0 ? 0 : startIdx + 1} to {Math.min(endIdx, filtered.length)} of {filtered.length} songs</span>
            <span>Page {totalPages === 0 ? 0 : currentPage} of {totalPages}</span>
          </div>
        </div>

        {/* Metrics Table - FULL FEATURED */}
        {filtered.length > 0 ? (
          <>
            {/* Card List Layout */}
            <div className="bg-gray-850 relative w-full">
              <table className="w-full text-xs border-collapse table w-full ">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-gray-700 bg-gray-800/70 backdrop-blur">
                    {/* Spotify URI */}
                    <th 
                      onClick={() => {
                        setSortBy('spotify_uri');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-left font-semibold text-blue-400 hover:bg-gray-700/50 cursor-pointer hidden"
                    >
                      <div className="flex items-center gap-1">
                        🎵 URI
                        {sortBy === 'spotify_uri' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Song Name */}
                    <th 
                      onClick={() => {
                        setSortBy('track_name');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-left font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1">
                        Song Name
                        {sortBy === 'track_name' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Artist */}
                    <th 
                      onClick={() => {
                        setSortBy('artist_name');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-left font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1">
                        Artist
                        {sortBy === 'artist_name' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Released Date */}
                    <th 
                      onClick={() => {
                        setSortBy('released_date');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-center font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-center">
                        Released
                        {sortBy === 'released_date' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Days Since */}
                    <th 
                      onClick={() => {
                        setSortBy('days_since');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-center font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-center">
                        Days Since
                        {sortBy === 'days_since' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Streams */}
                    <th 
                      onClick={() => {
                        setSortBy('streams');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Streams
                        {sortBy === 'streams' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Listeners */}
                    <th 
                      onClick={() => {
                        setSortBy('listeners');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Listeners
                        {sortBy === 'listeners' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Saves */}
                    <th 
                      onClick={() => {
                        setSortBy('saves');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Saves
                        {sortBy === 'saves' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Save Ratio % */}
                    <th 
                      onClick={() => {
                        setSortBy('save_ratio');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Save %
                        {sortBy === 'save_ratio' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Radio Streams */}
                    <th 
                      onClick={() => {
                        setSortBy('radio_streams');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Radio Streams
                        {sortBy === 'radio_streams' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* % Radio */}
                    <th 
                      onClick={() => {
                        setSortBy('radio_percent');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        % Radio
                        {sortBy === 'radio_percent' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Playlists Added */}
                    <th 
                      onClick={() => {
                        setSortBy('playlists_added');
                        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                      }}
                      className="px-2 py-1 text-right font-semibold hover:bg-gray-700/50 cursor-pointer "
                    >
                      <div className="flex items-center gap-1 justify-end">
                        Playlists
                        {sortBy === 'playlists_added' && <span className="text-blue-300">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                      </div>
                    </th>

                    {/* Delete Button */}
                    <th className="px-2 py-1 text-center font-semibold ">Action</th>
                  </tr>
                </thead>

                <tbody>
                  {paginatedMetrics.map((m, i) => {
                    const daysSince = calculateDaysSince(m.released_date);
                    const saveRatio = calculateSaveRatio(m.saves, m.listeners);
                    const streamColor = getStreamColor(m.streams, maxStreams);

                    return (
                      <tr 
                        key={i} 
                        className="border-b border-gray-700/40 hover:bg-gray-800/60 transition duration-150"
                      >
                        {/* Spotify URI - CLICKABLE LINK */}
                        <td className="px-3 py-2 text-blue-400 font-mono text-xs sticky left-0 z-10 bg-gray-850 hover:bg-gray-800/60 border-r border-gray-700/40 hidden">
                          <a 
                            href={`https://open.spotify.com/track/${m.spotify_uri?.split(':')[2] || ''}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-blue-300 underline truncate block"
                            title={m.spotify_uri}
                          >
                            {m.spotify_uri?.substring(0, 16) || 'N/A'}...
                          </a>
                        </td>

                        {/* Song Name */}
                        <td className="px-3 py-2 font-medium text-gray-100 whitespace-nowrap">
                          {m.track_name || '—'}
                        </td>

                        {/* Artist */}
                        <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                          {m.artist_name || '—'}
                        </td>

                        {/* Released Date */}
                        <td className="px-3 py-2 text-gray-400 text-center whitespace-nowrap">
                          {m.released_date || '—'}
                        </td>

                        {/* Days Since */}
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          {daysSince !== null ? (
                            <span className="text-gray-400">{daysSince} days</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>

                        {/* Streams - COLOR CODED */}
                        <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${streamColor}`}>
                          {formatNumber(m.streams)}
                        </td>

                        {/* Listeners */}
                        <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap">
                          {formatNumber(m.listeners)}
                        </td>

                        {/* Saves */}
                        <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap">
                          {formatNumber(m.saves)}
                        </td>

                        {/* Save Ratio % - CALCULATED */}
                        <td className="px-3 py-2 text-right whitespace-nowrap font-semibold text-yellow-400">
                          {parseFloat(saveRatio).toFixed(2)}%
                        </td>

                        {/* Radio Streams */}
                        <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap">
                          {formatNumber(m.radio_streams)}
                        </td>

                        {/* % Radio - 1 DECIMAL */}
                        <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap font-semibold">
                          {(m.radio_percent || 0).toFixed(1)}%
                        </td>

                        {/* Playlists Added */}
                        <td className="px-3 py-2 text-right text-gray-300 whitespace-nowrap font-medium">
                          {m.playlists_added || 0}
                        </td>

                        {/* Delete Button */}
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <button 
                            onClick={() => handleMetricDelete(m.spotify_uri)}
                            className="text-red-400 hover:text-red-300 font-bold text-sm px-2 py-1 rounded hover:bg-red-900/30 transition"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="bg-gray-800 border-t border-gray-700 px-6 py-4 flex justify-center gap-2">
                <button
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50 hover:bg-gray-600 transition text-sm"
                >
                  ⏮ First
                </button>
                <button
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50 hover:bg-gray-600 transition text-sm"
                >
                  ◀ Prev
                </button>

                <div className="flex gap-1">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(page => {
                      // Show first 2, last 2, and current ±1
                      if (page <= 2 || page > totalPages - 2) return true;
                      if (page >= currentPage - 1 && page <= currentPage + 1) return true;
                      return false;
                    })
                    .map((page, idx, arr) => {
                      // Add ellipsis between gaps
                      const prevPage = idx > 0 ? arr[idx - 1] : null;
                      const elements = [];
                      if (prevPage && page - prevPage > 1) {
                        elements.push(
                          <span key={`ellipsis-${page}`} className="px-2 py-1 text-gray-500">…</span>
                        );
                      }
                      elements.push(
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`px-3 py-2 rounded transition text-sm ${
                            currentPage === page
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-700 text-white hover:bg-gray-600'
                          }`}
                        >
                          {page}
                        </button>
                      );
                      return elements;
                    })}
                </div>

                <button
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50 hover:bg-gray-600 transition text-sm"
                >
                  Next ▶
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 rounded bg-gray-700 text-white disabled:opacity-50 hover:bg-gray-600 transition text-sm"
                >
                  Last ⏭
                </button>
              </div>
            )}

            {/* Summary Stats Footer */}
            <div className="bg-gray-800 px-6 py-4 border-t border-gray-700">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Total Streams</div>
                  <div className="font-bold text-lg text-green-400">{formatNumber(filtered.reduce((sum, m) => sum + (m.streams || 0), 0))}</div>
                </div>
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Total Listeners</div>
                  <div className="font-bold text-lg text-blue-400">{formatNumber(filtered.reduce((sum, m) => sum + (m.listeners || 0), 0))}</div>
                </div>
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Total Saves</div>
                  <div className="font-bold text-lg text-purple-400">{formatNumber(filtered.reduce((sum, m) => sum + (m.saves || 0), 0))}</div>
                </div>
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Avg Save Ratio</div>
                  <div className="font-bold text-lg text-yellow-400">
                    {(
                      filtered.reduce((sum, m) => {
                        const ratio = calculateSaveRatio(m.saves, m.listeners);
                        return sum + parseFloat(ratio);
                      }, 0) / (filtered.length || 1)
                    ).toFixed(2)}%
                  </div>
                </div>
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Total Playlist Adds</div>
                  <div className="font-bold text-lg text-pink-400">{formatNumber(filtered.reduce((sum, m) => sum + (m.playlists_added || 0), 0))}</div>
                </div>
                <div className="bg-gray-700/30 p-3 rounded">
                  <div className="text-xs text-gray-500 mb-1">Total Songs</div>
                  <div className="font-bold text-lg text-gray-300">{filtered.length}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12 text-gray-400">
            <p>No song metrics yet. Use Step 1 to extract URIs from playlists.</p>
          </div>
        )}
      </div>
    </div>
  );
}
