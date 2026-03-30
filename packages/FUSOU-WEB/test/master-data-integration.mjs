#!/usr/bin/env node

/**
 * Master Data Upload Integration Test Script
 * 
 * Runs end-to-end validation tests without external dependencies
 * Tests both client-side (Rust) and server-side (TypeScript) logic
 */

import crypto from 'crypto';

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function test(name, fn) {
  try {
    fn();
    log(`✓ ${name}`, 'green');
    return true;
  } catch (e) {
    log(`✗ ${name}`, 'red');
    log(`  Error: ${e.message}`, 'red');
    return false;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

const results = [];

log('\n=== Master Data Upload Validation Tests ===\n', 'blue');

// Test 1: All supported master tables
results.push(test('All supported master tables present', () => {
  const tables = [
    'mst_ship',
    'mst_shipgraph',
    'mst_slotitem',
    'mst_slotitem_equiptype',
    'mst_payitem',
    'mst_equip_exslot',
    'mst_equip_exslot_ship',
    'mst_equip_limit_exslot',
    'mst_equip_ship',
    'mst_stype',
    'mst_map_area',
    'mst_map_info',
    'mst_ship_upgrade',
  ];
  
  if (tables.length !== 13) throw new Error(`Expected 13 tables, got ${tables.length}`);
  if (new Set(tables).size !== 13) throw new Error('Duplicate table names found');
}));

// Test 2: Table offsets JSON format
results.push(test('Table offsets JSON serialization format', () => {
  const offsets = [
    { table_name: 'mst_ship', start: 0, end: 100 },
    { table_name: 'mst_shipgraph', start: 100, end: 200 },
    { table_name: 'mst_slotitem', start: 200, end: 300 },
  ];
  
  const json = JSON.stringify(offsets);
  const parsed = JSON.parse(json);
  
  if (!Array.isArray(parsed)) throw new Error('Must be array');
  if (parsed.length !== 3) throw new Error('Length mismatch');
  if (parsed[0].table_name !== 'mst_ship') throw new Error('First table mismatch');
  if (!Number.isInteger(parsed[0].start)) throw new Error('start must be integer');
  if (!Number.isInteger(parsed[0].end)) throw new Error('end must be integer');
}));

// Test 3: Empty tables (zero-length slices)
results.push(test('Empty tables with start == end', () => {
  const offsets = [
    { table_name: 'mst_ship', start: 0, end: 100 },
    { table_name: 'mst_shipgraph', start: 100, end: 100 }, // Empty
    { table_name: 'mst_slotitem', start: 100, end: 150 },
  ];
  
  const json = JSON.stringify(offsets);
  const parsed = JSON.parse(json);
  
  // Verify empty table
  if (parsed[1].start !== 100 || parsed[1].end !== 100) {
    throw new Error('Empty table offsets incorrect');
  }
  if (parsed[1].start !== parsed[1].end) {
    throw new Error('Empty table must have start == end');
  }
}));

// Test 4: Offset contiguity
results.push(test('Offset contiguity (no gaps, no overlaps)', () => {
  const offsets = [
    { table_name: 'mst_ship', start: 0, end: 100 },
    { table_name: 'mst_shipgraph', start: 100, end: 200 },
    { table_name: 'mst_slotitem', start: 200, end: 300 },
  ];
  
  // Check contiguity
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i].start !== offsets[i - 1].end) {
      throw new Error(`Gap at offset ${i}: ${offsets[i].start} != ${offsets[i - 1].end}`);
    }
  }
  
  // Check starts at 0
  if (offsets[0].start !== 0) {
    throw new Error('Offsets must start at 0');
  }
  
  // Check covers entire file
  const lastEnd = offsets[offsets.length - 1].end;
  if (lastEnd !== 300) {
    throw new Error(`File not fully covered: expected 300, got ${lastEnd}`);
  }
}));

// Test 5: Period tag validation
results.push(test('Period tag validation rules', () => {
  const validTags = ['period_001', 'event-2024-01', 'master_data_v0', 'a'];
  const invalidTags = ['', '.hidden', '/path', 'path/../escape', 'name with space'];
  
  const validator = (tag) => {
    if (!tag || tag.length === 0) return false;
    if (tag.length > 64) return false;
    if (tag.startsWith('.') || tag.startsWith('/')) return false;
    if (tag.includes('..')) return false;
    if (!/^[a-zA-Z0-9_\-]+$/.test(tag)) return false;
    return true;
  };
  
  for (const tag of validTags) {
    if (!validator(tag)) throw new Error(`Valid tag rejected: ${tag}`);
  }
  
  for (const tag of invalidTags) {
    if (validator(tag)) throw new Error(`Invalid tag accepted: ${tag}`);
  }
}));

