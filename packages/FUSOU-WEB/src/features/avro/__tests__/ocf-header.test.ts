import { describe, expect, it } from "vitest";
import { OcfHeaderError, parseOcfHeader } from "../ocf-header";
import { battleFixtureBytes, buildAvroOcfFixture } from "../test-fixtures";

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
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function encodeString(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(encodeLong(bytes.length), bytes);
}

function encodeBytes(value: Uint8Array): Uint8Array {
  return concat(encodeLong(value.length), value);
}

function buildNegativeMapBlockHeader(
  metadata: Array<[string, Uint8Array]>,
): Uint8Array {
  const entries = metadata.map(([key, value]) =>
    concat(encodeString(key), encodeBytes(value)),
  );
  const entryBytes = concat(...entries);
  return concat(
    Uint8Array.of(0x4f, 0x62, 0x6a, 0x01),
    encodeLong(-metadata.length),
    encodeLong(entryBytes.length),
    entryBytes,
    encodeLong(0),
    new Uint8Array(16),
  );
}

describe("parseOcfHeader", () => {
  it("parses the battle-record OCF fixture header", () => {
    const header = parseOcfHeader(battleFixtureBytes);

    expect(header.codec).toBe("null");
    expect(header.schema.name).toBe("Battle");
    expect(header.schema.fields?.length ?? 0).toBeGreaterThan(0);
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

  it("accepts metadata encoded as a negative map block", () => {
    const schema = new TextEncoder().encode(
      JSON.stringify({ type: "record", name: "Record", fields: [] }),
    );
    const headerBytes = buildNegativeMapBlockHeader([
      ["avro.schema", schema],
      ["avro.codec", new TextEncoder().encode("null")],
    ]);

    const header = parseOcfHeader(headerBytes);

    expect(header.metadata["avro.codec"]).toBe("null");
    expect(header.bodyOffset).toBe(headerBytes.length);
  });

  it("builds a self-contained OCF fixture with the expected metadata", () => {
    const header = parseOcfHeader(
      buildAvroOcfFixture("MstShip", [{ id: 1, name: "fixture" }]),
    );

    expect(header.schema.name).toBe("MstShip");
    expect(header.metadata["avro.codec"]).toBe("null");
  });

  it("rejects an unsafe header varint", () => {
    const unsafeVarint = Uint8Array.from([
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0x01,
    ]);

    expect(() =>
      parseOcfHeader(concat(Uint8Array.of(0x4f, 0x62, 0x6a, 0x01), unsafeVarint)),
    ).toThrow(OcfHeaderError);
  });

  it("rejects a negative metadata byte length", () => {
    const malformed = concat(
      Uint8Array.of(0x4f, 0x62, 0x6a, 0x01),
      encodeLong(1),
      encodeString("avro.schema"),
      encodeLong(-1),
    );

    expect(() => parseOcfHeader(malformed)).toThrow(OcfHeaderError);
  });
});