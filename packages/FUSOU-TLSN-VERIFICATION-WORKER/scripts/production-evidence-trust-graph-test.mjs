import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  assertTrustGraph,
  deriveProductionTrustGraph,
} from "./production-evidence-contract.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

// Structural fixtures only: no real Presentation, signed Result, or service evidence.
function inputsFor(disclosureMode) {
  const presentationBytes = Buffer.from("synthetic trust graph Presentation");
  const presentationSha256 = digest(presentationBytes);
  const attestationId = Buffer.alloc(16, 1).toString("base64url");
  const result = {
    tlsn_attestation_id: attestationId,
    presentation_sha256: presentationSha256,
    disclosure_mode: disclosureMode,
    binding_value: "synthetic binding",
    verified_member_id: "123",
    notary_key_id: "synthetic-notary",
    response_transcript_sha256: digest("synthetic response"),
    revealed_request_ranges: [],
    revealed_response_ranges: [],
  };
  return {
    captureId: "synthetic-capture",
    authenticatedUserId: "synthetic-user",
    deviceId: "synthetic-device",
    devicePublicKeySha256: digest("synthetic device key"),
    deviceAuthentication: {
      request: { device_id: "synthetic-device", nonce: "synthetic nonce" },
    },
    session: {
      session_id: "synthetic-session",
      session_receipt: { signer_key_id: "synthetic-authority" },
      binding: result.binding_value,
      challenge: "synthetic challenge",
    },
    presentationBytes,
    semanticVerification: {
      verified_presentation: { tlsn_attestation_id: attestationId },
      result,
    },
    result,
    resultBytes: Buffer.from(JSON.stringify(result)),
    resultSignerKeyId: "synthetic-result-signer",
    resultRegistrySha256: digest("synthetic registry"),
    resultRegistryEnvelopeSha256: digest("synthetic envelope"),
    resultRegistryRootKeyId: "synthetic-root",
    resultRegistryRootPublicKeySpki: "synthetic public key",
    proxyProvenance: {
      declared: "production",
      cryptographic_status: "UNVERIFIED",
      authority: {
        type: "externally-pinned-production-proxy-key",
        status: "UNVERIFIED",
      },
      proxy_identity: null,
      proxy_deployment_id: null,
      proxy_binary_identity: null,
      presentation_sha256: presentationSha256,
      created_at: "2026-10-24T00:00:00.000Z",
      signer_key_id: null,
      signature: null,
      capture_context: {},
    },
  };
}

for (const mode of ["complete", "sparse"]) {
  test(`${mode}: matching Presentation bindings preserve graph identities and topology`, () => {
    const inputs = inputsFor(mode);
    const graph = deriveProductionTrustGraph(inputs);
    assert.equal(assertTrustGraph(graph), graph);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.equal(nodes.get("presentation").identity.presentation_sha256, digest(inputs.presentationBytes));
    assert.equal(nodes.get("result").identity.result_sha256, digest(inputs.resultBytes));
    assert.equal(nodes.get("production-proxy").identity.cryptographic_status, "UNVERIFIED");
    assert.equal(nodes.get("remote-attestation").identity.status, "UNVERIFIED");
    const edge = graph.edges.find(({ id }) => id === "session-binding-authenticates-presentation");
    assert.equal(edge.binding_fields.includes("revealed_request_ranges"), mode === "sparse");
  });

  test(`${mode}: changed raw Presentation bytes are rejected`, () => {
    const inputs = inputsFor(mode);
    inputs.presentationBytes[0] ^= 1;
    assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
  });

  test(`${mode}: Result Presentation hash must match the exact raw bytes`, () => {
    for (const value of [
      undefined,
      null,
      "",
      digest("wrong Presentation"),
      `${digest("synthetic trust graph Presentation")}=`,
      42,
    ]) {
      const inputs = inputsFor(mode);
      inputs.semanticVerification.result.presentation_sha256 = value;
      assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
    }
  });

  test(`${mode}: proxy provenance cannot refer to another Presentation`, () => {
    const inputs = inputsFor(mode);
    inputs.proxyProvenance.presentation_sha256 = digest("another Presentation");
    assert.throws(() => deriveProductionTrustGraph(inputs), /proxy provenance Presentation hash/);
  });

  test(`${mode}: matching declarations cannot replace the raw Presentation binding`, () => {
    const inputs = inputsFor(mode);
    const wrongDigest = digest("another Presentation");
    inputs.semanticVerification.result.presentation_sha256 = wrongDigest;
    inputs.proxyProvenance.presentation_sha256 = wrongDigest;
    assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
  });

  test(`${mode}: existing Attestation ID binding still rejects a different ID`, () => {
    const inputs = inputsFor(mode);
    inputs.semanticVerification.result.tlsn_attestation_id = Buffer.alloc(16, 2).toString("base64url");
    assert.throws(() => deriveProductionTrustGraph(inputs), /Attestation IDs do not match/);
  });
}
