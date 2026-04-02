#!/usr/bin/env python3
"""
S4A Fast Scraper with Automated Login
- Uses S4A_LOGIN_EMAIL and S4A_LOGIN_PASSWORD for auto-login
- Falls back to manual login if credentials not available
- Caches session for reuse
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
INPUT_FILE = os.environ.get("S4A_INPUT_FILE", "mix9.txt")
OUTPUT_FILE = os.environ.get("S4A_OUTPUT_FILE", "spotify_song_stats_fast.csv")
PARTIAL_FILE = os.environ.get("S4A_PARTIAL_FILE", "spotify_partial_backup.csv")
RESTART_EVERY = int(os.environ.get("S4A_RESTART_EVERY", "25"))
MAX_PAGE_WAIT = int(os.environ.get("S4A_MAX_WAIT", "12"))

# Login credentials
S4A_LOGIN_EMAIL = os.environ.get("S4A_LOGIN_EMAIL")
S4A_LOGIN_PASSWORD = os.environ.get("S4A_LOGIN_PASSWORD")

def start_browser():
    user_data_dir = os.path.expanduser("~/.s4a_scraper_profile")
    os.makedirs(user_data_dir, exist_ok=True)

    opts = Options()
    opts.add_argument(f"--user-data-dir={user_data_dir}")
    opts.add_argument("--profile-directory=Default")
    opts.add_argument("--start-maximized")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=opts)

    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
    })
    return driver

def wait_for_login(driver, timeout=90):
    """Wait for authentication — try auto-login first, then manual."""
    driver.get("https://artists.spotify.com")
    
    # Check if already logged in (from cached session)
    for _ in range(10):
        url = driver.current_url
        if "/c/" in url and "login" not in url:
            print("✅ Already authenticated (from cache)")
            return
        time.sleep(1)
    
    # Not logged in — try auto-login if credentials available
    if S4A_LOGIN_EMAIL and S4A_LOGIN_PASSWORD:
        try:
            print(f"🔐 Attempting auto-login as {S4A_LOGIN_EMAIL}...")
            auto_login(driver)
            print("✅ Auto-login successful")
            return
        except Exception as e:
            print(f"⚠️  Auto-login failed: {e}")
            # Fall through to manual login
    
    # Fall back to manual login
    print("🟡 Manual login needed. Waiting up to 90 seconds...")
    for _ in range(timeout):
        url = driver.current_url
        if "/c/" in url and "login" not in url:
            print("✅ Logged in (manual)")
            return
        time.sleep(1)
    
    raise RuntimeError("Not authenticated after 90 seconds")

def auto_login(driver):
    """Automatically log in using email and password."""
    driver.get("https://artists.spotify.com/login")
    
    try:
        # Wait for email input
        email_input = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='email']"))
        )
        email_input.send_keys(S4A_LOGIN_EMAIL)
        time.sleep(0.5)
        
        # Find and fill password
        password_input = driver.find_element(By.CSS_SELECTOR, "input[type='password']")
        password_input.send_keys(S4A_LOGIN_PASSWORD)
        time.sleep(0.5)
        
        # Find and click login button
        login_btn = driver.find_element(By.XPATH, "//button[contains(text(), 'Log in') or contains(text(), 'Sign in')]")
        login_btn.click()
        
        # Wait for redirect to dashboard
        WebDriverWait(driver, 30).until(
            lambda driver: "/c/" in driver.current_url and "login" not in driver.current_url
        )
        time.sleep(2)
        
    except Exception as e:
        raise RuntimeError(f"Auto-login failed: {e}")

def get_token(driver):
    """Extract auth token from localStorage."""
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
    """Fetch streams, listeners, saves via internal API."""
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

def scrape_playlist_page(driver, url):
    """Navigate to playlist page to get playlist adds."""
    driver.get(url)
    
    adds = "N/A"
    radio = "N/A"
    
    try:
        # Wait for metrics section
        WebDriverWait(driver, MAX_PAGE_WAIT).until(
            EC.presence_of_element_located((By.XPATH, "//p[@data-slo-id='hero-stats-section-metric']"))
        )
        
        metrics = driver.find_elements(By.XPATH, "//p[@data-slo-id='hero-stats-section-metric']")
        if len(metrics) >= 2:
            adds = metrics[1].text.strip().replace(",", "")
        if len(metrics) >= 4:
            radio = metrics[3].text.strip().replace(",", "")
    except:
        pass
    
    return adds, radio

def scrape_saves_from_stats_page(driver, url):
    """Scrape saves count from stats page."""
    driver.get(url)
    
    try:
        WebDriverWait(driver, MAX_PAGE_WAIT).until(
            EC.presence_of_element_located((By.XPATH, "//p[@data-slo-id='hero-stats-section-metric']"))
        )
        
        metrics = driver.find_elements(By.XPATH, "//p[@data-slo-id='hero-stats-section-metric']")
        if len(metrics) >= 5:
            return metrics[4].text.strip().replace(",", "")
    except:
        pass
    return "N/A"

def main():
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
    
    for i, url in enumerate(urls, 1):
        print(f"[{i}/{len(urls)}] 🔍 {url[:80]}")
        sys.stdout.flush()

        try:
            artist_id, track_id = parse_url(url)

            # Get stats via API
            stats = fetch_stats_via_api(driver, token, artist_id, track_id)
            
            if stats and "error" in stats:
                print(f"  ⚠️ API error: {stats['error']}, refreshing token...")
                token = get_token(driver)
                stats = fetch_stats_via_api(driver, token, artist_id, track_id)
            
            streams = stats.get("streams", "N/A") if stats else "N/A"
            listeners = stats.get("listeners", "N/A") if stats else "N/A"

            # Get playlist page data
            adds, radio = scrape_playlist_page(driver, url)

            # Get saves
            saves = scrape_saves_from_stats_page(driver, url)

            print(f"  🎯 Streams: {streams} | Listeners: {listeners} | Adds: {adds} | Saves: {saves}")

            results.append({
                "URL": url,
                "Streams": streams,
                "Listeners": listeners,
                "Playlists Added": adds,
                "Radio %": radio,
                "Saves": saves
            })

        except Exception as e:
            print(f"  ❌ Error: {e}")
            results.append({
                "URL": url,
                "Streams": "ERROR",
                "Listeners": "ERROR",
                "Playlists Added": "ERROR",
                "Radio %": "ERROR",
                "Saves": "ERROR"
            })

        # Partial save
        if i % 10 == 0:
            pd.DataFrame(results).to_csv(PARTIAL_FILE, index=False)
            print("  💾 Partial save")

        # Restart browser periodically
        if i % RESTART_EVERY == 0 and i < len(urls):
            print("  ♻️ Restarting browser...")
            driver.quit()
            time.sleep(5)
            driver = start_browser()
            wait_for_login(driver)
            token = get_token(driver)

    # Final save
    df = pd.DataFrame(results)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\n✅ DONE — Saved {len(results)} results to '{OUTPUT_FILE}'")
    driver.quit()

if __name__ == "__main__":
    main()
