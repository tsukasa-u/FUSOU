#!/usr/bin/env node
/**
 * Hot/Cold Architecture Integration Test
 * Tests buffer_logs → archiver → R2 → reader flow
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'blue');
  console.log('='.repeat(60));
}

// Mock implementations for local testing
class MockD1Database {
  constructor() {
    this.tables = {
      buffer_logs: [],
      archived_files: [],
      block_indexes: []
    };
    this.autoIncrement = {
      buffer_logs: 1,
      archived_files: 1,
      block_indexes: 1
    };
    this.lastInsertTable = null;
  }

  prepare(sql) {
    const self = this;
    let boundParams = [];

    return {
      bind(...params) {
        boundParams = params;
        return this;
      },
      
      async run() {
        // Handle INSERT
        if (sql.includes('INSERT INTO buffer_logs')) {
          const recordCount = boundParams.length / 6; // 6 params per record (added period_tag)
          for (let i = 0; i < recordCount; i++) {
            const offset = i * 6;
            self.tables.buffer_logs.push({
              id: self.autoIncrement.buffer_logs++,
              dataset_id: boundParams[offset],
              table_name: boundParams[offset + 1],
              period_tag: boundParams[offset + 2],
              timestamp: boundParams[offset + 3],
              data: boundParams[offset + 4],
              uploaded_by: boundParams[offset + 5]
            });
          }
          self.lastInsertTable = 'buffer_logs';
          return { success: true };
        }
        
        // Handle INSERT INTO archived_files
        if (sql.includes('INSERT INTO archived_files')) {
          const newId = self.autoIncrement.archived_files++;
          self.tables.archived_files.push({
            id: newId,
            file_path: boundParams[0],
            file_size: boundParams[1],
            compression_codec: boundParams[2],
            created_at: boundParams[3],
            last_modified_at: boundParams[4]
          });
          self.lastInsertTable = 'archived_files';
          console.log(`  MockD1: Inserted archived_file id=${newId}, path=${boundParams[0]}`);
          return { success: true };
        }
        
        // Handle INSERT INTO block_indexes
        if (sql.includes('INSERT INTO block_indexes')) {
          const recordCount = boundParams.length / 8; // 8 params per block
          for (let i = 0; i < recordCount; i++) {
            const offset = i * 8;
            const newId = self.autoIncrement.block_indexes++;
            const blockIndex = {
              id: newId,
              dataset_id: boundParams[offset],
              table_name: boundParams[offset + 1],
              file_id: boundParams[offset + 2],
              start_byte: boundParams[offset + 3],
              length: boundParams[offset + 4],
              record_count: boundParams[offset + 5],
              start_timestamp: boundParams[offset + 6],
              end_timestamp: boundParams[offset + 7]
            };
            self.tables.block_indexes.push(blockIndex);
            console.log(`  MockD1: Inserted block_index id=${newId}, file_id=${blockIndex.file_id}`);
          }
          self.lastInsertTable = 'block_indexes';
          return { success: true };
        }
        
        // Handle UPDATE
        if (sql.includes('UPDATE archived_files')) {
          const fileId = boundParams[2];
          const file = self.tables.archived_files.find(f => f.id === fileId);
          if (file) {
            file.file_size = boundParams[0];
            file.last_modified_at = boundParams[1];
          }
          return { success: true };
        }
        
        // Handle DELETE
        if (sql.includes('DELETE FROM buffer_logs')) {
          const maxId = boundParams[0];
          self.tables.buffer_logs = self.tables.buffer_logs.filter(r => r.id > maxId);
          return { success: true };
        }
        
        return { success: true };
      },
      
      async all() {
        // Handle SELECT from buffer_logs
        if (sql.includes('FROM buffer_logs')) {
          let results = self.tables.buffer_logs;
          
          // Apply WHERE filters from boundParams
          if (boundParams.length >= 2) {
            results = results.filter(r => 
              r.dataset_id === boundParams[0] && r.table_name === boundParams[1]
            );
          }
          if (boundParams.length >= 3 && sql.includes('timestamp >=')) {
            const from = boundParams[2];
            results = results.filter(r => r.timestamp >= from);
          }
          if (boundParams.length >= 4 && sql.includes('timestamp <=')) {
            const to = boundParams[3];
            results = results.filter(r => r.timestamp <= to);
          }
          
          return { results };
        }
        
        // Handle SELECT with JOIN
        if (sql.includes('FROM block_indexes bi') && sql.includes('JOIN archived_files af')) {
          let results = self.tables.block_indexes.map(bi => {
            const file = self.tables.archived_files.find(f => f.id === bi.file_id);
            return {
              id: bi.id,
              dataset_id: bi.dataset_id,
              table_name: bi.table_name,
              file_id: bi.file_id,
              start_byte: bi.start_byte,
              length: bi.length,
              record_count: bi.record_count,
              start_timestamp: bi.start_timestamp,
              end_timestamp: bi.end_timestamp,
              file_path: file?.file_path || null,
              compression_codec: file?.compression_codec || null
            };
          });
          
          // Apply WHERE filters from boundParams
          if (boundParams.length >= 2) {
            results = results.filter(r => 
              r.dataset_id === boundParams[0] && r.table_name === boundParams[1]
            );
          }
          if (boundParams.length >= 3 && sql.includes('end_timestamp >=')) {
            const from = boundParams[2];
            results = results.filter(r => r.end_timestamp >= from);
          }
          if (boundParams.length >= 4 && sql.includes('start_timestamp <=')) {
            const to = boundParams[3];
            results = results.filter(r => r.start_timestamp <= to);
          }
          
          return { results };
        }
        
        return { results: [] };
      },
      
      async first() {
        // Handle SELECT last_insert_rowid()
        if (sql.includes('last_insert_rowid')) {
          if (!self.lastInsertTable) {
            return { id: 0 };
          }
          const lastId = self.autoIncrement[self.lastInsertTable] - 1;
          console.log(`  MockD1: last_insert_rowid() from ${self.lastInsertTable} = ${lastId}`);
          return { id: lastId };
        }
        
        // Handle other first queries
        const allResult = await this.all();
        return allResult.results[0] || null;
      }
    };
  }
}

class MockR2Bucket {
  constructor() {
    this.store = new Map();
  }

  async put(key, body, options) {
    const buffer = body instanceof Uint8Array ? body : new Uint8Array(body);
    this.store.set(key, {
      body: buffer,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
      size: buffer.byteLength
    });
    log(`  R2 PUT: ${key} (${buffer.byteLength} bytes)`, 'green');
  }

  async get(key, options) {
    const obj = this.store.get(key);
    if (!obj) return null;

    let data = obj.body;
    
    // Handle Range Request
    if (options?.range) {
      const { offset, length } = options.range;
      data = obj.body.slice(offset, offset + length);
    }

    return {
      body: data,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      customMetadata: obj.customMetadata
    };
  }

  async list(options) {
    const prefix = options?.prefix || '';
    const objects = [];
    
    for (const [key, value] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          size: value.size,
          uploaded: new Date()
        });
      }
    }
    
    return { objects };
  }
}

async function runTest() {
  logSection('🧪 Hot/Cold Architecture Integration Test');

  // Check compiled modules
  const distPath = path.join(__dirname, '../dist');
  if (!fs.existsSync(distPath)) {
    log('⚠️  Compiling TypeScript...', 'yellow');
    execSync('npx tsc --outDir dist', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  }

  // Import modules
  log('\n📦 Loading modules...', 'blue');
  const bufferConsumer = await import(path.join(distPath, 'buffer-consumer.js'));
  const cron = await import(path.join(distPath, 'cron.js'));
  const reader = await import(path.join(distPath, 'reader.js'));
  
  log('  ✅ buffer-consumer.js', 'green');
  log('  ✅ cron.js', 'green');
  log('  ✅ reader.js', 'green');

  // Setup mock environment
  const db = new MockD1Database();
  const r2 = new MockR2Bucket();
  const env = {
    BATTLE_INDEX_DB: db,
    BATTLE_DATA_BUCKET: r2
  };

  // Test 1: Buffer Consumer
  logSection('Test 1: Buffer Consumer (Hot Storage)');
  
  const testRecords = [
    { timestamp: Date.now(), api_no: 1, result: 'success', data: 'test1' },
    { timestamp: Date.now() + 1000, api_no: 2, result: 'success', data: 'test2' },
    { timestamp: Date.now() + 2000, api_no: 3, result: 'success', data: 'test3' }
  ];

  const testRecordsUser2 = [
    { timestamp: Date.now() + 500, api_no: 10, result: 'success', data: 'user2-test1' },
    { timestamp: Date.now() + 1500, api_no: 11, result: 'success', data: 'user2-test2' }
  ];

  const mockMessage = (id, body) => ({
    id,
    body,
    ack() { this._acked = true; },
    retry() { this._retried = true; },
    _isAcked() { return this._acked || false; }
  });

  const batch = {
    messages: [
      mockMessage('msg1', {
        dataset_id: 'test-user-001',
        table: 'battle',
        period_tag: '2025_12_23',
        records: testRecords,
        uploaded_by: 'test-user-001'
      }),
      mockMessage('msg2', {
        dataset_id: 'test-user-002',
        table: 'battle',
        period_tag: '2025_12_23',
        records: testRecordsUser2,
        uploaded_by: 'test-user-002'
      })
    ]
  };

  await bufferConsumer.default.queue(batch, env);
  
  log(`  📊 Buffer records: ${db.tables.buffer_logs.length}`, 'green');
  if (db.tables.buffer_logs.length !== 5) {
    throw new Error(`Expected 5 buffer records, got ${db.tables.buffer_logs.length}`);
  }
  log('  ✅ Buffer consumer test passed', 'green');

  // Test 2: Cron Archiver
  logSection('Test 2: Cron Archiver (Hot → Cold)');
  
  await cron.handleCron(env);
  
  log(`  📁 Archived files: ${db.tables.archived_files.length}`, 'green');
  log(`  📇 Block indexes: ${db.tables.block_indexes.length}`, 'green');
  log(`  🗑️  Buffer remaining: ${db.tables.buffer_logs.length}`, 'green');
  
  if (db.tables.archived_files.length === 0) {
    throw new Error('No files archived');
  }
  if (db.tables.block_indexes.length !== 2) {
    throw new Error(`Expected 2 block indexes (one per dataset_id), got ${db.tables.block_indexes.length}`);
  }
  if (db.tables.buffer_logs.length !== 0) {
    throw new Error('Buffer not cleaned up');
  }
  
  // Verify block indexes have different offsets
  const idx1 = db.tables.block_indexes[0];
  const idx2 = db.tables.block_indexes[1];
  log(`  📍 Block 1 (${idx1.dataset_id}): offset=${idx1.start_byte}, length=${idx1.length}`, 'green');
  log(`  📍 Block 2 (${idx2.dataset_id}): offset=${idx2.start_byte}, length=${idx2.length}`, 'green');
  
  if (idx1.start_byte === idx2.start_byte) {
    throw new Error('Block indexes have same offset - blocks not separated!');
  }
  if (idx2.start_byte !== idx1.start_byte + idx1.length) {
    throw new Error('Block 2 offset incorrect - should be Block 1 offset + length');
  }
  
  log('  ✅ Cron archiver test passed', 'green');

  // Test 3: Reader
  logSection('Test 3: Reader (Hot + Cold Merge)');
  
  // Add some new hot data
  const newBatch = {
    messages: [
      mockMessage('msg2', {
        dataset_id: 'test-user-001',
        table: 'battle',
        records: [
          { timestamp: Date.now() + 3000, api_no: 4, result: 'success', data: 'test4' }
        ],
        uploaded_by: 'test-user'
      })
    ]
  };
  await bufferConsumer.default.queue(newBatch, env);

  const mockRequest = new Request('http://localhost/v1/read?dataset_id=test-user-001&table_name=battle');
  const response = await reader.default.fetch(mockRequest, env);
  const result = await response.json();
  
  log(`  📊 Total records: ${result.record_count}`, 'green');
  log(`  🔥 Hot records: ${result.hot_count}`, 'green');
  log(`  ❄️  Cold records: ${result.cold_count}`, 'green');
  
  if (result.record_count !== 4) {
    throw new Error(`Expected 4 total records, got ${result.record_count}`);
  }
  if (result.hot_count !== 1) {
    throw new Error(`Expected 1 hot record, got ${result.hot_count}`);
  }
  if (result.cold_count !== 3) {
    throw new Error(`Expected 3 cold records, got ${result.cold_count}`);
  }
  
  log('  ✅ Reader test passed', 'green');

  // ============================================================
  logSection('Test 4: Verify NO _dataset_id Pollution');
  
  // Get the archived Avro file from R2
  const r2Obj = await env.BATTLE_DATA_BUCKET.get('battle/2025_12_23.avro');
  if (!r2Obj) {
    throw new Error('Avro file not found in R2');
  }
  
  const avroBuffer = new Uint8Array(await r2Obj.arrayBuffer());
  log(`  📂 R2 file size: ${avroBuffer.byteLength} bytes`, 'cyan');
  
  // Parse with parseNullAvroBlock
  const { parseNullAvroBlock, getAvroHeaderLength } = await import('../dist/avro-manual.js');
  const headerLength = getAvroHeaderLength(avroBuffer);
  const header = avroBuffer.subarray(0, headerLength);
  const body = avroBuffer.subarray(headerLength);
  
  const decodedRecords = parseNullAvroBlock(header, body);
  log(`  📊 Decoded records: ${decodedRecords.length}`, 'cyan');
  
  let pollutionFound = false;
  for (const record of decodedRecords) {
    if ('_dataset_id' in record) {
      log(`  ❌ POLLUTION: _dataset_id found in record: ${JSON.stringify(record)}`, 'red');
      pollutionFound = true;
    }
  }
  
  if (pollutionFound) {
    throw new Error('_dataset_id pollution detected in archived records');
  }
  
  log('  ✅ No _dataset_id pollution detected', 'green');
  log('  ✅ User data integrity verified', 'green');

  // Summary
  logSection('✅ All Tests Passed!');
  log('  🔥 Hot Storage: ✓', 'green');
  log('  ❄️  Cold Storage: ✓', 'green');
  log('  📦 Archival: ✓', 'green');
  log('  📖 Reader: ✓', 'green');
  log('  🔒 Data Integrity: ✓ (no pollution)', 'green');
  log('  🎯 Data Flow: Buffer → Archive → Read ✓', 'green');
}

// Run test
runTest().catch(err => {
  log(`\n❌ Test failed: ${err.message}`, 'red');
  console.error(err);
  process.exit(1);
});
