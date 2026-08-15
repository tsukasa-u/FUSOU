export type AvroSchema = {
  type?: unknown;
  name?: unknown;
  fields?: unknown[];
  [key: string]: unknown;
};

export type OcfHeader = {
  metadata: Readonly<Record<string, string>>;
  schema: AvroSchema;
  codec: string | null;
  syncMarker: Uint8Array;
  bodyOffset: number;
};

export class OcfHeaderError extends Error {
  readonly code = "CORRUPT_AVRO" as const;

  constructor(message: string) {
    super(message);
    this.name = "OcfHeaderError";
  }
}

export type AvroJsonValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | AvroJsonValue[]
  | { [key: string]: AvroJsonValue };

export type AvroJsonRecord = Record<string, AvroJsonValue>;

export type AvroOcfErrorCode =
  | "UNSUPPORTED_CODEC"
  | "CORRUPT_AVRO"
  | "OUT_OF_MEMORY_GUARD";

export class AvroOcfError extends Error {
  constructor(
    readonly code: AvroOcfErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AvroOcfError";
  }
}

type Cursor = { offset: number };
type SchemaNode =
  | string
  | SchemaNode[]
  | {
      type: SchemaNode | "record" | "enum" | "fixed" | "array" | "map";
      name?: string;
      namespace?: string;
      fields?: Array<{ name: string; type: SchemaNode }>;
      symbols?: string[];
      size?: number;
      items?: SchemaNode;
      values?: SchemaNode;
      logicalType?: string;
      [key: string]: unknown;
    };
type NamedSchemas = Map<string, SchemaNode>;

const OCF_MAGIC = Uint8Array.of(0x4f, 0x62, 0x6a, 0x01);
const OCF_SYNC_MARKER_LENGTH = 16;
const MAX_METADATA_ENTRIES = 4096;

function fail(message: string): never {
  throw new AvroOcfError("CORRUPT_AVRO", message);
}

function readLong(bytes: Uint8Array, cursor: Cursor): number {
  let raw = 0n;

  for (let index = 0; index < 10; index += 1) {
    const byte = bytes[cursor.offset];
    if (byte === undefined) {
      throw new OcfHeaderError("Avro integer is truncated");
    }
    cursor.offset += 1;
    raw |= BigInt(byte & 0x7f) << BigInt(index * 7);

    if ((byte & 0x80) === 0) {
      const decoded = raw % 2n === 0n ? raw / 2n : -(raw + 1n) / 2n;
      const value = Number(decoded);
      if (!Number.isSafeInteger(value)) {
        throw new OcfHeaderError("Avro integer is outside the safe range");
      }
      return value;
    }
  }

  throw new OcfHeaderError("Avro integer is malformed");
}

