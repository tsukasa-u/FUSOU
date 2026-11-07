import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createFreshnessIssueCurrentStateBinding,
  issueRuntimeConfigFreshness,
  verifyFreshnessManifestBinding,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
} from "../src/index.ts";

const vector = JSON.parse(
  readFileSync(new URL("./fixtures/freshness-v1-golden.json", import.meta.url)),
);
const decode = (value) => Buffer.from(value, "base64url");
const requestBytes = decode(vector.request_raw_base64url);
const responseBytes = decode(vector.response_raw_base64url);
const releaseRecordBytes = decode(
  vector.release_commit_record_raw_base64url,
);
const releaseDelegationBytes = decode(
  vector.release_delegation_raw_base64url,
);
const manifestBytes = decode(vector.manifest_raw_base64url);
const requestObject = JSON.parse(requestBytes.toString("utf8"));
const rootSigner = Object.freeze({ ...vector.root_signer });
const operationId = "00000000-0000-4000-8000-000000000901";
const signerOperationId = "00000000-0000-4000-8000-000000000902";
const leaseId = "00000000-0000-4000-8000-000000000903";
const clockId = "local-fake-clock";
const clockEpoch = "test-restore-epoch-1";
const responsePayload = JSON.parse(
  Buffer.from(
    JSON.parse(responseBytes.toString("utf8")).payload_base64url,
    "base64url",
  ).toString("utf8"),
);
const signedAtMs = Date.parse(responsePayload.issued_at);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function equalBytes(left, right) {
  return Buffer.from(left).equals(Buffer.from(right));
}

function witnessBytes(witness) {
  return Buffer.from(
    [
      witness.sourceId,
      witness.restoreEpoch,
      witness.generation,
      witness.recordSha256,
    ].join("|"),
  );
}

function makeEvidence(overrides = {}) {
  const witness = {
    sourceId: "test-only-independent-witness",
    restoreEpoch: clockEpoch,
    generation: vector.pending_attempt.commit_generation,
    recordSha256: "kmLmvYzHc26xRhdRLGOeibGXKQp0YYond7MgU0hGcTY",
    signedBytes: new Uint8Array(),
  };
  witness.signedBytes = witnessBytes(witness);
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
  return {
    ...evidence,
    ...overrides,
  };
}

async function verifyEvidence(evidence) {
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
  assert.equal(
    evidence.coordinatorHead.recordSha256,
    releaseCommit.digest,
  );
  assert.equal(
    evidence.coordinatorHead.manifestEpoch,
    releaseCommit.payload.manifest_epoch,
  );
  assert.equal(
    evidence.coordinatorHead.restoreEpoch,
    evidence.antiRollbackWitness.restoreEpoch,
  );
  assert.equal(
    evidence.antiRollbackWitness.generation,
    releaseCommit.payload.commit_generation,
  );
  assert.equal(
    evidence.antiRollbackWitness.recordSha256,
    releaseCommit.digest,
  );
  assert.deepEqual(
    Buffer.from(evidence.antiRollbackWitness.signedBytes),
    witnessBytes(evidence.antiRollbackWitness),
  );
  assert.ok(evidence.journalHead.appendReceiptBytes.byteLength > 0);
  assert.ok(evidence.antiRollbackWitness.signedBytes.byteLength > 0);
  assert.equal(evidence.pointer.environment, "production");
  assert.equal(evidence.pointer.generation, releaseCommit.payload.commit_generation);
  assert.equal(evidence.pointer.etag, releaseCommit.payload.pointer_etag);
  assert.equal(evidence.immutableSnapshot.reference, releaseCommit.payload.manifest_ref);
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.immutableSnapshot.bytes));
  assert.ok(equalBytes(evidence.pointer.bytes, evidence.manifestBytes));
  assert.equal(digest(evidence.pointer.bytes), releaseCommit.payload.manifest_sha256);

  const request = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
  });
  const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request,
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

const initialEvidence = makeEvidence();
const verifiedState = await verifyEvidence(initialEvidence);
const currentStateBinding =
  await createFreshnessIssueCurrentStateBinding(verifiedState);

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

