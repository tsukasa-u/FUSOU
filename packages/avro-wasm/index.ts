/**
 * @fusou/avro-wasm - WebAssembly Avro OCF Validator
 * 
 * Provides strict schema validation using Rust's apache-avro
 * Optimized for Cloudflare Workers (481KB WASM)
 */

// For web target, we import the init function and wasm module
import init, {
  validate_avro_ocf as wasm_validate_avro_ocf,
  validate_avro_ocf_smart as wasm_validate_avro_ocf_smart,
  validate_avro_ocf_by_table as wasm_validate_avro_ocf_by_table,
  match_client_schema as wasm_match_client_schema,
  get_schema_for_version as wasm_get_schema_for_version,
  get_available_schemas as wasm_get_available_schemas,
  get_all_available_schemas as wasm_get_all_available_schemas,
  get_available_versions as wasm_get_available_versions,
  get_schema_json as wasm_get_schema_json,
  init_panic_hook,
  type ValidationResult,
  type SchemaMatchResult,
} from './pkg/avro_wasm.js';

// Import WASM binary for Cloudflare Workers
// @ts-ignore - WASM module import
import wasmModule from './pkg/avro_wasm_bg.wasm';

let wasmInitialized = false;

/**
 * Initialize the WASM module.
 * For web target, we must call init() with the WASM module.
 */
export async function initWasm(): Promise<void> {
  if (wasmInitialized) {
    return;
  }
  
  try {
    // For Cloudflare Workers, wasmModule is a WebAssembly.Module
    // For browsers, it would be a URL or ArrayBuffer
    await init(wasmModule);
    init_panic_hook();
    wasmInitialized = true;
  } catch (e) {
    console.error('[avro-wasm] Failed to initialize WASM:', e);
    throw e;
  }
}

// ==================== Re-export WASM functions ====================

// Raw WASM functions (snake_case)
export const validate_avro_ocf = wasm_validate_avro_ocf;
export const validate_avro_ocf_smart = wasm_validate_avro_ocf_smart;
export const validate_avro_ocf_by_table = wasm_validate_avro_ocf_by_table;
export const match_client_schema = wasm_match_client_schema;
export const get_schema_for_version = wasm_get_schema_for_version;
export const get_available_schemas = wasm_get_available_schemas;
export const get_all_available_schemas = wasm_get_all_available_schemas;
export const get_available_versions = wasm_get_available_versions;
export const get_schema_json = wasm_get_schema_json;

// Re-export types
export type { ValidationResult, SchemaMatchResult };

// ==================== Helper wrapper functions ====================

export interface AvroValidationResult {
  valid: boolean;
  recordCount: number;
  errorMessage?: string;
  tableName?: string;
  schemaVersion?: string;
}

/**
 * Validate Avro OCF with explicit schema JSON
 */
export async function validateAvroOCF(
  data: Uint8Array,
  schemaJson: string
): Promise<AvroValidationResult> {
  await initWasm();

  const result = wasm_validate_avro_ocf(data, schemaJson);

  return {
    valid: result.valid,
    recordCount: result.record_count ?? 0,
    errorMessage: result.error_message ?? undefined,
    tableName: result.table_name ?? undefined,
    schemaVersion: result.schema_version ?? undefined,
  };
}

/**
 * Validate Avro OCF with automatic canonical schema matching
 * This is the recommended function for strict validation of untrusted data
 */
export async function validateAvroOCFSmart(
  data: Uint8Array
): Promise<AvroValidationResult> {
  await initWasm();

  const result = wasm_validate_avro_ocf_smart(data);

  return {
    valid: result.valid,
    recordCount: result.record_count ?? 0,
    errorMessage: result.error_message ?? undefined,
    tableName: result.table_name ?? undefined,
    schemaVersion: result.schema_version ?? undefined,
  };
}

/**
 * Validate Avro OCF against a specific table's canonical schema
 */
export async function validateAvroOCFByTable(
  data: Uint8Array,
  tableName: string,
  version: string
): Promise<AvroValidationResult> {
  await initWasm();

  const result = wasm_validate_avro_ocf_by_table(data, tableName, version);

  return {
    valid: result.valid,
    recordCount: result.record_count ?? 0,
    errorMessage: result.error_message ?? undefined,
    tableName: result.table_name ?? tableName,
    schemaVersion: result.schema_version ?? version,
  };
}

export interface SchemaMatchInfo {
  matched: boolean;
  tableName?: string;
  version?: string;
  error?: string;
}

/**
 * Match client schema against known canonical schemas
 */
export async function matchClientSchema(
  schemaJson: string
): Promise<SchemaMatchInfo> {
  await initWasm();

  const result = wasm_match_client_schema(schemaJson);

  return {
    matched: result.matched,
    tableName: result.table_name ?? undefined,
    version: result.version ?? undefined,
    error: result.error ?? undefined,
  };
}

// Default export for convenience
export default {
  initWasm,
  validateAvroOCF,
  validateAvroOCFSmart,
  validateAvroOCFByTable,
  matchClientSchema,
  validate_avro_ocf,
  validate_avro_ocf_smart,
  validate_avro_ocf_by_table,
  match_client_schema,
  get_available_schemas,
  get_available_versions,
  get_schema_json,
};
