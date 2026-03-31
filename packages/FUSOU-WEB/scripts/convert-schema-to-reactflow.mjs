/**
 * Convert kc_api generated Avro schemas to ReactFlow graph JSON.
 *
 * Input:  kc_api/generated-schemas/schema_v*.json, master_schema_v*.json
 * Output: FUSOU-WEB/src/data/graphs/db_v*.json
 *
 * Each output file contains { nodes, edges } ready for ReactFlow consumption.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = resolve(__dirname, "../../kc_api/generated-schemas");
const OUTPUT_DIR = resolve(__dirname, "../src/data/graphs");

const MASTER_TABLE_ALIASES = new Map([
  ["mst_ship", "mst_ship"],
  ["mst_ships", "mst_ship"],
  ["mst_slotitem", "mst_slotitem"],
  ["mst_slot_item", "mst_slotitem"],
  ["mst_slot_items", "mst_slotitem"],
  ["mst_slotitem_equiptype", "mst_slotitem_equiptype"],
  ["mst_slotitem_equip_type", "mst_slotitem_equiptype"],
  ["mst_slotitem_equip_types", "mst_slotitem_equiptype"],
  ["mst_shipgraph", "mst_shipgraph"],
  ["mst_ship_graph", "mst_shipgraph"],
  ["mst_ship_graphs", "mst_shipgraph"],
  ["mst_ship_upgrade", "mst_ship_upgrade"],
  ["mst_ship_upgrades", "mst_ship_upgrade"],
  ["mst_use_item", "mst_payitem"],
  ["mst_use_items", "mst_payitem"],
  ["mst_maparea", "mst_map_area"],
  ["mst_map_areas", "mst_map_area"],
  ["mst_mapinfo", "mst_map_info"],
  ["mst_map_infos", "mst_map_info"],
  ["mst_equip_exslot_ship", "mst_equip_exslot_ship"],
  ["mst_equip_exslot_ships", "mst_equip_exslot_ship"],
  ["mst_equip_exslot", "mst_equip_exslot"],
  ["mst_equip_exslots", "mst_equip_exslot"],
  ["mst_equip_limit_exslot", "mst_equip_limit_exslot"],
  ["mst_equip_limit_exslots", "mst_equip_limit_exslot"],
  ["mst_equip_ship", "mst_equip_ship"],
  ["mst_equip_ships", "mst_equip_ship"],
  ["mst_stype", "mst_stype"],
  ["mst_stypes", "mst_stype"],
]);

// Shared per-source overrides for all tables (master/non-master).
// Key format: `${sourceTable}.${fieldName}` -> target table or [target tables].
const SOURCE_FIELD_TARGET_OVERRIDES = new Map([
  ["mst_map_info.maparea_id", "mst_map_area"],
  ["mst_ship_upgrade.api_current_ship_id", ["mst_ship", "mst_shipgraph"]],
  ["mst_ship_upgrade.api_original_ship_id", ["mst_ship", "mst_shipgraph"]],
  ["mst_ship.aftershipid", ["mst_ship", "mst_shipgraph"]],
  ["mst_ship.stype", "mst_stype"],
  ["mst_slotitem.type", "mst_slotitem_equiptype"],
  ["own_ship.ship_id", ["mst_ship", "mst_shipgraph"]],
  ["enemy_ship.mst_ship_id", ["mst_ship", "mst_shipgraph"]],
  ["friend_ship.mst_ship_id", ["mst_ship", "mst_shipgraph"]],
  ["cells.maparea_id", "mst_map_info"],
]);

// Shared generic field mappings (fallback when source-specific mapping is absent).
const FIELD_TARGET_OVERRIDES = new Map([
  ["equip", "mst_slotitem"],
  ["si", "mst_slotitem"],
]);

function normalizeMasterTableName(name) {
  return MASTER_TABLE_ALIASES.get(name) || name;
}

function normalizeTargets(targetValue) {
  if (!targetValue) return [];
  const list = Array.isArray(targetValue) ? targetValue : [targetValue];
  return [...new Set(list.map((t) => normalizeMasterTableName(t)))];
}

function resolveOverrideTargets(fieldName, sourceTable = "") {
  if (sourceTable) {
    const sourceSpecific = SOURCE_FIELD_TARGET_OVERRIDES.get(
      `${sourceTable}.${fieldName}`,
    );
    if (sourceSpecific) return normalizeTargets(sourceSpecific);
  }

  const generic = FIELD_TARGET_OVERRIDES.get(fieldName);
  return normalizeTargets(generic);
}

function resolveOverrideTarget(fieldName, sourceTable = "") {
  return resolveOverrideTargets(fieldName, sourceTable)[0] ?? null;
}

/** Compare version keys like "v0_4" vs "v1_0" numerically */
function compareVersionKeys(a, b) {
  const parse = (k) => {
    const m = k.match(/^v(\d+)_(\d+)$/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
  };
  const [aMajor, aMinor] = parse(a);
  const [bMajor, bMinor] = parse(b);
  return aMajor !== bMajor ? aMajor - bMajor : aMinor - bMinor;
}

/** Auto-detect schema versions by scanning for schema_v*.json files */
function detectVersions() {
  if (!existsSync(SCHEMAS_DIR)) {
    console.warn(`Schemas directory not found: ${SCHEMAS_DIR}`);
    return [];
  }
  return readdirSync(SCHEMAS_DIR)
    .map((f) => f.match(/^schema_(v\d+_\d+)\.json$/)?.[1])
    .filter(Boolean)
    .sort(compareVersionKeys);
}

/** Compute major version grouping from sorted version keys */
function computeMajorVersions(versions) {
  const groups = {};
  for (const vKey of versions) {
    const m = vKey.match(/^v(\d+)_(\d+)$/);
    if (!m) continue;
    const majorKey = `v${m[1]}`;
    if (!groups[majorKey]) {
      groups[majorKey] = { versions: [], latest: null };
    }
    groups[majorKey].versions.push(vKey);
    groups[majorKey].latest = vKey; // Last in sorted order = latest
  }
  return groups;
}

const VERSIONS = detectVersions();
if (VERSIONS.length === 0) {
  console.error("No schema_v*.json files found. Exiting.");
  process.exit(1);
}
console.log(`Detected versions: ${VERSIONS.join(", ")}`);

/** Parse an Avro type and return a human-readable string + whether it is a UUID reference */
function parseAvroType(avroType) {
  if (typeof avroType === "string") {
    return { display: avroType, isUuid: false };
  }
  if (Array.isArray(avroType)) {
    // Union type, e.g. ["null", "int"] or ["null", {"type":"string","logicalType":"uuid"}]
    const nonNull = avroType.filter((t) => t !== "null");
    const isNullable = avroType.includes("null");
    if (nonNull.length === 1) {
      const inner = parseAvroType(nonNull[0]);
      return {
        display: isNullable ? `${inner.display}?` : inner.display,
        isUuid: inner.isUuid,
      };
    }
    return {
      display: avroType.map((t) => parseAvroType(t).display).join(" | "),
      isUuid: false,
    };
  }
  if (typeof avroType === "object") {
    if (avroType.logicalType === "uuid") {
      return { display: "uuid", isUuid: true };
    }
    if (avroType.type === "array") {
      const inner = parseAvroType(avroType.items);
      return { display: `${inner.display}[]`, isUuid: inner.isUuid };
    }
    if (avroType.type === "record") {
      return { display: avroType.name, isUuid: false };
    }
    return { display: JSON.stringify(avroType), isUuid: false };
  }
  return { display: String(avroType), isUuid: false };
}

/**
 * Detect UUID reference edges between tables.
 * Convention: a field whose name looks like `xxx_uuid` (other than `env_uuid` and `uuid` itself)
 * or whose type is uuid with a name matching another table, indicates a reference.
 */
function inferEdges(tables) {
  const tableNameSet = new Set(tables.map((t) => t.table_name));
  const tableByRecord = new Map();
  for (const t of tables) {
    const schema = JSON.parse(t.schema);
    tableByRecord.set(schema.name, t.table_name);
  }

  const edges = [];

  for (const t of tables) {
    const schema = JSON.parse(t.schema);
    for (const field of schema.fields) {
      const parsed = parseAvroType(field.type);

      if (!parsed.isUuid) continue;
      // Skip self-referencing uuid and env_uuid
      if (field.name === "uuid" || field.name === "env_uuid") continue;

      // Try to find which table this UUID points to based on field name conventions
      // e.g. "battles" -> "battle", "ship_ids" -> own_ship/enemy_ship/friend_ship,
      //      "slotid" -> own_slotitem, "airbase_id" -> airbase
      const target = resolveTarget(field.name, t.table_name, tables);
      if (target) {
        edges.push({
          id: `e-${t.table_name}-${field.name}-${target}`,
          source: t.table_name,
          sourceHandle: `${t.table_name}-${field.name}`,
          target,
          targetHandle: `${target}-uuid`,
          label: field.name,
        });
      }
    }
  }

  return edges;
}

function resolveTarget(fieldName, sourceTable, tables) {
  const tableNames = tables.map((t) => t.table_name);

  const overridden = resolveOverrideTarget(fieldName, sourceTable);
  if (
    overridden &&
    tableNames.includes(overridden) &&
    overridden !== sourceTable
  ) {
    return overridden;
  }

  // Direct match: field_name minus common suffixes
  const candidates = [
    fieldName,
    fieldName.replace(/_id$/, ""),
    fieldName.replace(/_ids$/, ""),
    fieldName.replace(/_uuid$/, ""),
    fieldName.replace(/s$/, ""),
  ];

  for (const candidate of candidates) {
    // Exact match
    if (tableNames.includes(candidate) && candidate !== sourceTable) {
      return candidate;
    }
    // Snake_case match
    const snaked = candidate
      .replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)
      .replace(/^_/, "");
    if (tableNames.includes(snaked) && snaked !== sourceTable) {
      return snaked;
    }
  }

  // Special known mappings based on database_dependency_dot analysis
  const knownMappings = {
    battles: "battle",
    ship_ids: null, // contextual: own_ship, enemy_ship, friend_ship depending on source
    slotid: "own_slotitem",
    slot: null, // contextual
    slot_ex: null,
    plane_info: "plane_info",
    air_base_air_attack: "airbase_airattack",
    air_base_assault: "airbase_assult",
    carrier_base_assault: "carrierbase_assault",
    air_base_air_attacks: "airbase_airattack_list",
    opening_air_attack: "opening_airattack",
    opening_taisen: "opening_taisen_list",
    support_hourai: "support_hourai",
    support_airattack: "support_airattack",
    opening_raigeki: "opening_raigeki",
    hougeki: "hougeki_list",
    closing_raigeki: "closing_raigeki",
    friendly_force_attack: "friendly_support_hourai_list",
    midnight_hougeki: "midnight_hougeki_list",
    hourai_list: "friendly_support_hourai",
    airbase_id: "airbase",
    f_deck_id: "own_deck",
    e_deck_id: "enemy_deck",
    friend_deck_id: "friend_deck",
    support_deck_id: "support_deck",
  };

  if (fieldName in knownMappings) {
    const mapped = knownMappings[fieldName];
    if (mapped && tableNames.includes(mapped)) {
      return mapped;
    }
    // Contextual: try to match by source table prefix
    if (mapped === null) {
      if (sourceTable.startsWith("own") && tableNames.includes("own_ship"))
        return "own_ship";
      if (sourceTable.startsWith("enemy") && tableNames.includes("enemy_ship"))
        return "enemy_ship";
      if (
        sourceTable.startsWith("friend") &&
        tableNames.includes("friend_ship")
      )
        return "friend_ship";
      if (sourceTable.startsWith("support") && tableNames.includes("own_ship"))
        return "own_ship";
    }
  }

  return null;
}

