#!/usr/bin/env python3
"""
Spotify for Artists Analytics Scraper
Fast Selenium-based scraper using Spotify internal API + page scraping
Optimized for reliability and speed
"""

import sys
import json
import time
import os
import re
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import pandas as pd

# Configuration
CHROME_PROFILE_DIR = os.path.expanduser("~/.s4a-selenium-profile")
RESTART_EVERY = 25
MAX_PAGE_WAIT = 12
API_TIMEOUT = 15

def log(msg, level="INFO"):
    """Log message in JSON format for frontend streaming"""
    print(json.dumps({
        "timestamp": time.time(),
        "level": level,
        "message": msg
    }))
    sys.stdout.flush()

def progress(current, total, message=""):
    """Report progress"""
    pct = (current / total * 100) if total > 0 else 0
    print(json.dumps({
        "type": "progress",
        "current": current,
        "total": total,
        "percentage": round(pct, 1),
        "message": message
    }))
    sys.stdout.flush()

def start_browser(headless=True):
    """Initialize Selenium Chrome browser with persistent profile"""
    try:
        os.makedirs(CHROME_PROFILE_DIR, exist_ok=True)
        
        opts = Options()
        opts.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
        opts.add_argument("--profile-directory=Default")
        opts.add_argument("--start-maximized")
        opts.add_argument("--disable-blink-features=AutomationControlled")
        opts.add_argument("--disable-dev-shm-usage")
        opts.add_argument("--no-sandbox")
        
        if headless:
            opts.add_argument("--headless=new")
        
        opts.add_experimental_option("excludeSwitches", ["enable-automation"])
        opts.add_experimental_option("useAutomationExtension", False)
        
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=opts)
        
        # Anti-detection
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
            "source": "Object.defineProperty(navigator, 'webdriver', {get: () => false})"
        })
        
        log("✅ Browser started", "INFO")
        return driver
    except Exception as e:
        log(f"❌ Failed to start browser: {str(e)}", "ERROR")
        raise

def wait_for_login(driver, timeout=120):
    """Wait for manual login if needed"""
    driver.get("https://artists.spotify.com")
    log("⏳ Checking authentication...", "INFO")
    
    for i in range(timeout):
        url = driver.current_url
        if "/c/" in url and "login" not in url:
            log("✅ Already authenticated", "INFO")
            return True
        time.sleep(1)
    
    log("⚠️ Not authenticated - manual login may be needed", "WARN")
    return False

def get_token(driver):
    """Extract auth token from localStorage"""
    try:
        if "artists.spotify.com" not in driver.current_url:
            driver.get("https://artists.spotify.com/c/roster")
            time.sleep(3)
        
        token = driver.execute_script("return localStorage.getItem('auth-token')")
        
        if not token:
            raise RuntimeError("No auth-token in localStorage")
        
        log(f"🔑 Got auth token: {token[:20]}...", "INFO")
        return token
    except Exception as e:
        log(f"❌ Failed to get token: {str(e)}", "ERROR")
        raise

def parse_url(url):
    """Parse Spotify for Artists URL to extract artist and track IDs"""
    try:
        # Handle both full URLs and artist/track pairs
        if url.startswith("spotify:"):
            # URI format: spotify:track:ID
            parts = url.split(":")
            if len(parts) >= 3:
                return None, parts[2]  # Just track ID
        
        # URL format
        match = re.search(r'/artist/([a-zA-Z0-9]+)/song/([a-zA-Z0-9]+)', url)
        if match:
            return match.group(1), match.group(2)
        
        # Fallback: extract track ID only
        match = re.search(r'[a-zA-Z0-9]{22}', url)
        if match:
            return None, match.group(0)
        
        raise ValueError(f"Cannot parse URL: {url}")
    except Exception as e:
        log(f"⚠️ URL parse error for {url}: {str(e)}", "WARN")
        raise

