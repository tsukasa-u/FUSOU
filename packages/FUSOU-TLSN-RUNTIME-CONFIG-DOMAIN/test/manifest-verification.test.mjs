import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyRuntimeConfigManifestEpochPointer } from "../src/index.ts";
import { verifyTlsnRuntimeConfigEpochPointer } from "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/tlsn-runtime-config-manifest.mjs";

const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const raw = new TextEncoder().encode(vector.manifest_envelope_utf8);

test("Worker-compatible Manifest verification matches the existing epoch-pointer verifier", async () => {
  const [shared, existing] = await Promise.all([
    verifyRuntimeConfigManifestEpochPointer({
      raw,
      trustedSigner: vector.trusted_signer,
    }),
    verifyTlsnRuntimeConfigEpochPointer(raw, {
      trustedSigner: vector.trusted_signer,
    }),
  ]);
  assert.equal(shared.epoch, existing.epoch);
  assert.equal(shared.manifestSha256, existing.manifest_sha256);
});

test("Manifest verification rejects changed bytes, a mismatched root pin, and an undersized limit", async () => {
  const changed = Uint8Array.from(raw);
  changed[changed.length - 2] ^= 1;
  await assert.rejects(
    verifyRuntimeConfigManifestEpochPointer({
      raw: changed,
      trustedSigner: vector.trusted_signer,
    }),
  );
  await assert.rejects(
    verifyRuntimeConfigManifestEpochPointer({
      raw,
      trustedSigner: {
        ...vector.trusted_signer,
        key_id: "different-test-root",
      },
    }),
  );
  await assert.rejects(
    verifyRuntimeConfigManifestEpochPointer({
      raw,
      trustedSigner: vector.trusted_signer,
      maxEnvelopeBytes: raw.byteLength - 1,
    }),
  );
});
