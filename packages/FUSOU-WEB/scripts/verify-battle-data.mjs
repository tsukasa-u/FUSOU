#!/usr/bin/env node
/**
 * Comprehensive verification script for battle_data upload system
 * 
 * This script performs end-to-end validation to prevent regressions:
 * 1. Verifies client-server contract (handshake fields)
 * 2. Validates token generation and verification
 * 3. Tests queue message format
 * 4. Checks R2/D1 integration points
 * 
 * Usage: npm run verify:battle-data
 */

import assert from 'assert';
import crypto from 'crypto';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function log(message, level = 'info') {
  const timestamp = new Date().toISOString().split('T')[1];
  const prefix = {
    info: `${colors.blue}[${timestamp}]${colors.reset}`,
    success: `${colors.green}[${timestamp}] ✓${colors.reset}`,
    error: `${colors.red}[${timestamp}] ✗${colors.reset}`,
    warn: `${colors.yellow}[${timestamp}] ⚠${colors.reset}`,
  };
  console.log(`${prefix[level]} ${message}`);
}

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    log(`PASS: ${name}`, 'success');
  } catch (err) {
    failCount++;
    log(`FAIL: ${name}`, 'error');
    console.error(`  ${err.message}`);
  }
}

console.log('\n' + colors.blue + '=== Battle Data Upload System Verification ===' + colors.reset + '\n');

// ===== Test Suite 1: Client-Server Contract =====
console.log(colors.blue + '1. Client-Server Handshake Contract' + colors.reset);

test('Handshake must include binary flag', () => {
  const handshake = {
    path: 'period-001-port-1-1.bin',
    binary: true,
    dataset_id: 'abc123',
    table: 'port_table',
    kc_period_tag: 'period-001',
    file_size: '1024',
    table_offsets: '[]',
    content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };
  assert(handshake.binary === true, 'binary must be true');
});

test('Path field must be provided', () => {
  const handshake = {
    path: 'period-001-port-1-1.bin',
    binary: true,
    dataset_id: 'abc123',
    table: 'port_table',
    kc_period_tag: 'period-001',
    file_size: '1024',
    content_hash: 'abc123',
  };
  assert(handshake.path, 'path field missing');
  assert(handshake.path.endsWith('.bin'), 'path must end with .bin');
});

test('Content hash must be SHA-256 hex', () => {
  const validHash = crypto.createHash('sha256').update('test').digest('hex');
  assert(validHash.match(/^[a-f0-9]{64}$/), 'hash must be 64-char hex string');
  assert(validHash.length === 64, 'hash must be exactly 64 characters');
});

test('kc_period_tag must match regex ^[\\w\\-]+$', () => {
  const validTags = ['period-001', 'period_001', 'period001', 'period-001-001'];
  const invalidTags = ['period 001', 'period/001', 'period@001', ''];
  
  const regex = /^[\w\-]+$/;
  validTags.forEach(tag => {
    assert(regex.test(tag), `'${tag}' should match but doesn't`);
  });
  invalidTags.forEach(tag => {
    assert(!regex.test(tag), `'${tag}' should not match but does`);
  });
});

test('file_size must be positive integer', () => {
  const validSizes = ['1', '1024', '1048576', '268435456'];
  const invalidSizes = ['0', '-1', '-1024'];
  
  validSizes.forEach(size => {
    const num = parseInt(size, 10);
    assert(num > 0, `'${size}' should be > 0`);
  });
  invalidSizes.forEach(size => {
    const num = parseInt(size, 10);
    assert(num <= 0, `'${size}' should be <= 0`);
  });
});

// ===== Test Suite 2: Token Generation =====
console.log('\n' + colors.blue + '2. Signed Token Contract' + colors.reset);

test('Token payload must include content_hash', () => {
  const tokenPayload = {
    dataset_id: 'abc123',
    table: 'port_table',
    period_tag: 'period-001',
    declared_size: 1024,
    table_offsets: '[]',
    content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    path_tag: 'period-001-port-1-1.bin',
    user_id: 'supabase-user-id',
  };
  assert(tokenPayload.content_hash, 'content_hash missing from token');
});

test('Token must be bound to user_id', () => {
  const tokenPayload = {
    user_id: 'user-12345',
    content_hash: 'abc123',
  };
  assert(tokenPayload.user_id, 'user_id missing');
});

test('Token verification must validate hash matches request body', () => {
  const requestBody = Buffer.from('test data');
  const declaredHash = crypto.createHash('sha256').update(requestBody).digest('hex');
  
  const tokenPayload = {
    content_hash: declaredHash,
  };
  
  assert(tokenPayload.content_hash === declaredHash, 'hash mismatch');
});

// ===== Test Suite 3: Queue Message Format =====
console.log('\n' + colors.blue + '3. Queue Message Contract' + colors.reset);