def fetch_stats_via_api(driver, token, artist_id, track_id):
    """Fetch streaming stats via Spotify internal API"""
    try:
        result = driver.execute_script("""
            const [artistId, trackId, token] = arguments;
            const to = new Date().toISOString().split('T')[0];
            const d = new Date();
            d.setDate(d.getDate() - 28);
            const from = d.toISOString().split('T')[0];
            
            try {
                const endpoint = artistId 
                    ? `https://generic.wg.spotify.com/song-stats-view/v1/artist/${artistId}/recording/${trackId}/stats?country=&fromDate=${from}&toDate=${to}`
                    : `https://generic.wg.spotify.com/song-stats-view/v1/recording/${trackId}/stats?country=&fromDate=${from}&toDate=${to}`;
                
                const response = await fetch(endpoint, {
                    headers: { 'Authorization': 'Bearer ' + token },
                    timeout: 15000
                });
                
                if (!response.ok) {
                    return { error: response.status, status: response.status };
                }
                
                const data = await response.json();
                return {
                    streams: data.streams?.current_period_agg || 0,
                    listeners: data.listeners?.current_period_agg || 0,
                    saves: data.saves?.current_period_agg || 0,
                    radio_streams: data.radio_streams?.current_period_agg || 0,
                    radio_percentage: data.radio_percentage?.current_period_agg || 0,
                    impressions: data.impressions?.current_period_agg || 0,
                    reach: data.reach?.current_period_agg || 0
                };
            } catch(e) {
                return { error: e.message };
            }
        """, artist_id, track_id, token)
        
        return result
    except Exception as e:
        log(f"⚠️ API fetch error: {str(e)}", "WARN")
        return {"error": str(e)}

def scrape_playlist_page(driver, url):
    """Scrape playlist adds and radio streams from song page"""
    adds = "N/A"
    radio = "N/A"
    
    try:
        driver.get(url)
        log(f"📄 Scraping page: {url}", "DEBUG")
        
        # Wait for page to load
        try:
            WebDriverWait(driver, MAX_PAGE_WAIT).until(
                EC.presence_of_element_located((By.TAG_NAME, "h2"))
            )
        except:
            pass
        
        time.sleep(1)
        
        # Extract playlist adds count
        try:
            h2_elements = driver.find_elements(By.TAG_NAME, "h2")
            for el in h2_elements:
                text = el.text.lower()
                if 'playlist' in text:
                    match = re.search(r'(\d+)\s*(?:of\s+)?(\d+)', el.text)
                    if match:
                        adds = match.group(2)
                    break
        except Exception as e:
            log(f"⚠️ Could not extract playlist adds: {str(e)}", "WARN")
        
        # Extract radio streams from table
        try:
            table = WebDriverWait(driver, 5).until(
                EC.presence_of_element_located((By.TAG_NAME, "table"))
            )
            time.sleep(1)
            
            radio_value = driver.execute_script("""
                const rows = document.querySelectorAll('table tbody tr');
                for (const row of rows) {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 4) {
                        const name = cells[1]?.textContent?.trim();
                        if (name && name.toLowerCase() === 'radio') {
                            return cells[3]?.textContent?.trim().replace(/,/g, '') || 'N/A';
                        }
                    }
                }
                return 'N/A';
            """)
            radio = radio_value
        except Exception as e:
            log(f"⚠️ Could not extract radio streams: {str(e)}", "WARN")
    
    except Exception as e:
        log(f"❌ Page scrape error: {str(e)}", "ERROR")
    
    return str(adds), str(radio)

def refresh_token(driver):
    """Refresh auth token by navigating to dashboard"""
    try:
        driver.get("https://artists.spotify.com/c/roster")
        time.sleep(3)
        token = get_token(driver)
        return token
    except Exception as e:
        log(f"⚠️ Token refresh failed: {str(e)}", "WARN")
        return None

