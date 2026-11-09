import {
  canonicalJsonBytes,
  encodeBase64Url,
  parseCanonicalUnsignedDecimal,
  runtimeConfigFreshnessWire,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
} from "./domain.ts";
import type {
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueCoordinatorSnapshot,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
  FreshnessResponseSignerRequest,
  FreshnessResponseSignerResponse,
  FreshnessCurrentStateEvidence,
  FreshnessAntiRollbackWitnessBinding,
  ProductionFreshnessResponseSigner,
  TestOnlyFreshnessResponseSigner,
  VerifiedCurrentFreshnessState,
  VerifiedFreshnessReleaseState,
} from "./signers.ts";
import type {
  FreshnessRequest,
  RuntimeConfigRootSigner,
  VerifiedFreshnessResponse,
} from "./domain.ts";

export const MAX_FRESHNESS_ISSUE_LEASE_MS = 8_000;

export type FreshnessIssueRejectionReason =
  | "LEASE_NOT_ACTIVE"
  | "CURRENT_STATE_UNAVAILABLE"
  | "CURRENT_STATE_MISMATCH"
  | "SIGNER_RESPONSE_INVALID"
  | "FINALIZATION_REJECTED";

export interface FreshnessIssueRequestIdentity {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly requestNonce: string;
  readonly environment: "production";
  readonly audienceManifestUrlSha256: string;
}

export interface FreshnessIssueClockReading {
  readonly clockId: string;
  readonly clockEpoch: string;
  readonly nowMs: number;
  readonly uncertaintyMs: number;
}

export interface FreshnessIssueBeginInput
  extends FreshnessIssueRequestIdentity {
  readonly maxLeaseMs: typeof MAX_FRESHNESS_ISSUE_LEASE_MS;
}

export type FreshnessIssueBeginResult =
  | {
      readonly status: "ACQUIRED";
      readonly operation: FreshnessIssueOperationBinding;
      readonly lease: FreshnessIssueLeaseBinding;
      readonly blocker: "RETAINED";
    }
  | {
      readonly status: "FINALIZED";
      readonly operation: FreshnessIssueOperationBinding;
      readonly responseBytes: Uint8Array;
      readonly responseSha256: string;
      readonly blocker: "CLEARED";
    }
  | {
      readonly status: "IN_PROGRESS";
      readonly operation: FreshnessIssueOperationBinding;
      readonly blocker: "RETAINED";
    }
  | {
      readonly status: "RESULT_UNKNOWN";
      readonly operation: FreshnessIssueOperationBinding;
      readonly blocker: "RETAINED";
    }
  | {
      readonly status: "REJECTED";
      readonly operation: FreshnessIssueOperationBinding;
      readonly reason: FreshnessIssueRejectionReason;
      readonly blocker: "CLEARED";
    }
  | {
      readonly status: "CONFLICT";
    };

export type FreshnessIssueLookupResult =
  | Exclude<FreshnessIssueBeginResult, { readonly status: "ACQUIRED" }>
  | { readonly status: "NOT_FOUND" };

export interface FreshnessIssueLeaseCheck {
  readonly status: "ACTIVE" | "EXPIRED" | "FENCED" | "UNKNOWN";
  readonly operation: FreshnessIssueOperationBinding;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly reading: FreshnessIssueClockReading;
}

export interface FreshnessIssueMutationReceipt {
  readonly status: "REJECTED" | "RESULT_UNKNOWN";
  readonly operation: FreshnessIssueOperationBinding;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly blocker: "CLEARED" | "RETAINED";
}

export type FreshnessIssueFinalizationResult =
  | {
      readonly status: "FINALIZED";
      readonly operation: FreshnessIssueOperationBinding;
      readonly leaseId: string;
      readonly fencingToken: string;
      readonly finalizedAt: FreshnessIssueClockReading;
      readonly responseBytes: Uint8Array;
      readonly responseSha256: string;
      readonly blocker: "CLEARED";
    }
  | {
      readonly status: "REJECTED";
      readonly operation: FreshnessIssueOperationBinding;
      readonly leaseId: string;
      readonly fencingToken: string;
      readonly reason: FreshnessIssueRejectionReason;
      readonly blocker: "CLEARED";
    }
  | {
      readonly status: "RESULT_UNKNOWN";
      readonly operation: FreshnessIssueOperationBinding;
      readonly leaseId: string;
      readonly fencingToken: string;
      readonly blocker: "RETAINED";
    };

export interface FreshnessIssueCoordinator {
  beginOrGet(
    input: FreshnessIssueBeginInput,
  ): Promise<FreshnessIssueBeginResult>;
  getOperation(
    input: FreshnessIssueRequestIdentity,
  ): Promise<FreshnessIssueLookupResult>;
  readClock(): Promise<FreshnessIssueClockReading>;
  checkLease(
    lease: FreshnessIssueLeaseBinding,
  ): Promise<FreshnessIssueLeaseCheck>;
  rejectBeforeSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt>;
  rejectCompletedSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
    readonly resultSha256: string | null;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt>;
  markResultUnknown(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
  }): Promise<FreshnessIssueMutationReceipt>;
  finalizeIfCurrent(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly responseBytes: Uint8Array;
    readonly responseSha256: string;
    readonly signedAtMs: number;
    readonly currentState: FreshnessIssueCurrentStateBinding;
  }): Promise<FreshnessIssueFinalizationResult>;
}

export interface FreshnessIssueCoordinatorSnapshotReader {
  readCurrentStateSnapshot(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
  }): Promise<FreshnessIssueCoordinatorSnapshot>;
}

