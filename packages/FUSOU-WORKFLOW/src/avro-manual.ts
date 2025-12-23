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
    const keyBytesLen = keyLen.value;
    offset = keyLen.offset;
    offset += keyBytesLen;
    
    // Value (bytes)
    const valLen = decodeLong(buffer, offset);
    const valBytesLen = valLen.value;
    offset = valLen.offset;
    offset += valBytesLen;
    
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

/**
 * Parse Avro data block and extract records
 * Note: Simplified implementation for Hot/Cold reader
 * Assumes records were stored as JSON in buffer_logs
 */
export function parseAvroDataBlock(
  header: Uint8Array,
  dataBlock: Uint8Array
): any[] {
  try {
    // For Hot/Cold architecture, data blocks contain JSON-serialized records
    // This is because buffer_logs stores data as JSON BLOB
    const decoded = new TextDecoder().decode(dataBlock);
    
    // Try to parse as JSON array first
    try {
      const parsed = JSON.parse(decoded);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // If not JSON, try parsing as newline-delimited JSON
      const lines = decoded.split('\n').filter(line => line.trim());
      return lines.map(line => JSON.parse(line));
    }
  } catch (err) {
    console.error('Failed to parse Avro data block:', err);
    return [];
  }
}

// ------- Additional support: parse deflate OCF blocks -------
// @ts-ignore
import { inflateRaw } from 'node:zlib';
// @ts-ignore
import { promisify } from 'node:util';
const inflateRawAsync = promisify(inflateRaw);

function decodeString(buffer: Uint8Array, offset: number): { value: string; offset: number } {
  const lenInfo = decodeLong(buffer, offset);
  const start = lenInfo.offset;
  const end = start + lenInfo.value;
  const value = new TextDecoder().decode(buffer.slice(start, end));
  return { value, offset: end };
}

/**
 * Parse Avro data block with null/none codec (no compression)
 * Uses header to obtain schema, then decodes `count` records from the block.
 * Expects dataBlock to start at the beginning of a block (count, size, records, sync).
 */
export function parseNullAvroBlock(header: Uint8Array, dataBlock: Uint8Array): any[] {
  // Parse schema and codec from header
  const { schema, codec } = parseHeaderSchemaAndCodec(header);
  if (!schema) {
    return [];
  }

  // For null/none/no codec, records are uncompressed
  // Data block layout: [count][size][records...][sync]
  try {
    // count
    const countInfo = decodeLong(dataBlock, 0);
    let pos = countInfo.offset;
    const recordCount = countInfo.value;

    // size in bytes of the records payload
    const sizeInfo = decodeLong(dataBlock, pos);
    pos = sizeInfo.offset;
    const payloadSize = sizeInfo.value;

    // Slice out only the records payload (exclude trailing sync)
    const payloadEnd = pos + payloadSize;
    const payload = dataBlock.slice(pos, payloadEnd);

    // Decode records sequentially according to schema
    const out: any[] = [];
    let cur = 0;
    for (let i = 0; i < recordCount; i++) {
      const rec = decodeRecord(payload, cur, schema);
      out.push(rec.record);
      cur = rec.offset;
    }
    return out;
  } catch (err) {
    console.error('Null codec block parse failed:', err);
    return [];
  }
}

/**
 * Parse all blocks from Avro OCF file body (handles multiple blocks concatenated)
 * Returns all records from all blocks
 */
export function parseAllNullAvroBlocks(header: Uint8Array, body: Uint8Array): any[] {
  const { schema } = parseHeaderSchemaAndCodec(header);
  if (!schema) {
    return [];
  }

  const allRecords: any[] = [];
  const syncMarkerLength = 16;
  let offset = 0;

  while (offset < body.length) {
    try {
      // Parse block count
      const countInfo = decodeLong(body, offset);
      offset = countInfo.offset;
      const recordCount = countInfo.value;

      if (recordCount === 0) break;

      // Parse block size
      const sizeInfo = decodeLong(body, offset);
      offset = sizeInfo.offset;
      const payloadSize = sizeInfo.value;

      // Extract payload
      const payloadStart = offset;
      const payloadEnd = offset + payloadSize;
      const syncStart = payloadEnd;
      const syncEnd = syncStart + syncMarkerLength;

      if (syncEnd > body.length) break;

      const payload = body.slice(payloadStart, payloadEnd);

      // Decode all records in this block
      let cur = 0;
      for (let i = 0; i < recordCount; i++) {
        const rec = decodeRecord(payload, cur, schema);
        allRecords.push(rec.record);
        cur = rec.offset;
      }

      // Move to next block
      offset = syncEnd;
    } catch (err) {
      // End of blocks or parse error
      break;
    }
  }

  return allRecords;
}

