import { describe, expect, it } from "vitest";
import { AvroOcfError, decodeAvroOcfToJson } from "../ocf-decoder";
import { battleFixtureBytes } from "../test-fixtures";

describe("decodeAvroOcfToJson", () => {
  it("decodes battle-record OCF fixtures", () => {
    const records = decodeAvroOcfToJson(battleFixtureBytes);

    expect(records.length).toBeGreaterThan(0);
    expect(records[0]).toMatchObject({
      env_uuid: expect.any(String),
      uuid: expect.any(String),
      index: expect.any(Number),
    });
  });

  it("rejects a truncated OCF block instead of returning partial records", () => {
    const bytes = battleFixtureBytes;
    expect(() =>
      decodeAvroOcfToJson(new Uint8Array(bytes.subarray(0, -1))),
    ).toThrow(AvroOcfError);
  });

  it("rejects a non-null codec", () => {
    const bytes = new Uint8Array(battleFixtureBytes);
    const marker = new TextEncoder().encode("null");
    const replacement = new TextEncoder().encode("gzip");
    const codecKey = new TextEncoder().encode("avro.codec");
    const codecKeyIndex = bytes.findIndex(
      (_, offset) =>
        offset + codecKey.length <= bytes.length &&
        codecKey.every(
          (value, keyIndex) => bytes[offset + keyIndex] === value,
        ),
    );
    const index = bytes.findIndex(
      (_, offset) =>
        offset > codecKeyIndex &&
        offset + marker.length <= bytes.length &&
        marker.every(
          (value, markerIndex) => bytes[offset + markerIndex] === value,
        ),
    );
    expect(index).toBeGreaterThanOrEqual(0);
    bytes.set(replacement, index);

    expect(() => decodeAvroOcfToJson(bytes)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_CODEC" }),
    );
  });

  it("stops decoding before materializing records beyond the limit", () => {
    const bytes = new Uint8Array(battleFixtureBytes);

    expect(() => decodeAvroOcfToJson(bytes, { maxRecords: 1 })).toThrow(
      expect.objectContaining({ code: "OUT_OF_MEMORY_GUARD" }),
    );
  });

  it("applies a record filter before enforcing the record limit", () => {
    const bytes = new Uint8Array(battleFixtureBytes);
    const targetUuid = String(decodeAvroOcfToJson(bytes)[0]?.["uuid"]);
    let matched = false;

    const records = decodeAvroOcfToJson(bytes, {
      maxRecords: 1,
      recordFilter: (record) => {
        if (matched || record["uuid"] !== targetUuid) return false;
        matched = true;
        return true;
      },
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.["uuid"]).toBe(targetUuid);
  });
});