class FixtureCurrentStateReader {
  constructor(evidence = initialEvidence) {
    this.evidence = evidence;
    this.readCount = 0;
  }

  async readCurrentState() {
    this.readCount += 1;
    return copyEvidence(this.evidence);
  }

  async verifyCurrentState(evidence) {
    return verifyEvidence(evidence);
  }
}

class MemoryIssueCoordinatorForTest {
  constructor({ nowMs = vector.now_ms, stateBinding = currentStateBinding } = {}) {
    this.nowMs = nowMs;
    this.stateBinding = stateBinding;
    this.operations = new Map();
    this.beginCalls = 0;
    this.finalizeCalls = 0;
    this.finalizeMode = "normal";
    this.fenced = false;
  }

  clockReading() {
    return {
      clockId,
      clockEpoch,
      nowMs: this.nowMs,
      uncertaintyMs: 0,
    };
  }

  async readClock() {
    return this.clockReading();
  }

  async beginOrGet(input) {
    this.beginCalls += 1;
    const existing = this.operations.get(input.operationId);
    if (existing) {
      if (existing.operation.requestSha256 !== input.requestSha256) {
        return { status: "CONFLICT" };
      }
      return this.lookup(existing);
    }

    assert.equal(input.maxLeaseMs, 8_000);
    const operation = Object.freeze({
      operationId: input.operationId,
      signerOperationId,
      requestSha256: input.requestSha256,
      requestNonce: input.requestNonce,
      environment: input.environment,
      audienceManifestUrlSha256: input.audienceManifestUrlSha256,
    });
    const lease = Object.freeze({
      operation,
      leaseId,
      fencingToken: "7",
      acquiredAtMs: this.nowMs,
      expiresAtMs: this.nowMs + input.maxLeaseMs,
      clockId,
      clockEpoch,
      clockUncertaintyMs: 0,
      currentState: this.stateBinding,
    });
    const record = {
      operation,
      lease,
      status: "IN_PROGRESS",
      blocker: "RETAINED",
      signerCalls: 0,
      responseBytes: undefined,
      responseSha256: undefined,
    };
    this.operations.set(input.operationId, record);
    return { status: "ACQUIRED", operation, lease, blocker: "RETAINED" };
  }

  lookup(record) {
    if (record.status === "FINALIZED") {
      return {
        status: "FINALIZED",
        operation: record.operation,
        responseBytes: Uint8Array.from(record.responseBytes),
        responseSha256: record.responseSha256,
        blocker: "CLEARED",
      };
    }
    if (record.status === "IN_PROGRESS") {
      return {
        status: "IN_PROGRESS",
        operation: record.operation,
        blocker: "RETAINED",
      };
    }
    if (record.status === "RESULT_UNKNOWN") {
      return {
        status: "RESULT_UNKNOWN",
        operation: record.operation,
        blocker: "RETAINED",
      };
    }
    return {
      status: "REJECTED",
      operation: record.operation,
      reason: record.reason,
      blocker: "CLEARED",
    };
  }

  async getOperation(input) {
    const existing = this.operations.get(input.operationId);
    if (!existing) return { status: "NOT_FOUND" };
    if (existing.operation.requestSha256 !== input.requestSha256) {
      return { status: "CONFLICT" };
    }
    return this.lookup(existing);
  }

  restartFromSnapshot() {
    const restarted = new MemoryIssueCoordinatorForTest({
      nowMs: this.nowMs,
      stateBinding: this.stateBinding,
    });
    restarted.fenced = this.fenced;
    for (const [id, record] of this.operations) {
      restarted.operations.set(id, {
        ...record,
        operation: { ...record.operation },
        lease: {
          ...record.lease,
          operation: { ...record.lease.operation },
        },
        responseBytes:
          record.responseBytes === undefined
            ? undefined
            : Uint8Array.from(record.responseBytes),
      });
    }
    return restarted;
  }

  async checkLease(lease) {
    const record = this.operations.get(lease.operation.operationId);
    const active =
      record?.status === "IN_PROGRESS" &&
      record.lease.leaseId === lease.leaseId &&
      record.lease.fencingToken === lease.fencingToken &&
      !this.fenced &&
      this.nowMs < lease.expiresAtMs;
    return {
      status: active
        ? "ACTIVE"
        : this.fenced
          ? "FENCED"
          : this.nowMs >= lease.expiresAtMs
            ? "EXPIRED"
            : "UNKNOWN",
      operation: lease.operation,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      reading: this.clockReading(),
    };
  }

