#!/usr/bin/env node
/**
 * General runner for KCS scripts in Node.js.
 *
 * Usage:
 *   node scripts/run.js                  -- runs output/deobfuscated.js
 *   node scripts/run.js --main           -- runs main.js
 *   node scripts/run.js --call <id>      -- load + call internal webpack module
 *   node scripts/run.js --repl           -- load + open interactive REPL
 */

const path = require('path');
const { ROOT, loadBundle } = require('../lib/loader');

const args = process.argv.slice(2);
const useMain = args.includes('--main');

const { kcsRequire, exports: KCS } = loadBundle({ useMain });
console.log('[runner] Script loaded successfully.');
if (KCS && typeof KCS === 'object') {
  console.log('[runner] Exported keys:', Object.keys(KCS).slice(0, 20));
}

// ── --call <moduleId> ──────────────────────────────────────────────
const callIdx = args.indexOf('--call');
if (callIdx >= 0 && args[callIdx + 1]) {
  const moduleId = parseInt(args[callIdx + 1], 10);
  console.log(`[runner] Requiring internal module ${moduleId} ...`);
  try {
    const mod = kcsRequire(moduleId);
    console.log('[runner] Module exports:', typeof mod);
    if (mod && typeof mod === 'object') {
      for (const key of Object.keys(mod)) {
        const v = mod[key];
        const t = typeof v;
        if (t === 'function') {
          console.log(`  .${key} [function ${v.name || 'anonymous'}]`);
        } else if (t === 'object' && v !== null) {
          console.log(`  .${key} [object, ${Object.keys(v).length} keys]`);
        } else {
          const s = JSON.stringify(v);
          console.log(`  .${key} [${t}] = ${s && s.length > 80 ? s.slice(0, 80) + '...' : s}`);
        }
      }
    }
  } catch (err) {
    console.error('[runner] Error loading module:', err.message);
  }
}

// ── --repl ─────────────────────────────────────────────────────────
if (args.includes('--repl')) {
  console.log('[runner] Starting REPL ...');
  console.log('  KCS            - module exports');
  console.log('  __kcs_require  - webpack internal require');
  console.log('');

  const repl = require('repl');
  const r = repl.start({ prompt: 'kcs> ' });
  r.context.KCS = KCS;
  r.context.__kcs_require = kcsRequire;
  try { r.context.App = kcsRequire(18622).default; } catch (_) {}
} else if (!(callIdx >= 0)) {
  if (KCS && typeof KCS.init === 'function') {
    console.log('[runner] Calling KCS.init() ...');
    Promise.resolve(KCS.init()).then(
      (r) => console.log('[runner] init() resolved:', r),
      (e) => console.error('[runner] init() rejected:', e.message)
    );
  }
}
