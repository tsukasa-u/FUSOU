#!/usr/bin/env node
/**
 * Compare two slot_item_effects.json files and report differences.
 * Usage: node scripts/compare-outputs.js <file1> <file2>
 */
const fs = require("fs");
const path = require("path");

const [,, file1, file2] = process.argv;
if (!file1 || !file2) {
  console.error("Usage: node scripts/compare-outputs.js <file1> <file2>");
  process.exit(1);
}

const data1 = JSON.parse(fs.readFileSync(file1, "utf-8"));
const data2 = JSON.parse(fs.readFileSync(file2, "utf-8"));

let errors = 0;
let warnings = 0;

function cmpMeta(m1, m2) {
  const SKIP = new Set(["generated"]);
  for (const key of Object.keys(m1)) {
    if (SKIP.has(key)) continue;
    if (JSON.stringify(m1[key]) !== JSON.stringify(m2[key])) {
      console.error(`META DIFF [${key}]: ${JSON.stringify(m1[key])} vs ${JSON.stringify(m2[key])}`);
      errors++;
    }
  }
}

function normalizeRule(rule) {
  // Remove non-deterministic fields for comparison
  const r = { ...rule };
  if (r.ships) r.ships = [...r.ships].sort((a, b) => a - b);
  if (r.items) r.items = [...r.items].sort((a, b) => a - b);
  if (r.pairs) r.pairs = r.pairs.map(p => p.slice().sort((a, b) => a - b)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return r;
}

function compareRuleSets(name, rules1, rules2) {
  // Sort by JSON string for comparison (sets are unordered)
  const toKey = (rule) => {
    const r = normalizeRule(rule);
    const ships = (r.ships || []).join(",");
    const synergy = JSON.stringify(r.synergy || r.b || {});
    let itemsKey = "";
    if (r.items) itemsKey = r.items.join(",");
    else if (r.item_pool) itemsKey = "pool:" + r.item_pool.join(",");
    else if (r.pairs) itemsKey = "pairs:" + r.pairs.map(p => p.join(":")).join(",");
    else if (r.fixed_items) itemsKey = "fixed:" + r.fixed_items.join(",") + "|free:" + (r.free_pool || []).join(",");
    return `${ships}||${synergy}||${itemsKey}`;
  };

  const set1 = new Map(rules1.map(r => [toKey(r), r]));
  const set2 = new Map(rules2.map(r => [toKey(r), r]));

  let missingIn2 = 0;
  let missingIn1 = 0;

  for (const [key] of set1) {
    if (!set2.has(key)) {
      missingIn2++;
      if (missingIn2 <= 3) {
        console.error(`  ${name}: rule in file1 but not file2: ${key.substring(0, 200)}`);
      }
    }
  }
  for (const [key] of set2) {
    if (!set1.has(key)) {
      missingIn1++;
      if (missingIn1 <= 3) {
        console.error(`  ${name}: rule in file2 but not file1: ${key.substring(0, 200)}`);
      }
    }
  }

  const ok = set1.size === set2.size && missingIn2 === 0 && missingIn1 === 0;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${set1.size} vs ${set2.size} rules` +
    (missingIn2 > 0 ? ` | ${missingIn2} missing in file2` : "") +
    (missingIn1 > 0 ? ` | ${missingIn1} missing in file1` : ""));
  if (!ok) errors++;
}

function compareShipSets(name, rules1, rules2) {
  // Compare that each rule's ships sets match (regardless of order)
  // First normalize rules by key
  const toShipKey = (rule) => {
    const ships = [...(rule.ships || [])].sort((a, b) => a - b).join(",");
    const synergy = JSON.stringify(rule.synergy || rule.b || {});
    return `${synergy}`;
  };
  
  const map1 = new Map();
  for (const r of rules1) {
    const k = toShipKey(r);
    if (!map1.has(k)) map1.set(k, new Set());
    for (const s of (r.ships || [])) map1.get(k).add(s);
  }
  const map2 = new Map();
  for (const r of rules2) {
    const k = toShipKey(r);
    if (!map2.has(k)) map2.set(k, new Set());
    for (const s of (r.ships || [])) map2.get(k).add(s);
  }

  let shipDiffs = 0;
  for (const [k, ships1] of map1) {
    const ships2 = map2.get(k);
    if (!ships2) continue;
    for (const s of ships1) {
      if (!ships2.has(s)) { shipDiffs++; }
    }
    for (const s of ships2) {
      if (!ships1.has(s)) { shipDiffs++; }
    }
  }
  if (shipDiffs > 0) {
    console.warn(`  ${name}: ${shipDiffs} ship assignment differences`);
    warnings++;
  }
}

console.log("=== Comparing output files ===");
console.log(`File 1: ${path.basename(file1)} (${(fs.statSync(file1).size / 1024).toFixed(0)} KB)`);
console.log(`File 2: ${path.basename(file2)} (${(fs.statSync(file2).size / 1024).toFixed(0)} KB)`);
console.log("");

console.log("--- Meta ---");
cmpMeta(data1._meta, data2._meta);

console.log("\n--- Rule counts ---");
for (const key of [
  "effect_rules", "cross_rules", "triple_rules", "quad_rules", "penta_rules", "hexa_rules"
]) {
  const r1 = (data1[key] || []).length;
  const r2 = (data2[key] || []).length;
  const ok = r1 === r2;
  if (!ok) errors++;
  console.log(`${ok ? '✓' : '✗'} ${key}: ${r1} vs ${r2}`);
}

console.log("\n--- Effect rules comparison ---");
compareRuleSets("effect_rules", data1.effect_rules || [], data2.effect_rules || []);

console.log("\n--- Cross rules comparison ---");
compareRuleSets("cross_rules", data1.cross_rules || [], data2.cross_rules || []);

console.log("\n--- Triple rules comparison ---");
compareRuleSets("triple_rules", data1.triple_rules || [], data2.triple_rules || []);

console.log("\n--- Quad rules comparison ---");
compareRuleSets("quad_rules", data1.quad_rules || [], data2.quad_rules || []);

console.log("\n--- Summary ---");
console.log(`Errors: ${errors}, Warnings: ${warnings}`);
if (errors === 0) {
  console.log("✓ Files are equivalent!");
} else {
  console.error("✗ Files have differences.");
  process.exit(1);
}
