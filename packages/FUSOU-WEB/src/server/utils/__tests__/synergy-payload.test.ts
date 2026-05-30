import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { sha256Hex, validateSynergyPayload } from "../synergy-payload";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const samplePayload = {
  effect_rules: [],
  cross_rules: [],
  _meta: {
    period_tag: "2026-05-30",
    generated: "2026-05-30T00:00:00.000Z",
  },
};

const rawBytes = encoder.encode(JSON.stringify(samplePayload));

describe("synergy-payload utilities", () => {
  it("validates plain JSON payload", async () => {
    const expectedSha = await sha256Hex(rawBytes);
    const validated = await validateSynergyPayload(rawBytes, expectedSha);

    expect(validated.actualSha256).toBe(expectedSha);
    expect(validated.parsed).toEqual(samplePayload);
    expect(decoder.decode(validated.decoded)).toContain("effect_rules");
  });

  it("validates gzip-compressed payload", async () => {
    const gzBytes = new Uint8Array(gzipSync(rawBytes));
    const expectedSha = await sha256Hex(rawBytes);

    const validated = await validateSynergyPayload(gzBytes, expectedSha);
    expect(validated.actualSha256).toBe(expectedSha);
    expect(validated.parsed).toEqual(samplePayload);
  });

  it("validates brotli-compressed payload", async () => {
    const brBytes = new Uint8Array(brotliCompressSync(rawBytes));
    const expectedSha = await sha256Hex(rawBytes);

    const validated = await validateSynergyPayload(brBytes, expectedSha);
    expect(validated.actualSha256).toBe(expectedSha);
    expect(validated.parsed).toEqual(samplePayload);
  });

  it("rejects non-JSON payload", async () => {
    const invalidBytes = new Uint8Array([0xff, 0x00, 0x01, 0x02]);

    await expect(validateSynergyPayload(invalidBytes)).rejects.toMatchObject({
      issue: "invalid_json",
    });
  });

  it("rejects JSON whose root is not an object", async () => {
    const arrayRoot = encoder.encode(JSON.stringify([1, 2, 3]));

    await expect(validateSynergyPayload(arrayRoot)).rejects.toMatchObject({
      issue: "root_not_object",
    });
  });

  it("rejects hash mismatch", async () => {
    await expect(
      validateSynergyPayload(rawBytes, "0".repeat(64)),
    ).rejects.toMatchObject({
      issue: "hash_mismatch",
    });
  });
});
