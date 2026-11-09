import type {
  FreshnessRequest,
  PendingReleaseAttemptBinding,
  ReleaseCommitRecordEnvelope,
  VerifiedDelegation,
  VerifiedJournalHeadBinding,
  VerifiedReleaseCommitRecord,
} from "./domain.ts";

export interface ReleaseAuthorizationSignerRequest {
  readonly operation: "AUTHORIZE_JOURNAL_APPEND";
  readonly pendingAttempt: PendingReleaseAttemptBinding;
  readonly expectedJournalHead: VerifiedJournalHeadBinding | null;
  readonly releaseAuthorityDelegation: VerifiedDelegation<"release-commit-record-v1">;
}

export interface ReleaseAuthorizationSignerResponse {
  readonly record: ReleaseCommitRecordEnvelope;
  readonly attempt_id: string;
  readonly record_sha256: string;
}

export interface FreshnessResponseSignerRequest {
  readonly operation: "ISSUE_LATEST_AT_ISSUANCE";
  readonly issue: FreshnessIssueOperationBinding;
  readonly challenge: FreshnessRequest;
  readonly lease: FreshnessIssueLeaseBinding;
  readonly currentState: FreshnessIssueCurrentStateBinding;
}

export interface FreshnessIssueOperationBinding {
  readonly operationId: string;
  readonly signerOperationId: string;
  readonly requestSha256: string;
  readonly requestNonce: string;
  readonly environment: "production";
  readonly audienceManifestUrlSha256: string;
}

export interface FreshnessAntiRollbackWitnessBinding {
  readonly sourceId: string;
  readonly restoreEpoch: string;
  readonly generation: string;
  readonly recordSha256: string;
}

export interface FreshnessIssueCurrentStateBinding {
  readonly environment: "production";
  readonly generation: string;
  readonly journalHeadSha256: string;
  readonly releaseCommitId: string;
  readonly releaseCommitRecordSha256: string;
  readonly journalAppendedAt: string;
  readonly manifestEpoch: string;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly pointerGeneration: string;
  readonly antiRollbackWitness: FreshnessAntiRollbackWitnessBinding;
  readonly stateSha256: string;
}

export interface FreshnessIssueLeaseBinding {
  readonly operation: FreshnessIssueOperationBinding;
  readonly leaseId: string;
  readonly fencingToken: string;
  readonly acquiredAtMs: number;
  readonly expiresAtMs: number;
  readonly clockId: string;
  readonly clockEpoch: string;
  readonly clockUncertaintyMs: number;
  readonly currentState: FreshnessIssueCurrentStateBinding;
}

export interface FreshnessCurrentStateProofContext {
  readonly environment: "production";
  readonly chainId: string;
  readonly operation: FreshnessIssueOperationBinding;
  readonly lease: FreshnessIssueLeaseBinding;
  readonly clock: {
    readonly clockId: string;
    readonly clockEpoch: string;
    readonly nowMs: number;
    readonly uncertaintyMs: number;
  };
  readonly readNonce: string;
  readonly readContextSha256: string;
}

export interface FreshnessCurrentStateInstallProofContext {
  readonly mode: "BOOTSTRAP" | "ADVANCE";
  readonly environment: "production";
  readonly chainId: string;
  readonly installOperationId: string;
  readonly installFencingToken: string;
  readonly releaseOperationId: string;
  readonly releaseFencingToken: string;
  readonly targetPosition: string;
  readonly targetGeneration: string;
  readonly targetRecordSha256: string;
  readonly expectedRestoreEpoch: string;
  readonly expectedCurrentStateSha256: string | null;
  readonly clock: {
    readonly clockId: string;
    readonly clockEpoch: string;
    readonly nowMs: number;
    readonly uncertaintyMs: number;
  };
  readonly readNonce: string;
  readonly readContextSha256: string;
}

export type FreshnessCurrentStateReadProofContext =
  | FreshnessCurrentStateProofContext
  | FreshnessCurrentStateInstallProofContext;

export interface FreshnessReleaseStateEvidence {
  readonly proofContext: FreshnessCurrentStateReadProofContext;
  readonly journalHead: {
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
    readonly appendedAt: string;
    readonly appendReceiptBytes: Uint8Array;
    readonly currentHeadProofBytes: Uint8Array;
  };
  readonly pointer: {
    readonly environment: string;
    readonly etag: string;
    readonly bytes: Uint8Array;
  };
  readonly immutableSnapshot: {
    readonly reference: string;
    readonly bytes: Uint8Array;
  };
  readonly manifestBytes: Uint8Array;
  readonly antiRollbackWitness: {
    readonly sourceId: string;
    readonly restoreEpoch: string;
    readonly generation: string;
    readonly recordSha256: string;
    readonly signedBytes: Uint8Array;
  };
}

export interface FreshnessIssueCoordinatorSnapshot {
  readonly operation: FreshnessIssueOperationBinding;
  readonly lease: FreshnessIssueLeaseBinding;
  readonly operationStatus: "IN_PROGRESS";
  readonly blocker: "RETAINED";
  readonly environment: "production";
  readonly currentState: FreshnessIssueCurrentStateBinding;
  readonly witness: FreshnessAntiRollbackWitnessBinding;
  readonly restoreEpoch: string;
  readonly writerPending: boolean;
}