function buildMasterDataNodesFromAvro(version) {
  const masterPath = resolve(SCHEMAS_DIR, `master_schema_${version}.json`);
  if (!existsSync(masterPath)) {
    throw new Error(
      `Required master schema file not found: ${masterPath}. Run kc_api/scripts/generate-schemas.sh first.`,
    );
  }

  const raw = JSON.parse(readFileSync(masterPath, "utf-8"));
  if (!Array.isArray(raw.schemas)) {
    throw new Error(`Invalid master schema format: ${masterPath}`);
  }

  const nodes = [];
  for (const table of raw.schemas) {
    if (!table?.table_name || !table?.schema) continue;

    let schema;
    try {
      schema =
        typeof table.schema === "string"
          ? JSON.parse(table.schema)
          : table.schema;
    } catch {
      continue;
    }

    if (!schema || schema.type !== "record" || !Array.isArray(schema.fields)) {
      continue;
    }

    const tableName = normalizeMasterTableName(table.table_name);
    const fields = schema.fields.map((f) => {
      const parsed = parseAvroType(f.type);
      const masterTargets = resolveMasterTargets(f.name, tableName);
      return {
        name: f.name,
        type: parsed.display,
        isUuid: parsed.isUuid,
        isKey: f.name === "id" || f.name === "api_id" || f.name === "uuid",
        isFk:
          (parsed.isUuid && f.name !== "uuid" && f.name !== "env_uuid") ||
          masterTargets.some((target) => target !== tableName),
      };
    });

    nodes.push({
      id: tableName,
      type: "schemaTableNode",
      position: { x: 0, y: 0 },
      data: {
        tableName,
        recordName: schema.name || tableName,
        fields,
      },
    });
  }

  // Deduplicate by canonical table id (alias names can collapse)
  const dedup = new Map();
  for (const node of nodes) {
    if (!dedup.has(node.id)) dedup.set(node.id, node);
  }

  const deduped = [...dedup.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (deduped.length === 0) {
    throw new Error(`No master schemas found in: ${masterPath}`);
  }

  return deduped;
}

function resolveMasterTarget(fieldName, sourceTable = "") {
  const overridden = resolveOverrideTarget(fieldName, sourceTable);
  if (overridden) return overridden;

  if (/^mst_[a-z0-9_]+_id$/.test(fieldName)) {
    return normalizeMasterTableName(fieldName.replace(/_id$/, ""));
  }

  return null;
}

function resolveMasterTargets(fieldName, sourceTable = "") {
  const overrides = resolveOverrideTargets(fieldName, sourceTable);
  if (overrides.length > 0) return overrides;

  if (/^mst_[a-z0-9_]+_id$/.test(fieldName)) {
    return [normalizeMasterTableName(fieldName.replace(/_id$/, ""))];
  }

  return [];
}

function inferMasterEdges(nodes, masterNodeIds) {
  const edges = [];

  for (const node of nodes) {
    const fields = node.data?.fields || [];
    for (const field of fields) {
      if (!field.isFk) continue;
      const targets = resolveMasterTargets(field.name, node.id);
      for (const target of targets) {
        if (!masterNodeIds.has(target) || target === node.id) continue;

        edges.push({
          id: `e-${node.id}-${field.name}-${target}`,
          source: node.id,
          sourceHandle: `${node.id}-${field.name}`,
          target,
          targetHandle: `${target}-uuid`,
          label: field.name,
        });
      }
    }
  }

  return edges;
}

function mergeMasterDataGraph(result, masterNodes) {
  if (!result || masterNodes.length === 0) return;

  const nodeById = new Map(result.nodes.map((n) => [n.id, n]));
  for (const master of masterNodes) {
    if (!nodeById.has(master.id)) {
      nodeById.set(master.id, master);
    }
  }

  const mergedNodes = [...nodeById.values()];
  const masterNodeIds = new Set(masterNodes.map((n) => n.id));
  const masterEdges = inferMasterEdges(mergedNodes, masterNodeIds);

  const edgeById = new Map();
  for (const edge of [...result.edges, ...masterEdges]) {
    edgeById.set(edge.id, edge);
  }

  result.nodes = mergedNodes.sort((a, b) => a.id.localeCompare(b.id));
  result.edges = [...edgeById.values()].sort((a, b) => a.id.localeCompare(b.id));
  result.tableCount = result.nodes.length;
  result.masterTableCount = masterNodes.length;
}

function convertVersion(version) {
  const filePath = resolve(SCHEMAS_DIR, `schema_${version}.json`);
  if (!existsSync(filePath)) {
    console.warn(`Schema file not found: ${filePath}, skipping.`);
    return null;
  }

  const raw = JSON.parse(readFileSync(filePath, "utf-8"));
  const tables = raw.schemas;
  const tableVersion = raw.table_version;

  const nodes = [];
  for (const t of tables) {
    const schema = JSON.parse(t.schema);
    const fields = schema.fields.map((f) => {
      const parsed = parseAvroType(f.type);
      const isMasterRef = /^mst_[a-z0-9_]+_id$/.test(f.name);
      const masterTargets = resolveMasterTargets(f.name, t.table_name);
      return {
        name: f.name,
        type: parsed.display,
        isUuid: parsed.isUuid,
        isKey: f.name === "uuid",
        isFk:
          (parsed.isUuid && f.name !== "uuid" && f.name !== "env_uuid") ||
          isMasterRef ||
          masterTargets.some((target) => target !== t.table_name),
      };
    });

    nodes.push({
      id: t.table_name,
      type: "schemaTableNode",
      position: { x: 0, y: 0 }, // Will be laid out by dagre
      data: {
        tableName: t.table_name,
        recordName: schema.name,
        fields,
      },
    });
  }

  const edges = inferEdges(tables);

  nodes.sort((a, b) => a.id.localeCompare(b.id));
  edges.sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: tableVersion,
    versionKey: version,
    tableCount: tables.length,
    nodes,
    edges,
  };
}

