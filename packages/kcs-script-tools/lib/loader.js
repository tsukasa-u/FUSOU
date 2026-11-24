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

const path = require("path");
const Module = require("module");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const PROXY_DATA_DIR = path.resolve(ROOT, "..", "FUSOU-PROXY-DATA");
const PERIOD_TAG_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Find the latest YYYY-MM-DD period tag directory in FUSOU-PROXY-DATA.
 * Returns the tag string or null.
 */
function findLatestPeriodTag() {
  if (!fs.existsSync(PROXY_DATA_DIR)) return null;
  const tags = fs
    .readdirSync(PROXY_DATA_DIR)
    .filter((name) => {
      if (!PERIOD_TAG_RE.test(name)) return false;
      try {
        return fs.statSync(path.join(PROXY_DATA_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
  return tags.length > 0 ? tags[0] : null;
}

/**
 * Resolve the effective period tag (explicit tag or latest in FUSOU-PROXY-DATA).
 */
function resolvePeriodTag(periodTag = null) {
  return periodTag || findLatestPeriodTag();
}

/**
 * Resolve the game script path.
 * For useMain=true, prefers FUSOU-PROXY-DATA/<periodTag>/kcs2/js/main.js.
 */
function resolveScript(useMain, periodTag = null) {
  if (periodTag) {
    return useMain
      ? path.join(PROXY_DATA_DIR, periodTag, "kcs2", "js", "main.js")
      : path.join(ROOT, "output", `deobfuscated_${periodTag}.js`);
  }
  if (useMain) {
    const latestTag = findLatestPeriodTag();
    if (latestTag) {
      const proxyMain = path.join(PROXY_DATA_DIR, latestTag, "kcs2", "js", "main.js");
      if (fs.existsSync(proxyMain)) return proxyMain;
    }
    return path.join(ROOT, "main.js");
  }
  return path.join(ROOT, "output", "deobfuscated.js");
}

/**
 * Parse a KanColle API response file (svdata= prefix format).
 * Returns the parsed api_data object.
 */
function parseMasterData(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  let jsonStr;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("svdata=")) {
      jsonStr = line.slice(7);
      break;
    }
  }
  if (!jsonStr) throw new Error("No svdata= line found in: " + filePath);
  const parsed = JSON.parse(jsonStr);
  if (
    !parsed ||
    !parsed.api_data ||
    !Array.isArray(parsed.api_data.api_mst_ship) ||
    !Array.isArray(parsed.api_data.api_mst_slotitem)
  ) {
    throw new Error(
      "Invalid api_start2/getData payload (missing api_mst_ship/api_mst_slotitem) in: " +
        filePath,
    );
  }
  return parsed.api_data;
}

/**
 * Check whether a file is a valid api_start2/getData response with svdata=.
 */
function isValidMasterDataFile(filePath) {
  try {
    parseMasterData(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the newest valid api_start2/getData response file in a directory.
 * Strictly requires response files (S@api_start2@getData) so request files (Q@)
 * and unrelated endpoints (e.g. get_option_setting) are never selected.
 */
function findMasterDataInDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .flatMap((name) => {
      if (!name.includes("S@api_start2@getData")) return [];
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) return [];
        return [{ fullPath, mtimeMs: stat.mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of candidates) {
    if (isValidMasterDataFile(item.fullPath)) {
      return item.fullPath;
    }
  }
  return null;
}

/**
 * Find the latest valid master data file (S@api_start2@getData) from FUSOU-PROXY-DATA.
 * When periodTag is specified, searches only FUSOU-PROXY-DATA/<periodTag>/kcsapi.
 * When periodTag is omitted, searches the latest period tag in FUSOU-PROXY-DATA.
 * Returns the path or null.
 */
function findMasterData(periodTag = null) {
  const effectiveTag = resolvePeriodTag(periodTag);
  if (!effectiveTag) return null;
  const kcsapiDir = path.join(PROXY_DATA_DIR, effectiveTag, "kcsapi");
  return findMasterDataInDir(kcsapiDir);
}

/**
 * Validate required inputs in FUSOU-PROXY-DATA before running heavy steps
 * (deobfuscate, extract-ast, scan-ast).
 * Throws an Error detailing all missing files when validation fails.
 */
function validatePeriodInputs(periodTag = null) {
  const effectiveTag = resolvePeriodTag(periodTag);
  if (!effectiveTag) {
    throw new Error(`No YYYY-MM-DD period directory found in: ${PROXY_DATA_DIR}`);
  }
  const periodDir = path.join(PROXY_DATA_DIR, effectiveTag);
  const mainJsPath = path.join(periodDir, "kcs2", "js", "main.js");
  const kcsapiDir = path.join(periodDir, "kcsapi");
  const masterPath = findMasterDataInDir(kcsapiDir);

  const missing = [];
  if (!fs.existsSync(periodDir)) {
    missing.push(`Period directory not found: ${periodDir}`);
  } else {
    if (!fs.existsSync(mainJsPath)) {
      missing.push(`Game script not found: ${mainJsPath}`);
    }
    if (!fs.existsSync(kcsapiDir)) {
      missing.push(`kcsapi directory not found: ${kcsapiDir}`);
    } else if (!masterPath) {
      missing.push(
        `No valid *S@api_start2@getData* response file (with svdata= and api_mst_ship/api_mst_slotitem) found in: ${kcsapiDir}`,
      );
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Preflight check failed for period_tag ${effectiveTag}:\n  - ${missing.join("\n  - ")}`,
    );
  }

  return {
    periodTag: effectiveTag,
    mainJsPath,
    masterPath,
  };
}

/**
 * Build a mstDict from api_mst_slotitem entries for the getMst mock.
 */
function buildMstDict(mstSlotitems) {
  const dict = {};
  for (const si of mstSlotitems) {
    dict[si.api_id] = {
      mstID: si.api_id,
      name: si.api_name || "",
      equipType: (si.api_type && si.api_type[2]) || 0,
      cardType: (si.api_type && si.api_type[1]) || 0,
      iconType: (si.api_type && si.api_type[3]) || 0,
      sakuteki: si.api_saku || 0,
      meichu: si.api_houm || 0,
      taiku: si.api_tyku || 0,
      karyoku: si.api_houg || 0,
      raisou: si.api_raig || 0,
      taisen: si.api_tais || 0,
      bakusou: si.api_baku || 0,
      soukou: si.api_souk || 0,
      kaihi: si.api_houk || 0,
    };
  }
  return dict;
}

/**
 * Create a getMst function from a mstDict.
 */
function createGetMst(mstDict) {
  return function (id) {
    const numId = typeof id === "string" ? parseInt(id, 10) : id;
    return (
      mstDict[numId] || {
        mstID: numId,
        name: "",
        equipType: 0,
        cardType: 0,
        iconType: 0,
        sakuteki: 0,
        meichu: 0,
        taiku: 0,
        karyoku: 0,
        raisou: 0,
        taisen: 0,
        bakusou: 0,
        soukou: 0,
        kaihi: 0,
      }
    );
  };
}

/**
 * Set up browser environment and global stubs.
 */
function setupEnvironment() {
  const { createBrowserEnv } = require("./stubs/browser-shim");
  const { dom, window, document } = createBrowserEnv();

  globalThis.self = window;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.navigator = window.navigator;

  const timers = require("timers");
  globalThis.setTimeout = timers.setTimeout;
  globalThis.setInterval = timers.setInterval;
  globalThis.clearTimeout = timers.clearTimeout;
  globalThis.clearInterval = timers.clearInterval;

  globalThis.PIXI = require("./stubs/pixi-stub");
  globalThis.createjs = require("./stubs/createjs-stub");

  return { dom, window, document };
}

/**
 * Set up require interception for "window" and "axios".
 */
function setupRequireIntercept(window) {
  const axiosStubPath = require.resolve("./stubs/axios-stub");
  const windowShimPath = path.join(__dirname, "_window-shim.js");
  fs.writeFileSync(windowShimPath, "module.exports = global.__kcs_window__;");
  global.__kcs_window__ = window;

  const origRes = Module._resolveFilename;
  Module._resolveFilename = function (req, parent, isMain, opts) {
    if (req === "window") return windowShimPath;
    if (req === "axios") return axiosStubPath;
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
 * @param {string} [opts.periodTag]       Optional period_tag to resolve from FUSOU-PROXY-DATA
 * @returns {{ kcsRequire: function, kcsCache: object, kcsModules: object, exports: any }}
 */
function loadBundle(opts = {}) {
  const { useMain = false, getMst, silent = false, periodTag = null } = opts;
  const log = silent ? () => {} : console.log.bind(console);

  const targetScript = resolveScript(useMain, periodTag);
  if (!fs.existsSync(targetScript)) {
    throw new Error("Target script not found: " + targetScript);
  }
  log(`[loader] Using: ${path.relative(ROOT, targetScript)}`);

  // Set up environment
  const { window } = setupEnvironment();
  setupRequireIntercept(window);

  // Expose getMst if provided
  if (getMst) {
    global.__kcs_getMst = getMst;
  }
  // Reset captured references to avoid stale values from prior loads.
  global.__kcs_require = undefined;
  global.__kcs_cache = undefined;
  global.__kcs_modules = undefined;

  // Intercept _compile to capture webpack internals + inject mock App
  const origCompile = Module.prototype._compile;
  Module.prototype._compile = function (content, filename) {
    if (filename === targetScript) {
      const match = content.match(
        /(\w+)(?:\.g|\['g'\])\s*=\s*\(?function\s*\(\)\s*\{[^}]*globalThis/,
      );
      if (match) {
        const reqFn = match[1];
        const mm = content.match(
          new RegExp(
            `function\\s+${reqFn}\\s*\\((\\w+)\\)[\\s\\S]{0,2000}?return\\s+(\\w+)\\s*\\[\\s*\\1\\s*\\]`,
          ),
        );
        const cacheRe = new RegExp(
          `(?:var\\s+)?(\\w+)\\s*=\\s*\\{\\};\\s*function\\s+${reqFn}\\b`,
        );
        const cm =
          content.match(cacheRe) ||
          content.match(
            new RegExp(`(\\w+)\\s*=\\s*\\{\\}\\s*;\\s*function\\s+${reqFn}\\b`),
          );

        let inj = `global.__kcs_require = ${reqFn};\n`;
        if (mm) {
          const modulesName = mm[2];
          inj += `global.__kcs_modules = ${modulesName};\n`;
        }
        if (cm) {
          const cacheName = cm[1];
          inj += `global.__kcs_cache = ${cacheName};\n`;
          if (getMst) {
            inj += `${cacheName}[18622] = { exports: { default: { model: { slot: { getMst: global.__kcs_getMst } } }, __esModule: true } };\n`;
          }
        }
        content =
          content.slice(0, match.index) + inj + content.slice(match.index);
      }
      Module.prototype._compile = origCompile;
    }
    return origCompile.call(this, content, filename);
  };

  // Load the script
  log("[loader] Loading game script ...");
  const exports = require(targetScript);

  if (!global.__kcs_require) {
    throw new Error("Failed to capture webpack require function");
  }

  return {
    kcsRequire: global.__kcs_require,
    kcsCache: global.__kcs_cache || {},
    kcsModules: global.__kcs_modules || {},
    exports,
  };
}

module.exports = {
  ROOT,
  PROXY_DATA_DIR,
  findLatestPeriodTag,
  resolvePeriodTag,
  resolveScript,
  findMasterData,
  parseMasterData,
  isValidMasterDataFile,
  validatePeriodInputs,
  buildMstDict,
  createGetMst,
  loadBundle,
};
