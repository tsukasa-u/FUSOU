import type {
  FreshnessIssueBeginInput,
  FreshnessIssueBeginResult,
  FreshnessIssueClockReading,
  FreshnessIssueCoordinator,
  FreshnessIssueFinalizationResult,
  FreshnessIssueLeaseCheck,
  FreshnessIssueLookupResult,
  FreshnessIssueMutationReceipt,
  FreshnessIssueRejectionReason,
  FreshnessIssueRequestIdentity,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import type {
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";

export type FreshnessIssueCoordinatorRpcStub = {
  [Method in keyof FreshnessIssueCoordinator]: FreshnessIssueCoordinator[Method];
};

export class DurableObjectFreshnessIssueCoordinatorAdapter
  implements FreshnessIssueCoordinator
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
}
