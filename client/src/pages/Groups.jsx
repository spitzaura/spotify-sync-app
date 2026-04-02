import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import GroupCard from '../components/GroupCard';

export default function Groups() {
  const { groups, accounts, loading, refresh } = useApp();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createGroup(newName.trim());
      setNewName('');
      setCreating(false);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-spotify-light">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Sync Groups</h1>
          <p className="text-spotify-light mt-1">Manage master playlists and their synced children</p>
        </div>
        {!creating && (
          <button
            onClick={() => setCreating(true)}
            className="px-5 py-2.5 bg-spotify-green text-black rounded-full font-semibold hover:brightness-110 transition text-sm"
          >
            + New Group
          </button>
        )}
      </div>

      {/* New group form */}
      {creating && (
        <form onSubmit={handleCreate} className="bg-spotify-gray rounded-xl p-5 border border-gray-700 mb-6">
          <label className="block text-sm text-spotify-light mb-2">Group Name</label>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Summer 2026"
              autoFocus
              className="flex-1 bg-gray-700 text-white rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-spotify-green"
            />
            <button
              type="submit"
              className="px-5 py-2 bg-spotify-green text-black rounded-lg font-semibold hover:brightness-110 transition"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName(''); }}
              className="px-5 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* No accounts warning */}
      {accounts.length === 0 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 mb-6 text-yellow-200 text-sm">
          ⚠️ Connect at least one Spotify account before creating sync groups.
        </div>
      )}

      {/* Group cards */}
      {groups.length === 0 ? (
        <div className="bg-spotify-gray rounded-xl p-12 border border-gray-700 text-center">
          <p className="text-5xl mb-4">🔗</p>
          <h2 className="text-xl font-bold mb-2">No Sync Groups Yet</h2>
          <p className="text-spotify-light mb-4">
            Create a group, set a master playlist, add Synced Playlists, and hit sync.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="inline-block px-6 py-3 bg-spotify-green text-black rounded-full font-semibold hover:brightness-110 transition"
          >
            Create Your First Group
          </button>
        </div>
      ) : (
        <div className="grid gap-5">
          {groups.map(group => (
            <GroupCard key={group.id} group={group} allGroups={groups} />
          ))}
        </div>
      )}
    </div>
  );
}
