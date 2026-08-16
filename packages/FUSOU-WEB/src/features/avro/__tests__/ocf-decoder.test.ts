import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AvroOcfError, decodeAvroOcfToJson } from "../ocf-decoder";

const databaseRoot = resolve(process.cwd(), "../FUSOU-DATABASE");
const battlePath = resolve(
  databaseRoot,
  "fusou/2026-06-26/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
);

describe("decodeAvroOcfToJson", () => {
  it("decodes real APP battle records", () => {
    const records = decodeAvroOcfToJson(
      new Uint8Array(readFileSync(battlePath)),
    );

    expect(records.length).toBeGreaterThan(0);
    expect(records[0]).toMatchObject({
      env_uuid: expect.any(String),
      uuid: expect.any(String),
      index: expect.any(Number),
    });
  });

  it("rejects a truncated OCF block instead of returning partial records", () => {
    const bytes = readFileSync(battlePath);
    expect(() =>
      decodeAvroOcfToJson(new Uint8Array(bytes.subarray(0, -1))),
    ).toThrow(AvroOcfError);
  });

  it("rejects a non-null codec", () => {
    const bytes = new Uint8Array(readFileSync(battlePath));
    const marker = new TextEncoder().encode("null");
    const replacement = new TextEncoder().encode("gzip");
    const index = bytes.findIndex(
      (_, offset) =>
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
    const bytes = new Uint8Array(readFileSync(battlePath));

    expect(() => decodeAvroOcfToJson(bytes, { maxRecords: 1 })).toThrow(
      expect.objectContaining({ code: "OUT_OF_MEMORY_GUARD" }),
    );
  });

  it("applies a record filter before enforcing the record limit", () => {
    const bytes = new Uint8Array(readFileSync(battlePath));
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