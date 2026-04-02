import React, { useState, useEffect } from 'react';

export default function GroupMetrics() {
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupName, setSelectedGroupName] = useState('');
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState('group_completion');
  const [sortDirection, setSortDirection] = useState('desc');

  // Load groups on mount
  useEffect(() => {
    fetchGroups();
  }, []);

  // Auto-fetch metrics when group is selected
  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupMetrics(selectedGroupId);
    }
  }, [selectedGroupId]);

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/master-groups');
      const data = await res.json();
      console.log('Groups loaded:', data);
      setGroups(data || []);
      if (data && data.length > 0) {
        console.log('Auto-selecting first group:', data[0].id, data[0].name);
        setSelectedGroupId(data[0].id);
        setSelectedGroupName(data[0].name);
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    }
  };

  const fetchGroupMetrics = async (groupId) => {
    if (!groupId) return;
    setLoading(true);
    try {
      console.log('Fetching metrics for group:', groupId);
      const res = await fetch(`/api/group-metrics/${groupId}`);
      const data = await res.json();
      console.log('Metrics data:', data);
      setMetrics(data || []);
    } catch (err) {
      console.error('Error fetching group metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleGroupChange = (e) => {
    const gid = e.target.value;
    const group = groups.find(g => g.id === gid);
    setSelectedGroupId(gid);
    setSelectedGroupName(group?.name || '');
    fetchGroupMetrics(gid);
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortDirection('desc');
    }
  };

  // Define numeric columns for proper sorting
  const numericColumns = ['streams', 'listeners', 'saves', 'save_ratio', 'radio_percent', 'playlists_added', 'days_since_release', 'group_completion'];

  const filtered = metrics
    .filter(m => {
      const matchesSearch = 
        m.track_name?.toLowerCase().includes(filterText.toLowerCase()) ||
        m.artist_name?.toLowerCase().includes(filterText.toLowerCase());
      return matchesSearch;
    })
    .sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      
      let comparison = 0;
      
      // Handle numeric columns
      if (numericColumns.includes(sortBy)) {
        const aNum = parseFloat(aVal) || 0;
        const bNum = parseFloat(bVal) || 0;
        comparison = aNum - bNum;
      } else {
        // String comparison for text columns
        comparison = String(aVal || '').localeCompare(String(bVal || ''));
      }
      
      return sortDirection === 'desc' ? -comparison : comparison;
    });

  return (
    <div className="w-full min-h-screen bg-gray-900 p-4">
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-4">🎵 Group Metrics by Master Playlist</h1>
        
        {/* GROUP SELECTOR */}
        <div className="flex gap-4 items-center mb-4">
          <label className="text-gray-300 font-semibold">Select Master Group:</label>
          <select
            value={selectedGroupId}
            onChange={handleGroupChange}
            className="bg-gray-800 text-white rounded px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
          >
            <option value="">-- Choose a group --</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>

        {/* SEARCH */}
        <input
          type="text"
          placeholder="Search song or artist..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="w-full bg-gray-800 text-white rounded px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* CONTENT */}
      {selectedGroupId && !loading ? (
        <div>
          <div className="mb-4 text-gray-300">
            <strong>{selectedGroupName}</strong> • {filtered.length} songs with B2B data
          </div>

          {filtered.length > 0 ? (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-gray-700">
                <thead className="sticky top-0 bg-gray-800">
                  <tr>
                    <th onClick={() => handleSort('track_name')} className="border border-gray-700 px-3 py-2 text-left font-bold cursor-pointer hover:bg-gray-700/50">
                      Song {sortBy === 'track_name' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('artist_name')} className="border border-gray-700 px-3 py-2 text-left font-bold cursor-pointer hover:bg-gray-700/50">
                      Artist {sortBy === 'artist_name' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('days_since_release')} className="border border-gray-700 px-3 py-2 text-center font-bold cursor-pointer hover:bg-gray-700/50">
                      Days {sortBy === 'days_since_release' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('streams')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Streams {sortBy === 'streams' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('listeners')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Listeners {sortBy === 'listeners' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('saves')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Saves {sortBy === 'saves' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('save_ratio')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Save% {sortBy === 'save_ratio' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('radio_percent')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      %Radio {sortBy === 'radio_percent' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('playlists_added')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Playlists {sortBy === 'playlists_added' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                    <th onClick={() => handleSort('group_completion')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">
                      Completion% {sortBy === 'group_completion' && (sortDirection === 'desc' ? '▼' : '▲')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m, idx) => (
                    <tr key={idx} className="hover:bg-gray-800/50 border-b border-gray-700">
                      <td className="border border-gray-700 px-3 py-2 font-medium">{m.track_name}</td>
                      <td className="border border-gray-700 px-3 py-2 text-gray-400">{m.artist_name}</td>
                      <td className="border border-gray-700 px-3 py-2 text-center text-gray-400">{m.days_since_release || '-'}</td>
                      <td className="border border-gray-700 px-3 py-2 text-right text-green-400 font-semibold">{(m.streams || 0).toLocaleString()}</td>
                      <td className="border border-gray-700 px-3 py-2 text-right text-blue-400">{(m.listeners || 0).toLocaleString()}</td>
                      <td className="border border-gray-700 px-3 py-2 text-right text-yellow-400">{(m.saves || 0).toLocaleString()}</td>
                      <td className="border border-gray-700 px-3 py-2 text-right text-purple-400">{(m.save_ratio || 0).toFixed(2)}%</td>
                      <td className="border border-gray-700 px-3 py-2 text-right">{(m.radio_percent || 0).toFixed(1)}%</td>
                      <td className="border border-gray-700 px-3 py-2 text-right">{m.playlists_added || 0}</td>
                      <td className={`border border-gray-700 px-3 py-2 text-right font-bold ${
                        m.group_completion === null ? 'text-gray-500' :
                        m.group_completion < 50 ? 'text-red-400' :
                        m.group_completion < 70 ? 'text-orange-400' :
                        'text-green-400'
                      }`}>
                        {m.group_completion === null ? '-' : m.group_completion.toFixed(1) + '%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">No songs found for this group</div>
          )}

          {/* SUMMARY */}
          {filtered.length > 0 && (
            <div className="mt-6 grid grid-cols-5 gap-4">
              <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Avg Completion%</div>
                <div className="text-2xl font-bold text-green-400">
                  {filtered
                    .filter(m => m.group_completion !== null)
                    .reduce((sum, m) => sum + m.group_completion, 0) / 
                    filtered.filter(m => m.group_completion !== null).length || 0
                  }%
                </div>
              </div>
              <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Total Streams</div>
                <div className="text-2xl font-bold text-green-400">{filtered.reduce((sum, m) => sum + (m.streams || 0), 0).toLocaleString()}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Total Listeners</div>
                <div className="text-2xl font-bold text-blue-400">{filtered.reduce((sum, m) => sum + (m.listeners || 0), 0).toLocaleString()}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Total Saves</div>
                <div className="text-2xl font-bold text-yellow-400">{filtered.reduce((sum, m) => sum + (m.saves || 0), 0).toLocaleString()}</div>
              </div>
              <div className="bg-gray-800 p-4 rounded border border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Total Songs</div>
                <div className="text-2xl font-bold">{filtered.length}</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-400">{loading ? 'Loading...' : 'Select a group'}</div>
      )}
    </div>
  );
}