  receipt(record, status, blocker) {
    record.status = status;
    record.blocker = blocker;
    if (status === "REJECTED") record.reason = "SIGNER_RESPONSE_INVALID";
    return {
      status,
      operation: record.operation,
      leaseId: record.lease.leaseId,
      fencingToken: record.lease.fencingToken,
      blocker,
    };
  }

  async rejectBeforeSigner({ operation }) {
    return this.receipt(
      this.operations.get(operation.operationId),
      "REJECTED",
      "CLEARED",
    );
  }

  async rejectCompletedSigner({ operation, signerOperationId }) {
    assert.equal(signerOperationId, operation.signerOperationId);
    return this.receipt(
      this.operations.get(operation.operationId),
      "REJECTED",
      "CLEARED",
    );
  }

  async markResultUnknown({ operation }) {
    return this.receipt(
      this.operations.get(operation.operationId),
      "RESULT_UNKNOWN",
      "RETAINED",
    );
  }

  advanceCurrentState() {
    this.stateBinding = Object.freeze({
      ...this.stateBinding,
      stateSha256: `${this.stateBinding.stateSha256.slice(0, -1)}A`,
    });
  }

  async finalizeIfCurrent(input) {
    this.finalizeCalls += 1;
    const record = this.operations.get(input.operation.operationId);
    assert.ok(record);
    if (this.finalizeMode === "unknown") {
      record.status = "RESULT_UNKNOWN";
      record.blocker = "RETAINED";
      return {
        status: "RESULT_UNKNOWN",
        operation: record.operation,
        leaseId: record.lease.leaseId,
        fencingToken: record.lease.fencingToken,
        blocker: "RETAINED",
      };
    }
    if (this.nowMs >= input.lease.expiresAtMs) {
      return {
        status: "REJECTED",
        operation: record.operation,
        leaseId: record.lease.leaseId,
        fencingToken: record.lease.fencingToken,
        reason: "LEASE_NOT_ACTIVE",
        blocker: "CLEARED",
      };
    }
    if (
      this.stateBinding.stateSha256 !== input.currentState.stateSha256 ||
      record.status !== "IN_PROGRESS" ||
      record.lease.fencingToken !== input.lease.fencingToken
    ) {
      record.status = "REJECTED";
      record.blocker = "CLEARED";
      record.reason = "CURRENT_STATE_MISMATCH";
      return {
        status: "REJECTED",
        operation: record.operation,
        leaseId: record.lease.leaseId,
        fencingToken: record.lease.fencingToken,
        reason: "CURRENT_STATE_MISMATCH",
        blocker: "CLEARED",
      };
    }
    record.status = "FINALIZED";
    record.blocker = "CLEARED";
    record.responseBytes = Uint8Array.from(input.responseBytes);
    record.responseSha256 = input.responseSha256;
    if (this.finalizeMode === "throw-after-commit") {
      this.finalizeMode = "normal";
      throw new Error("test-only response lost after durable finalization");
    }
    return {
      status: "FINALIZED",
      operation: record.operation,
      leaseId: record.lease.leaseId,
      fencingToken: record.lease.fencingToken,
      finalizedAt: this.clockReading(),
      responseBytes: Uint8Array.from(record.responseBytes),
      responseSha256: record.responseSha256,
      blocker: "CLEARED",
    };
  }

  get blockerCount() {
    return [...this.operations.values()].filter(
      ({ blocker }) => blocker === "RETAINED",
    ).length;
  }
}

class FixtureSigner {
  constructor() {
    this.calls = 0;
    this.onIssue = undefined;
    this.lastRequest = undefined;
    this.lastContext = undefined;
    this.mode = "test-only";
    this.purpose = "freshness-response-v1";
  }

  async issueLatestAtIssuance(request, context) {
    this.calls += 1;
    this.lastRequest = request;
    this.lastContext = context;
    if (this.onIssue) return this.onIssue(request, context);
    return this.completedResult(request);
  }

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
  }
}

