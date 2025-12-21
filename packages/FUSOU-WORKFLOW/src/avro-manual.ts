/**
 * Manual Avro OCF (Object Container File) implementation
 * No eval(), fully compatible with Cloudflare Workers
 * Implements a subset of Avro sufficient for battle data
 */

// Avro primitive type encoders (variable-length zigzag encoding for integers)
function encodeZigzag(n: number): number {
  return (n << 1) ^ (n >> 31);
}

function encodeLong(value: number): Uint8Array {
  const buf: number[] = [];
  let n = encodeZigzag(value);
  while ((n & ~0x7f) !== 0) {
    buf.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  buf.push(n & 0x7f);
  return new Uint8Array(buf);
}

function decodeZigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

function decodeLong(buffer: Uint8Array, offset: number): { value: number; offset: number } {
  let n = 0;
  let shift = 0;
  let b: number;
  let pos = offset;
  do {
    b = buffer[pos++];
    n |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value: decodeZigzag(n), offset: pos };
}

function encodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const len = encodeLong(bytes.length);
  const result = new Uint8Array(len.length + bytes.length);
  result.set(len, 0);
  result.set(bytes, len.length);
  return result;
}

function encodeBytes(bytes: Uint8Array): Uint8Array {
  const len = encodeLong(bytes.length);
  const result = new Uint8Array(len.length + bytes.length);
  result.set(len, 0);
  result.set(bytes, len.length);
  return result;
}

function encodeBoolean(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

function encodeDouble(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true); // little-endian
  return new Uint8Array(buf);
}

// Simple schema inference from JS object
interface AvroField {
  name: string;
  type: string | string[];
}

interface AvroSchema {
  type: 'record';
  name: string;
  fields: AvroField[];
}

function inferSchema(record: any): AvroSchema {
  const fields: AvroField[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    let type: string | string[];
    
    if (value === null || value === undefined) {
      type = ['null', 'string']; // union type
    } else if (typeof value === 'boolean') {
      type = 'boolean';
    } else if (typeof value === 'number') {
      type = Number.isInteger(value) ? 'long' : 'double';
    } else if (typeof value === 'string') {
      type = 'string';
    } else if (Array.isArray(value)) {
      type = 'string'; // fallback: serialize arrays as JSON strings
    } else if (typeof value === 'object') {
      type = 'string'; // fallback: serialize objects as JSON strings
    } else {
      type = 'string';
    }
    
    fields.push({ name: key, type });
  }
  
  return {
    type: 'record',
    name: 'Record',
    fields
  };
}

// Encode a record according to schema
function encodeRecord(record: any, schema: AvroSchema): Uint8Array {
  const parts: Uint8Array[] = [];
  
  for (const field of schema.fields) {
    const value = record[field.name];
    
    if (Array.isArray(field.type)) {
      // Union type (e.g., ['null', 'string'])
      if (value === null || value === undefined) {
        parts.push(encodeLong(0)); // null branch
      } else {
        parts.push(encodeLong(1)); // second type branch
        const secondType = field.type[1];
        parts.push(encodeValue(value, secondType));
      }
    } else {
      parts.push(encodeValue(value, field.type));
    }
  }
  
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function encodeValue(value: any, type: string): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array(0); // null encoding
  }
  
  switch (type) {
    case 'boolean':
      return encodeBoolean(!!value);
    case 'long':
    case 'int':
      return encodeLong(typeof value === 'number' ? value : 0);
    case 'double':
    case 'float':
      return encodeDouble(typeof value === 'number' ? value : 0);
    case 'string':
      if (typeof value === 'string') {
        return encodeString(value);
      } else {
        // Serialize non-strings as JSON
        return encodeString(JSON.stringify(value));
      }
    case 'bytes':
      if (value instanceof Uint8Array) {
        return encodeBytes(value);
      } else if (typeof value === 'string') {
        return encodeBytes(new TextEncoder().encode(value));
      } else {
        return encodeBytes(new Uint8Array(0));
      }
    default:
      return encodeString(String(value));
  }
}

// Encode map<string, bytes> for metadata
function encodeMap(map: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  const keys = Object.keys(map);
  
  if (keys.length === 0) {
    parts.push(encodeLong(0)); // empty map
  } else {
    parts.push(encodeLong(keys.length)); // block count
    for (const key of keys) {
      parts.push(encodeString(key));
      parts.push(encodeBytes(map[key]));
    }
    parts.push(encodeLong(0)); // end marker
  }
  
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Build Avro OCF container from records
 */
export function buildAvroContainer(records: any[]): Uint8Array {
  if (!records || records.length === 0) {
    throw new Error('Cannot build Avro container without records');
  }
  
  const schema = inferSchema(records[0]);
  const chunks: Uint8Array[] = [];
  
  // 1. Magic bytes: "Obj\x01"
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));
  
  // 2. Metadata map
  const schemaJson = JSON.stringify(schema);
  const metadata: Record<string, Uint8Array> = {
    'avro.schema': new TextEncoder().encode(schemaJson),
    'avro.codec': new TextEncoder().encode('null'),
  };
  chunks.push(encodeMap(metadata));
  
  // 3. Sync marker (16 random bytes)
  const syncMarker = new Uint8Array(16);
  crypto.getRandomValues(syncMarker);
  chunks.push(syncMarker);
  
  // 4. Data block
  const recordBufs: Uint8Array[] = [];
  let totalSize = 0;
  
  for (const record of records) {
    const buf = encodeRecord(record, schema);
    recordBufs.push(buf);
    totalSize += buf.length;
  }
  
  // Block count
  chunks.push(encodeLong(records.length));
  // Block size in bytes
  chunks.push(encodeLong(totalSize));
  // Records
  chunks.push(...recordBufs);
  // Sync marker
  chunks.push(syncMarker);
  
  // 5. Combine all chunks
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
 * Parse Avro header length from buffer prefix
 */
export function getAvroHeaderLengthFromPrefix(buffer: Uint8Array): number {
  // Check magic bytes
  if (buffer.length < 4) {
    throw new Error('Buffer too small for Avro header');
  }
  if (buffer[0] !== 0x4f || buffer[1] !== 0x62 || buffer[2] !== 0x6a || buffer[3] !== 0x01) {
    throw new Error('Invalid Avro magic bytes');
  }
  
  let offset = 4;
  
  // Decode metadata map
  const blockCount = decodeLong(buffer, offset);
  offset = blockCount.offset;
  
  if (blockCount.value === 0) {
    // Empty map, header ends after sync marker
    return offset + 16;
  }
  
  // Skip map entries
  let remaining = blockCount.value;
  while (remaining > 0) {
    // Key (string)
    const keyLen = decodeLong(buffer, offset);
    offset = keyLen.offset + keyLen.value;
    
    // Value (bytes)
    const valLen = decodeLong(buffer, offset);
    offset = valLen.offset + valLen.value;
    
    remaining--;
  }
  
  // Skip end marker (0)
  const endMarker = decodeLong(buffer, offset);
  offset = endMarker.offset;
  
  // Header ends after 16-byte sync marker
  return offset + 16;
}

export function getAvroHeaderLength(buffer: Uint8Array): number {
  return getAvroHeaderLengthFromPrefix(buffer);
}