def scrape_urls(urls, artist_id=None, headless=True):
    """
    Main scraping function
    urls: list of S4A song URLs
    artist_id: optional artist ID for batch processing
    """
    if not urls:
        log("❌ No URLs provided", "ERROR")
        return []
    
    log(f"📋 Starting scrape of {len(urls)} URLs", "INFO")
    
    driver = None
    results = []
    
    try:
        driver = start_browser(headless=headless)
        wait_for_login(driver)
        token = get_token(driver)
        
        for i, url in enumerate(urls, 1):
            try:
                progress(i, len(urls), f"Processing {url}")
                log(f"🔍 [{i}/{len(urls)}] {url}", "INFO")
                
                # Parse URL
                try:
                    parsed_artist_id, track_id = parse_url(url)
                    artist_id = artist_id or parsed_artist_id
                except Exception as e:
                    log(f"⚠️ Could not parse URL {url}: {str(e)}", "WARN")
                    continue
                
                # Fetch stats from API
                stats = fetch_stats_via_api(driver, token, artist_id, track_id)
                
                # Refresh token if API error
                if stats and "error" in stats and stats.get("status") == 401:
                    log(f"🔄 Refreshing token (API 401)", "INFO")
                    token = refresh_token(driver)
                    if token:
                        stats = fetch_stats_via_api(driver, token, artist_id, track_id)
                
                # Extract metrics
                streams = stats.get("streams", 0) if stats and "error" not in stats else 0
                listeners = stats.get("listeners", 0) if stats and "error" not in stats else 0
                saves = stats.get("saves", 0) if stats and "error" not in stats else 0
                radio_streams = stats.get("radio_streams", 0) if stats and "error" not in stats else 0
                radio_pct = stats.get("radio_percentage", 0) if stats and "error" not in stats else 0
                impressions = stats.get("impressions", 0) if stats and "error" not in stats else 0
                reach = stats.get("reach", 0) if stats and "error" not in stats else 0
                
                # Scrape page for playlist adds and additional radio data
                adds, radio = scrape_playlist_page(driver, url)
                
                log(f"✅ Adds: {adds} | Radio: {radio} | Streams: {streams} | Listeners: {listeners}", "INFO")
                
                results.append({
                    "url": url,
                    "artist_id": artist_id,
                    "track_id": track_id,
                    "streams": int(streams) if isinstance(streams, (int, float)) else 0,
                    "listeners": int(listeners) if isinstance(listeners, (int, float)) else 0,
                    "saves": int(saves) if isinstance(saves, (int, float)) else 0,
                    "radio_streams": int(radio_streams) if isinstance(radio_streams, (int, float)) else 0,
                    "radio_percentage": float(radio_pct) if isinstance(radio_pct, (int, float)) else 0,
                    "playlist_adds": adds,
                    "impressions": int(impressions) if isinstance(impressions, (int, float)) else 0,
                    "reach": int(reach) if isinstance(reach, (int, float)) else 0,
                    "timestamp": time.time()
                })
            
            except Exception as e:
                log(f"❌ Error processing {url}: {str(e)}", "ERROR")
                continue
            
            # Restart browser periodically
            if i % RESTART_EVERY == 0 and i < len(urls):
                log(f"♻️ Restarting browser after {RESTART_EVERY} songs", "INFO")
                driver.quit()
                time.sleep(5)
                driver = start_browser(headless=headless)
                wait_for_login(driver)
                token = get_token(driver)
        
        progress(len(urls), len(urls), "✅ Scraping complete!")
        log(f"✅ Scraped {len(results)}/{len(urls)} songs successfully", "INFO")
        
        return results
    
    except Exception as e:
        log(f"❌ Fatal error: {str(e)}", "ERROR")
        return results
    
    finally:
        if driver:
            try:
                driver.quit()
                log("👋 Browser closed", "INFO")
            except:
                pass

def main():
    """CLI entry point for testing"""
    if len(sys.argv) < 2:
        print("Usage: python s4a_scraper.py <urls.txt> [artist_id] [--headless]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    artist_id = sys.argv[2] if len(sys.argv) > 2 else None
    headless = "--headless" in sys.argv
    
    if not os.path.exists(input_file):
        log(f"❌ File not found: {input_file}", "ERROR")
        sys.exit(1)
    
    with open(input_file) as f:
        urls = [line.strip() for line in f if line.strip()]
    
    log(f"📋 Loaded {len(urls)} URLs from {input_file}", "INFO")
    
    results = scrape_urls(urls, artist_id=artist_id, headless=headless)
    
    # Save to CSV
    if results:
        df = pd.DataFrame(results)
        output_file = "spotify_song_stats_fast.csv"
        df.to_csv(output_file, index=False)
        log(f"💾 Saved {len(results)} results to {output_file}", "INFO")
    else:
        log("⚠️ No results to save", "WARN")

if __name__ == "__main__":
    main()