export interface FreshnessCurrentStateReadInput {
  readonly operation: FreshnessIssueOperationBinding;
  readonly challenge: FreshnessRequest;
  readonly lease: FreshnessIssueLeaseBinding;
  readonly clock: FreshnessIssueClockReading;
}

export interface FreshnessCurrentStateReader {
  readCurrentState(
    input: FreshnessCurrentStateReadInput,
  ): Promise<FreshnessCurrentStateEvidence>;
  verifyCurrentState(
    evidence: FreshnessCurrentStateEvidence,
    input: FreshnessCurrentStateReadInput,
  ): Promise<VerifiedCurrentFreshnessState>;
}

export type FreshnessIssueSigner =
  | ProductionFreshnessResponseSigner
  | TestOnlyFreshnessResponseSigner;

export interface FreshnessIssueDependencies {
  readonly manifestUrl: string;
  readonly bootstrapSigner: RuntimeConfigRootSigner;
  readonly coordinator: FreshnessIssueCoordinator;
  readonly currentState: FreshnessCurrentStateReader;
  readonly signer: FreshnessIssueSigner;
}

export interface FreshnessIssueInput {
  readonly operationId: string;
  readonly requestBytes: Uint8Array;
  readonly signal?: AbortSignal;
}

export type FreshnessIssueResult =
  | {
      readonly status: "ISSUED" | "ALREADY_FINALIZED";
      readonly operationId: string;
      readonly responseBytes: Uint8Array;
      readonly responseSha256: string;
    }
  | {
      readonly status: "IN_PROGRESS" | "RESULT_UNKNOWN";
      readonly operationId: string;
    }
  | {
      readonly status: "REJECTED";
      readonly operationId: string;
      readonly reason: FreshnessIssueRejectionReason;
    }
  | {
      readonly status: "CONFLICT";
      readonly operationId: string;
    };

export class FreshnessIssueCoreError extends Error {
  readonly code:
    | "INVALID_OPERATION_ID"
    | "MISSING_ADAPTER"
    | "INVALID_COORDINATION_BINDING"
    | "INVALID_LEASE"
    | "INVALID_STATE"
    | "INVALID_SIGNER_RESULT"
    | "FINALIZATION_OUTCOME_UNKNOWN";

  constructor(
    code: FreshnessIssueCoreError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FreshnessIssueCoreError";
    this.code = code;
  }
}

