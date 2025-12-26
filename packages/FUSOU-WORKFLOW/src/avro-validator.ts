/**
 * Avro OCF Validator for Cloudflare Workers
 * 
 * Uses avro-js library (pure JavaScript, no dynamic code generation in our usage)
 * - Performs full record decoding and validation
 * - Compatible with Cloudflare Workers
 * - Validates against expected schema
 */

import * as avro from 'avro-js';

export interface DecodeValidationResult {
  valid: boolean;
  recordCount?: number;
  error?: string;
  details?: any;
}

/**
 * Validate Avro OCF file by decoding with schema
 * avro-js provides safe schema compilation without eval
 */
export async function validateAvroOCF(
  avroBytes: Uint8Array,
  expectedSchema: string | object
): Promise<DecodeValidationResult> {
  try {
    // Parse schema if string
    const schemaObj = typeof expectedSchema === 'string' 
      ? JSON.parse(expectedSchema) 
      : expectedSchema;
    
    // Create type from schema - avro-js handles this without eval
    const type = avro.Type.forSchema(schemaObj);
    
    // Validate minimum size for OCF header
    if (avroBytes.byteLength < 20) {
      return { valid: false, error: 'Avro file too small for valid OCF' };
    }
    
    // Check magic bytes: "Obj\x01"
    if (avroBytes[0] !== 0x4F || avroBytes[1] !== 0x62 || avroBytes[2] !== 0x6A || avroBytes[3] !== 0x01) {
      return { valid: false, error: 'Invalid Avro magic bytes' };
    }
    
    // Extract header for metadata validation
    const headerBytes = avroBytes.slice(0, Math.min(avroBytes.length, 8192));
    const headerText = new TextDecoder().decode(headerBytes);
    
    // Schema should be in metadata
    if (!headerText.includes('avro.schema')) {
      return { valid: false, error: 'No avro.schema in Avro header' };
    }
    
    // Extract actual schema JSON to verify it's valid
    const schemaJson = extractSchemaFromOCF(avroBytes);
    if (!schemaJson) {
      return { valid: false, error: 'Failed to extract valid schema JSON' };
    }
    
    // Check for unsupported codecs
    if (headerText.includes('avro.codec')) {
      const codecMatch = headerText.match(/avro\.codec[^}]*"(\w+)"/);
      if (codecMatch && codecMatch[1] && codecMatch[1] !== 'null') {
        if (['deflate', 'snappy', 'bzip2', 'zstandard'].includes(codecMatch[1])) {
          return { valid: false, error: `Compressed codec '${codecMatch[1]}' not supported` };
        }
      }
    }
    
    // Decode records using avro-js
    let recordCount = 0;
    const decoder = avro.createDecoder(Buffer.from(avroBytes), { schema: type });
    
    try {
      while (decoder.hasNext()) {
        decoder.next();
        recordCount++;
      }
    } catch (decodeErr) {
      // If we got some records before error, return partial success
      if (recordCount > 0) {
        return {
          valid: false,
          error: `Decode error after ${recordCount} records: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`,
          details: { recordCount }
        };
      }
      return {
        valid: false,
        error: decodeErr instanceof Error ? decodeErr.message : String(decodeErr)
      };
    }
    
    if (recordCount === 0) {
      return { valid: false, error: 'No records found in Avro file' };
    }
    
    return { valid: true, recordCount };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : String(err),
      details: { stack: err instanceof Error ? err.stack : undefined }
    };
  }
}

export function extractSchemaFromOCF(avroBytes: Uint8Array): string | null {
  try {
    const header = avroBytes.slice(0, Math.min(avroBytes.length, 4096));
    const text = new TextDecoder().decode(header);
    const idx = text.indexOf('avro.schema');
    if (idx === -1) return null;
    const startBrace = text.indexOf('{', idx);
    if (startBrace === -1) return null;
    
    // Properly track depth while respecting string literals
    let depth = 0, endBrace = -1;
    let inString = false, escapeNext = false;
    
    for (let i = startBrace; i < text.length; i++) {
      const ch = text[i];
      
      // Handle escape sequences
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (ch === '\\') {
        escapeNext = true;
        continue;
      }
      
      // Toggle string state
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      
      // Only count braces outside of strings
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