function readDataLong(bytes: Uint8Array, cursor: Cursor): number {
  try {
    return readLong(bytes, cursor);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}

function readBytes(bytes: Uint8Array, cursor: Cursor): Uint8Array {
  const length = readLong(bytes, cursor);
  if (length < 0 || !Number.isSafeInteger(length)) {
    throw new OcfHeaderError("Avro byte value has an invalid length");
  }
  if (length > bytes.length - cursor.offset) {
    throw new OcfHeaderError("Avro byte value is truncated");
  }

  const end = cursor.offset + length;
  const value = bytes.slice(cursor.offset, end);
  cursor.offset = end;
  return value;
}

function readDataBytes(bytes: Uint8Array, cursor: Cursor): Uint8Array {
  try {
    return readBytes(bytes, cursor);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}

function readString(bytes: Uint8Array, cursor: Cursor): string {
  return new TextDecoder().decode(readBytes(bytes, cursor));
}

function readMetadata(bytes: Uint8Array, cursor: Cursor): Record<string, string> {
  const metadata: Record<string, string> = {};
  let blockCount = readLong(bytes, cursor);
  let entryCount = 0;

  while (blockCount !== 0) {
    if (!Number.isSafeInteger(blockCount)) {
      throw new OcfHeaderError("OCF metadata block count is invalid");
    }

    let blockEnd: number | undefined;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        throw new OcfHeaderError("OCF metadata block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }

    if (
      blockCount > MAX_METADATA_ENTRIES ||
      blockCount > Math.floor((bytes.length - cursor.offset) / 2)
    ) {
      throw new OcfHeaderError("OCF metadata block count is unreasonable");
    }

    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      const value = readBytes(bytes, cursor);
      metadata[key] = new TextDecoder().decode(value);
      entryCount += 1;
    }

    if (blockEnd !== undefined && cursor.offset !== blockEnd) {
      throw new OcfHeaderError("OCF metadata block size does not match entries");
    }

    blockCount = readLong(bytes, cursor);
  }

  if (entryCount > MAX_METADATA_ENTRIES) {
    throw new OcfHeaderError("OCF metadata contains too many entries");
  }
  return metadata;
}

function parseSchema(value: string | undefined): AvroSchema {
  if (!value) {
    throw new OcfHeaderError("OCF header does not contain avro.schema");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OcfHeaderError("OCF header schema is not valid JSON");
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as AvroSchema).type !== "record" ||
    !Array.isArray((parsed as AvroSchema).fields)
  ) {
    throw new OcfHeaderError("OCF header schema is not a record schema");
  }

  for (const field of (parsed as AvroSchema).fields ?? []) {
    if (
      field === null ||
      typeof field !== "object" ||
      typeof (field as { name?: unknown }).name !== "string" ||
      !("type" in field)
    ) {
      throw new OcfHeaderError("OCF header contains an invalid field schema");
    }
  }

  return parsed as AvroSchema;
}

export function parseOcfHeader(bytes: Uint8Array): OcfHeader {
  if (
    bytes.length < OCF_MAGIC.length ||
    !OCF_MAGIC.every((value, index) => bytes[index] === value)
  ) {
    throw new OcfHeaderError("OCF magic bytes are invalid");
  }

  const cursor: Cursor = { offset: OCF_MAGIC.length };
  const metadata = readMetadata(bytes, cursor);
  const syncEnd = cursor.offset + OCF_SYNC_MARKER_LENGTH;
  if (syncEnd > bytes.length) {
    throw new OcfHeaderError("OCF sync marker is truncated");
  }

  return {
    metadata,
    schema: parseSchema(metadata["avro.schema"]),
    codec: metadata["avro.codec"] ?? null,
    syncMarker: bytes.slice(cursor.offset, syncEnd),
    bodyOffset: syncEnd,
  };
}

function fullName(name: string, namespace: string | undefined): string {
  return name.includes(".") || !namespace ? name : `${namespace}.${name}`;
}

function collectNamedSchemas(
  node: SchemaNode,
  named: NamedSchemas,
  namespace?: string,
): void {
  if (Array.isArray(node) || typeof node === "string") {
    if (Array.isArray(node)) {
      for (const item of node) collectNamedSchemas(item, named, namespace);
    }
    return;
  }

  if (typeof node.type !== "string") {
    collectNamedSchemas(node.type, named, namespace);
    return;
  }

  if (node.type === "record" || node.type === "enum" || node.type === "fixed") {
    if (typeof node.name !== "string") return;
    const name = fullName(node.name, node.namespace);
    named.set(name, node);
    named.set(node.name, node);
    if (node.type === "record") {
      const childNamespace = name.includes(".")
        ? name.slice(0, name.lastIndexOf("."))
        : name;
      for (const field of node.fields ?? []) {
        collectNamedSchemas(field.type, named, childNamespace);
      }
    }
    return;
  }

  if (node.type === "array" && node.items) {
    collectNamedSchemas(node.items, named, namespace);
  } else if (node.type === "map" && node.values) {
    collectNamedSchemas(node.values, named, namespace);
  }
}

function resolveSchema(node: SchemaNode, named: NamedSchemas): SchemaNode {
  if (typeof node !== "string") return node;
  return named.get(node) ?? node;
}

function readFloat(
  bytes: Uint8Array,
  cursor: Cursor,
  size: 4 | 8,
): number {
  if (size > bytes.length - cursor.offset) {
    return fail("Avro floating-point value is truncated");
  }
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + cursor.offset,
    size,
  );
  const value = size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  cursor.offset += size;
  return value;
}

