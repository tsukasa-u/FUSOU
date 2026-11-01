#!/usr/bin/env node
/**
 * KanColle Maps Automatic Sync & Extractor Tool
 *
 * Scans FUSOU-PROXY-DATA for map definition and sprite assets (_info*.json, _image*.json, _image*.png),
 * automatically decompresses Brotli archives, runs OCR/Template Matching to extract authentic cell labels,
 * runs the converter to generate route and unified data.json, and outputs master map cell data.
 *
 * Usage:
 *   pnpm run sync:maps
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { brotliDecompressSync } = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const PROXY_DATA_DIR = path.resolve(ROOT, '..', 'FUSOU-PROXY-DATA');
const MAP_RESOURCES_DIR = path.join(ROOT, 'output', 'map-resources');
const LEGACY_WEB_ASSETS_MAP_DIR = path.resolve(ROOT, '..', 'FUSOU-WEB', 'src', 'assets', 'map');
const EXTRACT_LABELS_SCRIPT = path.join(__dirname, 'extract_labels_ocr.py');
const CONVERT_SCRIPT = path.join(__dirname, 'convert.py');
const EXTRACT_CELLS_SCRIPT = path.join(__dirname, 'extract-map-cells.js');
const EXTRACT_MASTER_SCRIPT = path.join(__dirname, 'extract-proxy-master.js');

function migrateLegacyMapResources() {
  if (!fs.existsSync(LEGACY_WEB_ASSETS_MAP_DIR)) return;
  if (fs.existsSync(MAP_RESOURCES_DIR)) {
    throw new Error(
      `Both legacy and current map resource caches exist. Merge them before syncing: ${LEGACY_WEB_ASSETS_MAP_DIR} and ${MAP_RESOURCES_DIR}`,
    );
  }

  fs.mkdirSync(path.dirname(MAP_RESOURCES_DIR), { recursive: true });
  fs.renameSync(LEGACY_WEB_ASSETS_MAP_DIR, MAP_RESOURCES_DIR);
  console.log('[sync:maps] Moved the legacy WEB map cache into kcs-script-tools/output/map-resources.');
}

function syncMapAssets() {
  console.log('[sync:maps] Step 1: Scanning FUSOU-PROXY-DATA for map assets...');
  migrateLegacyMapResources();
  fs.mkdirSync(MAP_RESOURCES_DIR, { recursive: true });
  if (!fs.existsSync(PROXY_DATA_DIR)) {
    console.error(`[sync:maps] Error: PROXY-DATA dir not found at ${PROXY_DATA_DIR}`);
    return 0;
  }

  const cacheDirs = fs.readdirSync(PROXY_DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

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
        const match = file.match(/^(\d{2})_(image.*|info.*)\.(json|png)$/);
        if (!match) continue;

        const mapNum = parseInt(match[1], 10);
        const areaTag = `${areaNum}-${mapNum}`;
        discoveredAreas.add(areaTag);

        const targetDir = path.join(MAP_RESOURCES_DIR, areaTag);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const srcPath = path.join(areaPath, file);
        const dstPath = path.join(targetDir, file);

        let shouldCopy = true;
        if (fs.existsSync(dstPath)) {
          const srcStat = fs.statSync(srcPath);
          const dstStat = fs.statSync(dstPath);
          if (srcStat.size === dstStat.size) {
            shouldCopy = false;
          }
        }

        if (shouldCopy) {
          if (file.endsWith('.json')) {
            try {
              let buf = fs.readFileSync(srcPath);
              if (buf.length >= 2 && buf[0] !== 0x7b && buf[0] !== 0x5b) {
                try {
                  buf = brotliDecompressSync(buf);
                } catch (e) {
                  continue;
                }
              }
              if (buf.length >= 2 && (buf[0] === 0x7b || buf[0] === 0x5b)) {
                fs.writeFileSync(dstPath, buf);
                copiedCount++;
              }
              continue;
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

  console.log(`[sync:maps] Synced ${copiedCount} files across ${discoveredAreas.size} sea areas into ${path.relative(ROOT, MAP_RESOURCES_DIR)}`);
  return discoveredAreas.size;
}

function runExtractLabels() {
  console.log('[sync:maps] Step 2: Running extract_labels_ocr.py (High-Precision OCR & Template Matching)...');
  try {
    execSync(`python "${EXTRACT_LABELS_SCRIPT}"`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running extract_labels_ocr.py:', err.message);
    throw err;
  }
}

function runConverter() {
  console.log('[sync:maps] Step 3: Running convert.py to generate routes, ports, and unified data.json...');
  try {
    execSync(`python "${CONVERT_SCRIPT}"`, {
      cwd: MAP_RESOURCES_DIR,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running convert.py:', err.message);
    throw err;
  }
}

function runExtractCells() {
  console.log('[sync:maps] Step 4: Running extract-map-cells.js to update master map cells JSON...');
  try {
    execSync(`node "${EXTRACT_CELLS_SCRIPT}"`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running extract-map-cells.js:', err.message);
    throw err;
  }
}

function runExtractMaster() {
  console.log('[sync:maps] Step 5: Running extract-proxy-master.js to update proxy master definitions...');
  try {
    execSync(`node "${EXTRACT_MASTER_SCRIPT}"`, {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('[sync:maps] Error running extract-proxy-master.js:', err.message);
    throw err;
  }
}

function main() {
  console.log('=== FUSOU Map Asset Auto-Sync & Authentic Extraction Pipeline ===');
  const count = syncMapAssets();
  if (count > 0) {
    runExtractLabels();
    runConverter();
    runExtractCells();
    runExtractMaster();
  }
  console.log('=== Pipeline Completed Successfully ===');
}

main();
