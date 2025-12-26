/**
 * Avro OCF Validator for Cloudflare Workers (no avsc dependency)
 * 
 * Lightweight validation without dynamic code generation:
 * - Only checks magic bytes, header structure, codec
 * - Does NOT perform full record decoding (avsc not available in Workers)
 * - Server-side validation happens in FUSOU-WEB before queuing
 * - Workers only does lightweight structural validation
 */

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
    // Lightweight validation: just check magic bytes and basic structure
    if (avroBytes.byteLength < 4) {
      return { valid: false, error: 'Avro file too small' };
    }
    
    // Check magic bytes: "Obj\x01"
    if (avroBytes[0] !== 0x4F || avroBytes[1] !== 0x62 || avroBytes[2] !== 0x6A || avroBytes[3] !== 0x01) {
      return { valid: false, error: 'Invalid Avro magic bytes' };
    }
    
    // Check for schema in header
    const headerSlice = avroBytes.slice(0, Math.min(avroBytes.byteLength, 512));
    const headerText = new TextDecoder().decode(headerSlice);
    
    if (!headerText.includes('avro.schema')) {
      return { valid: false, error: 'No avro.schema found in header' };
    }
    
    // Check for compression codec
    if (headerText.includes('deflate') || headerText.includes('snappy')) {
      return { valid: false, error: 'Compressed Avro codecs not supported' };
    }
    
    // Estimate record count by looking for sync marker (16 bytes)
    // Avro files have sync markers between blocks
    const syncMarkerCount = (avroBytes.byteLength - avroBytes.lastIndexOf(0x00)) / 16;
    const recordCount = Math.max(1, Math.floor(syncMarkerCount));
    
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
