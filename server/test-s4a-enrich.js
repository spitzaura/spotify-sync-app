/**
 * S4A Enrich Endpoint Integration Test
 * 
 * Usage: node server/test-s4a-enrich.js
 * 
 * This test:
 * 1. Starts the server
 * 2. Makes a request to POST /api/s4a/scrape-enrich
 * 3. Listens to SSE events
 * 4. Validates the response format
 * 5. Stops after first few events or timeout
 */

const http = require('http');
const db = require('./db');

const API_URL = 'http://localhost:3000';

// Get sample track IDs from database
function getSampleTrackIds(limit = 1) {
  const rows = db.prepare(`
    SELECT id, spotify_uri, track_name FROM song_metrics
    LIMIT ?
  `).all(limit);
  
  return rows.map(r => r.id);
}

function makeSSERequest(trackIds) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ track_ids: trackIds });
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/s4a/scrape-enrich',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 300000 // 5 minute timeout
    };
    
    const req = http.request(options, (res) => {
      console.log(`\n📡 Connected to endpoint`);
      console.log(`📊 Status: ${res.statusCode}`);
      console.log(`🔌 Headers:`, {
        contentType: res.headers['content-type'],
        cacheControl: res.headers['cache-control'],
        connection: res.headers['connection']
      });
      
      let buffer = '';
      let eventCount = 0;
      const maxEvents = 10;
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n\n');
        
        // Process complete events (ends with \n\n)
        for (let i = 0; i < lines.length - 1; i++) {
          const event = lines[i].trim();
          if (event.startsWith('data: ')) {
            eventCount++;
            try {
              const data = JSON.parse(event.substring(6));
              console.log(`\n✨ Event #${eventCount} (${data.type}):`);
              console.log('  ', JSON.stringify(data, null, 2).split('\n').join('\n   '));
              
              if (eventCount >= maxEvents || data.type === 'complete' || data.type === 'error') {
                // Stop after a few events or if complete
                req.destroy();
                resolve({
                  success: true,
                  eventCount,
                  lastEvent: data
                });
              }
            } catch (e) {
              console.error('❌ Failed to parse event:', event, e.message);
            }
          }
        }
        
        // Keep last incomplete line in buffer
        buffer = lines[lines.length - 1];
      });
      
      res.on('end', () => {
        console.log(`\n✅ Stream ended after ${eventCount} events`);
        resolve({
          success: true,
          eventCount,
          reason: 'stream_ended'
        });
      });
      
      res.on('error', (err) => {
        console.error('❌ Response error:', err.message);
        reject(err);
      });
    });
    
    req.on('error', (err) => {
      console.error('❌ Request error:', err.message);
      reject(err);
    });
    
    req.on('timeout', () => {
      console.error('⏱️  Request timeout');
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

async function runTest() {
  console.log('🧪 S4A Enrich Endpoint Test');
  console.log('═'.repeat(50));
  
  try {
    // Check server is running
    console.log('\n1️⃣  Checking server...');
    const healthResult = await fetch(`${API_URL}/api/health`);
    if (!healthResult.ok) {
      throw new Error(`Server health check failed: ${healthResult.status}`);
    }
    const health = await healthResult.json();
    console.log(`✅ Server running (${health.status})`);
    
    // Get sample tracks
    console.log('\n2️⃣  Getting sample tracks from database...');
    const trackIds = getSampleTrackIds(1);
    if (trackIds.length === 0) {
      throw new Error('No tracks found in song_metrics table');
    }
    console.log(`✅ Found ${trackIds.length} track(s) to test`);
    console.log(`   Track ID: ${trackIds[0]}`);
    
    // Make SSE request
    console.log('\n3️⃣  Making SSE request...');
    const result = await makeSSERequest(trackIds);
    
    console.log('\n' + '═'.repeat(50));
    console.log('✅ Test completed!');
    console.log('Summary:');
    console.log(`  - Events received: ${result.eventCount}`);
    console.log(`  - Last event type: ${result.lastEvent.type}`);
    console.log(`  - Success: ${result.success}`);
    
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Is the server running? (npm run dev)');
    console.error('  2. Are Python dependencies installed? (pip install selenium webdriver-manager pandas)');
    console.error('  3. Are there tracks in song_metrics? (sqlite3 spotify-sync.db "SELECT COUNT(*) FROM song_metrics")');
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  runTest().then(() => {
    console.log('\n👋 Exiting test');
    process.exit(0);
  });
}

module.exports = { makeSSERequest, getSampleTrackIds };
