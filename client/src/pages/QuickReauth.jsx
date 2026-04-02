import React, { useState, useEffect } from 'react';

export default function QuickReauth() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch_data = async () => {
      try {
        const res = await fetch('/api/accounts/reauth-urls');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch_data();
  }, []);

  if (loading) return <div className="text-center py-12">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto py-12">
      <h1 className="text-3xl font-bold mb-2">🔄 Quick Re-Auth</h1>
      <p className="text-spotify-light mb-8">Click to open OAuth consent screens for all accounts needing refresh</p>

      {data?.count === 0 ? (
        <div className="bg-spotify-gray rounded-xl p-8 border border-green-700/30 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-lg font-semibold">All accounts are fresh!</p>
          <p className="text-spotify-light text-sm mt-2">No re-auth needed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 mb-6">
            <p className="text-yellow-300 font-semibold">⏳ {data?.count} account{data?.count !== 1 ? 's' : ''} need{data?.count !== 1 ? '' : 's'} re-auth</p>
            <p className="text-yellow-200 text-sm mt-1">Click each link below. They will auto-login with your saved credentials. Accept the prompt and return.</p>
          </div>

          {data?.needingReauth?.map((acc, idx) => (
            <a
              key={idx}
              href={acc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-spotify-gray rounded-lg p-5 border border-spotify-green/50 hover:border-spotify-green hover:bg-spotify-gray/80 transition cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold text-lg">{acc.name}</div>
                  <div className="text-xs text-spotify-light mt-1">{acc.email}</div>
                </div>
                <div className="text-2xl">→</div>
              </div>
            </a>
          ))}

          <div className="bg-gray-800/50 rounded-lg p-4 mt-6 border border-gray-700">
            <p className="text-xs text-spotify-light">💡 Pro tip: Right-click and "Open Link in New Tab" to open all at once</p>
          </div>
        </div>
      )}
    </div>
  );
}
