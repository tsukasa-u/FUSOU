/**
 * Shared loader for KCS webpack bundle.
 * Sets up browser environment, stubs, require interception, and webpack capture.
 *
 * Usage:
 *   const { loadBundle } = require('./loader');
 *   const { kcsRequire, kcsCache } = loadBundle({
 *     useMain: false,         // true = main.js, false = output/deobfuscated.js
 *     getMst: fn,             // optional: mock getMst function for App singleton
 *   });
 */

const path = require('path');
const Module = require('module');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

/**
 * Resolve the game script path.
 */
function resolveScript(useMain) {
  return useMain
    ? path.join(ROOT, 'main.js')
    : path.join(ROOT, 'output', 'deobfuscated.js');
}

/**
 * Find the first master data file in master_data/.
 * Returns the path or null.
 */
function findMasterData() {
  const dir = path.join(ROOT, 'master_data');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.includes('api_start2'))
    .sort()
    .reverse(); // newest first
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

/**
 * Parse a KanColle API response file (svdata= prefix format).
 * Returns the parsed api_data object.
 */
function parseMasterData(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let jsonStr;
  for (const line of raw.split('\n')) {
    if (line.startsWith('svdata=')) { jsonStr = line.slice(7); break; }
  }
  if (!jsonStr) throw new Error('No svdata= line found in: ' + filePath);
  return JSON.parse(jsonStr).api_data;
}

/**
 * Build a mstDict from api_mst_slotitem entries for the getMst mock.
 */
function buildMstDict(mstSlotitems) {
  const dict = {};
  for (const si of mstSlotitems) {
    dict[si.api_id] = {
      mstID:     si.api_id,
      name:      si.api_name || '',
      equipType: (si.api_type && si.api_type[2]) || 0,
      cardType:  (si.api_type && si.api_type[1]) || 0,
      iconType:  (si.api_type && si.api_type[3]) || 0,
      sakuteki:  si.api_saku || 0,
      meichu:    si.api_houm || 0,
      taiku:     si.api_tyku || 0,
      karyoku:   si.api_houg || 0,
      raisou:    si.api_raig || 0,
      taisen:    si.api_tais || 0,
      bakusou:   si.api_baku || 0,
      soukou:    si.api_souk || 0,
      kaihi:     si.api_houk || 0
    };
  }
  return dict;
}

/**
 * Create a getMst function from a mstDict.
 */
function createGetMst(mstDict) {
  return function (id) {
    const numId = typeof id === 'string' ? parseInt(id, 10) : id;
    return mstDict[numId] || {
      mstID: numId, name: '', equipType: 0, cardType: 0, iconType: 0,
      sakuteki: 0, meichu: 0, taiku: 0, karyoku: 0, raisou: 0,
      taisen: 0, bakusou: 0, soukou: 0, kaihi: 0
    };
  };
}

/**
 * Set up browser environment and global stubs.
 */
function setupEnvironment() {
  const { createBrowserEnv } = require('./stubs/browser-shim');
  const { dom, window, document } = createBrowserEnv();

  globalThis.self      = window;
  globalThis.window    = window;
  globalThis.document  = document;
  globalThis.navigator = window.navigator;

  const timers = require('timers');
  globalThis.setTimeout    = timers.setTimeout;
  globalThis.setInterval   = timers.setInterval;
  globalThis.clearTimeout  = timers.clearTimeout;
  globalThis.clearInterval = timers.clearInterval;

  globalThis.PIXI      = require('./stubs/pixi-stub');
  globalThis.createjs   = require('./stubs/createjs-stub');

  return { dom, window, document };
}

/**
 * Set up require interception for "window" and "axios".
 */
function setupRequireIntercept(window) {
  const axiosStubPath = require.resolve('./stubs/axios-stub');
  const windowShimPath = path.join(__dirname, '_window-shim.js');
  fs.writeFileSync(windowShimPath, 'module.exports = global.__kcs_window__;');
  global.__kcs_window__ = window;

  const origRes = Module._resolveFilename;
  Module._resolveFilename = function (req, parent, isMain, opts) {
    if (req === 'window') return windowShimPath;
    if (req === 'axios') return axiosStubPath;
    return origRes.call(this, req, parent, isMain, opts);
  };
}

/**
 * Load the webpack bundle and capture the internal require function.
 *
 * @param {object} opts
 * @param {boolean} [opts.useMain=false]  Use main.js instead of deobfuscated.js
 * @param {function} [opts.getMst]        Mock getMst for App singleton (module 18622)
 * @param {boolean} [opts.silent=false]   Suppress log output
 * @returns {{ kcsRequire: function, kcsCache: object, exports: any }}
 */
function loadBundle(opts = {}) {
  const { useMain = false, getMst, silent = false } = opts;
  const log = silent ? () => {} : console.log.bind(console);

  const targetScript = resolveScript(useMain);
  if (!fs.existsSync(targetScript)) {
    throw new Error('Target script not found: ' + targetScript);
  }
  log(`[loader] Using: ${path.relative(ROOT, targetScript)}`);

  // Set up environment
  const { window } = setupEnvironment();
  setupRequireIntercept(window);

  // Expose getMst if provided
  if (getMst) {
    global.__kcs_getMst = getMst;
  }

  // Intercept _compile to capture webpack internals + inject mock App
  const origCompile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (filename === targetScript) {
      const match = content.match(/(\w+)(?:\.g|\['g'\])\s*=\s*\(?function\s*\(\)\s*\{[^}]*globalThis/);
      if (match) {
        const reqFn = match[1];
        const cacheRe = new RegExp(`(?:var\\s+)?(\\w+)\\s*=\\s*\\{\\};\\s*function\\s+${reqFn}\\b`);
        const cm = content.match(cacheRe) || content.match(new RegExp(`(\\w+)\\s*=\\s*\\{\\}\\s*;\\s*function\\s+${reqFn}\\b`));

        let inj = `global.__kcs_require = ${reqFn};\n`;
        if (cm) {
          const cacheName = cm[1];
          inj += `global.__kcs_cache = ${cacheName};\n`;
          if (getMst) {
            inj += `${cacheName}[18622] = { exports: { default: { model: { slot: { getMst: global.__kcs_getMst } } }, __esModule: true } };\n`;
          }
        }
        content = content.slice(0, match.index) + inj + content.slice(match.index);
      }
      Module.prototype._compile = origCompile;
    }
    return origCompile.call(this, content, filename);
  };

  // Load the script
  log('[loader] Loading game script ...');
  const exports = require(targetScript);

  if (!global.__kcs_require) {
    throw new Error('Failed to capture webpack require function');
  }

  return {
    kcsRequire: global.__kcs_require,
    kcsCache: global.__kcs_cache || {},
    exports
  };
}

module.exports = {
  ROOT,
  resolveScript,
  findMasterData,
  parseMasterData,
  buildMstDict,
  createGetMst,
  loadBundle,
};
