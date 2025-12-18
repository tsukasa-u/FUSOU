/**
 * Test script to send a message to the COMPACTION_QUEUE
 * This simulates what FUSOU-WEB does when uploading battle data
 * 
 * Usage:
 *   node test-queue-message.js <account_id> <api_token>
 */

const https = require('https');

const accountId = process.argv[2] || 'YOUR_ACCOUNT_ID';
const apiToken = process.argv[3] || 'YOUR_API_TOKEN';

if (accountId === 'YOUR_ACCOUNT_ID' || apiToken === 'YOUR_API_TOKEN') {
  console.error('Usage: node test-queue-message.js <account_id> <api_token>');
  console.error('Get these values from: https://dash.cloudflare.com/profile/api-tokens');
  process.exit(1);
}

const queueId = 'dev-kc-compaction-queue';
const message = {
  datasetId: 'test-dataset-' + Date.now(),
  table: 'battle_files',
  periodTag: '2025-12-18',
  priority: 'realtime',
  triggeredAt: new Date().toISOString(),
  metricId: 'test-metric-' + Date.now(),
};

const requestBody = {
  messages: [
    {
      body: message,
    }
  ]
};

const options = {
  hostname: 'api.cloudflare.com',
  path: `/client/v4/accounts/${accountId}/queues/${queueId}/messages`,
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'Content-Length': JSON.stringify(requestBody).length,
  }
};

console.log('📨 Sending test message to COMPACTION_QUEUE...');
console.log('Message:', JSON.stringify(message, null, 2));
console.log('');

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    const response = JSON.parse(data);
    
    if (response.success) {
      console.log('✅ Message sent successfully!');
      console.log('Response:', JSON.stringify(response.result, null, 2));
      console.log('');
      console.log('📋 Next steps:');
      console.log('1. Check worker logs: npx wrangler tail');
      console.log('2. Look for logs starting with "[Queue Consumer]"');
      console.log('3. Verify Supabase connection: "supabaseUrl is required" error means env vars failed');
    } else {
      console.error('❌ Failed to send message');
      console.error('Errors:', response.errors);
    }
  });
});

req.on('error', (e) => {
  console.error('Error:', e);
});

req.write(JSON.stringify(requestBody));
req.end();
