import {
  OcfHeaderError,
  parseOcfHeader,
  type AvroSchema,
  type OcfHeader,
} from "./ocf-header";

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

type Cursor = { offset: number };
type NamedSchemas = Map<string, SchemaNode>;

function fail(message: string): never {
  throw new AvroOcfError("CORRUPT_AVRO", message);
}

function readLong(bytes: Uint8Array, cursor: Cursor): number {
  let unsigned = 0;
  let multiplier = 1;

  for (let index = 0; index < 10; index += 1) {
    if (cursor.offset >= bytes.length) {
      return fail("Avro value is truncated");
    }

    const byte = bytes[cursor.offset];
    if (byte === undefined) return fail("Avro value is truncated");
    cursor.offset += 1;
    unsigned += (byte & 0x7f) * multiplier;
    if (unsigned > Number.MAX_SAFE_INTEGER) {
      return fail("Avro integer is too large");
    }

    if ((byte & 0x80) === 0) {
      return unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2;
    }

    multiplier *= 128;
  }

  return fail("Avro integer is malformed");
}

function readBytes(bytes: Uint8Array, cursor: Cursor): Uint8Array {
  const length = readLong(bytes, cursor);
  if (length < 0 || !Number.isSafeInteger(length)) {
    return fail("Avro bytes value has an invalid length");
  }

  const end = cursor.offset + length;
  if (end > bytes.length) {
    return fail("Avro bytes value is truncated");
  }

  const value = bytes.slice(cursor.offset, end);
  cursor.offset = end;
  return value;
}

function readString(bytes: Uint8Array, cursor: Cursor): string {
  return new TextDecoder().decode(readBytes(bytes, cursor));
}

function readFloat(bytes: Uint8Array, cursor: Cursor, size: 4 | 8): number {
  const end = cursor.offset + size;
  if (end > bytes.length) {
    return fail("Avro floating-point value is truncated");
  }

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset + cursor.offset,
    size,
  );
  const value = size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
  cursor.offset = end;
  return value;
}

function fullName(name: string, namespace: string | undefined): string {
  return name.includes(".") || !namespace ? name : `${namespace}.${name}`;
}

