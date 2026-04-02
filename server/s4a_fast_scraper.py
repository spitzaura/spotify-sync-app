"""
S4A Fast Scraper — Optimized version
Uses internal APIs instead of page navigation for stats.
Only navigates for playlist adds + radio streams (1 page per song instead of 3).

Usage:
1. pip install selenium webdriver-manager pandas
2. Put your S4A URLs in mix9.txt (one per line)
3. python s4a_fast_scraper.py
4. Log in manually when browser opens (if needed)
5. Results saved to spotify_song_stats_fast.csv
"""

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import time, pandas as pd, os, re, json, sys

# ─── Config ───
import os
INPUT_FILE = os.environ.get("S4A_INPUT_FILE", "mix9.txt")
OUTPUT_FILE = os.environ.get("S4A_OUTPUT_FILE", "spotify_song_stats_fast.csv")
PARTIAL_FILE = os.environ.get("S4A_PARTIAL_FILE", "spotify_partial_backup.csv")
RESTART_EVERY = int(os.environ.get("S4A_RESTART_EVERY", "25"))  # restart browser every N scrapes
MAX_PAGE_WAIT = int(os.environ.get("S4A_MAX_WAIT", "12"))  # max seconds to wait for page elements


def start_browser():
    user_data_dir = os.path.expanduser("~/.selenium_chrome_profile")
    os.makedirs(user_data_dir, exist_ok=True)

    opts = Options()
    opts.add_argument(f"--user-data-dir={user_data_dir}")
    opts.add_argument("--profile-directory=Default")
    opts.add_argument("--start-maximized")
    # Anti-detection
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)

    # Remove webdriver flag
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
    })
    return driver


def wait_for_login(driver, timeout=90):
    """Wait for user to log in manually."""
    driver.get("https://artists.spotify.com")
    print("🟡 Please log in manually if needed. Waiting up to 90 seconds...")
    for _ in range(timeout):
        url = driver.current_url
        if "/c/" in url and "login" not in url:
            break
        time.sleep(1)
    print("✅ Logged in. Starting scrape...")


def get_token(driver):
    """Extract auth token from localStorage."""
    # Navigate to S4A page first if not already there
    if "artists.spotify.com" not in driver.current_url:
        driver.get("https://artists.spotify.com/c/roster")
        time.sleep(3)
    
    token = driver.execute_script("return localStorage.getItem('auth-token')")
    if not token:
        raise RuntimeError("Could not get auth token from localStorage")
    return token


def parse_url(url):
    """Extract artistId and trackId from S4A URL."""
    m = re.search(r'/artist/([^/]+)/song/([^/]+)', url)
    if not m:
        raise ValueError(f"Can't parse URL: {url}")
    return m.group(1), m.group(2)


def fetch_stats_via_api(driver, token, artist_id, track_id):
    """
    Fetch streams, listeners, saves via internal API — NO page navigation.
    This is the key speedup: ~1s instead of ~15s per song.
    """
    result = driver.execute_script("""
        const [artistId, trackId, token] = arguments;
        const to = new Date().toISOString().split('T')[0];
        const d = new Date(); d.setDate(d.getDate() - 28);
        const from = d.toISOString().split('T')[0];
        
        try {
            const r = await fetch(
                `https://generic.wg.spotify.com/song-stats-view/v1/artist/${artistId}/recording/${trackId}/stats?country=&fromDate=${from}&toDate=${to}`,
                { headers: { 'Authorization': 'Bearer ' + token } }
            );
            if (!r.ok) return { error: r.status };
            const data = await r.json();
            return {
                streams: data.streams?.current_period_agg || '0',
                listeners: data.listeners?.current_period_agg || '0'
            };
        } catch(e) {
            return { error: e.message };
        }
    """, artist_id, track_id, token)
    return result


def fetch_saves_via_api(driver, token, artist_id, track_id):
    """Fetch saves count via the song info endpoint."""
    # Saves come from the stats page metrics — let's try the info endpoint
    # Actually saves aren't in the stats API, we need the page for that
    # But we can get it from the overview page via API
    result = driver.execute_script("""
        const [artistId, trackId, token] = arguments;
        try {
            const r = await fetch(
                `https://generic.wg.spotify.com/song-stats-view/v2/artist/${artistId}/recording/${trackId}/info`,
                { headers: { 'Authorization': 'Bearer ' + token } }
            );
            if (!r.ok) return { error: r.status };
            return await r.json();
        } catch(e) {
            return { error: e.message };
        }
    """, artist_id, track_id, token)
    return result


