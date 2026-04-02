import React, { useState } from 'react';

export default function DiscoveryAnalytics() {
  const [stage, setStage] = useState('extract'); // extract, s4a, results
  const [extractedUris, setExtractedUris] = useState([]);
  const [s4aUrls, setS4aUrls] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistUrls, setPlaylistUrls] = useState(['']);
  const [selectedAccount, setSelectedAccount] = useState('36f02ec2-5fe2-45f2-99a3-26ec13eef47e');
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const extractPlaylistId = (url) => {
    if (url.includes('open.spotify.com/playlist/')) {
      const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }
    if (url.includes('spotify:playlist:')) {
      const match = url.match(/spotify:playlist:([a-zA-Z0-9]+)/);
      return match ? match[1] : null;
    }
    return null;
  };

  const handleExtractURIs = async () => {
    setError(null);
    setProgress('Extracting URIs...');
    setLoading(true);

    const validUrls = playlistUrls.filter(u => u.trim());
    if (validUrls.length === 0) {
      setError('Paste at least one playlist URL');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/extract-playlist-uris', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistId: extractPlaylistId(validUrls[0]), accountId: selectedAccount }),
      });

      const data = await res.json();
      if (res.ok && data.uris) {
        setExtractedUris(data.uris);
        setProgress(`✅ Extracted ${data.uris.length} URIs`);
        setTimeout(() => setProgress(null), 2000);
      } else {
        setError(data.error || 'Failed to extract URIs');
      }
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleEnrichAndScrape = async () => {
    if (extractedUris.length === 0) {
      setError('No URIs extracted yet');
      return;
    }

    setError(null);
    setProgress('Enriching with S4A URLs...');
    setLoading(true);

    try {
      const eventSource = new EventSource(`/api/s4a/scrape-metrics?accountId=${selectedAccount}`);

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.event === 'progress') {
          setProgress(data.message);
        } else if (data.event === 'complete') {
          setS4aUrls(data.s4a_urls);
          setProgress(`✅ Built ${data.s4a_urls.length} S4A URLs. Ready to scrape.`);
          eventSource.close();
          setLoading(false);
          setTimeout(() => setProgress(null), 3000);
        } else if (data.event === 'error') {
          setError(data.message);
          eventSource.close();
          setLoading(false);
        }
      };

      eventSource.onerror = () => {
        setError('Connection lost');
        eventSource.close();
        setLoading(false);
      };
    } catch (err) {
      setError(`Error: ${err.message}`);
      setLoading(false);
    }
  };

  const handleScrapeS4A = async () => {
    if (s4aUrls.length === 0) {
      setError('No S4A URLs to scrape');
      return;
    }

    setError(null);
    setProgress(`🚀 Scraping ${s4aUrls.length} songs from S4A...`);
    setLoading(true);

    // This would trigger the S4A scraper
    // For now, simulate with a timeout
    setTimeout(() => {
      setProgress(null);
      setStage('results');
      setResults(s4aUrls.map(url => ({ url, status: 'ready' })));
      setLoading(false);
    }, 2000);
  };

  const addPlaylistUrl = () => setPlaylistUrls([...playlistUrls, '']);
  const removePlaylistUrl = (idx) => setPlaylistUrls(playlistUrls.filter((_, i) => i !== idx));
  const updatePlaylistUrl = (idx, val) => {
    const updated = [...playlistUrls];
    updated[idx] = val;
    setPlaylistUrls(updated);
  };

  const copyToClipboard = async () => {
    const text = s4aUrls.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch (err) {
      alert('Failed to copy');
    }
  };

  const downloadCSV = () => {
    const csv = extractedUris.map((uri, i) => `${i + 1},${uri}`).join('\n');
    const header = 'Index,Spotify URI\n';
    const blob = new Blob([header + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uris-${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="max-w-6xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">🔍 Discovery & Analytics</h1>
        <p className="text-gray-400">Extract playlists → Enrich → Scrape S4A → Full Metrics</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-900/20 border border-red-700/30 rounded-lg p-4">
          <p className="text-red-400">❌ {error}</p>
        </div>
      )}

      {/* Progress */}
      {progress && (
        <div className="mb-6 bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
          <p className="text-blue-400">⏳ {progress}</p>
        </div>
      )}

      {/* Stage 1: Extract URIs */}
      {stage === 'extract' && (
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700 mb-6">
          <h2 className="text-xl font-bold mb-4">📋 Step 1: Extract Playlist URIs</h2>

          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2">Playlists (paste URLs)</label>
            <div className="space-y-2 mb-3">
              {playlistUrls.map((url, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="https://open.spotify.com/playlist/xxxxx"
                    value={url}
                    onChange={e => updatePlaylistUrl(idx, e.target.value)}
                    className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-spotify-green"
                  />
                  {playlistUrls.length > 1 && (
                    <button
                      onClick={() => removePlaylistUrl(idx)}
                      className="px-3 py-2 bg-red-900/40 text-red-300 rounded-lg text-sm hover:bg-red-800/50"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={addPlaylistUrl}
              className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-spotify-green transition text-sm"
            >
              + Add Another Playlist
            </button>
          </div>

          <button
            onClick={handleExtractURIs}
            disabled={loading}
            className={`w-full px-6 py-3 rounded-lg font-semibold transition ${
              loading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-spotify-green text-black hover:bg-green-400'
            }`}
          >
            {loading ? '⏳ Extracting...' : '🎵 Extract URIs'}
          </button>
        </div>
      )}

      {/* Stage 2: Enrich & Scrape */}
      {extractedUris.length > 0 && stage === 'extract' && (
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700 mb-6">
          <h2 className="text-xl font-bold mb-4">🔗 Step 2: Enrich & Scrape S4A</h2>
          <p className="text-sm text-gray-400 mb-4">{extractedUris.length} URIs ready</p>

          <button
            onClick={handleEnrichAndScrape}
            disabled={loading}
            className={`w-full px-6 py-3 rounded-lg font-semibold transition ${
              loading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {loading ? '⏳ Enriching...' : '⚡ Enrich & Prep S4A'}
          </button>

          {s4aUrls.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-3">S4A URLs Ready ({s4aUrls.length})</h3>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={copyToClipboard}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition text-sm"
                >
                  {copyFeedback ? '✓ Copied!' : '📋 Copy All URLs'}
                </button>
                <button
                  onClick={handleScrapeS4A}
                  className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-500 transition text-sm"
                >
                  🚀 Start Scrape
                </button>
              </div>
              <div className="bg-gray-800 rounded-lg p-4 max-h-48 overflow-y-auto">
                {s4aUrls.slice(0, 10).map((url, i) => (
                  <div key={i} className="text-xs text-gray-400 font-mono mb-1 break-all">{url}</div>
                ))}
                {s4aUrls.length > 10 && <div className="text-xs text-gray-500 mt-2">... and {s4aUrls.length - 10} more</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {stage === 'results' && (
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700">
          <h2 className="text-xl font-bold mb-4">✅ Results</h2>
          <p className="text-sm text-gray-400 mb-4">Scraped {results.length} songs from S4A</p>
          
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setStage('extract')}
              className="px-4 py-2 rounded-lg bg-gray-600 text-white hover:bg-gray-500 transition text-sm"
            >
              ← Back to Extract
            </button>
            <button
              onClick={downloadCSV}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition text-sm"
            >
              📥 Export CSV
            </button>
          </div>

          <div className="text-center py-8 text-gray-400">
            <p>Metrics data displayed here after S4A scrape completes</p>
          </div>
        </div>
      )}
    </div>
  );
}
