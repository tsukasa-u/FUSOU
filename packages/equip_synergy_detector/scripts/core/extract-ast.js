const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const walk = require("acorn-walk");
const vm = require("vm");
const { loadBundle, findMasterData, parseMasterData, buildMstDict, createGetMst, ROOT } = require("../../lib/loader");

// --- 1. Load Master Data ---
const masterPath = findMasterData();
const masterData = parseMasterData(masterPath);
const mstShips = [...masterData.api_mst_ship].sort((a, b) => a.api_id - b.api_id);
const mstSlotitems = [...masterData.api_mst_slotitem].sort((a, b) => a.api_id - b.api_id);
const mstDict = buildMstDict(mstSlotitems);
const getMstFn = createGetMst(mstDict);

// --- 2. Parse AST of deobfuscated.js ---
const args = process.argv.slice(2);
const periodTagIdx = args.indexOf("--period-tag");
const periodTag = periodTagIdx >= 0 ? args[periodTagIdx + 1] : null;

const inputPath = periodTag ? `output/deobfuscated_${periodTag}.js` : "output/deobfuscated.js";
const outputPath = periodTag ? `output/synergy_dict_${periodTag}.json` : "output/synergy_dict.json";
const deob = fs.readFileSync(path.join(ROOT, inputPath), "utf8");
console.log("[extract-ast] Parsing AST...");
const fullAst = acorn.parse(deob, { ecmaVersion: 2022 });

// --- 3. Dynamic VM for string resolving ---
let cutIdx = 50000;
for (const stmt of fullAst.body) {
  if (stmt.type === "ExpressionStatement" && stmt.end - stmt.start > 100000) {
    cutIdx = stmt.start;
    break;
  }
}

const safeHeader = deob.slice(0, cutIdx);

function buildTopLevelCallableMap(ast, source) {
  const map = new Map();
  for (const stmt of ast.body || []) {
    if (
      stmt.type === "FunctionDeclaration" &&
      stmt.id &&
      typeof stmt.id.name === "string"
    ) {
      map.set(stmt.id.name, { start: stmt.start, end: stmt.end });
      continue;
    }
    if (stmt.type !== "VariableDeclaration") continue;
    for (const decl of stmt.declarations || []) {
      if (!decl?.id || decl.id.type !== "Identifier") continue;
      const name = decl.id.name;
      const init = decl.init;
      if (!init) continue;
      if (init.type === "FunctionExpression" || init.type === "ArrowFunctionExpression") {
        map.set(name, { start: stmt.start, end: stmt.end });
      }
    }
  }
  return map;
}

function buildCallableBootstrapSource(entryName, callableMap, source) {
  const visited = new Set();
  const chunks = [];

  function add(name) {
    if (!name || visited.has(name)) return;
    const node = callableMap.get(name);
    if (!node) return;
    visited.add(name);
    const snippet = source.slice(node.start, node.end);
    const refs = new Set((snippet.match(/\b_0x[a-f0-9]+\b/g) || []).filter((n) => n !== name));
    for (const ref of refs) add(ref);
    chunks.push(snippet);
  }

  add(entryName);
  return chunks.join("\n");
}

// Find the string resolver function defined at the top level.
// Primary path: decoder exists in safe header.
// Fallback path: decoder is defined later in file (newer deobfuscation layout).
let decoderFuncName = null;
const headerAst = acorn.parse(safeHeader, { ecmaVersion: 2022 });
for (const stmt of headerAst.body) {
  if (
    stmt.type === "FunctionDeclaration" &&
    stmt.id &&
    stmt.id.name.startsWith("_0x")
  ) {
    decoderFuncName = stmt.id.name;
    break;
  }
}

const topLevelCallableMap = buildTopLevelCallableMap(fullAst, deob);
let resolverBootstrapSource = safeHeader;
if (!decoderFuncName) {
  const aliasMatches = [
    ...safeHeader.matchAll(/\bvar\s+_0x[a-f0-9]+\s*=\s*(_0x[a-f0-9]+)\s*;/g),
  ];
  for (const m of aliasMatches) {
    const candidate = m[1];
    if (topLevelCallableMap.has(candidate)) {
      decoderFuncName = candidate;
      break;
    }
  }
}

if (!decoderFuncName) {
  for (const name of topLevelCallableMap.keys()) {
    if (!name.startsWith("_0x")) continue;
    decoderFuncName = name;
    break;
  }
}

if (!decoderFuncName) {
  console.error("Could not detect global string decoder function!");
  process.exit(1);
}

