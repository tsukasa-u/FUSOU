import { describe, expect, it } from "vitest";
import { encodeZigzagLong } from "@fusou/compaction-core/avro";
import {
  extractSchemaFromOCF,
  get_available_schemas,
  get_available_versions,
  get_schema_json,
  matchClientSchema,
  validateAvroHeader,
  validateAvroOCF,
  validateAvroOCFByTable,
  validateAvroOCFSmart,
} from "../avro-validator";

function encodeString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from(encodeZigzagLong(bytes.length)), bytes]);
}

function encodeRawBytes(raw: Buffer): Buffer {
  return Buffer.concat([Buffer.from(encodeZigzagLong(raw.length)), raw]);
}

function buildOcf(
  schemaJson: string,
  records: Buffer[],
  opts: {
    magic?: Buffer;
    codec?: string;
    sync?: Buffer;
    blockSync?: Buffer;
    trailing?: Buffer;
  } = {},
): Uint8Array {
  const sync =
    opts.sync ?? Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const magic = opts.magic ?? Buffer.from([0x4f, 0x62, 0x6a, 0x01]);
  const codec = opts.codec ?? "null";
  const metadata = Buffer.concat([
    Buffer.from(encodeZigzagLong(2)),
    encodeString("avro.schema"),
    encodeString(schemaJson),
    encodeString("avro.codec"),
    encodeString(codec),
    Buffer.from(encodeZigzagLong(0)),
  ]);
  const header = Buffer.concat([magic, metadata, sync]);
  if (records.length === 0) return new Uint8Array(header);

  const payload = Buffer.concat(records);
  const trailing = opts.trailing ?? Buffer.alloc(0);
  const blockSync = opts.blockSync ?? sync;
  const block = Buffer.concat([
    Buffer.from(encodeZigzagLong(records.length)),
    Buffer.from(encodeZigzagLong(payload.length + trailing.length)),
    payload,
    trailing,
    blockSync,
  ]);
  return new Uint8Array(Buffer.concat([header, block]));
}