/**
 * Compute field-level diff between two version results.
 * Returns per-table diff: { tableName: { added: [...], removed: [...], changed: [...] } }
 */
function computeVersionDiff(older, newer) {
  if (!older || !newer) return {};
  const olderTables = new Map(older.nodes.map((n) => [n.id, n.data]));
  const newerTables = new Map(newer.nodes.map((n) => [n.id, n.data]));
  const diff = {};

  // Tables added in newer
  for (const [id, data] of newerTables) {
    if (!olderTables.has(id)) {
      diff[id] = {
        status: "added",
        addedFields: data.fields.map((f) => f.name),
        removedFields: [],
        changedFields: [],
      };
    }
  }
  // Tables removed in newer
  for (const [id, data] of olderTables) {
    if (!newerTables.has(id)) {
      diff[id] = {
        status: "removed",
        addedFields: [],
        removedFields: data.fields.map((f) => f.name),
        changedFields: [],
      };
    }
  }
  // Tables in both - check fields
  for (const [id, newerData] of newerTables) {
    const olderData = olderTables.get(id);
    if (!olderData) continue;
    const olderFieldNames = new Set(olderData.fields.map((f) => f.name));
    const newerFieldNames = new Set(newerData.fields.map((f) => f.name));
    const olderFieldMap = new Map(olderData.fields.map((f) => [f.name, f]));
    const newerFieldMap = new Map(newerData.fields.map((f) => [f.name, f]));

    const addedFields = [...newerFieldNames].filter(
      (n) => !olderFieldNames.has(n),
    );
    const removedFields = [...olderFieldNames].filter(
      (n) => !newerFieldNames.has(n),
    );
    const changedFields = [...newerFieldNames]
      .filter((n) => olderFieldNames.has(n))
      .filter((n) => olderFieldMap.get(n).type !== newerFieldMap.get(n).type);

    if (addedFields.length || removedFields.length || changedFields.length) {
      diff[id] = {
        status: "changed",
        addedFields,
        removedFields,
        changedFields,
      };
    }
  }
  return diff;
}