async function makeHarness(options = {}) {
  const coordinator = new MemoryIssueCoordinatorForTest(options);
  const currentState = new FixtureCurrentStateReader(
    options.evidence ?? initialEvidence,
  );
  const signer = new FixtureSigner();
  const dependencies = {
    manifestUrl: vector.manifest_url,
    bootstrapSigner: rootSigner,
    coordinator,
    currentState,
    signer,
  };
  const input = {
    operationId: options.operationId ?? operationId,
    requestBytes: options.requestBytes ?? requestBytes,
  };
  return { coordinator, currentState, signer, dependencies, input };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function restartHarness(harness) {
  const coordinator = harness.coordinator.restartFromSnapshot();
  harness.coordinator = coordinator;
  harness.dependencies.coordinator = coordinator;
  return coordinator;
}

test("issue returns only finalized exact bytes verified by the shared Freshness verifier", async () => {
  const harness = await makeHarness();
  const result = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(result.status, "ISSUED");
  assert.ok(equalBytes(result.responseBytes, responseBytes));
  assert.equal(result.responseSha256, digest(responseBytes));
  assert.equal(harness.currentState.readCount, 2);
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 0);
  assert.equal(harness.coordinator.finalizeCalls, 1);
  assert.equal(harness.signer.lastRequest.currentState.stateSha256, currentStateBinding.stateSha256);
  assert.equal("verifiedCurrentState" in harness.signer.lastRequest, false);
  await verifyRuntimeConfigFreshnessResponse({
    raw: result.responseBytes,
    bootstrapSigner: rootSigner,
    manifestUrl: vector.manifest_url,
    request: await verifyRuntimeConfigFreshnessRequest(requestBytes, {
      environment: "production",
      audienceManifestUrlSha256: requestObject.audience_manifest_url_sha256,
    }),
    nowMs: vector.now_ms,
  });
});

test("same operation retrieves its exact finalized result after restart without re-signing", async () => {
  const harness = await makeHarness();
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  restartHarness(harness);
  const replay = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "ISSUED");
  assert.equal(replay.status, "ALREADY_FINALIZED");
  assert.ok(equalBytes(replay.responseBytes, first.responseBytes));
  assert.equal(replay.responseSha256, first.responseSha256);
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.beginCalls, 1);
});

test("concurrent calls for one operation do not start a second signature", async () => {
  const harness = await makeHarness();
  const pending = deferred();
  let markStarted;
  const signerStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  harness.signer.onIssue = (request) => {
    markStarted();
    return pending.promise;
  };
  const firstCall = issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  await signerStarted;
  const concurrentCall = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(concurrentCall.status, "IN_PROGRESS");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 1);
  pending.resolve(
    await harness.signer.completedResult(harness.signer.lastRequest),
  );
  const firstResult = await firstCall;
  assert.equal(firstResult.status, "ISSUED");
  assert.equal(harness.signer.calls, 1);
});

test("same operation with a different canonical challenge is rejected without signing", async () => {
  const harness = await makeHarness();
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  const changedRequest = {
    ...requestObject,
    request_nonce: Buffer.alloc(32, 0xa5).toString("base64url"),
  };
  const changedBytes = Buffer.from(
    JSON.stringify(Object.fromEntries(Object.entries(changedRequest).sort())),
  );
  const conflict = await issueRuntimeConfigFreshness(
    { ...harness.input, requestBytes: changedBytes },
    harness.dependencies,
  );
  assert.equal(first.status, "ISSUED");
  assert.equal(conflict.status, "CONFLICT");
  assert.equal(harness.signer.calls, 1);
});

test("environment and audience mismatch reject before durable operation admission", async () => {
  const harness = await makeHarness();
  for (const changed of [
    { ...requestObject, environment: "staging" },
    {
      ...requestObject,
      audience_manifest_url_sha256: Buffer.alloc(32, 0x37).toString("base64url"),
    },
  ]) {
    const raw = Buffer.from(
      JSON.stringify(Object.fromEntries(Object.entries(changed).sort())),
    );
    await assert.rejects(() =>
      issueRuntimeConfigFreshness(
        { ...harness.input, requestBytes: raw },
        harness.dependencies,
      ),
    );
  }
  assert.equal(harness.coordinator.beginCalls, 0);
  assert.equal(harness.signer.calls, 0);
});

