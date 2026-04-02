import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function URIExtractor() {
  const { accounts } = useApp();
  const [playlistUrls, setPlaylistUrls] = useState(['']);
  const [loading, setLoading] = useState(false);
  const [uris, setUris] = useState([]);
  const [error, setError] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [savingMetrics, setSavingMetrics] = useState(false);
  const [saveMetricsFeedback, setSaveMetricsFeedback] = useState(null);

  const extractPlaylistId = (url) => {
    try {
      // Handle https://open.spotify.com/playlist/xxxxx?si=... format
      if (url.includes('open.spotify.com/playlist/')) {
        const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
      }
      // Handle spotify:playlist:xxxxx format
      if (url.includes('spotify:playlist:')) {
        const match = url.match(/spotify:playlist:([a-zA-Z0-9]+)/);
        return match ? match[1] : null;
      }
      return null;
    } catch (err) {
      return null;
    }
  };

  const handleExtract = async () => {
    setError(null);
    setUris([]);

    const validUrls = playlistUrls.filter(u => u.trim());
    if (validUrls.length === 0) {
      setError('Please paste at least one Spotify playlist URL');
      return;
    }

    // Remove duplicates by playlist ID
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
      setError('No valid playlist URLs found');
      return;
    }

    if (uniqueUrls.length < validUrls.length) {
      console.log(`Removed ${validUrls.length - uniqueUrls.length} duplicate playlist(s)`);
    }

    if (!selectedAccountId) {
      setError('Please select a Spotify account');
      return;
    }

    setLoading(true);
    const allUris = [];

    try {
      for (let i = 0; i < uniqueUrls.length; i++) {
        const url = uniqueUrls[i];
        const playlistId = extractPlaylistId(url);
        
        if (!playlistId) {
          setError(`Playlist ${i + 1}: Invalid URL format`);
          setLoading(false);
          return;
        }

        const res = await fetch('/api/extract-playlist-uris', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistId, accountId: selectedAccountId }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(`Playlist ${i + 1}: ${data.error || 'Failed to extract'}`);
          setLoading(false);
          return;
        }

        if (data.uris && data.uris.length > 0) {
          allUris.push(...data.uris);
        }
      }

      if (allUris.length === 0) {
        setError('No tracks found in any playlists');
        return;
      }

      setUris(allUris);
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
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

  const copyToClipboard = async () => {
    const text = uris.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      alert('Failed to copy to clipboard');
    }
  };

  const downloadCSV = () => {
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

  const downloadTXT = () => {
    const text = uris.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `playlist-uris-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveToMetrics = async () => {
    setSavingMetrics(true);
    setSaveMetricsFeedback(null);

    try {
      const songs = uris.map(uri => ({
        spotify_uri: uri,
      }));

      const res = await fetch('/api/song-metrics/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs, accountId: selectedAccountId }),
      });

      const data = await res.json();

      if (res.ok && data.imported > 0) {
        setSaveMetricsFeedback({
          status: 'success',
          message: `✅ Saved ${data.imported} songs to Metrics`,
        });
        setTimeout(() => setSaveMetricsFeedback(null), 3000);
      } else {
        setSaveMetricsFeedback({
          status: 'error',
          message: `Error: ${data.error || 'Failed to save'}`,
        });
      }
    } catch (err) {
      setSaveMetricsFeedback({
        status: 'error',
        message: `Error: ${err.message}`,
      });
    } finally {
      setSavingMetrics(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🎵 Spotify URI Extractor</h1>
        <p className="text-gray-400">Extract all track URIs from a Spotify playlist</p>
      </div>

      {/* Input Section */}
      <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700 mb-6">
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Account</label>
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-spotify-green"
          >
            <option value="">Select a Spotify account...</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.display_name} ({acc.email})
              </option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2">Playlist URLs</label>
          <div className="space-y-2 mb-3">
            {playlistUrls.map((url, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Paste: https://open.spotify.com/playlist/xxxxx or spotify:playlist:xxxxx"
                  value={url}
                  onChange={e => updatePlaylistUrl(idx, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleExtract()}
                  className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-spotify-green"
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
            className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-spotify-green hover:text-spotify-green transition text-sm"
          >
            + Add Another Playlist
          </button>
        </div>

        <button
          onClick={handleExtract}
          disabled={loading}
          className={`w-full px-6 py-3 rounded-lg font-semibold transition text-sm ${
            loading
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-spotify-green text-black hover:bg-green-400'
          }`}
        >
          {loading ? '⏳ Extracting...' : '🎵 Extract URIs'}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
          <p className="text-red-400 text-sm">❌ {error}</p>
        </div>
      )}

      {/* Results Section */}
      {uris.length > 0 && (
        <div className="bg-spotify-gray rounded-xl border border-gray-700 overflow-hidden">
          {/* Header with stats */}
          <div className="bg-gray-800 px-6 py-4 border-b border-gray-700">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold">
                  ✅ Found {uris.length} track{uris.length !== 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  from unique playlists (duplicates removed)
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={saveToMetrics}
                  disabled={savingMetrics}
                  className={`px-4 py-2 rounded-lg text-white font-semibold text-sm transition ${
                    savingMetrics
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-spotify-green hover:bg-green-400 text-black'
                  }`}
                >
                  {savingMetrics ? '⏳ Saving...' : '💾 Save to Metrics'}
                </button>
                <button
                  onClick={copyToClipboard}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition text-sm font-semibold"
                >
                  {copyFeedback ? '✓ Copied!' : '📋 Copy All'}
                </button>
                <button
                  onClick={downloadCSV}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition text-sm font-semibold"
                >
                  📥 CSV
                </button>
                <button
                  onClick={downloadTXT}
                  className="px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition text-sm font-semibold"
                >
                  📄 TXT
                </button>
              </div>
            </div>
          </div>

          {/* URIs List */}
          <div className="max-h-96 overflow-y-auto">
            <div className="p-6 space-y-2">
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
          </div>

          {/* Feedback Message */}
          {saveMetricsFeedback && (
            <div className={`mx-6 my-3 p-3 rounded-lg text-sm ${
              saveMetricsFeedback.status === 'success'
                ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                : 'bg-red-900/20 border border-red-700/30 text-red-400'
            }`}>
              {saveMetricsFeedback.message}
            </div>
          )}

          {/* Footer with stats */}
          <div className="bg-gray-800 px-6 py-3 border-t border-gray-700 text-xs text-gray-400">
            <p>Total URIs: <span className="text-gray-200 font-semibold">{uris.length}</span></p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && uris.length === 0 && !error && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg">Paste Spotify playlist URL(s) above to get started</p>
          <p className="text-sm mt-2">You can add multiple playlists and extract all URIs at once</p>
          <p className="text-sm mt-3 text-gray-600">Supported formats:</p>
          <p className="text-xs mt-1 text-gray-600">• https://open.spotify.com/playlist/xxxxx</p>
          <p className="text-xs text-gray-600">• spotify:playlist:xxxxx</p>
        </div>
      )}
    </div>
  );
}
