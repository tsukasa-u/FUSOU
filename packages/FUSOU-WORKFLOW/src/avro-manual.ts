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
  // Avro type can be a primitive string, a union (array), or a complex object
  type: any;
}

interface AvroSchema {
  type: 'record';
  name: string;
  fields: AvroField[];
  namespace?: string;
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

// Ensure namespace embeds schema_version for downstream validation
export function ensureSchemaNamespace(schema: AvroSchema, schemaVersion: string = 'v1'): AvroSchema {
  if (schema.namespace && schema.namespace.includes(schemaVersion)) {
    return schema;
  }
  return { ...schema, namespace: `fusou.${schemaVersion}` };
}

export function computeSchemaFingerprint(schemaJson: string): string {
  // Use SHA-256 hex fingerprint for allowlist checks
  // @ts-ignore
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(schemaJson).digest('hex');
}

// Encode a record according to schema
function encodeRecord(record: any, schema: AvroSchema): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const field of schema.fields) {
    const value = record[field.name];
    const fieldType = field.type;

    if (Array.isArray(fieldType)) {
      // Generic union handling; assume first branch may be 'null'
      if (value === null || value === undefined) {
        parts.push(encodeLong(0));
      } else {
        // Find first non-null branch; prefer index 1 for ['null', T]
        let branchIndex = 0;
        for (let i = 0; i < fieldType.length; i++) {
          if (fieldType[i] !== 'null') { branchIndex = i; break; }
        }
        parts.push(encodeLong(branchIndex));
        parts.push(encodeComplexValue(value, fieldType[branchIndex]));
      }
    } else {
      parts.push(encodeComplexValue(value, fieldType));
    }
  }

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

// Exported helper to encode a record according to a provided schema
export function encodeRecordWithSchema(record: any, schema: AvroSchema): Uint8Array {
  return encodeRecord(record, schema);
}

function encodeArray(arr: any[], itemsType: any): Uint8Array {
  // Avro array encoding: one or more blocks
  // For simplicity, encode all items in a single block: [count][items...][0]
  const parts: Uint8Array[] = [];
  parts.push(encodeLong(arr.length));
  for (const item of arr) {
    if (Array.isArray(itemsType)) {
      // union per item
      if (item === null || item === undefined) {
        parts.push(encodeLong(0));
      } else {
        let branchIndex = 0;
        for (let i = 0; i < itemsType.length; i++) {
          if (itemsType[i] !== 'null') { branchIndex = i; break; }
        }
        parts.push(encodeLong(branchIndex));
        parts.push(encodeComplexValue(item, itemsType[branchIndex]));
      }
    } else {
      parts.push(encodeComplexValue(item, itemsType));
    }
  }
  parts.push(encodeLong(0)); // end of blocks
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function encodeComplexValue(value: any, type: any): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array(0);
  }
  if (typeof type === 'string') {
    return encodeValue(value, type);
  }
  if (typeof type === 'object') {
    if (type.type === 'array') {
      return encodeArray(Array.isArray(value) ? value : [], type.items);
    }
    if (type.type === 'string') {
      // handle logicalType like uuid
      return encodeValue(value, 'string');
    }
    // Fallback to string
    return encodeValue(value, 'string');
  }
  return encodeValue(value, 'string');
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