test("a valid but different nonce cannot return a response signed for the old challenge", async () => {
  const changedRequest = {
    ...requestObject,
    request_nonce: Buffer.alloc(32, 0x52).toString("base64url"),
  };
  const changedBytes = Buffer.from(
    JSON.stringify(Object.fromEntries(Object.entries(changedRequest).sort())),
  );
  const harness = await makeHarness({ requestBytes: changedBytes });
  const result = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "SIGNER_RESPONSE_INVALID");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.finalizeCalls, 0);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("a signer result bound to another operation remains unknown and blocked", async () => {
  const harness = await makeHarness();
  harness.signer.onIssue = async (request) => ({
    ...(await harness.signer.completedResult(request)),
    signerOperationId: "00000000-0000-4000-8000-000000000904",
  });
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  const repeated = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "RESULT_UNKNOWN");
  assert.equal(repeated.status, "RESULT_UNKNOWN");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 1);
});

test("signer timestamp disagreement rejects the completed response", async () => {
  const harness = await makeHarness();
  harness.signer.onIssue = async (request) => ({
    ...(await harness.signer.completedResult(request)),
    signedAtMs: signedAtMs + 1,
  });
  const result = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "SIGNER_RESPONSE_INVALID");
  assert.equal(harness.coordinator.finalizeCalls, 0);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("lease, operation, and request-digest mismatches fail before signing", async () => {
  const badOperationHarness = await makeHarness();
  badOperationHarness.coordinator.beginOrGet = async function (input) {
    const result = await MemoryIssueCoordinatorForTest.prototype.beginOrGet.call(
      this,
      input,
    );
    return {
      ...result,
      operation: { ...result.operation, requestSha256: "different-digest" },
      lease: {
        ...result.lease,
        operation: {
          ...result.lease.operation,
          requestSha256: "different-digest",
        },
      },
    };
  };
  await assert.rejects(() =>
    issueRuntimeConfigFreshness(
      badOperationHarness.input,
      badOperationHarness.dependencies,
    ),
  );
  assert.equal(badOperationHarness.signer.calls, 0);

  const badLeaseHarness = await makeHarness();
  badLeaseHarness.coordinator.fenced = true;
  const fenced = await issueRuntimeConfigFreshness(
    badLeaseHarness.input,
    badLeaseHarness.dependencies,
  );
  assert.equal(fenced.status, "REJECTED");
  assert.equal(badLeaseHarness.signer.calls, 0);
  assert.equal(badLeaseHarness.coordinator.blockerCount, 0);

  const badGenerationHarness = await makeHarness();
  const originalBegin = badGenerationHarness.coordinator.beginOrGet.bind(
    badGenerationHarness.coordinator,
  );
  badGenerationHarness.coordinator.beginOrGet = async (input) => {
    const result = await originalBegin(input);
    return {
      ...result,
      lease: {
        ...result.lease,
        currentState: {
          ...result.lease.currentState,
          generation: "999",
        },
      },
    };
  };
  await assert.rejects(() =>
    issueRuntimeConfigFreshness(
      badGenerationHarness.input,
      badGenerationHarness.dependencies,
    ),
  );
  assert.equal(badGenerationHarness.signer.calls, 0);
});

test("lease expiry during signing discards the signature and expiry alone retains the blocker", async () => {
  const harness = await makeHarness();
  const pending = deferred();
  let started;
  const signerStarted = new Promise((resolve) => {
    started = resolve;
  });
  harness.signer.onIssue = async (request) => {
    started();
    return pending.promise;
  };
  const issue = issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  await signerStarted;
  harness.coordinator.nowMs += 8_001;
  assert.equal(harness.coordinator.blockerCount, 1);
  pending.resolve(await harness.signer.completedResult(harness.signer.lastRequest));
  const result = await issue;
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "LEASE_NOT_ACTIVE");
  assert.equal(harness.coordinator.finalizeCalls, 0);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("release-generation change during signing prevents finalization and return", async () => {
  const harness = await makeHarness();
  harness.signer.onIssue = async (request) => {
    harness.coordinator.advanceCurrentState();
    return harness.signer.completedResult(request);
  };
  const result = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "CURRENT_STATE_MISMATCH");
  assert.equal(harness.coordinator.finalizeCalls, 1);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("unknown signer outcome remains blocked across a repeated call", async () => {
  const harness = await makeHarness();
  harness.signer.onIssue = async (request) => ({
    outcome: "UNKNOWN",
    issueOperationId: request.issue.operationId,
    signerOperationId: request.issue.signerOperationId,
    requestSha256: request.issue.requestSha256,
  });
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  restartHarness(harness);
  const afterRestart = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "RESULT_UNKNOWN");
  assert.equal(afterRestart.status, "RESULT_UNKNOWN");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 1);
});

test("signer rejection is an unknown external result and never triggers automatic re-signing", async () => {
  const harness = await makeHarness();
  harness.signer.onIssue = async () => {
    throw new Error("test-only lost signer response");
  };
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  restartHarness(harness);
  const retry = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "RESULT_UNKNOWN");
  assert.equal(retry.status, "RESULT_UNKNOWN");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 1);
});

