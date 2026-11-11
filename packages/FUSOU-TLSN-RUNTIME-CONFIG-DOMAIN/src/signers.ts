import type {
  FreshnessRequest,
  PendingReleaseAttemptBinding,
  ReleaseCommitRecordEnvelope,
  VerifiedDelegation,
  VerifiedJournalHeadBinding,
  VerifiedRuntimeConfigManifestEpochPointer,
  VerifiedReleaseCommitRecord,
} from "./domain.ts";

export const STRICT_FRESHNESS_PROFILE_ID =
  "strict-journal-witness-v1" as const;
export const CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID =
  "cloudflare-operator-v1" as const;

export type FreshnessProfileId =
  | typeof STRICT_FRESHNESS_PROFILE_ID
  | typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;

export interface CloudflareOperatorCurrentStateBinding {
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly environment: "production";
  readonly chainId: string;
  readonly releaseOperationId: string;
  readonly releaseFencingToken: string;
  readonly position: string;
  readonly generation: string;
  readonly recordSha256: string;
  readonly releaseCommitId: string;
  readonly appendedAt: string;
  readonly manifestEpoch: string;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly manifestNotBeforeMs: number;
  readonly manifestExpiresAtMs: number;
  readonly localRestoreEpoch: string;
  readonly stateSha256: string;
}

export interface CloudflareOperatorIssueOperationBinding {
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly operationId: string;
  readonly signerOperationId: string;
  readonly requestSha256: string;
  readonly requestNonce: string;
  readonly environment: "production";
  readonly chainId: string;
  readonly audienceManifestUrlSha256: string;
}

export interface CloudflareOperatorIssueSigningAuthorization {
  readonly operation: CloudflareOperatorIssueOperationBinding;
  readonly fencingToken: string;
  readonly requestBytes: Uint8Array;
  readonly currentState: CloudflareOperatorCurrentStateBinding;
}

export interface CloudflareOperatorIssueSigningClaim {
  readonly status:
    | "CLAIMED"
    | "ALREADY_CLAIMED"
    | "RESULT_UNKNOWN"
    | "FINALIZED"
    | "REJECTED"
    | "CONFLICT";
  readonly reason?: string;
}

export interface CloudflareOperatorIssueAdmission {
  readonly status:
    | "ACQUIRED"
    | "IN_PROGRESS"
    | "RESULT_UNKNOWN"
    | "FINALIZED"
    | "EXPIRED"
    | "REJECTED"
    | "CONFLICT";
  readonly operation?: CloudflareOperatorIssueOperationBinding;
  readonly fencingToken?: string;
  readonly currentState?: CloudflareOperatorCurrentStateBinding;
  readonly responseBytes?: Uint8Array;
  readonly responseSha256?: string;
  readonly reason?: string;
}

export interface CloudflareOperatorBindingInstallOperation {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly environment: "production";
  readonly chainId: string;
  readonly mode: "BOOTSTRAP" | "ADVANCE";
  readonly status: "VERIFYING" | "INSTALLED" | "QUARANTINED" | "CONFLICT";
  readonly reason: string | null;
  readonly releaseOperationId: string;
  readonly releaseFencingToken: string;
  readonly installFencingToken: string;
  readonly expectedCurrentStateSha256: string | null;
  readonly expectedRestoreEpoch: string;
  readonly targetPosition: string;
  readonly targetGeneration: string;
  readonly targetRecordSha256: string;
  readonly installedState: CloudflareOperatorCurrentStateBinding | null;
}

export interface CloudflareOperatorBindingInstallAction {
  readonly status:
    | "STARTED"
    | "INSTALLED"
    | "WAITING_FOR_ISSUES"
    | "QUARANTINED"
    | "CONFLICT";
  readonly operation?: CloudflareOperatorBindingInstallOperation;
}

export interface CloudflareOperatorFreshnessSigningRequest {
  readonly operation: "ISSUE_LATEST_AT_ISSUANCE";
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly issue: CloudflareOperatorIssueOperationBinding;
  readonly fencingToken: string;
  readonly requestBytes: Uint8Array;
  readonly challenge: FreshnessRequest;
  readonly currentState: CloudflareOperatorCurrentStateBinding;
}

export interface CloudflareOperatorFreshnessSigner {
  issue(
    request: CloudflareOperatorFreshnessSigningRequest,
  ): Promise<
    | { readonly outcome: "COMPLETED"; readonly responseBytes: Uint8Array }
    | { readonly outcome: "UNKNOWN" }
  >;
}

export interface CloudflareOperatorReleaseLedgerSnapshot {
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly environment: "production";
  readonly chainId: string;
  readonly observedAtMs: number;
  readonly lastObservedUtcMs: number;
  readonly localRestoreEpoch: string;
  readonly writerPending: boolean;
  readonly issueBlocker: boolean;
  readonly currentState: CloudflareOperatorCurrentStateBinding | null;
  readonly head: {
    readonly operationId: string;
    readonly position: string;
    readonly generation: string;
    readonly recordSha256: string;
    readonly previousRecordSha256: string | null;
    readonly releaseCommitId: string;
    readonly appendedAt: string;
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
    readonly manifestEpoch: string;
    readonly manifestSha256: string;
    readonly manifestRef: string;
    readonly pointerEtag: string;
  } | null;
  readonly releaseOperation: {
    readonly operationId: string;
    readonly status: string;
    readonly fencingToken: string | null;
    readonly recordBytes: Uint8Array | null;
    readonly releaseDelegationBytes: Uint8Array | null;
    readonly localAppendObservedAt: string | null;
    readonly manifestBytes: Uint8Array;
    readonly manifestSha256: string;
    readonly manifestEpoch: string;
    readonly manifestRef: string;
    readonly pointerEtag: string;
  } | null;
}

export interface VerifiedCloudflareOperatorReleaseState {
  readonly profileId: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly environment: "production";
  readonly chainId: string;
  readonly observedAtMs: number;
  readonly state: CloudflareOperatorCurrentStateBinding;
  readonly releaseCommit: VerifiedReleaseCommitRecord;
  readonly manifest: VerifiedRuntimeConfigManifestEpochPointer;
  readonly recordBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly pointerBytes: Uint8Array;
  readonly snapshotBytes: Uint8Array;
  readonly pointerEtag: string;
}

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
