import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256,
  DEFAULT_TPM_AK_TRUSTED_ROOT_SHA256,
  parseTrustedRootList,
} from "../anonymous-sync-v2";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

describe("anonymous-sync-v2 trusted root defaults", () => {
  it("uses valid SHA-256 hex values without duplicates", () => {
    const secureRoots = DEFAULT_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256;
    const tpmRoots = DEFAULT_TPM_AK_TRUSTED_ROOT_SHA256;

    expect(secureRoots.length).toBeGreaterThan(0);
    expect(tpmRoots.length).toBeGreaterThan(0);

    for (const hash of [...secureRoots, ...tpmRoots]) {
      expect(SHA256_HEX_PATTERN.test(hash)).toBe(true);
    }

    expect(new Set(secureRoots).size).toBe(secureRoots.length);
    expect(new Set(tpmRoots).size).toBe(tpmRoots.length);
  });

  it("parses trusted root env values from JSON and delimiter formats", () => {
    expect(
      parseTrustedRootList(
        '["' +
          "a".repeat(64) +
          '","' +
          "b".repeat(64) +
          '"]',
      ),
    ).toEqual(["a".repeat(64), "b".repeat(64)]);

    expect(
      parseTrustedRootList(`${"c".repeat(64)}, ${"d".repeat(64)} ${"e".repeat(64)}`),
    ).toEqual(["c".repeat(64), "d".repeat(64), "e".repeat(64)]);
  });
});
