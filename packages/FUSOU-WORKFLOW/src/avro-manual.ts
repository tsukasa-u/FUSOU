/**
 * Manual Avro OCF (Object Container File) implementation
 * No eval(), fully compatible with Cloudflare Workers
 * Implements a subset of Avro sufficient for battle data
 */

// Avro primitive type encoders removed (unused)

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

// Ensure namespace embeds schema_version for downstream validation
export function ensureSchemaNamespace(schema: any, schemaVersion: string = 'v1'): any {
  if (schema.namespace && schema.namespace.includes(schemaVersion)) {
    return schema;
  }
  return { ...schema, namespace: `fusou.${schemaVersion}` };
}

export async function computeSchemaFingerprint(schemaJson: string): Promise<string> {
  // Use WebCrypto (available in Cloudflare Workers) for SHA-256 fingerprint
  const encoder = new TextEncoder();
  const data = encoder.encode(schemaJson);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
// Web Streams API for deflate decompression (Cloudflare Workers compatible)
// Note: 'deflate-raw' is supported in Cloudflare Workers

/**
 * Decompress deflate-raw data using Web Streams API
 * Works in Cloudflare Workers without node:zlib
 */
async function inflateRawAsync(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  // Write compressed data
  writer.write(compressed);
  writer.close();

  // Read decompressed chunks
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  // Concatenate chunks
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

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