export interface VerifiedFreshnessReleaseState {
  readonly source: "verified-release-journal-r2-witness";
  readonly environment: "production";
  readonly chainId: string;
  readonly journalHead: VerifiedJournalHeadBinding & {
    readonly position: string;
  };
  readonly releaseCommitRecord: ReleaseCommitRecordEnvelope;
  readonly verifiedReleaseCommitRecord: VerifiedReleaseCommitRecord;
  readonly recordBytes: Uint8Array;
  readonly releaseCommitRecordSha256: string;
  readonly releaseDelegationBytes: Uint8Array;
  readonly journalAppendedAt: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly pointerGeneration: string;
  readonly manifestEpoch: string;
  readonly antiRollbackWitness: FreshnessAntiRollbackWitnessBinding;
  readonly proofContextSha256: string;
}

export interface VerifiedCurrentFreshnessState {
  readonly source: "verified-journal-do-r2-snapshot";
  readonly freshnessSemantics: "LATEST_AT_ISSUANCE";
  readonly environment: "production";
  readonly journalHead: VerifiedJournalHeadBinding;
  readonly releaseCommitRecord: ReleaseCommitRecordEnvelope;
  readonly verifiedReleaseCommitRecord: VerifiedReleaseCommitRecord;
  readonly releaseCommitRecordSha256: string;
  readonly journalAppendedAt: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly pointerGeneration: string;
  readonly manifestEpoch: string;
  readonly antiRollbackWitness: FreshnessAntiRollbackWitnessBinding;
}

export interface FreshnessResponseSignerCallContext {
  readonly signal?: AbortSignal;
}

export interface FreshnessResponseSignerCompleted {
  readonly outcome: "COMPLETED";
  readonly issueOperationId: string;
  readonly signerOperationId: string;
  readonly requestSha256: string;
  readonly responseBytes: Uint8Array;
  readonly responseSha256: string;
  readonly signedAtMs: number;
  readonly clockId: string;
  readonly clockEpoch: string;
  readonly clockUncertaintyMs: number;
}

export interface FreshnessResponseSignerUnknown {
  readonly outcome: "UNKNOWN";
  readonly issueOperationId: string;
  readonly signerOperationId: string;
  readonly requestSha256: string;
}

export type FreshnessResponseSignerResponse =
  | FreshnessResponseSignerCompleted
  | FreshnessResponseSignerUnknown;

export interface FreshnessCurrentStateEvidence extends FreshnessReleaseStateEvidence {
  readonly proofContext: FreshnessCurrentStateProofContext;
  readonly coordinatorSnapshot: FreshnessIssueCoordinatorSnapshot;
  readonly coordinatorHead: {
    readonly environment: string;
    readonly generation: string;
    readonly recordSha256: string;
    readonly manifestEpoch: string;
    readonly writerPending: boolean;
    readonly restoreEpoch: string;
  };
  readonly pointer: FreshnessReleaseStateEvidence["pointer"] & {
    readonly generation: string;
  };
}

export type RuntimeConfigSignerErrorCode =
  | "INVALID_REQUEST"
  | "ATTEMPT_MISMATCH"
  | "CURRENT_STATE_UNAVAILABLE"
  | "DELEGATION_EXPIRED"
  | "SIGNER_UNAVAILABLE";

export class RuntimeConfigSignerError extends Error {
  readonly code: RuntimeConfigSignerErrorCode;

  constructor(code: RuntimeConfigSignerErrorCode, message: string) {
    super(message);
    this.name = "RuntimeConfigSignerError";
    this.code = code;
  }
}

export interface ProductionReleaseAuthoritySigner {
  readonly mode: "production";
  readonly purpose: "release-commit-record-v1";
  authorizeJournalAppend(
    request: ReleaseAuthorizationSignerRequest,
  ): Promise<ReleaseAuthorizationSignerResponse>;
}

export interface ProductionFreshnessResponseSigner {
  readonly mode: "production";
  readonly purpose: "freshness-response-v1";
  issueLatestAtIssuance(
    request: FreshnessResponseSignerRequest,
    context?: FreshnessResponseSignerCallContext,
  ): Promise<FreshnessResponseSignerResponse>;
}

export interface TestOnlyReleaseAuthoritySigner {
  readonly mode: "test-only";
  readonly purpose: "release-commit-record-v1";
  authorizeJournalAppend(
    request: ReleaseAuthorizationSignerRequest,
  ): Promise<ReleaseAuthorizationSignerResponse>;
}

export interface TestOnlyFreshnessResponseSigner {
  readonly mode: "test-only";
  readonly purpose: "freshness-response-v1";
  issueLatestAtIssuance(
    request: FreshnessResponseSignerRequest,
    context?: FreshnessResponseSignerCallContext,
  ): Promise<FreshnessResponseSignerResponse>;
}