def scrape_playlist_page(driver, url):
    """
    Navigate to playlist page to get: playlist adds count + radio streams.
    This is the ONLY page navigation needed per song.
    """
    driver.get(url)
    
    adds = "N/A"
    radio = "N/A"
    
    # Wait for the playlist heading (much faster than random sleep)
    try:
        el = WebDriverWait(driver, MAX_PAGE_WAIT).until(
            EC.presence_of_element_located((By.XPATH,
                "//h2[contains(text(),'playlists') or contains(text(),'playlist')]"))
        )
        text = el.text  # "Top 100 of 614 playlists for this song"
        m = re.search(r'of\s+([\d,]+)\s+playlist', text)
        if m:
            adds = m.group(1).replace(",", "")
    except Exception as e:
        print(f"  ⚠️ Playlist count: {e}")

    # Get radio streams from table
    try:
        # Wait for table to render
        WebDriverWait(driver, 5).until(
            EC.presence_of_element_located((By.TAG_NAME, "table"))
        )
        # Small extra wait for table data
        time.sleep(1)
        
        # Extract radio streams via JS (faster than XPath)
        radio = driver.execute_script("""
            const rows = document.querySelectorAll('table tbody tr');
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4) {
                    const name = cells[1]?.textContent?.trim();
                    if (name === 'Radio') {
                        return cells[3]?.textContent?.trim().replace(/,/g, '') || 'N/A';
                    }
                }
            }
            return 'N/A';
        """)
    except Exception as e:
        print(f"  ⚠️ Radio streams: {e}")

    return adds, radio


def scrape_saves_from_stats_page(driver, url):
    """Only if API doesn't give saves — navigate to stats page."""
    stats_url = url.replace("/playlists", "/stats")
    driver.get(stats_url)
    
    try:
        WebDriverWait(driver, MAX_PAGE_WAIT).until(
            EC.presence_of_element_located((By.XPATH,
                "//p[@data-slo-id='hero-stats-section-metric']"))
        )
        metrics = driver.find_elements(By.XPATH,
            "//p[@data-slo-id='hero-stats-section-metric']")
        if len(metrics) >= 5:
            return metrics[4].text.strip().replace(",", "")
    except:
        pass
    return "N/A"


def main():
    # Load URLs
    try:
        with open(INPUT_FILE) as f:
            urls = [u.strip() for u in f if u.strip()]
    except FileNotFoundError:
        print(f"❌ '{INPUT_FILE}' not found.")
        return

    print(f"📋 Loaded {len(urls)} URLs")

    driver = start_browser()
    wait_for_login(driver)
    
    token = get_token(driver)
    print(f"🔑 Got auth token: {token[:20]}...")

    results = []
    token_refresh_counter = 0

    for i, url in enumerate(urls, 1):
        # Progress for backend
        print(f"[{i}/{len(urls)}] 🔍 {url[:80]}")
        sys.stdout.flush()

        try:
            artist_id, track_id = parse_url(url)

            # ── FAST: Stats via API (no navigation) ──
            stats = fetch_stats_via_api(driver, token, artist_id, track_id)
            
            if stats and "error" in stats:
                # Token might be expired — refresh
                print(f"  ⚠️ API error: {stats['error']}, refreshing token...")
                token = get_token(driver)
                stats = fetch_stats_via_api(driver, token, artist_id, track_id)
            
            streams = stats.get("streams", "N/A") if stats else "N/A"
            listeners = stats.get("listeners", "N/A") if stats else "N/A"

            # ── SLOW: Playlist page (only 1 navigation per song) ──
            adds, radio = scrape_playlist_page(driver, url)

            # ── Saves: try API first, fall back to page ──
            saves = scrape_saves_from_stats_page(driver, url)

            print(f"  🎯 Adds: {adds} | Radio: {radio} | Streams: {streams} | Listeners: {listeners} | Saves: {saves}")

            results.append({
                "Playlist URL": url,
                "Artist ID": artist_id,
                "Track ID": track_id,
                "Playlist Adds": adds,
                "Radio Streams": radio,
                "Streams (28d)": streams,
                "Listeners (28d)": listeners,
                "Saves (28d)": saves
            })

        except Exception as e:
            print(f"  ❌ Error: {e}")
            results.append({
                "Playlist URL": url,
                "Playlist Adds": "ERROR",
                "Radio Streams": "ERROR",
                "Streams (28d)": "ERROR",
                "Listeners (28d)": "ERROR",
                "Saves (28d)": "ERROR"
            })

        # Partial save every 10
        if i % 10 == 0:
            pd.DataFrame(results).to_csv(PARTIAL_FILE, index=False)
            print("  💾 Partial save")

        # Restart browser periodically (less often than before)
        if i % RESTART_EVERY == 0 and i < len(urls):
            pd.DataFrame(results).to_csv(PARTIAL_FILE, index=False)
            print("  ♻️ Restarting browser...")
            driver.quit()
            time.sleep(5)
            driver = start_browser()
            wait_for_login(driver)
            token = get_token(driver)
            print(f"  🔑 Refreshed token")

    # Final save
    df = pd.DataFrame(results)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\n✅ DONE — Saved {len(results)} results to '{OUTPUT_FILE}'")
    driver.quit()


if __name__ == "__main__":
    main()
