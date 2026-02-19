/**
 * Convert kc_api struct_dependency_dot and database_dependency_dot files
 * to ReactFlow graph JSON for API endpoint visualization.
 *
 * Input:  kc_api/tests/struct_dependency_dot/*.dot
 *         kc_api/tests/database_dependency_dot/all.dot
 * Output: FUSOU-WEB/src/data/graphs/endpoints_by_group.json
 *         FUSOU-WEB/src/data/graphs/database_dot.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRUCT_DOT_DIR = resolve(__dirname, "../../kc_api/tests/struct_dependency_dot");
const DB_DOT_DIR = resolve(__dirname, "../../kc_api/tests/database_dependency_dot");
const OUTPUT_DIR = resolve(__dirname, "../src/data/graphs");

/**
 * Parse a DOT record label into a name and list of fields.
 *
 * DOT record label format:
 *   <RecordName> RecordName  | { field1 | <field1> Type1 } | { field2 | <field2> Type2 }
 *
 * The "|" both separates top-level cells AND appears inside "{ name | <handle> type }".
 * We use a regex to match "{ … | … }" pairs directly from the raw label.
 */
function parseRecordLabel(label) {
  if (!label) return { name: "", fields: [] };

  // Unescape DOT escape sequences to temp placeholders
  label = label
    .replace(/\\</g, "\x01")
    .replace(/\\>/g, "\x02")
    .replace(/\\{/g, "\x03")
    .replace(/\\}/g, "\x04")
    .replace(/\\\\/g, "\\");

  // Extract record name from the first cell: "<Name> Name"
  const nameMatch = label.match(/^<(\w+)>\s*(\w+)/);
  const name = nameMatch ? nameMatch[2] : "";

  // Extract all field cells: "{ fieldName | <handle> FieldType }"
  const fieldRegex = /\{\s*(\w+)\s*\|\s*<\w+>\s*([^}]+?)\s*\}/g;
  const fields = [];
  let m;
  while ((m = fieldRegex.exec(label)) !== null) {
    // Restore escaped characters for the type display
    const fieldType = m[2]
      .replace(/\x01/g, "<")
      .replace(/\x02/g, ">")
      .replace(/\x03/g, "{")
      .replace(/\x04/g, "}");
    fields.push({
      name: m[1],
      type: fieldType.trim(),
    });
  }

  return { name, fields };
}

/**
 * Parse a single DOT file into nodes and edges.
 */
function parseDotFile(content, nodeType) {
  const nodes = [];
  const edges = [];

  // Collect subgraph labels
  const subgraphLabels = [];
  const subLabelRegex = /subgraph\s+cluster_\d+\s*\{[^}]*?label="([^"]+)"/gs;
  let slm;
  while ((slm = subLabelRegex.exec(content)) !== null) {
    subgraphLabels.push(slm[1]);
  }
  const groupLabel = subgraphLabels[0] || "";

  // Process line by line
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();

    // Match node: id [label="...", shape=record];
    const nodeMatch = trimmed.match(/^(\w+)\s*\[label="(.+)",\s*shape=record\];?$/);
    if (nodeMatch) {
      const nodeId = nodeMatch[1];
      const rawLabel = nodeMatch[2];
      const parsed = parseRecordLabel(rawLabel);

      const isReq = parsed.name === "Req";
      const isRes = parsed.name === "Res";

      nodes.push({
        id: nodeId,
        type: nodeType,
        position: { x: 0, y: 0 },
        data: {
          structName: parsed.name,
          fields: parsed.fields,
          isReq,
          isRes,
          isDataType: !isReq && !isRes,
        },
      });
      continue;
    }

    // Match edges: source:handle:dir -> target:handle:dir;
    const edgeMatch = trimmed.match(/^(\w+):(\w+):\w+\s*->\s*(\w+):(\w+):\w+;?$/);
    if (edgeMatch) {
      const [, src, srcHandle, tgt, tgtHandle] = edgeMatch;
      edges.push({
        id: `e-${src}-${srcHandle}-${tgt}-${tgtHandle}`,
        source: src,
        sourceHandle: `${src}-${srcHandle}`,
        target: tgt,
        targetHandle: `${tgt}-${tgtHandle}`,
        label: srcHandle,
      });
    }
  }

  return { nodes, edges, label: groupLabel };
}

// ---- Feature variant processing ----

function readFeatureVariants() {
  const variantsPath = resolve(STRUCT_DOT_DIR, "feature_variants.json");
  if (!existsSync(variantsPath)) {
    return { all_features: [], active_features: [], field_diffs: {} };
  }
  return JSON.parse(readFileSync(variantsPath, "utf-8"));
}

/**
 * Annotate endpoint nodes with feature variant diff info.
 *
 * For each feature's field_diffs:
 *   - Fields in both with/without → diffStatus: "changed"
 *   - Fields only with feature (without_feature is null) → diffStatus: "added"
 *   - Fields only without feature (with_feature is null) → injected as diffStatus: "removed"
 */
