/**
 * Avro OCF Validator (Pure TypeScript Edition for Cloudflare Workers)
 *
 * Uses @fusou/compaction-core/avro for strict schema & binary OCF validation:
 * - Avro 1.11 Parsing Canonical Form matching against known server schemas
 * - Full streaming Avro OCF decode validation (32-bit int bounds, fatal UTF-8,
 *   block boundaries, sync markers, non-empty record count)
 * - Zero WASM overhead and zero eval() (CSP compliant)
 */

import {
  parseOcfHeader,
  toAvroCanonicalForm,
  validateAvroOcfStrict,
} from "@fusou/compaction-core/avro";
import schemaRegistryData from "../../data/avro-schema-registry.json";

export interface AvroValidationResult {
  valid: boolean;
  recordCount: number;
  errorMessage?: string;
  tableName?: string;
  tableVersion?: string;
}

export interface SchemaMatchInfo {
  matched: boolean;
  tableName?: string;
  version?: string;
  tableVersion?: string;
  error?: string;
}

interface RegistryVersionEntry {
  version: string;
  table_version: string;
  tables: Record<string, number>;
}

interface RegistryFile {
  schemas: string[];
  versions: RegistryVersionEntry[];
}

interface CanonicalMatchEntry {
  version: string;
  tableVersion: string;
  tableName: string;
}

const registry = schemaRegistryData as RegistryFile;

// Lazily built O(1) lookup index: canonicalForm -> ordered list of matching version entries
let canonicalIndexCache: Map<string, CanonicalMatchEntry[]> | null = null;
let versionMapCache: Map<string, RegistryVersionEntry> | null = null;
let availableVersionsSummaryCache: string | null = null;

function ensureRegistryIndex(): {
  canonicalIndex: Map<string, CanonicalMatchEntry[]>;
  versionMap: Map<string, RegistryVersionEntry>;
  availableVersionsSummary: string;
} {
  if (canonicalIndexCache && versionMapCache && availableVersionsSummaryCache !== null) {
    return {
      canonicalIndex: canonicalIndexCache,
      versionMap: versionMapCache,
      availableVersionsSummary: availableVersionsSummaryCache,
    };
  }

  const canonicalByPoolIndex = registry.schemas.map((schemaJson) =>
    toAvroCanonicalForm(schemaJson),
  );
  const canonicalIndex = new Map<string, CanonicalMatchEntry[]>();
  const versionMap = new Map<string, RegistryVersionEntry>();
  const availableLabels: string[] = [];

  for (const verEntry of registry.versions) {
    versionMap.set(verEntry.version, verEntry);
    availableLabels.push(`${verEntry.version}(table:${verEntry.table_version})`);

    // Track first matched table per (canonicalForm, version) to keep version disambiguation deterministic
    const seenCanonicalInVersion = new Set<string>();
    for (const [tableName, poolIdx] of Object.entries(verEntry.tables)) {
      const canonical = canonicalByPoolIndex[poolIdx];
      if (!canonical || seenCanonicalInVersion.has(canonical)) continue;
      seenCanonicalInVersion.add(canonical);

      const list = canonicalIndex.get(canonical);
      const matchEntry: CanonicalMatchEntry = {
        version: verEntry.version,
        tableVersion: verEntry.table_version,
        tableName,
      };
      if (list) {
        list.push(matchEntry);
      } else {
        canonicalIndex.set(canonical, [matchEntry]);
      }
    }
  }

  canonicalIndexCache = canonicalIndex;
  versionMapCache = versionMap;
  availableVersionsSummaryCache = availableLabels.join(", ");

  return {
    canonicalIndex,
    versionMap,
    availableVersionsSummary: availableVersionsSummaryCache,
  };
}

/**
 * No-op initialization hook retained for backwards compatibility.
 */
export async function initWasm(): Promise<void> {
  ensureRegistryIndex();
}

export function get_available_versions(): string[] {
  return registry.versions.map((v) => v.version);
}

export function get_available_schemas(version: string): string[] {
  const { versionMap } = ensureRegistryIndex();
  const entry = versionMap.get(version);
  return entry ? Object.keys(entry.tables) : [];
}

export function get_schema_json(tableName: string, version: string): string {
  const { versionMap } = ensureRegistryIndex();
  const entry = versionMap.get(version);
  if (!entry) {
    const available = get_available_versions();
    const availableStr = available.length ? available.join(", ") : "none";
    return JSON.stringify({
      error: `Unknown version '${version}'. Available versions: ${availableStr}`,
    });
  }
  const poolIdx = entry.tables[tableName];
  if (poolIdx === undefined || registry.schemas[poolIdx] === undefined) {
    return JSON.stringify({
      error: `Table '${tableName}' not found in version '${version}'`,
    });
  }
  return registry.schemas[poolIdx];
}

/**
 * Match client-provided OCF header schema against known server canonical schemas.
 */
