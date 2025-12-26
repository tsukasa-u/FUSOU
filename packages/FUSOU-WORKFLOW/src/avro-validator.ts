/**
 * Avro OCF Validator for Cloudflare Workers
 * 
 * Uses apache-avro library (pure JavaScript, no eval/code generation)
 * - Performs full record decoding and validation
 * - Compatible with Cloudflare Workers (no dynamic code generation)
 * - Validates against expected schema
 */

import { DataFileReader, LONG_TYPE } from 'apache-avro';

export interface DecodeValidationResult {
  valid: boolean;
  recordCount?: number;
  error?: string;
  details?: any;
}

export async function validateAvroOCF(
  avroBytes: Uint8Array,
  expectedSchema: string | object
): Promise<DecodeValidationResult> {
  try {
    // Validate magic bytes first
    if (avroBytes.byteLength < 4) {
      return { valid: false, error: 'Avro file too small' };
    }
    
    // Check magic bytes: "Obj\x01"
    if (avroBytes[0] !== 0x4F || avroBytes[1] !== 0x62 || avroBytes[2] !== 0x6A || avroBytes[3] !== 0x01) {
      return { valid: false, error: 'Invalid Avro magic bytes' };
    }
    
    // Parse schema
    const schemaObj = typeof expectedSchema === 'string' 
      ? JSON.parse(expectedSchema) 
      : expectedSchema;
    
    // Use DataFileReader to decode Avro OCF
    // apache-avro's DataFileReader handles Avro Container Format
    let recordCount = 0;
    
    try {
      const reader = new DataFileReader(Buffer.from(avroBytes), schemaObj);
      
      // Iterate through all records
      while (reader.hasNext()) {
        reader.next();
        recordCount++;
      }
      
      reader.close();
    } catch (decodeErr) {
      return {
        valid: false,
        error: `Avro decode failed: ${decodeErr instanceof Error ? decodeErr.message : String(decodeErr)}`,
        details: { recordCount: Math.max(0, recordCount - 1) }
      };
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