function collectNamedSchemas(
  node: SchemaNode,
  named: NamedSchemas,
  namespace?: string,
): void {
  if (Array.isArray(node)) {
    node.forEach((item) => collectNamedSchemas(item, named, namespace));
    return;
  }

  if (typeof node === "string") return;

  if (typeof node.type === "object") {
    collectNamedSchemas(node.type, named, namespace);
    return;
  }

  if (node.type === "record" || node.type === "enum" || node.type === "fixed") {
    if (!node.name) return;
    const name = fullName(node.name, node.namespace ?? namespace);
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

function readArray(
  bytes: Uint8Array,
  cursor: Cursor,
  itemSchema: SchemaNode,
  named: NamedSchemas,
): AvroJsonValue[] {
  const values: AvroJsonValue[] = [];
  let blockCount = readLong(bytes, cursor);

  while (blockCount !== 0) {
    if (blockCount < 0) {
      blockCount = -blockCount;
      readLong(bytes, cursor);
    }
    if (!Number.isSafeInteger(blockCount)) {
      return fail("Avro array block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      values.push(readValue(bytes, cursor, itemSchema, named));
    }
    blockCount = readLong(bytes, cursor);
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
  let blockCount = readLong(bytes, cursor);

  while (blockCount !== 0) {
    if (blockCount < 0) {
      blockCount = -blockCount;
      readLong(bytes, cursor);
    }
    if (!Number.isSafeInteger(blockCount)) {
      return fail("Avro map block count is invalid");
    }
    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      values[key] = readValue(bytes, cursor, valueSchema, named);
    }
    blockCount = readLong(bytes, cursor);
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
    const branch = readLong(bytes, cursor);
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
      case "boolean":
        if (cursor.offset >= bytes.length) return fail("Avro boolean is truncated");
        return bytes[cursor.offset++] !== 0;
      case "int":
      case "long":
        return readLong(bytes, cursor);
      case "float":
        return readFloat(bytes, cursor, 4);
      case "double":
        return readFloat(bytes, cursor, 8);
      case "bytes":
        return readBytes(bytes, cursor);
      case "string":
        return readString(bytes, cursor);
      default:
        return fail(`Unknown Avro named type: ${schema}`);
    }
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
      const index = readLong(bytes, cursor);
      const symbols = schema.symbols ?? [];
      if (!Number.isSafeInteger(index) || index < 0 || index >= symbols.length) {
        return fail("Avro enum index is invalid");
      }
      const symbol = symbols[index];
      if (symbol === undefined) return fail("Avro enum index is invalid");
      return symbol;
    }
    case "fixed": {
      const size = schema.size;
      if (!Number.isSafeInteger(size) || size === undefined || size < 0) {
        return fail("Avro fixed type has an invalid size");
      }
      const end = cursor.offset + size;
      if (end > bytes.length) return fail("Avro fixed value is truncated");
      const value = bytes.slice(cursor.offset, end);
      cursor.offset = end;
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

function readBlock(
  bytes: Uint8Array,
  cursor: Cursor,
  schema: AvroSchema,
  syncMarker: Uint8Array,
  named: NamedSchemas,
  maxRecords: number | undefined,
  recordFilter: ((record: AvroJsonRecord) => boolean) | undefined,
  decodedRecords: { count: number },
): AvroJsonRecord[] {
  const recordCount = readLong(bytes, cursor);
  if (!Number.isSafeInteger(recordCount) || recordCount <= 0) {
    return fail("Avro block record count is invalid");
  }

  const payloadSize = readLong(bytes, cursor);
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 0) {
    return fail("Avro block payload size is invalid");
  }

  const payloadEnd = cursor.offset + payloadSize;
  const syncEnd = payloadEnd + syncMarker.length;
  if (syncEnd > bytes.length) {
    return fail("Avro block is truncated");
  }

  const payload = bytes.subarray(cursor.offset, payloadEnd);
  const payloadCursor: Cursor = { offset: 0 };
  const records: AvroJsonRecord[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    if (!recordFilter && maxRecords !== undefined && decodedRecords.count >= maxRecords) {
      throw new AvroOcfError(
        "OUT_OF_MEMORY_GUARD",
        "Avro decoded record count exceeds the configured limit",
      );
    }
    const value = readValue(payload, payloadCursor, schema as SchemaNode, named);
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

  for (let index = 0; index < syncMarker.length; index += 1) {
    if (bytes[payloadEnd + index] !== syncMarker[index]) {
      return fail("Avro block sync marker does not match the OCF header");
    }
  }

  cursor.offset = syncEnd;
  return records;
}

export function decodeAvroOcfToJson(
  avroBytes: Uint8Array,
  options: {
    maxRecords?: number;
    recordFilter?: (record: AvroJsonRecord) => boolean;
  } = {},
): AvroJsonRecord[] {
  let header: OcfHeader;
  try {
    header = parseOcfHeader(avroBytes);
  } catch (error) {
    if (error instanceof OcfHeaderError) {
      throw new AvroOcfError(error.code, error.message);
    }
    throw error;
  }

  if (header.codec !== null && header.codec !== "null") {
    throw new AvroOcfError(
      "UNSUPPORTED_CODEC",
      `Unsupported Avro codec: ${header.codec}`,
    );
  }

  const schema = header.schema as SchemaNode;
  const named: NamedSchemas = new Map();
  collectNamedSchemas(schema, named);
  const cursor: Cursor = { offset: header.bodyOffset };
  const records: AvroJsonRecord[] = [];
  const decodedRecords = { count: 0 };

  while (cursor.offset < avroBytes.length) {
    records.push(
      ...readBlock(
        avroBytes,
        cursor,
        header.schema,
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