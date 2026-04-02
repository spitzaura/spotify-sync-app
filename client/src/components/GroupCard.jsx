import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { useApp } from '../context/AppContext';
import PlaylistPicker from './PlaylistPicker';

export default function GroupCard({ group, allGroups = [] }) {
  const { accounts, refresh } = useApp();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncProgress, setSyncProgress] = useState(null);
  const [showMasterPicker, setShowMasterPicker] = useState(false);
  const [showChildPicker, setShowChildPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);

  // Selective sync
  const [selectedChildren, setSelectedChildren] = useState(new Set());

  // Bulk import
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkUrls, setBulkUrls] = useState('');
  const [bulkAccountId, setBulkAccountId] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);

  // Duplicate detection
  const [duplicates, setDuplicates] = useState(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const toggleChild = (childId) => {
    setSelectedChildren(prev => {
      const next = new Set(prev);
      if (next.has(childId)) next.delete(childId);
      else next.add(childId);
      return next;
    });
  };

  const toggleAllChildren = () => {
    if (selectedChildren.size === (group.children?.length || 0)) {
      setSelectedChildren(new Set());
    } else {
      setSelectedChildren(new Set((group.children || []).map(c => c.id)));
    }
  };

  // Check for duplicates when group has a master
  const handleCheckDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      const result = await api.getDuplicates(group.id);
      setDuplicates(result);
    } catch (err) {
      console.error('Duplicate check error:', err);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  // SSE-based sync
  const handleSync = (childIds) => {
    setSyncing(true);
    setSyncResult(null);
    setSyncProgress(null);

    api.syncGroupSSE(group.id, {
      childIds: childIds || undefined,
      onProgress: (event) => {
        setSyncProgress(event);
      },
      onComplete: (event) => {
        setSyncResult({ results: event.results });
        setSyncProgress(null);
        setSyncing(false);
        refresh();
      },
      onError: (error) => {
        setSyncResult({ error });
        setSyncProgress(null);
        setSyncing(false);
      },
    });
  };

  const handleSyncAll = () => handleSync(null);
  const handleSyncSelected = () => {
    if (selectedChildren.size === 0) return;
    handleSync([...selectedChildren]);
  };

  // Cache prep for Quick Scan (no sync to children)
  const [cachePrepLoading, setCachePrepLoading] = useState(false);
  const handleCachePrep = async () => {
    setCachePrepLoading(true);
    try {
      const response = await fetch(`/api/groups/${group.id}/cache-test`, { method: 'POST' });
      const data = await response.json();
      if (response.ok) {
        alert(`✅ ${data.message}`);
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setCachePrepLoading(false);
    }
  };

  // Add single track (new feature)
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [addTrackInput, setAddTrackInput] = useState('');
  const [addTrackLoading, setAddTrackLoading] = useState(false);
  const [addTrackResult, setAddTrackResult] = useState(null);

  const handleAddTrack = async () => {
    if (!addTrackInput.trim()) {
      alert('Please paste a Spotify track URL or URI');
      return;
    }

    // Parse track URI from URL or direct URI
    let trackUri = null;
    const trackMatch = addTrackInput.match(/track[/:]([a-zA-Z0-9]+)/);
    if (trackMatch) {
      trackUri = `spotify:track:${trackMatch[1]}`;
    } else if (addTrackInput.startsWith('spotify:track:')) {
      trackUri = addTrackInput.trim();
    } else if (/^[a-zA-Z0-9]{22}$/.test(addTrackInput.trim())) {
      trackUri = `spotify:track:${addTrackInput.trim()}`;
    }

    if (!trackUri) {
      alert('Invalid Spotify track URL or URI. Expected format: https://open.spotify.com/track/xxxxx or spotify:track:xxxxx');
      return;
    }

    setAddTrackLoading(true);
    setAddTrackResult(null);
    try {
      const response = await fetch(`/api/groups/${group.id}/add-single-track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackUri }),
      });
      const data = await response.json();
      if (response.ok) {
        setAddTrackResult(data);
        setAddTrackInput('');
        // Auto-close after 2 seconds
        setTimeout(() => {
          setShowAddTrack(false);
          setAddTrackResult(null);
        }, 2000);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setAddTrackLoading(false);
    }
  };

  const handleSetMaster = async (data) => {
    try {
      await api.setMaster(group.id, data);
      setShowMasterPicker(false);
      setDuplicates(null);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAddChild = async (data) => {
    try {
      await api.addChild(group.id, data);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCloseChildPicker = () => {
    setShowChildPicker(false);
  };

  const handleRemoveChild = async (childId) => {
    if (!confirm('Remove this child playlist?')) return;
    try {
      await api.removeChild(group.id, childId);
      setSelectedChildren(prev => {
        const next = new Set(prev);
        next.delete(childId);
        return next;
      });
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    try {
      await api.deleteGroup(group.id);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleRename = async () => {
    if (name.trim() && name !== group.name) {
      await api.updateGroup(group.id, { name: name.trim() });
      refresh();
    }
    setEditing(false);
  };

  const handleBulkImport = async () => {
    if (!bulkUrls.trim() || !bulkAccountId) return;
    setBulkImporting(true);
    setBulkResult(null);
    try {
      const result = await api.bulkImportChildren(group.id, bulkUrls, bulkAccountId);
      setBulkResult(result.importResults);
      setBulkUrls('');
      refresh();
    } catch (err) {
      setBulkResult([{ error: err.message, status: 'error' }]);
    } finally {
      setBulkImporting(false);
    }
  };

  // Collect ALL playlist IDs used across ALL groups (masters + children)
  const allUsedIds = [];
  for (const g of allGroups) {
    if (g.master_playlist_id) allUsedIds.push(g.master_playlist_id);
    for (const c of (g.children || [])) {
      allUsedIds.push(c.playlist_id);
    }
  }

  const canSync = group.master_playlist_id && group.children?.length > 0;
  const hasDuplicates = duplicates && Object.keys(duplicates.duplicates || {}).length > 0;

  // Progress bar calculations
  const progressPercent = syncProgress?.type === 'child_done'
    ? Math.round((syncProgress.completed / syncProgress.total) * 100)
    : syncProgress?.type === 'start' ? 0 : null;

  const successCount = syncProgress?.type === 'child_done'
    ? (syncProgress.result?.status === 'success' ? 1 : 0) // We need cumulative — track in state
    : 0;

  return (
    <div className="bg-spotify-gray rounded-xl p-5 border border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {editing ? (
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              autoFocus
              className="bg-gray-700 text-white rounded px-2 py-1 text-lg font-bold outline-none focus:ring-2 focus:ring-spotify-green"
            />
          ) : (
            <h3
              className="text-lg font-bold truncate cursor-pointer hover:text-spotify-green transition-colors"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {group.name}
            </h3>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selectedChildren.size > 0 && (
            <button
              onClick={handleSyncSelected}
              disabled={syncing}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                !syncing
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              🔄 Sync {selectedChildren.size} Selected
            </button>
          )}
          <button
            onClick={handleSyncAll}
            disabled={!canSync || syncing}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              canSync && !syncing
                ? 'bg-spotify-green text-black hover:brightness-110'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            {syncing ? '⏳ Syncing...' : '🔄 Sync All'}
          </button>
          <button
            onClick={handleCachePrep}
            disabled={!canSync || cachePrepLoading}
            title="Load master tracks to cache (for Quick Scan) without syncing children"
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              canSync && !cachePrepLoading
                ? 'bg-blue-600 text-white hover:brightness-110'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            {cachePrepLoading ? '⏳ Prepping...' : '📊 Cache for Quick Scan'}
          </button>
          <button
            onClick={() => { setShowAddTrack(!showAddTrack); setAddTrackResult(null); }}
            disabled={!canSync}
            title="Add a single track to master + all children (keeps old tracks' dates)"
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
              canSync
                ? 'bg-purple-600 text-white hover:brightness-110'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
            }`}
          >
            ➕ Add 1 Track
          </button>
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 rounded-full text-sm bg-red-900/50 text-red-300 hover:bg-red-800/50 transition-colors"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* SSE Progress Bar */}
      {syncing && syncProgress && (
        <div className="mb-4 bg-gray-700/50 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {syncProgress.type === 'start' && `Starting sync... ${syncProgress.total} children, ${syncProgress.masterTrackCount} tracks`}
              {syncProgress.type === 'child_done' && (
                <>
                  Syncing child {syncProgress.completed}/{syncProgress.total}...
                  {syncProgress.result?.status === 'success' ? ' ✅' : ' ❌'} {syncProgress.result?.playlist}
                </>
              )}
            </span>
            {progressPercent !== null && (
              <span className="text-sm text-spotify-light">{progressPercent}%</span>
            )}
          </div>
          <div className="w-full bg-gray-600 rounded-full h-2.5">
            <div
              className="bg-spotify-green h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent || 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Duplicate Warning Banner */}
      {hasDuplicates && (
        <div className="mb-3 bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-yellow-400 text-sm font-medium">
              ⚠️ {Object.keys(duplicates.duplicates).length} duplicate track(s) found in master playlist
            </span>
            <button
              onClick={() => setShowDuplicates(!showDuplicates)}
              className="text-xs text-yellow-400 hover:text-yellow-300 underline"
            >
              {showDuplicates ? 'Hide' : 'View Duplicates'}
            </button>
          </div>
          {showDuplicates && (
            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
              {Object.entries(duplicates.duplicates).map(([uri, count]) => (
                <div key={uri} className="text-xs text-yellow-300 flex items-center gap-2">
                  <span className="bg-yellow-800/50 px-1.5 py-0.5 rounded">{count}x</span>
                  <span>{duplicates.trackNames?.[uri] || uri}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Master Playlist */}
      <div className="mb-3">
        <p className="text-xs text-spotify-light uppercase tracking-wide mb-1.5">Master Playlist</p>
        {group.master_playlist_id ? (
          <div className="flex items-center justify-between bg-gray-700/50 rounded-lg px-3 py-2">
            <div>
              <p className="font-medium text-spotify-green">{group.master_playlist_name}</p>
              <p className="text-xs text-spotify-light">via {group.master_account_name}</p>
            </div>
            <div className="flex gap-2 items-center">
              <button
                onClick={handleCheckDuplicates}
                disabled={checkingDuplicates}
                className="text-xs text-spotify-light hover:text-yellow-400 transition-colors"
                title="Check for duplicate tracks"
              >
                {checkingDuplicates ? '⏳' : '🔍'} Duplicates
              </button>
              <button
                onClick={() => setShowMasterPicker(true)}
                className="text-xs text-spotify-light hover:text-white"
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowMasterPicker(true)}
            className="w-full py-3 border-2 border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-spotify-green hover:text-spotify-green transition-colors text-sm"
          >
            + Set Master Playlist
          </button>
        )}
      </div>

      {/* Synced Playlists */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-spotify-light uppercase tracking-wide">
            Synced Playlists ({group.children?.length || 0})
          </p>
          {group.children?.length > 0 && (
            <button
              onClick={toggleAllChildren}
              className="text-xs text-spotify-light hover:text-white transition-colors"
            >
              {selectedChildren.size === (group.children?.length || 0) ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {(group.children || []).map(child => (
            <div key={child.id} className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2">
              {/* Selective sync checkbox */}
              <input
                type="checkbox"
                checked={selectedChildren.has(child.id)}
                onChange={() => toggleChild(child.id)}
                className="w-4 h-4 rounded border-gray-500 text-spotify-green focus:ring-spotify-green bg-gray-600 cursor-pointer flex-shrink-0"
              />
              <div className="flex items-center justify-between flex-1 min-w-0">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{child.playlist_name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-spotify-light">via {child.account_name}</p>
                    {/* Analytics: track count & last synced */}
                    {child.track_count > 0 && (
                      <span className="text-xs text-gray-400">• {child.track_count} tracks</span>
                    )}
                    {child.last_synced_at && (
                      <span className="text-xs text-gray-400" title={child.last_synced_at}>
                        • synced {formatRelativeTime(child.last_synced_at)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveChild(child.id)}
                  className="text-xs text-red-400 hover:text-red-300 flex-shrink-0 ml-2"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 mt-2">
          <button
            onClick={() => setShowChildPicker(true)}
            className="flex-1 py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-spotify-green hover:text-spotify-green transition-colors text-sm"
          >
            + Add Child
          </button>
          <button
            onClick={() => { setShowBulkImport(!showBulkImport); setBulkResult(null); }}
            className="flex-1 py-2 border border-dashed border-gray-600 rounded-lg text-spotify-light hover:border-blue-400 hover:text-blue-400 transition-colors text-sm"
          >
            📋 Bulk Import
          </button>
        </div>
      </div>

      {/* Add Single Track Panel */}
      {showAddTrack && (
        <div className="mt-3 bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-spotify-light uppercase tracking-wide mb-2">Add 1 Track</p>
          <p className="text-xs text-gray-400 mb-2">Paste Spotify track URL or URI. This track will be added to master + all {group.children?.length || 0} synced playlists.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={addTrackInput}
              onChange={e => setAddTrackInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddTrack()}
              placeholder="https://open.spotify.com/track/xxxxx or spotify:track:xxxxx"
              className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500"
              autoFocus
            />
            <button
              onClick={handleAddTrack}
              disabled={addTrackLoading || !addTrackInput.trim()}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                !addTrackLoading && addTrackInput.trim()
                  ? 'bg-purple-600 text-white hover:bg-purple-500'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {addTrackLoading ? '⏳ Adding...' : '➕ Add'}
            </button>
          </div>
          {addTrackResult && (
            <div className="mt-2 space-y-1">
              <div className="text-sm text-green-400 flex items-center gap-1">
                <span>✅ {addTrackResult.message}</span>
              </div>
              {addTrackResult.childrenCount > 0 && (
                <div className="text-xs text-spotify-light">
                  Added to {addTrackResult.successCount}/{addTrackResult.childrenCount} synced playlists
                </div>
              )}
              {addTrackResult.childrenUpdated?.length > 0 && (
                <div className="mt-1 max-h-24 overflow-y-auto">
                  {addTrackResult.childrenUpdated.map((r, i) => (
                    <div key={i} className={`text-xs ${r.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                      {r.status === 'error' ? '❌' : '✅'} {r.playlistName || r.playlistId}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk Import Panel */}
      {showBulkImport && (
        <div className="mt-3 bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-spotify-light uppercase tracking-wide mb-2">Bulk Import Playlists</p>
          <textarea
            value={bulkUrls}
            onChange={e => setBulkUrls(e.target.value)}
            placeholder="Paste Spotify playlist URLs, one per line&#10;https://open.spotify.com/playlist/xxxxx&#10;https://open.spotify.com/playlist/yyyyy"
            className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm h-24 resize-none outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
          />
          <div className="flex items-center gap-2 mt-2">
            <select
              value={bulkAccountId}
              onChange={e => setBulkAccountId(e.target.value)}
              className="flex-1 bg-gray-800 text-white rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select account...</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.display_name}</option>
              ))}
            </select>
            <button
              onClick={handleBulkImport}
              disabled={bulkImporting || !bulkUrls.trim() || !bulkAccountId}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                !bulkImporting && bulkUrls.trim() && bulkAccountId
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {bulkImporting ? '⏳ Importing...' : '📥 Import'}
            </button>
          </div>
          {bulkResult && (
            <div className="mt-2 space-y-1">
              {bulkResult.map((r, i) => (
                <div key={i} className={`text-xs flex items-center gap-1 ${r.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                  <span>{r.status === 'error' ? '❌' : '✅'}</span>
                  <span>{r.playlistName || r.url || 'Unknown'}</span>
                  {r.error && <span className="text-gray-400">— {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sync Results */}
      {syncResult && !syncing && (
        <div className="mt-4 bg-gray-700/50 rounded-lg p-3">
          <p className="text-xs text-spotify-light uppercase tracking-wide mb-2">Last Sync Results</p>
          {syncResult.error ? (
            <p className="text-red-400 text-sm">{syncResult.error}</p>
          ) : (
            <div className="space-y-1">
              {syncResult.results?.map((r, i) => (
                <div key={i} className={`text-sm flex items-center gap-2 ${r.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>
                  <span>{r.status === 'error' ? '❌' : '✅'}</span>
                  <span className="font-medium">{r.playlist}</span>
                  {r.status === 'success' && (
                    <span className="text-spotify-light text-xs">+{r.added} / -{r.removed}</span>
                  )}
                  {r.error && <span className="text-xs">{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pickers */}
      {showMasterPicker && (
        <PlaylistPicker
          accounts={accounts}
          excludeIds={allUsedIds}
          onSelect={handleSetMaster}
          onCancel={() => setShowMasterPicker(false)}
        />
      )}
      {showChildPicker && (
        <PlaylistPicker
          accounts={accounts}
          excludeIds={allUsedIds}
          multiSelect={true}
          onSelect={handleAddChild}
          onCancel={handleCloseChildPicker}
        />
      )}
    </div>
  );
}

// Helper to format relative time
function formatRelativeTime(dateStr) {
  try {
    const date = new Date(dateStr + 'Z'); // SQLite datetime is UTC
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
