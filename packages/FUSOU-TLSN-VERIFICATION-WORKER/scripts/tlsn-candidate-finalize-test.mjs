import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { finalizeTlsnCandidateBundle } from "./tlsn-candidate-finalize.mjs";

const artifactNames = [
  "session.json",
  "device-authentication.json",
  "device-identity.json",
  "possession-proof.json",
  "result.json",
  "consume-receipt.json",
  "worker-verification.json",
  "result-exact.bin",
  "verifier-execution-receipt-header.txt",
  "verifier-execution-receipt.bin",
  "presentation.bin",
  "metadata.json",
];

const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const jsonBytes = (value) => Buffer.from(JSON.stringify(value));

async function writeCandidate(directory) {
  const session = {
    session_id: "session-1",
    canonical_user_id: "user-1",
    device_id: "device-1",
    challenge: "binding-challenge",
    binding: "binding-value",
    device_challenge: "device-challenge",
    expires_at: "2030-01-01T00:00:00.000Z",
    session_receipt: { canonical_user_id: "user-1" },
  };
  const deviceAuthentication = { request: { nonce: "a".repeat(64) }, worker_acceptance: { status: 201 } };
  const deviceIdentity = {
    canonical_user_id: "user-1",
    device_id: "device-1",
    device_public_key: Buffer.alloc(32, 1).toString("base64url"),
    device_public_key_sha256: hash(Buffer.alloc(32, 1)),
    authority_state: "UNVERIFIED",
  };
  const possessionProof = { device_id: "device-1" };
  const result = { result_id: "result-1" };
  const consumeReceipt = { receipt_id: "consume-1" };
  const workerVerification = { verified: true, result, consume_receipt: consumeReceipt };
  const receiptBytes = jsonBytes({ receipt_id: "execution-1" });
  const artifacts = {
    "session.json": jsonBytes(session),
    "device-authentication.json": jsonBytes(deviceAuthentication),
    "device-identity.json": jsonBytes(deviceIdentity),
    "possession-proof.json": jsonBytes(possessionProof),
    "result.json": jsonBytes(result),
    "consume-receipt.json": jsonBytes(consumeReceipt),
    "worker-verification.json": jsonBytes(workerVerification),
    "result-exact.bin": jsonBytes({
      consume_receipt: consumeReceipt,
      result,
      verified: true,
    }),
    "verifier-execution-receipt-header.txt": Buffer.from(receiptBytes.toString("base64url")),
    "verifier-execution-receipt.bin": receiptBytes,
    "presentation.bin": Buffer.from("opaque alpha15 presentation bytes"),
    "metadata.json": jsonBytes({ server_identity: "untrusted-config.example" }),
  };
  for (const [name, bytes] of Object.entries(artifacts)) {
    await writeFile(path.join(directory, name), bytes, { mode: 0o600 });
  }
  const manifest = {
    schema_version: 1,
    scope: "fusou-tlsn-human-test-play-candidate",
    candidate_status: "CAPTURED_PENDING_OFFLINE_VERIFICATION",
    approval_status: "UNAPPROVED",
    target_identity_status: "NOT_YET_OBSERVED",
    target_identity_source: "alpha15-verified-presentation-required",
    presentation_sha256: hash(artifacts["presentation.bin"]),
    exact_result_sha256: hash(artifacts["result-exact.bin"]),
    verifier_execution_receipt_status: "CAPTURED",
    verifier_execution_receipt_sha256: hash(receiptBytes),
    worker_result_http_status: 200,
    connection_id: 5,
    readiness_effect: "NONE",
    gameplay_effect: "NONE",
    artifacts: Object.fromEntries(artifactNames.map((name) => [name, {
      size_bytes: artifacts[name].length,
      sha256: hash(artifacts[name]),
    }])),
  };
  await writeFile(path.join(directory, "candidate-manifest.json"), JSON.stringify(manifest), { mode: 0o600 });
  return { manifest, session, artifacts };
}

function trustContext() {
  return {
    verifierIdentityKeyRegistry: {},
    trustedRuntimeIdentity: {},
    expectedJobId: "job-1",
    expectedVerificationAttemptId: "attempt-1",
    sessionAuthority: {},
    bindingAuthority: {},
    resultAuthority: {},
    deploymentManifest: { target: { server_identity: "verified.example.test" } },
    profileSha256: "profile-hash",
    notaryRegistry: {},
    trustAnchorDer: "trust-anchor",
  };
}

test("finalizer rejects incomplete candidate captures before verification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-incomplete-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  const { manifest } = await writeCandidate(candidateDirectory);
  manifest.candidate_status = "INCOMPLETE_MISSING_EXECUTION_RECEIPT";
  await writeFile(
    path.join(candidateDirectory, "candidate-manifest.json"),
    JSON.stringify(manifest),
    { mode: 0o600 },
  );

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /candidate manifest scope or status is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects a tampered artifact before offline verification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-tamper-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);
  await writeFile(path.join(candidateDirectory, "presentation.bin"), "tampered");

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: trustContext() }),
      /artifact integrity mismatch/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("finalizer rejects unexpected trust-context fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fusou-tlsn-candidate-trust-"));
  const candidateDirectory = path.join(root, "candidate");
  await mkdir(candidateDirectory, { mode: 0o700 });
  await writeCandidate(candidateDirectory);
  const untrustedContext = { ...trustContext(), unexpected: "not-accepted" };

  try {
    await assert.rejects(
      finalizeTlsnCandidateBundle({ candidateDirectory, trustContext: untrustedContext }),
      /fields are incomplete or unexpected/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});