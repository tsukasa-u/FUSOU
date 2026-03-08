#!/usr/bin/env node
/**
 * Simplified Hot/Cold Architecture Test
 * Focuses on testing component logic without complex mocking
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = (msg, level = 'info') => {
  const colors = { info: '\x1b[34m', success: '\x1b[32m', error: '\x1b[31m' };
  console.log(`${colors[level] || ''}${msg}\x1b[0m`);
};

async function testCompilation() {
  console.log('\n='.repeat(60));
  log('🔨 Test: TypeScript Compilation', 'info');
  console.log('='.repeat(60));
  
  const distPath = path.join(__dirname, '../dist');
  log('Compiling TypeScript...', 'info');
  execSync('npx tsc --outDir dist', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  
  const { default: fs } = await import('fs');
  const files = ['buffer-consumer.js', 'cron.js', 'reader.js', 'avro-manual.js', 'utils/compression.js'];
  
  for (const file of files) {
    const filePath = path.join(distPath, file);
    if (fs.existsSync(filePath)) {
      log(`  ✅ ${file}`, 'success');
    } else {
      throw new Error(`Missing: ${file}`);
    }
  }
  
  log('✅ Compilation test passed', 'success');
}

async function testModuleImports() {
  console.log('\n='.repeat(60));
  log('📦 Test: ES Module Imports', 'info');
  console.log('='.repeat(60));
  
  const distPath = path.join(__dirname, '../dist');
  
  try {
    const bufferConsumer = await import(path.join(distPath, 'buffer-consumer.js'));
    log('  ✅ buffer-consumer.js imported', 'success');
    
    const cron = await import(path.join(distPath, 'cron.js'));
    log('  ✅ cron.js imported', 'success');
    
    const reader = await import(path.join(distPath, 'reader.js'));
    log('  ✅ reader.js imported', 'success');
    
    const avroManual = await import(path.join(distPath, 'avro-manual.js'));
    log('  ✅ avro-manual.js imported', 'success');
    
    log('✅ Module imports test passed', 'success');
    return { bufferConsumer, cron, reader, avroManual };
  } catch (err) {
    log(`❌ Import failed: ${err.message}`, 'error');
    throw err;
  }
}

async function testAvroGeneration(modules) {
  console.log('\n='.repeat(60));
  log('🔧 Test: Avro Container Generation', 'info');
  console.log('='.repeat(60));
  
  const { avroManual } = modules;
  const testRecords = [
    { timestamp: Date.now(), api_no: 1, result: 'S', data: 'test1' },
    { timestamp: Date.now() + 1000, api_no: 2, result: 'A', data: 'test2' },
    { timestamp: Date.now() + 2000, api_no: 3, result: 'B', data: 'test3' }
  ];
  
  try {
    const container = avroManual.buildAvroContainer(testRecords);
    log(`  📦 Generated Avro container: ${container.byteLength} bytes`, 'success');
    
    const headerLength = avroManual.getAvroHeaderLength(container);
    log(`  📄 Header length: ${headerLength} bytes`, 'success');
    
    const dataBlock = container.slice(headerLength);
    log(`  📊 Data block: ${dataBlock.byteLength} bytes`, 'success');
    
    log('✅ Avro generation test passed', 'success');
    return { container, headerLength };
  } catch (err) {
    log(`❌ Avro generation failed: ${err.message}`, 'error');
    throw err;
  }
}

async function runTests() {
  try {
    console.log('\n' + '='.repeat(60));
    log('🧪 Hot/Cold Architecture - Simplified Test Suite', 'info');
    console.log('='.repeat(60));
    
    await testCompilation();
    const modules = await testModuleImports();
    await testAvroGeneration(modules);
    
    console.log('\n' + '='.repeat(60));
    log('✅ All Tests Passed!', 'success');
    console.log('='.repeat(60));
    log('\n📋 Component Status:', 'info');
    log('  🔥 Buffer Consumer: ✓ Compiled', 'success');
    log('  ❄️  Archiver: ✓ Compiled', 'success');
    log('  📖 Reader: ✓ Compiled', 'success');
    log('  🔧 Avro Manual: ✓ Working', 'success');
    log('  📦 Compression: ✓ Available', 'success');
    
    log('\n🎯 Next: Apply D1 schema and test with wrangler dev', 'info');
    log('  Command: npx wrangler d1 execute dev_kc_battle_index --local --file=../../docs/sql/d1/hot-cold-schema.sql', 'info');
    
  } catch (err) {
    log(`\n❌ Test suite failed: ${err.message}`, 'error');
    console.error(err);
    process.exit(1);
  }
}

runTests();