describe("pure TS avro-validator", () => {
  it("exposes all expected schema versions and table schemas", () => {
    const versions = get_available_versions();
    expect(versions).toEqual(["v0_4", "v0_5", "v0_5_1", "v0_6_0", "v0_6_1"]);
    for (const v of versions) {
      expect(get_available_schemas(v).length).toBeGreaterThan(20);
    }
    const envInfo = get_schema_json("env_info", "v0_4");
    expect(() => JSON.parse(envInfo)).not.toThrow();
    expect(JSON.parse(envInfo).name).toBe("EnvInfo");
  });

  it("matches schemas across versions and respects hintTableVersion disambiguation", async () => {
    const enemySlotV04 = get_schema_json("enemy_slotitem", "v0_4");
    const first = await matchClientSchema(enemySlotV04);
    expect(first.matched).toBe(true);
    expect(first.version).toBe("v0_4");
    expect(first.tableVersion).toBe("0.4.0");
    expect(first.tableName).toBe("enemy_slotitem");

    const hinted = await matchClientSchema(enemySlotV04, "0.6.0");
    expect(hinted.matched).toBe(true);
    expect(hinted.version).toBe("v0_6_0");
    expect(hinted.tableVersion).toBe("0.6.0");
    expect(hinted.tableName).toBe("enemy_slotitem");

    // Version-specific schema falls back to canonical match when hint points to incompatible version
    const enemyDeckV04 = get_schema_json("enemy_deck", "v0_4");
    const fallback = await matchClientSchema(enemyDeckV04, "0.6.0");
    expect(fallback.matched).toBe(true);
    expect(fallback.tableVersion).toBe("0.4.0");
    expect(fallback.tableName).toBe("enemy_deck");

    // Preserves apache-avro 0.19 logicalType:uuid semantics while ignoring doc/default
    const withDocAndDefault = JSON.stringify({
      type: "record",
      name: "EnemyDeck",
      doc: "extra doc",
      fields: [
        { name: "env_uuid", type: { type: "string", logicalType: "uuid" } },
        { name: "uuid", type: { type: "string", logicalType: "uuid" } },
        {
          name: "ship_ids",
          type: ["null", { type: "string", logicalType: "uuid" }],
          default: null,
        },
      ],
    });
    const docMatch = await matchClientSchema(withDocAndDefault, "0.5.0");
    expect(docMatch.matched).toBe(true);
    expect(docMatch.tableName).toBe("enemy_deck");

    // Plain string without logicalType:uuid should not match logicalType:uuid schema
    const withoutLogical = JSON.stringify({
      type: "record",
      name: "EnemyDeck",
      fields: [
        { name: "env_uuid", type: "string" },
        { name: "uuid", type: "string" },
        { name: "ship_ids", type: ["null", "string"] },
      ],
    });
    const noLogicalMatch = await matchClientSchema(withoutLogical);
    expect(noLogicalMatch.matched).toBe(false);
  });

  it("validates valid OCF payloads and rejects malformed/tampered OCFs", async () => {
    const envInfoV04 = get_schema_json("env_info", "v0_4");
    const validUuid = "550e8400-e29b-41d4-a716-446655440000";
    const envRec = Buffer.concat([
      encodeString("0.4.0"),
      encodeString(validUuid),
      encodeString("env-unique-1"),
      Buffer.from(encodeZigzagLong(1730000000000)),
    ]);

    const validOcf = buildOcf(envInfoV04, [envRec, envRec]);
    expect(validateAvroHeader(validOcf).valid).toBe(true);
    expect(extractSchemaFromOCF(validOcf)).toBe(envInfoV04);

    const smartOk = await validateAvroOCFSmart(validOcf, "0.4.0");
    expect(smartOk.valid).toBe(true);
    expect(smartOk.recordCount).toBe(2);
    expect(smartOk.tableName).toBe("env_info");
    expect(smartOk.tableVersion).toBe("0.4.0");

    const explicitOk = await validateAvroOCF(validOcf, envInfoV04);
    expect(explicitOk.valid).toBe(true);
    expect(explicitOk.recordCount).toBe(2);

    const byTableOk = await validateAvroOCFByTable(validOcf, "env_info", "v0_4");
    expect(byTableOk.valid).toBe(true);
    expect(byTableOk.recordCount).toBe(2);

    // 0 records rejected
    expect((await validateAvroOCFSmart(buildOcf(envInfoV04, []), "0.4")).valid).toBe(false);
    // Bad magic rejected
    expect(
      (await validateAvroOCFSmart(buildOcf(envInfoV04, [envRec], { magic: Buffer.alloc(4) }), "0.4"))
        .valid,
    ).toBe(false);
    // Bad sync marker rejected
    expect(
      (
        await validateAvroOCFSmart(
          buildOcf(envInfoV04, [envRec], { blockSync: Buffer.alloc(16, 9) }),
          "0.4",
        )
      ).valid,
    ).toBe(false);
    // Trailing garbage in block rejected
    expect(
      (
        await validateAvroOCFSmart(
          buildOcf(envInfoV04, [envRec], { trailing: Buffer.from([0xaa, 0xbb]) }),
          "0.4",
        )
      ).valid,
    ).toBe(false);
    // Truncated payload rejected
    expect((await validateAvroOCFSmart(validOcf.slice(0, -10), "0.4")).valid).toBe(false);

    // Invalid UTF-8 rejected
    const badUtf8Rec = Buffer.concat([
      encodeRawBytes(Buffer.from([0xff, 0xfe, 0xfd])),
      encodeString(validUuid),
      encodeString("env-unique-1"),
      Buffer.from(encodeZigzagLong(1730000000000)),
    ]);
    expect((await validateAvroOCFSmart(buildOcf(envInfoV04, [badUtf8Rec]), "0.4")).valid).toBe(
      false,
    );

    // Malformed UUID logicalType rejected
    const badUuidRec = Buffer.concat([
      encodeString("0.4.0"),
      encodeString("not-a-uuid"),
      encodeString("env-unique-1"),
      Buffer.from(encodeZigzagLong(1730000000000)),
    ]);
    const badUuidOcf = buildOcf(envInfoV04, [badUuidRec]);
    expect((await validateAvroOCFSmart(badUuidOcf, "0.4.0")).valid).toBe(false);
    expect((await validateAvroOCF(badUuidOcf, envInfoV04)).valid).toBe(false);
    expect((await validateAvroOCFByTable(badUuidOcf, "env_info", "v0_4")).valid).toBe(false);

    // Valid UUIDv7 and nil UUID accepted, and nullable UUID union validates non-null branch
    const uuidV7Rec = Buffer.concat([
      encodeString("0.4.0"),
      encodeString("01982a3b-4c5d-7000-8000-000000000001"),
      encodeString("env-unique-2"),
      Buffer.from(encodeZigzagLong(1730000000000)),
    ]);
    const nilUuidRec = Buffer.concat([
      encodeString("0.4.0"),
      encodeString("00000000-0000-0000-0000-000000000000"),
      encodeString("env-unique-3"),
      Buffer.from(encodeZigzagLong(1730000000000)),
    ]);
    expect(
      (await validateAvroOCFSmart(buildOcf(envInfoV04, [uuidV7Rec, nilUuidRec]), "0.4.0")).valid,
    ).toBe(true);

    const enemyDeckV04 = get_schema_json("enemy_deck", "v0_4");
    const validEnemyDeckNullShip = Buffer.concat([
      encodeString(validUuid),
      encodeString(validUuid),
      Buffer.from(encodeZigzagLong(0)), // union branch 0 = null
    ]);
    const validEnemyDeckShipUuid = Buffer.concat([
      encodeString(validUuid),
      encodeString(validUuid),
      Buffer.from(encodeZigzagLong(1)), // union branch 1 = uuid string
      encodeString(validUuid),
    ]);
    const badEnemyDeckShipUuid = Buffer.concat([
      encodeString(validUuid),
      encodeString(validUuid),
      Buffer.from(encodeZigzagLong(1)), // union branch 1 = uuid string
      encodeString("malformed-ship-uuid"),
    ]);
    expect(
      (
        await validateAvroOCFSmart(
          buildOcf(enemyDeckV04, [validEnemyDeckNullShip, validEnemyDeckShipUuid]),
          "0.4.0",
        )
      ).valid,
    ).toBe(true);
    expect(
      (await validateAvroOCFSmart(buildOcf(enemyDeckV04, [badEnemyDeckShipUuid]), "0.4.0")).valid,
    ).toBe(false);

    // 32-bit int overflow rejected
    const enemySlotSchema = get_schema_json("enemy_slotitem", "v0_4");
    const overflowRec = Buffer.concat([
      encodeString(validUuid),
      encodeString(validUuid),
      Buffer.from(encodeZigzagLong(3_000_000_000)),
      Buffer.from(encodeZigzagLong(42)),
    ]);
    expect((await validateAvroOCFSmart(buildOcf(enemySlotSchema, [overflowRec]), "0.4")).valid).toBe(
      false,
    );

    // Unknown schema rejected
    const unknownSchema = JSON.stringify({
      type: "record",
      name: "UnknownTable",
      fields: [{ name: "a", type: "string" }],
    });
    expect(
      (await validateAvroOCFSmart(buildOcf(unknownSchema, [encodeString("x")]), "0.4")).valid,
    ).toBe(false);
  });
});
