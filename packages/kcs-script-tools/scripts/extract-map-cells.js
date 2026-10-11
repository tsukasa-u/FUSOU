#!/usr/bin/env node
/**
 * KanColle Map Cells & Routes Extractor
 *
 * Extracts map spot coordinates, routes, enemies, and official cell labels from
 * game client resources (FUSOU-PROXY-DATA). Fully supports multi-stage/gimmick
 * files (_info.json, _info18.json, _info20.json, etc.).
 *
 * Usage:
 *   node scripts/extract-map-cells.js [--area <id>] [--map <id>] [--output <path>]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROXY_DATA_DIR = path.resolve(ROOT, '..', 'FUSOU-PROXY-DATA');
const DEFAULT_OUT_DIR = path.join(ROOT, 'output');

const args = process.argv.slice(2);
const areaIdx = args.indexOf('--area');
const targetArea = areaIdx >= 0 ? parseInt(args[areaIdx + 1], 10) : null;
const mapIdx = args.indexOf('--map');
const targetMap = mapIdx >= 0 ? parseInt(args[mapIdx + 1], 10) : null;
const outIdx = args.indexOf('--output');
const outputPath = outIdx >= 0 ? path.resolve(process.cwd(), args[outIdx + 1]) : path.join(DEFAULT_OUT_DIR, 'map_cells_all.json');

// Find all info files grouped by area-map (e.g. "5-6" -> list of fullPaths)
function findAllMapInfoFiles() {
  const mapFiles = new Map(); // key: "area-map", value: Map<fileName, fullPath>
  if (!fs.existsSync(PROXY_DATA_DIR)) return mapFiles;

  const cacheDirs = fs.readdirSync(PROXY_DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort(); // oldest to newest so newest overwrites

  for (const cache of cacheDirs) {
    const mapDir = path.join(PROXY_DATA_DIR, cache, 'kcs2', 'resources', 'map');
    if (!fs.existsSync(mapDir)) continue;

    for (const areaFolder of fs.readdirSync(mapDir)) {
      const areaPath = path.join(mapDir, areaFolder);
      if (!fs.statSync(areaPath).isDirectory()) continue;
      const areaNum = parseInt(areaFolder, 10);
      if (isNaN(areaNum)) continue;

      for (const file of fs.readdirSync(areaPath)) {
        if (file.endsWith('.json') && file.includes('info')) {
          const match = file.match(/^(\d{2})_info.*\.json$/);
          if (!match) continue;
          const mapNum = parseInt(match[1], 10);
          const key = `${areaNum}-${mapNum}`;
          if (!mapFiles.has(key)) {
            mapFiles.set(key, new Map());
          }
          mapFiles.get(key).set(file, path.join(areaPath, file));
        }
      }
    }
  }
  return mapFiles;
}

function alphaFallback(no) {
  if (no === 0) return 'スタート';
  let res = '';
  let n = no;
  while (n > 0) {
    const rem = (n - 1) % 26;
    res = String.fromCharCode(65 + rem) + res;
    n = Math.floor((n - 1) / 26);
  }
  return res;
}

function main() {
  console.log('[extract-map-cells] Scanning multi-stage map resources in FUSOU-PROXY-DATA...');
  const mapFiles = findAllMapInfoFiles();
  console.log(`[extract-map-cells] Found ${mapFiles.size} distinct sea areas.`);

  // Load existing label mapping if available
  const labelMapPath = path.resolve(ROOT, '..', 'FUSOU-WEB', 'src', 'assets', 'map', 'cell_labels.json');
  let labelMap = {};
  if (fs.existsSync(labelMapPath)) {
    try {
      labelMap = JSON.parse(fs.readFileSync(labelMapPath, 'utf8'));
    } catch (e) {}
  }

  const results = {};

  for (const [key, filesMap] of [...mapFiles.entries()].sort((a, b) => {
    const [aArea, aMap] = a[0].split('-').map(Number);
    const [bArea, bMap] = b[0].split('-').map(Number);
    return aArea !== bArea ? aArea - bArea : aMap - bMap;
  })) {
    const [areaStr, mapStr] = key.split('-');
    const area = parseInt(areaStr, 10);
    const mapNo = parseInt(mapStr, 10);

    if (targetArea !== null && area !== targetArea) continue;
    if (targetMap !== null && mapNo !== targetMap) continue;

    const fileList = [...filesMap.values()].sort();
    const spotsMap = new Map();
    const officialLabels = [];
    const enemies = [];
    const airraids = [];
    let bg = [];

    for (const filePath of fileList) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (bg.length === 0 && raw.bg) bg = raw.bg;
        if (Array.isArray(raw.spots)) {
          for (const s of raw.spots) {
            spotsMap.set(s.no, s);
          }
        }
        if (Array.isArray(raw.labels)) {
          officialLabels.push(...raw.labels);
        }
        if (Array.isArray(raw.enemies)) {
          enemies.push(...raw.enemies);
        }
        if (Array.isArray(raw.airraids)) {
          airraids.push(...raw.airraids);
        }
      } catch (err) {
        console.warn(`[extract-map-cells] Warning: Failed to parse ${filePath}: ${err.message}`);
      }
    }

    // Match official labels to spots by euclidean distance
    const spotLabels = new Map();
    for (const l of officialLabels) {
      let closestNo = null;
      let minDist = 999999;
      for (const [sno, s] of spotsMap.entries()) {
        const dist = Math.hypot(s.x - l.x, s.y - l.y);
        if (dist < minDist) {
          minDist = dist;
          closestNo = sno;
        }
      }
      if (closestNo !== null && minDist <= 40) {
        spotLabels.set(closestNo, l.img);
      }
    }

    const mapLabelLookup = labelMap[key] || {};
    const coordToCanon = new Map();
    for (const [sno, s] of spotsMap.entries()) {
      const coordKey = `${s.x},${s.y}`;
      if (!coordToCanon.has(coordKey)) {
        coordToCanon.set(coordKey, sno);
      }
    }

    const cellList = [...spotsMap.values()]
      .sort((a, b) => a.no - b.no)
      .map(s => {
        const sno = s.no;
        const canonNo = coordToCanon.get(`${s.x},${s.y}`) ?? sno;
        let letter = spotLabels.get(sno)
          || spotLabels.get(canonNo)
          || mapLabelLookup[sno]
          || mapLabelLookup[String(sno)]
          || (canonNo === 0 ? 'スタート' : alphaFallback(canonNo));

        return {
          spotNo: sno,
          x: s.x,
          y: s.y,
          letter,
          line: s.line || null,
          route: s.route || null,
          color: s.color !== undefined ? s.color : null,
        };
      });

    results[key] = {
      area,
      mapNo,
      sourceFiles: fileList.map(f => path.relative(ROOT, f)),
      totalSpots: cellList.length,
      bg,
      cells: cellList,
      officialLabels,
      enemies,
      airraids,
    };
  }

  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`[extract-map-cells] Successfully extracted ${Object.keys(results).length} maps to ${path.relative(ROOT, outputPath)}`);
}

main();
