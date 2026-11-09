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
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";
import type {
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
  ReleaseLedgerCoordinator;

export class DurableObjectFreshnessIssueCoordinatorAdapter
  implements
    FreshnessIssueCoordinator,
    FreshnessIssueCoordinatorSnapshotReader,
    ReleaseLedgerCoordinator
{
  readonly #stub: FreshnessIssueCoordinatorRpcStub;

  constructor(stub: FreshnessIssueCoordinatorRpcStub) {
    this.#stub = stub;
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
}
