import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyRuntimeConfigManifestEpochPointer } from "../src/index.ts";

const vector = JSON.parse(readFileSync(
  new URL(
    "../../FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-manifest-delegation-v1-golden.json",
    import.meta.url,
  ),
  "utf8",
));

test("Manifest delegation raw golden vectors enforce the same accept/reject contract", async () => {
  assert.equal(vector.test_only, true);
  for (const testVector of vector.vectors) {
    const raw = Buffer.from(testVector.manifest_envelope_base64url, "base64url");
    const policy = { ...vector.policy, ...testVector.policy_overrides };
    const verify = () => verifyRuntimeConfigManifestEpochPointer({
      raw,
      trustedSigner: testVector.trusted_signer ?? vector.trusted_signer,
      maxEnvelopeBytes: policy.max_envelope_bytes,
      manifestUrl: policy.manifest_url,
      nowMs: policy.now_ms,
      maxClockSkewSeconds: policy.max_clock_skew_seconds,
      lastAcceptedEpoch: policy.last_accepted_epoch,
      lastAcceptedManifestSha256: policy.last_accepted_manifest_sha256,
      lastAcceptedManifestAuthorityGeneration:
        policy.last_accepted_manifest_authority_generation,
      lastAcceptedManifestAuthorityDelegationSha256:
        policy.last_accepted_manifest_authority_delegation_sha256,
    });

    if (testVector.expected_accept) {
      const verified = await verify();
      assert.equal(verified.envelopeSchemaVersion, 3, testVector.name);
      assert.equal(
        verified.manifestAuthorityGeneration,
        testVector.expected_authority_generation,
        testVector.name,
      );
      assert.match(verified.manifestAuthorityDelegationSha256, /^[A-Za-z0-9_-]{43}$/);
      assert.match(verified.approvedConfigSha256, /^[A-Za-z0-9_-]{43}$/);
    } else {
      await assert.rejects(verify, undefined, testVector.name);
    }
  }
});
