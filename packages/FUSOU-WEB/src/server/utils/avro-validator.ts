/**
 * Avro OCF Decode Validator
 * 
 * Purpose: Fully decode Avro OCF files to verify schema conformance and detect data corruption
 * 
 * Uses avro-js (npm: avro-js) to decode and validate entire file
 * - Works with nodejs_compat flag in wrangler.toml
 * - Always enabled (constant-time validation)
 * - Suitable for small files (<= 64KB)
 */

import * as avro from 'avro-js';

export interface DecodeValidationResult {
  valid: boolean;
  recordCount?: number;
  error?: string;
  details?: any;
}

/**
 * Validate Avro OCF file by fully decoding all records
 * 
 * @param avroBytes - OCF file bytes
 * @param expectedSchema - Expected Avro schema (JSON string or object)
 * @returns Validation result with record count or error
 */
export async function validateAvroOCF(
  avroBytes: Uint8Array,
  expectedSchema: string | object
): Promise<DecodeValidationResult> {
  try {
    // Parse expected schema
    const schemaObj = typeof expectedSchema === 'string' 
      ? JSON.parse(expectedSchema) 
      : expectedSchema;
    
    const type = avro.Type.forSchema(schemaObj);
    
    // Create decoder for Avro OCF
    const decoder = avro.createDecoder(Buffer.from(avroBytes), { schema: type });
    
    let recordCount = 0;
    
    // Decode all records
    try {
      while (decoder.hasNext()) {
        decoder.next();
        recordCount++;
      }
    } catch (err) {
      return {
        valid: false,
        error: `Decode error after ${recordCount} records: ${err instanceof Error ? err.message : String(err)}`,
        details: { recordCount }
      };
    }
    
    if (recordCount === 0) {
      return {
        valid: false,
        error: 'No records found in Avro file'
      };
    }
    
    return {
      valid: true,
      recordCount
    };
    
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      details: { stack: err instanceof Error ? err.stack : undefined }
    };
  }
}

/**
 * Extract schema from OCF header for validation
 * Returns schema JSON string if found
 */
export function extractSchemaFromOCF(avroBytes: Uint8Array): string | null {
  try {
    const header = avroBytes.slice(0, Math.min(avroBytes.length, 4096));
    const text = new TextDecoder().decode(header);
    
    const idx = text.indexOf('avro.schema');
    if (idx === -1) return null;
    
    const startBrace = text.indexOf('{', idx);
    if (startBrace === -1) return null;
    
    let depth = 0;
    let endBrace = -1;
    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          endBrace = i;
          break;
        }
      }
    }
    
    if (endBrace === -1) return null;
    
    return text.slice(startBrace, endBrace + 1);
  } catch {
    return null;
  }
}