export async function issueRuntimeConfigFreshness(
  input: FreshnessIssueInput,
  dependencies: FreshnessIssueDependencies,
): Promise<FreshnessIssueResult> {
  assertDependencies(dependencies);
  assertOperationId(input.operationId);
  if (!(input.requestBytes instanceof Uint8Array)) {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Freshness challenge bytes are required",
    );
  }

  const requestBytes = input.requestBytes.slice();
  const audienceManifestUrlSha256 = await sha256Base64Url(
    new TextEncoder().encode(dependencies.manifestUrl),
  );
  const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
    environment: "production",
    audienceManifestUrlSha256,
  });
  const requestSha256 = await sha256Base64Url(requestBytes);
  const requestIdentity: FreshnessIssueRequestIdentity = Object.freeze({
    operationId: input.operationId,
    requestSha256,
    requestNonce: challenge.request_nonce,
    environment: challenge.environment,
    audienceManifestUrlSha256: challenge.audience_manifest_url_sha256,
  });

  const begin = await dependencies.coordinator.beginOrGet({
    ...requestIdentity,
    maxLeaseMs: MAX_FRESHNESS_ISSUE_LEASE_MS,
  });
  if (begin.status !== "ACQUIRED") {
    return resolveExistingOperation(
      begin,
      requestIdentity,
      challenge,
      dependencies,
    );
  }

  if (begin.blocker !== "RETAINED") {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "New issue operation did not retain its coordination blocker",
    );
  }
  assertOperationMatches(begin.operation, requestIdentity);
  await assertLeaseMatches(begin.lease, begin.operation, requestIdentity);
  const lease = begin.lease;

  let beforeSigning: Awaited<ReturnType<typeof checkLease>>;
  try {
    beforeSigning = await checkLease(dependencies.coordinator, lease);
  } catch {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "LEASE_NOT_ACTIVE",
    );
  }
  if (!beforeSigning.active) {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "LEASE_NOT_ACTIVE",
    );
  }

  let initialState: VerifiedCurrentFreshnessState;
  try {
    initialState = await readAndVerifyCurrentState(
      dependencies.currentState,
      begin.operation,
      challenge,
      lease,
      beforeSigning.reading,
    );
  } catch {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "CURRENT_STATE_UNAVAILABLE",
    );
  }

  let initialBinding: FreshnessIssueCurrentStateBinding;
  try {
    initialBinding = await createFreshnessIssueCurrentStateBinding(initialState);
  } catch {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "CURRENT_STATE_MISMATCH",
    );
  }
  if (!sameCurrentStateBinding(initialBinding, lease.currentState)) {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "CURRENT_STATE_MISMATCH",
    );
  }

  let immediatelyBeforeSigner: Awaited<ReturnType<typeof checkLease>>;
  try {
    immediatelyBeforeSigner = await checkLease(
      dependencies.coordinator,
      lease,
    );
  } catch {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "LEASE_NOT_ACTIVE",
    );
  }
  if (!immediatelyBeforeSigner.active) {
    return rejectBeforeSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      "LEASE_NOT_ACTIVE",
    );
  }

  const signerRequest: FreshnessResponseSignerRequest = Object.freeze({
    operation: "ISSUE_LATEST_AT_ISSUANCE",
    issue: begin.operation,
    challenge,
    lease,
    currentState: initialBinding,
  });

  let signerResult: FreshnessResponseSignerResponse;
  try {
    signerResult = await dependencies.signer.issueLatestAtIssuance(
      signerRequest,
      input.signal === undefined ? undefined : { signal: input.signal },
    );
  } catch {
    return markResultUnknown(
      dependencies.coordinator,
      begin.operation,
      lease,
    );
  }

  if (signerResult.outcome === "UNKNOWN") {
    return markResultUnknown(
      dependencies.coordinator,
      begin.operation,
      lease,
    );
  }

  if (
    signerResult.issueOperationId !== begin.operation.operationId ||
    signerResult.signerOperationId !== begin.operation.signerOperationId ||
    signerResult.requestSha256 !== requestIdentity.requestSha256
  ) {
    return markResultUnknown(
      dependencies.coordinator,
      begin.operation,
      lease,
      begin.operation.signerOperationId,
    );
  }

  let afterSigning: Awaited<ReturnType<typeof checkLease>>;
  try {
    afterSigning = await checkLease(dependencies.coordinator, lease);
  } catch {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "LEASE_NOT_ACTIVE",
    );
  }
  if (!afterSigning.active) {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "LEASE_NOT_ACTIVE",
    );
  }

  let finalState: VerifiedCurrentFreshnessState;
  try {
    finalState = await readAndVerifyCurrentState(
      dependencies.currentState,
      begin.operation,
      challenge,
      lease,
      afterSigning.reading,
    );
  } catch {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "CURRENT_STATE_UNAVAILABLE",
    );
  }

  let finalBinding: FreshnessIssueCurrentStateBinding;
  try {
    finalBinding = await createFreshnessIssueCurrentStateBinding(finalState);
  } catch {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "CURRENT_STATE_MISMATCH",
    );
  }
  if (
    !sameCurrentStateBinding(initialBinding, finalBinding) ||
    !sameCurrentStateBinding(finalBinding, lease.currentState)
  ) {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "CURRENT_STATE_MISMATCH",
    );
  }

  let verifiedResponse: VerifiedFreshnessResponse;
  let responseSha256: string;
  try {
    responseSha256 = await sha256Base64Url(signerResult.responseBytes);
    if (
      signerResult.responseBytes.byteLength === 0 ||
      signerResult.responseBytes.byteLength >
        runtimeConfigFreshnessWire.maxResponseBytes ||
      signerResult.responseSha256 !== responseSha256
    ) {
      throw new FreshnessIssueCoreError(
        "INVALID_SIGNER_RESULT",
        "Signer response bytes or digest are invalid",
      );
    }
    assertSignerClockAndIssueTime(signerResult, lease, afterSigning.reading);
    verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
      raw: signerResult.responseBytes,
      bootstrapSigner: dependencies.bootstrapSigner,
      manifestUrl: dependencies.manifestUrl,
      request: challenge,
      nowMs: afterSigning.reading.nowMs + afterSigning.reading.uncertaintyMs,
    });
    if (signerResult.signedAtMs !== verifiedResponse.issuedAtMs) {
      throw new FreshnessIssueCoreError(
        "INVALID_SIGNER_RESULT",
        "Signer timestamp does not match the signed Freshness response",
      );
    }
    assertResponseMatchesCurrentState(verifiedResponse, finalBinding);
  } catch {
    return rejectCompletedSigner(
      dependencies.coordinator,
      begin.operation,
      lease,
      signerResult,
      "SIGNER_RESPONSE_INVALID",
    );
  }

  let finalized: FreshnessIssueFinalizationResult;
  try {
    finalized = await dependencies.coordinator.finalizeIfCurrent({
      operation: begin.operation,
      lease,
      responseBytes: signerResult.responseBytes.slice(),
      responseSha256,
      signedAtMs: verifiedResponse.issuedAtMs,
      currentState: finalBinding,
    });
  } catch {
    return resolveAfterFinalizationError(
      dependencies.coordinator,
      requestIdentity,
      challenge,
      dependencies,
      begin.operation,
      lease,
    );
  }

  return resolveFinalization(
    finalized,
    begin.operation,
    lease,
    signerResult.responseBytes,
    responseSha256,
    verifiedResponse,
    signerResult.clockUncertaintyMs,
  );
}

function assertDependencies(
  dependencies: FreshnessIssueDependencies,
): void {
  if (
    dependencies === undefined ||
    typeof dependencies.manifestUrl !== "string" ||
    dependencies.manifestUrl.length === 0 ||
    dependencies.bootstrapSigner === undefined ||
    dependencies.coordinator === undefined ||
    dependencies.currentState === undefined ||
    dependencies.signer === undefined ||
    typeof dependencies.coordinator.beginOrGet !== "function" ||
    typeof dependencies.coordinator.getOperation !== "function" ||
    typeof dependencies.currentState.readCurrentState !== "function" ||
    typeof dependencies.currentState.verifyCurrentState !== "function" ||
    typeof dependencies.signer.issueLatestAtIssuance !== "function"
  ) {
    throw new FreshnessIssueCoreError(
      "MISSING_ADAPTER",
      "Freshness issuance requires explicit trust and persistence adapters",
    );
  }
}

function assertOperationId(value: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_OPERATION_ID",
      "Freshness operation ID must be a canonical lowercase UUIDv4",
    );
  }
}

