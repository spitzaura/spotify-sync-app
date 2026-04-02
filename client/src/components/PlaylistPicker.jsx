import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function PlaylistPicker({ accounts, onSelect, onCancel, excludeIds = [], multiSelect = false }) {
  const [selectedAccount, setSelectedAccount] = useState('');
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState(new Set());

  useEffect(() => {
    if (!selectedAccount) {
      setPlaylists([]);
      return;
    }
    setLoading(true);
    api.getPlaylists(selectedAccount)
      .then(data => setPlaylists(data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [selectedAccount]);

  const toggleCheck = (pl) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(pl.id)) next.delete(pl.id);
      else next.add(pl.id);
      return next;
    });
  };

  const handleAddSelected = () => {
    const selected = filtered.filter(p => checked.has(p.id));
    for (const pl of selected) {
      onSelect({
        playlistId: pl.id,
        playlistName: pl.name,
        accountId: selectedAccount,
      });
    }
  };

  const filtered = playlists.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) &&
    !excludeIds.includes(p.id)
  );

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-spotify-gray rounded-xl p-6 w-full max-w-lg max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-bold mb-4">Pick a Playlist</h3>

        {/* Account selector */}
        <select
          value={selectedAccount}
          onChange={e => setSelectedAccount(e.target.value)}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 mb-3 outline-none focus:ring-2 focus:ring-spotify-green"
        >
          <option value="">Select an account...</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.display_name} ({a.email || a.spotify_user_id})</option>
          ))}
        </select>

        {/* Search */}
        {selectedAccount && (
          <input
            type="text"
            placeholder="Search playlists..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 mb-3 outline-none focus:ring-2 focus:ring-spotify-green"
          />
        )}

        {/* Playlist list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && <p className="text-spotify-light text-center py-4">Loading playlists...</p>}
          {!loading && selectedAccount && filtered.length === 0 && (
            <p className="text-spotify-light text-center py-4">No playlists found</p>
          )}
          {filtered.map(pl => (
            <button
              key={pl.id}
              onClick={() => multiSelect ? toggleCheck(pl) : onSelect({
                playlistId: pl.id,
                playlistName: pl.name,
                accountId: selectedAccount,
              })}
              className={`w-full text-left px-4 py-3 rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-3 ${
                checked.has(pl.id) ? 'bg-gray-600 ring-1 ring-spotify-green' : ''
              }`}
            >
              {multiSelect && (
                <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                  checked.has(pl.id) ? 'bg-spotify-green border-spotify-green text-black' : 'border-gray-500'
                }`}>
                  {checked.has(pl.id) && <span className="text-xs font-bold">✓</span>}
                </div>
              )}
              {pl.image ? (
                <img src={pl.image} alt="" className="w-10 h-10 rounded" />
              ) : (
                <div className="w-10 h-10 rounded bg-gray-600 flex items-center justify-center text-lg">🎶</div>
              )}
              <div className="min-w-0">
                <p className="font-medium truncate">{pl.name}</p>
                <p className="text-xs text-spotify-light">{pl.trackCount} tracks · {pl.owner}</p>
              </div>
            </button>
          ))}
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex gap-3">
          {multiSelect && checked.size > 0 && (
            <button
              onClick={handleAddSelected}
              className="flex-1 py-2 rounded-lg bg-spotify-green text-black font-semibold hover:brightness-110 transition-colors text-sm"
            >
              ✅ Add {checked.size} Playlist{checked.size > 1 ? 's' : ''}
            </button>
          )}
          <button
            onClick={onCancel}
            className={`${multiSelect && checked.size > 0 ? '' : 'w-full'} flex-1 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 transition-colors text-sm`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