// ---- DOT edge merging ----

/**
 * Read the DOT-based database graph (generated by convert-dot-to-reactflow.mjs)
 * and extract edges mapped to Avro table name IDs.
 *
 * DOT provides richer FK relationship data (98 edges from Rust type analysis)
 * compared to Avro's heuristic-based UUID inference (34 edges).
 * We merge DOT edges into the Avro version data for a unified view.
 */
function loadDotEdges(avroRecordNames) {
  const dotPath = resolve(OUTPUT_DIR, "database_dot.json");
  if (!existsSync(dotPath)) {
    console.warn("database_dot.json not found, using Avro-inferred edges only");
    return null;
  }

  const dotData = JSON.parse(readFileSync(dotPath, "utf-8"));

  // Build mapping: DOT node ID → tableName (from DOT node data)
  const dotIdToTable = new Map();
  // Also build: recordName → tableName for matching
  const recordToTable = new Map();
  for (const node of dotData.nodes) {
    dotIdToTable.set(node.id, node.data.tableName);
    recordToTable.set(
      node.data.recordName || node.data.structName,
      node.data.tableName,
    );
  }

  // Build mapping: DOT tableName → Avro tableName (match by recordName)
  // Avro uses actual DB table names, DOT derives them from PascalCase struct names.
  // We map through recordName which is shared between both.
  const dotTableToAvroTable = new Map();
  for (const [recordName, dotTable] of recordToTable) {
    const avroTable = avroRecordNames.get(recordName);
    if (avroTable) {
      dotTableToAvroTable.set(dotTable, avroTable);
    }
  }

  // Convert DOT edges to use Avro table name IDs
  const mappedEdges = [];
  for (const edge of dotData.edges) {
    const sourceTable = dotIdToTable.get(edge.source);
    const targetTable = dotIdToTable.get(edge.target);
    if (!sourceTable || !targetTable) continue;

    const avroSource = dotTableToAvroTable.get(sourceTable) || sourceTable;
    const avroTarget = dotTableToAvroTable.get(targetTable) || targetTable;

    // Filter out self-referential PK edges (uuid -> own type)
    if (avroSource === avroTarget && edge.label === "uuid") continue;

    mappedEdges.push({
      id: `e-${avroSource}-${edge.label}-${avroTarget}`,
      source: avroSource,
      sourceHandle: `${avroSource}-${edge.label}`,
      target: avroTarget,
      targetHandle: `${avroTarget}-uuid`,
      label: edge.label,
    });
  }

  // Also collect isEnvRef info from DOT data
  const envRefFields = new Map(); // tableName -> Set of field names that are env refs
  for (const node of dotData.nodes) {
    const table =
      dotTableToAvroTable.get(node.data.tableName) || node.data.tableName;
    const envRefs = new Set();
    for (const field of node.data.fields) {
      if (field.isEnvRef) envRefs.add(field.name);
    }
    if (envRefs.size > 0) envRefFields.set(table, envRefs);
  }

  return { edges: mappedEdges, envRefFields };
}

