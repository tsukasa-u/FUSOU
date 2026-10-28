export type AvroSchemaInput = {
  fields?: Array<{ name: string; type: unknown }>;
  [key: string]: unknown;
};

type AvroRecord = Record<string, unknown>;

type ArraySchema = {
  type: "array";
  items: unknown;
};

function encodeLong(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) {
    throw new Error("Avro long must be a safe integer");
  }
  let encoded = value >= 0 ? BigInt(value) * 2n : -BigInt(value) * 2n - 1n;
  const bytes: number[] = [];
  while (encoded > 0x7fn) {
    bytes.push(Number(encoded & 0x7fn) | 0x80);
    encoded >>= 7n;
  }
  bytes.push(Number(encoded));
  return Uint8Array.from(bytes);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concatBytes([encodeLong(bytes.length), bytes]);
}

function encodeBytes(value: Uint8Array): Uint8Array {
  return concatBytes([encodeLong(value.length), value]);
}

function encodeValueBySchema(type: unknown, value: unknown): Uint8Array {
  if (Array.isArray(type)) {
    if (value === null || value === undefined) {
      const nullIndex = type.findIndex((branch) => branch === "null");
      if (nullIndex < 0) throw new Error("Null value has no matching Avro union branch");
      return encodeLong(nullIndex);
    }
    for (let branchIndex = 0; branchIndex < type.length; branchIndex++) {
      if (type[branchIndex] === "null") continue;
      try {
        return concatBytes([encodeLong(branchIndex), encodeValueBySchema(type[branchIndex], value)]);
      } catch {
        // A union branch may reject the value; try the remaining declared branches.
      }
    }
    throw new Error("Value has no matching Avro union branch");
  }

  if (typeof type === "object" && type !== null) {
    const objectType = type as Partial<ArraySchema> & { type?: unknown };
    if (objectType.type === "array") {
      if (!Array.isArray(value)) throw new Error("Avro array requires an array");
      const items = value;
      if (!items.length) return encodeLong(0);
      const payload = concatBytes(
        items.map((item) => encodeValueBySchema(objectType.items, item)),
      );
      return concatBytes([encodeLong(items.length), payload, encodeLong(0)]);
    }
    if (objectType.type === "record") {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Avro record requires an object");
      return encodeRecordWithSchema(type as AvroSchemaInput, value as AvroRecord);
    }
    if (objectType.type !== undefined) {
      return encodeValueBySchema(objectType.type, value);
    }
  }

  switch (type) {
    case "null":
      if (value !== null && value !== undefined) throw new Error("Avro null requires null");
      return new Uint8Array(0);
    case "boolean":
      if (typeof value !== "boolean") throw new Error("Avro boolean requires a boolean");
      return Uint8Array.of(value ? 1 : 0);
    case "int":
      if (typeof value !== "number" || !Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
        throw new Error("Avro int requires a signed 32-bit integer");
      }
      return encodeLong(value);
    case "long":
      if (typeof value !== "number") throw new Error("Avro long requires a number");
      return encodeLong(value);
    case "float": {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid Avro float");
      const output = new Uint8Array(4);
      new DataView(output.buffer).setFloat32(
        0,
        typeof value === "number" ? value : Number(value ?? 0),
        true,
      );
      return output;
    }
    case "double": {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid Avro double");
      const output = new Uint8Array(8);
      new DataView(output.buffer).setFloat64(
        0,
        typeof value === "number" ? value : Number(value ?? 0),
        true,
      );
      return output;
    }
    case "bytes":
      if (!(value instanceof Uint8Array)) throw new Error("Avro bytes requires Uint8Array");
      return encodeBytes(value);
    case "string":
      if (typeof value !== "string") throw new Error("Avro string requires a string");
      return encodeString(value);
    default:
      throw new Error(`Unsupported Avro schema type: ${String(type)}`);
  }
}