test("a lost finalization response resolves the persisted exact bytes without signing again", async () => {
  const harness = await makeHarness();
  harness.coordinator.finalizeMode = "throw-after-commit";
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "ALREADY_FINALIZED");
  assert.ok(equalBytes(first.responseBytes, responseBytes));
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("unknown finalization persistence returns no bytes and preserves its blocker after restart", async () => {
  const harness = await makeHarness();
  harness.coordinator.finalizeMode = "unknown";
  const first = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  restartHarness(harness);
  const restarted = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(first.status, "RESULT_UNKNOWN");
  assert.equal(restarted.status, "RESULT_UNKNOWN");
  assert.equal(harness.signer.calls, 1);
  assert.equal(harness.coordinator.blockerCount, 1);
  assert.equal(harness.coordinator.operations.get(operationId).responseBytes, undefined);
});

test("caller abort does not release an unresolved issue blocker", async () => {
  const harness = await makeHarness();
  const controller = new AbortController();
  const pending = deferred();
  let markStarted;
  const signerStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  harness.signer.onIssue = (request, context) => {
    assert.equal(context.signal, controller.signal);
    markStarted();
    return pending.promise;
  };
  const issue = issueRuntimeConfigFreshness(
    { ...harness.input, signal: controller.signal },
    harness.dependencies,
  );
  await signerStarted;
  controller.abort();
  assert.equal(harness.coordinator.blockerCount, 1);
  assert.equal(
    harness.coordinator.operations.get(operationId).status,
    "IN_PROGRESS",
  );
  pending.resolve(await harness.signer.completedResult(harness.signer.lastRequest));
  const result = await issue;
  assert.equal(result.status, "ISSUED");
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("local rollback behind an independent witness is rejected before signing", async () => {
  const evidence = makeEvidence({
    coordinatorHead: {
      environment: "production",
      generation: vector.previous_head.generation,
      recordSha256: vector.previous_head.record_sha256,
      manifestEpoch: vector.previous_head.manifest_epoch,
      writerPending: false,
      restoreEpoch: "test-restore-epoch-0",
    },
  });
  const harness = await makeHarness({ evidence });
  const result = await issueRuntimeConfigFreshness(
    harness.input,
    harness.dependencies,
  );
  assert.equal(result.status, "REJECTED");
  assert.equal(result.reason, "CURRENT_STATE_UNAVAILABLE");
  assert.equal(harness.signer.calls, 0);
  assert.equal(harness.coordinator.blockerCount, 0);
});

test("a verified-state declaration alone cannot replace missing verification and persistence adapters", async () => {
  await assert.rejects(
    () =>
      issueRuntimeConfigFreshness(
        {
          ...{
            operationId,
            requestBytes,
          },
          verifiedCurrentState: verifiedState,
        },
        undefined,
      ),
    (error) => error.code === "MISSING_ADAPTER",
  );
});
