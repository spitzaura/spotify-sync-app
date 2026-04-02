import React from 'react';
import { useApp } from '../context/AppContext';

export default function Dashboard() {
  const { accounts, groups, loading } = useApp();

  if (loading) {
    return <div className="text-center py-12 text-spotify-light">Loading...</div>;
  }

  const totalChildren = groups.reduce((sum, g) => sum + (g.children?.length || 0), 0);
  const configuredGroups = groups.filter(g => g.master_playlist_id && g.children?.length > 0);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
      <p className="text-spotify-light mb-8">Overview of your Spotify sync setup</p>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700">
          <p className="text-spotify-light text-sm">Connected Accounts</p>
          <p className="text-4xl font-bold text-spotify-green mt-1">{accounts.length}</p>
        </div>
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700">
          <p className="text-spotify-light text-sm">Sync Groups</p>
          <p className="text-4xl font-bold text-spotify-green mt-1">{groups.length}</p>
        </div>
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700">
          <p className="text-spotify-light text-sm">Linked Playlists</p>
          <p className="text-4xl font-bold text-spotify-green mt-1">{totalChildren}</p>
        </div>
      </div>

      {/* Quick status */}
      {accounts.length === 0 ? (
        <div className="bg-spotify-gray rounded-xl p-8 border border-gray-700 text-center">
          <p className="text-5xl mb-4">🎵</p>
          <h2 className="text-xl font-bold mb-2">Get Started</h2>
          <p className="text-spotify-light mb-4">Connect your first Spotify account to begin syncing playlists.</p>
          <a
            href="/auth/spotify"
            className="inline-block px-6 py-3 bg-spotify-green text-black rounded-full font-semibold hover:brightness-110 transition"
          >
            Connect Spotify Account
          </a>
        </div>
      ) : configuredGroups.length > 0 ? (
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700">
          <h2 className="text-lg font-bold mb-3">Ready to Sync</h2>
          <div className="space-y-2">
            {configuredGroups.map(g => (
              <div key={g.id} className="flex items-center justify-between bg-gray-700/50 rounded-lg px-4 py-3">
                <div>
                  <p className="font-medium">{g.name}</p>
                  <p className="text-xs text-spotify-light">
                    {g.master_playlist_name} → {g.children.length} playlist{g.children.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-spotify-green text-sm">✓ Configured</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-spotify-gray rounded-xl p-6 border border-gray-700 text-center">
          <p className="text-spotify-light">
            {groups.length === 0
              ? 'Create a sync group to get started linking playlists.'
              : 'Configure your sync groups with master and Synced Playlists.'}
          </p>
        </div>
      )}
    </div>
  );
}