function decodeBytesBuf(buffer: Uint8Array, offset: number): { value: Uint8Array; offset: number } {
  const lenInfo = decodeLong(buffer, offset);
  const start = lenInfo.offset;
  const end = start + lenInfo.value;
  return { value: buffer.slice(start, end), offset: end };
}

function parseHeaderSchemaAndCodec(header: Uint8Array): { schema: any; codec: string | null } {
  // Validate magic
  if (header.length < 4 || header[0] !== 0x4f || header[1] !== 0x62 || header[2] !== 0x6a || header[3] !== 0x01) {
    return { schema: null, codec: null };
  }
  let offset = 4;
  const countInfo = decodeLong(header, offset);
  offset = countInfo.offset;
  let remaining = countInfo.value;
  let schemaJsonStr: string | null = null;
  let codecStr: string | null = null;
  while (remaining > 0) {
    const keyInfo = decodeString(header, offset);
    offset = keyInfo.offset;
    const valInfo = decodeBytesBuf(header, offset);
    offset = valInfo.offset;
    const key = keyInfo.value;
    const valText = new TextDecoder().decode(valInfo.value);
    if (key === 'avro.schema') schemaJsonStr = valText;
    if (key === 'avro.codec') codecStr = valText;
    remaining--;
  }
  // end marker
  const endMarker = decodeLong(header, offset);
  offset = endMarker.offset;
  // sync marker: skip 16 bytes (not needed here)
  // const sync = header.slice(offset, offset + 16);
  try {
    const schema = schemaJsonStr ? JSON.parse(schemaJsonStr) : null;
    return { schema, codec: codecStr };
  } catch {
    return { schema: null, codec: codecStr };
  }
}

function decodeValue(buffer: Uint8Array, offset: number, type: string): { value: any; offset: number } {
  switch (type) {
    case 'boolean':
      return { value: buffer[offset] === 1, offset: offset + 1 };
    case 'long':
    case 'int': {
      const info = decodeLong(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    case 'double':
    case 'float': {
      const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
      const value = dv.getFloat64(0, true);
      return { value, offset: offset + 8 };
    }
    case 'string': {
      const info = decodeString(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    case 'bytes': {
      const info = decodeBytesBuf(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    default: {
      const info = decodeString(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
  }
}

function decodeRecord(buffer: Uint8Array, offset: number, schema: { fields: { name: string; type: string | string[] }[] }): { record: any; offset: number } {
  const out: any = {};
  let pos = offset;
  for (const field of schema.fields) {
    if (Array.isArray(field.type)) {
      // union: assume ['null','string']
      const branch = decodeLong(buffer, pos); // 0 or 1
      pos = branch.offset;
      if (branch.value === 0) {
        out[field.name] = null;
      } else {
        const v = decodeValue(buffer, pos, (field.type[1] as string));
        pos = v.offset;
        out[field.name] = v.value;
      }
    } else {
      const v = decodeValue(buffer, pos, field.type as string);
      pos = v.offset;
      out[field.name] = v.value;
    }
  }
  return { record: out, offset: pos };
}

export async function parseDeflateAvroBlock(header: Uint8Array, dataBlock: Uint8Array): Promise<any[]> {
  const { schema, codec } = parseHeaderSchemaAndCodec(header);
  if (!schema || codec !== 'deflate') {
    return [];
  }
  // count
  const countInfo = decodeLong(dataBlock, 0);
  let pos = countInfo.offset;
  // size
  const sizeInfo = decodeLong(dataBlock, pos);
  pos = sizeInfo.offset;
  const compSize = sizeInfo.value;
  const compEnd = pos + compSize;
  const compBuf = dataBlock.slice(pos, compEnd);
  pos = compEnd;
  // skip sync marker (16 bytes)
  // const sync = dataBlock.slice(pos, pos + 16);
  // pos += 16;
  try {
    const inflated = await inflateRawAsync(compBuf);
    const out: any[] = [];
    let cur = 0;
    for (let i = 0; i < countInfo.value; i++) {
      const rec = decodeRecord(inflated, cur, schema);
      out.push(rec.record);
      cur = rec.offset;
    }
    return out;
  } catch (err) {
    console.error('Deflate block parse failed:', err);
    return [];
  }
}