async function checkLease(
  coordinator: FreshnessIssueCoordinator,
  lease: FreshnessIssueLeaseBinding,
): Promise<{ readonly active: boolean; readonly reading: FreshnessIssueClockReading }> {
  const check = await coordinator.checkLease(lease);
  if (
    check.operation.operationId !== lease.operation.operationId ||
    check.operation.signerOperationId !== lease.operation.signerOperationId ||
    check.operation.requestSha256 !== lease.operation.requestSha256 ||
    check.leaseId !== lease.leaseId ||
    check.fencingToken !== lease.fencingToken
  ) {
    return { active: false, reading: check.reading };
  }
  const reading = check.reading;
  const readingMatchesLease =
    reading.clockId === lease.clockId &&
    reading.clockEpoch === lease.clockEpoch &&
    Number.isSafeInteger(reading.nowMs) &&
    Number.isSafeInteger(reading.uncertaintyMs) &&
    reading.uncertaintyMs >= 0 &&
    reading.uncertaintyMs <= lease.clockUncertaintyMs &&
    reading.nowMs - reading.uncertaintyMs >= lease.acquiredAtMs &&
    reading.nowMs + reading.uncertaintyMs < lease.expiresAtMs;
  return {
    active: check.status === "ACTIVE" && readingMatchesLease,
    reading,
  };
}

async function readAndVerifyCurrentState(
  reader: FreshnessCurrentStateReader,
  operation: FreshnessIssueOperationBinding,
  challenge: FreshnessRequest,
  lease: FreshnessIssueLeaseBinding,
  clock: FreshnessIssueClockReading,
): Promise<VerifiedCurrentFreshnessState> {
  const request = Object.freeze({
    operation,
    challenge,
    lease,
    clock,
  });
  const evidence = await reader.readCurrentState(request);
  const verified = await reader.verifyCurrentState(evidence, request);
  await assertCurrentStateEvidence(evidence, verified, lease);
  return verified;
}

async function assertCurrentStateEvidence(
  evidence: FreshnessCurrentStateEvidence,
  state: VerifiedCurrentFreshnessState,
  lease: FreshnessIssueLeaseBinding,
): Promise<void> {
  const coordinatorSnapshot = evidence.coordinatorSnapshot;
  const snapshotWitness = coordinatorSnapshot.witness;
  if (
    evidence.journalHead.appendReceiptBytes.byteLength === 0 ||
    evidence.journalHead.currentHeadProofBytes.byteLength === 0 ||
    evidence.antiRollbackWitness.signedBytes.byteLength === 0 ||
    evidence.coordinatorHead.writerPending ||
    coordinatorSnapshot.operationStatus !== "IN_PROGRESS" ||
    coordinatorSnapshot.blocker !== "RETAINED" ||
    coordinatorSnapshot.writerPending ||
    coordinatorSnapshot.environment !== "production" ||
    !sameOperationBinding(coordinatorSnapshot.operation, lease.operation) ||
    !sameLeaseBinding(coordinatorSnapshot.lease, lease) ||
    !sameCurrentStateBinding(coordinatorSnapshot.currentState, lease.currentState) ||
    !sameCurrentStateBinding(
      coordinatorSnapshot.lease.currentState,
      lease.currentState,
    ) ||
    snapshotWitness.sourceId !== evidence.antiRollbackWitness.sourceId ||
    snapshotWitness.restoreEpoch !== evidence.antiRollbackWitness.restoreEpoch ||
    snapshotWitness.generation !== evidence.antiRollbackWitness.generation ||
    snapshotWitness.recordSha256 !== evidence.antiRollbackWitness.recordSha256 ||
    coordinatorSnapshot.restoreEpoch !== snapshotWitness.restoreEpoch ||
    evidence.coordinatorHead.environment !== coordinatorSnapshot.environment ||
    evidence.coordinatorHead.generation !==
      coordinatorSnapshot.currentState.generation ||
    evidence.coordinatorHead.recordSha256 !==
      coordinatorSnapshot.currentState.journalHeadSha256 ||
    evidence.coordinatorHead.manifestEpoch !==
      coordinatorSnapshot.currentState.manifestEpoch ||
    evidence.coordinatorHead.restoreEpoch !==
      coordinatorSnapshot.restoreEpoch ||
    evidence.journalHead.appendedAt !== state.journalAppendedAt ||
    evidence.pointer.environment !== "production" ||
    evidence.coordinatorHead.environment !== "production" ||
    evidence.coordinatorHead.generation !== state.journalHead.generation ||
    evidence.coordinatorHead.recordSha256 !== state.journalHead.record_sha256 ||
    evidence.coordinatorHead.manifestEpoch !== state.journalHead.manifest_epoch ||
    evidence.coordinatorHead.restoreEpoch !==
      state.antiRollbackWitness.restoreEpoch ||
    evidence.antiRollbackWitness.sourceId !==
      state.antiRollbackWitness.sourceId ||
    evidence.antiRollbackWitness.restoreEpoch !==
      state.antiRollbackWitness.restoreEpoch ||
    evidence.antiRollbackWitness.generation !==
      state.antiRollbackWitness.generation ||
    evidence.antiRollbackWitness.recordSha256 !==
      state.antiRollbackWitness.recordSha256 ||
    evidence.pointer.etag !== state.pointerEtag ||
    evidence.pointer.generation !== state.pointerGeneration ||
    evidence.immutableSnapshot.reference !== state.manifestRef ||
    !bytesEqual(evidence.pointer.bytes, evidence.immutableSnapshot.bytes) ||
    !bytesEqual(evidence.pointer.bytes, evidence.manifestBytes) ||
    !bytesEqual(evidence.pointer.bytes, state.manifestBytes) ||
    !bytesEqual(
      evidence.journalHead.recordBytes,
      canonicalJsonBytes(state.verifiedReleaseCommitRecord.envelope),
    ) ||
    !bytesEqual(
      evidence.journalHead.releaseDelegationBytes,
      state.verifiedReleaseCommitRecord.delegation.raw,
    )
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Current-state evidence is incomplete or internally inconsistent",
    );
  }

  const binding = await createFreshnessIssueCurrentStateBinding(state);
  if (
    !sameCurrentStateBinding(binding, lease.currentState) ||
    !sameCurrentStateBinding(binding, coordinatorSnapshot.currentState)
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Verified current state does not match the issue lease binding",
    );
  }
}

