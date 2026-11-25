import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { productionQueueReceiptSigner } from "../src/production_queue_receipt.ts";

function testKey(seedByte) {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.alloc(32, seedByte)]),
    format: "der",
    type: "pkcs8",
  });
  return {
    pkcs8: key.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    spki: createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

const environment = {
  TLSN_PRODUCTION_DEPLOYMENT_ID: "local-receipt-vector",
  TLSN_PRODUCTION_WORKER_NAME: "fusou-local-queue",
  TLSN_GIT_COMMIT_SHA: "a".repeat(40),
  CF_VERSION_METADATA: { id: "070b7b61-8570-4a01-b70e-f4ffb9c02cb4" },
  TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID: "local-result",
  TLSN_PRODUCTION_RESULT_PUBLIC_KEY_SPKI: testKey(1).spki,
  TLSN_PRODUCTION_SESSION_AUTHORITY_KEY_ID: "local-session",
  TLSN_PRODUCTION_SESSION_AUTHORITY_PUBLIC_KEY_SPKI: testKey(2).spki,
  TLSN_PRODUCTION_BINDING_AUTHORITY_KEY_ID: "local-binding",
  TLSN_PRODUCTION_BINDING_AUTHORITY_PUBLIC_KEY_SPKI: testKey(3).spki,
  TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID: "local-queue-execution",
  TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI: testKey(4).spki,
  TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8: testKey(4).pkcs8,
};
const sha256 = (raw) => createHash("sha256").update(raw).digest("base64url");

async function createVector() {
  const signer = await productionQueueReceiptSigner(environment);
  assert.ok(signer);
  const issuedAt = "2026-11-25T03:30:00.000Z";
  const presentationBytes = Buffer.from("Synthetic byte-binding vector\u0000");
  const presentationSha = sha256(presentationBytes);
  const resultOuterUtf8 = JSON.stringify({
    verified: true,
    result: { version: 2, presentation_sha256: presentationSha },
    consume_receipt: { presentation_id: presentationSha, used_at: issuedAt },
  }) + "\n";
  const receipt = await signer({
    jobId: "3025fea0-1df3-4ea5-ad89-354a36eb3fff",
    verificationAttemptId: "4ae0e192-ea77-4751-9edb-ad3adc2827dd",
    presentationBytes,
    resultBytes: Buffer.from(resultOuterUtf8),
    profile: "complete",
    issuedAt,
  });
  return {
    presentation_base64url: presentationBytes.toString("base64url"),
    result_outer_utf8: resultOuterUtf8,
    receipt_utf8: Buffer.from(receipt).toString("utf8"),
    independent_trust: {
      schema_version: 1,
      scope: "tlsn-production-queue-verifier-execution-trust",
      deployment_id: environment.TLSN_PRODUCTION_DEPLOYMENT_ID,
      worker_name: environment.TLSN_PRODUCTION_WORKER_NAME,
      runtime_version_id: environment.CF_VERSION_METADATA.id,
      source_sha: environment.TLSN_GIT_COMMIT_SHA,
      verifier_execution_key_id: environment.TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID,
      verifier_public_key_spki: environment.TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI,
      not_before: "2026-11-25T03:00:00.000Z",
      not_after: "2026-11-25T04:00:00.000Z",
      execution_mode: "queue",
    },
  };
}

test("Queue signer matches the independently verified exact-byte vector", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/production-queue-execution-receipt-v1.json", import.meta.url)));
  const vector = await createVector();
  assert.deepEqual(vector, fixture);
  const { signature_algorithm, signature_base64url, ...receipt } = JSON.parse(vector.receipt_utf8);
  assert.equal(signature_algorithm, "Ed25519");
  const payload = Buffer.from(
    "FUSOU-TLSN-PRODUCTION-QUEUE-VERIFIER-EXECUTION-V1\0" + JSON.stringify(Object.values(receipt)),
  );
  const publicKey = createPublicKey({
    key: Buffer.from(fixture.independent_trust.verifier_public_key_spki, "base64url"),
    format: "der",
    type: "spki",
  });
  assert.equal(receipt.result_sha256, sha256(Buffer.from(vector.result_outer_utf8)));
  assert.equal(receipt.presentation_sha256, sha256(Buffer.from(vector.presentation_base64url, "base64url")));
  assert.ok(verify(null, payload, publicKey, Buffer.from(signature_base64url, "base64url")));
  assert.equal(verify(null, Buffer.concat([payload, Buffer.from(" ")]), publicKey, Buffer.from(signature_base64url, "base64url")), false);
});

test("Queue capability rejects absent or mismatched keys, aliases and missing deployment identity", async () => {
  const variants = [
    { TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8: undefined },
    { TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8: testKey(5).pkcs8 },
    { TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI: testKey(4).spki + "=" },
    { TLSN_PRODUCTION_QUEUE_EXECUTION_KEY_ID: environment.TLSN_PRODUCTION_RESULT_SIGNER_KEY_ID },
    { TLSN_PRODUCTION_QUEUE_EXECUTION_PUBLIC_KEY_SPKI: testKey(2).spki, TLSN_PRODUCTION_QUEUE_EXECUTION_PRIVATE_KEY_PKCS8: testKey(2).pkcs8 },
    { CF_VERSION_METADATA: undefined },
    { TLSN_GIT_COMMIT_SHA: "invalid" },
  ];
  for (const changed of variants) {
    assert.equal(await productionQueueReceiptSigner({ ...environment, ...changed }), null);
  }
});

test("Queue signing rejects malformed operations and empty exact bodies", async () => {
  const signer = await productionQueueReceiptSigner(environment);
  assert.ok(signer);
  const signingInput = {
    jobId: "3025fea0-1df3-4ea5-ad89-354a36eb3fff",
    verificationAttemptId: "4ae0e192-ea77-4751-9edb-ad3adc2827dd",
    presentationBytes: Buffer.from("fixture"),
    resultBytes: Buffer.from("result"),
    profile: "sparse",
    issuedAt: "2026-11-25T03:30:00.000Z",
  };
  const signed = JSON.parse(Buffer.from(await signer(signingInput)));
  assert.equal(signed.verification_profile, "sparse");
  for (const changed of [
    { jobId: "bad" },
    { verificationAttemptId: signingInput.verificationAttemptId.toUpperCase() },
    { issuedAt: "2026-02-30T03:30:00.000Z" },
    { resultBytes: Buffer.alloc(0) },
  ]) {
    await assert.rejects(signer({ ...signingInput, ...changed }), /input is invalid/);
  }
});
