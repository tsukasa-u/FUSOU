import type {
  FreshnessIssueBeginInput,
  FreshnessIssueBeginResult,
  FreshnessIssueClockReading,
  FreshnessIssueCoordinator,
  FreshnessIssueCoordinatorSnapshotReader,
  FreshnessIssueFinalizationResult,
  FreshnessIssueLeaseCheck,
  FreshnessIssueLookupResult,
  FreshnessIssueMutationReceipt,
  FreshnessIssueRejectionReason,
  FreshnessIssueRequestIdentity,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import type {
  FreshnessIssueCoordinatorSnapshot,
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
  CloudflareOperatorBindingInstallAction,
  CloudflareOperatorBindingInstallOperation,
  CloudflareOperatorIssueAdmission,
  CloudflareOperatorIssueOperationBinding,
  CloudflareOperatorIssueSigningAuthorization,
  CloudflareOperatorIssueSigningClaim,
  CloudflareOperatorReleaseLedgerSnapshot,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";
import type {
  CloudflareOperatorIssueCoordinator,
  CloudflareOperatorReleaseSnapshotReader,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-cloudflare-operator.ts";
import type {
  CloudflareOperatorGenesisOperation,
  ReleaseLedgerActionResult,
  ReleaseBindingInstallActionResult,
  ReleaseBindingInstallOperation,
  ReleaseLedgerCoordinator,
  ReleaseLedgerHead,
  ReleaseLedgerOperation,
} from "./release-ledger.ts";

export type FreshnessIssueCoordinatorRpcStub = {
  [Method in keyof FreshnessIssueCoordinator]: FreshnessIssueCoordinator[Method];
} & FreshnessIssueCoordinatorSnapshotReader &
  ReleaseLedgerCoordinator &
  CloudflareOperatorIssueCoordinator &
  CloudflareOperatorReleaseSnapshotReader & {
    beginCloudflareOperatorBindingInstall(input: {
      readonly operationId: string;
      readonly mode: "BOOTSTRAP" | "ADVANCE";
      readonly releaseOperationId: string;
      readonly expectedCurrentStateSha256: string | null;
      readonly expectedRestoreEpoch: string;
    }): Promise<CloudflareOperatorBindingInstallAction>;
    finalizeCloudflareOperatorBindingInstall(input: {
      readonly operationId: string;
    }): Promise<CloudflareOperatorBindingInstallAction>;
    getCloudflareOperatorBindingInstall(
      operationId: string,
    ): Promise<CloudflareOperatorBindingInstallOperation | null>;
  };

export class DurableObjectFreshnessIssueCoordinatorAdapter
  implements
    FreshnessIssueCoordinator,
    FreshnessIssueCoordinatorSnapshotReader,
    ReleaseLedgerCoordinator,
    CloudflareOperatorIssueCoordinator,
    CloudflareOperatorReleaseSnapshotReader
{
  readonly #stub: FreshnessIssueCoordinatorRpcStub;

  constructor(stub: FreshnessIssueCoordinatorRpcStub) {
    this.#stub = stub;
  }

  initializeCloudflareOperatorGenesis(input: {
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
    readonly manifestBytes: Uint8Array;
    readonly adminCapability: string;
  }): Promise<CloudflareOperatorGenesisOperation> {
    return this.#stub.initializeCloudflareOperatorGenesis(input);
  }

  getCloudflareOperatorGenesisOperation(
    operationId: string,
    adminCapability: string,
  ): Promise<CloudflareOperatorGenesisOperation> {
    return this.#stub.getCloudflareOperatorGenesisOperation(
      operationId,
      adminCapability,
    );
  }

  beginOrGet(
    input: FreshnessIssueBeginInput,
  ): Promise<FreshnessIssueBeginResult> {
    return this.#stub.beginOrGet(input);
  }

  getOperation(
    input: FreshnessIssueRequestIdentity,
  ): Promise<FreshnessIssueLookupResult> {
    return this.#stub.getOperation(input);
  }

  readClock(): Promise<FreshnessIssueClockReading> {
    return this.#stub.readClock();
  }

  checkLease(
    lease: FreshnessIssueLeaseBinding,
  ): Promise<FreshnessIssueLeaseCheck> {
    return this.#stub.checkLease(lease);
  }

  rejectBeforeSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt> {
    return this.#stub.rejectBeforeSigner(input);
  }

  rejectCompletedSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
    readonly resultSha256: string | null;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt> {
    return this.#stub.rejectCompletedSigner(input);
  }

  markResultUnknown(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
  }): Promise<FreshnessIssueMutationReceipt> {
    return this.#stub.markResultUnknown(input);
  }

  finalizeIfCurrent(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly responseBytes: Uint8Array;
    readonly responseSha256: string;
    readonly signedAtMs: number;
    readonly currentState: FreshnessIssueCurrentStateBinding;
  }): Promise<FreshnessIssueFinalizationResult> {
    return this.#stub.finalizeIfCurrent(input);
  }

  readCurrentStateSnapshot(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
  }): Promise<FreshnessIssueCoordinatorSnapshot> {
    return this.#stub.readCurrentStateSnapshot(input);
  }

  readReleaseLedgerHead(): Promise<ReleaseLedgerHead | null> {
    return this.#stub.readReleaseLedgerHead();
  }

  beginReleaseBindingInstall(input: {
    readonly operationId: string;
    readonly mode: "BOOTSTRAP" | "ADVANCE";
    readonly releaseOperationId: string;
    readonly expectedCurrentStateSha256: string | null;
    readonly expectedRestoreEpoch: string;
  }): Promise<ReleaseBindingInstallActionResult> {
    return this.#stub.beginReleaseBindingInstall(input);
  }

  finalizeReleaseBindingInstall(input: Parameters<
    ReleaseLedgerCoordinator["finalizeReleaseBindingInstall"]
  >[0]): Promise<ReleaseBindingInstallActionResult> {
    return this.#stub.finalizeReleaseBindingInstall(input);
  }

  getReleaseBindingInstall(
    operationId: string,
  ): Promise<ReleaseBindingInstallOperation | null> {
    return this.#stub.getReleaseBindingInstall(operationId);
  }

  beginReleaseOperation(input: {
    readonly operationId: string;
    readonly expectedHead: ReleaseLedgerHead | null;
    readonly manifestBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.beginReleaseOperation(input);
  }

  stageReleaseManifest(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.stageReleaseManifest(input);
  }

  markReleaseOperationUnknown(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly stage: "R2_WRITE" | "RELEASE_SIGNER" | "R2_READBACK";
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.markReleaseOperationUnknown(input);
  }

  appendReleaseRecord(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.appendReleaseRecord(input);
  }

  finalizeReleaseR2Readback(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.finalizeReleaseR2Readback(input);
  }

  reconcileReleaseOperation(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    return this.#stub.reconcileReleaseOperation(input);
  }

  getReleaseOperation(
    operationId: string,
  ): Promise<ReleaseLedgerOperation | null> {
    return this.#stub.getReleaseOperation(operationId);
  }

  beginCloudflareOperatorBindingInstall(input: {
    readonly operationId: string;
    readonly mode: "BOOTSTRAP" | "ADVANCE";
    readonly releaseOperationId: string;
    readonly expectedCurrentStateSha256: string | null;
    readonly expectedRestoreEpoch: string;
  }): Promise<CloudflareOperatorBindingInstallAction> {
    return this.#stub.beginCloudflareOperatorBindingInstall(input);
  }

  finalizeCloudflareOperatorBindingInstall(input: {
    readonly operationId: string;
  }): Promise<CloudflareOperatorBindingInstallAction> {
    return this.#stub.finalizeCloudflareOperatorBindingInstall(input);
  }

  getCloudflareOperatorBindingInstall(
    operationId: string,
  ): Promise<CloudflareOperatorBindingInstallOperation | null> {
    return this.#stub.getCloudflareOperatorBindingInstall(operationId);
  }

  readCloudflareOperatorReleaseSnapshot(
  ): Promise<CloudflareOperatorReleaseLedgerSnapshot> {
    return this.#stub.readCloudflareOperatorReleaseSnapshot();
  }

  readCloudflareOperatorIssueReleaseSnapshot(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorReleaseLedgerSnapshot> {
    return this.#stub.readCloudflareOperatorIssueReleaseSnapshot(input);
  }

  beginCloudflareOperatorIssue(
    input: Parameters<
      CloudflareOperatorIssueCoordinator["beginCloudflareOperatorIssue"]
    >[0],
  ): Promise<CloudflareOperatorIssueAdmission> {
    return this.#stub.beginCloudflareOperatorIssue(input);
  }

  claimCloudflareOperatorIssueSigning(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorIssueSigningClaim> {
    return this.#stub.claimCloudflareOperatorIssueSigning(input);
  }

  getCloudflareOperatorIssue(
    input: Parameters<
      CloudflareOperatorIssueCoordinator["getCloudflareOperatorIssue"]
    >[0],
  ): Promise<CloudflareOperatorIssueAdmission> {
    return this.#stub.getCloudflareOperatorIssue(input);
  }

  markCloudflareOperatorIssueUnknown(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
  }): Promise<CloudflareOperatorIssueAdmission> {
    return this.#stub.markCloudflareOperatorIssueUnknown(input);
  }

  rejectCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly reason: string;
  }): Promise<CloudflareOperatorIssueAdmission> {
    return this.#stub.rejectCloudflareOperatorIssue(input);
  }

  finalizeCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly currentStateSha256: string;
    readonly responseBytes: Uint8Array;
  }): Promise<CloudflareOperatorIssueAdmission> {
    return this.#stub.finalizeCloudflareOperatorIssue(input);
  }
}
