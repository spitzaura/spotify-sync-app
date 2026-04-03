import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function SongMetrics() {
  const { accounts } = useApp();
  const [metrics, setMetrics] = useState([]);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [sortBy, setSortBy] = useState('streams');
  const [sortDirection, setSortDirection] = useState('desc');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'removal', or 'group'
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedGroupName, setSelectedGroupName] = useState('');
  const [groupMetrics, setGroupMetrics] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);

  useEffect(() => {
    fetchMetrics();
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/master-groups');
      const data = await res.json();
      setGroups(data || []);
      if (data && data.length > 0) {
        setSelectedGroupId(data[0].id);
        setSelectedGroupName(data[0].name);
      }
    } catch (err) {
      console.error('Error fetching groups:', err);
    }
  };

  const fetchGroupMetrics = async (groupId) => {
    if (!groupId) return;
    setGroupLoading(true);
    try {
      const res = await fetch(`/api/group-metrics/${groupId}`);
      const data = await res.json();
      setGroupMetrics(data || []);
    } catch (err) {
      console.error('Error fetching group metrics:', err);
    } finally {
      setGroupLoading(false);
    }
  };

  const handleGroupChange = (e) => {
    const gid = e.target.value;
    const group = groups.find(g => g.id === gid);
    setSelectedGroupId(gid);
    setSelectedGroupName(group?.name || '');
    fetchGroupMetrics(gid);
  };

  useEffect(() => {
    if (activeTab === 'group' && selectedGroupId) {
      fetchGroupMetrics(selectedGroupId);
    }
  }, [activeTab, selectedGroupId]);

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    try {
      const res = await fetch('/api/song-metrics');
      const data = await res.json();
      setMetrics(data || []);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle direction if same column clicked
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      // Change column, default to descending
      setSortBy(column);
      setSortDirection('desc');
    }
  };

  // Define numeric columns for proper sorting
  const numericColumns = ['streams', 'listeners', 'saves', 'save_ratio', 'radio_percent', 'playlists_added', 'days_since_release', 'group_completion'];

  // Use groupMetrics if in group tab, otherwise use metrics
  const dataSource = activeTab === 'group' ? groupMetrics : metrics;

  const filtered = dataSource
    .filter(m => {
      const matchesSearch = m.track_name?.toLowerCase().includes(filterText.toLowerCase()) ||
                           m.artist_name?.toLowerCase().includes(filterText.toLowerCase());
      
      // Filter by tab
      if (activeTab === 'removal') {
        return matchesSearch && m.removal_flag && m.removal_flag !== 'keep';
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      // For group tab, use group_completion instead of skip_ratio
      const sortColumn = activeTab === 'group' ? 'group_completion' : sortBy;
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      
      let comparison = 0;
      
      // Handle numeric columns
      if (numericColumns.includes(sortColumn)) {
        const aNum = parseFloat(aVal) || 0;
        const bNum = parseFloat(bVal) || 0;
        comparison = aNum - bNum;
      } else {
        // String comparison for text columns
        comparison = String(aVal || '').localeCompare(String(bVal || ''));
      }
      
      return sortDirection === 'desc' ? -comparison : comparison;
    });

  const flaggedCount = metrics.filter(m => m.removal_flag && m.removal_flag !== 'keep').length;

  const handleDelete = async (uri) => {
    if (!confirm('Delete?')) return;
    try {
      const trackId = uri.split(':')[2];
      await fetch(`/api/song-metrics/${trackId}`, { method: 'DELETE' });
      await fetchMetrics();
    } catch (err) {
      alert(`Error: ${err.message}`);
    }
  };

  const exportToExcel = (data) => {
    // Create CSV content
    const headers = ['Song', 'Artist', 'Released', 'Days', 'Streams', 'Listeners', 'Saves', 'Save%', 'Radio', '%Radio', 'Playlists'];
    const rows = data.map(m => [
      m.track_name || '',
      m.artist_name || '',
      m.released_date || '',
      m.days_since_release || '-',
      m.streams || 0,
      m.listeners || 0,
      m.saves || 0,
      (m.save_ratio || 0).toFixed(2),
      m.radio_streams || 0,
      (m.radio_percent || 0).toFixed(1),
      m.playlists_added || 0
    ]);

    // Convert to CSV
    const csvContent = [
      headers.join('\t'),
      ...rows.map(row => row.join('\t'))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/plain;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `metrics_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="w-full min-h-screen bg-gray-900 p-4">
      {/* HEADER */}
      <div className="mb-4">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-3xl font-bold">📊 Song Metrics</h1>
          <button
            onClick={() => exportToExcel(filtered)}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 font-semibold text-sm"
          >
            📥 Export to Excel
          </button>
        </div>
        <input
          type="text"
          placeholder="Search song or artist..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="w-full bg-gray-800 text-white rounded px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* TABS */}
      <div className="flex gap-4 mb-4 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-2 px-4 font-semibold transition ${
            activeTab === 'all'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          📊 All Songs ({metrics.length})
        </button>
        <button
          onClick={() => setActiveTab('removal')}
          className={`pb-2 px-4 font-semibold transition ${
            activeTab === 'removal'
              ? 'text-red-400 border-b-2 border-red-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🗑️ Flagged for Removal ({flaggedCount})
        </button>
        <button
          onClick={() => setActiveTab('group')}
          className={`pb-2 px-4 font-semibold transition ${
            activeTab === 'group'
              ? 'text-green-400 border-b-2 border-green-400'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          🎵 By Master Group
        </button>
      </div>

      {/* GROUP SELECTOR (for group tab) */}
      {activeTab === 'group' && (
        <div className="mb-4 flex gap-4 items-center">
          <label className="text-gray-300 font-semibold">Select Master Group:</label>
          <select
            value={selectedGroupId}
            onChange={handleGroupChange}
            className="bg-gray-800 text-white rounded px-4 py-2 outline-none focus:ring-2 focus:ring-green-500 font-semibold"
          >
            <option value="">-- Choose a group --</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* REMOVAL TAB - CARD VIEW */}
      {activeTab === 'removal' && (
        <div className="space-y-4">
          {metricsLoading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-400">No songs flagged for removal</div>
          ) : (
            <>
              <div className="grid gap-4">
                {filtered.map((m, idx) => {
                  const skipRatio = m.skip_ratio || 0;
                  const saveRatio = m.save_ratio || 0;
                  const radioPercent = m.radio_percent || 0;
                  const qualityScore = (100 - skipRatio) * (saveRatio / 50) * (radioPercent / 50);
                  const scoreColor = qualityScore < 30 ? 'text-red-400' : qualityScore < 60 ? 'text-yellow-400' : 'text-green-400';
                  
                  return (
                    <div key={idx} className="bg-gray-900/50 border-2 border-red-700/30 rounded-lg p-5 hover:border-red-600/50 transition">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <h3 className="text-lg font-bold text-white">{m.track_name}</h3>
                          <p className="text-sm text-gray-400">{m.artist_name}</p>
                          <p className="text-xs text-gray-500 mt-1">Added {m.days_since_release} days ago</p>
                        </div>
                        <div className={`text-3xl font-bold ${scoreColor}`}>{qualityScore.toFixed(0)}</div>
                      </div>
                      
                      <div className="grid grid-cols-4 gap-3 mb-4">
                        <div className="bg-gray-800/50 rounded p-3">
                          <div className="text-xs text-gray-400">Skip %</div>
                          <div className={`text-xl font-bold ${skipRatio > 60 ? 'text-red-400' : 'text-orange-400'}`}>{skipRatio.toFixed(0)}%</div>
                        </div>
                        <div className="bg-gray-800/50 rounded p-3">
                          <div className="text-xs text-gray-400">Save %</div>
                          <div className={`text-xl font-bold ${saveRatio < 20 ? 'text-red-400' : 'text-yellow-400'}`}>{saveRatio.toFixed(1)}%</div>
                        </div>
                        <div className="bg-gray-800/50 rounded p-3">
                          <div className="text-xs text-gray-400">Radio %</div>
                          <div className={`text-xl font-bold ${radioPercent < 10 ? 'text-red-400' : 'text-blue-400'}`}>{radioPercent.toFixed(1)}%</div>
                        </div>
                        <div className="bg-gray-800/50 rounded p-3">
                          <div className="text-xs text-gray-400">Streams</div>
                          <div className="text-xl font-bold text-green-400">{(m.streams || 0).toLocaleString()}</div>
                        </div>
                      </div>
                      
                      <div className="text-xs text-gray-500 text-center">Listeners: {(m.listeners || 0).toLocaleString()} | Saves: {(m.saves || 0).toLocaleString()}</div>
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-8 flex gap-4 justify-center">
                <button className="px-6 py-3 bg-green-600/40 text-green-300 border border-green-600 rounded-lg font-bold hover:bg-green-600/60 transition">✓ Keep Selected</button>
                <button className="px-6 py-3 bg-red-600/40 text-red-300 border border-red-600 rounded-lg font-bold hover:bg-red-600/60 transition">✕ Confirm Removals</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* TABLE FOR 'ALL' TAB */}
      {activeTab === 'all' && metricsLoading ? (
        <div className="text-center py-8 text-gray-400">Loading...</div>
      ) : activeTab === 'group' && groupLoading ? (
        <div className="text-center py-8 text-gray-400">Loading group data...</div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-gray-700">
            <thead className="sticky top-0 bg-gray-800">
              <tr>
                <th onClick={() => handleSort('track_name')} className="border border-gray-700 px-3 py-2 text-left font-bold cursor-pointer hover:bg-gray-700/50">Song {sortBy === 'track_name' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('artist_name')} className="border border-gray-700 px-3 py-2 text-left font-bold cursor-pointer hover:bg-gray-700/50">Artist {sortBy === 'artist_name' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('released_date')} className="border border-gray-700 px-3 py-2 text-left font-bold cursor-pointer hover:bg-gray-700/50">Released {sortBy === 'released_date' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('days_since_release')} className="border border-gray-700 px-3 py-2 text-center font-bold cursor-pointer hover:bg-gray-700/50">Days {sortBy === 'days_since_release' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('streams')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Streams {sortBy === 'streams' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('listeners')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Listeners {sortBy === 'listeners' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('saves')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Saves {sortBy === 'saves' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('save_ratio')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Save% {sortBy === 'save_ratio' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('radio_streams')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Radio {sortBy === 'radio_streams' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('radio_percent')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">%Radio {sortBy === 'radio_percent' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                <th onClick={() => handleSort('playlists_added')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Playlists {sortBy === 'playlists_added' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                {activeTab === 'group' ? (
                  <th onClick={() => handleSort('group_completion')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Completion% {sortBy === 'group_completion' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                ) : (
                  <th onClick={() => handleSort('skip_ratio')} className="border border-gray-700 px-3 py-2 text-right font-bold cursor-pointer hover:bg-gray-700/50">Completion% {sortBy === 'skip_ratio' && (sortDirection === 'desc' ? '▼' : '▲')}</th>
                )}
                {activeTab !== 'group' && <th className="border border-gray-700 px-3 py-2 text-center font-bold">Status</th>}
                <th className="border border-gray-700 px-3 py-2 text-center font-bold">Del</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, idx) => (
                <tr key={idx} className="hover:bg-gray-800/50 border-b border-gray-700">
                  <td className="border border-gray-700 px-3 py-2">{m.track_name}</td>
                  <td className="border border-gray-700 px-3 py-2">{m.artist_name}</td>
                  <td className="border border-gray-700 px-3 py-2">{m.released_date}</td>
                  <td className="border border-gray-700 px-3 py-2 text-center">{m.days_since_release || '-'}</td>
                  <td className="border border-gray-700 px-3 py-2 text-right text-green-400 font-semibold">{(m.streams || 0).toLocaleString()}</td>
                  <td className="border border-gray-700 px-3 py-2 text-right text-blue-400">{(m.listeners || 0).toLocaleString()}</td>
                  <td className="border border-gray-700 px-3 py-2 text-right text-yellow-400">{(m.saves || 0).toLocaleString()}</td>
                  <td className="border border-gray-700 px-3 py-2 text-right text-purple-400">{(m.save_ratio || 0).toFixed(2)}%</td>
                  <td className="border border-gray-700 px-3 py-2 text-right">{(m.radio_streams || 0).toLocaleString()}</td>
                  <td className="border border-gray-700 px-3 py-2 text-right">{(m.radio_percent || 0).toFixed(1)}%</td>
                  <td className="border border-gray-700 px-3 py-2 text-right">{m.playlists_added || 0}</td>
                  <td className={`border border-gray-700 px-3 py-2 text-right font-semibold ${
                    activeTab === 'group' ? (
                      m.group_completion === null ? 'text-gray-500' :
                      m.group_completion < 50 ? 'text-red-400' :
                      m.group_completion < 70 ? 'text-orange-400' :
                      'text-green-400'
                    ) : (
                      m.skip_ratio === null || m.skip_ratio === undefined ? 'text-gray-500' :
                      m.skip_ratio < 50 ? 'text-red-400' :
                      m.skip_ratio < 70 ? 'text-orange-400' :
                      'text-green-400'
                    )
                  }`}>
                    {activeTab === 'group' ? 
                      (m.group_completion === null ? '-' : m.group_completion.toFixed(1) + '%') :
                      (m.skip_ratio === null || m.skip_ratio === undefined ? '-' : m.skip_ratio.toFixed(1) + '%')
                    }
                  </td>
                  {activeTab !== 'group' && (
                    <>
                      <td className={`border border-gray-700 px-3 py-2 text-center font-semibold ${
                        m.removal_flag === 'REMOVE_IMMEDIATELY' ? 'bg-red-900/50 text-red-300' :
                        m.removal_flag === 'REMOVE_OLD' ? 'bg-orange-900/50 text-orange-300' :
                        m.skip_ratio === null ? 'text-gray-500' :
                        'text-green-400'
                      }`}>{m.skip_ratio === null ? '-' : (m.removal_flag === 'keep' ? '✓ Keep' : m.removal_flag)}</td>
                      <td className="border border-gray-700 px-3 py-2 text-center">
                        <button onClick={() => handleDelete(m.spotify_uri)} className="text-red-400 hover:text-red-300 font-bold">✕</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SUMMARY */}
      {filtered.length > 0 && (
        <div className="mt-6 grid grid-cols-5 gap-4">
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
            <div className="text-sm text-gray-400 mb-1">Avg Save %</div>
            <div className="text-2xl font-bold text-purple-400">{(filtered.reduce((sum, m) => sum + (m.save_ratio || 0), 0) / filtered.length).toFixed(2)}%</div>
          </div>
          <div className="bg-gray-800 p-4 rounded border border-gray-700">
            <div className="text-sm text-gray-400 mb-1">Total Songs</div>
            <div className="text-2xl font-bold">{filtered.length}</div>
          </div>
        </div>
      )}
    </div>
  );
}