export async function createFreshnessIssueCurrentStateBinding(
  state: VerifiedCurrentFreshnessState,
): Promise<FreshnessIssueCurrentStateBinding> {
  if (
    state.source !== "verified-journal-do-r2-snapshot" ||
    state.freshnessSemantics !== "LATEST_AT_ISSUANCE"
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Current-state issue binding requires issue-scoped verified evidence",
    );
  }
  return createCurrentStateBinding(state);
}

export async function createFreshnessIssueCurrentStateBindingFromReleaseState(
  state: VerifiedFreshnessReleaseState,
): Promise<FreshnessIssueCurrentStateBinding> {
  if (state.source !== "verified-release-journal-r2-witness") {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Release install binding requires independently verified Release evidence",
    );
  }
  return createCurrentStateBinding(state);
}

type FreshnessCurrentStateBindingClaims = Pick<
  VerifiedCurrentFreshnessState,
  | "environment"
  | "journalHead"
  | "verifiedReleaseCommitRecord"
  | "releaseCommitRecord"
  | "releaseCommitRecordSha256"
  | "journalAppendedAt"
  | "manifestBytes"
  | "manifestSha256"
  | "manifestRef"
  | "pointerEtag"
  | "pointerGeneration"
  | "manifestEpoch"
  | "antiRollbackWitness"
>;

async function createCurrentStateBinding(
  state: FreshnessCurrentStateBindingClaims,
): Promise<FreshnessIssueCurrentStateBinding> {
  const record = state.verifiedReleaseCommitRecord;
  const recordBytes = canonicalJsonBytes(record.envelope);
  const recordDigest = await sha256Base64Url(recordBytes);
  const manifestDigest = await sha256Base64Url(state.manifestBytes);
  const payload = record.payload;
  const appendedAtMs = Date.parse(state.journalAppendedAt);
  const witness: FreshnessAntiRollbackWitnessBinding = Object.freeze({
    sourceId: state.antiRollbackWitness.sourceId,
    restoreEpoch: state.antiRollbackWitness.restoreEpoch,
    generation: state.antiRollbackWitness.generation,
    recordSha256: state.antiRollbackWitness.recordSha256,
  });
  const core = {
    environment: "production" as const,
    generation: state.journalHead.generation,
    journalHeadSha256: state.journalHead.record_sha256,
    releaseCommitId: payload.release_commit_id,
    releaseCommitRecordSha256: record.digest,
    journalAppendedAt: state.journalAppendedAt,
    manifestEpoch: state.manifestEpoch,
    manifestSha256: state.manifestSha256,
    manifestRef: state.manifestRef,
    pointerEtag: state.pointerEtag,
    pointerGeneration: state.pointerGeneration,
    antiRollbackWitness: witness,
  };
  if (
    state.environment !== "production" ||
    record.digest !== recordDigest ||
    record.digest !== state.releaseCommitRecordSha256 ||
    !bytesEqual(
      canonicalJsonBytes(state.releaseCommitRecord),
      canonicalJsonBytes(record.envelope),
    ) ||
    payload.environment !== "production" ||
    payload.commit_generation !== state.journalHead.generation ||
    payload.commit_generation !== state.pointerGeneration ||
    payload.manifest_epoch !== state.manifestEpoch ||
    payload.manifest_epoch !== state.journalHead.manifest_epoch ||
    payload.manifest_sha256 !== state.manifestSha256 ||
    payload.manifest_ref !== state.manifestRef ||
    payload.pointer_etag !== state.pointerEtag ||
    state.journalHead.record_sha256 !== record.digest ||
    manifestDigest !== state.manifestSha256 ||
    state.manifestRef !==
      `tlsn/runtime-config/v2/manifests/${state.manifestSha256}` ||
    !Number.isSafeInteger(appendedAtMs) ||
    new Date(appendedAtMs).toISOString() !== state.journalAppendedAt ||
    record.appendedAtMs !== appendedAtMs ||
    typeof witness.sourceId !== "string" ||
    witness.sourceId.length === 0 ||
    typeof witness.restoreEpoch !== "string" ||
    witness.restoreEpoch.length === 0 ||
    witness.generation !== state.journalHead.generation ||
    witness.recordSha256 !== record.digest
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_STATE",
      "Verified current-state values do not bind one committed release",
    );
  }
  const stateSha256 = await sha256Base64Url(canonicalJsonBytes(core));
  return Object.freeze({ ...core, stateSha256 });
}

function assertOperationMatches(
  operation: FreshnessIssueOperationBinding,
  request: FreshnessIssueRequestIdentity,
): void {
  if (
    operation.operationId !== request.operationId ||
    operation.requestSha256 !== request.requestSha256 ||
    operation.requestNonce !== request.requestNonce ||
    operation.environment !== request.environment ||
    operation.audienceManifestUrlSha256 !==
      request.audienceManifestUrlSha256
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Coordinator returned an operation for a different request",
    );
  }
  assertOperationId(operation.signerOperationId);
}

