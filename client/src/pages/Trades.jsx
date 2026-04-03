import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import PlaylistPicker from '../components/PlaylistPicker';

function getDaysColor(d) { return d > 14 ? 'text-green-400' : d > 7 ? 'text-yellow-400' : 'text-red-400'; }
function getDaysBg(d) { return d > 14 ? 'bg-green-900/20 border-green-700/30' : d > 7 ? 'bg-yellow-900/20 border-yellow-700/30' : 'bg-red-900/20 border-red-700/30'; }
function fmtDate(s) { try { return new Date(s + (s.includes('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return s; } }
function fmtMs(ms) { const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000); return `${m}:${s.toString().padStart(2, '0')}`; }

export default function Trades() {
  const { accounts } = useApp();
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  // Track lookup — supports multiple songs
  const [trackUrls, setTrackUrls] = useState('');
  const [tracks, setTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const autoLoadDebounceRef = React.useRef(null);

  // Scan
  const [placements, setPlacements] = useState(null);
  const [scanning, setScanning] = useState(false);

  // S4A Integration
  const [s4aData, setS4aData] = useState(null);
  const [loadingS4A, setLoadingS4A] = useState(false);
  const [s4aArtists, setS4aArtists] = useState([]);

  // Create trade
  const [showCreate, setShowCreate] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedPlaylists, setSelectedPlaylists] = useState([]);
  const [tradeName, setTradeName] = useState('');
  const [durationDays, setDurationDays] = useState(28);
  const [creating, setCreating] = useState(false);

  // Extend
  const [extendingId, setExtendingId] = useState(null);
  const [extendDays, setExtendDays] = useState(7);

  // Trade scan
  const [scanningTradeId, setScanningTradeId] = useState(null);
  const [tradeScanResults, setTradeScanResults] = useState({});

  // Playlist Analysis
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistAnalysis, setPlaylistAnalysis] = useState(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  
  // S4A Enrichment
  const [s4aEnrichment, setS4aEnrichment] = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  
  // Quick scan
  const [groups, setGroups] = useState([]);
  const [quickScanPlaylistId, setQuickScanPlaylistId] = useState('');
  const [quickScanMode, setQuickScanMode] = useState('master');
  
  // Past trade entry
  const [showAddPastTrade, setShowAddPastTrade] = useState(false);
  const [pastTradeUrls, setPastTradeUrls] = useState(['']);
  const [pastTradeInfos, setPastTradeInfos] = useState([]);
  const [loadingPastTrackIdx, setLoadingPastTrackIdx] = useState(null);
  const [pastTradeDate, setPastTradeDate] = useState('');
  const [pastTradeDays, setPastTradeDays] = useState(28);
  const [pastTradePlaylistNames, setPastTradePlaylistNames] = useState('');

  // Add Trade (quick add track)
  const [showAddPermanent, setShowAddPermanent] = useState(false);
  const [permanentTrackUrl, setPermanentTrackUrl] = useState('');
  const [permanentSelectedPlaylists, setPermanentSelectedPlaylists] = useState([]);
  const [permanentShowPicker, setPermanentShowPicker] = useState(false);
  const [permanentAdding, setPermanentAdding] = useState(false);
  const [permanentResult, setPermanentResult] = useState(null);
  const [permanentPosition, setPermanentPosition] = useState(0);

  const fetchTrades = async () => {
    try {
      setLoading(true);
      await api.cleanupTrades();
      setTrades(await api.getTrades());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const analyzePlaylist = async () => {
    if (!playlistUrl.trim()) return;
    setAnalyzeLoading(true);
    setPlaylistAnalysis(null);
    try {
      const result = await api.analyzePlaylist(playlistUrl);
      setPlaylistAnalysis(result);
    } catch (err) { 
      alert('Analysis failed: ' + err.message); 
    } finally { 
      setAnalyzeLoading(false); 
    }
  };

  const manualSyncS4A = async (playlistData) => {
    if (!playlistUrl.trim()) return;
    try {
      const match = playlistUrl.match(/playlist\/([a-zA-Z0-9]+)/);
      if (!match) {
        alert('Invalid playlist URL');
        return;
      }
      const playlistId = match[1];
      const result = await api.s4aManualSync(playlistId, playlistData);
      alert(result.message || 'S4A data cached successfully!');
    } catch (err) { 
      alert('Manual sync failed: ' + err.message); 
    }
  };

  useEffect(() => { 
    fetchTrades();
    api.getGroups().then(g => setGroups(g)).catch(err => console.warn('Could not load groups:', err.message));
  }, []);

  // Auto-scan each active trade to get real playlist count
  useEffect(() => {
    if (trades.length === 0) return;
    
    const activeTrades = trades.filter(t => t.status === 'active');
    activeTrades.forEach(trade => {
      if (!tradeScanResults[trade.id]) { // Only scan if not already scanned
        handleTradeScan(trade);
      }
    });
  }, [trades]);

  // Parse Spotify track IDs from URLs
  const parseTrackUrls = (urlString) => {
    const urls = urlString.split('\n').map(u => u.trim()).filter(Boolean);
    const trackIds = [];
    const regex = /track\/([a-zA-Z0-9]+)/;
    
    for (const url of urls) {
      const match = url.match(regex);
      if (match) {
        trackIds.push(url);
      }
    }
    return trackIds;
  };

  // Auto-load tracks from multi-line input (debounced)
  const loadTracksAuto = async (urls) => {
    if (urls.length === 0) {
      setTracks([]);
      return;
    }
    
    setLoadingTracks(true);
    const loaded = [];
    
    for (const url of urls) {
      try {
        const info = await api.getTrackInfo(url);
        loaded.push(info);
      } catch (err) {
        console.warn(`Failed to load ${url}: ${err.message}`);
      }
    }
    
    setTracks(loaded);
    setLoadingTracks(false);
  };

  // Watch trackUrls for changes and debounce auto-loading
  useEffect(() => {
    clearTimeout(autoLoadDebounceRef.current);
    
    if (!trackUrls.trim()) {
      setTracks([]);
      return;
    }
    
    const urls = parseTrackUrls(trackUrls);
    if (urls.length === 0) {
      setTracks([]);
      return;
    }
    
    autoLoadDebounceRef.current = setTimeout(() => {
      loadTracksAuto(urls);
    }, 1500);
    
    return () => clearTimeout(autoLoadDebounceRef.current);
  }, [trackUrls]);

  // Remove a single track from the loaded list
  const removeTrack = (index) => {
    setTracks(prev => prev.filter((_, i) => i !== index));
    const urlLines = trackUrls.split('\n');
    urlLines.splice(index, 1);
    setTrackUrls(urlLines.join('\n'));
  };

  // Quick scan (uses first track)
  const quickScan = async () => {
    if (tracks.length === 0 || !quickScanPlaylistId) return;
    setScanning(true);
    setPlacements(null);
    try {
      const found = await api.quickScanTrack(tracks[0].uri, quickScanPlaylistId);
      setPlacements(found);
    } catch (err) { alert('Quick scan failed: ' + err.message); }
    finally { setScanning(false); }
  };

  // Load past trade track info from URL
  const loadPastTrackInfo = async (idx) => {
    if (!pastTradeUrls[idx].trim()) return;
    setLoadingPastTrackIdx(idx);
    try {
      const info = await api.getTrackInfo(pastTradeUrls[idx]);
      const updated = [...pastTradeInfos];
      updated[idx] = info;
      setPastTradeInfos(updated);
    } catch (err) {
      alert('Failed to load track: ' + err.message);
    } finally {
      setLoadingPastTrackIdx(null);
    }
  };

  // Add another URL input
  const addPastTradeUrl = () => {
    setPastTradeUrls([...pastTradeUrls, '']);
  };

  // Remove URL + its loaded info
  const removePastTradeUrl = (idx) => {
    setPastTradeUrls(pastTradeUrls.filter((_, i) => i !== idx));
    setPastTradeInfos(pastTradeInfos.filter((_, i) => i !== idx));
  };

  // Update URL at index
  const updatePastTradeUrl = (idx, val) => {
    const updated = [...pastTradeUrls];
    updated[idx] = val;
    setPastTradeUrls(updated);
  };

  // Add multiple past trades
  const addPastTrade = async () => {
    if (pastTradeInfos.length === 0 || !pastTradeDate || !pastTradePlaylistNames.trim()) {
      alert('Load at least 1 track, set date, and add playlists');
      return;
    }

    try {
      const [year, month, day] = pastTradeDate.split('-');
      const createdAt = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      const expiresAt = new Date(createdAt.getTime() + pastTradeDays * 86400000);
      
      const pad = (n) => String(n).padStart(2, '0');
      const expiresAtStr = `${expiresAt.getFullYear()}-${pad(expiresAt.getMonth() + 1)}-${pad(expiresAt.getDate())} ${pad(expiresAt.getHours())}:${pad(expiresAt.getMinutes())}:${pad(expiresAt.getSeconds())}`;
      
      // Create one trade per track (or one multi-track trade if preferred)
      for (const info of pastTradeInfos) {
        const trackUri = info.uri || `spotify:track:${info.id}`;
        
        const response = await fetch('/api/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${info.name} — ${info.artists}`,
            trackInput: trackUri,
            playlistIds: [],
            durationDays: pastTradeDays,
            notes: `[PAST TRADE] Created: ${pastTradeDate} | Playlists: ${pastTradePlaylistNames}`,
            _expiresAt: expiresAtStr
          })
        });
        
        if (!response.ok) {
          throw new Error(await response.text());
        }
      }

      alert(`✅ ${pastTradeInfos.length} past trade${pastTradeInfos.length !== 1 ? 's' : ''} logged! Expire ${expiresAt.toLocaleDateString()}`);
      fetchTrades();
      setShowAddPastTrade(false);
      setPastTradeUrls(['']);
      setPastTradeInfos([]);
      setPastTradeDate('');
      setPastTradeDays(28);
      setPastTradePlaylistNames('');
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  };

  // Add trade to selected playlists (with position)
  const handleAddPermanent = async () => {
    if (!permanentTrackUrl.trim() || permanentSelectedPlaylists.length === 0) {
      alert('Paste track URL and select target playlists');
      return;
    }

    // Parse track URI
    let trackUri = null;
    const trackMatch = permanentTrackUrl.match(/track[/:]([a-zA-Z0-9]+)/);
    if (trackMatch) {
      trackUri = `spotify:track:${trackMatch[1]}`;
    } else if (permanentTrackUrl.startsWith('spotify:track:')) {
      trackUri = permanentTrackUrl.trim();
    } else if (/^[a-zA-Z0-9]{22}$/.test(permanentTrackUrl.trim())) {
      trackUri = `spotify:track:${permanentTrackUrl.trim()}`;
    }

    if (!trackUri) {
      alert('Invalid Spotify track URL or URI');
      return;
    }

    setPermanentAdding(true);
    setPermanentResult(null);
    try {
      const response = await fetch('/api/trades/add-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackUri,
          playlists: permanentSelectedPlaylists,
          position: permanentPosition > 0 ? permanentPosition - 1 : undefined
        })
      });
      const data = await response.json();
      if (response.ok) {
        setPermanentResult(data);
        setPermanentTrackUrl('');
        setPermanentSelectedPlaylists([]);
        setPermanentPosition(0);
        // Auto-close after 2 seconds
        setTimeout(() => {
          setShowAddPermanent(false);
          setPermanentResult(null);
        }, 2000);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setPermanentAdding(false);
    }
  };

  // Load S4A roster
  useEffect(() => {
    const loadS4ARoster = async () => {
      try {
        const { artists } = await api.s4aGetRoster();
        setS4aArtists(artists);
      } catch (err) {
        console.warn('Could not load S4A roster:', err.message);
      }
    };
    loadS4ARoster();
  }, []);

  // Scan S4A stream data (uses first track)
  const scanS4AStreams = async () => {
    if (tracks.length === 0) return;
    setLoadingS4A(true);
    setS4aData(null);
    
    try {
      const trackId = tracks[0].uri.split(':')[2];
      const streamData = [];
      
      for (const artist of s4aArtists) {
        try {
          const result = await api.s4aGetSongPlaylists(artist.artistId, trackId);
          if (result.playlists && result.playlists.length > 0) {
            streamData.push({
              artist: artist.name,
              artistId: artist.artistId,
              trackId,
              playlists: result.playlists,
              totalStreams: result.playlists.reduce((sum, pl) => sum + (pl.streams || 0), 0),
              totalPlaylists: result.totalPlaylists,
              cached: result.cached,
              cachedAt: result.cachedAt
            });
          }
        } catch (err) {
          // Skip
        }
      }
      
      setS4aData(streamData);
    } catch (err) {
      alert('S4A scan failed: ' + err.message);
    } finally {
      setLoadingS4A(false);
    }
  };

  // Remove from one playlist
  const removeFromPlaylist = async (pl) => {
    const trackName = tracks.length > 0 ? tracks[0].name : 'Unknown';
    if (!confirm(`Remove "${trackName}" from "${pl.playlistName}"?`)) return;
    try {
      await api.removeTrackFromPlaylist(pl.accountId, pl.playlistId, tracks[0].uri);
      setPlacements(prev => prev.filter(p => p.playlistId !== pl.playlistId));
    } catch (err) { alert('Failed: ' + err.message); }
  };

  // Create trade with multiple tracks
  const handleCreate = async () => {
    if (tracks.length === 0 || selectedPlaylists.length === 0) return;
    setCreating(true);
    try {
      const trackUris = tracks.map(t => t.uri);
      const defaultName = tracks.length === 1 
        ? `${tracks[0].name} — ${tracks[0].artists}`
        : `${tracks.length} Songs Trade`;
      
      await api.createTrade({
        name: tradeName || defaultName,
        trackInput: trackUris.join(','),
        playlistIds: selectedPlaylists,
        durationDays,
      });
      setShowCreate(false);
      setSelectedPlaylists([]);
      setTradeName('');
      setTrackUrls('');
      setTracks([]);
      fetchTrades();
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setCreating(false); }
  };

  // Cancel trade
  const handleCancel = async (trade) => {
    if (!confirm(`Cancel "${trade.name}"? Tracks removed from all playlists immediately.`)) return;
    try { await api.cancelTrade(trade.id); fetchTrades(); } catch (err) { alert(err.message); }
  };

  // Scan which playlists a trade is in (uses cache - INSTANT)
  const handleTradeScan = async (trade) => {
    setScanningTradeId(trade.id);
    try {
      // Get all synced playlists (trades are synced to all of them)
      const res = await fetch(`/api/trades/count-playlists`);
      const found = await res.json();
      
      setTradeScanResults(prev => ({ ...prev, [trade.id]: found }));
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanningTradeId(null);
    }
  };

  // Extend trade
  const handleExtend = async (tradeId) => {
    try { await api.extendTrade(tradeId, extendDays); setExtendingId(null); fetchTrades(); }
    catch (err) { alert(err.message); }
  };

  const activeTrades = trades.filter(t => t.status === 'active');
  const pastTrades = trades.filter(t => t.status !== 'active');

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">🤝 Trade Manager</h1>
      <p className="text-spotify-light mb-6">Track placements · 28 day auto-expire · manual remove anytime</p>

      {/* Playlist Analyzer */}
      <div className="bg-spotify-gray rounded-xl p-5 border border-blue-700/30 mb-6">
        <h2 className="text-lg font-bold mb-3">📊 Analyze Playlist</h2>
        <div className="flex gap-2 mb-4">
          <input type="text" value={playlistUrl}
            onChange={e => setPlaylistUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && analyzePlaylist()}
            placeholder="Paste Spotify playlist link..."
            className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          />
          <button onClick={analyzePlaylist} disabled={!playlistUrl.trim() || analyzeLoading}
            className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition ${
              !playlistUrl.trim() || analyzeLoading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}>{analyzeLoading ? '⏳ Analyzing...' : 'Analyze'}</button>
        </div>
        
        {playlistAnalysis && (
          <div className="space-y-4">
            {/* Playlist Summary */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-blue-700/20">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-xs text-blue-400 font-semibold mb-1">PLAYLIST</div>
                  <div className="font-bold truncate">{playlistAnalysis.name}</div>
                  <div className="text-xs text-spotify-light mt-1">{playlistAnalysis.category.toUpperCase()}</div>
                </div>
                <div>
                  <div className="text-xs text-blue-400 font-semibold mb-1">FOLLOWERS</div>
                  <div className="font-bold text-lg">{playlistAnalysis.followers.toLocaleString()}</div>
                  <div className="text-xs text-spotify-light mt-1">{playlistAnalysis.totalTracks} tracks</div>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-700/50 rounded-lg p-3 border border-green-700/30">
                  <div className="text-xs text-green-400 font-semibold mb-1">EST. STREAMS</div>
                  <div className="font-bold text-green-300">{playlistAnalysis.estimatedStreams.toLocaleString()}</div>
                  <div className="text-xs text-spotify-light mt-1">
                    {playlistAnalysis.estimatedStreamsRange[0].toLocaleString()} - {playlistAnalysis.estimatedStreamsRange[1].toLocaleString()}
                  </div>
                </div>
                
                <div className="bg-gray-700/50 rounded-lg p-3 border border-orange-700/30">
                  <div className="text-xs text-orange-400 font-semibold mb-1">SAVES RATIO</div>
                  <div className="font-bold text-orange-300">{playlistAnalysis.savesRatio}</div>
                  <div className="text-xs text-spotify-light mt-1">~{playlistAnalysis.estimatedSaves} saves</div>
                </div>
                
                <div className="bg-gray-700/50 rounded-lg p-3 border border-purple-700/30">
                  <div className="text-xs text-purple-400 font-semibold mb-1">POTENTIAL</div>
                  <div className="font-bold text-purple-300">
                    {playlistAnalysis.followers > 100000 ? '🔥 MEGA' : playlistAnalysis.followers > 10000 ? '⭐ LARGE' : playlistAnalysis.followers > 1000 ? '📈 MEDIUM' : '🎯 NICHE'}
                  </div>
                </div>
              </div>
            </div>
            
            {/* Per-Track Estimates with S4A Data */}
            {playlistAnalysis.tracks && playlistAnalysis.tracks.length > 0 && (
              <div className="bg-gray-800/30 rounded-lg p-4 border border-blue-700/20">
                <h3 className="text-sm font-bold text-blue-400 mb-3">📊 Per-Track Metrics</h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {playlistAnalysis.tracks.slice(0, 20).map((track, idx) => (
                    <div key={idx} className={`rounded-lg px-3 py-2 text-sm ${track.hasS4AData ? 'bg-orange-900/20 border border-orange-700/30' : 'bg-gray-700/40'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {track.image && <img src={track.image} alt="" className="w-6 h-6 rounded" />}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{track.name}</div>
                          <div className="text-xs text-spotify-light truncate">{track.artists}</div>
                        </div>
                        {track.hasS4AData && <span className="text-xs bg-orange-600/50 px-2 py-1 rounded">💡 S4A</span>}
                      </div>
                      
                      {track.hasS4AData ? (
                        <div className="grid grid-cols-4 gap-2 text-xs mt-2">
                          <div className="bg-gray-700/30 rounded px-2 py-1">
                            <div className="text-orange-400 font-semibold text-xs">SAVE RATIO</div>
                            <div className="text-orange-300 font-bold text-sm">{track.saveRatio}</div>
                          </div>
                          <div className="bg-gray-700/30 rounded px-2 py-1">
                            <div className="text-green-400 font-semibold text-xs">STREAMS</div>
                            <div className="text-green-300 font-bold">{track.s4aStreams?.toLocaleString()}</div>
                          </div>
                          <div className="bg-gray-700/30 rounded px-2 py-1">
                            <div className="text-blue-400 font-semibold text-xs">LISTENERS</div>
                            <div className="text-blue-300 font-bold">{track.s4aListeners?.toLocaleString()}</div>
                          </div>
                          <div className="bg-gray-700/30 rounded px-2 py-1">
                            <div className="text-purple-400 font-semibold text-xs">SAVES</div>
                            <div className="text-purple-300 font-bold">{track.s4aSaves?.toLocaleString()}</div>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                          <div>
                            <div className="text-green-400 font-semibold text-xs">EST. STREAMS</div>
                            <div className="text-green-300 font-bold">{track.estimatedStreams.toLocaleString()}</div>
                          </div>
                          <div className="text-xs text-spotify-light">
                            Range: {track.estimatedStreamsRange[0]} - {track.estimatedStreamsRange[1]}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {playlistAnalysis.tracks.length > 20 && (
                    <div className="text-xs text-spotify-light text-center pt-2">... and {playlistAnalysis.tracks.length - 20} more</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* S4A Enrichment Results */}
        {s4aEnrichment && (
          <div className="space-y-4">
            <div className="bg-gray-800/30 rounded-lg p-4 border border-orange-700/20">
              <h3 className="text-sm font-bold text-orange-400 mb-3">
                🧠 S4A Data — {s4aEnrichment.matchedTracks}/{s4aEnrichment.totalTracks} tracks matched
              </h3>
              {s4aEnrichment.data && s4aEnrichment.data.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {s4aEnrichment.data.map((track, idx) => (
                    <div key={idx} className="bg-gray-700/40 rounded-lg px-3 py-2.5 text-xs">
                      <div className="font-medium mb-1.5">{track.trackName}</div>
                      <div className="grid grid-cols-5 gap-2 text-orange-300">
                        <div>
                          <div className="text-orange-500 font-bold text-xs">ADDS</div>
                          <div>{track.adds}</div>
                        </div>
                        <div>
                          <div className="text-orange-500 font-bold text-xs">RADIO</div>
                          <div>{track.radioStreams}</div>
                        </div>
                        <div>
                          <div className="text-orange-500 font-bold text-xs">STREAMS</div>
                          <div>{track.streams}</div>
                        </div>
                        <div>
                          <div className="text-orange-500 font-bold text-xs">LISTENERS</div>
                          <div>{track.listeners}</div>
                        </div>
                        <div>
                          <div className="text-orange-500 font-bold text-xs">SAVES</div>
                          <div>{track.saves}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-spotify-light">No S4A data found for playlist tracks</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Multi-Track Lookup */}
      <div className="bg-spotify-gray rounded-xl p-5 border border-gray-700 mb-6">
        <h2 className="text-lg font-bold mb-3">🔍 Look Up Songs</h2>
        <p className="text-xs text-spotify-light mb-3">Paste Spotify track links (one per line) to load multiple songs</p>
        
        <textarea 
          value={trackUrls}
          onChange={e => setTrackUrls(e.target.value)}
          placeholder="https://open.spotify.com/track/...&#10;https://open.spotify.com/track/...&#10;https://open.spotify.com/track/..."
          className="w-full bg-gray-700 text-white rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-spotify-green text-sm h-24 resize-none font-mono"
        />
        
        {loadingTracks && (
          <div className="text-center py-4 text-spotify-light">
            ⏳ Loading {tracks.length} track{tracks.length !== 1 ? 's' : ''}...
          </div>
        )}
        
        {/* Loaded Tracks List */}
        {tracks.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-bold text-spotify-light mb-3">
              ✅ Loaded {tracks.length} track{tracks.length !== 1 ? 's' : ''}
            </h3>
            <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
              {tracks.map((track, idx) => (
                <div key={idx} className="flex items-center gap-3 bg-gray-800/50 rounded-lg p-3">
                  {track.image && <img src={track.image} alt="" className="w-12 h-12 rounded" />}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate">{track.name}</h4>
                    <p className="text-xs text-spotify-light truncate">{track.artists}</p>
                    <p className="text-xs text-spotify-light mt-1">{fmtMs(track.duration_ms)}</p>
                  </div>
                  <button 
                    onClick={() => removeTrack(idx)}
                    className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs bg-red-900/40 text-red-300 hover:bg-red-800/50 transition font-semibold">
                    🗑️ Remove
                  </button>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              {groups.length > 0 && (
                <>
                  <select value={quickScanPlaylistId}
                    onChange={e => setQuickScanPlaylistId(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm bg-gray-700 text-white border border-gray-600 outline-none focus:border-green-600">
                    <option value="">Select Master Playlist...</option>
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <button onClick={quickScan} disabled={scanning || !quickScanPlaylistId}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                      scanning || !quickScanPlaylistId ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-500'
                    }`}>{scanning ? '⏳ Scanning...' : '⚡ Quick Scan'}</button>
                </>
              )}
              
              <button onClick={scanS4AStreams} disabled={loadingS4A || s4aArtists.length === 0 || tracks.length === 0}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  loadingS4A || s4aArtists.length === 0 || tracks.length === 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-orange-600 text-white hover:bg-orange-500'
                }`}>{loadingS4A ? '⏳ Scanning S4A...' : '📊 S4A Streams'}</button>
              
              <button onClick={() => { setShowCreate(true); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-purple-600 text-white hover:bg-purple-500 transition">
                + New Trade ({tracks.length} song{tracks.length !== 1 ? 's' : ''})</button>
            </div>
          </div>
        )}

        {/* Scan results */}
        {placements && (
          <div className="mt-4">
            <h3 className="text-sm font-bold text-spotify-light mb-2">
              {placements.length === 0 ? '❌ Not found in any playlist' : `✅ Found in ${placements.length} playlist${placements.length > 1 ? 's' : ''}`}
            </h3>
            {placements.length > 0 && (
              <div className="space-y-1.5">
                {placements.map(pl => (
                  <div key={pl.playlistId} className="flex items-center gap-3 bg-gray-800/40 rounded-lg px-4 py-2.5">
                    {pl.image && <img src={pl.image} alt="" className="w-10 h-10 rounded" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{pl.playlistName}</span>
                      <span className="text-xs text-spotify-light">{pl.accountName} · {pl.trackCount} tracks</span>
                    </div>
                    <button onClick={() => removeFromPlaylist(pl)}
                      className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 rounded-lg hover:bg-red-900/20 transition font-semibold flex-shrink-0">
                      🗑️ Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* S4A Stream Results */}
        {s4aData && (
          <div className="mt-4">
            <h3 className="text-sm font-bold text-spotify-light mb-2">
              {s4aData.length === 0 ? '📊 No S4A stream data found' : `📊 S4A Stream Data (${s4aData.length} artist${s4aData.length > 1 ? 's' : ''})`}
            </h3>
            {s4aData.length > 0 && (
              <div className="space-y-3">
                {s4aData.map((artistData, idx) => (
                  <div key={idx} className="bg-gray-800/40 rounded-lg p-4 border border-orange-700/20">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-orange-400">{artistData.artist}</h4>
                        <span className="text-xs text-spotify-light">
                          {artistData.totalPlaylists ? `${artistData.totalPlaylists} playlists total` : ''}
                          {artistData.cachedAt ? ` · cached ${new Date(artistData.cachedAt).toLocaleString()}` : ''}
                        </span>
                      </div>
                      <span className="text-lg font-bold text-orange-300">
                        {artistData.totalStreams.toLocaleString()} <span className="text-xs font-normal text-spotify-light">streams</span>
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-96 overflow-y-auto">
                      {artistData.playlists.map((pl, pIdx) => (
                        <div key={pIdx} className="flex items-center justify-between bg-gray-700/30 rounded-lg px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium truncate block">{pl.name || pl.playlistName || 'Unknown'}</span>
                            <span className="text-xs text-spotify-light">
                              {pl.madeBy && pl.madeBy !== '—' ? `by ${pl.madeBy}` : ''} 
                              {pl.dateAdded && pl.dateAdded !== '—' ? ` · ${pl.dateAdded}` : ''}
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-orange-300 ml-3 flex-shrink-0">
                            {(pl.streams || 0).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Trade Panel */}
      {showCreate && tracks.length > 0 && (
        <div className="bg-spotify-gray rounded-xl p-5 border border-purple-700/30 mb-6">
          <h2 className="text-lg font-bold mb-3">🤝 New Trade — {tracks.length} song{tracks.length !== 1 ? 's' : ''}</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-spotify-light mb-1">Trade Name</label>
              <input type="text" value={tradeName} onChange={e => setTradeName(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none text-sm focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-spotify-light mb-1">Duration</label>
              <div className="flex gap-1.5">
                {[7, 14, 21, 28, 60, 90].map(d => (
                  <button key={d} onClick={() => setDurationDays(d)}
                    className={`px-3 py-2 rounded-lg text-sm transition ${
                      durationDays === d ? 'bg-purple-600 text-white font-semibold' : 'bg-gray-700 text-spotify-light hover:bg-gray-600'
                    }`}>{d}d</button>
                ))}
              </div>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-xs text-spotify-light mb-1">Target Playlists ({selectedPlaylists.length})</label>
            {selectedPlaylists.length > 0 && (
              <div className="space-y-1 mb-2">
                {selectedPlaylists.map(pl => (
                  <div key={pl.playlistId} className="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
                    <span className="text-sm">{pl.playlistName}</span>
                    <button onClick={() => setSelectedPlaylists(prev => prev.filter(p => p.playlistId !== pl.playlistId))}
                      className="text-red-400 hover:text-red-300 text-xs">✕</button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowPicker(true)}
              className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-purple-500 hover:text-purple-400 transition text-sm">
              + Add Target Playlist</button>
          </div>
          <div className="flex gap-3">
            <button onClick={handleCreate} disabled={creating || selectedPlaylists.length === 0}
              className={`px-6 py-2 rounded-lg font-semibold text-sm transition ${
                creating || selectedPlaylists.length === 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-500'
              }`}>{creating ? '⏳...' : `🤝 Create Trade (${tracks.length} song${tracks.length !== 1 ? 's' : ''} → ${selectedPlaylists.length} playlist${selectedPlaylists.length !== 1 ? 's' : ''} × ${durationDays}d)`}</button>
            <button onClick={() => { setShowCreate(false); setSelectedPlaylists([]); }}
              className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Add Past Trade Modal */}
      {showAddPastTrade && (
        <div className="mb-6 bg-spotify-gray rounded-xl p-5 border border-gray-700">
          <h3 className="text-lg font-bold mb-4">📜 Log Past Trade ({pastTradeInfos.length} track{pastTradeInfos.length !== 1 ? 's' : ''})</h3>
          <div className="space-y-3">
            {/* Track URL Inputs */}
            <div className="space-y-2">
              {pastTradeUrls.map((url, idx) => (
                <div key={idx} className="flex gap-2">
                  <input type="text" placeholder="Paste Spotify track link..."
                    value={url} onChange={e => updatePastTradeUrl(idx, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && loadPastTrackInfo(idx)}
                    className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-spotify-green text-sm" />
                  <button onClick={() => loadPastTrackInfo(idx)} disabled={!url.trim() || loadingPastTrackIdx === idx}
                    className={`px-3 py-2.5 rounded-lg text-sm font-bold transition ${
                      !url.trim() || loadingPastTrackIdx === idx ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-spotify-green text-black hover:brightness-110'
                    }`} title="Load track">
                    {loadingPastTrackIdx === idx ? '⏳' : '✓'}
                  </button>
                  {pastTradeUrls.length > 1 && (
                    <button onClick={() => removePastTradeUrl(idx)}
                      className="px-3 py-2.5 rounded-lg text-sm font-bold bg-red-900/40 text-red-300 hover:bg-red-800/50 transition">✕</button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Another URL Button */}
            <button onClick={addPastTradeUrl}
              className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-spotify-green hover:text-spotify-green transition text-sm font-semibold">
              + Add Another Track</button>

            {/* Loaded Tracks */}
            {pastTradeInfos.length > 0 && (
              <div className="bg-gray-800/30 rounded-lg p-3 space-y-2">
                <div className="text-xs text-spotify-light font-semibold">LOADED ({pastTradeInfos.length})</div>
                {pastTradeInfos.map((info, idx) => info && (
                  <div key={idx} className="bg-gray-800/50 rounded-lg p-2.5 flex items-center gap-3">
                    {info.image && <img src={info.image} alt="" className="w-10 h-10 rounded" />}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{info.name}</div>
                      <div className="text-xs text-spotify-light truncate">{info.artists}</div>
                    </div>
                    <button onClick={() => removePastTradeUrl(idx)}
                      className="text-red-400 hover:text-red-300 text-xs font-bold">✕</button>
                  </div>
                ))}
              </div>
            )}
            
            {pastTradeInfos.length > 0 && (
              <>
                <input type="date" value={pastTradeDate} onChange={e => setPastTradeDate(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-spotify-green text-sm" />
                
                <div className="grid grid-cols-3 gap-2">
                  {[7, 14, 21, 28, 35, 42].map(d => (
                    <button key={d} onClick={() => setPastTradeDays(d)}
                      className={`py-2 rounded-lg text-sm font-semibold transition ${
                        pastTradeDays === d ? 'bg-spotify-green text-black' : 'bg-gray-700 text-white hover:bg-gray-600'
                      }`}>{d}d</button>
                  ))}
                </div>
                
                <textarea placeholder="Playlist names (comma-separated: Workout 1, Workout 2, etc.)"
                  value={pastTradePlaylistNames} onChange={e => setPastTradePlaylistNames(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-spotify-green text-sm h-16 resize-none" />
                
                <div className="flex gap-2">
                  <button onClick={addPastTrade}
                    className="px-6 py-2 rounded-lg font-semibold bg-spotify-green text-black hover:brightness-110 transition text-sm">✅ Log {pastTradeInfos.length} Trade{pastTradeInfos.length !== 1 ? 's' : ''}</button>
                  <button onClick={() => { setShowAddPastTrade(false); setPastTradeUrls(['']); setPastTradeInfos([]); }}
                    className="px-4 py-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 transition text-sm">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="mb-6 flex gap-2">
        <button onClick={() => setShowAddPermanent(true)}
          className="px-4 py-2 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-500 transition text-sm">
          ➕ Add Trade</button>
        <button onClick={() => setShowAddPastTrade(true)}
          className="px-4 py-2 rounded-lg font-semibold bg-purple-600 text-white hover:bg-purple-500 transition text-sm">
          📜 Log Past Trade</button>
      </div>

      {/* Add Trade Modal */}
      {showAddPermanent && (
        <div className="mb-6 bg-spotify-gray rounded-xl p-5 border border-emerald-700/30">
          <h3 className="text-lg font-bold mb-4">➕ Add Trade</h3>
          <p className="text-xs text-gray-400 mb-4">Add a track to multiple playlists instantly</p>
          <div className="space-y-3">
            {/* Track URL Input */}
            <div>
              <label className="block text-xs text-spotify-light mb-1">Track URL or URI</label>
              <input type="text" placeholder="https://open.spotify.com/track/xxxxx or spotify:track:xxxxx"
                value={permanentTrackUrl} onChange={e => setPermanentTrackUrl(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
            </div>

            {/* Position Input */}
            <div>
              <label className="block text-xs text-spotify-light mb-1">Position (0 = top, leave empty for end)</label>
              <input type="number" min="0" placeholder="0"
                value={permanentPosition} onChange={e => setPermanentPosition(parseInt(e.target.value) || 0)}
                className="w-full bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
              <p className="text-xs text-gray-500 mt-1">Position 0 = top, 1 = after 1st song, etc.</p>
            </div>

            {/* Target Playlists */}
            <div>
              <label className="block text-xs text-spotify-light mb-1">Target Playlists ({permanentSelectedPlaylists.length})</label>
              {permanentSelectedPlaylists.length > 0 && (
                <div className="space-y-1 mb-2">
                  {permanentSelectedPlaylists.map(pl => (
                    <div key={pl.playlistId} className="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
                      <span className="text-sm">{pl.playlistName}</span>
                      <button onClick={() => setPermanentSelectedPlaylists(prev => prev.filter(p => p.playlistId !== pl.playlistId))}
                        className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setPermanentShowPicker(true)}
                className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-emerald-500 hover:text-emerald-400 transition text-sm">
                + Add Target Playlist</button>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button onClick={handleAddPermanent} disabled={permanentAdding || !permanentTrackUrl.trim() || permanentSelectedPlaylists.length === 0}
                className={`px-6 py-2 rounded-lg font-semibold text-sm transition ${
                  permanentAdding || !permanentTrackUrl.trim() || permanentSelectedPlaylists.length === 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}>{permanentAdding ? '⏳ Adding...' : `➕ Add (${permanentSelectedPlaylists.length} playlist${permanentSelectedPlaylists.length !== 1 ? 's' : ''})`}</button>
              <button onClick={() => { setShowAddPermanent(false); setPermanentSelectedPlaylists([]); }}
                className="px-4 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition text-sm">Cancel</button>
            </div>

            {/* Result */}
            {permanentResult && (
              <div className="mt-3 bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                <div className="text-sm text-green-400 font-medium mb-1">✅ {permanentResult.message}</div>
                {permanentResult.successCount > 0 && (
                  <div className="text-xs text-spotify-light">Added to {permanentResult.successCount}/{permanentResult.targetCount} playlists</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Playlist Picker for Permanent Tracks */}
      {permanentShowPicker && (
        <PlaylistPicker
          accounts={accounts}
          multiSelect={true}
          onSelect={(selected) => {
            setPermanentSelectedPlaylists(prev => [...prev, ...selected]);
            setPermanentShowPicker(false);
          }}
          onCancel={() => setPermanentShowPicker(false)}
        />
      )}

      {/* Active Trades */}
      {activeTrades.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold mb-4">Active ({activeTrades.length})</h2>
          <div className="space-y-3">
            {activeTrades.map(trade => (
              <div key={trade.id} className={`rounded-xl p-4 border ${getDaysBg(trade.days_remaining)}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-bold">{trade.name || 'Unnamed'}</h3>
                    <p className="text-xs text-spotify-light">
                      1 track → {tradeScanResults[trade.id] ? tradeScanResults[trade.id].length : '?'} playlist{tradeScanResults[trade.id]?.length !== 1 ? 's' : ''}
                      {' '}· expires {fmtDate(trade.expires_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-2xl font-bold ${getDaysColor(trade.days_remaining)}`}>{trade.days_remaining}</span>
                    <p className="text-xs text-spotify-light">days</p>
                  </div>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5 mb-3">
                  <div className={`h-1.5 rounded-full ${trade.days_remaining > 14 ? 'bg-green-500' : trade.days_remaining > 7 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${Math.min(100, (trade.days_remaining / trade.duration_days) * 100)}%` }} />
                </div>
                <div className="flex gap-2">
                  {extendingId === trade.id ? (
                    <div className="flex items-center gap-2">
                      {[7, 14, 28].map(d => (
                        <button key={d} onClick={() => setExtendDays(d)}
                          className={`px-2 py-1 rounded text-xs ${extendDays === d ? 'bg-blue-600 text-white' : 'bg-gray-700 text-spotify-light'}`}>+{d}d</button>
                      ))}
                      <button onClick={() => handleExtend(trade.id)}
                        className="px-3 py-1 rounded-lg text-xs bg-spotify-green text-black font-semibold">Go</button>
                      <button onClick={() => setExtendingId(null)}
                        className="px-2 py-1 rounded text-xs bg-gray-600 text-spotify-light">✕</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => { setExtendingId(trade.id); setExtendDays(7); }}
                        className="px-3 py-1.5 rounded-lg text-xs bg-blue-600/40 text-blue-300 hover:bg-blue-600/60 transition">⏰ Extend</button>
                      <button onClick={() => handleTradeScan(trade)} disabled={scanningTradeId === trade.id}
                        className="px-3 py-1.5 rounded-lg text-xs bg-green-600/40 text-green-300 hover:bg-green-600/60 transition">
                        {scanningTradeId === trade.id ? '⏳ Scanning...' : '🔍 Scan'}
                      </button>
                      <button onClick={() => handleCancel(trade)}
                        className="px-3 py-1.5 rounded-lg text-xs bg-red-900/40 text-red-300 hover:bg-red-800/50 transition">🗑️ Remove</button>
                    </>
                  )}
                </div>

                {/* Scan results */}
                {tradeScanResults[trade.id] && tradeScanResults[trade.id].length > 0 && (
                  <div className="mt-3 bg-green-900/20 border border-green-700/30 rounded-lg p-3">
                    <div className="text-xs font-semibold text-green-300 mb-2">Found in {tradeScanResults[trade.id].length} playlist{tradeScanResults[trade.id].length !== 1 ? 's' : ''}:</div>
                    <div className="space-y-1">
                      {tradeScanResults[trade.id].map((pl, idx) => (
                        <div key={idx} className="text-xs text-green-200">
                          • {pl.playlistName} <span className="text-green-400">({pl.accountName})</span> <span className="text-gray-400">in {pl.groupName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {tradeScanResults[trade.id] && tradeScanResults[trade.id].length === 0 && (
                  <div className="mt-3 bg-red-900/20 border border-red-700/30 rounded-lg p-3">
                    <div className="text-xs text-red-300">❌ Track not found in any playlist</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty */}
      {activeTrades.length === 0 && !loading && (
        <div className="bg-spotify-gray rounded-xl p-10 border border-gray-700 text-center mb-8">
          <p className="text-4xl mb-3">🤝</p>
          <p className="text-spotify-light">No active trades. Paste Spotify track links above to get started.</p>
        </div>
      )}

      {/* ALL TRADES LIST */}
      <div className="mt-12 bg-gray-800/30 border border-purple-900/30 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-white mb-4">📋 All Trades ({trades.length})</h2>
        {loading ? (
          <p className="text-spotify-light">Loading...</p>
        ) : trades.length === 0 ? (
          <p className="text-spotify-light">No trades yet.</p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {trades.map(trade => {
              const now = new Date();
              const expires = new Date(trade.expires_at + (trade.expires_at.includes('Z') ? '' : 'Z'));
              const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
              const isExpired = daysLeft <= 0;
              
              return (
                <div key={trade.id} className={`p-4 rounded border ${
                  isExpired ? 'bg-red-900/20 border-red-700/30' : 
                  daysLeft <= 7 ? 'bg-yellow-900/20 border-yellow-700/30' : 
                  'bg-purple-900/20 border-purple-700/30'
                }`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-white">{trade.name || 'Unnamed Trade'}</p>
                      <p className="text-sm text-gray-300 mt-1">Created: {fmtDate(trade.created_at)}</p>
                      <p className="text-sm text-gray-300">Expires: {fmtDate(trade.expires_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${getDaysColor(daysLeft)}`}>
                        {isExpired ? 'EXPIRED' : `${daysLeft}d left`}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Status: {trade.status}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showPicker && (
        <PlaylistPicker accounts={accounts}
          excludeIds={selectedPlaylists.map(p => p.playlistId)}
          onSelect={d => { setSelectedPlaylists(prev => [...prev.filter(p => p.playlistId !== d.playlistId), d]); }}
          onCancel={() => setShowPicker(false)} />
      )}
    </div>
  );
}
