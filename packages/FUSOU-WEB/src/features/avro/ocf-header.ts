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

type Cursor = { offset: number };

function readLong(bytes: Uint8Array, cursor: Cursor): number {
  let unsigned = 0;
  let multiplier = 1;

  for (let index = 0; index < 10; index += 1) {
    if (cursor.offset >= bytes.length) {
      throw new OcfHeaderError("OCF header is truncated");
    }

    const byte = bytes[cursor.offset];
    cursor.offset += 1;
    unsigned += (byte & 0x7f) * multiplier;

    if (unsigned > Number.MAX_SAFE_INTEGER) {
      throw new OcfHeaderError("OCF header integer is too large");
    }

    if ((byte & 0x80) === 0) {
      return unsigned % 2 === 0 ? unsigned / 2 : -(unsigned + 1) / 2;
    }

    multiplier *= 128;
  }

  throw new OcfHeaderError("OCF header integer is malformed");
}

function readBytes(bytes: Uint8Array, cursor: Cursor): Uint8Array {
  const length = readLong(bytes, cursor);
  if (length < 0 || !Number.isSafeInteger(length)) {
    throw new OcfHeaderError("OCF header byte value has an invalid length");
  }

  const end = cursor.offset + length;
  if (end > bytes.length) {
    throw new OcfHeaderError("OCF header byte value is truncated");
  }

  const value = bytes.slice(cursor.offset, end);
  cursor.offset = end;
  return value;
}

function readString(bytes: Uint8Array, cursor: Cursor): string {
  return new TextDecoder().decode(readBytes(bytes, cursor));
}

function readMetadata(bytes: Uint8Array, cursor: Cursor): Record<string, string> {
  const metadata: Record<string, string> = {};
  let blockCount = readLong(bytes, cursor);

  while (blockCount !== 0) {
    if (blockCount < 0) {
      blockCount = -blockCount;
      const blockSize = readLong(bytes, cursor);
      if (blockSize < 0 || !Number.isSafeInteger(blockSize)) {
        throw new OcfHeaderError("OCF metadata block has an invalid size");
      }
    }

    if (!Number.isSafeInteger(blockCount)) {
      throw new OcfHeaderError("OCF metadata block has an invalid count");
    }

    for (let index = 0; index < blockCount; index += 1) {
      const key = readString(bytes, cursor);
      const value = readBytes(bytes, cursor);
      metadata[key] = new TextDecoder().decode(value);
    }

    blockCount = readLong(bytes, cursor);
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
    !Array.isArray((parsed as AvroSchema).fields)
  ) {
    throw new OcfHeaderError("OCF header schema is not a record schema");
  }

  return parsed as AvroSchema;
}

export function parseOcfHeader(bytes: Uint8Array): OcfHeader {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x4f ||
    bytes[1] !== 0x62 ||
    bytes[2] !== 0x6a ||
    bytes[3] !== 0x01
  ) {
    throw new OcfHeaderError("OCF magic bytes are invalid");
  }

  const cursor: Cursor = { offset: 4 };
  const metadata = readMetadata(bytes, cursor);
  const schema = parseSchema(metadata["avro.schema"]);
  const codec = metadata["avro.codec"] ?? null;
  const syncEnd = cursor.offset + 16;

  if (syncEnd > bytes.length) {
    throw new OcfHeaderError("OCF sync marker is truncated");
  }

  return {
    metadata,
    schema,
    codec,
    syncMarker: bytes.slice(cursor.offset, syncEnd),
    bodyOffset: syncEnd,
  };
}