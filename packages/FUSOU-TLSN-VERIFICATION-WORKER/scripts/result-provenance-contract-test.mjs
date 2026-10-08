import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  derive_sparse_verifier_result_signing_bytes,
  derive_verifier_result_signing_bytes,
} from "../src/wasm/fusou_tlsn_verifier.js";
import {
  assertSignedResult,
  assertSignedSparseResult,
  resultSigningBytes,
  sparseResultSigningBytes,
} from "./production-evidence.mjs";
import {
  assertSemanticResultMatches,
  verifyCanaryPresentation,
  verifyProductionPresentation,
  verifyResultPresentationBinding,
  verifySparseResultPresentationBinding,
  verifySyntheticFixturePresentation,
} from "./production-evidence-semantic.mjs";
import { createSyntheticCandidateBundle } from "./tlsn-candidate-synthetic-fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const inventoryDigest = sha256(Buffer.from("independent synthetic Origin inventory"));
const approvalDigest = sha256(Buffer.from("independent synthetic Target Approval"));

test("Result provenance preserves the JS/Rust signing and verification contract", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "fusou-result-provenance-"));
  try {
    const fixture = await createSyntheticCandidateBundle(directory);
    const originalResult = JSON.parse(fixture.resultBytes).result;
    const baseInputs = {
      serverIdentity: originalResult.server_identity,
      profileSha256: fixture.trustContext.profileSha256,
      verifierKeyId: originalResult.verifier_key_id,
      notaryKeyId: originalResult.notary_key_id,
      canonicalUserId: originalResult.canonical_user_id,
      canonicalDeviceId: originalResult.device_id,
      deviceChallenge: originalResult.device_challenge,
      notaryRegistry: fixture.trustContext.notaryRegistry,
      trustRootDer: fixture.trustContext.trustAnchorDer,
    };
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
    const signerKeyId = "provenance-contract-result-signer";
    const signingAuthority = {
      publicKeySpki,
      signerKeyId,
      keyRegistry: {
        schema_version: 1,
        scope: "tlsn-result-signing-key-registry",
        keys: [{
          key_id: signerKeyId,
          public_key_spki: publicKeySpki,
          status: "ACTIVE",
          not_before: "2026-01-01T00:00:00.000Z",
          not_after: null,
        }],
      },
    };

    for (const disclosureMode of ["complete", "sparse"]) {
      await t.test(`${disclosureMode} Result binds raw Presentation and both provenance digests`, async () => {
        const sparse = disclosureMode === "sparse";
        const presentationBytes = sparse ? fixture.sparsePresentationBytes : fixture.presentationBytes;
        const encodeSigningBytes = sparse ? sparseResultSigningBytes : resultSigningBytes;
        const deriveRustSigningBytes = sparse
          ? derive_sparse_verifier_result_signing_bytes
          : derive_verifier_result_signing_bytes;
        const assertSigned = sparse ? assertSignedSparseResult : assertSignedResult;
        const verifyBinding = sparse ? verifySparseResultPresentationBinding : verifyResultPresentationBinding;
        const domain = sparse ? "FUSOU-VERIFIER-SPARSE-RESULT-V2\0" : "FUSOU-VERIFIER-RESULT-V2\0";
        const inputs = {
          ...baseInputs,
          presentationBytes,
          disclosureMode,
          originInventorySha256: inventoryDigest,
          targetApprovalArtifactSha256: approvalDigest,
        };
        const semantic = await verifySyntheticFixturePresentation(inputs);
        const result = semantic.result;
        assert.equal(result.version, sparse ? 3 : 2);
        assert.equal(result.presentation_sha256, sha256(presentationBytes));
        assert.equal(result.origin_inventory_sha256, inventoryDigest);
        assert.equal(result.target_approval_artifact_sha256, approvalDigest);
        const jsSigningBytes = encodeSigningBytes(result);
        assert.deepEqual(jsSigningBytes, semantic.signing_bytes);
        assert.deepEqual(Buffer.from(deriveRustSigningBytes(JSON.stringify(result))), jsSigningBytes);
        assert.equal(jsSigningBytes.subarray(0, Buffer.byteLength(domain)).toString(), domain);
        const signedResult = {
          ...result,
          signature: sign(null, jsSigningBytes, privateKey).toString("base64url"),
        };
        assert.equal(assertSigned(signedResult, signingAuthority).result_signature_valid, true);
        assertSemanticResultMatches(signedResult, semantic);
        assert.equal(verifyBinding({ semanticVerification: semantic, result: signedResult }).status, "PASS");

        for (const field of [
          "presentation_sha256",
          "origin_inventory_sha256",
          "target_approval_artifact_sha256",
          "server_identity",
        ]) {
          const changed = {
            ...signedResult,
            [field]: field === "server_identity" ? "other.example.test" : Buffer.alloc(32, 0x99).toString("base64url"),
          };
          const changedBytes = encodeSigningBytes(changed);
          assert.notDeepEqual(changedBytes, jsSigningBytes, `${field} must be signed`);
          assert.deepEqual(Buffer.from(deriveRustSigningBytes(JSON.stringify(changed))), changedBytes);
          assert.throws(() => assertSigned(changed, signingAuthority), /signature is invalid/);
          assert.throws(() => assertSemanticResultMatches(changed, semantic), /Worker Result/);
          assert.equal(verifyBinding({ semanticVerification: semantic, result: changed }).status, "FAIL");
        }
        const oldDomain = domain.replace("-V2\0", "-V1\0");
        const oldDomainSignature = sign(null, Buffer.concat([
          Buffer.from(oldDomain),
          jsSigningBytes.subarray(Buffer.byteLength(domain)),
        ]), privateKey).toString("base64url");
        assert.throws(() => assertSigned({ ...signedResult, signature: oldDomainSignature }, signingAuthority), /signature is invalid/);
        assert.throws(() => assertSigned({ ...signedResult, version: result.version - 1 }, signingAuthority), /schema is invalid/);

        for (const field of ["origin_inventory_sha256", "target_approval_artifact_sha256"]) {
          const halfPair = { ...result, [field]: null };
          assert.throws(() => encodeSigningBytes(halfPair), /must be present together/);
          assert.throws(() => deriveRustSigningBytes(JSON.stringify(halfPair)), /must be present together/);
        }
        const generic = await verifySyntheticFixturePresentation({
          ...inputs,
          originInventorySha256: null,
          targetApprovalArtifactSha256: null,
        });
        assert.equal(generic.result.origin_inventory_sha256, null);
        assert.equal(generic.result.target_approval_artifact_sha256, null);
        assert.deepEqual(encodeSigningBytes(generic.result), generic.signing_bytes);
        assert.notDeepEqual(generic.signing_bytes, jsSigningBytes);
        assert.equal(verifyBinding({ semanticVerification: semantic, result: generic.result }).status, "FAIL");
        await assert.rejects(
          verifySyntheticFixturePresentation({ ...inputs, targetApprovalArtifactSha256: null }),
          /must be present together/,
        );
      });
    }

    const { trustRootDer, ...productionInputs } = baseInputs;
    for (const [label, overrides, expectedError] of [
      ["missing inventory", { originInventorySha256: undefined }, /Production Origin inventory SHA-256/],
      ["missing approval", { targetApprovalArtifactSha256: undefined }, /Production Target Approval artifact SHA-256/],
      ["null pair", { originInventorySha256: null, targetApprovalArtifactSha256: null }, /Production Origin inventory SHA-256/],
      ["short inventory", { originInventorySha256: Buffer.alloc(31).toString("base64url") }, /invalid length/],
      ["short approval", { targetApprovalArtifactSha256: Buffer.alloc(31).toString("base64url") }, /invalid length/],
      ["custom Origin root", { trustRootDer }, /custom Origin trust roots/],
    ]) {
      await t.test(`Production rejects ${label}`, async () => {
        await assert.rejects(verifyProductionPresentation({
          ...productionInputs,
          presentationBytes: fixture.presentationBytes,
          originInventorySha256: inventoryDigest,
          targetApprovalArtifactSha256: approvalDigest,
          ...overrides,
        }), expectedError);
      });
    }
    await t.test("Production never accepts the synthetic Origin trust root", async () => {
      await assert.rejects(verifyProductionPresentation({
        ...productionInputs,
        presentationBytes: fixture.presentationBytes,
        originInventorySha256: inventoryDigest,
        targetApprovalArtifactSha256: approvalDigest,
      }), /alpha\.15 Presentation cryptographic inspection failed/);
    });
    await t.test("pre-approval Canary observation still requires Web PKI", async () => {
      await assert.rejects(verifyCanaryPresentation({
        ...productionInputs,
        presentationBytes: fixture.presentationBytes,
      }), /alpha\.15 Presentation cryptographic inspection failed/);
      await assert.rejects(verifyCanaryPresentation({
        ...productionInputs,
        presentationBytes: fixture.presentationBytes,
        trustRootDer,
      }), /custom Origin trust roots/);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
