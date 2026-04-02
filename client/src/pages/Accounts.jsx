import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { api } from '../api';

export default function Accounts() {
  const { accounts, loading, refresh } = useApp();
  const [tokenStatus, setTokenStatus] = useState({});

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/accounts/debug/token-status');
        const data = await res.json();
        const statusMap = {};
        data.accounts.forEach(acc => {
          statusMap[acc.email] = acc.needsRefresh;
        });
        setTokenStatus(statusMap);
      } catch (err) {
        console.error(err);
      }
    };
    fetchStatus();
  }, []);

  const handleDisconnect = async (id, name) => {
    if (!confirm(`Disconnect ${name}? Any groups using this account's playlists will be affected.`)) return;
    try {
      await api.deleteAccount(id);
      refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReauth = (email) => {
    const authUrl = `/auth/spotify?app=${encodeURIComponent(email)}`;
    window.open(authUrl, `reauth_${email}`, 'width=600,height=700');
  };

  if (loading) {
    return <div className="text-center py-12 text-spotify-light">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Connected Accounts</h1>
          <p className="text-spotify-light mt-1">Manage your linked Spotify accounts</p>
        </div>
        <a
          href="/auth/spotify"
          className="px-5 py-2.5 bg-spotify-green text-black rounded-full font-semibold hover:brightness-110 transition text-sm"
        >
          + Connect Account
        </a>
      </div>

      {/* Re-authorize banner */}
      {accounts.length > 0 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 mb-6 flex items-center justify-between">
          <p className="text-yellow-200 text-sm">🔑 Getting 403 errors? Re-connect each account to refresh permissions.</p>
          <a
            href="/auth/spotify"
            className="px-4 py-1.5 rounded-full text-sm bg-yellow-600 text-black font-semibold hover:brightness-110 transition-colors flex-shrink-0"
          >
            Re-authorize
          </a>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="bg-spotify-gray rounded-xl p-12 border border-gray-700 text-center">
          <p className="text-5xl mb-4">👤</p>
          <h2 className="text-xl font-bold mb-2">No Accounts Connected</h2>
          <p className="text-spotify-light mb-4">
            Connect at least one Spotify account to start syncing playlists.
          </p>
          <a
            href="/auth/spotify"
            className="inline-block px-6 py-3 bg-spotify-green text-black rounded-full font-semibold hover:brightness-110 transition"
          >
            Connect Spotify Account
          </a>
        </div>
      ) : (
        <div className="grid gap-4">
          {accounts.map(account => (
            <div
              key={account.id}
              className="bg-spotify-gray rounded-xl p-5 border border-gray-700 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-spotify-green/20 flex items-center justify-center text-2xl">
                  👤
                </div>
                <div>
                  <p className="font-bold text-lg">{account.display_name}</p>
                  <p className="text-sm text-spotify-light">{account.spotify_user_id}</p>
                  {account.email && (
                    <p className="text-xs text-spotify-light">{account.email}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className="text-xs text-spotify-light">
                  Connected {new Date(account.created_at).toLocaleDateString()}
                </p>
                {tokenStatus[account.email] && (
                  <button
                    onClick={() => handleReauth(account.email)}
                    className="px-4 py-1.5 rounded-full text-sm bg-blue-600/80 text-white hover:bg-blue-500 transition-colors"
                    title="Re-authenticate to refresh tokens"
                  >
                    🔄 Reauth
                  </button>
                )}
                <button
                  onClick={() => handleDisconnect(account.id, account.display_name)}
                  className="px-4 py-1.5 rounded-full text-sm bg-red-900/50 text-red-300 hover:bg-red-800/50 transition-colors"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tips */}
      <div className="mt-8 bg-gray-800/50 rounded-xl p-5 border border-gray-700">
        <h3 className="font-semibold mb-2 text-spotify-light">💡 Tips</h3>
        <ul className="text-sm text-spotify-light space-y-1">
          <li>• Connect multiple accounts to sync playlists across them</li>
          <li>• Each account needs to authorize separately via Spotify OAuth</li>
          <li>• Tokens are auto-refreshed — no need to reconnect</li>
          <li>• Make sure <code className="text-gray-300">show_dialog</code> is enabled to switch accounts during login</li>
        </ul>
      </div>
    </div>
  );
}
