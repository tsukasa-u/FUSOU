/**
 * Avro OCF Decode Validator
 * 
 * Purpose: Fully decode Avro OCF files to verify schema conformance and detect data corruption
 * 
 * Uses avsc (npm: avsc) to decode and validate entire file
 * - Requires nodejs_compat flag in wrangler.toml
 * - Always enabled (constant-time validation)
 * - Suitable for small files (<= 64KB)
 */

import * as avro from 'avsc';
import { Readable } from 'node:stream';

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
    
    // Create readable stream from bytes
    const stream = Readable.from(Buffer.from(avroBytes));
    
    // Create file decoder (handles OCF format)
    const decoder: any = (type as any).createFileDecoder(stream);
    
    let recordCount = 0;
    const errors: string[] = [];
    
    // Decode all records
    await new Promise<void>((resolve, reject) => {
      decoder.on('data', () => {
        recordCount++;
        // Record successfully decoded - schema conformant
      });
      
      decoder.on('error', (err: any) => {
        errors.push(err.message || String(err));
        reject(err);
      });
      
      decoder.on('end', () => {
        resolve();
      });
    });
    
    if (errors.length > 0) {
      return {
        valid: false,
        error: 'Decode errors encountered',
        details: { errors }
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
