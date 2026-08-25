import { describe, expect, it } from "vitest";
import {
  parseOffsetMetadata,
  validateOffsetMetadata,
} from "../offsets";

describe("offset metadata", () => {
  it("parses valid offsets and defaults the format", () => {
    expect(
      parseOffsetMetadata([
        { table_name: "battle", start_byte: 0, byte_length: 128 },
      ]),
    ).toEqual([
      {
        table_name: "battle",
        start_byte: 0,
        byte_length: 128,
        format: "avro",
      },
    ]);
  });

  it("rejects malformed offset entries", () => {
    expect(
      parseOffsetMetadata([
        { table_name: "battle", start_byte: "0", byte_length: 128 },
      ]),
    ).toBeNull();
  });

  it("preserves overlap validation after parsing", () => {
    const offsets = parseOffsetMetadata([
      { table_name: "battle", start_byte: 0, byte_length: 128 },
      { table_name: "ship", start_byte: 64, byte_length: 128 },
    ]);

    expect(offsets).not.toBeNull();
    expect(validateOffsetMetadata(offsets!, 256).valid).toBe(false);
  });
});