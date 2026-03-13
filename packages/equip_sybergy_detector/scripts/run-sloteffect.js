#!/usr/bin/env node
/**
 * Compute equipment bonus effects for a specific ship × slots combination.
 *
 * Usage:
 *   node scripts/run-sloteffect.js --ship <ship.json> --slots <slots.json>
 *
 * Ship JSON: { "mstID": 181, "yomi": "しまかぜ", "shipTypeID": 2, "classType": 22 }
 * Slots JSON: [{ "mstID": 267, "equipType": 1, "level": 10 }, ...]
 *
 * Flags:
 *   --main     Use main.js instead of deobfuscated.js
 *   --verbose  Show debug output
 */

const path = require('path');
const fs = require('fs');
const {
  ROOT, findMasterData, parseMasterData, buildMstDict, createGetMst, loadBundle
} = require('../lib/loader');

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  return (idx >= 0 && args[idx + 1]) ? args[idx + 1] : null;
}

function parseJsonArg(name) {
  const val = getArg(name);
  if (!val) return null;
  if (fs.existsSync(val)) return JSON.parse(fs.readFileSync(val, 'utf-8'));
  return JSON.parse(val);
}

const useMain = args.includes('--main');
const shipData = parseJsonArg('--ship');
const slotsData = parseJsonArg('--slots');

if (!shipData || !slotsData) {
  console.error('Usage: node scripts/run-sloteffect.js --ship <json> --slots <json>');
  console.error('Ship:  { "mstID": 181, "yomi": "しまかぜ", "shipTypeID": 2, "classType": 22 }');
  console.error('Slots: [{ "mstID": 267, "equipType": 1, "level": 10 }]');
  process.exit(1);
}

// Load master data for getMst mock
const masterPath = findMasterData();
let mstDict = {};
if (masterPath) {
  const masterData = parseMasterData(masterPath);
  mstDict = buildMstDict(masterData.api_mst_slotitem);
}
// Fallback from slot data
for (const slot of slotsData) {
  if (slot?.mstID && !mstDict[slot.mstID]) {
    mstDict[slot.mstID] = {
      mstID: slot.mstID, name: '', equipType: slot.equipType || 0,
      cardType: 0, iconType: 0, sakuteki: 0, meichu: 0, taiku: 0,
      karyoku: 0, raisou: 0, taisen: 0, bakusou: 0, soukou: 0, kaihi: 0
    };
  }
}

const getMst = createGetMst(mstDict);
const { kcsRequire } = loadBundle({ useMain, getMst, silent: true });
const { SlotItemEffectUtil } = kcsRequire(82692);

const ship = {
  mstID: shipData.mstID,
  yomi: shipData.yomi || '',
  shipTypeID: shipData.shipTypeID || 0,
  getClassType: () => shipData.classType || 0
};

const result = SlotItemEffectUtil.getSlotitemEffect(ship, slotsData);
console.log(JSON.stringify(result, null, 2));
