import type {
  FreshnessCurrentStateInstallProofContext,
  FreshnessIssueCurrentStateBinding,
  VerifiedFreshnessReleaseState,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";

export type ReleaseLedgerStatus =
  | "INTENT"
  | "R2_WRITE_PENDING"
  | "R2_STAGED"
  | "LEDGER_COMMITTED"
  | "R2_READBACK_PENDING"
  | "AVAILABLE"
  | "RESULT_UNKNOWN"
  | "QUARANTINED"
  | "CONFLICT";

export interface ReleaseLedgerHead {
  readonly environment: "production";
  readonly chainId: string;
  readonly position: string;
  readonly generation: string;
  readonly recordSha256: string;
  readonly recordBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly previousRecordSha256: string | null;
  readonly releaseCommitId: string;
  readonly localAppendObservedAt: string;
  readonly manifestEpoch: string;
  readonly manifestSha256: string;
  readonly manifestRef: string;
  readonly pointerEtag: string;
  readonly manifestBytes: Uint8Array;
}

export interface ReleaseLedgerOperation {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly status: ReleaseLedgerStatus;
  readonly reason: string | null;
  readonly unknownStage: "R2_WRITE" | "RELEASE_SIGNER" | "R2_READBACK" | null;
  readonly resumeStatus: ReleaseLedgerStatus | null;
  readonly fencingToken: string | null;
  readonly expectedHead: {
    readonly position: string;
    readonly generation: string;
    readonly recordSha256: string;
    readonly pointerEtag: string;
  } | null;
  readonly environment: "production";
  readonly chainId: string;
  readonly manifestBytes: Uint8Array;
  readonly manifestLength: number;
  readonly manifestSha256: string;
  readonly manifestEpoch: string;
  readonly manifestRef: string;
  readonly expectedPointerEtag: string;
  readonly pointerBytes: Uint8Array | null;
  readonly pointerEtag: string | null;
  readonly snapshotBytes: Uint8Array | null;
  readonly recordBytes: Uint8Array | null;
  readonly recordLength: number | null;
  readonly recordSha256: string | null;
  readonly localAppendObservedAt: string | null;
  readonly releaseDelegationBytes: Uint8Array | null;
  readonly position: string | null;
  readonly generation: string | null;
}

export interface ReleaseBindingInstallOperation {
  readonly operationId: string;
  readonly requestSha256: string;
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
  readonly proofContextSha256: string | null;
  readonly installedState: FreshnessIssueCurrentStateBinding | null;
}

export interface CloudflareOperatorGenesisOperation {
  readonly operationId: string;
  readonly status:
    | "VERIFYING"
    | "LEDGER_COMMITTED"
    | "R2_READBACK_PENDING"
    | "RESULT_UNKNOWN"
    | "AVAILABLE"
    | "INSTALLING"
    | "INSTALLED"
    | "QUARANTINED"
    | "CONFLICT"
    | "NOT_FOUND";
  readonly releaseStatus: ReleaseLedgerStatus | null;
  readonly installStatus:
    | "VERIFYING"
    | "INSTALLED"
    | "QUARANTINED"
    | "CONFLICT"
    | null;
}

export type ReleaseBindingInstallActionResult =
  | {
      readonly status:
        | "STARTED"
        | "INSTALLED"
        | "QUARANTINED";
      readonly operation: ReleaseBindingInstallOperation;
    }
  | {
      readonly status: "WAITING_FOR_ISSUES" | "CONFLICT";
      readonly operation?: ReleaseBindingInstallOperation;
    };

export type ReleaseLedgerActionResult =
  | {
      readonly status:
        | "STARTED"
        | "WAITING_FOR_ISSUES"
        | "R2_WRITE_PENDING"
        | "R2_STAGED"
        | "LEDGER_COMMITTED"
        | "R2_READBACK_PENDING"
        | "AVAILABLE"
        | "RESULT_UNKNOWN"
        | "QUARANTINED"
        | "CONFLICT";
      readonly operation: ReleaseLedgerOperation;
    };

export interface ReleaseLedgerCoordinator {
  initializeCloudflareOperatorGenesis(input: {
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly adminCapability: string;
  }): Promise<CloudflareOperatorGenesisOperation>;
  getCloudflareOperatorGenesisOperation(
    operationId: string,
    adminCapability: string,
  ): Promise<CloudflareOperatorGenesisOperation>;
  readReleaseLedgerHead(): Promise<ReleaseLedgerHead | null>;
  beginReleaseOperation(input: {
    readonly operationId: string;
    readonly expectedHead: ReleaseLedgerHead | null;
    readonly manifestBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult>;
  stageReleaseManifest(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult>;
  markReleaseOperationUnknown(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly stage: "R2_WRITE" | "RELEASE_SIGNER" | "R2_READBACK";
  }): Promise<ReleaseLedgerActionResult>;
  appendReleaseRecord(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult>;
  finalizeReleaseR2Readback(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult>;
  reconcileReleaseOperation(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult>;
  getReleaseOperation(
    operationId: string,
  ): Promise<ReleaseLedgerOperation | null>;
  beginReleaseBindingInstall(input: {
    readonly operationId: string;
    readonly mode: "BOOTSTRAP" | "ADVANCE";
    readonly releaseOperationId: string;
    readonly expectedCurrentStateSha256: string | null;
    readonly expectedRestoreEpoch: string;
  }): Promise<ReleaseBindingInstallActionResult>;
  finalizeReleaseBindingInstall(input: {
    readonly proofContext: FreshnessCurrentStateInstallProofContext;
    readonly verifiedState: VerifiedFreshnessReleaseState;
  }): Promise<ReleaseBindingInstallActionResult>;
  getReleaseBindingInstall(
    operationId: string,
  ): Promise<ReleaseBindingInstallOperation | null>;
}
