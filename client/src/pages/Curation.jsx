import React, { useState, useCallback, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import PlaylistPicker from '../components/PlaylistPicker';

function energyColor(e) {
  if (e == null) return 'bg-gray-600';
  if (e < 0.3) return 'bg-blue-600';
  if (e < 0.5) return 'bg-cyan-500';
  if (e < 0.7) return 'bg-yellow-500';
  if (e < 0.85) return 'bg-orange-500';
  return 'bg-red-500';
}

function energyLabel(e) {
  if (e == null) return '';
  if (e < 0.3) return 'Chill';
  if (e < 0.5) return 'Soft';
  if (e < 0.7) return 'Mid';
  if (e < 0.85) return 'High';
  return 'Fire';
}

function moodEmoji(v, e) {
  if (v == null || e == null) return '🎵';
  if (v > 0.6 && e > 0.6) return '🔥';
  if (v > 0.6) return '😊';
  if (e > 0.6) return '💪';
  if (v <= 0.4 && e <= 0.4) return '🌙';
  return '🎶';
}

// Standalone panel component — fully independent state per side
function PlaylistPanel({ side, label, emoji, color, accentClass, borderClass, tracks, setTracks, selected, setSelected, audioFeatures, trackStats, setTrackStats }) {
  const [links, setLinks] = useState(['']);
  const [loading, setLoading] = useState({});
  const [loadingStats, setLoadingStats] = useState(false);

  const loadPlaylist = useCallback(async (link, index) => {
    setLoading(prev => ({ ...prev, [index]: true }));
    try {
      const result = await api.scrapePlaylist(link);
      const newTracks = result.tracks.map(t => ({
        ...t,
        side,
        playlistName: result.name,
        _key: `${side}_${t.uri}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      }));
      setTracks(prev => [...prev, ...newTracks]);
      setSelected(prev => {
        const next = new Set(prev);
        newTracks.forEach(t => next.add(t._key));
        return next;
      });
    } catch (err) {
      alert(`Failed to load ${label}: ${err.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [index]: false }));
    }
  }, [side, label, setTracks, setSelected]);

  const toggleTrack = (track) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(track._key)) next.delete(track._key);
      else next.add(track._key);
      return next;
    });
  };

  const toggleAll = () => {
    const allSelected = tracks.every(t => selected.has(t._key));
    setSelected(allSelected ? new Set() : new Set(tracks.map(t => t._key)));
  };

  const clearAll = () => {
    setTracks([]);
    setSelected(new Set());
    setLinks(['']);
  };

  const loadS4AStats = async () => {
    if (tracks.length === 0) return;
    setLoadingStats(true);
    try {
      const trackIds = [...new Set(tracks.map(t => t.id).filter(Boolean))];
      const result = await api.s4aEnrichTracks(trackIds);
      if (result.stats) {
        setTrackStats(prev => ({ ...prev, ...result.stats }));
      }
    } catch (err) {
      console.warn('S4A stats failed:', err.message);
    } finally {
      setLoadingStats(false);
    }
  };

  // Auto-load stats when tracks change
  useEffect(() => {
    if (tracks.length > 0) loadS4AStats();
  }, [tracks.length]);

  const selectedCount = tracks.filter(t => selected.has(t._key)).length;

  const fmt = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Group by playlist
  const groups = [];
  let cur = null;
  for (const t of tracks) {
    if (t.playlistName !== cur) { cur = t.playlistName; groups.push({ name: cur, tracks: [] }); }
    groups[groups.length - 1].tracks.push(t);
  }

  return (
    <div className={`bg-spotify-gray rounded-xl p-5 ${borderClass}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold flex items-center gap-2">
          {emoji} {label}
          {tracks.length > 0 && <span className={`text-xs font-normal ${accentClass}`}>{selectedCount}/{tracks.length}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {tracks.length > 0 && (
            <>
              <button onClick={loadS4AStats} disabled={loadingStats}
                className="text-xs text-orange-400 hover:text-orange-300 transition px-2 py-1 rounded hover:bg-orange-900/20">
                {loadingStats ? '⏳' : '📊 S4A'}
              </button>
              <button onClick={toggleAll}
                className={`text-xs text-spotify-light hover:${accentClass} transition px-2 py-1 rounded hover:bg-gray-700`}>
                {tracks.every(t => selected.has(t._key)) ? 'Deselect All' : 'Select All'}
              </button>
              <button onClick={clearAll}
                className="text-xs text-red-400 hover:text-red-300 transition px-2 py-1 rounded hover:bg-red-900/20">
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Link inputs */}
      <div className="space-y-2 mb-3">
        {links.map((link, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={link}
              onChange={e => setLinks(prev => prev.map((l, j) => j === i ? e.target.value : l))}
              onKeyDown={e => e.key === 'Enter' && link.trim() && loadPlaylist(link, i)}
              placeholder={`Paste ${label.toLowerCase()} playlist link...`}
              className={`flex-1 bg-gray-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 text-sm focus:ring-${color}`}
            />
            <button onClick={() => loadPlaylist(link, i)}
              disabled={!link.trim() || loading[i]}
              className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition flex-shrink-0 ${
                loading[i] || !link.trim()
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : side === 'mine' ? 'bg-spotify-green text-black hover:brightness-110' : 'bg-blue-600 text-white hover:bg-blue-500'
              }`}>
              {loading[i] ? '⏳' : 'Load'}
            </button>
          </div>
        ))}
        <button onClick={() => setLinks(prev => [...prev, ''])}
          className="text-xs text-spotify-light hover:text-white transition px-2 py-1">
          + Add another playlist
        </button>
      </div>

      {/* Track list */}
      {tracks.length > 0 && (
        <div className="max-h-[calc(100vh-380px)] overflow-y-auto">
          {groups.map((g, gi) => (
            <div key={gi}>
              {groups.length > 1 && (
                <div className="text-xs text-spotify-light font-medium px-2 py-1.5 bg-gray-800/50 rounded mt-2 first:mt-0 mb-1">
                  📀 {g.name} · {g.tracks.length} tracks
                </div>
              )}
              {g.tracks.map(t => {
                const af = audioFeatures[t.id];
                const st = trackStats?.[t.id];
                return (
                  <div key={t._key} onClick={() => toggleTrack(t)}
                    className={`flex items-center gap-2 text-sm py-1.5 px-2 rounded cursor-pointer transition ${
                      selected.has(t._key) ? 'hover:bg-gray-700/50' : 'opacity-40 hover:opacity-60'
                    }`}>
                    <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition ${
                      selected.has(t._key)
                        ? side === 'mine' ? 'bg-spotify-green border-spotify-green' : 'bg-blue-500 border-blue-500'
                        : 'border-gray-500'
                    }`}>
                      {selected.has(t._key) && <span className="text-[10px] text-black font-bold">✓</span>}
                    </div>
                    <div className="w-8 h-8 rounded bg-gray-600 flex items-center justify-center text-xs flex-shrink-0">
                      {af ? moodEmoji(af.valence, af.energy) : '🎵'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="truncate block text-sm font-medium">{t.name}</span>
                      <span className="text-spotify-light text-xs truncate block">{t.artists}</span>
                    </div>
                    {st && (
                      <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
                        <span className="text-orange-300" title="Streams (28d)">▶{Number(st.streams||0).toLocaleString()}</span>
                        <span className="text-blue-300" title="Listeners">👤{Number(st.listeners||0).toLocaleString()}</span>
                        {st.playlistAdds && <span className="text-green-300" title="Playlist adds">📋{Number(st.playlistAdds).toLocaleString()}</span>}
                        {st.radioPercent && <span className="text-purple-300" title="Radio %">📻{st.radioPercent}</span>}
                      </div>
                    )}
                    {af && !st && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <div className={`w-2 h-2 rounded-full ${energyColor(af.energy)}`} />
                        <span className="text-[10px] text-spotify-light w-6">{energyLabel(af.energy)}</span>
                      </div>
                    )}
                    <span className="text-spotify-light text-xs flex-shrink-0">{fmt(t.duration_ms)}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tracks.length === 0 && !Object.values(loading).some(Boolean) && (
        <div className="text-center text-spotify-light py-12 text-sm">Paste playlist links above</div>
      )}
      {Object.values(loading).some(Boolean) && tracks.length === 0 && (
        <div className="text-center text-spotify-light py-12">⏳ Loading...</div>
      )}
    </div>
  );
}

export default function Curation() {
  const { accounts } = useApp();

  const [myTracks, setMyTracks] = useState([]);
  const [famousTracks, setFamousTracks] = useState([]);

  const [selectedMy, setSelectedMy] = useState(new Set());
  const [selectedFamous, setSelectedFamous] = useState(new Set());

  const [duplicates, setDuplicates] = useState(null);
  const [spacingRules, setSpacingRules] = useState([]);

  const [trackStats, setTrackStats] = useState({});
  const [audioFeatures, setAudioFeatures] = useState({});
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [featuresAccount, setFeaturesAccount] = useState('');

  const [showPicker, setShowPicker] = useState(false);
  const [targetPlaylist, setTargetPlaylist] = useState(null);
  const [leadCount, setLeadCount] = useState(15);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [preview, setPreview] = useState(null);

  // Duplicate detection
  const checkDuplicates = async () => {
    if (myTracks.length === 0 || famousTracks.length === 0) return;
    try {
      const groups = await api.detectDuplicates(myTracks, famousTracks);
      setDuplicates(groups);
    } catch (err) {
      console.error('Duplicate check failed:', err);
    }
  };

  React.useEffect(() => {
    if (myTracks.length > 0 && famousTracks.length > 0) checkDuplicates();
    else setDuplicates(null);
  }, [myTracks.length, famousTracks.length]);

  const removeTrack = (uri, side) => {
    if (side === 'mine') {
      const removing = myTracks.filter(t => t.uri === uri);
      setMyTracks(prev => prev.filter(t => t.uri !== uri));
      setSelectedMy(prev => { const n = new Set(prev); removing.forEach(t => n.delete(t._key)); return n; });
    } else {
      const removing = famousTracks.filter(t => t.uri === uri);
      setFamousTracks(prev => prev.filter(t => t.uri !== uri));
      setSelectedFamous(prev => { const n = new Set(prev); removing.forEach(t => n.delete(t._key)); return n; });
    }
    setDuplicates(prev => prev?.map(g => g.filter(t => !(t.uri === uri && t.side === side))).filter(g => g.length > 1) || null);
    setSpacingRules(prev => prev.filter(r => !r.uris.includes(uri)));
    setApplied(false);
    setPreview(null);
  };

  // Spacing
  const addSpacingRule = (group, gap = 40) => {
    const uris = group.map(t => t.uri);
    // Default: mine first (find the 'mine' track URI)
    const mineTrack = group.find(t => t.side === 'mine');
    const firstUri = mineTrack ? mineTrack.uri : uris[0];
    setSpacingRules(prev => [...prev.filter(r => !r.uris.some(u => uris.includes(u))), { uris, gap, label: group[0].name, firstUri }]);
    setPreview(null);
  };
  const removeSpacingRule = (uris) => { setSpacingRules(prev => prev.filter(r => r.uris[0] !== uris[0])); setPreview(null); };
  const isGroupSpaced = (group) => spacingRules.some(r => r.uris.some(u => group.map(t => t.uri).includes(u)));
  const getGroupGap = (group) => spacingRules.find(r => r.uris.some(u => group.map(t => t.uri).includes(u)))?.gap || 40;
  const getGroupFirstUri = (group) => {
    const rule = spacingRules.find(r => r.uris.some(u => group.map(t => t.uri).includes(u)));
    return rule?.firstUri;
  };
  const updateGap = (group, gap) => {
    const uris = group.map(t => t.uri);
    setSpacingRules(prev => prev.map(r => r.uris.some(u => uris.includes(u)) ? { ...r, gap } : r));
    setPreview(null);
  };
  const toggleFirstUri = (group) => {
    const uris = group.map(t => t.uri);
    setSpacingRules(prev => prev.map(r => {
      if (!r.uris.some(u => uris.includes(u))) return r;
      // Cycle to the other URI
      const otherUri = r.uris.find(u => u !== r.firstUri) || r.uris[0];
      return { ...r, firstUri: otherUri };
    }));
    setPreview(null);
  };

  // Audio features
  const fetchFeatures = async () => {
    if (!featuresAccount) return alert('Pick an account first');
    setLoadingFeatures(true);
    try {
      const ids = [...new Set([...myTracks, ...famousTracks].map(t => t.id).filter(Boolean))];
      setAudioFeatures(await api.getAudioFeatures(ids, featuresAccount));
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setLoadingFeatures(false); }
  };

  // Build order
  const buildOrder = () => {
    const mine = myTracks.filter(t => selectedMy.has(t._key)).map(t => ({ ...t, side: 'mine' }));
    const famous = famousTracks.filter(t => selectedFamous.has(t._key)).map(t => ({ ...t, side: 'famous' }));
    const hasMood = Object.keys(audioFeatures).length > 0;
    const getE = t => audioFeatures[t.id]?.energy ?? 0.5;
    const getV = t => audioFeatures[t.id]?.valence ?? 0.5;

    const result = [];
    let pool = hasMood ? [...famous].sort((a, b) => getE(b) - getE(a)) : [...famous];
    result.push(...pool.splice(0, Math.min(leadCount, pool.length)));

    if (hasMood && pool.length > 0) {
      for (const m of mine) {
        if (pool.length > 0) {
          let best = 0, bestS = Infinity;
          for (let i = 0; i < pool.length; i++) {
            const s = Math.abs(getE(m) - getE(pool[i])) * 0.7 + Math.abs(getV(m) - getV(pool[i])) * 0.3;
            if (s < bestS) { bestS = s; best = i; }
          }
          result.push(pool.splice(best, 1)[0]);
        }
        result.push(m);
      }
    } else {
      let fi = 0;
      for (const m of mine) { if (fi < pool.length) result.push(pool[fi++]); result.push(m); }
      while (fi < pool.length) result.push(pool[fi++]);
    }

    // Enforce spacing with firstUri priority
    for (const rule of spacingRules) {
      // Find all positions of tracks in this rule
      const entries = [];
      for (let i = 0; i < result.length; i++) {
        if (rule.uris.includes(result[i].uri)) {
          entries.push({ idx: i, uri: result[i].uri });
        }
      }
      if (entries.length < 2) continue;

      // If firstUri is set, ensure that track appears first
      if (rule.firstUri) {
        const firstIdx = entries.findIndex(e => e.uri === rule.firstUri);
        if (firstIdx > 0) {
          // The "first" track is currently later — swap positions
          const laterPos = entries[firstIdx].idx;
          const earlierPos = entries[0].idx;
          const temp = result[earlierPos];
          result[earlierPos] = result[laterPos];
          result[laterPos] = temp;
          // Recalculate entries
          entries[0].uri = result[earlierPos].uri;
          entries[firstIdx].uri = result[laterPos].uri;
        }
      }

      // Re-find positions after potential swap
      const pos = [];
      for (let i = 0; i < result.length; i++) {
        if (rule.uris.includes(result[i].uri)) pos.push(i);
      }
      pos.sort((a, b) => a - b);

      // Enforce gap
      for (let p = 1; p < pos.length; p++) {
        if (pos[p] - pos[p - 1] < rule.gap) {
          const tgt = Math.min(pos[p - 1] + rule.gap, result.length - 1);
          const [track] = result.splice(pos[p], 1);
          result.splice(tgt, 0, track);
          pos[p] = tgt;
        }
      }
    }
    return result;
  };

  const applyToPlaylist = async () => {
    if (!targetPlaylist) return;
    setApplying(true);
    try {
      const order = preview || buildOrder();
      await api.applyCurationOrdered({ uris: order.map(t => t.uri), playlistId: targetPlaylist.playlistId, accountId: targetPlaylist.accountId });
      setApplied(true);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setApplying(false); }
  };

  const selectedMyCount = myTracks.filter(t => selectedMy.has(t._key)).length;
  const selectedFamousCount = famousTracks.filter(t => selectedFamous.has(t._key)).length;
  const bothLoaded = myTracks.length > 0 && famousTracks.length > 0;
  const totalSelected = selectedMyCount + selectedFamousCount;
  const hasFeatures = Object.keys(audioFeatures).length > 0;
  const fmt = ms => `${Math.floor(ms/60000)}:${Math.floor((ms%60000)/1000).toString().padStart(2,'0')}`;

  return (
    <div>
      <h1 className="text-3xl font-bold mb-1">🎛️ Smart Curation</h1>
      <p className="text-spotify-light mb-6">Load playlists → select tracks → space duplicates → send</p>

      {/* Duplicates */}
      {duplicates && duplicates.length > 0 && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 mb-6">
          <p className="text-yellow-300 font-bold text-sm mb-2">
            ⚠️ {duplicates.length} duplicate{duplicates.length > 1 ? 's' : ''} — same song, different version
          </p>
          {duplicates.map((group, i) => {
            const spaced = isGroupSpaced(group);
            const gap = getGroupGap(group);
            return (
              <div key={i} className={`mb-3 last:mb-0 rounded-lg p-3 ${spaced ? 'bg-green-900/20 border border-green-700/30' : 'bg-gray-800/50'}`}>
                {group.map((t, j) => (
                  <div key={j} className="flex items-center gap-2 text-sm py-0.5">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                      t.side === 'mine' ? 'bg-spotify-green/20 text-spotify-green' : 'bg-blue-900/50 text-blue-300'
                    }`}>{t.side === 'mine' ? 'MINE' : 'FAMOUS'}</span>
                    <span className="flex-1">{t.name}</span>
                    <span className="text-spotify-light text-xs">— {t.artists}</span>
                    <button onClick={() => removeTrack(t.uri, t.side)}
                      className="text-red-400 hover:text-red-300 text-sm px-1.5 py-0.5 rounded hover:bg-red-900/30 transition flex-shrink-0">✕</button>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
                  {spaced ? (
                    <>
                      <span className="text-green-400 text-xs font-bold">✅ Spaced</span>
                      {(() => {
                        const firstUri = getGroupFirstUri(group);
                        const firstTrack = group.find(t => t.uri === firstUri);
                        const firstLabel = firstTrack?.side === 'mine' ? 'Mine' : 'Famous';
                        const firstColor = firstTrack?.side === 'mine' ? 'text-spotify-green' : 'text-blue-300';
                        return (
                          <button onClick={() => toggleFirstUri(group)}
                            className={`text-xs font-bold px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition ${firstColor}`}
                            title="Click to swap which version plays first">
                            {firstLabel} 1st ⇄
                          </button>
                        );
                      })()}
                      <input type="number" min="3" max="100" value={gap}
                        onChange={e => updateGap(group, parseInt(e.target.value) || 40)}
                        className="w-14 bg-gray-700 text-white rounded px-2 py-1 text-xs text-center border border-gray-600 outline-none" />
                      <span className="text-xs text-spotify-light">apart</span>
                      <button onClick={() => removeSpacingRule(group.map(t => t.uri))}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-900/20 transition ml-auto">Remove</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => addSpacingRule(group, 40)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition">↔️ Space Apart (40)</button>
                      <button onClick={() => addSpacingRule(group, 30)}
                        className="text-xs px-2 py-1 rounded bg-gray-700 text-spotify-light hover:text-white transition">30</button>
                      <button onClick={() => addSpacingRule(group, 50)}
                        className="text-xs px-2 py-1 rounded bg-gray-700 text-spotify-light hover:text-white transition">50</button>
                      <span className="text-xs text-spotify-light">songs between</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Two panels */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <PlaylistPanel
          key="mine"
          side="mine"
          label="My Songs"
          emoji="🎤"
          color="spotify-green"
          accentClass="text-spotify-green"
          borderClass="border-2 border-green-800/50"
          tracks={myTracks}
          setTracks={setMyTracks}
          selected={selectedMy}
          setSelected={setSelectedMy}
          audioFeatures={audioFeatures}
          trackStats={trackStats}
          setTrackStats={setTrackStats}
        />
        <PlaylistPanel
          key="famous"
          side="famous"
          label="Famous Songs"
          emoji="⭐"
          color="blue-500"
          accentClass="text-blue-400"
          borderClass="border-2 border-blue-800/50"
          tracks={famousTracks}
          setTracks={setFamousTracks}
          selected={selectedFamous}
          setSelected={setSelectedFamous}
          audioFeatures={audioFeatures}
          trackStats={trackStats}
          setTrackStats={setTrackStats}
        />
      </div>

      {/* Curate & Send */}
      {bothLoaded && (
        <div className="bg-spotify-gray rounded-xl p-5 border border-gray-700 mb-6">
          <h2 className="text-lg font-bold mb-4">🚀 Curate & Send</h2>
          {!hasFeatures && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-gray-800/50 rounded-lg">
              <span className="text-sm">🎭 Mood-match (optional):</span>
              <select value={featuresAccount} onChange={e => setFeaturesAccount(e.target.value)}
                className="bg-gray-700 text-white rounded-lg px-3 py-1.5 outline-none text-sm border border-gray-600">
                <option value="">Account...</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.display_name} ({a.email || a.spotify_user_id})</option>)}
              </select>
              <button onClick={fetchFeatures} disabled={!featuresAccount || loadingFeatures}
                className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${
                  !featuresAccount || loadingFeatures ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-purple-600 text-white hover:bg-purple-500'
                }`}>{loadingFeatures ? '⏳...' : '🎭 Analyze'}</button>
            </div>
          )}
          {hasFeatures && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-purple-900/20 border border-purple-700/30 rounded-lg">
              <span className="text-sm">🎭 Mood data loaded</span>
              <div className="flex items-center gap-2 text-xs text-spotify-light">
                {[['bg-blue-600','Chill'],['bg-cyan-500','Soft'],['bg-yellow-500','Mid'],['bg-orange-500','High'],['bg-red-500','Fire']].map(([c,l])=>(
                  <span key={l} className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${c}`}/>{l}</span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-spotify-light">Famous lead:</span>
              <input type="number" min="0" max="100" value={leadCount}
                onChange={e => { setLeadCount(parseInt(e.target.value) || 0); setPreview(null); }}
                className="w-16 bg-gray-700 text-white rounded-lg px-3 py-2 outline-none border border-gray-600 text-center text-sm" />
            </div>
            <button onClick={() => setPreview(buildOrder())} disabled={totalSelected === 0}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                totalSelected === 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gray-600 text-white hover:bg-gray-500'
              }`}>👁️ Preview</button>
            {targetPlaylist ? (
              <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-4 py-2">
                <span className="text-sm">🎯 {targetPlaylist.playlistName}</span>
                <button onClick={() => { setTargetPlaylist(null); setApplied(false); }} className="text-red-400 hover:text-red-300 ml-1">✕</button>
              </div>
            ) : (
              <button onClick={() => setShowPicker(true)}
                className="px-4 py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-spotify-green hover:text-spotify-green text-sm transition">
                🎯 Pick Target</button>
            )}
            <button onClick={applyToPlaylist} disabled={!targetPlaylist || applying || applied || totalSelected === 0}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition ${
                !targetPlaylist || applying || applied || totalSelected === 0
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-spotify-green text-black hover:brightness-110'
              }`}>{applied ? '✅ Done!' : applying ? '⏳ Sending...' : `🚀 Send ${totalSelected} tracks`}</button>
          </div>
          <p className="text-xs text-spotify-light mt-3">
            {leadCount} famous first → Famous → Mine #1 → Famous → Mine #2...
            {spacingRules.length > 0 && ` | ${spacingRules.length} spacing rule${spacingRules.length > 1 ? 's' : ''}`}
            {hasFeatures ? ' | Mood-matched' : ''}
          </p>
        </div>
      )}

      {/* Preview */}
      {preview && (
        <div className="bg-spotify-gray rounded-xl p-5 border border-gray-700">
          <h2 className="text-lg font-bold mb-3">
            👁️ Preview
            <span className="text-sm font-normal text-spotify-light ml-2">
              {preview.length} tracks · {preview.filter(t => t.side === 'mine').length} mine · {preview.filter(t => t.side === 'famous').length} famous
            </span>
          </h2>
          <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
            {preview.map((t, i) => {
              const af = audioFeatures[t.id];
              const isSpaced = spacingRules.some(r => r.uris.includes(t.uri));
              return (
                <div key={t.uri + i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
                  t.side === 'mine' ? 'bg-spotify-green/5' : ''} ${isSpaced ? 'ring-1 ring-indigo-500/40' : ''}`}>
                  <span className="text-xs text-spotify-light w-7 text-right flex-shrink-0">{i + 1}</span>
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold flex-shrink-0 w-14 text-center ${
                    t.side === 'mine' ? 'bg-spotify-green/20 text-spotify-green' : 'bg-blue-900/50 text-blue-300'
                  }`}>{t.side === 'mine' ? 'MINE' : 'FAMOUS'}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium truncate block">{t.name}</span>
                    <span className="text-xs text-spotify-light truncate block">{t.artists}</span>
                  </div>
                  {af && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <div className={`w-2 h-2 rounded-full ${energyColor(af.energy)}`} />
                      <span className="text-[10px] text-spotify-light">{Math.round(af.energy * 100)}</span>
                    </div>
                  )}
                  <span className="text-xs text-spotify-light flex-shrink-0">{fmt(t.duration_ms)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showPicker && (
        <PlaylistPicker accounts={accounts} excludeIds={[]}
          onSelect={d => { setTargetPlaylist(d); setShowPicker(false); setApplied(false); }}
          onCancel={() => setShowPicker(false)} />
      )}
    </div>
  );
}
