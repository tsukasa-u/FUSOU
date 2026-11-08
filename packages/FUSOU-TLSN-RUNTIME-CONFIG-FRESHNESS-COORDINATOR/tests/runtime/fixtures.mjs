import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  canonicalJsonBytes,
  createFreshnessIssueCurrentStateBinding,
  verifyFreshnessManifestBinding,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/index.ts";

export const vector = JSON.parse(
  readFileSync(
    new URL(
      "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/test/fixtures/freshness-v1-golden.json",
      import.meta.url,
    ),
  ),
);
export const requestBytes = Buffer.from(
  vector.request_raw_base64url,
  "base64url",
);
export const responseBytes = Buffer.from(
  vector.response_raw_base64url,
  "base64url",
);
export const requestObject = JSON.parse(requestBytes.toString("utf8"));
export const rootSigner = Object.freeze({ ...vector.root_signer });
export const responsePayload = JSON.parse(
  Buffer.from(
    JSON.parse(responseBytes.toString("utf8")).payload_base64url,
    "base64url",
  ).toString("utf8"),
);
export const signedAtMs = Date.parse(responsePayload.issued_at);
export const clockId = "local-worker-runtime-test-clock";
export const clockEpoch = "local-worker-runtime-test-epoch-1";

const releaseRecordBytes = Buffer.from(
  vector.release_commit_record_raw_base64url,
  "base64url",
);
const releaseDelegationBytes = Buffer.from(
  vector.release_delegation_raw_base64url,
  "base64url",
);
const manifestBytes = Buffer.from(vector.manifest_raw_base64url, "base64url");
const nonceBytes = Buffer.alloc(32, 0xA5);

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

export function equalBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

export async function makeVerifiedCurrentState() {
  const witness = {
    sourceId: "test-only-independent-witness",
    restoreEpoch: clockEpoch,
    generation: vector.pending_attempt.commit_generation,
    recordSha256: digest(releaseRecordBytes),
    signedBytes: Buffer.alloc(0),
  };
  witness.signedBytes = Buffer.from(
    [
      witness.sourceId,
      witness.restoreEpoch,
      witness.generation,
      witness.recordSha256,
    ].join("|"),
  );
  const evidence = {
    journalHead: {
      recordBytes: Uint8Array.from(releaseRecordBytes),
      releaseDelegationBytes: Uint8Array.from(releaseDelegationBytes),
      appendedAt: vector.release_commit_record_appended_at,
      appendReceiptBytes: Buffer.from("test-only-exact-append-receipt"),
    },
    coordinatorHead: {
      environment: "production",
      generation: vector.pending_attempt.commit_generation,
      recordSha256: witness.recordSha256,
      manifestEpoch: vector.pending_attempt.manifest_epoch,
      writerPending: false,
      restoreEpoch: clockEpoch,
    },
    pointer: {
      environment: "production",
      etag: vector.pending_attempt.pointer_etag,
      generation: vector.pending_attempt.commit_generation,
      bytes: Uint8Array.from(manifestBytes),
    },
    immutableSnapshot: {
      reference: vector.pending_attempt.manifest_ref,
      bytes: Uint8Array.from(manifestBytes),
    },
    manifestBytes: Uint8Array.from(manifestBytes),
    antiRollbackWitness: witness,
  };

  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: evidence.journalHead.recordBytes,
    rootSigner,
    environment: "production",
    releaseDelegationRaw: evidence.journalHead.releaseDelegationBytes,
    appendedAt: evidence.journalHead.appendedAt,
  });
  assert.equal(evidence.coordinatorHead.writerPending, false);
  assert.equal(evidence.coordinatorHead.environment, "production");
  assert.equal(
    evidence.coordinatorHead.generation,
    releaseCommit.payload.commit_generation,
  );
  assert.equal(evidence.coordinatorHead.recordSha256, releaseCommit.digest);
  assert.equal(
    evidence.coordinatorHead.manifestEpoch,
    releaseCommit.payload.manifest_epoch,
  );
  assert.equal(evidence.coordinatorHead.restoreEpoch, witness.restoreEpoch);
  assert.equal(witness.generation, releaseCommit.payload.commit_generation);
  assert.equal(witness.recordSha256, releaseCommit.digest);
  assert.deepEqual(
    Buffer.from(witness.signedBytes),
    Buffer.from(
      [
        witness.sourceId,
        witness.restoreEpoch,
        witness.generation,
        witness.recordSha256,
      ].join("|"),
    ),
  );
  assert.ok(evidence.journalHead.appendReceiptBytes.byteLength > 0);
  assert.ok(witness.signedBytes.byteLength > 0);
  assert.equal(evidence.pointer.environment, "production");
  assert.equal(
    evidence.pointer.generation,
    releaseCommit.payload.commit_generation,
  );
  assert.equal(evidence.pointer.etag, releaseCommit.payload.pointer_etag);
  assert.equal(
    evidence.immutableSnapshot.reference,
    releaseCommit.payload.manifest_ref,
  );
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.immutableSnapshot.bytes));
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.manifestBytes));
  assert.equal(digest(evidence.pointer.bytes), releaseCommit.payload.manifest_sha256);

  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
  });
  const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verifiedResponse, evidence.manifestBytes);

  const verifiedState = Object.freeze({
    source: "verified-journal-do-r2-snapshot",
    freshnessSemantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    journalHead: Object.freeze({
      generation: releaseCommit.payload.commit_generation,
      record_sha256: releaseCommit.digest,
      manifest_epoch: releaseCommit.payload.manifest_epoch,
    }),
    releaseCommitRecord: releaseCommit.envelope,
    verifiedReleaseCommitRecord: releaseCommit,
    releaseCommitRecordSha256: releaseCommit.digest,
    journalAppendedAt: evidence.journalHead.appendedAt,
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    manifestSha256: releaseCommit.payload.manifest_sha256,
    manifestRef: releaseCommit.payload.manifest_ref,
    pointerEtag: releaseCommit.payload.pointer_etag,
    pointerGeneration: releaseCommit.payload.commit_generation,
    manifestEpoch: releaseCommit.payload.manifest_epoch,
    antiRollbackWitness: Object.freeze({
      sourceId: witness.sourceId,
      restoreEpoch: witness.restoreEpoch,
      generation: witness.generation,
      recordSha256: witness.recordSha256,
    }),
  });
  const currentState = await createFreshnessIssueCurrentStateBinding(verifiedState);
  return {
    evidence,
    currentState,
    witness: currentState.antiRollbackWitness,
  };
}

