/**
 * Avro OCF decoder for Cloudflare Workers
 * Decodes Avro OCF binary (null codec) to JSON records
 *
 * Ported from FUSOU-WORKFLOW/src/avro-manual.ts
 * Supports null codec only (master data uses null codec)
 */

function decodeZigzag(n: number): number {
  return (n >>> 1) ^ -(n & 1);
}

function decodeLong(
  buffer: Uint8Array,
  offset: number,
): { value: number; offset: number } {
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

function decodeString(
  buffer: Uint8Array,
  offset: number,
): { value: string; offset: number } {
  const lenInfo = decodeLong(buffer, offset);
  const start = lenInfo.offset;
  const end = start + lenInfo.value;
  const value = new TextDecoder().decode(buffer.slice(start, end));
  return { value, offset: end };
}

function decodeBytesBuf(
  buffer: Uint8Array,
  offset: number,
): { value: Uint8Array; offset: number } {
  const lenInfo = decodeLong(buffer, offset);
  const start = lenInfo.offset;
  const end = start + lenInfo.value;
  return { value: buffer.slice(start, end), offset: end };
}

function parseHeaderSchemaAndCodec(header: Uint8Array): {
  schema: AvroSchema | null;
  codec: string | null;
  syncMarker: Uint8Array | null;
  bodyOffset: number;
} {
  if (
    header.length < 4 ||
    header[0] !== 0x4f ||
    header[1] !== 0x62 ||
    header[2] !== 0x6a ||
    header[3] !== 0x01
  ) {
    return { schema: null, codec: null, syncMarker: null, bodyOffset: 0 };
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
    if (key === "avro.schema") schemaJsonStr = valText;
    if (key === "avro.codec") codecStr = valText;
    remaining--;
  }
  // end marker
  const endMarker = decodeLong(header, offset);
  offset = endMarker.offset;
  // sync marker: 16 bytes
  const syncMarker = header.slice(offset, offset + 16);
  offset += 16;

  try {
    const schema = schemaJsonStr ? JSON.parse(schemaJsonStr) : null;
    return { schema, codec: codecStr, syncMarker, bodyOffset: offset };
  } catch {
    return { schema: null, codec: codecStr, syncMarker: null, bodyOffset: offset };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AvroSchema = { fields: { name: string; type: any }[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeValue(
  buffer: Uint8Array,
  offset: number,
  type: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { value: any; offset: number } {
  switch (type) {
    case "boolean":
      return { value: buffer[offset] === 1, offset: offset + 1 };
    case "long":
    case "int": {
      const info = decodeLong(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    case "double": {
      const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, 8);
      const value = dv.getFloat64(0, true);
      return { value, offset: offset + 8 };
    }
    case "float": {
      const dv = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
      const value = dv.getFloat32(0, true);
      return { value, offset: offset + 4 };
    }
    case "string": {
      const info = decodeString(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    case "bytes": {
      const info = decodeBytesBuf(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
    default: {
      const info = decodeString(buffer, offset);
      return { value: info.value, offset: info.offset };
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function decodeComplexValue(
  buffer: Uint8Array,
  offset: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type: any,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { value: any; offset: number } {
  if (typeof type === "string") {
    return decodeValue(buffer, offset, type);
  }
  if (Array.isArray(type)) {
    // union: read branch index
    const branch = decodeLong(buffer, offset);
    const pos = branch.offset;
    const t = type[branch.value];
    if (t === "null") {
      return { value: null, offset: pos };
    }
    return decodeComplexValue(buffer, pos, t);
  }
  if (typeof type === "object") {
    if (type.type === "array") {
      return decodeArray(buffer, offset, type.items);
    }
    if (type.type === "string") {
      return decodeValue(buffer, offset, "string");
    }
    return decodeValue(buffer, offset, "string");
  }
  return decodeValue(buffer, offset, "string");
}

function decodeArray(
  buffer: Uint8Array,
  offset: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  itemsType: any,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { value: any[]; offset: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = [];
  let pos = offset;
  while (true) {
    const countInfo = decodeLong(buffer, pos);
    pos = countInfo.offset;
    let count = countInfo.value;
    if (count === 0) break;
    if (count < 0) {
      const sizeInfo = decodeLong(buffer, pos);
      pos = sizeInfo.offset;
      count = -count;
    }
    for (let i = 0; i < count; i++) {
      if (Array.isArray(itemsType)) {
        const branch = decodeLong(buffer, pos);
        pos = branch.offset;
        if (itemsType[branch.value] === "null") {
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

function decodeRecord(
  buffer: Uint8Array,
  offset: number,
  schema: AvroSchema,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): { record: any; offset: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  let pos = offset;
  for (const field of schema.fields) {
    const v = decodeComplexValue(buffer, pos, field.type);
    pos = v.offset;
    out[field.name] = v.value;
  }
  return { record: out, offset: pos };
}

/**
 * Decode an Avro OCF binary (null codec) into JSON records.
 * The full OCF file (header + blocks) is passed as a single Uint8Array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decodeAvroOcfToJson(avroBytes: Uint8Array): any[] {
  const { schema, codec, bodyOffset } = parseHeaderSchemaAndCodec(avroBytes);
  if (!schema) {
    throw new Error("Failed to parse Avro schema from header");
  }
  if (codec && codec !== "null") {
    throw new Error(`Unsupported Avro codec: ${codec}. Only null codec is supported.`);
  }

  const body = avroBytes.slice(bodyOffset);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRecords: any[] = [];
  const syncMarkerLength = 16;
  let offset = 0;

  while (offset < body.length) {
    // Parse block count
    const countInfo = decodeLong(body, offset);
    offset = countInfo.offset;
    const recordCount = countInfo.value;

    if (recordCount === 0) break;

    // Parse block size
    const sizeInfo = decodeLong(body, offset);
    offset = sizeInfo.offset;
    const payloadSize = sizeInfo.value;

    const payloadStart = offset;
    const payloadEnd = offset + payloadSize;
    const syncEnd = payloadEnd + syncMarkerLength;

    if (syncEnd > body.length) break;

    const payload = body.slice(payloadStart, payloadEnd);

    let cur = 0;
    for (let i = 0; i < recordCount; i++) {
      const rec = decodeRecord(payload, cur, schema);
      allRecords.push(rec.record);
      cur = rec.offset;
    }

    offset = syncEnd;
  }

  return allRecords;
}