function readArray(
  bytes: Uint8Array,
  cursor: Cursor,
  itemSchema: SchemaNode,
  named: NamedSchemas,
): AvroJsonValue[] {
  const values: AvroJsonValue[] = [];
  let blockCount = readDataLong(bytes, cursor);

  while (blockCount !== 0) {
    let blockEnd: number | undefined;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readDataLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        return fail("Avro array block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }
    if (!Number.isSafeInteger(blockCount) || blockCount > bytes.length) {
      return fail("Avro array block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      values.push(readValue(bytes, cursor, itemSchema, named));
    }
    if (blockEnd !== undefined && cursor.offset !== blockEnd) {
      return fail("Avro array block size does not match values");
    }
    blockCount = readDataLong(bytes, cursor);
  }

  return values;
}

function readMap(
  bytes: Uint8Array,
  cursor: Cursor,
  valueSchema: SchemaNode,
  named: NamedSchemas,
): { [key: string]: AvroJsonValue } {
  const values: { [key: string]: AvroJsonValue } = {};
  let blockCount = readDataLong(bytes, cursor);

  while (blockCount !== 0) {
    let blockEnd: number | undefined;
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readDataLong(bytes, cursor);
      if (blockSize < 0 || blockSize > bytes.length - cursor.offset) {
        return fail("Avro map block size is invalid");
      }
      blockEnd = cursor.offset + blockSize;
    }
    if (!Number.isSafeInteger(blockCount) || blockCount > bytes.length) {
      return fail("Avro map block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      values[key] = readValue(bytes, cursor, valueSchema, named);
    }
    if (blockEnd !== undefined && cursor.offset !== blockEnd) {
      return fail("Avro map block size does not match values");
    }
    blockCount = readDataLong(bytes, cursor);
  }

  return values;
}

function readValue(
  bytes: Uint8Array,
  cursor: Cursor,
  originalSchema: SchemaNode,
  named: NamedSchemas,
): AvroJsonValue {
  const schema = resolveSchema(originalSchema, named);

  if (Array.isArray(schema)) {
    const branch = readDataLong(bytes, cursor);
    if (!Number.isSafeInteger(branch) || branch < 0 || branch >= schema.length) {
      return fail("Avro union branch is invalid");
    }
    const branchSchema = schema[branch];
    if (branchSchema === undefined) return fail("Avro union branch is invalid");
    return readValue(bytes, cursor, branchSchema, named);
  }

  if (typeof schema === "string") {
    switch (schema) {
      case "null":
        return null;
      case "boolean": {
        const byte = bytes[cursor.offset];
        if (byte === undefined) return fail("Avro boolean is truncated");
        cursor.offset += 1;
        if (byte !== 0 && byte !== 1) return fail("Avro boolean is invalid");
        return byte === 1;
      }
      case "int":
      case "long":
        return readDataLong(bytes, cursor);
      case "float":
        return readFloat(bytes, cursor, 4);
      case "double":
        return readFloat(bytes, cursor, 8);
      case "bytes":
        return readDataBytes(bytes, cursor);
      case "string":
        return new TextDecoder().decode(readDataBytes(bytes, cursor));
      default:
        return fail(`Unknown Avro named type: ${schema}`);
    }
  }

  if (typeof schema.type !== "string") {
    return readValue(bytes, cursor, schema.type, named);
  }

  if (schema.logicalType) {
    return readValue(bytes, cursor, schema.type, named);
  }

  switch (schema.type) {
    case "null":
    case "boolean":
    case "int":
    case "long":
    case "float":
    case "double":
    case "bytes":
    case "string":
      return readValue(bytes, cursor, schema.type, named);
    case "record": {
      const record: AvroJsonRecord = {};
      for (const field of schema.fields ?? []) {
        record[field.name] = readValue(bytes, cursor, field.type, named);
      }
      return record;
    }
    case "enum": {
      const index = readDataLong(bytes, cursor);
      const symbols = schema.symbols ?? [];
      if (index < 0 || index >= symbols.length) return fail("Avro enum index is invalid");
      const symbol = symbols[index];
      if (symbol === undefined) return fail("Avro enum symbol is missing");
      return symbol;
    }
    case "fixed": {
      const size = schema.size;
      if (!Number.isSafeInteger(size) || size === undefined || size < 0) {
        return fail("Avro fixed type has an invalid size");
      }
      if (size > bytes.length - cursor.offset) return fail("Avro fixed value is truncated");
      const value = bytes.slice(cursor.offset, cursor.offset + size);
      cursor.offset += size;
      return value;
    }
    case "array":
      if (!schema.items) return fail("Avro array type has no items schema");
      return readArray(bytes, cursor, schema.items, named);
    case "map":
      if (!schema.values) return fail("Avro map type has no values schema");
      return readMap(bytes, cursor, schema.values, named);
    default:
      return fail("Avro schema contains an unsupported type");
  }
}

function assertSyncMarker(
  bytes: Uint8Array,
  offset: number,
  syncMarker: Uint8Array,
): void {
  if (syncMarker.length !== OCF_SYNC_MARKER_LENGTH) {
    return fail("OCF sync marker has an invalid length");
  }
  if (syncMarker.length > bytes.length - offset) {
    return fail("Avro block sync marker is truncated");
  }
  for (let index = 0; index < syncMarker.length; index += 1) {
    if (bytes[offset + index] !== syncMarker[index]) {
      return fail("Avro block sync marker does not match the OCF header");
    }
  }
}

function readBlock(
  bytes: Uint8Array,
  cursor: Cursor,
  schema: SchemaNode,
  syncMarker: Uint8Array,
  named: NamedSchemas,
  maxRecords: number | undefined,
  recordFilter: ((record: AvroJsonRecord) => boolean) | undefined,
  decodedRecords: { count: number },
): AvroJsonRecord[] {
  const recordCount = readDataLong(bytes, cursor);
  if (!Number.isSafeInteger(recordCount) || recordCount <= 0) {
    return fail("Avro block record count is invalid");
  }

  const payloadSize = readDataLong(bytes, cursor);
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0) {
    return fail("Avro block payload size is invalid");
  }
  if (payloadSize > bytes.length - cursor.offset - syncMarker.length) {
    return fail("Avro block payload is truncated");
  }

  const payloadEnd = cursor.offset + payloadSize;
  const payload = bytes.subarray(cursor.offset, payloadEnd);
  const payloadCursor: Cursor = { offset: 0 };
  const records: AvroJsonRecord[] = [];

  for (let index = 0; index < recordCount; index += 1) {
    if (
      !recordFilter &&
      maxRecords !== undefined &&
      decodedRecords.count >= maxRecords
    ) {
      throw new AvroOcfError(
        "OUT_OF_MEMORY_GUARD",
        "Avro decoded record count exceeds the configured limit",
      );
    }
    const value = readValue(payload, payloadCursor, schema, named);
    if (
      value === null ||
      typeof value !== "object" ||
      value instanceof Uint8Array ||
      Array.isArray(value)
    ) {
      return fail("Avro top-level schema did not produce a record");
    }
    const record = value as AvroJsonRecord;
    if (!recordFilter || recordFilter(record)) {
      if (maxRecords !== undefined && decodedRecords.count >= maxRecords) {
        throw new AvroOcfError(
          "OUT_OF_MEMORY_GUARD",
          "Avro decoded record count exceeds the configured limit",
        );
      }
      records.push(record);
      decodedRecords.count += 1;
    }
  }

  if (payloadCursor.offset !== payload.length) {
    return fail("Avro block payload has trailing bytes");
  }
  assertSyncMarker(bytes, payloadEnd, syncMarker);
  cursor.offset = payloadEnd + syncMarker.length;
  return records;
}

function parseHeaderForDecoder(header: Uint8Array): OcfHeader {
  try {
    return parseOcfHeader(header);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      return fail(error.message);
    }
    throw error;
  }
}

