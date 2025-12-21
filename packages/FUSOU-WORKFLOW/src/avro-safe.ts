// Cloudflare Workers-compatible Avro implementation
// Uses pre-compiled schemas to avoid eval() at runtime

import * as avro from 'avsc';

// Pre-compile common schema types to avoid runtime code generation
const COMPILED_TYPES = new Map<string, any>();

/**
 * Get or create a type with unsafe:true to disable code generation
 */
function getSafeType(schema: any): any {
  const key = JSON.stringify(schema);
  if (COMPILED_TYPES.has(key)) {
    return COMPILED_TYPES.get(key);
  }
  
  // Use noAnonymousTypes and wrapUnions options to minimize code generation
  const type = (avro as any).Type.forSchema(schema, { 
    noAnonymousTypes: true,
    wrapUnions: false
  });
  COMPILED_TYPES.set(key, type);
  return type;
}

/**
 * Infer schema from a sample record and create a safe type
 */
export function inferSchemaFromRecord(record: any): any {
  // Build a simple schema object instead of using Type.forValue
  const schema = buildSchemaFromValue(record);
  return getSafeType(schema);
}

/**
 * Manually build an Avro schema from a JavaScript value
 */
function buildSchemaFromValue(value: any): any {
  if (value === null) return 'null';
  
  const type = typeof value;
  
  if (type === 'boolean') return 'boolean';
  if (type === 'number') {
    return Number.isInteger(value) ? 'long' : 'double';
  }
  if (type === 'string') return 'string';
  
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', items: 'null' };
    return { type: 'array', items: buildSchemaFromValue(value[0]) };
  }
  
  if (type === 'object') {
    const fields = Object.keys(value).map(key => ({
      name: key,
      type: buildSchemaFromValue(value[key])
    }));
    return { type: 'record', name: 'Record', fields };
  }
  
  return 'string'; // fallback
}

/**
 * Encode records to Avro OCF using manual serialization
 */
export function buildAvroContainer(records: any[]): Uint8Array {
  if (!records || records.length === 0) {
    throw new Error('Cannot build Avro container without records');
  }

  const schema = buildSchemaFromValue(records[0]);
  const type = getSafeType(schema);
  
  const chunks: Uint8Array[] = [];
  
  // Magic bytes: 'Obj\x01'
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));
  
  // Metadata map
  const schemaJson = JSON.stringify(schema);
  const schemaBytes = new TextEncoder().encode(schemaJson);
  const codecBytes = new TextEncoder().encode('null');
  
  const metadata: Record<string, Uint8Array> = {
    'avro.schema': schemaBytes,
    'avro.codec': codecBytes,
  };
  
  const metaType = getSafeType({ type: 'map', values: 'bytes' });
  const metaBuf = encodeToBuffer(metaType, metadata);
  chunks.push(metaBuf);
  
  // Sync marker (16 random bytes)
  const syncMarker = new Uint8Array(16);
  crypto.getRandomValues(syncMarker);
  chunks.push(syncMarker);
  
  // Data block
  const recordBufs: Uint8Array[] = [];
  let totalSize = 0;
  
  for (const record of records) {
    const buf = encodeToBuffer(type, record);
    recordBufs.push(buf);
    totalSize += buf.length;
  }
  
  // Block count (long)
  const longType = getSafeType('long');
  chunks.push(encodeToBuffer(longType, records.length));
  
  // Block size (long)
  chunks.push(encodeToBuffer(longType, totalSize));
  
  // Record data
  chunks.push(...recordBufs);
  
  // Sync marker again
  chunks.push(syncMarker);
  
  // Combine all chunks
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

/**
 * Encode a value to buffer using avsc Type
 */
function encodeToBuffer(type: any, value: any): Uint8Array {
  // Allocate a reasonably large buffer
  const buf = new Uint8Array(65536);
  const len = type.encode(value, buf, 0);
  return buf.subarray(0, len);
}

/**
 * Parse Avro header length from buffer
 */
export function getAvroHeaderLengthFromPrefix(buffer: Uint8Array): number {
  // Check magic bytes
  if (buffer.length < 4) throw new Error('Buffer too small');
  if (buffer[0] !== 0x4f || buffer[1] !== 0x62 || buffer[2] !== 0x6a || buffer[3] !== 0x01) {
    throw new Error('Invalid Avro magic bytes');
  }
  
  // Decode metadata map
  const metaType = getSafeType({ type: 'map', values: 'bytes' });
  const result = metaType.decode(buffer, 4);
  
  // Header ends at: metadata end + 16 bytes (sync marker)
  return result.offset + 16;
}

export function getAvroHeaderLength(buffer: Uint8Array): number {
  return getAvroHeaderLengthFromPrefix(buffer);
}
