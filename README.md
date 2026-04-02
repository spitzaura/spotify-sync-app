# 🎵 Spotify Playlist Sync Manager

Sync playlists across multiple Spotify accounts. Set a master playlist, link child playlists from any connected account, and sync them with one click.

## Features

- **Multi-account support** — Connect multiple Spotify accounts via OAuth
- **Master groups** — Organize syncs by group (e.g. "Summer 2026", "Workout Mix")
- **One-click sync** — Children mirror the master's tracks exactly
- **Smart diffing** — Only adds missing tracks and removes extras
- **Token auto-refresh** — Accounts stay connected
- **Clean UI** — Dark Spotify-themed dashboard

## Setup

### 1. Create a Spotify App

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the redirect URI to: `http://localhost:3000/auth/spotify/callback`
4. Note your **Client ID** and **Client Secret**

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Spotify credentials:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SESSION_SECRET=any_random_string
```

### 3. Install & Run

```bash
# Install all dependencies
npm run install-all

# Start both backend and frontend
npm run dev
```

- Backend: http://localhost:3000
- Frontend: http://localhost:5173

### 4. Connect Accounts

1. Click "Connect Spotify Account"
2. Log in with your Spotify account
3. Repeat for additional accounts (Spotify's login dialog will always show, so you can pick a different account)

### 5. Create a Sync Group

1. Go to **Sync Groups** → **New Group**
2. Name it (e.g. "Party Mix")
3. Set a **master playlist** from any connected account
4. Add **child playlists** from any connected account
5. Hit **🔄 Sync** — children will mirror the master!

## Architecture

```
spotify-sync-app/
├── server/
│   ├── index.js        # Express server entry
│   ├── routes.js       # API + OAuth routes
│   ├── db.js           # SQLite setup (better-sqlite3)
│   ├── store.js        # Data access layer
│   └── spotify.js      # Spotify API client (auth, playlists, sync)
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── api.js      # Frontend API helper
│   │   ├── context/    # React context
│   │   ├── components/ # Reusable components
│   │   └── pages/      # Dashboard, Accounts, Groups
│   └── ...
├── .env.example
└── package.json
```

## How Sync Works

1. Reads all tracks from the master playlist (paginated, handles 100+ tracks)
2. For each child playlist:
   - Reads its current tracks
   - Computes diff: tracks to add (in master, not in child) and tracks to remove (in child, not in master)
   - Applies changes via Spotify API
3. Respects Spotify rate limits (auto-retry on 429)
4. Logs results for each sync operation

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** React + Vite + Tailwind CSS
- **Database:** SQLite (via better-sqlite3)
- **Auth:** Spotify OAuth 2.0 (Authorization Code flow)