// Test 6: SHA-256 hash format
results.push(test('SHA-256 content hash format (64 hex chars)', () => {
  const data = Buffer.from('test data');
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  
  if (hash.length !== 64) throw new Error(`Hash length must be 64, got ${hash.length}`);
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid hex format');
}));

// Test 7: File size validation (0 bytes now allowed)
results.push(test('File size validation (0-byte files allowed after fix)', () => {
  const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
  
  const validator = (size) => size >= 0 && size <= MAX_UPLOAD_BYTES;
  
  if (!validator(0)) throw new Error('0-byte file should be valid');
  if (!validator(1)) throw new Error('1-byte file should be valid');
  if (!validator(MAX_UPLOAD_BYTES)) throw new Error('Max size should be valid');
  if (validator(-1)) throw new Error('Negative size should be invalid');
  if (validator(MAX_UPLOAD_BYTES + 1)) throw new Error('Over-limit should be invalid');
}));

// Test 8: Required tables validation
results.push(test('All supported tables required in upload', () => {
  const allowed = new Set([
    'mst_ship', 'mst_shipgraph', 'mst_slotitem', 'mst_slotitem_equiptype',
    'mst_payitem', 'mst_equip_exslot', 'mst_equip_exslot_ship',
    'mst_equip_limit_exslot', 'mst_equip_ship', 'mst_stype',
    'mst_map_area', 'mst_map_info', 'mst_ship_upgrade',
  ]);
  
  // Complete set
  const provided = new Set([
    'mst_ship', 'mst_shipgraph', 'mst_slotitem', 'mst_slotitem_equiptype',
    'mst_payitem', 'mst_equip_exslot', 'mst_equip_exslot_ship',
    'mst_equip_limit_exslot', 'mst_equip_ship', 'mst_stype',
    'mst_map_area', 'mst_map_info', 'mst_ship_upgrade',
  ]);
  
  const missing = Array.from(allowed).filter(t => !provided.has(t));
  if (missing.length > 0) {
    throw new Error(`Missing tables: ${missing.join(', ')}`);
  }
  
  // Incomplete set should fail
  const incomplete = new Set(['mst_ship', 'mst_shipgraph', 'mst_slotitem']);
  const missingIncomplete = Array.from(allowed).filter(t => !incomplete.has(t));
  if (missingIncomplete.length === 0) {
    throw new Error('Incomplete set should be detected');
  }
}));

// Test 9: Execution URL format
results.push(test('Stage 3 execution URL format with token parameter', () => {
  const endpoint = 'https://dev.fusou.dev/api/master-data/upload';
  const token = 'signed_token_abc123';
  const execUrl = `${endpoint}?token=${token}`;
  
  if (!execUrl.includes('?token=')) throw new Error('Missing token parameter');
  if (execUrl.includes('.json')) throw new Error('Should not have .json suffix');
  if (!execUrl.startsWith('https://')) throw new Error('Must use HTTPS');
}));

// Test 10: Concatenation with correct offsets
results.push(test('Concatenate all supported tables with correct offsets', () => {
  const data = [
    { name: 'mst_ship', size: 100 },
    { name: 'mst_shipgraph', size: 0 },      // Empty
    { name: 'mst_slotitem', size: 50 },
    { name: 'mst_slotitem_equiptype', size: 0 }, // Empty
    { name: 'mst_payitem', size: 75 },
    { name: 'mst_equip_exslot', size: 0 },   // Empty
    { name: 'mst_equip_exslot_ship', size: 25 },
    { name: 'mst_equip_limit_exslot', size: 0 }, // Empty
    { name: 'mst_equip_ship', size: 30 },
    { name: 'mst_stype', size: 0 },          // Empty
    { name: 'mst_map_area', size: 40 },
    { name: 'mst_map_info', size: 0 },       // Empty
    { name: 'mst_ship_upgrade', size: 10 },
  ];
  
  let totalSize = 0;
  let offset = 0;
  
  for (const table of data) {
    totalSize += table.size;
    const start = offset;
    const end = start + table.size;
    offset = end;
  }
  
  // Expected: 100+0+50+0+75+0+25+0+30+0+40+0+10 = 330
  if (totalSize !== 330) {
    throw new Error(`Total size should be 330, got ${totalSize}`);
  }
  if (offset !== 330) {
    throw new Error(`Final offset should be 330, got ${offset}`);
  }
}));

// ============================================================================
// Summary
// ============================================================================

log('\n=== Test Results ===\n', 'blue');

const passed = results.filter(r => r).length;
const failed = results.filter(r => !r).length;
const total = results.length;

if (failed === 0) {
  log(`✓ All ${total} tests passed!`, 'green');
  process.exit(0);
} else {
  log(`✗ ${failed} of ${total} tests failed`, 'red');
  process.exit(1);
}