export async function buildOCFWithSchema(schema: AvroSchema, records: any[], codec: 'null' | 'deflate' = 'null', schemaVersion: string = 'v1'): Promise<Uint8Array> {
  if (!records || records.length === 0) {
    throw new Error('Cannot build Avro container without records');
  }

  const schemaWithNs = ensureSchemaNamespace(schema, schemaVersion);
  const chunks: Uint8Array[] = [];

  // Magic
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));

  // Metadata
  const schemaJson = JSON.stringify(schemaWithNs);
  const metadata: Record<string, Uint8Array> = {
    'avro.schema': new TextEncoder().encode(schemaJson),
    'avro.codec': new TextEncoder().encode(codec),
  };
  chunks.push(encodeMap(metadata));

  // Sync
  const syncMarker = new Uint8Array(16);
  crypto.getRandomValues(syncMarker);
  chunks.push(syncMarker);

  // Records payload
  const recordBufs: Uint8Array[] = records.map(r => encodeRecord(r, schema));
  const uncompressedPayloadSize = recordBufs.reduce((s, b) => s + b.length, 0);
  // Concatenate uncompressed payload
  const uncompressedPayload = new Uint8Array(uncompressedPayloadSize);
  let upOff = 0;
  for (const b of recordBufs) { uncompressedPayload.set(b, upOff); upOff += b.length; }

  let blockPayload: Uint8Array = uncompressedPayload;
  if (codec === 'deflate') {
    // Compress payload using raw deflate to match Avro OCF expectations
    // @ts-ignore
    const { deflateRaw } = await import('node:zlib');
    // @ts-ignore
    const { promisify } = await import('node:util');
    const deflateRawAsync = promisify(deflateRaw);
    const comp = await deflateRawAsync(uncompressedPayload);
    blockPayload = new Uint8Array(comp);
  }

  // count
  chunks.push(encodeLong(records.length));
  // size (size of block payload in bytes; for deflate, compressed size)
  chunks.push(encodeLong(blockPayload.length));
  // payload
  chunks.push(blockPayload);
  // sync
  chunks.push(syncMarker);

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function buildHeaderWithSchema(schema: AvroSchema, codec: 'null' | 'deflate', syncMarker: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));
  const schemaJson = JSON.stringify(schema);
  const metadata: Record<string, Uint8Array> = {
    'avro.schema': new TextEncoder().encode(schemaJson),
    'avro.codec': new TextEncoder().encode(codec),
  };
  chunks.push(encodeMap(metadata));
  chunks.push(syncMarker);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function buildNullBlock(schema: AvroSchema, records: any[], syncMarker: Uint8Array): Uint8Array {
  if (!records.length) return new Uint8Array(0);
  const encoded = records.map(r => encodeRecord(r, schema));
  const payloadSize = encoded.reduce((s, b) => s + b.length, 0);
  const parts: Uint8Array[] = [];
  const count = encodeLong(records.length);
  const size = encodeLong(payloadSize);
  parts.push(count, size, ...encoded, syncMarker);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
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

function decodeArray(buffer: Uint8Array, offset: number, itemsType: any): { value: any[]; offset: number } {
  const result: any[] = [];
  let pos = offset;
  while (true) {
    const countInfo = decodeLong(buffer, pos);
    pos = countInfo.offset;
    let count = countInfo.value;
    if (count === 0) break;
    if (count < 0) {
      // read block size but ignore value
      const sizeInfo = decodeLong(buffer, pos);
      pos = sizeInfo.offset;
      count = -count;
    }
    for (let i = 0; i < count; i++) {
      if (Array.isArray(itemsType)) {
        const branch = decodeLong(buffer, pos);
        pos = branch.offset;
        if (itemsType[branch.value] === 'null') {
          result.push(null);
        } else {
          const v = decodeComplexValue(buffer, pos, itemsType[branch.value]);
          result.push(v.value);
          pos = v.offset;
        }
      } else {
        const v = decodeComplexValue(buffer, pos, itemsType);
        result.push(v.value);
        pos = v.offset;
      }
    }
  }
  return { value: result, offset: pos };
}

function decodeComplexValue(buffer: Uint8Array, offset: number, type: any): { value: any; offset: number } {
  if (typeof type === 'string') {
    return decodeValue(buffer, offset, type);
  }
  if (Array.isArray(type)) {
    // union at value position; read branch index
    const branch = decodeLong(buffer, offset);
    let pos = branch.offset;
    const t = type[branch.value];
    if (t === 'null') {
      return { value: null, offset: pos };
    }
    const v = decodeComplexValue(buffer, pos, t);
    return v;
  }
  if (typeof type === 'object') {
    if (type.type === 'array') {
      return decodeArray(buffer, offset, type.items);
    }
    if (type.type === 'string') {
      return decodeValue(buffer, offset, 'string');
    }
    // Fallback
    return decodeValue(buffer, offset, 'string');
  }
  return decodeValue(buffer, offset, 'string');
}

function decodeRecord(buffer: Uint8Array, offset: number, schema: { fields: { name: string; type: any }[] }): { record: any; offset: number } {
  const out: any = {};
  let pos = offset;
  for (const field of schema.fields) {
    const v = decodeComplexValue(buffer, pos, field.type);
    pos = v.offset;
    out[field.name] = v.value;
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

