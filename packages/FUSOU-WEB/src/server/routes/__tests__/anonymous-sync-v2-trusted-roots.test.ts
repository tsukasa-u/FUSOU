import { describe, expect, it } from "vitest";
import {
  parseTrustedRootList,
  resolveRequiredTrustedRootEnv,
} from "../anonymous-sync-v2";

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

describe("anonymous-sync-v2 trusted roots", () => {
  it("parses trusted root env values from JSON and delimiter formats", () => {
    const parsedJson = parseTrustedRootList(
      '["' + "a".repeat(64) + '","' + "b".repeat(64) + '"]',
    );
    const parsedDelimited = parseTrustedRootList(
      `${"c".repeat(64)}, ${"d".repeat(64)} ${"e".repeat(64)}`,
    );

    expect(parsedJson).toEqual(["a".repeat(64), "b".repeat(64)]);
    expect(parsedDelimited).toEqual([
      "c".repeat(64),
      "d".repeat(64),
      "e".repeat(64),
    ]);

    for (const hash of [...parsedJson, ...parsedDelimited]) {
      expect(SHA256_HEX_PATTERN.test(hash)).toBe(true);
    }
  });

  it("requires hardware attestation trusted roots to be configured via env", () => {
    expect(
      resolveRequiredTrustedRootEnv({
        attestationLevel: "secure_enclave",
        secureEnclaveTrustedRoots: [],
        tpmAkTrustedRoots: ["a".repeat(64)],
      }),
    ).toBe("INTEGRITY_SECURE_ENCLAVE_TRUSTED_ROOT_SHA256");

    expect(
      resolveRequiredTrustedRootEnv({
        attestationLevel: "tpm",
        secureEnclaveTrustedRoots: ["a".repeat(64)],
        tpmAkTrustedRoots: [],
      }),
    ).toBe("INTEGRITY_TPM_AK_TRUSTED_ROOT_SHA256");

    expect(
      resolveRequiredTrustedRootEnv({
        attestationLevel: "software_fingerprint",
        secureEnclaveTrustedRoots: [],
        tpmAkTrustedRoots: [],
      }),
    ).toBeNull();
  });
});