async function assertLeaseMatches(
  lease: FreshnessIssueLeaseBinding,
  operation: FreshnessIssueOperationBinding,
  request: FreshnessIssueRequestIdentity,
): Promise<void> {
  const leaseDuration =
    lease.expiresAtMs -
    lease.acquiredAtMs +
    2 * lease.clockUncertaintyMs;
  const { stateSha256, ...stateBindingBody } = lease.currentState;
  const expectedStateSha256 = await sha256Base64Url(
    canonicalJsonBytes(stateBindingBody),
  );
  if (
    lease.operation.operationId !== operation.operationId ||
    lease.operation.signerOperationId !== operation.signerOperationId ||
    lease.operation.requestSha256 !== request.requestSha256 ||
    lease.operation.requestNonce !== request.requestNonce ||
    lease.operation.environment !== request.environment ||
    lease.operation.audienceManifestUrlSha256 !==
      request.audienceManifestUrlSha256 ||
    lease.leaseId.length === 0 ||
    lease.fencingToken.length === 0 ||
    parseCanonicalUnsignedDecimal(
      lease.fencingToken,
      "Freshness issue fencing token",
    ) === 0n ||
    !Number.isSafeInteger(lease.acquiredAtMs) ||
    !Number.isSafeInteger(lease.expiresAtMs) ||
    !Number.isSafeInteger(lease.clockUncertaintyMs) ||
    lease.clockUncertaintyMs < 0 ||
    lease.clockUncertaintyMs > MAX_FRESHNESS_ISSUE_LEASE_MS ||
    !Number.isSafeInteger(leaseDuration) ||
    leaseDuration <= 0 ||
    leaseDuration > MAX_FRESHNESS_ISSUE_LEASE_MS ||
    lease.clockId.length === 0 ||
    lease.clockEpoch.length === 0 ||
    expectedStateSha256 !== stateSha256
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_LEASE",
      "Coordinator returned an invalid or overlong Freshness issue lease",
    );
  }
}

function assertSignerClockAndIssueTime(
  result: Extract<
    FreshnessResponseSignerResponse,
    { readonly outcome: "COMPLETED" }
  >,
  lease: FreshnessIssueLeaseBinding,
  afterSigning: FreshnessIssueClockReading,
): void {
  if (
    result.clockId !== lease.clockId ||
    result.clockEpoch !== lease.clockEpoch ||
    !Number.isSafeInteger(result.clockUncertaintyMs) ||
    result.clockUncertaintyMs < 0 ||
    result.clockUncertaintyMs > lease.clockUncertaintyMs ||
    !Number.isSafeInteger(result.signedAtMs) ||
    !Number.isSafeInteger(result.signedAtMs - result.clockUncertaintyMs) ||
    !Number.isSafeInteger(result.signedAtMs + result.clockUncertaintyMs) ||
    result.signedAtMs - result.clockUncertaintyMs <
      lease.acquiredAtMs + lease.clockUncertaintyMs ||
    result.signedAtMs + result.clockUncertaintyMs >=
      lease.expiresAtMs - lease.clockUncertaintyMs ||
    result.signedAtMs > afterSigning.nowMs + afterSigning.uncertaintyMs
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_SIGNER_RESULT",
      "Signer timestamp is outside the active issue lease clock interval",
    );
  }
}

function assertResponseMatchesCurrentState(
  response: VerifiedFreshnessResponse,
  state: FreshnessIssueCurrentStateBinding,
): void {
  const payload = response.payload;
  if (
    payload.environment !== state.environment ||
    payload.latest_epoch !== state.manifestEpoch ||
    payload.pointer_generation !== state.pointerGeneration ||
    payload.manifest_sha256 !== state.manifestSha256 ||
    payload.manifest_ref !== state.manifestRef ||
    payload.release_commit_id !== state.releaseCommitId ||
    payload.release_commit_record_sha256 !==
      state.releaseCommitRecordSha256 ||
    payload.release_commit_record_appended_at !== state.journalAppendedAt
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_SIGNER_RESULT",
      "Signed Freshness response does not bind the verified current state",
    );
  }
}