function createResolver(funcName) {
  let source = safeHeader;
  if (!safeHeader.includes(`function ${funcName}`) && !safeHeader.includes(`var ${funcName}`)) {
    const fallbackSource = buildCallableBootstrapSource(
      funcName,
      topLevelCallableMap,
      deob,
    );
    if (!fallbackSource) {
      throw new Error(`Could not build decoder bootstrap source for ${funcName}.`);
    }
    source = fallbackSource;
  }
  const s = { __result: null };
  const c = vm.createContext(s);
  vm.runInContext(
    source + `\n__result = typeof ${funcName} === "function" ? ${funcName} : null;`,
    c,
  );
  if (typeof c.__result !== "function") {
    throw new Error(`Resolved decoder is not callable: ${funcName}`);
  }
  return (idx) => {
    try {
      return c.__result(idx);
    } catch (e) {
      return null;
    }
  };
}

let resolveStr = createResolver(decoderFuncName);

console.log(`[extract-ast] Initial decoder function: ${decoderFuncName}`);

console.log("[extract-ast] Locating getSlotitemEffect routing table by structure...");
let arrayNode = null;
walk.simple(fullAst, {
  ArrayExpression(node) {
    if (node.elements.length > 50) {
      // Check if elements are objects with 2 properties (key, value)
      // or similar structure typical of the routing table
      const firstElem = node.elements[0];
      if (firstElem && firstElem.type === "ObjectExpression" && firstElem.properties.length >= 2) {
        if (!arrayNode || node.elements.length > arrayNode.elements.length) {
          arrayNode = node;
        }
      }
    }
  }
});

if (!arrayNode) {
  console.error("Could not find getSlotitemEffect routing table array!");
  process.exit(1);
}

function resolveDecoderAlias(localDecoderName, nearSourceText) {
  let cur = localDecoderName;
  const seen = new Set();
  for (let i = 0; i < 8; i++) {
    if (!cur || seen.has(cur)) break;
    seen.add(cur);
    if (topLevelCallableMap.has(cur)) return cur;
    const aliasRegex = new RegExp(
      `(?:var|let|const)\\s+${cur}\\s*=\\s*(_0x[a-f0-9]+)\\s*;`,
      "g",
    );
    let next = null;
    for (const m of nearSourceText.matchAll(aliasRegex)) {
      next = m[1];
    }
    if (!next) break;
    cur = next;
  }
  return null;
}

// Prefer decoder function actually used by the routing table structure.
// Newer periods can include many _0x* helpers; choosing "first one" is fragile.
const nearScopeText = deob.slice(Math.max(0, arrayNode.start - 12000), arrayNode.start + 300);
const localDecoderUsage = new Map();
for (const elem of arrayNode.elements.slice(0, 40)) {
  if (!elem || elem.type !== "ObjectExpression") continue;
  const text = deob.slice(elem.start, elem.end);
  for (const m of text.matchAll(/\b(_0x[a-f0-9]+)\((\d+)\)/g)) {
    const name = m[1];
    localDecoderUsage.set(name, (localDecoderUsage.get(name) || 0) + 1);
  }
}

if (localDecoderUsage.size > 0) {
  const localCandidates = [...localDecoderUsage.entries()].sort((a, b) => b[1] - a[1]);
  for (const [localName] of localCandidates) {
    const resolvedTopLevel = resolveDecoderAlias(localName, nearScopeText);
    if (!resolvedTopLevel) continue;
    if (resolvedTopLevel !== decoderFuncName) {
      decoderFuncName = resolvedTopLevel;
      resolveStr = createResolver(decoderFuncName);
    }
    break;
  }
}

console.log(`[extract-ast] Active decoder function: ${decoderFuncName}`);
console.log(`[extract-ast] Found ${arrayNode.elements.length} rules in the routing table.`);