export function matchClientSchemaSync(
  schemaJson: string,
  hintTableVersion: string = "",
): SchemaMatchInfo {
  let canonicalClient: string;
  try {
    canonicalClient = toAvroCanonicalForm(schemaJson);
  } catch (error) {
    return {
      matched: false,
      error: `Failed to parse client schema: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const { canonicalIndex, availableVersionsSummary } = ensureRegistryIndex();
  const matches = canonicalIndex.get(canonicalClient);
  if (!matches || matches.length === 0) {
    return {
      matched: false,
      error: `Client schema does not match any known schema. Available versions: ${availableVersionsSummary}`,
    };
  }

  if (hintTableVersion) {
    const hinted = matches.find((m) => m.tableVersion === hintTableVersion);
    if (hinted) {
      return {
        matched: true,
        version: hinted.version,
        tableVersion: hinted.tableVersion,
        tableName: hinted.tableName,
      };
    }
  }

  const first = matches[0]!;
  return {
    matched: true,
    version: first.version,
    tableVersion: first.tableVersion,
    tableName: first.tableName,
  };
}

export async function matchClientSchema(
  schemaJson: string,
  hintTableVersion?: string,
): Promise<SchemaMatchInfo> {
  return matchClientSchemaSync(schemaJson, hintTableVersion ?? "");
}

/**
 * Extract schema JSON from Avro OCF header.
 * Note: Do NOT trust this schema for validation - use matchClientSchema / validateAvroOCFSmart instead.
 */
export function extractSchemaFromOCF(data: Uint8Array): string | null {
  try {
    const header = parseOcfHeader(data);
    return header.metadata["avro.schema"] ?? null;
  } catch {
    return null;
  }
}

/**
 * Validate Avro OCF with explicit schema JSON.
 */
export async function validateAvroOCF(
  data: Uint8Array,
  schemaJson: string,
): Promise<AvroValidationResult> {
  try {
    toAvroCanonicalForm(schemaJson);
  } catch (error) {
    return {
      valid: false,
      recordCount: 0,
      errorMessage: `Failed to parse schema: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const res = await validateAvroOcfStrict(data, { expectedSchema: schemaJson });
  return {
    valid: res.valid,
    recordCount: res.recordCount,
    ...(res.errorMessage !== undefined ? { errorMessage: res.errorMessage } : {}),
  };
}

/**
 * Validate Avro OCF with automatic canonical schema matching against known server schemas.
 */
export async function validateAvroOCFSmart(
  data: Uint8Array,
  hintTableVersion?: string,
): Promise<AvroValidationResult> {
  if (data.length < 4) {
    return {
      valid: false,
      recordCount: 0,
      errorMessage: "Avro file too small",
    };
  }
  if (
    data[0] !== 0x4f ||
    data[1] !== 0x62 ||
    data[2] !== 0x6a ||
    data[3] !== 0x01
  ) {
    return {
      valid: false,
      recordCount: 0,
      errorMessage: "Invalid Avro magic bytes",
    };
  }

  const clientSchemaJson = extractSchemaFromOCF(data);
  if (!clientSchemaJson) {
    return {
      valid: false,
      recordCount: 0,
      errorMessage: "Could not extract schema from OCF header",
    };
  }

  const matchResult = matchClientSchemaSync(clientSchemaJson, hintTableVersion ?? "");
  if (!matchResult.matched) {
    return {
      valid: false,
      recordCount: 0,
      ...(matchResult.error !== undefined ? { errorMessage: matchResult.error } : {}),
    };
  }

  const strictResult = await validateAvroOcfStrict(data);
  return {
    valid: strictResult.valid,
    recordCount: strictResult.recordCount,
    ...(strictResult.errorMessage !== undefined
      ? { errorMessage: strictResult.errorMessage }
      : {}),
    ...(matchResult.tableName !== undefined ? { tableName: matchResult.tableName } : {}),
    ...(matchResult.tableVersion !== undefined
      ? { tableVersion: matchResult.tableVersion }
      : {}),
  };
}

/**
 * Validate Avro OCF against a specific table's canonical schema.
 */
export async function validateAvroOCFByTable(
  data: Uint8Array,
  tableName: string,
  version: string,
): Promise<AvroValidationResult> {
  const { versionMap } = ensureRegistryIndex();
  const verEntry = versionMap.get(version);
  const schemaJson = get_schema_json(tableName, version);
  if (!verEntry || verEntry.tables[tableName] === undefined) {
    return {
      valid: false,
      recordCount: 0,
      errorMessage: schemaJson,
    };
  }

  const res = await validateAvroOcfStrict(data, { expectedSchema: schemaJson });
  return {
    valid: res.valid,
    recordCount: res.recordCount,
    tableName,
    tableVersion: verEntry.table_version,
    ...(res.errorMessage !== undefined ? { errorMessage: res.errorMessage } : {}),
  };
}

/**
 * Lightweight header validation (DoS prevention)
 * Only checks magic bytes and size limit
 */
export function validateAvroHeader(
  data: Uint8Array,
  maxBytes: number = 65536,
): { valid: boolean; error?: string } {
  // Size limit
  if (data.byteLength > maxBytes) {
    return {
      valid: false,
      error: `File too large: ${data.byteLength} bytes (max: ${maxBytes})`,
    };
  }

  // Magic bytes: "Obj\x01"
  if (
    data.byteLength < 4 ||
    data[0] !== 0x4f ||
    data[1] !== 0x62 ||
    data[2] !== 0x6a ||
    data[3] !== 0x01
  ) {
    return { valid: false, error: "Invalid Avro magic bytes" };
  }

  return { valid: true };
}
