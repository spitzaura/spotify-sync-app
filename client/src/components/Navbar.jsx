import React from 'react';
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Dashboard', icon: '🏠' },
  { to: '/accounts', label: 'Accounts', icon: '👤' },
  { to: '/groups', label: 'Sync Groups', icon: '🔗' },
  { to: '/trades', label: 'Trades', icon: '🤝' },
  { to: '/discovery', label: 'Discovery', icon: '🔍' },
  { to: '/metrics', label: 'Metrics', icon: '📊' },
  { to: '/curation', label: 'Curation', icon: '🎛️' },
];

export default function Navbar() {
  return (
    <nav className="bg-spotify-gray border-b border-gray-700">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎵</span>
            <span className="font-bold text-lg text-spotify-green">Playlist Sync Manager</span>
          </div>
          <div className="flex gap-1">
            {links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-spotify-green text-black'
                      : 'text-spotify-light hover:text-white hover:bg-gray-700'
                  }`
                }
              >
                <span className="mr-1.5">{link.icon}</span>
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
