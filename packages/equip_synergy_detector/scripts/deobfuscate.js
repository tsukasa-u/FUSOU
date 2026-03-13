#!/usr/bin/env node
/**
 * Deobfuscate main.js using webcrack.
 *
 * Usage:
 *   node scripts/deobfuscate.js [--input <path>] [--output <path>]
 *
 * Default input:  main.js
 * Default output: output/deobfuscated.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function getArg(name, fallback) {
  const idx = args.indexOf(name);
  return (idx >= 0 && args[idx + 1]) ? args[idx + 1] : fallback;
}

const inputPath = path.resolve(ROOT, getArg('--input', 'main.js'));
const outputPath = path.resolve(ROOT, getArg('--output', 'output/deobfuscated.js'));

if (!fs.existsSync(inputPath)) {
  console.error(`Error: input file not found: ${inputPath}`);
  process.exit(1);
}

async function main() {
  let webcrack;
  try {
    webcrack = (await import('webcrack')).default;
  } catch {
    console.error('Error: webcrack is not installed. Run: pnpm add -D webcrack');
    process.exit(1);
  }

  console.log(`[deobfuscate] Input:  ${path.relative(ROOT, inputPath)}`);
  console.log(`[deobfuscate] Output: ${path.relative(ROOT, outputPath)}`);

  const code = fs.readFileSync(inputPath, 'utf-8');
  console.log(`[deobfuscate] Input size: ${(Buffer.byteLength(code) / 1024 / 1024).toFixed(1)} MB`);

  console.log('[deobfuscate] Running webcrack ...');
  const t0 = Date.now();
  const result = await webcrack(code);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[deobfuscate] Done in ${elapsed}s`);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, result.code, 'utf-8');

  const outSize = (Buffer.byteLength(result.code) / 1024 / 1024).toFixed(1);
  console.log(`[deobfuscate] Output size: ${outSize} MB → ${path.relative(ROOT, outputPath)}`);
}

main().catch(err => {
  console.error('[deobfuscate] Error:', err.message);
  process.exit(1);
});