function sameCurrentStateBinding(
  left: FreshnessIssueCurrentStateBinding,
  right: FreshnessIssueCurrentStateBinding,
): boolean {
  return bytesEqual(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

function sameLeaseBinding(
  left: FreshnessIssueLeaseBinding,
  right: FreshnessIssueLeaseBinding,
): boolean {
  return (
    sameOperationBinding(left.operation, right.operation) &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.acquiredAtMs === right.acquiredAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    left.clockId === right.clockId &&
    left.clockEpoch === right.clockEpoch &&
    left.clockUncertaintyMs === right.clockUncertaintyMs &&
    sameCurrentStateBinding(left.currentState, right.currentState)
  );
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return encodeBase64Url(new Uint8Array(digest));
}

async function rejectBeforeSigner(
  coordinator: FreshnessIssueCoordinator,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
  reason: FreshnessIssueRejectionReason,
): Promise<FreshnessIssueResult> {
  const receipt = await coordinator.rejectBeforeSigner({
    operation,
    lease,
    reason,
  });
  assertMutationReceipt(receipt, operation, lease);
  if (receipt.status === "RESULT_UNKNOWN" || receipt.blocker === "RETAINED") {
    return { status: "RESULT_UNKNOWN", operationId: operation.operationId };
  }
  return { status: "REJECTED", operationId: operation.operationId, reason };
}

async function rejectCompletedSigner(
  coordinator: FreshnessIssueCoordinator,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
  signerResult: Extract<
    FreshnessResponseSignerResponse,
    { readonly outcome: "COMPLETED" }
  >,
  reason: FreshnessIssueRejectionReason,
): Promise<FreshnessIssueResult> {
  const resultSha256 =
    signerResult.responseBytes instanceof Uint8Array
      ? await sha256Base64Url(signerResult.responseBytes)
      : null;
  const receipt = await coordinator.rejectCompletedSigner({
    operation,
    lease,
    signerOperationId: signerResult.signerOperationId,
    resultSha256,
    reason,
  });
  assertMutationReceipt(receipt, operation, lease);
  if (receipt.status === "RESULT_UNKNOWN" || receipt.blocker === "RETAINED") {
    return { status: "RESULT_UNKNOWN", operationId: operation.operationId };
  }
  return { status: "REJECTED", operationId: operation.operationId, reason };
}

async function markResultUnknown(
  coordinator: FreshnessIssueCoordinator,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
  signerOperationId = operation.signerOperationId,
): Promise<FreshnessIssueResult> {
  const receipt = await coordinator.markResultUnknown({
    operation,
    lease,
    signerOperationId,
  });
  assertMutationReceipt(receipt, operation, lease);
  if (receipt.status !== "RESULT_UNKNOWN" || receipt.blocker !== "RETAINED") {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Unknown signer outcome did not retain the operation blocker",
    );
  }
  return { status: "RESULT_UNKNOWN", operationId: operation.operationId };
}

function assertMutationReceipt(
  receipt: FreshnessIssueMutationReceipt,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
): void {
  if (
    !sameOperationBinding(receipt.operation, operation) ||
    receipt.leaseId !== lease.leaseId ||
    receipt.fencingToken !== lease.fencingToken
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Coordinator mutation receipt does not match the active operation",
    );
  }
}

function sameOperationBinding(
  left: FreshnessIssueOperationBinding,
  right: FreshnessIssueOperationBinding,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.signerOperationId === right.signerOperationId &&
    left.requestSha256 === right.requestSha256 &&
    left.requestNonce === right.requestNonce &&
    left.environment === right.environment &&
    left.audienceManifestUrlSha256 === right.audienceManifestUrlSha256
  );
}

function resolveExistingOperation(
  result: Exclude<FreshnessIssueBeginResult, { readonly status: "ACQUIRED" }>,
  request: FreshnessIssueRequestIdentity,
  challenge: FreshnessRequest,
  dependencies: FreshnessIssueDependencies,
): Promise<FreshnessIssueResult> {
  if (result.status === "CONFLICT") {
    return Promise.resolve({
      status: "CONFLICT",
      operationId: request.operationId,
    });
  }
  assertOperationMatches(result.operation, request);
  if (result.status === "FINALIZED") {
    if (result.blocker !== "CLEARED") {
      throw new FreshnessIssueCoreError(
        "INVALID_COORDINATION_BINDING",
        "Finalized operation retained a coordination blocker",
      );
    }
    return validateFinalizedResult(
      result.operation,
      result.responseBytes,
      result.responseSha256,
      request,
      challenge,
      dependencies,
      "ALREADY_FINALIZED",
    );
  }
  if (result.status === "IN_PROGRESS") {
    if (result.blocker !== "RETAINED") {
      throw new FreshnessIssueCoreError(
        "INVALID_COORDINATION_BINDING",
        "In-progress operation did not retain its blocker",
      );
    }
    return Promise.resolve({
      status: "IN_PROGRESS",
      operationId: request.operationId,
    });
  }
  if (result.status === "RESULT_UNKNOWN") {
    if (result.blocker !== "RETAINED") {
      throw new FreshnessIssueCoreError(
        "INVALID_COORDINATION_BINDING",
        "Unknown operation did not retain its blocker",
      );
    }
    return Promise.resolve({
      status: "RESULT_UNKNOWN",
      operationId: request.operationId,
    });
  }
  if (result.blocker !== "CLEARED") {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Rejected operation retained an unexplained blocker",
    );
  }
  return Promise.resolve({
    status: "REJECTED",
    operationId: request.operationId,
    reason: result.reason,
  });
}

async function resolveFinalization(
  finalized: FreshnessIssueFinalizationResult,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
  signerBytes: Uint8Array,
  signerSha256: string,
  verifiedResponse: VerifiedFreshnessResponse,
  signerClockUncertaintyMs: number,
): Promise<FreshnessIssueResult> {
  assertFinalizationIdentity(finalized, operation, lease);
  if (finalized.status === "REJECTED") {
    if (finalized.blocker !== "CLEARED") {
      throw new FreshnessIssueCoreError(
        "INVALID_COORDINATION_BINDING",
        "Rejected completed operation retained an unexplained finalization state",
      );
    }
    return {
      status: "REJECTED",
      operationId: operation.operationId,
      reason: finalized.reason,
    };
  }
  if (finalized.status === "RESULT_UNKNOWN") {
    if (finalized.blocker !== "RETAINED") {
      throw new FreshnessIssueCoreError(
        "INVALID_COORDINATION_BINDING",
        "Unknown finalization outcome did not retain its blocker",
      );
    }
    return { status: "RESULT_UNKNOWN", operationId: operation.operationId };
  }
  if (finalized.status !== "FINALIZED") {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Coordinator returned an unknown finalization status",
    );
  }

  const storedDigest = await sha256Base64Url(finalized.responseBytes);
  if (
    finalized.blocker !== "CLEARED" ||
    !clockReadingWithinLease(finalized.finalizedAt, lease) ||
    finalized.finalizedAt.nowMs - finalized.finalizedAt.uncertaintyMs <
      verifiedResponse.issuedAtMs + signerClockUncertaintyMs ||
    finalized.responseSha256 !== signerSha256 ||
    storedDigest !== signerSha256 ||
    !bytesEqual(finalized.responseBytes, signerBytes) ||
    verifiedResponse.payload.request_nonce !== operation.requestNonce
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Finalized result does not match the exact verified signer bytes",
    );
  }
  return {
    status: "ISSUED",
    operationId: operation.operationId,
    responseBytes: finalized.responseBytes.slice(),
    responseSha256: storedDigest,
  };
}

