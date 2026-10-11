/**
 * KanColle Proxy Master Data Extractor
 * Extracts boss, resource, maelstrom, nothing, air, night, active_branch, landing, recon,
 * airbases, and distances strictly from FUSOU-PROXY-DATA (kcsapi responses and game resources).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROXY_DATA_DIR = path.resolve(ROOT, '..', 'FUSOU-PROXY-DATA');
const WEB_DATA_DIR = path.resolve(ROOT, '..', 'FUSOU-WEB', 'src', 'data');
const WEB_PUBLIC_MAP_DIR = path.resolve(ROOT, '..', 'FUSOU-WEB', 'public', 'battle-maps');

function extractMaster() {
  console.log('[extract-master] Scanning FUSOU-PROXY-DATA...');
  if (!fs.existsSync(PROXY_DATA_DIR)) {
    console.error('PROXY_DATA_DIR not found');
    process.exit(1);
  }

  const cacheDirs = fs.readdirSync(PROXY_DATA_DIR)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  // 1. Collect airbases from _info.json
  const airbasesByMap = {};

  for (const d of cacheDirs) {
    const mapDir = path.join(PROXY_DATA_DIR, d, 'kcs2', 'resources', 'map');
    if (!fs.existsSync(mapDir)) continue;
    for (const area of fs.readdirSync(mapDir)) {
      const areaDir = path.join(mapDir, area);
      if (!fs.statSync(areaDir).isDirectory()) continue;
      const areaNum = parseInt(area, 10);
      for (const f of fs.readdirSync(areaDir)) {
        if (f.endsWith('.json') && f.includes('info')) {
          const m = f.match(/^(\d{2})_info.*\.json$/);
          if (!m) continue;
          const mapKey = areaNum + '-' + parseInt(m[1], 10);
          try {
            const buf = fs.readFileSync(path.join(areaDir, f));
            if (buf[0] === 0x7b) {
              const data = JSON.parse(buf.toString('utf8'));
              if (data.airbases && data.airbases.length > 0) {
                airbasesByMap[mapKey] = data.airbases;
              }
            }
          } catch(e) {}
        }
      }
    }
  }

  // 2. Collect cell_data from S@api_req_map@start
  const cellDataByMap = {};
  for (const d of cacheDirs) {
    const kcsapi = path.join(PROXY_DATA_DIR, d, 'kcsapi');
    if (!fs.existsSync(kcsapi)) continue;
    for (const f of fs.readdirSync(kcsapi)) {
      if (f.includes('S@api_req_map@start')) {
        try {
          const raw = fs.readFileSync(path.join(kcsapi, f), 'utf8');
          const svIdx = raw.indexOf('svdata=');
          if (svIdx !== -1) {
            const json = JSON.parse(raw.slice(svIdx + 7));
            if (json.api_data && json.api_data.api_cell_data) {
              const key = json.api_data.api_maparea_id + '-' + json.api_data.api_mapinfo_no;
              if (!cellDataByMap[key] || json.api_data.api_cell_data.length > cellDataByMap[key].length) {
                cellDataByMap[key] = json.api_data.api_cell_data;
              }
            }
          }
        } catch(e) {}
      }
    }
  }

  console.log(`[extract-master] Found cell data for ${Object.keys(cellDataByMap).length} maps.`);
  console.log(`[extract-master] Found airbase definitions for maps: ${Object.keys(airbasesByMap).join(', ')}`);

  const masterBossLabels = {};
  const masterResourceLabels = {};
  const masterMaelstromLabels = {};
  const masterNothingLabels = {};
  const masterAirLabels = {};
  const masterNightLabels = {};
  const masterActiveBranchLabels = {};
  const masterLandingLabels = {};
  const masterReconLabels = {};
  const masterAirbaseData = {};

  const allMapKeys = new Set([...Object.keys(cellDataByMap), ...Object.keys(airbasesByMap)]);
  if (fs.existsSync(WEB_ASSETS_MAP_DIR)) {
    for (const f of fs.readdirSync(WEB_ASSETS_MAP_DIR)) {
      if (/^\d+-\d+$/.test(f)) allMapKeys.add(f);
    }
  }

  for (const mapKey of [...allMapKeys].sort((a,b) => {
    const [a1, a2] = a.split('-').map(Number);
    const [b1, b2] = b.split('-').map(Number);
    return a1 !== b1 ? a1 - b1 : a2 - b2;
  })) {
    const assetDataPath = path.join(WEB_ASSETS_MAP_DIR, mapKey, 'data.json');
    const publicDataPath = path.join(WEB_PUBLIC_MAP_DIR, mapKey, 'data.json');
    let mapData = null;
    if (fs.existsSync(assetDataPath)) {
      mapData = JSON.parse(fs.readFileSync(assetDataPath, 'utf8'));
    } else if (fs.existsSync(publicDataPath)) {
      mapData = JSON.parse(fs.readFileSync(publicDataPath, 'utf8'));
    }

    const labels = mapData?.labels || {};
    const cells = cellDataByMap[mapKey] || [];
    const airbases = airbasesByMap[mapKey] || [];

    const bossSpots = new Set();
    const bossLabels = new Set();
    const resourceSpots = new Set();
    const resourceLabels = new Set();
    const maelstromLabels = new Set();
    const nothingLabels = new Set();
    const airLabels = new Set();
    const nightLabels = new Set();
    const activeBranchLabels = new Set();
    const landingLabels = new Set();
    const reconLabels = new Set();
    const distances = {};

    for (const c of cells) {
      const lbl = labels[String(c.api_no)] || labels[c.api_no];
      const validLbl = lbl && !lbl.includes('港') && lbl !== 'スタート';

      switch (c.api_color_no) {
        case 5: // ボス
          bossSpots.add(c.api_no);
          if (validLbl) bossLabels.add(lbl);
          break;
        case 2: // 資源
          resourceSpots.add(c.api_no);
          if (validLbl) resourceLabels.add(lbl);
          break;
        case 3: // 渦潮
          if (validLbl) maelstromLabels.add(lbl);
          break;
        case 6: // 気のせい・何もない
          if (validLbl) nothingLabels.add(lbl);
          break;
        case 7: // 航空戦
        case 10: // 空襲戦
          if (validLbl) airLabels.add(lbl);
          break;
        case 11: // 夜戦
        case 12: // 夜昼戦
          if (validLbl) nightLabels.add(lbl);
          break;
        case 15: // 能動分岐
          if (validLbl) activeBranchLabels.add(lbl);
          break;
        case 8: // 揚陸・船団護衛
          if (validLbl) landingLabels.add(lbl);
          break;
        case 9: // 航空偵察
          if (validLbl) reconLabels.add(lbl);
          break;
      }

      if (c.api_distance !== undefined && c.api_distance > 0 && validLbl) {
        distances[lbl] = c.api_distance;
      }
    }

    if (bossLabels.size > 0) masterBossLabels[mapKey] = [...bossLabels].sort();
    if (resourceLabels.size > 0) masterResourceLabels[mapKey] = [...resourceLabels].sort();
    if (maelstromLabels.size > 0) masterMaelstromLabels[mapKey] = [...maelstromLabels].sort();
    if (nothingLabels.size > 0) masterNothingLabels[mapKey] = [...nothingLabels].sort();
    if (airLabels.size > 0) masterAirLabels[mapKey] = [...airLabels].sort();
    if (nightLabels.size > 0) masterNightLabels[mapKey] = [...nightLabels].sort();
    if (activeBranchLabels.size > 0) masterActiveBranchLabels[mapKey] = [...activeBranchLabels].sort();
    if (landingLabels.size > 0) masterLandingLabels[mapKey] = [...landingLabels].sort();
    if (reconLabels.size > 0) masterReconLabels[mapKey] = [...reconLabels].sort();

    const bases = airbases.map(ab => ({
      x: ab.point.x,
      y: ab.point.y,
      label: 'AB'
    }));

    if (bases.length > 0 || Object.keys(distances).length > 0) {
      masterAirbaseData[mapKey] = {
        bases,
        distances
      };
    }

    if (mapData) {
      mapData.bossSpots = [...bossSpots].sort((a,b) => a - b);
      mapData.bossLabels = [...bossLabels].sort();
      mapData.resourceSpots = [...resourceSpots].sort((a,b) => a - b);
      mapData.resourceLabels = [...resourceLabels].sort();
      mapData.maelstromLabels = [...maelstromLabels].sort();
      mapData.nothingLabels = [...nothingLabels].sort();
      mapData.airLabels = [...airLabels].sort();
      mapData.nightLabels = [...nightLabels].sort();
      mapData.activeBranchLabels = [...activeBranchLabels].sort();
      mapData.landingLabels = [...landingLabels].sort();
      mapData.reconLabels = [...reconLabels].sort();

      if (bases.length > 0) {
        mapData.airbases = bases;
      } else {
        delete mapData.airbases;
      }
      if (Object.keys(distances).length > 0) {
        mapData.distances = distances;
      } else {
        delete mapData.distances;
      }

      if (Array.isArray(mapData.spots)) {
        const cellMap = new Map(cells.map(c => [c.api_no, c]));
        mapData.spots.forEach(sp => {
          const c = cellMap.get(sp.no);
          if (c) {
            if (c.api_color_no !== undefined) sp.color = c.api_color_no;
            if (c.api_distance !== undefined) sp.distance = c.api_distance;
          }
        });
      }

      const jsonStr = JSON.stringify(mapData, null, 2);
      if (fs.existsSync(assetDataPath)) {
        fs.writeFileSync(assetDataPath, jsonStr, 'utf8');
      }
      if (fs.existsSync(publicDataPath)) {
        fs.writeFileSync(publicDataPath, jsonStr, 'utf8');
      }
    }
  }

  const masterOutput = {
    _generatedFrom: 'FUSOU-PROXY-DATA',
    _generatedAt: new Date().toISOString(),
    bossLabels: masterBossLabels,
    resourceLabels: masterResourceLabels,
    maelstromLabels: masterMaelstromLabels,
    nothingLabels: masterNothingLabels,
    airLabels: masterAirLabels,
    nightLabels: masterNightLabels,
    activeBranchLabels: masterActiveBranchLabels,
    landingLabels: masterLandingLabels,
    reconLabels: masterReconLabels,
    airbaseData: masterAirbaseData
  };

  const masterPath = path.join(WEB_DATA_DIR, 'proxy_map_master.json');
  fs.writeFileSync(masterPath, JSON.stringify(masterOutput, null, 2), 'utf8');
  console.log(`[extract-master] Written proxy master data to ${masterPath}`);
  console.log('[extract-master] Done!');
}

extractMaster();