function decodeNullBody(
  header: OcfHeader,
  body: Uint8Array,
  options: {
    maxRecords?: number;
    recordFilter?: (record: AvroJsonRecord) => boolean;
  } = {},
): AvroJsonRecord[] {
  const schema = header.schema as SchemaNode;
  const named: NamedSchemas = new Map();
  collectNamedSchemas(schema, named);
  const cursor: Cursor = { offset: 0 };
  const records: AvroJsonRecord[] = [];
  const decodedRecords = { count: 0 };

  while (cursor.offset < body.length) {
    records.push(
      ...readBlock(
        body,
        cursor,
        schema,
        header.syncMarker,
        named,
        options.maxRecords,
        options.recordFilter,
        decodedRecords,
      ),
    );
  }
  return records;
}

async function inflateRawAsync(compressed: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const input = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(input).set(compressed);
  await writer.write(new Uint8Array(input));
  await writer.close();

  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    totalLength += result.value.length;
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

async function decodeDeflateBody(
  header: OcfHeader,
  body: Uint8Array,
  options: {
    maxRecords?: number;
    recordFilter?: (record: AvroJsonRecord) => boolean;
  } = {},
): Promise<AvroJsonRecord[]> {
  const schema = header.schema as SchemaNode;
  const named: NamedSchemas = new Map();
  collectNamedSchemas(schema, named);
  const records: AvroJsonRecord[] = [];
  const decodedRecords = { count: 0 };
  let offset = 0;

  while (offset < body.length) {
    const blockCursor: Cursor = { offset };
    const recordCount = readDataLong(body, blockCursor);
    if (recordCount <= 0) return fail("Avro deflate block record count is invalid");
    const compressedSize = readDataLong(body, blockCursor);
    if (
      compressedSize < 0 ||
      compressedSize > body.length - blockCursor.offset - header.syncMarker.length
    ) {
      return fail("Avro deflate block payload is truncated");
    }

    const compressedStart = blockCursor.offset;
    const compressedEnd = compressedStart + compressedSize;
    const compressed = body.slice(compressedStart, compressedEnd);
    assertSyncMarker(body, compressedEnd, header.syncMarker);
    const inflated = await inflateRawAsync(compressed);

    const payloadCursor: Cursor = { offset: 0 };
    for (let index = 0; index < recordCount; index += 1) {
      if (
        !options.recordFilter &&
        options.maxRecords !== undefined &&
        decodedRecords.count >= options.maxRecords
      ) {
        throw new AvroOcfError(
          "OUT_OF_MEMORY_GUARD",
          "Avro decoded record count exceeds the configured limit",
        );
      }
      const value = readValue(inflated, payloadCursor, schema, named);
      if (
        value === null ||
        typeof value !== "object" ||
        value instanceof Uint8Array ||
        Array.isArray(value)
      ) {
        return fail("Avro top-level schema did not produce a record");
      }
      const record = value as AvroJsonRecord;
      if (!options.recordFilter || options.recordFilter(record)) {
        if (
          options.maxRecords !== undefined &&
          decodedRecords.count >= options.maxRecords
        ) {
          throw new AvroOcfError(
            "OUT_OF_MEMORY_GUARD",
            "Avro decoded record count exceeds the configured limit",
          );
        }
        records.push(record);
        decodedRecords.count += 1;
      }
    }
    if (payloadCursor.offset !== inflated.length) {
      return fail("Avro deflate payload has trailing bytes");
    }
    offset = compressedEnd + header.syncMarker.length;
  }

  return records;
}

function requireCodec(header: OcfHeader, codec: "null" | "deflate"): void {
  const actual = header.codec ?? "null";
  if (actual !== codec) {
    return fail(`Avro codec mismatch: expected ${codec}, got ${actual}`);
  }
}

export function getAvroHeaderLengthFromPrefix(buffer: Uint8Array): number {
  return parseOcfHeader(buffer).bodyOffset;
}

export function getAvroHeaderLength(buffer: Uint8Array): number {
  return getAvroHeaderLengthFromPrefix(buffer);
}

export function parseNullAvroBlock(
  header: Uint8Array,
  dataBlock: Uint8Array,
): AvroJsonRecord[] {
  const parsedHeader = parseHeaderForDecoder(header);
  requireCodec(parsedHeader, "null");
  return decodeNullBody(parsedHeader, dataBlock);
}

export function parseAllNullAvroBlocks(
  header: Uint8Array,
  body: Uint8Array,
): AvroJsonRecord[] {
  return parseNullAvroBlock(header, body);
}

export async function parseDeflateAvroBlock(
  header: Uint8Array,
  dataBlock: Uint8Array,
): Promise<AvroJsonRecord[]> {
  const parsedHeader = parseHeaderForDecoder(header);
  requireCodec(parsedHeader, "deflate");
  return decodeDeflateBody(parsedHeader, dataBlock);
}

export async function parseAllDeflateAvroBlocks(
  header: Uint8Array,
  body: Uint8Array,
): Promise<AvroJsonRecord[]> {
  return parseDeflateAvroBlock(header, body);
}

export function decodeAvroOcfToJson(
  avroBytes: Uint8Array,
  options: {
    maxRecords?: number;
    recordFilter?: (record: AvroJsonRecord) => boolean;
  } = {},
): AvroJsonRecord[] {
  const header = parseHeaderForDecoder(avroBytes);
  const codec = header.codec ?? "null";
  if (codec !== "null") {
    throw new AvroOcfError(
      "UNSUPPORTED_CODEC",
      `Unsupported Avro codec: ${codec}`,
    );
  }
  return decodeNullBody(
    header,
    avroBytes.slice(header.bodyOffset),
    options,
  );
}

export async function decodeAvroOcfToJsonAsync(
  avroBytes: Uint8Array,
  options: {
    maxRecords?: number;
    recordFilter?: (record: AvroJsonRecord) => boolean;
  } = {},
): Promise<AvroJsonRecord[]> {
  const header = parseHeaderForDecoder(avroBytes);
  const body = avroBytes.slice(header.bodyOffset);
  const codec = header.codec ?? "null";
  if (codec === "null") return decodeNullBody(header, body, options);
  if (codec === "deflate") return decodeDeflateBody(header, body, options);
  throw new AvroOcfError(
    "UNSUPPORTED_CODEC",
    `Unsupported Avro codec: ${codec}`,
  );
}