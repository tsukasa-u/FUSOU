#!/usr/bin/env node
/**
 * Orchestrator: scan → upload
 *
 * Usage:
 *   pnpm scan:upload -- --period-tag 2026-04-07
 *   pnpm scan:upload:dry -- --period-tag 2026-04-07
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const args = process.argv.slice(2);

const periodTagIdx = args.indexOf('--period-tag');
const periodTag = periodTagIdx >= 0 ? args[periodTagIdx + 1] : null;
const isDryRun = args.includes('--dry-run');
const envIdx = args.indexOf('--env');
const env = envIdx >= 0 ? args[envIdx + 1] : 'production';

if (!periodTag) {
  console.error('Error: --period-tag YYYY-MM-DD is required.');
  console.error('  e.g. pnpm scan:upload -- --period-tag 2026-04-07');
  process.exit(1);
}

// Step 1: scan
console.log(`[1/2] Scanning with period-tag=${periodTag}...`);
const scanResult = spawnSync(
  process.execPath,
  [join(__dirname, 'scan.js'), '--volatile-generated', '--period-tag', periodTag],
  { stdio: 'inherit', cwd: root }
);
if (scanResult.status !== 0) process.exit(scanResult.status ?? 1);

// Step 2: upload
console.log(`[2/2] Uploading (env=${env}${isDryRun ? ', dry-run' : ''})...`);
const uploadArgs = [
  join(root, '..', 'FUSOU-WEB', 'scripts', 'upload-synergy.mjs'),
  '--env', env,
  '--period-tag', periodTag,
];
if (isDryRun) uploadArgs.push('--dry-run');

const uploadResult = spawnSync(process.execPath, uploadArgs, {
  stdio: 'inherit',
  cwd: root,
});
process.exit(uploadResult.status ?? 0);