function annotateWithFeatureVariants(allEndpoints, featureVariants) {
  for (const ep of allEndpoints) {
    for (const node of ep.nodes) {
      const nodeId = node.id;
      for (const [feature, structDiffs] of Object.entries(featureVariants.field_diffs)) {
        const fieldDiffs = structDiffs[nodeId];
        if (!fieldDiffs) continue;

        // Annotate existing fields
        for (const field of node.data.fields) {
          const diff = fieldDiffs[field.name];
          if (diff) {
            if (diff.without_feature === null) {
              field.diffStatus = "added";
            } else if (diff.with_feature !== null) {
              field.diffStatus = "changed";
            }
            field.diffDetail = {
              feature,
              withFeature: diff.with_feature,
              withoutFeature: diff.without_feature,
            };
          }
        }

        // Inject removed fields (with_feature is null → not in default DOT)
        for (const [fieldName, diff] of Object.entries(fieldDiffs)) {
          if (diff.with_feature === null && diff.without_feature !== null) {
            node.data.fields.push({
              name: fieldName,
              type: diff.without_feature,
              diffStatus: "removed",
              diffDetail: {
                feature,
                withFeature: diff.with_feature,
                withoutFeature: diff.without_feature,
              },
            });
          }
        }
      }
    }
  }
}

// ---- Endpoint processing ----

function processEndpoints() {
  if (!existsSync(STRUCT_DOT_DIR)) {
    console.warn(`DOT directory not found: ${STRUCT_DOT_DIR}`);
    writeFileSync(resolve(OUTPUT_DIR, "endpoints_by_group.json"), JSON.stringify({ groups: {} }, null, 2));
    return;
  }

  const dotFiles = readdirSync(STRUCT_DOT_DIR).filter(
    (f) => f.endsWith(".dot") && f !== "all.dot"
  );

  const groups = {};
  const allEndpoints = [];

  for (const file of dotFiles) {
    const content = readFileSync(resolve(STRUCT_DOT_DIR, file), "utf-8");
    const parsed = parseDotFile(content, "endpointNode");

    const nameNoExt = basename(file, ".dot");
    const atIndex = nameNoExt.indexOf("@");
    if (atIndex === -1) continue;

    const groupName = nameNoExt.substring(0, atIndex);
    const endpointName = nameNoExt.substring(atIndex + 1);

    if (!groups[groupName]) {
      groups[groupName] = {
        groupName,
        displayName: groupName.replace(/_/g, " "),
        endpoints: [],
      };
    }

    const endpointPath = `${groupName}/${endpointName}`;

    const endpoint = {
      name: endpointName,
      path: endpointPath,
      label: parsed.label,
      nodes: parsed.nodes,
      edges: parsed.edges,
    };

    groups[groupName].endpoints.push(endpoint);
    allEndpoints.push({ group: groupName, ...endpoint });
  }

  for (const group of Object.values(groups)) {
    group.endpoints.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Read feature variants and annotate endpoints
  const featureVariants = readFeatureVariants();
  annotateWithFeatureVariants(allEndpoints, featureVariants);

  const sortedGroups = Object.fromEntries(
    Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
  );

  const output = {
    groups: sortedGroups,
    totalEndpoints: allEndpoints.length,
    totalGroups: Object.keys(sortedGroups).length,
    featureVariants: {
      allFeatures: featureVariants.all_features,
      activeFeatures: featureVariants.active_features,
      fieldDiffs: featureVariants.field_diffs,
    },
  };

  const outputPath = resolve(OUTPUT_DIR, "endpoints_by_group.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));

  let totalFields = 0;
  for (const ep of allEndpoints) {
    for (const node of ep.nodes) {
      totalFields += node.data.fields.length;
    }
  }
  console.log(`✓ ${output.totalEndpoints} endpoints, ${output.totalGroups} groups, ${totalFields} total fields → ${outputPath}`);
}

// ---- Database DOT processing ----

function processDatabaseDot() {
  const dotPath = resolve(DB_DOT_DIR, "all.dot");
  if (!existsSync(dotPath)) {
    console.warn(`Database DOT not found: ${dotPath}`);
    writeFileSync(resolve(OUTPUT_DIR, "database_dot.json"), JSON.stringify({ nodes: [], edges: [] }, null, 2));
    return;
  }

  const content = readFileSync(dotPath, "utf-8");
  const parsed = parseDotFile(content, "schemaTableNode");

  // Enrich nodes with DB-specific metadata
  for (const node of parsed.nodes) {
    const d = node.data;
    // Convert PascalCase to snake_case for table name
    d.tableName = d.structName
      .replace(/([A-Z])/g, (c, _, i) => (i > 0 ? `_${c.toLowerCase()}` : c.toLowerCase()));
    d.recordName = d.structName;

    for (const field of d.fields) {
      field.isKey = field.name === "uuid";
      field.isFk = !field.isKey && field.name !== "env_uuid" && /\w+Id/.test(field.type);
      field.isEnvRef = field.name === "env_uuid";
    }
  }

  const outputPath = resolve(OUTPUT_DIR, "database_dot.json");
  writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  console.log(`✓ database DOT: ${parsed.nodes.length} tables, ${parsed.edges.length} edges → ${outputPath}`);
}

// ---- Main ----
processEndpoints();
processDatabaseDot();
