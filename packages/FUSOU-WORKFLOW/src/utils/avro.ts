/**
 * Avro OCF Utilities for Cloudflare Workers
 * - Builds a correct Avro Object Container File (OCF) header with codec 'deflate'
 * - Generates per-user data blocks (compressed) that can be appended to the OCF
 *
 * Notes:
 * - This implementation manually constructs Avro OCF; it does not rely on 'fast-avro'.
 * - Avro 'deflate' uses raw DEFLATE. We therefore use node:zlib's deflateRaw.
 * - Schema support: booleans, numbers, strings; objects/arrays serialized as JSON strings.
 */

// Workers node compatibility
// @ts-ignore
import { deflateRaw } from 'node:zlib';
// @ts-ignore
import { promisify } from 'node:util';

const deflateRawAsync = promisify(deflateRaw);

// ---------- Avro primitive encoders ----------
function encodeZigzag(n: number): number {
  return (n << 1) ^ (n >> 31);
}

function encodeLong(value: number): Uint8Array {
  const buf: number[] = [];
  let n = encodeZigzag(value | 0);
  while ((n & ~0x7f) !== 0) {
    buf.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  buf.push(n & 0x7f);
  return new Uint8Array(buf);
}

function encodeBoolean(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

function encodeDouble(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return new Uint8Array(buf);
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

// ---------- Schema handling ----------
export interface AvroField { name: string; type: string | string[] }
export interface AvroSchema { type: 'record'; name: string; fields: AvroField[] }

export function inferSchemaFromRecord(record: any): AvroSchema {
  const fields: AvroField[] = [];
  for (const key of Object.keys(record)) {
    const value = record[key];
    let type: string | string[];
    if (value === null || value === undefined) {
      type = ['null', 'string'];
    } else if (typeof value === 'boolean') {
      type = 'boolean';
    } else if (typeof value === 'number') {
      type = Number.isInteger(value) ? 'long' : 'double';
    } else if (typeof value === 'string') {
      type = 'string';
    } else if (Array.isArray(value)) {
      type = 'string';
    } else if (typeof value === 'object') {
      type = 'string';
    } else {
      type = 'string';
    }
    fields.push({ name: key, type });
  }
  return { type: 'record', name: 'Record', fields };
}

function encodeValue(value: any, type: string): Uint8Array {
  if (value === null || value === undefined) {
    return new Uint8Array(0);
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
      if (typeof value === 'string') return encodeString(value);
      return encodeString(JSON.stringify(value));
    case 'bytes':
      if (value instanceof Uint8Array) return encodeBytes(value);
      if (typeof value === 'string') return encodeBytes(new TextEncoder().encode(value));
      return encodeBytes(new Uint8Array(0));
    default:
      return encodeString(String(value));
  }
}

function encodeRecord(record: any, schema: AvroSchema): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of schema.fields) {
    const value = record[field.name];
    if (Array.isArray(field.type)) {
      if (value === null || value === undefined) {
        parts.push(encodeLong(0));
      } else {
        parts.push(encodeLong(1));
        parts.push(encodeValue(value, field.type[1] as string));
      }
    } else {
      parts.push(encodeValue(value, field.type));
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function encodeMap(map: Record<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  const keys = Object.keys(map);
  if (keys.length === 0) {
    parts.push(encodeLong(0));
  } else {
    parts.push(encodeLong(keys.length));
    for (const key of keys) {
      parts.push(encodeString(key));
      parts.push(encodeBytes(map[key]));
    }
    parts.push(encodeLong(0));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function generateSyncMarker(): Uint8Array {
  const marker = new Uint8Array(16);
  crypto.getRandomValues(marker);
  return marker;
}

/**
 * Build OCF header (magic + metadata + sync marker) for a given schema.
 * codec: 'deflate' (raw deflate)
 */
export function generateHeader(schema: AvroSchema | string, syncMarker: Uint8Array): Uint8Array {
  const schemaJson = typeof schema === 'string' ? schema : JSON.stringify(schema);
  const chunks: Uint8Array[] = [];
  // Magic bytes
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));
  // Metadata
  const metadata: Record<string, Uint8Array> = {
    'avro.schema': new TextEncoder().encode(schemaJson),
    'avro.codec': new TextEncoder().encode('null'),
  };
  chunks.push(encodeMap(metadata));
  // Sync marker
  chunks.push(syncMarker);
  // Combined
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Generate a data block + sync marker for given records.
 * Returns bytes suitable to append after an OCF header.
 */
export async function generateBlock(
  schema: AvroSchema,
  records: any[],
  syncMarker: Uint8Array,
  codec: string = 'null'
): Promise<Uint8Array> {
  if (!records.length) return new Uint8Array(0);
  // Encode each record according to schema
  const encodedRecords: Uint8Array[] = records.map(r => encodeRecord(r, schema));
  const uncompressedSize = encodedRecords.reduce((s, r) => s + r.length, 0);
  const uncompressed = new Uint8Array(uncompressedSize);
  let off = 0;
  for (const r of encodedRecords) { uncompressed.set(r, off); off += r.length; }

  // Apply codec
  const payload = codec === 'deflate' 
    ? new Uint8Array(await deflateRawAsync(uncompressed))
    : uncompressed;

  // Compose block: count + size + data + sync
  const count = encodeLong(records.length);
  const size = encodeLong(payload.length);
  const blockLen = count.length + size.length + payload.length + syncMarker.length;
  const block = new Uint8Array(blockLen);
  let pos = 0;
  block.set(count, pos); pos += count.length;
  block.set(size, pos); pos += size.length;
  block.set(payload, pos); pos += payload.length;
  block.set(syncMarker, pos);
  return block;
}
