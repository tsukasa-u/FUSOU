import avsc from "avsc";

type FixtureRecord = Record<string, unknown>;

const fixtureFields = [
  { name: "env_uuid", type: ["null", "string"], default: null },
  { name: "uuid", type: ["null", "string"], default: null },
  { name: "index", type: ["null", "int"], default: null },
  { name: "cell_id", type: ["null", "int"], default: null },
  { name: "cell_index", type: ["null", { type: "array", items: "int" }], default: null },
  { name: "battle_index", type: ["null", { type: "array", items: "int" }], default: null },
  { name: "battles", type: ["null", "string"], default: null },
  { name: "maparea_id", type: ["null", "int"], default: null },
  { name: "mapinfo_no", type: ["null", "int"], default: null },
  { name: "battle_result", type: ["null", "string"], default: null },
  { name: "hougeki", type: ["null", "string"], default: null },
  { name: "opening_air_attack", type: ["null", "string"], default: null },
  { name: "e_deck_id", type: ["null", "string"], default: null },
  { name: "ship_ids", type: ["null", { type: "array", items: "string" }], default: null },
  { name: "slot", type: ["null", "string"], default: null },
  { name: "nowhp", type: ["null", "int"], default: null },
  { name: "maxhp", type: ["null", "int"], default: null },
  { name: "mst_ship_id", type: ["null", "int"], default: null },
  { name: "drop_ship_id", type: ["null", "int"], default: null },
  { name: "id", type: ["null", "int"], default: null },
  { name: "name", type: ["null", "string"], default: null },
  { name: "timestamp", type: ["null", "long"], default: null },
  { name: "midnight_timestamp", type: ["null", "long"], default: null },
] as const;

function encodeLong(value: number): Uint8Array {
  let raw = value >= 0 ? value * 2 : -value * 2 - 1;
  const bytes: number[] = [];
  while (raw > 0x7f) {
    bytes.push((raw % 128) + 0x80);
    raw = Math.floor(raw / 128);
  }
  bytes.push(raw);
  return Uint8Array.from(bytes);
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(encodeLong(bytes.byteLength), bytes);
}

function encodeBytes(value: Uint8Array): Uint8Array {
  return concat(encodeLong(value.byteLength), value);
}

function encodeMetadata(metadata: Array<[string, Uint8Array]>): Uint8Array {
  return concat(
    encodeLong(metadata.length),
    ...metadata.flatMap(([key, value]) => [encodeString(key), encodeBytes(value)]),
    encodeLong(0),
  );
}

export function buildAvroOcfFixture(
  schemaName: string,
  records: FixtureRecord[],
): Uint8Array {
  const schema = {
    type: "record",
    name: schemaName,
    fields: fixtureFields,
  } as unknown as Parameters<typeof avsc.Type.forSchema>[0];
  const type = avsc.Type.forSchema(schema);
  const body = concat(
    ...records.map((record) => new Uint8Array(type.toBuffer(record))),
  );
  const syncMarker = Uint8Array.from(
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  const header = concat(
    Uint8Array.of(0x4f, 0x62, 0x6a, 0x01),
    encodeMetadata([
      ["avro.schema", new TextEncoder().encode(JSON.stringify(schema))],
      ["avro.codec", new TextEncoder().encode("null")],
    ]),
    syncMarker,
  );
  const block = concat(
    encodeLong(records.length),
    encodeBytes(body),
    syncMarker,
  );
  return concat(header, block);
}

export const battleFixtureRecords: FixtureRecord[] = [
  {
    env_uuid: "fixture-env",
    uuid: "fixture-battle-0",
    index: 0,
    cell_id: 101,
  },
  {
    env_uuid: "fixture-env",
    uuid: "fixture-battle-1",
    index: 1,
    cell_id: 102,
  },
];

export const battleFixtureBytes = buildAvroOcfFixture(
  "Battle",
  battleFixtureRecords,
);

export const enemyDeckFixtureBytes = buildAvroOcfFixture("EnemyDeck", [
  {
    env_uuid: "fixture-env",
    uuid: "fixture-deck",
    index: 0,
    ship_ids: ["fixture-ships"],
  },
]);

export const enemyShipFixtureBytes = buildAvroOcfFixture("EnemyShip", [
  {
    env_uuid: "fixture-env",
    uuid: "fixture-ships",
    index: 0,
    mst_ship_id: 1,
    nowhp: 10,
    maxhp: 10,
  },
]);