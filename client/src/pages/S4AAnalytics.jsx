import React, { useState, useRef } from 'react';

const S4AAnalytics = () => {
  const [stage, setStage] = useState('input'); // input, scraping, results
  const [inputMode, setInputMode] = useState('urls'); // urls or artist
  const [urlInput, setUrlInput] = useState('');
  const [selectedArtist, setSelectedArtist] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, percentage: 0, message: '' });
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [artists] = useState([
    { id: '1', name: 'Jean-Baptiste' },
    { id: '2', name: 'Off Key.' },
    { id: '3', name: 'Spitz Aura Records' },
    { id: '4', name: 'A S Team' },
    { id: '5', name: 'Amélie Cochon' },
    { id: '6', name: 'Chowchow Records' }
  ]);

  const logsEndRef = useRef(null);

  const scrollLogsToBottom = () => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  React.useEffect(() => {
    scrollLogsToBottom();
  }, [logs]);

  const addLog = (message, level = 'info') => {
    setLogs(prev => [...prev, { message, level, time: new Date().toLocaleTimeString() }]);
  };

  const parseUrlList = (text) => {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && (line.startsWith('http') || line.includes('artist') || line.includes('song')))
      .slice(0, 100); // Limit to 100 URLs
  };

  const startScrape = async () => {
    let urls = [];
    let artistId = null;

    if (inputMode === 'urls') {
      urls = parseUrlList(urlInput);
      if (urls.length === 0) {
        setError('Please paste at least one valid Spotify for Artists URL');
        return;
      }
    } else {
      if (!selectedArtist) {
        setError('Please select an artist');
        return;
      }
      artistId = selectedArtist.id;
      addLog(`Scraping for artist: ${selectedArtist.name}`);
    }

    setError(null);
    setLogs([]);
    setResults([]);
    setStage('scraping');
    setLoading(true);

    try {
      addLog(`🚀 Starting scrape (${inputMode === 'urls' ? urls.length + ' URLs' : 'Artist: ' + selectedArtist.name})`);

      const response = await fetch(`/api/s4a/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: inputMode === 'urls' ? urls : undefined,
          artist_ids: inputMode === 'artist' ? [artistId] : undefined,
          headless: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start scraper');
      }

      // Handle Server-Sent Events (SSE)
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            try {
              const message = JSON.parse(jsonStr);

              if (message.type === 'session-started') {
                setSessionId(message.sessionId);
                addLog(`📊 Session started: ${message.sessionId.substring(0, 8)}...`);
              } else if (message.type === 'progress') {
                setProgress({
                  current: message.current,
                  total: message.total,
                  percentage: message.percentage,
                  message: message.message
                });
                addLog(`⏳ ${message.current}/${message.total} (${message.percentage}%)`);
              } else if (message.type === 'log') {
                const logMsg = message.message;
                const bgColor = message.level === 'ERROR' ? 'bg-red-900' : message.level === 'WARN' ? 'bg-yellow-900' : 'bg-gray-900';
                addLog(logMsg, message.level.toLowerCase());
              } else if (message.type === 'error') {
                addLog(`❌ ${message.message}`, 'error');
              } else if (message.type === 'complete') {
                addLog(`✅ ${message.message}`);

                // Fetch results
                if (message.session_id) {
                  await fetchResults(message.session_id);
                }
              }
            } catch (e) {
              console.error('Parse error:', e, jsonStr);
            }
          }
        }
      }
    } catch (err) {
      setError(err.message);
      addLog(`❌ Error: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchResults = async (sid) => {
    try {
      const response = await fetch(`/api/s4a/scrape/${sid}/results`);
      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setStage('results');
        addLog(`✅ Retrieved ${data.total} results`);
      }
    } catch (err) {
      addLog(`⚠️ Could not fetch results: ${err.message}`, 'warn');
    }
  };

  const exportCSV = async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/s4a/scrape/${sessionId}/export/csv`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `s4a-${sessionId.substring(0, 8)}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      addLog('📥 CSV exported');
    } catch (err) {
      setError(err.message);
    }
  };

  const storeResults = async () => {
    if (!selectedArtist && inputMode === 'artist') {
      setError('No artist selected');
      return;
    }

    try {
      const artistId = selectedArtist?.id || 'unknown';
      const artistName = selectedArtist?.name || 'Unknown';

      const response = await fetch(`/api/s4a/store-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          artist_id: artistId,
          artist_name: artistName,
          results
        })
      });

      if (response.ok) {
        const data = await response.json();
        addLog(`💾 Stored ${data.stored} results in database`);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-lg p-6 text-white">
        <h1 className="text-3xl font-bold">Spotify for Artists Analytics</h1>
        <p className="text-green-100 mt-2">Fast scraper for S4A track metrics</p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-900/20 border border-red-600 text-red-200 p-4 rounded-lg">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Input Stage */}
      {stage === 'input' && (
        <div className="bg-spotify-card rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold">Input Method</h2>

          <div className="flex gap-4">
            <button
              onClick={() => setInputMode('urls')}
              className={`flex-1 p-4 rounded-lg border-2 transition ${
                inputMode === 'urls'
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-gray-600 hover:border-green-500 bg-gray-700/30'
              }`}
            >
              <div className="font-bold">📋 Paste URLs</div>
              <div className="text-sm text-gray-400">S4A song page URLs</div>
            </button>
            <button
              onClick={() => setInputMode('artist')}
              className={`flex-1 p-4 rounded-lg border-2 transition ${
                inputMode === 'artist'
                  ? 'border-green-500 bg-green-500/10'
                  : 'border-gray-600 hover:border-green-500 bg-gray-700/30'
              }`}
            >
              <div className="font-bold">🎤 Select Artist</div>
              <div className="text-sm text-gray-400">From your roster</div>
            </button>
          </div>

          {inputMode === 'urls' ? (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-300">Paste Spotify for Artists URLs</span>
                <textarea
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://artists.spotify.com/c/artist/ARTIST_ID/song/TRACK_ID&#10;One URL per line..."
                  className="w-full h-48 mt-2 bg-gray-800 text-white p-3 rounded border border-gray-600 focus:border-green-500 outline-none"
                />
              </label>
              <div className="text-sm text-gray-400">
                {parseUrlList(urlInput).length} valid URLs detected (max 100)
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-300">Select Artist</span>
                <select
                  value={selectedArtist?.id || ''}
                  onChange={(e) => {
                    const artist = artists.find(a => a.id === e.target.value);
                    setSelectedArtist(artist);
                  }}
                  className="w-full mt-2 bg-gray-800 text-white p-3 rounded border border-gray-600 focus:border-green-500 outline-none"
                >
                  <option value="">-- Select Artist --</option>
                  {artists.map(artist => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <button
            onClick={startScrape}
            disabled={loading || (inputMode === 'urls' && urlInput.trim() === '') || (inputMode === 'artist' && !selectedArtist)}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white font-bold py-3 rounded-lg transition"
          >
            {loading ? '⏳ Starting...' : '🚀 Start Scrape'}
          </button>
        </div>
      )}

      {/* Scraping Stage */}
      {stage === 'scraping' && (
        <div className="bg-spotify-card rounded-lg p-6 space-y-4">
          <h2 className="text-xl font-bold">📊 Scraping in Progress</h2>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-400">Progress</span>
              <span className="font-bold">
                {progress.current}/{progress.total} ({progress.percentage}%)
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>

          {progress.message && (
            <div className="text-center text-gray-400 py-2">
              {progress.message}
            </div>
          )}

          {/* Logs */}
          <div className="bg-gray-900 rounded p-4 max-h-96 overflow-y-auto font-mono text-xs space-y-1">
            {logs.map((log, idx) => (
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
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* Results Stage */}
      {stage === 'results' && results.length > 0 && (
        <div className="space-y-6">
          <div className="bg-spotify-card rounded-lg p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">✅ Scraping Complete</h2>
              <button
                onClick={() => setStage('input')}
                className="text-gray-400 hover:text-white transition"
              >
                ← Back
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-700/30 p-3 rounded">
                <div className="text-gray-400 text-sm">Total Streams</div>
                <div className="font-bold text-lg">
                  {results.reduce((sum, r) => sum + (r.streams || 0), 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-gray-700/30 p-3 rounded">
                <div className="text-gray-400 text-sm">Total Listeners</div>
                <div className="font-bold text-lg">
                  {results.reduce((sum, r) => sum + (r.listeners || 0), 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-gray-700/30 p-3 rounded">
                <div className="text-gray-400 text-sm">Total Saves</div>
                <div className="font-bold text-lg">
                  {results.reduce((sum, r) => sum + (r.saves || 0), 0).toLocaleString()}
                </div>
              </div>
              <div className="bg-gray-700/30 p-3 rounded">
                <div className="text-gray-400 text-sm">Playlist Adds</div>
                <div className="font-bold text-lg">
                  {results.reduce((sum, r) => {
                    const adds = parseInt(r.playlist_adds) || 0;
                    return sum + (isNaN(adds) ? 0 : adds);
                  }, 0).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="flex gap-3 flex-wrap">
              <button
                onClick={exportCSV}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition"
              >
                📥 Export CSV
              </button>
              <button
                onClick={storeResults}
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition"
              >
                💾 Save to Database
              </button>
              <button
                onClick={() => setStage('input')}
                className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded transition"
              >
                🔄 Scrape Again
              </button>
            </div>
          </div>

          {/* Results Table */}
          <div className="bg-spotify-card rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-800">
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
                  {results.slice(0, 50).map((result, idx) => (
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
              {results.length > 50 && (
                <div className="p-4 text-center text-gray-400">
                  Showing first 50 of {results.length} results (all exported to CSV)
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default S4AAnalytics;