function normalizeSyncMarker(syncMarker?: Uint8Array): Uint8Array {
  if (syncMarker !== undefined) {
    if (syncMarker.length !== 16) throw new Error("Avro sync marker must be 16 bytes");
    return syncMarker;
  }
  const output = new Uint8Array(16);
  crypto.getRandomValues(output);
  return output;
}

export async function computeSchemaFingerprint(schemaJson: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(schemaJson),
  );
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function encodeRecordWithSchema(
  schema: AvroSchemaInput,
  record: AvroRecord,
): Uint8Array {
  if (!Array.isArray(schema.fields)) throw new Error("Avro record schema requires fields");
  return concatBytes(
    schema.fields.map((field) =>
      encodeValueBySchema(field.type, record[field.name]),
    ),
  );
}

export function buildHeaderWithSchema(
  schema: AvroSchemaInput,
  codec: "null" | "deflate" = "null",
  syncMarker?: Uint8Array,
): Uint8Array {
  const schemaBytes = new TextEncoder().encode(JSON.stringify(schema));
  const codecBytes = new TextEncoder().encode(codec);
  const sync = normalizeSyncMarker(syncMarker);
  const entries = [
    concatBytes([encodeString("avro.schema"), encodeBytes(schemaBytes)]),
    concatBytes([encodeString("avro.codec"), encodeBytes(codecBytes)]),
  ];
  return concatBytes([
    Uint8Array.of(0x4f, 0x62, 0x6a, 0x01),
    encodeLong(entries.length),
    ...entries,
    encodeLong(0),
    sync,
  ]);
}

export function buildNullBlock(
  schema: AvroSchemaInput,
  records: AvroRecord[],
  syncMarker: Uint8Array,
): Uint8Array {
  if (!records.length) return new Uint8Array(0);
  const payload = concatBytes(
    records.map((record) => encodeRecordWithSchema(schema, record)),
  );
  return concatBytes([
    encodeLong(records.length),
    encodeLong(payload.length),
    payload,
    normalizeSyncMarker(syncMarker),
  ]);
}

async function deflateRawAsync(input: Uint8Array): Promise<Uint8Array> {
  const { promisify } = await import("node:util");
  const { deflateRaw } = await import("node:zlib");
  return promisify(deflateRaw)(input);
}

export async function buildOCFWithSchema(
  schema: AvroSchemaInput,
  records: AvroRecord[],
  codec: "null" | "deflate" = "null",
  _schemaVersion?: string,
): Promise<Uint8Array> {
  const sync = normalizeSyncMarker();
  const header = buildHeaderWithSchema(schema, codec, sync);
  if (!records.length) return header;
  if (codec === "null") {
    return concatBytes([header, buildNullBlock(schema, records, sync)]);
  }
  const payload = concatBytes(
    records.map((record) => encodeRecordWithSchema(schema, record)),
  );
  const compressed = await deflateRawAsync(payload);
  return concatBytes([
    header,
    encodeLong(records.length),
    encodeLong(compressed.length),
    compressed,
    sync,
  ]);
}

function inferAvroTypeFromValue(value: unknown): unknown {
  if (value === null || value === undefined) return ["null", "string"];
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "long" : "double";
  if (typeof value === "string") return "string";
  if (value instanceof Uint8Array) return "bytes";
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== null && item !== undefined);
    return {
      type: "array",
      items: first === undefined ? "string" : inferAvroTypeFromValue(first),
    } satisfies ArraySchema;
  }
  return "string";
}

export function buildAvroContainer(records: AvroRecord[]): Uint8Array {
  const first = records[0] ?? {};
  const schema: AvroSchemaInput = {
    type: "record",
    name: "Record",
    fields: Object.keys(first).map((name) => ({
      name,
      type: inferAvroTypeFromValue(first[name]),
    })),
  };
  const sync = normalizeSyncMarker();
  return concatBytes([
    buildHeaderWithSchema(schema, "null", sync),
    buildNullBlock(schema, records, sync),
  ]);
}
