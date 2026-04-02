import React, { useEffect } from 'react';
import { Routes, Route, useSearchParams } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Groups from './pages/Groups';
import Trades from './pages/Trades';
import Curation from './pages/Curation';
import QuickReauth from './pages/QuickReauth';
import SongMetrics from './pages/SongMetrics';
import DiscoveryAnalytics from './pages/DiscoveryAnalytics';

function AppContent() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refresh } = useApp();

  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected) {
      refresh();
      setSearchParams({});
    }

    if (error) {
      alert(`Spotify connection error: ${error}`);
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, refresh]);

  return (
    <div className="min-h-screen bg-spotify-dark text-white">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/curation" element={<Curation />} />
          <Route path="/metrics" element={<SongMetrics />} />
          <Route path="/discovery" element={<DiscoveryAnalytics />} />
          <Route path="/reauth" element={<QuickReauth />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