/**
 * Merge DOT metadata (isEnvRef) into Avro nodes.
 */
function enrichAvroNodes(nodes, envRefFields) {
  if (!envRefFields) return nodes;
  return nodes.map((node) => {
    const envRefs = envRefFields.get(node.id);
    if (!envRefs) return node;
    return {
      ...node,
      data: {
        ...node.data,
        fields: node.data.fields.map((f) => ({
          ...f,
          isEnvRef: envRefs.has(f.name) || false,
        })),
      },
    };
  });
}

// ---- Main ----

const results = {};
for (const version of VERSIONS) {
  results[version] = convertVersion(version);
}

// Build a mapping of recordName → avroTableName from the latest version
const avroRecordNames = new Map();
for (const version of VERSIONS) {
  const result = results[version];
  if (result) {
    for (const node of result.nodes) {
      avroRecordNames.set(node.data.recordName, node.id);
    }
  }
}

// Load DOT edges for merging
const dotMerge = loadDotEdges(avroRecordNames);

const allVersions = {};
for (const version of VERSIONS) {
  const result = results[version];
  if (result) {
    const masterNodes = buildMasterDataNodesFromAvro(version);

    // Merge DOT edges (richer relationship data) into Avro version data
    if (dotMerge) {
      // Filter DOT edges to only include nodes present in this version
      const nodeIds = new Set(result.nodes.map((n) => n.id));
      result.edges = dotMerge.edges.filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
      );
      // Enrich nodes with isEnvRef from DOT
      result.nodes = enrichAvroNodes(result.nodes, dotMerge.envRefFields);
    }

    mergeMasterDataGraph(result, masterNodes);

    const outputPath = resolve(OUTPUT_DIR, `db_${version}.json`);
    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    allVersions[version] = {
      tableCount: result.tableCount,
      version: result.version,
    };
    console.log(
      `✓ ${version}: ${result.tableCount} tables, ${result.edges.length} edges → ${outputPath}`,
    );
  }
}

// Compute and write version diffs
const diffs = {};
for (let i = 1; i < VERSIONS.length; i++) {
  const older = results[VERSIONS[i - 1]];
  const newer = results[VERSIONS[i]];
  const key = `${VERSIONS[i - 1]}_to_${VERSIONS[i]}`;
  diffs[key] = computeVersionDiff(older, newer);
  const changeCount = Object.keys(diffs[key]).length;
  console.log(`✓ diff ${key}: ${changeCount} tables changed`);
}

// Write version index with diff info and major version grouping
const majorVersions = computeMajorVersions(VERSIONS);
writeFileSync(
  resolve(OUTPUT_DIR, "db_versions.json"),
  JSON.stringify(
    {
      versions: allVersions,
      sortedVersions: [...VERSIONS],
      majorVersions,
      diffs,
    },
    null,
    2,
  ),
);
console.log(
  `✓ db_versions.json written (majors: ${Object.keys(majorVersions).join(", ")})`,
);