export function makeDifferentRequestBytes() {
  return canonicalJsonBytes({
    ...requestObject,
    request_nonce: nonceBytes.toString("base64url"),
  });
}

export async function makeRequestIdentity(operationId, raw = requestBytes) {
  const audienceManifestUrlSha256 = digest(
    new TextEncoder().encode(vector.manifest_url),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(raw, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  return {
    challenge,
    identity: {
      operationId,
      requestSha256: digest(raw),
      requestNonce: challenge.request_nonce,
      environment: challenge.environment,
      audienceManifestUrlSha256: challenge.audience_manifest_url_sha256,
    },
  };
}

export async function verifyFixtureResponse(raw, evidence) {
  const audienceManifestUrlSha256 = digest(
    new TextEncoder().encode(vector.manifest_url),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  const verified = await verifyRuntimeConfigFreshnessResponse({
    raw,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verified, evidence.manifestBytes);
  return verified;
}

export function makeCurrentStateReader(evidence) {
  return {
    async readCurrentState() {
      return copyEvidence(evidence);
    },
    async verifyCurrentState(observed) {
      assert.equal(observed.coordinatorHead.writerPending, false);
      assert.equal(
        observed.coordinatorHead.restoreEpoch,
        observed.antiRollbackWitness.restoreEpoch,
      );
      assert.ok(equalBytes(observed.pointer.bytes, observed.manifestBytes));
      return makeVerifiedStateFromEvidence(observed);
    },
  };
}

async function makeVerifiedStateFromEvidence(evidence) {
  const releaseCommit = await verifyRuntimeConfigReleaseCommitRecord({
    raw: evidence.journalHead.recordBytes,
    rootSigner,
    environment: "production",
    releaseDelegationRaw: evidence.journalHead.releaseDelegationBytes,
    appendedAt: evidence.journalHead.appendedAt,
  });
  assert.equal(evidence.coordinatorHead.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.coordinatorHead.recordSha256, releaseCommit.digest);
  assert.equal(evidence.antiRollbackWitness.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.antiRollbackWitness.recordSha256, releaseCommit.digest);
  assert.equal(evidence.pointer.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.pointer.etag, releaseCommit.payload.pointer_etag);
  assert.equal(evidence.immutableSnapshot.reference, releaseCommit.payload.manifest_ref);
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.immutableSnapshot.bytes));
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.manifestBytes));
  assert.equal(digest(evidence.pointer.bytes), releaseCommit.payload.manifest_sha256);
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
  });
  const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: challenge,
    nowMs: vector.now_ms,
  });
  await verifyFreshnessManifestBinding(verifiedResponse, evidence.manifestBytes);
  return Object.freeze({
    source: "verified-journal-do-r2-snapshot",
    freshnessSemantics: "LATEST_AT_ISSUANCE",
    environment: "production",
    journalHead: Object.freeze({
      generation: releaseCommit.payload.commit_generation,
      record_sha256: releaseCommit.digest,
      manifest_epoch: releaseCommit.payload.manifest_epoch,
    }),
    releaseCommitRecord: releaseCommit.envelope,
    verifiedReleaseCommitRecord: releaseCommit,
    releaseCommitRecordSha256: releaseCommit.digest,
    journalAppendedAt: evidence.journalHead.appendedAt,
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    manifestSha256: releaseCommit.payload.manifest_sha256,
    manifestRef: releaseCommit.payload.manifest_ref,
    pointerEtag: releaseCommit.payload.pointer_etag,
    pointerGeneration: releaseCommit.payload.commit_generation,
    manifestEpoch: releaseCommit.payload.manifest_epoch,
    antiRollbackWitness: Object.freeze({
      sourceId: evidence.antiRollbackWitness.sourceId,
      restoreEpoch: evidence.antiRollbackWitness.restoreEpoch,
      generation: evidence.antiRollbackWitness.generation,
      recordSha256: evidence.antiRollbackWitness.recordSha256,
    }),
  });
}