const astRules = [];
for (let i = 0; i < arrayNode.elements.length; i++) {
  const elem = arrayNode.elements[i];
  let isExecuteText = deob.slice(elem.properties[0].value.start, elem.properties[0].value.end);
  const triggerMethodIdxMatch = isExecuteText.match(/\[_0x[a-f0-9]+\((\d+)\)\]/g);
  if (triggerMethodIdxMatch) {
    for (const match of triggerMethodIdxMatch) {
      const idx = parseInt(match.match(/\((\d+)\)/)[1]);
      const mName = resolveStr(idx);
      isExecuteText = isExecuteText.replace(match, "." + mName);
    }
  }
  isExecuteText = isExecuteText.replace(/Boolean\(_0xce6048\.([a-zA-Z0-9_]+)\((\d+)\)\)/g, "$1($2)");

  const execFuncIdx = elem.properties[1].value.property.arguments[0].value;
  const execFuncName = resolveStr(execFuncIdx);
  
  // Extract item requirements from condition text.
  // Newer periods can rename wrapper methods, so do not depend only on legacy
  // names (get_type3_nums / get_slotnums).
  const requiredItemTypes = [];
  const requiredItemIds = [];

  // 1) Legacy explicit names (preferable when available)
  const legacyTypeMatches = [...isExecuteText.matchAll(/get_type3_nums\((\d+)\)/g)];
  for (const m of legacyTypeMatches) requiredItemTypes.push(parseInt(m[1], 10));

  const legacyIdMatches = [...isExecuteText.matchAll(/get_slotnums\((\d+)\)/g)];
  for (const m of legacyIdMatches) requiredItemIds.push(parseInt(m[1], 10));

  // 2) Generic method call fallback: <obj>.<method>(<number>)
  // Heuristic: low IDs are usually slotitem IDs; larger IDs are type3 IDs.
  // This preserves filtering utility even when method names are obfuscated/renamed.
  const genericMatches = [
    ...isExecuteText.matchAll(/\.[A-Za-z_][A-Za-z0-9_]*\((\d+)\)/g),
  ];
  for (const m of genericMatches) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    if (n <= 500) {
      requiredItemIds.push(n);
    } else {
      requiredItemTypes.push(n);
    }
  }

  const dedupSorted = (arr) => [...new Set(arr)].sort((a, b) => a - b);

  astRules.push({
    index: i,
    funcName: execFuncName,
    conditionRaw: isExecuteText,
    requiredItemTypes: dedupSorted(requiredItemTypes),
    requiredItemIds: dedupSorted(requiredItemIds),
  });
}

function getRuleSignature(rule) {
  const ids = (rule.requiredItemIds || []).join(",");
  const types = (rule.requiredItemTypes || []).join(",");
  return `ids:${ids}|types:${types}`;
}

function loadSynergyFunctionNameSet(periodTagForBundle) {
  try {
    const { kcsRequire } = loadBundle({
      useMain: false,
      getMst: getMstFn,
      silent: true,
      periodTag: periodTagForBundle || undefined,
    });
    const allSynergies = kcsRequire(87618);
    return new Set(Object.keys(allSynergies || {}));
  } catch (e) {
    return new Set();
  }
}

function pickReferenceAstRules(currentTag, validNameSet) {
  const outDir = path.join(ROOT, "output");
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^synergy_dict_\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  for (const file of files) {
    const tag = file.replace(/^synergy_dict_/, "").replace(/\.json$/, "");
    if (currentTag && tag === currentTag) continue;
    try {
      const rules = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
      if (!Array.isArray(rules) || rules.length === 0) continue;
      const validCount = rules.filter((r) => validNameSet.has(r?.funcName)).length;
      const ratio = validCount / rules.length;
      if (ratio >= 0.8) {
        return { tag, rules, ratio };
      }
    } catch {}
  }

  return null;
}

const validSynergyNameSet = loadSynergyFunctionNameSet(periodTag);
if (validSynergyNameSet.size > 0) {
  const reference = pickReferenceAstRules(periodTag, validSynergyNameSet);
  if (reference) {
    const sigMap = new Map();
    for (const r of reference.rules) {
      const fn = r?.funcName;
      if (!validSynergyNameSet.has(fn)) continue;
      const sig = getRuleSignature(r);
      if (!sigMap.has(sig)) sigMap.set(sig, new Set());
      sigMap.get(sig).add(fn);
    }

    let replacedBySignature = 0;
    let replacedByIndex = 0;
    for (let i = 0; i < astRules.length; i++) {
      const rule = astRules[i];
      if (validSynergyNameSet.has(rule.funcName)) continue;

      const sig = getRuleSignature(rule);
      const candidates = sigMap.get(sig);
      if (candidates && candidates.size === 1) {
        rule.funcName = [...candidates][0];
        replacedBySignature++;
        continue;
      }

      const refAtIndex = reference.rules[i]?.funcName;
      if (validSynergyNameSet.has(refAtIndex)) {
        rule.funcName = refAtIndex;
        replacedByIndex++;
      }
    }

    const validAfter = astRules.filter((r) => validSynergyNameSet.has(r.funcName)).length;
    console.log(
      `[extract-ast] funcName backfill from ${reference.tag}: signature=${replacedBySignature}, index=${replacedByIndex}, valid=${validAfter}/${astRules.length}`,
    );
  }
}

// Save AST parsed rules
fs.writeFileSync(path.join(ROOT, outputPath), JSON.stringify(astRules, null, 2));
console.log(`[extract-ast] Saved AST parsed rules to ${outputPath}`);
