/**
 * Avro OCF Decode Validator for Cloudflare Workers
 * 
 * Shared utility for WEB and WORKFLOW to fully decode and validate Avro OCF files
 * - Always enabled (constant-time validation)
 * - Requires nodejs_compat flag in wrangler.toml
 */

import * as avro from 'avsc';
import { Readable } from 'node:stream';

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
    const schemaObj = typeof expectedSchema === 'string' 
      ? JSON.parse(expectedSchema) 
      : expectedSchema;
    
    const type = avro.Type.forSchema(schemaObj);
    const stream = Readable.from(Buffer.from(avroBytes));
    const decoder: any = (type as any).createFileDecoder(stream);
    
    let recordCount = 0;
    const errors: string[] = [];
    
    await new Promise<void>((resolve, reject) => {
      decoder.on('data', () => { recordCount++; });
      decoder.on('error', (err: any) => {
        errors.push(err.message || String(err));
        reject(err);
      });
      decoder.on('end', () => { resolve(); });
    });
    
    if (errors.length > 0) {
      return { valid: false, error: 'Decode errors', details: { errors } };
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