export function makeTestSigner({ onIssue } = {}) {
  return {
    mode: "test-only",
    purpose: "freshness-response-v1",
    calls: 0,
    lastRequest: undefined,
    async issueLatestAtIssuance(request, context) {
      this.calls += 1;
      this.lastRequest = request;
      if (onIssue) return onIssue(request, context);
      return this.completedResult(request);
    },
    async completedResult(request, bytes = responseBytes) {
      return {
        outcome: "COMPLETED",
        issueOperationId: request.issue.operationId,
        signerOperationId: request.issue.signerOperationId,
        requestSha256: request.issue.requestSha256,
        responseBytes: Uint8Array.from(bytes),
        responseSha256: digest(bytes),
        signedAtMs,
        clockId: request.lease.clockId,
        clockEpoch: request.lease.clockEpoch,
        clockUncertaintyMs: request.lease.clockUncertaintyMs,
      };
    },
  };
}

function copyEvidence(evidence) {
  return {
    ...evidence,
    journalHead: {
      ...evidence.journalHead,
      recordBytes: Uint8Array.from(evidence.journalHead.recordBytes),
      releaseDelegationBytes: Uint8Array.from(
        evidence.journalHead.releaseDelegationBytes,
      ),
      appendReceiptBytes: Uint8Array.from(
        evidence.journalHead.appendReceiptBytes,
      ),
    },
    coordinatorHead: { ...evidence.coordinatorHead },
    pointer: {
      ...evidence.pointer,
      bytes: Uint8Array.from(evidence.pointer.bytes),
    },
    immutableSnapshot: {
      ...evidence.immutableSnapshot,
      bytes: Uint8Array.from(evidence.immutableSnapshot.bytes),
    },
    manifestBytes: Uint8Array.from(evidence.manifestBytes),
    antiRollbackWitness: {
      ...evidence.antiRollbackWitness,
      signedBytes: Uint8Array.from(evidence.antiRollbackWitness.signedBytes),
    },
  };
}