function assertFinalizationIdentity(
  result: FreshnessIssueFinalizationResult,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
): void {
  if (
    !sameOperationBinding(result.operation, operation) ||
    result.leaseId !== lease.leaseId ||
    result.fencingToken !== lease.fencingToken
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_COORDINATION_BINDING",
      "Finalization receipt does not match the active operation",
    );
  }
}

function clockReadingWithinLease(
  reading: FreshnessIssueClockReading,
  lease: FreshnessIssueLeaseBinding,
): boolean {
  return (
    reading.clockId === lease.clockId &&
    reading.clockEpoch === lease.clockEpoch &&
    Number.isSafeInteger(reading.nowMs) &&
    Number.isSafeInteger(reading.uncertaintyMs) &&
    Number.isSafeInteger(reading.nowMs - reading.uncertaintyMs) &&
    Number.isSafeInteger(reading.nowMs + reading.uncertaintyMs) &&
    reading.uncertaintyMs >= 0 &&
    reading.uncertaintyMs <= lease.clockUncertaintyMs &&
    reading.nowMs - reading.uncertaintyMs >= lease.acquiredAtMs &&
    reading.nowMs + reading.uncertaintyMs < lease.expiresAtMs
  );
}

async function validateFinalizedResult(
  operation: FreshnessIssueOperationBinding,
  responseBytes: Uint8Array,
  responseSha256: string,
  request: FreshnessIssueRequestIdentity,
  challenge: FreshnessRequest,
  dependencies: FreshnessIssueDependencies,
  status: "ISSUED" | "ALREADY_FINALIZED",
): Promise<FreshnessIssueResult> {
  if (responseBytes.byteLength === 0 ||
      responseBytes.byteLength > runtimeConfigFreshnessWire.maxResponseBytes) {
    return {
      status: "REJECTED",
      operationId: operation.operationId,
      reason: "SIGNER_RESPONSE_INVALID",
    };
  }
  const digest = await sha256Base64Url(responseBytes);
  if (digest !== responseSha256) {
    return {
      status: "REJECTED",
      operationId: operation.operationId,
      reason: "SIGNER_RESPONSE_INVALID",
    };
  }
  const reading = await dependencies.coordinator.readClock();
  assertClockReading(reading);
  const verified = await verifyRuntimeConfigFreshnessResponse({
    raw: responseBytes,
    bootstrapSigner: dependencies.bootstrapSigner,
    manifestUrl: dependencies.manifestUrl,
    request: challenge,
    nowMs: reading.nowMs + reading.uncertaintyMs,
  });
  if (
    verified.payload.request_nonce !== request.requestNonce ||
    verified.payload.audience_manifest_url_sha256 !==
      request.audienceManifestUrlSha256
  ) {
    return {
      status: "REJECTED",
      operationId: operation.operationId,
      reason: "SIGNER_RESPONSE_INVALID",
    };
  }
  return {
    status,
    operationId: operation.operationId,
    responseBytes: responseBytes.slice(),
    responseSha256: digest,
  };
}

function assertClockReading(reading: FreshnessIssueClockReading): void {
  if (
    reading.clockId.length === 0 ||
    reading.clockEpoch.length === 0 ||
    !Number.isSafeInteger(reading.nowMs) ||
    !Number.isSafeInteger(reading.uncertaintyMs) ||
    !Number.isSafeInteger(reading.nowMs - reading.uncertaintyMs) ||
    !Number.isSafeInteger(reading.nowMs + reading.uncertaintyMs) ||
    reading.uncertaintyMs < 0
  ) {
    throw new FreshnessIssueCoreError(
      "INVALID_LEASE",
      "Freshness trusted clock reading is invalid",
    );
  }
}

async function resolveAfterFinalizationError(
  coordinator: FreshnessIssueCoordinator,
  request: FreshnessIssueRequestIdentity,
  challenge: FreshnessRequest,
  dependencies: FreshnessIssueDependencies,
  operation: FreshnessIssueOperationBinding,
  lease: FreshnessIssueLeaseBinding,
): Promise<FreshnessIssueResult> {
  let existing: FreshnessIssueLookupResult;
  try {
    existing = await coordinator.getOperation(request);
  } catch {
    throw new FreshnessIssueCoreError(
      "FINALIZATION_OUTCOME_UNKNOWN",
      "Could not resolve durable Freshness finalization status",
    );
  }
  if (existing.status === "NOT_FOUND") {
    throw new FreshnessIssueCoreError(
      "FINALIZATION_OUTCOME_UNKNOWN",
      "Acquired issue operation disappeared before finalization could be resolved",
    );
  }
  if (existing.status === "IN_PROGRESS") {
    return markResultUnknown(coordinator, operation, lease);
  }
  return resolveExistingOperation(
    existing,
    request,
    challenge,
    dependencies,
  );
}
