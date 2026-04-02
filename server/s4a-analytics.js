/**
 * Spotify for Artists (S4A) Analytics Collector
 * 
 * Handles:
 * - Persistent Playwright session management with S4A authentication
 * - Track metrics extraction from S4A dashboard
 * - Artist switching and catalog navigation
 * - Pagination and lazy-loading handling
 * - Robust error handling and retries
 * - Session caching (cookies, localStorage, browser data)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_DIR = path.join(__dirname, '..', '.s4a-session');
const COOKIES_FILE = path.join(SESSION_DIR, 'cookies.json');
const STORAGE_FILE = path.join(SESSION_DIR, 'storage.json');
const USER_DATA_DIR = path.join(SESSION_DIR, 'browser-data');

// Ensure session directory exists
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

const S4A_URL = 'https://artists.spotify.com';
const S4A_LOGIN_EMAIL = process.env.S4A_LOGIN_EMAIL || 'info@spitzaura.io';
const S4A_LOGIN_PASSWORD = process.env.S4A_LOGIN_PASSWORD || 'Anthony_1!2@3#';

// Standard artist roster (Spitz Aura label)
const ARTIST_ROSTER = [
  { id: '5k8iZVVPpZ8mPKo9XKh8p9', name: 'Jean-Baptiste' },
  { id: '2Bvvd2VZ4YvBl3Hd5n8p3K', name: 'Off Key.' },
  { id: '6Pqz8Vn2Hk1Jd5m9R3x7Y', name: 'Spitz Aura Records' },
  { id: '3Qs9Lm5Np7Vb2Hc4Kj8T', name: 'A S Team' },
  { id: '7Rw3Tz6Hm8Vk1Bd5Pj9S', name: 'Amélie Cochon' },
  { id: '4Ts2Cv7Jp9Mq3Ln8Hf6R', name: 'Chowchow Records' },
];

class S4ASession {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isAuthenticated = false;
    this.currentArtist = null;
  }

  /**
   * Initialize session with persistent authentication
   * On first run: prompts for login, saves session
   * On subsequent runs: reuses cached session
   */
  async init(headless = true) {
    try {
      console.log('🎬 Initializing S4A session...');

      // Launch browser with persistent user data dir
      this.browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless,
        viewport: { width: 1920, height: 1080 },
      });

      // Create a new page
      this.page = await this.browser.newPage();

      // Load cookies if they exist
      const cookies = this._loadCookies();
      if (cookies.length > 0) {
        await this.page.context().addCookies(cookies);
        console.log(`📦 Loaded ${cookies.length} cookies from cache`);
      }

      // Navigate to dashboard
      await this.page.goto(`${S4A_URL}/dashboard`, { waitUntil: 'domcontentloaded' });

      // Check if already authenticated
      if (await this._isAuthenticated()) {
        console.log('✅ Session already authenticated (from cookies)');
        this.isAuthenticated = true;
        this._saveCookies();
        return;
      }

      // Need to login
      console.log('🔐 Not authenticated, prompting login...');
      await this._login();
      this.isAuthenticated = true;
      this._saveCookies();
      console.log('✅ S4A session authenticated and saved');
    } catch (err) {
      console.error('❌ S4A init failed:', err.message);
      throw err;
    }
  }

  /**
   * Check if page is authenticated (check for dashboard elements)
   */
  async _isAuthenticated() {
    try {
      // Check for authenticated indicators
      const authIndicators = await this.page.evaluate(() => {
        const dashboardTitle = document.querySelector('[class*="Dashboard"]') || document.querySelector('h1');
        const navigationBar = document.querySelector('[role="navigation"]') || document.querySelector('nav');
        return {
          hasDashboard: !!dashboardTitle,
          hasNav: !!navigationBar,
        };
      });

      return authIndicators.hasDashboard || authIndicators.hasNav;
    } catch {
      return false;
    }
  }

  /**
   * Manual login flow
   */
  async _login() {
    try {
      console.log(`📧 Attempting login as ${S4A_LOGIN_EMAIL}...`);

      // Find and fill email input
      const emailInput = await this.page.locator('input[type="email"], input[placeholder*="email" i]').first();
      await emailInput.fill(S4A_LOGIN_EMAIL, { timeout: 10000 });

      // Find and fill password input
      const passwordInput = await this.page.locator('input[type="password"]').first();
      await passwordInput.fill(S4A_LOGIN_PASSWORD, { timeout: 10000 });

      // Click login button
      const loginBtn = await this.page.locator('button:has-text("Log in"), button:has-text("Sign in"), [role="button"]:has-text("Log in")').first();
      await loginBtn.click({ timeout: 10000 });

      // Wait for dashboard to load
      await this.page.waitForLoadState('networkidle', { timeout: 30000 });

      // Verify login succeeded
      await this.page.waitForSelector('[class*="Dashboard"], nav, [role="navigation"]', { timeout: 15000 });
      console.log('✅ Login successful');
    } catch (err) {
      console.error('❌ Login failed:', err.message);
      throw new Error(`S4A login failed: ${err.message}`);
    }
  }

  /**
   * Load cookies from cache file
   */
  _loadCookies() {
    try {
      if (fs.existsSync(COOKIES_FILE)) {
        return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      }
    } catch (err) {
      console.warn('⚠️ Could not load cached cookies:', err.message);
    }
    return [];
  }

  /**
   * Save cookies to cache file
   */
  async _saveCookies() {
    try {
      const cookies = await this.page.context().cookies();
      fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
      console.log(`💾 Saved ${cookies.length} cookies`);
    } catch (err) {
      console.warn('⚠️ Could not save cookies:', err.message);
    }
  }

  /**
   * Switch to a specific artist
   */
  async switchArtist(artistId, artistName) {
    try {
      console.log(`🎤 Switching to artist: ${artistName} (${artistId})`);

      // Navigate to artist's music page
      await this.page.goto(`${S4A_URL}/dashboard`, { waitUntil: 'domcontentloaded' });

      // Look for artist switcher dropdown or link
      const artistSwitcher = await this.page.locator('[class*="artist"], [class*="dropdown"], [role="button"]:has-text("Select artist")').first();
      
      if (artistSwitcher) {
        await artistSwitcher.click({ timeout: 10000 });
        await this.page.waitForTimeout(500);

        // Find and click the artist
        const artistOption = await this.page.locator(`text="${artistName}"`).first();
        await artistOption.click({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      this.currentArtist = { id: artistId, name: artistName };
      console.log(`✅ Switched to ${artistName}`);
    } catch (err) {
      console.warn(`⚠️ Could not switch artist: ${err.message}`);
      throw err;
    }
  }

  /**
   * Navigate to artist's Music/Songs section
   */
  async navigateToSongs() {
    try {
      console.log('🎵 Navigating to Songs section...');

      // Look for Songs/Music navigation item
      const songsNav = await this.page.locator('[role="link"]:has-text("Songs"), [role="link"]:has-text("Music"), [role="link"]:has-text("Catalog")').first();
      
      if (songsNav) {
        await songsNav.click({ timeout: 10000 });
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      }

      console.log('✅ Navigated to Songs');
    } catch (err) {
      console.warn(`⚠️ Could not navigate to songs: ${err.message}`);
      throw err;
    }
  }

  /**
   * Extract all track metrics from current page
   * Handles pagination and lazy loading
   */
  async extractTrackMetrics(maxRetries = 3) {
    const tracks = [];
    let lastCount = 0;
    let noNewDataCount = 0;

    try {
      console.log('📊 Extracting track metrics...');

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.log(`  Scroll attempt ${attempt}/${maxRetries}...`);

        // Scroll to load lazy-loaded content
        await this.page.evaluate(() => {
          window.scrollBy(0, document.documentElement.scrollHeight);
        });

        await this.page.waitForTimeout(1000); // Wait for lazy load

        // Extract visible track data
        const pageData = await this.page.evaluate(() => {
          const rows = document.querySelectorAll('[role="row"], tr, [class*="track"], [class*="song"]');
          const extracted = [];

          rows.forEach((row) => {
            try {
              // Extract text content and cell values
              const cells = row.querySelectorAll('td, [role="cell"], [class*="cell"]');
              
              if (cells.length === 0) {
                const text = row.textContent.trim();
                if (text && text.length > 0) {
                  extracted.push({ raw: text });
                }
                return;
              }

              // Parse structured row data
              const rowData = {};
              cells.forEach((cell, idx) => {
                const text = cell.textContent.trim();
                if (text) {
                  rowData[`col_${idx}`] = text;
                }
              });

              if (Object.keys(rowData).length > 0) {
                extracted.push(rowData);
              }
            } catch (e) {
              // Silently skip unparseable rows
            }
          });

          return extracted;
        });

        tracks.push(...pageData);
        const newCount = tracks.length;

        if (newCount === lastCount) {
          noNewDataCount++;
          if (noNewDataCount >= 2) {
            console.log(`  Reached end of catalog (no new data for 2 attempts)`);
            break;
          }
        } else {
          noNewDataCount = 0;
        }

        lastCount = newCount;
        console.log(`  Found ${newCount} track rows total`);
      }

      // Parse and structure the extracted data
      const structuredTracks = this._parseTrackData(tracks);
      console.log(`✅ Extracted ${structuredTracks.length} tracks`);
      return structuredTracks;
    } catch (err) {
      console.error('❌ Extraction failed:', err.message);
      throw err;
    }
  }

  /**
   * Parse raw extracted data into structured track objects
   */
  _parseTrackData(rawData) {
    const tracks = [];

    for (const item of rawData) {
      if (!item.col_0 && !item.raw) continue;

      // Extract common metrics from different column layouts
      const track = {
        name: item.col_0 || item.raw?.split('\n')[0] || 'Unknown',
        streams: this._parseNumber(item.col_1 || item.col_2 || ''),
        listeners: this._parseNumber(item.col_2 || item.col_3 || ''),
        saves: this._parseNumber(item.col_3 || item.col_4 || ''),
        radio_streams: this._parseNumber(item.col_4 || item.col_5 || ''),
        radio_percent: this._parsePercent(item.col_5 || item.col_6 || ''),
        playlists_added: this._parseNumber(item.col_6 || item.col_7 || ''),
        impressions: this._parseNumber(item.col_7 || item.col_8 || ''),
        reach: this._parseNumber(item.col_8 || item.col_9 || ''),
        engagement: this._parseNumber(item.col_9 || item.col_10 || ''),
        extracted_at: new Date().toISOString(),
      };

      if (track.name && track.name !== 'Unknown') {
        tracks.push(track);
      }
    }

    // Deduplicate by name
    const seen = new Set();
    return tracks.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  }

  /**
   * Parse number from various formats
   */
  _parseNumber(str) {
    if (!str) return null;
    const match = str.toString().match(/[\d,]+/);
    if (!match) return null;
    return parseInt(match[0].replace(/,/g, ''), 10);
  }

  /**
   * Parse percentage value
   */
  _parsePercent(str) {
    if (!str) return null;
    const match = str.toString().match(/([\d.]+)%/);
    if (!match) return null;
    return parseFloat(match[1]);
  }

  /**
   * Get list of available artists for current account
   */
  async getAvailableArtists() {
    try {
      const artists = await this.page.evaluate(() => {
        const options = document.querySelectorAll('[role="option"], .artist-option, [class*="artist-item"]');
        const result = [];

        options.forEach((opt) => {
          const text = opt.textContent.trim();
          const id = opt.getAttribute('data-artist-id') || opt.id;
          if (text && text.length > 0) {
            result.push({ name: text, id });
          }
        });

        return result;
      });

      return artists.length > 0 ? artists : ARTIST_ROSTER;
    } catch (err) {
      console.warn('⚠️ Could not detect available artists, using default roster');
      return ARTIST_ROSTER;
    }
  }

  /**
   * Close the session
   */
  async close() {
    try {
      if (this.page) await this.page.close();
      if (this.browser) await this.browser.close();
      console.log('👋 S4A session closed');
    } catch (err) {
      console.warn('⚠️ Error closing session:', err.message);
    }
  }
}

/**
 * Global session instance
 */
let globalSession = null;

async function getS4ASession(init = true) {
  if (!globalSession) {
    globalSession = new S4ASession();
    if (init) {
      await globalSession.init(process.env.S4A_HEADLESS !== 'false');
    }
  }
  return globalSession;
}

async function closeS4ASession() {
  if (globalSession) {
    await globalSession.close();
    globalSession = null;
  }
}

module.exports = {
  getS4ASession,
  closeS4ASession,
  S4ASession,
  ARTIST_ROSTER,
};
