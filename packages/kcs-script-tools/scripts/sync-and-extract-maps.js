#!/usr/bin/env node
/**
 * KanColle Maps Automatic Sync & Extractor Tool
 *
 * Scans FUSOU-PROXY-DATA for map definition and sprite assets (_info*.json, _image*.json, _image*.png),
 * copies them to packages/FUSOU-WEB/src/assets/map/, runs the converter to generate vector maps,
 * routes, and cell labels, and outputs master map cell data to output/map_cells_all.json.
 *
 * Usage:
 *   pnpm run sync:maps
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PROXY_DATA_DIR = path.resolve(ROOT, '..', 'FUSOU-PROXY-DATA');
const WEB_ASSETS_MAP_DIR = path.resolve(ROOT, '..', 'FUSOU-WEB', 'src', 'assets', 'map');
const CONVERT_SCRIPT = path.join(__dirname, 'convert.py');
const EXTRACT_CELLS_SCRIPT = path.join(__dirname, 'extract-map-cells.js');
const EXTRACT_MASTER_SCRIPT = path.join(__dirname, 'extract-proxy-master.js');

function syncMapAssets() {
  console.log('[sync:maps] Step 1: Scanning FUSOU-PROXY-DATA for map assets...');
  if (!fs.existsSync(PROXY_DATA_DIR)) {
    console.error(`[sync:maps] Error: PROXY-DATA dir not found at ${PROXY_DATA_DIR}`);
    return 0;
  }

  const cacheDirs = fs.readdirSync(PROXY_DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort(); // oldest to newest so newest overwrites

  let copiedCount = 0;
  const discoveredAreas = new Set();

  for (const cache of cacheDirs) {
    const mapDir = path.join(PROXY_DATA_DIR, cache, 'kcs2', 'resources', 'map');
    if (!fs.existsSync(mapDir)) continue;

    for (const areaFolder of fs.readdirSync(mapDir)) {
      const areaPath = path.join(mapDir, areaFolder);
      if (!fs.statSync(areaPath).isDirectory()) continue;
      const areaNum = parseInt(areaFolder, 10);
      if (isNaN(areaNum)) continue;

      for (const file of fs.readdirSync(areaPath)) {
        // We want _image*.json, _image*.png, and _info*.json
        const match = file.match(/^(\d{2})_(image.*|info.*)\.(json|png)$/);
        if (!match) continue;

        const mapNum = parseInt(match[1], 10);
        const areaTag = `${areaNum}-${mapNum}`;
        discoveredAreas.add(areaTag);

        const targetDir = path.join(WEB_ASSETS_MAP_DIR, areaTag);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const srcPath = path.join(areaPath, file);
        const dstPath = path.join(targetDir, file);

        // Copy if not exists or size differs
        let shouldCopy = true;
        if (fs.existsSync(dstPath)) {
          const srcStat = fs.statSync(srcPath);
          const dstStat = fs.statSync(dstPath);
          if (srcStat.size === dstStat.size) {
            shouldCopy = false;
          }
        }

        if (shouldCopy) {
          // If copying a json file, verify it is valid plain text UTF-8 starting with '{' or '['
          if (file.endsWith('.json')) {
            try {
              const buf = fs.readFileSync(srcPath);
              if (buf.length < 2 || (buf[0] !== 0x7b && buf[0] !== 0x5b)) {
                // Encrypted or corrupted binary cache in PROXY-DATA, skip overwriting
                continue;
              }
            } catch (e) {
              continue;
            }
          }
          fs.copyFileSync(srcPath, dstPath);
          copiedCount++;
        }
      }
    }
  }

  console.log(`[sync:maps] Synced ${copiedCount} files across ${discoveredAreas.size} sea areas into ${path.relative(ROOT, WEB_ASSETS_MAP_DIR)}`);
  return discoveredAreas.size;
}

function runConverter() {
  console.log('[sync:maps] Step 2: Running convert.py to generate themes, routes, and official cell labels...');
  try {
    execSync(`python "${CONVERT_SCRIPT}"`, {
      cwd: WEB_ASSETS_MAP_DIR,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running convert.py:', err.message);
  }
}

function runExtractCells() {
  console.log('[sync:maps] Step 3: Running extract-map-cells.js to update master map cells JSON...');
  try {
    execSync(`node "${EXTRACT_CELLS_SCRIPT}"`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running extract-map-cells.js:', err.message);
  }
}

function runExtractMaster() {
  console.log('[sync:maps] Step 4: Running extract-proxy-master.js to update proxy master definitions...');
  try {
    execSync(
ode "${EXTRACT_MASTER_SCRIPT}" , {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running extract-proxy-master.js:', err.message);
  }
}

function main() {
  console.log('=== FUSOU Map Asset Auto-Sync & Extraction Pipeline ===');
  const count = syncMapAssets();
  if (count > 0) {
    runConverter();
    runExtractCells();
    runExtractMaster();
  }
  console.log('=== Pipeline Completed Successfully ===');
}

main();
