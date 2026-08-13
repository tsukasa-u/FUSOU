import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OcfHeaderError, parseOcfHeader } from "../ocf-header";

const databaseRoot = resolve(process.cwd(), "../FUSOU-DATABASE");

describe("parseOcfHeader", () => {
  it("parses the real APP transaction OCF header", () => {
    const bytes = readFileSync(
      resolve(
        databaseRoot,
        "fusou/2026-06-26/transaction_data/6-5/battle/1783429200_049fe173-e1d1-4ac1-b55d-41a1b0aed8ec.avro",
      ),
    );

    const header = parseOcfHeader(new Uint8Array(bytes));

    expect(header.codec).toBe("null");
    expect(header.schema.name).toBe("Battle");
    expect(header.schema.fields).toHaveLength(42);
    expect(header.metadata["table_version"]).toBeUndefined();
    expect(header.syncMarker).toHaveLength(16);
    expect(header.bodyOffset).toBeGreaterThan(4);
  });

  it("rejects truncated and non-OCF input", () => {
    expect(() => parseOcfHeader(new Uint8Array([0x4f, 0x62]))).toThrow(
      OcfHeaderError,
    );
    expect(() => parseOcfHeader(new Uint8Array([0, 1, 2, 3]))).toThrow(
      OcfHeaderError,
    );
  });
});