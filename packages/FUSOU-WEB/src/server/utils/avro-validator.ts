/**
 * Avro OCF Validator (WASM Edition for Cloudflare Workers)
 * 
 * Uses Rust+WASM apache-avro implementation for strict schema validation
 * - Canonical schema matching against known schemas
 * - Full Avro OCF decode validation
 * - No eval() - CSP compliant
 * 
 * Security:
 * - Client schemas are matched against server-side canonical schemas
 * - Rejects data with unknown or tampered schemas
 * - Uses Rust's apache-avro for reliable validation
 */

export {
  // Initialization
  initWasm,

  // High-level wrapper functions (recommended)
  validateAvroOCF,
  validateAvroOCFSmart,
  validateAvroOCFByTable,
  matchClientSchema,

  // Low-level WASM functions (snake_case)
  validate_avro_ocf,
  validate_avro_ocf_smart,
  validate_avro_ocf_by_table,
  match_client_schema,
  get_available_schemas,
  get_available_versions,
  get_schema_json,

  // Types
  type AvroValidationResult,
  type SchemaMatchInfo,
  type ValidationResult,
  type SchemaMatchResult,
} from '@fusou/avro-wasm';

/**
 * Extract schema JSON from Avro OCF header
 * Note: Do NOT trust this schema for validation - use matchClientSchema instead
 */
export function extractSchemaFromOCF(data: Uint8Array): string | null {
  try {
    // Parse magic bytes
    if (data.length < 4 || data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
      return null;
    }

    // Search for schema in header (simplified extraction)
    const headerSlice = data.slice(0, Math.min(data.length, 4096));
    const text = new TextDecoder().decode(headerSlice);

    const idx = text.indexOf('avro.schema');
    if (idx === -1) return null;

    const startBrace = text.indexOf('{', idx);
    if (startBrace === -1) return null;

    let depth = 0;
    let endBrace = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\') {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (ch === '{') depth++;
        if (ch === '}') {
          depth--;
          if (depth === 0) {
            endBrace = i;
            break;
          }
        }
      }
    }

    if (endBrace === -1) return null;
    return text.slice(startBrace, endBrace + 1);
  } catch {
    return null;
  }
}

/**
 * Lightweight header validation (DoS prevention)
 * Only checks magic bytes and size limit
 */
export function validateAvroHeader(
  data: Uint8Array,
  maxBytes: number = 65536
): { valid: boolean; error?: string } {
  // Size limit
  if (data.byteLength > maxBytes) {
    return { valid: false, error: `File too large: ${data.byteLength} bytes (max: ${maxBytes})` };
  }

  // Magic bytes: "Obj\x01"
  if (data.byteLength < 4 ||
    data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
    return { valid: false, error: 'Invalid Avro magic bytes' };
  }

  return { valid: true };
}
