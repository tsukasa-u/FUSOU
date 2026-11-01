import type {
  FreshnessRequest,
  FreshnessResponseEnvelope,
  PendingReleaseAttemptBinding,
  ReleaseCommitRecordEnvelope,
  VerifiedDelegation,
  VerifiedJournalHeadBinding,
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
  readonly challenge: FreshnessRequest;
  readonly verifiedCurrentState: VerifiedCurrentFreshnessState;
  readonly freshnessDelegation: VerifiedDelegation<"freshness-response-v1">;
}

export interface VerifiedCurrentFreshnessState {
  readonly source: "verified-journal-do-r2-snapshot";
  readonly freshnessSemantics: "LATEST_AT_ISSUANCE";
  readonly environment: "production";
  readonly journalHead: VerifiedJournalHeadBinding;
  readonly releaseCommitRecord: ReleaseCommitRecordEnvelope;
  readonly releaseCommitRecordSha256: string;
  readonly journalAppendedAt: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly pointerGeneration: string;
  readonly manifestEpoch: string;
}

export interface FreshnessResponseSignerResponse {
  readonly response: FreshnessResponseEnvelope;
  readonly challengeNonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
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
  ): Promise<FreshnessResponseSignerResponse>;
}