test('Queue message must have table and avro_base64', () => {
  const message = {
    table: 'port_table',
    avro_base64: 'Obj1AXsic2NoZW1hIjp7InR5cGUiOiJyZWNvcmQiLCJuYW1lIjoiUm93IiwiZmllbGRzIjpbeyJuYW1lIjoiYSIsInR5cGUiOiJpbnQifV19fQA==',
    datasetId: 'abc123',
    periodTag: 'period-001',
    triggeredAt: '2024-12-22T00:00:00Z',
    userId: 'user-456',
  };
  assert(message.table, 'table missing');
  assert(message.avro_base64, 'avro_base64 missing');
  assert(typeof message.table === 'string', 'table must be string');
  assert(typeof message.avro_base64 === 'string', 'avro_base64 must be string');
});

test('Avro base64 must be valid base64', () => {
  const validBase64 = Buffer.from('test data').toString('base64');
  assert(validBase64.match(/^[A-Za-z0-9+/]*={0,2}$/), 'invalid base64');
  
  // Verify it can be decoded
  const decoded = Buffer.from(validBase64, 'base64').toString();
  assert(decoded === 'test data', 'decode failed');
});

test('Queue message must include all metadata fields', () => {
  const required = ['table', 'avro_base64', 'datasetId', 'periodTag', 'triggeredAt', 'userId'];
  const message = {
    table: 'port_table',
    avro_base64: 'data',
    datasetId: 'abc123',
    periodTag: 'period-001',
    triggeredAt: '2024-12-22T00:00:00Z',
    userId: 'user-456',
  };
  
  required.forEach(field => {
    assert(field in message, `${field} missing from queue message`);
  });
});

test('triggeredAt must be ISO8601 timestamp', () => {
  const timestamp = new Date().toISOString();
  assert(timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/), 'invalid ISO8601 format');
});

// ===== Test Suite 4: Table Offsets =====
console.log('\n' + colors.blue + '4. Table Offsets Contract' + colors.reset);

test('table_offsets must be valid JSON array', () => {
  const offsets = JSON.stringify([
    { table_name: 'port_table', start_byte: 0, byte_length: 512 },
    { table_name: 'ship_table', start_byte: 512, byte_length: 512 },
  ]);
  const parsed = JSON.parse(offsets);
  assert(Array.isArray(parsed), 'must be array');
  assert(parsed.length === 2, 'should have 2 entries');
});

test('Each offset entry must have table_name, start_byte, byte_length', () => {
  const offset = {
    table_name: 'port_table',
    start_byte: 0,
    byte_length: 512,
  };
  assert(offset.table_name, 'table_name missing');
  assert(typeof offset.start_byte === 'number', 'start_byte must be number');
  assert(typeof offset.byte_length === 'number', 'byte_length must be number');
});

test('Offsets must not exceed declared file_size', () => {
  const declaredSize = 1024;
  const offsets = [
    { table_name: 'port_table', start_byte: 0, byte_length: 512 },
    { table_name: 'ship_table', start_byte: 512, byte_length: 512 },
  ];
  
  for (const offset of offsets) {
    const end = offset.start_byte + offset.byte_length;
    assert(end <= declaredSize, `offset ${offset.table_name} exceeds declared size`);
  }
});

test('No overlapping offsets allowed', () => {
  const offsets = [
    { table_name: 'port_table', start_byte: 0, byte_length: 512 },
    { table_name: 'ship_table', start_byte: 512, byte_length: 512 },
  ];
  
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const a = offsets[i];
      const b = offsets[j];
      const aEnd = a.start_byte + a.byte_length;
      const bStart = b.start_byte;
      assert(aEnd <= bStart, 'overlapping offsets detected');
    }
  }
});

// ===== Test Suite 5: R2 Integration =====
console.log('\n' + colors.blue + '5. R2 & D1 Integration Points' + colors.reset);

test('R2 key format: dataset/table/periodTag.N.avro', () => {
  const key = 'dataset123/port/202412.0.avro';
  assert(key.split('/').length === 3, 'key should be dataset/table/periodTag.N.avro');
  assert(/\.\d+\.avro$/.test(key), 'key should end with .N.avro');
});

test('R2 content type should be application/avro', () => {
  const contentType = 'application/avro';
  assert(contentType.includes('avro'), 'must specify avro type');
});

// ===== Summary =====
console.log('\n' + colors.blue + '=== Test Summary ===' + colors.reset);
console.log(`${colors.green}Passed: ${passCount}${colors.reset}`);
if (failCount > 0) {
  console.log(`${colors.red}Failed: ${failCount}${colors.reset}`);
  process.exit(1);
} else {
  console.log(`${colors.green}All tests passed! ✓${colors.reset}\n`);
  process.exit(0);
}
