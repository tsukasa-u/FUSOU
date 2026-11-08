import { DurableObject } from "cloudflare:workers";
import {
  MAX_FRESHNESS_ISSUE_LEASE_MS,
  type FreshnessIssueBeginInput,
  type FreshnessIssueBeginResult,
  type FreshnessIssueClockReading,
  type FreshnessIssueFinalizationResult,
  type FreshnessIssueLeaseCheck,
  type FreshnessIssueLookupResult,
  type FreshnessIssueMutationReceipt,
  type FreshnessIssueRejectionReason,
  type FreshnessIssueRequestIdentity,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import {
  canonicalJsonBytes,
  encodeBase64Url,
  parseCanonicalUnsignedDecimal,
  runtimeConfigFreshnessWire,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import type {
  FreshnessAntiRollbackWitnessBinding,
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const OPERATION_STATUSES = [
  "IN_PROGRESS",
  "RESULT_UNKNOWN",
  "FINALIZED",
  "REJECTED",
] as const;
type OperationStatus = (typeof OPERATION_STATUSES)[number];
type BlockerState = "RETAINED" | "CLEARED";

export class FreshnessIssueCoordinatorStorageError extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "NOT_INITIALIZED"
    | "CORRUPT_STORAGE"
    | "ILLEGAL_TRANSITION"
    | "FENCE_EXHAUSTED"
    | "RELEASE_CONFLICT"
    | "RELEASE_BLOCKED";

  constructor(
    code: FreshnessIssueCoordinatorStorageError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FreshnessIssueCoordinatorStorageError";
    this.code = code;
  }
}

interface CoordinatorEnv {}

interface CoordinatorStateRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly environment: string;
  readonly current_state_json: string;
  readonly witness_json: string;
  readonly restore_epoch: string;
  readonly clock_id: string;
  readonly clock_epoch: string;
  readonly clock_now_ms: number;
  readonly clock_uncertainty_ms: number;
  readonly next_fencing_token: string;
  readonly write_fencing_token: string;
  readonly writer_pending: number;
  readonly writer_operation_id: string | null;
}

interface IssueOperationRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly signer_operation_id: string;
  readonly request_sha256: string;
  readonly request_nonce: string;
  readonly environment: string;
  readonly audience_manifest_url_sha256: string;
  readonly status: string;
  readonly blocker: string;
  readonly lease_id: string | null;
  readonly fencing_token: string | null;
  readonly acquired_at_ms: number | null;
  readonly expires_at_ms: number | null;
  readonly clock_id: string | null;
  readonly clock_epoch: string | null;
  readonly clock_uncertainty_ms: number | null;
  readonly current_state_json: string | null;
  readonly signer_result_sha256: string | null;
  readonly signed_at_ms: number | null;
  readonly finalized_at_json: string | null;
  readonly response_bytes: ArrayBuffer | null;
  readonly response_length: number | null;
  readonly response_sha256: string | null;
  readonly rejection_reason: string | null;
}

export class SqliteFreshnessIssueCoordinatorDO extends DurableObject<CoordinatorEnv> {
  constructor(ctx: DurableObjectState, env: CoordinatorEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS coordinator_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          environment TEXT NOT NULL,
          current_state_json TEXT NOT NULL,
          witness_json TEXT NOT NULL,
          restore_epoch TEXT NOT NULL,
          clock_id TEXT NOT NULL,
          clock_epoch TEXT NOT NULL,
          clock_now_ms INTEGER NOT NULL,
          clock_uncertainty_ms INTEGER NOT NULL,
          next_fencing_token TEXT NOT NULL,
          write_fencing_token TEXT NOT NULL,
          writer_pending INTEGER NOT NULL CHECK (writer_pending IN (0, 1)),
          writer_operation_id TEXT
        );
        CREATE TABLE IF NOT EXISTS freshness_issue_operations (
          operation_id TEXT PRIMARY KEY,
          signer_operation_id TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,
          request_nonce TEXT NOT NULL,
          environment TEXT NOT NULL,
          audience_manifest_url_sha256 TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('IN_PROGRESS', 'RESULT_UNKNOWN', 'FINALIZED', 'REJECTED')
          ),
          blocker TEXT NOT NULL CHECK (blocker IN ('RETAINED', 'CLEARED')),
          lease_id TEXT,
          fencing_token TEXT,
          acquired_at_ms INTEGER,
          expires_at_ms INTEGER,
          clock_id TEXT,
          clock_epoch TEXT,
          clock_uncertainty_ms INTEGER,
          current_state_json TEXT,
          signer_result_sha256 TEXT,
          signed_at_ms INTEGER,
          finalized_at_json TEXT,
          response_bytes BLOB,
          response_length INTEGER,
          response_sha256 TEXT,
          rejection_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS freshness_issue_blockers
          ON freshness_issue_operations(blocker, status);
      `);
    });
  }

  async beginOrGet(
    input: FreshnessIssueBeginInput,
  ): Promise<FreshnessIssueBeginResult> {
    assertRequestIdentity(input);
    if (input.maxLeaseMs !== MAX_FRESHNESS_ISSUE_LEASE_MS) {
      throw new FreshnessIssueCoordinatorStorageError(
        "INVALID_INPUT",
        "Freshness issue lease must use the protocol maximum",
      );
    }

    return this.ctx.storage.transactionSync(() => {
      const existing = this.findOperation(input.operationId);
      if (existing) {
        return sameRequestIdentity(operationFromRow(existing), input)
          ? this.beginResultFromRow(existing)
          : { status: "CONFLICT" as const };
      }

      const operation = makeOperation(input, crypto.randomUUID());
      const stateRow = this.readStateRow();
      if (!stateRow) {
        this.insertRejectedOperation(
          operation,
          "CURRENT_STATE_UNAVAILABLE",
        );
        return this.rejectedBeginResult(
          operation,
          "CURRENT_STATE_UNAVAILABLE",
        );
      }

      const state = this.decodeCoordinatorState(stateRow);
      const reading = clockFromState(stateRow);
      const currentStateIsUsable =
        !state.writerPending &&
        sameWitness(state.currentState.antiRollbackWitness, state.witness) &&
        state.restoreEpoch === state.witness.restoreEpoch;
      if (!currentStateIsUsable) {
        const reason = state.writerPending
          ? "CURRENT_STATE_UNAVAILABLE"
          : "CURRENT_STATE_MISMATCH";
        this.insertRejectedOperation(operation, reason);
        return this.rejectedBeginResult(operation, reason);
      }

      const uncertainty = reading.uncertaintyMs;
      const leaseDuration =
        MAX_FRESHNESS_ISSUE_LEASE_MS - 2 * uncertainty;
      const upperBoundRoom =
        leaseDuration - 2 * uncertainty;
      if (
        leaseDuration <= 0 ||
        upperBoundRoom <= 0 ||
        !Number.isSafeInteger(leaseDuration) ||
        !Number.isSafeInteger(upperBoundRoom)
      ) {
        this.insertRejectedOperation(operation, "LEASE_NOT_ACTIVE");
        return this.rejectedBeginResult(operation, "LEASE_NOT_ACTIVE");
      }

      const acquiredAtMs = reading.nowMs - uncertainty;
      const expiresAtMs = acquiredAtMs + leaseDuration;
      if (
        !Number.isSafeInteger(acquiredAtMs) ||
        !Number.isSafeInteger(expiresAtMs) ||
        reading.nowMs + uncertainty >= expiresAtMs
      ) {
        this.insertRejectedOperation(operation, "LEASE_NOT_ACTIVE");
        return this.rejectedBeginResult(operation, "LEASE_NOT_ACTIVE");
      }

      const fencingToken = incrementCounter(state.nextFencingToken);
      const lease: FreshnessIssueLeaseBinding = {
        operation,
        leaseId: crypto.randomUUID(),
        fencingToken,
        acquiredAtMs,
        expiresAtMs,
        clockId: reading.clockId,
        clockEpoch: reading.clockEpoch,
        clockUncertaintyMs: reading.uncertaintyMs,
        currentState: state.currentState,
      };
      this.ctx.storage.sql.exec(
        "UPDATE coordinator_state SET next_fencing_token = ? WHERE singleton = 1",
        fencingToken,
      );
      this.insertAcquiredOperation(lease);
      return {
        status: "ACQUIRED",
        operation,
        lease,
        blocker: "RETAINED",
      };
    });
  }

  async getOperation(
    input: FreshnessIssueRequestIdentity,
  ): Promise<FreshnessIssueLookupResult> {
    assertRequestIdentity(input);
    return this.ctx.storage.transactionSync(() => {
      const row = this.findOperation(input.operationId);
      if (!row) return { status: "NOT_FOUND" as const };
      return sameRequestIdentity(operationFromRow(row), input)
        ? this.lookupResultFromRow(row)
        : { status: "CONFLICT" as const };
    });
  }

  async readClock(): Promise<FreshnessIssueClockReading> {
    return this.ctx.storage.transactionSync(() => {
      const row = this.readStateRow();
      if (!row) {
        throw new FreshnessIssueCoordinatorStorageError(
          "NOT_INITIALIZED",
          "Coordinator clock and current state are not initialized",
        );
      }
      return clockFromState(row);
    });
  }

  async checkLease(
    lease: FreshnessIssueLeaseBinding,
  ): Promise<FreshnessIssueLeaseCheck> {
    assertLeaseShape(lease);
    return this.ctx.storage.transactionSync(() => {
      const stateRow = this.readStateRow();
      if (!stateRow) {
        throw new FreshnessIssueCoordinatorStorageError(
          "NOT_INITIALIZED",
          "Coordinator state is not initialized",
        );
      }
      const state = this.decodeCoordinatorState(stateRow);
      const reading = clockFromState(stateRow);
      const row = this.findOperation(lease.operation.operationId);
      if (!row) {
        return {
          status: "UNKNOWN",
          operation: lease.operation,
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
          reading,
        };
      }
      const operation = operationFromRow(row);
      const persistedLease = leaseFromRow(row);
      if (!sameOperation(operation, lease.operation)) {
        return {
          status: "UNKNOWN",
          operation,
          leaseId: persistedLease?.leaseId ?? lease.leaseId,
          fencingToken: persistedLease?.fencingToken ?? lease.fencingToken,
          reading,
        };
      }
      if (!persistedLease) {
        return {
          status: "UNKNOWN",
          operation,
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
          reading,
        };
      }
      if (
        persistedLease.leaseId !== lease.leaseId ||
        persistedLease.fencingToken !== lease.fencingToken
      ) {
        return {
          status: "FENCED",
          operation,
          leaseId: persistedLease.leaseId,
          fencingToken: persistedLease.fencingToken,
          reading,
        };
      }
      if (row.status !== "IN_PROGRESS" || row.blocker !== "RETAINED") {
        return {
          status: "UNKNOWN",
          operation,
          leaseId: persistedLease.leaseId,
          fencingToken: persistedLease.fencingToken,
          reading,
        };
      }
      if (
        state.writerPending ||
        compareCounters(persistedLease.fencingToken, state.writeFencingToken) <=
          0 ||
        !sameStateBinding(state.currentState, persistedLease.currentState) ||
        !sameWitness(state.currentState.antiRollbackWitness, state.witness) ||
        state.restoreEpoch !== state.witness.restoreEpoch ||
        !clockMatchesLease(reading, persistedLease)
      ) {
        const expired =
          reading.clockId === persistedLease.clockId &&
          reading.clockEpoch === persistedLease.clockEpoch &&
          reading.nowMs + reading.uncertaintyMs >=
            persistedLease.expiresAtMs;
        return {
          status: expired ? "EXPIRED" : "FENCED",
          operation,
          leaseId: persistedLease.leaseId,
          fencingToken: persistedLease.fencingToken,
          reading,
        };
      }
      return {
        status: "ACTIVE",
        operation,
        leaseId: persistedLease.leaseId,
        fencingToken: persistedLease.fencingToken,
        reading,
      };
    });
  }

  async rejectBeforeSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt> {
    return this.ctx.storage.transactionSync(() => {
      const row = this.requireOperation(input.operation);
      this.requireLease(row, input.lease);
      if (row.status === "REJECTED") {
        this.assertSameRejection(row, input.reason, null);
        return this.mutationReceipt(row, "REJECTED", "CLEARED");
      }
      if (row.status !== "IN_PROGRESS" || row.blocker !== "RETAINED") {
        throw transitionError("Only an in-progress pre-signer operation may be rejected");
      }
      this.transitionToRejected(
        row,
        input.reason,
        null,
        null,
      );
      const rejected = this.requireOperation(input.operation);
      return this.mutationReceipt(rejected, "REJECTED", "CLEARED");
    });
  }

  async rejectCompletedSigner(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
    readonly resultSha256: string | null;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<FreshnessIssueMutationReceipt> {
    if (
      input.signerOperationId !== input.operation.signerOperationId ||
      (input.resultSha256 !== null &&
        !SHA256_BASE64URL_PATTERN.test(input.resultSha256))
    ) {
      throw invalidInput("Completed signer result binding is invalid");
    }
    return this.ctx.storage.transactionSync(() => {
      const row = this.requireOperation(input.operation);
      this.requireLease(row, input.lease);
      if (row.signer_operation_id !== input.signerOperationId) {
        throw invalidInput("Signer operation ID does not match the stored operation");
      }
      if (row.status === "REJECTED") {
        this.assertSameRejection(
          row,
          input.reason,
          input.resultSha256,
        );
        return this.mutationReceipt(row, "REJECTED", "CLEARED");
      }
      if (
        (row.status !== "IN_PROGRESS" &&
          row.status !== "RESULT_UNKNOWN") ||
        row.blocker !== "RETAINED"
      ) {
        throw transitionError(
          "A completed signer cannot replace a terminal issue result",
        );
      }
      this.transitionToRejected(
        row,
        input.reason,
        input.resultSha256,
        null,
      );
      const rejected = this.requireOperation(input.operation);
      return this.mutationReceipt(rejected, "REJECTED", "CLEARED");
    });
  }

  async markResultUnknown(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
  }): Promise<FreshnessIssueMutationReceipt> {
    if (input.signerOperationId !== input.operation.signerOperationId) {
      throw invalidInput("Unknown signer operation ID does not match the operation");
    }
    return this.ctx.storage.transactionSync(() => {
      const row = this.requireOperation(input.operation);
      this.requireLease(row, input.lease);
      if (row.signer_operation_id !== input.signerOperationId) {
        throw invalidInput("Signer operation ID does not match the stored operation");
      }
      if (row.status === "RESULT_UNKNOWN" && row.blocker === "RETAINED") {
        return this.mutationReceipt(row, "RESULT_UNKNOWN", "RETAINED");
      }
      if (row.status !== "IN_PROGRESS" || row.blocker !== "RETAINED") {
        throw transitionError("Only an in-progress issue may become result-unknown");
      }
      this.ctx.storage.sql.exec(
        `UPDATE freshness_issue_operations
         SET status = 'RESULT_UNKNOWN', blocker = 'RETAINED'
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND blocker = 'RETAINED'`,
        input.operation.operationId,
      );
      const unknown = this.requireOperation(input.operation);
      return this.mutationReceipt(unknown, "RESULT_UNKNOWN", "RETAINED");
    });
  }

  async finalizeIfCurrent(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly responseBytes: Uint8Array;
    readonly responseSha256: string;
    readonly signedAtMs: number;
    readonly currentState: FreshnessIssueCurrentStateBinding;
  }): Promise<FreshnessIssueFinalizationResult> {
    assertLeaseShape(input.lease);
    assertCurrentStateBinding(input.currentState);
    if (!(input.responseBytes instanceof Uint8Array)) {
      throw invalidInput("Freshness finalization requires exact response bytes");
    }
    const responseBytes = copyBytes(input.responseBytes);
    const responseSha256 = await sha256Base64Url(responseBytes);
    const digestMatches =
      input.responseSha256 === responseSha256 &&
      SHA256_BASE64URL_PATTERN.test(input.responseSha256);

    return this.ctx.storage.transactionSync(() => {
      const row = this.requireOperation(input.operation);
      this.requireLease(row, input.lease);
      if (!sameStateBinding(input.lease.currentState, input.currentState)) {
        return this.finalizationUnknown(row, input.lease);
      }
      if (row.status === "FINALIZED") {
        if (
          row.response_sha256 === responseSha256 &&
          row.response_length === responseBytes.byteLength &&
          equalBytes(responseFromRow(row), responseBytes)
        ) {
          return this.finalizedResult(row, input.lease);
        }
        throw transitionError(
          "A finalized Freshness operation cannot be replaced with other bytes",
        );
      }
      if (row.status === "RESULT_UNKNOWN") {
        return this.finalizationUnknown(row, input.lease);
      }
      if (row.status === "REJECTED") {
        return this.rejectedFinalization(row, input.lease);
      }
      if (row.status !== "IN_PROGRESS" || row.blocker !== "RETAINED") {
        throw transitionError("Freshness finalization requires a retained in-progress issue");
      }

      const stateRow = this.readStateRow();
      if (!stateRow) {
        return this.rejectFinalization(
          row,
          input.lease,
          "CURRENT_STATE_UNAVAILABLE",
          responseSha256,
          input.signedAtMs,
        );
      }
      const state = this.decodeCoordinatorState(stateRow);
      const reading = clockFromState(stateRow);
      if (!digestMatches || responseBytes.byteLength === 0 ||
          responseBytes.byteLength > runtimeConfigFreshnessWire.maxResponseBytes) {
        return this.rejectFinalization(
          row,
          input.lease,
          "SIGNER_RESPONSE_INVALID",
          responseSha256,
          input.signedAtMs,
        );
      }
      if (!Number.isSafeInteger(input.signedAtMs)) {
        return this.rejectFinalization(
          row,
          input.lease,
          "SIGNER_RESPONSE_INVALID",
          responseSha256,
          null,
        );
      }
      if (
        !clockMatchesLease(reading, input.lease) ||
        !signedTimeWithinLease(input.signedAtMs, input.lease)
      ) {
        return this.rejectFinalization(
          row,
          input.lease,
          "LEASE_NOT_ACTIVE",
          responseSha256,
          input.signedAtMs,
        );
      }
      if (
        state.writerPending ||
        compareCounters(input.lease.fencingToken, state.writeFencingToken) <=
          0 ||
        !sameStateBinding(state.currentState, input.currentState) ||
        !sameWitness(state.currentState.antiRollbackWitness, state.witness) ||
        state.restoreEpoch !== state.witness.restoreEpoch
      ) {
        return this.rejectFinalization(
          row,
          input.lease,
          "CURRENT_STATE_MISMATCH",
          responseSha256,
          input.signedAtMs,
        );
      }

      const leaseFromStorage = leaseFromRow(row);
      if (!leaseFromStorage ||
          !sameLease(leaseFromStorage, input.lease) ||
          !sameOperation(operationFromRow(row), input.operation)) {
        return this.finalizationUnknown(row, input.lease);
      }

      this.ctx.storage.sql.exec(
        `UPDATE freshness_issue_operations
         SET status = 'FINALIZED',
             blocker = 'CLEARED',
             signer_result_sha256 = ?,
             signed_at_ms = ?,
             finalized_at_json = ?,
             response_bytes = ?,
             response_length = ?,
             response_sha256 = ?
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND blocker = 'RETAINED' AND lease_id = ? AND fencing_token = ?`,
        responseSha256,
        input.signedAtMs,
        JSON.stringify(reading),
        arrayBufferFromBytes(responseBytes),
        responseBytes.byteLength,
        responseSha256,
        input.operation.operationId,
        input.lease.leaseId,
        input.lease.fencingToken,
      );
      const finalized = this.requireOperation(input.operation);
      if (finalized.status !== "FINALIZED") {
        throw new FreshnessIssueCoordinatorStorageError(
          "CORRUPT_STORAGE",
          "Atomic Freshness finalization did not persist its terminal state",
        );
      }
      return this.finalizedResult(finalized, input.lease);
    });
  }

  private get sql() {
    return this.ctx.storage.sql;
  }

  private readStateRow(): CoordinatorStateRow | null {
    const rows = this.sql
      .exec<CoordinatorStateRow>(
        `SELECT environment, current_state_json, witness_json, restore_epoch,
                clock_id, clock_epoch, clock_now_ms, clock_uncertainty_ms,
                next_fencing_token, write_fencing_token, writer_pending,
                writer_operation_id
         FROM coordinator_state WHERE singleton = 1`,
      )
      .toArray();
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw corruptStorage("Coordinator singleton state is not unique");
    }
    return rows[0]!;
  }

  private decodeCoordinatorState(row: CoordinatorStateRow) {
    const currentState = parseCurrentState(row.current_state_json);
    const witness = parseWitness(row.witness_json);
    const nextFencingToken = parseCanonicalUnsignedDecimal(
      row.next_fencing_token,
      "Stored next fencing token",
      true,
    );
    const writeFencingToken = parseCanonicalUnsignedDecimal(
      row.write_fencing_token,
      "Stored write fencing token",
      true,
    );
    if (
      row.environment !== "production" ||
      row.restore_epoch.length === 0 ||
      row.restore_epoch !== witness.restoreEpoch ||
      row.writer_pending !== 0 && row.writer_pending !== 1 ||
      (row.writer_pending === 1) !== (row.writer_operation_id !== null) ||
      nextFencingToken < writeFencingToken
    ) {
      throw corruptStorage("Persisted coordinator state is inconsistent");
    }
    return {
      environment: row.environment as "production",
      currentState,
      witness,
      restoreEpoch: row.restore_epoch,
      writerPending: row.writer_pending === 1,
      nextFencingToken: row.next_fencing_token,
      writeFencingToken: row.write_fencing_token,
    };
  }

  private findOperation(operationId: string): IssueOperationRow | null {
    const rows = this.sql
      .exec<IssueOperationRow>(
        `SELECT operation_id, signer_operation_id, request_sha256,
                request_nonce, environment, audience_manifest_url_sha256,
                status, blocker, lease_id, fencing_token, acquired_at_ms,
                expires_at_ms, clock_id, clock_epoch, clock_uncertainty_ms,
                current_state_json, signer_result_sha256, signed_at_ms,
                finalized_at_json, response_bytes, response_length,
                response_sha256, rejection_reason
         FROM freshness_issue_operations WHERE operation_id = ?`,
        operationId,
      )
      .toArray();
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw corruptStorage("Freshness operation ID is not unique");
    }
    operationStatusFromRow(rows[0]!);
    blockerFromRow(rows[0]!);
    return rows[0]!;
  }

  private requireOperation(
    operation: FreshnessIssueOperationBinding,
  ): IssueOperationRow {
    const row = this.findOperation(operation.operationId);
    if (!row || !sameOperation(operationFromRow(row), operation)) {
      throw invalidInput("Freshness operation binding does not match storage");
    }
    return row;
  }

  private requireLease(
    row: IssueOperationRow,
    lease: FreshnessIssueLeaseBinding,
  ): void {
    const persisted = leaseFromRow(row);
    if (
      !sameOperation(operationFromRow(row), lease.operation) ||
      persisted === null ||
      !sameLease(persisted, lease)
    ) {
      throw invalidInput("Freshness lease or fence does not match storage");
    }
  }

  private beginResultFromRow(row: IssueOperationRow): FreshnessIssueBeginResult {
    const result = this.lookupResultFromRow(row);
    if (result.status === "NOT_FOUND") {
      throw corruptStorage("Stored Freshness operation disappeared");
    }
    return result;
  }

  private lookupResultFromRow(row: IssueOperationRow): FreshnessIssueLookupResult {
    const status = operationStatusFromRow(row);
    const operation = operationFromRow(row);
    const blocker = blockerFromRow(row);
    if (status === "IN_PROGRESS") {
      if (blocker !== "RETAINED") {
        throw corruptStorage("In-progress operation does not retain its blocker");
      }
      return { status, operation, blocker };
    }
    if (status === "RESULT_UNKNOWN") {
      if (blocker !== "RETAINED") {
        throw corruptStorage("Unknown operation does not retain its blocker");
      }
      return { status, operation, blocker };
    }
    if (status === "FINALIZED") {
      if (blocker !== "CLEARED") {
        throw corruptStorage("Finalized operation retains a blocker");
      }
      return {
        status,
        operation,
        responseBytes: responseFromRow(row),
        responseSha256: requiredString(row.response_sha256, "response_sha256"),
        blocker,
      };
    }
    if (blocker !== "CLEARED") {
      throw corruptStorage("Rejected operation retains a blocker");
    }
    return {
      status,
      operation,
      reason: requiredRejectionReason(row.rejection_reason),
      blocker,
    };
  }

  private insertRejectedOperation(
    operation: FreshnessIssueOperationBinding,
    reason: FreshnessIssueRejectionReason,
  ): void {
    this.sql.exec(
      `INSERT INTO freshness_issue_operations (
         operation_id, signer_operation_id, request_sha256, request_nonce,
         environment, audience_manifest_url_sha256, status, blocker,
         rejection_reason
       ) VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', 'CLEARED', ?)`,
      operation.operationId,
      operation.signerOperationId,
      operation.requestSha256,
      operation.requestNonce,
      operation.environment,
      operation.audienceManifestUrlSha256,
      reason,
    );
  }

  private insertAcquiredOperation(lease: FreshnessIssueLeaseBinding): void {
    const { operation } = lease;
    this.sql.exec(
      `INSERT INTO freshness_issue_operations (
         operation_id, signer_operation_id, request_sha256, request_nonce,
         environment, audience_manifest_url_sha256, status, blocker,
         lease_id, fencing_token, acquired_at_ms, expires_at_ms, clock_id,
         clock_epoch, clock_uncertainty_ms, current_state_json
       ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', 'RETAINED', ?, ?, ?, ?, ?, ?, ?, ?)`,
      operation.operationId,
      operation.signerOperationId,
      operation.requestSha256,
      operation.requestNonce,
      operation.environment,
      operation.audienceManifestUrlSha256,
      lease.leaseId,
      lease.fencingToken,
      lease.acquiredAtMs,
      lease.expiresAtMs,
      lease.clockId,
      lease.clockEpoch,
      lease.clockUncertaintyMs,
      JSON.stringify(lease.currentState),
    );
  }

  private rejectedBeginResult(
    operation: FreshnessIssueOperationBinding,
    reason: FreshnessIssueRejectionReason,
  ): FreshnessIssueBeginResult {
    return {
      status: "REJECTED",
      operation,
      reason,
      blocker: "CLEARED",
    };
  }

  private mutationReceipt(
    row: IssueOperationRow,
    status: "REJECTED" | "RESULT_UNKNOWN",
    blocker: BlockerState,
  ): FreshnessIssueMutationReceipt {
    const lease = leaseFromRow(row);
    if (!lease) {
      throw corruptStorage("Mutation receipt has no persisted lease");
    }
    return {
      status,
      operation: operationFromRow(row),
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      blocker,
    };
  }

  private transitionToRejected(
    row: IssueOperationRow,
    reason: FreshnessIssueRejectionReason,
    resultSha256: string | null,
    signedAtMs: number | null,
  ): void {
    const updated = this.sql
      .exec<{ readonly operation_id: string }>(
        `UPDATE freshness_issue_operations
         SET status = 'REJECTED', blocker = 'CLEARED',
             rejection_reason = ?, signer_result_sha256 = ?,
             signed_at_ms = ?
         WHERE operation_id = ? AND status = ?
           AND blocker = 'RETAINED'
         RETURNING operation_id`,
        reason,
        resultSha256,
        signedAtMs,
        row.operation_id,
        row.status,
      )
      .toArray();
    if (updated.length !== 1) {
      throw transitionError("Freshness rejection lost its atomic state transition");
    }
  }

  private assertSameRejection(
    row: IssueOperationRow,
    reason: FreshnessIssueRejectionReason,
    resultSha256: string | null,
  ): void {
    if (
      row.rejection_reason !== reason ||
      row.signer_result_sha256 !== resultSha256
    ) {
      throw transitionError("A terminal rejection cannot be replaced");
    }
  }

  private rejectFinalization(
    row: IssueOperationRow,
    lease: FreshnessIssueLeaseBinding,
    reason: FreshnessIssueRejectionReason,
    resultSha256: string | null,
    signedAtMs: number | null,
  ): FreshnessIssueFinalizationResult {
    this.transitionToRejected(row, reason, resultSha256, signedAtMs);
    const rejected = this.requireOperation(lease.operation);
    return {
      status: "REJECTED",
      operation: operationFromRow(rejected),
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      reason,
      blocker: "CLEARED",
    };
  }

  private rejectedFinalization(
    row: IssueOperationRow,
    lease: FreshnessIssueLeaseBinding,
  ): FreshnessIssueFinalizationResult {
    return {
      status: "REJECTED",
      operation: operationFromRow(row),
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      reason: requiredRejectionReason(row.rejection_reason),
      blocker: "CLEARED",
    };
  }

  private finalizationUnknown(
    row: IssueOperationRow,
    lease: FreshnessIssueLeaseBinding,
  ): FreshnessIssueFinalizationResult {
    return {
      status: "RESULT_UNKNOWN",
      operation: operationFromRow(row),
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      blocker: "RETAINED",
    };
  }

  private finalizedResult(
    row: IssueOperationRow,
    lease: FreshnessIssueLeaseBinding,
  ): FreshnessIssueFinalizationResult {
    return {
      status: "FINALIZED",
      operation: operationFromRow(row),
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      finalizedAt: parseClockJson(
        requiredString(row.finalized_at_json, "finalized_at_json"),
      ),
      responseBytes: responseFromRow(row),
      responseSha256: requiredString(row.response_sha256, "response_sha256"),
      blocker: "CLEARED",
    };
  }

}

function assertRequestIdentity(
  input: FreshnessIssueRequestIdentity,
): void {
  assertUuid(input.operationId, "Freshness operation ID");
  if (
    !SHA256_BASE64URL_PATTERN.test(input.requestSha256) ||
    !SHA256_BASE64URL_PATTERN.test(input.audienceManifestUrlSha256) ||
    input.environment !== "production" ||
    typeof input.requestNonce !== "string" ||
    input.requestNonce.length === 0 ||
    input.requestNonce.length > 256
  ) {
    throw invalidInput("Freshness request identity is invalid");
  }
}

function assertLeaseShape(lease: FreshnessIssueLeaseBinding): void {
  assertOperationBinding(lease.operation);
  assertUuid(lease.leaseId, "Freshness lease ID");
  parseCanonicalUnsignedDecimal(lease.fencingToken, "Freshness fencing token");
  const duration =
    lease.expiresAtMs -
    lease.acquiredAtMs +
    2 * lease.clockUncertaintyMs;
  if (
    !Number.isSafeInteger(lease.acquiredAtMs) ||
    !Number.isSafeInteger(lease.expiresAtMs) ||
    !Number.isSafeInteger(lease.clockUncertaintyMs) ||
    lease.clockUncertaintyMs < 0 ||
    !Number.isSafeInteger(duration) ||
    duration <= 0 ||
    duration > MAX_FRESHNESS_ISSUE_LEASE_MS ||
    lease.clockId.length === 0 ||
    lease.clockEpoch.length === 0
  ) {
    throw invalidInput("Freshness lease bounds are invalid");
  }
  assertCurrentStateBinding(lease.currentState);
}

function assertOperationBinding(
  operation: FreshnessIssueOperationBinding,
): void {
  assertUuid(operation.operationId, "Freshness operation ID");
  assertUuid(operation.signerOperationId, "Freshness signer operation ID");
  if (
    !SHA256_BASE64URL_PATTERN.test(operation.requestSha256) ||
    !SHA256_BASE64URL_PATTERN.test(operation.audienceManifestUrlSha256) ||
    operation.requestNonce.length === 0 ||
    operation.environment !== "production"
  ) {
    throw invalidInput("Freshness operation binding is invalid");
  }
}

function assertCurrentStateBinding(
  value: unknown,
): asserts value is FreshnessIssueCurrentStateBinding {
  if (!isRecord(value) || value.environment !== "production") {
    throw invalidInput("Freshness current-state binding is invalid");
  }
  for (const key of [
    "generation",
    "journalHeadSha256",
    "releaseCommitId",
    "releaseCommitRecordSha256",
    "journalAppendedAt",
    "manifestEpoch",
    "manifestSha256",
    "manifestRef",
    "pointerEtag",
    "pointerGeneration",
    "stateSha256",
  ]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      throw invalidInput(`Freshness state field ${key} is missing`);
    }
  }
  if (
    !isRecord(value.antiRollbackWitness) ||
    typeof value.antiRollbackWitness.sourceId !== "string" ||
    value.antiRollbackWitness.sourceId.length === 0 ||
    typeof value.antiRollbackWitness.restoreEpoch !== "string" ||
    value.antiRollbackWitness.restoreEpoch.length === 0 ||
    typeof value.antiRollbackWitness.generation !== "string" ||
    typeof value.antiRollbackWitness.recordSha256 !== "string"
  ) {
    throw invalidInput("Freshness anti-rollback witness binding is invalid");
  }
  parseCanonicalUnsignedDecimal(value.generation as string, "Freshness generation");
  parseCanonicalUnsignedDecimal(value.pointerGeneration as string, "Pointer generation");
  parseCanonicalUnsignedDecimal(value.manifestEpoch as string, "Manifest epoch");
  if (
    !UUID_V4_PATTERN.test(value.releaseCommitId as string) ||
    !SHA256_BASE64URL_PATTERN.test(value.journalHeadSha256 as string) ||
    !SHA256_BASE64URL_PATTERN.test(value.releaseCommitRecordSha256 as string) ||
    !SHA256_BASE64URL_PATTERN.test(value.manifestSha256 as string) ||
    !SHA256_BASE64URL_PATTERN.test(value.stateSha256 as string) ||
    !SHA256_BASE64URL_PATTERN.test(
      value.antiRollbackWitness.recordSha256,
    ) ||
    value.generation !== value.pointerGeneration ||
    value.generation !== value.antiRollbackWitness.generation ||
    value.journalHeadSha256 !== value.releaseCommitRecordSha256 ||
    value.journalHeadSha256 !== value.antiRollbackWitness.recordSha256 ||
    value.manifestRef !==
      `tlsn/runtime-config/v2/manifests/${value.manifestSha256}`
  ) {
    throw invalidInput("Freshness state binding fields are inconsistent");
  }
  const appendedAtMs = Date.parse(value.journalAppendedAt as string);
  if (
    !Number.isSafeInteger(appendedAtMs) ||
    new Date(appendedAtMs).toISOString() !== value.journalAppendedAt
  ) {
    throw invalidInput("Freshness Journal append time is invalid");
  }
}

function parseCurrentState(value: string): FreshnessIssueCurrentStateBinding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw corruptStorage("Stored Freshness current-state JSON is invalid");
  }
  assertCurrentStateBinding(parsed);
  return parsed;
}

function assertWitness(
  witness: FreshnessAntiRollbackWitnessBinding,
): void {
  if (
    typeof witness.sourceId !== "string" ||
    witness.sourceId.length === 0 ||
    typeof witness.restoreEpoch !== "string" ||
    witness.restoreEpoch.length === 0 ||
    !SHA256_BASE64URL_PATTERN.test(witness.recordSha256)
  ) {
    throw invalidInput("Anti-rollback witness is invalid");
  }
  parseCanonicalUnsignedDecimal(witness.generation, "Witness generation");
}

function parseWitness(value: string): FreshnessAntiRollbackWitnessBinding {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw corruptStorage("Stored witness JSON is invalid");
  }
  if (!isRecord(parsed)) throw corruptStorage("Stored witness is invalid");
  const witness = parsed as unknown as FreshnessAntiRollbackWitnessBinding;
  assertWitness(witness);
  return witness;
}

function assertClockReading(reading: FreshnessIssueClockReading): void {
  if (
    typeof reading.clockId !== "string" ||
    reading.clockId.length === 0 ||
    typeof reading.clockEpoch !== "string" ||
    reading.clockEpoch.length === 0 ||
    !Number.isSafeInteger(reading.nowMs) ||
    !Number.isSafeInteger(reading.uncertaintyMs) ||
    reading.uncertaintyMs < 0
  ) {
    throw invalidInput("Freshness clock reading is invalid");
  }
}

function clockFromState(row: CoordinatorStateRow): FreshnessIssueClockReading {
  const reading = {
    clockId: row.clock_id,
    clockEpoch: row.clock_epoch,
    nowMs: row.clock_now_ms,
    uncertaintyMs: row.clock_uncertainty_ms,
  };
  assertClockReading(reading);
  return reading;
}

function parseClockJson(value: string): FreshnessIssueClockReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw corruptStorage("Stored finalization clock is invalid");
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.clockId !== "string" ||
    typeof parsed.clockEpoch !== "string" ||
    typeof parsed.nowMs !== "number" ||
    typeof parsed.uncertaintyMs !== "number"
  ) {
    throw corruptStorage("Stored finalization clock is invalid");
  }
  const reading = {
    clockId: parsed.clockId,
    clockEpoch: parsed.clockEpoch,
    nowMs: parsed.nowMs,
    uncertaintyMs: parsed.uncertaintyMs,
  };
  assertClockReading(reading);
  return reading;
}

function clockMatchesLease(
  reading: FreshnessIssueClockReading,
  lease: FreshnessIssueLeaseBinding,
): boolean {
  return (
    reading.clockId === lease.clockId &&
    reading.clockEpoch === lease.clockEpoch &&
    Number.isSafeInteger(reading.nowMs - reading.uncertaintyMs) &&
    Number.isSafeInteger(reading.nowMs + reading.uncertaintyMs) &&
    reading.uncertaintyMs <= lease.clockUncertaintyMs &&
    reading.nowMs - reading.uncertaintyMs >= lease.acquiredAtMs &&
    reading.nowMs + reading.uncertaintyMs < lease.expiresAtMs
  );
}

function signedTimeWithinLease(
  signedAtMs: number,
  lease: FreshnessIssueLeaseBinding,
): boolean {
  return (
    Number.isSafeInteger(signedAtMs - lease.clockUncertaintyMs) &&
    Number.isSafeInteger(signedAtMs + lease.clockUncertaintyMs) &&
    signedAtMs - lease.clockUncertaintyMs >= lease.acquiredAtMs &&
    signedAtMs + lease.clockUncertaintyMs < lease.expiresAtMs
  );
}

function makeOperation(
  input: FreshnessIssueRequestIdentity,
  signerOperationId: string,
): FreshnessIssueOperationBinding {
  return {
    operationId: input.operationId,
    signerOperationId,
    requestSha256: input.requestSha256,
    requestNonce: input.requestNonce,
    environment: input.environment,
    audienceManifestUrlSha256: input.audienceManifestUrlSha256,
  };
}

function operationFromRow(row: IssueOperationRow): FreshnessIssueOperationBinding {
  if (row.environment !== "production") {
    throw corruptStorage("Persisted operation has an invalid environment");
  }
  const operation: FreshnessIssueOperationBinding = {
    operationId: row.operation_id,
    signerOperationId: row.signer_operation_id,
    requestSha256: row.request_sha256,
    requestNonce: row.request_nonce,
    environment: "production",
    audienceManifestUrlSha256: row.audience_manifest_url_sha256,
  };
  assertOperationBinding(operation);
  return operation;
}

function leaseFromRow(
  row: IssueOperationRow,
): FreshnessIssueLeaseBinding | null {
  if (
    row.lease_id === null ||
    row.fencing_token === null ||
    row.acquired_at_ms === null ||
    row.expires_at_ms === null ||
    row.clock_id === null ||
    row.clock_epoch === null ||
    row.clock_uncertainty_ms === null ||
    row.current_state_json === null
  ) {
    if (operationStatusFromRow(row) === "REJECTED") return null;
    throw corruptStorage("Non-rejected operation has an incomplete lease");
  }
  const lease = {
    operation: operationFromRow(row),
    leaseId: row.lease_id,
    fencingToken: row.fencing_token,
    acquiredAtMs: row.acquired_at_ms,
    expiresAtMs: row.expires_at_ms,
    clockId: row.clock_id,
    clockEpoch: row.clock_epoch,
    clockUncertaintyMs: row.clock_uncertainty_ms,
    currentState: parseCurrentState(row.current_state_json),
  };
  assertLeaseShape(lease);
  return lease;
}

function operationStatusFromRow(row: IssueOperationRow): OperationStatus {
  if (
    !OPERATION_STATUSES.includes(row.status as OperationStatus) ||
    !UUID_V4_PATTERN.test(row.operation_id) ||
    !UUID_V4_PATTERN.test(row.signer_operation_id)
  ) {
    throw corruptStorage("Persisted Freshness operation status or ID is invalid");
  }
  return row.status as OperationStatus;
}

function blockerFromRow(row: IssueOperationRow): BlockerState {
  if (row.blocker !== "RETAINED" && row.blocker !== "CLEARED") {
    throw corruptStorage("Persisted blocker state is invalid");
  }
  return row.blocker;
}

function rejectionReasonFromRow(
  row: IssueOperationRow,
): FreshnessIssueRejectionReason | null {
  if (row.rejection_reason === null) return null;
  if (
    row.rejection_reason === "LEASE_NOT_ACTIVE" ||
    row.rejection_reason === "CURRENT_STATE_UNAVAILABLE" ||
    row.rejection_reason === "CURRENT_STATE_MISMATCH" ||
    row.rejection_reason === "SIGNER_RESPONSE_INVALID" ||
    row.rejection_reason === "FINALIZATION_REJECTED"
  ) {
    return row.rejection_reason;
  }
  throw corruptStorage("Persisted rejection reason is invalid");
}

function requiredRejectionReason(
  value: string | null,
): FreshnessIssueRejectionReason {
  if (value === null) throw corruptStorage("Rejected operation has no reason");
  const reason = rejectionReasonFromRow({
    rejection_reason: value,
  } as IssueOperationRow);
  if (reason === null) throw corruptStorage("Rejected operation has no reason");
  return reason;
}

function responseFromRow(row: IssueOperationRow): Uint8Array {
  if (
    row.response_bytes === null ||
    row.response_length === null ||
    row.response_sha256 === null
  ) {
    throw corruptStorage("Finalized operation has no exact response bytes");
  }
  const bytes = new Uint8Array(row.response_bytes.slice(0));
  if (
    bytes.byteLength !== row.response_length ||
    bytes.byteLength === 0 ||
    bytes.byteLength > runtimeConfigFreshnessWire.maxResponseBytes
  ) {
    throw corruptStorage("Stored response length is invalid");
  }
  return bytes;
}

function sameRequestIdentity(
  operation: FreshnessIssueOperationBinding,
  request: FreshnessIssueRequestIdentity,
): boolean {
  return (
    operation.operationId === request.operationId &&
    operation.requestSha256 === request.requestSha256 &&
    operation.requestNonce === request.requestNonce &&
    operation.environment === request.environment &&
    operation.audienceManifestUrlSha256 ===
      request.audienceManifestUrlSha256
  );
}

function sameOperation(
  left: FreshnessIssueOperationBinding,
  right: FreshnessIssueOperationBinding,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.signerOperationId === right.signerOperationId &&
    left.requestSha256 === right.requestSha256 &&
    left.requestNonce === right.requestNonce &&
    left.environment === right.environment &&
    left.audienceManifestUrlSha256 ===
      right.audienceManifestUrlSha256
  );
}

function sameLease(
  left: FreshnessIssueLeaseBinding,
  right: FreshnessIssueLeaseBinding,
): boolean {
  return (
    sameOperation(left.operation, right.operation) &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.acquiredAtMs === right.acquiredAtMs &&
    left.expiresAtMs === right.expiresAtMs &&
    left.clockId === right.clockId &&
    left.clockEpoch === right.clockEpoch &&
    left.clockUncertaintyMs === right.clockUncertaintyMs &&
    sameStateBinding(left.currentState, right.currentState)
  );
}

function sameStateBinding(
  left: FreshnessIssueCurrentStateBinding,
  right: FreshnessIssueCurrentStateBinding,
): boolean {
  return equalBytes(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

function sameWitness(
  left: FreshnessAntiRollbackWitnessBinding,
  right: FreshnessAntiRollbackWitnessBinding,
): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.restoreEpoch === right.restoreEpoch &&
    left.generation === right.generation &&
    left.recordSha256 === right.recordSha256
  );
}

function incrementCounter(value: string): string {
  const current = parseCanonicalUnsignedDecimal(
    value,
    "Freshness fencing counter",
    true,
  );
  if (current >= UINT64_MAX) {
    throw new FreshnessIssueCoordinatorStorageError(
      "FENCE_EXHAUSTED",
      "Freshness fencing counter reached UInt64 maximum",
    );
  }
  const next = current + 1n;
  return next.toString(10);
}

function compareCounters(left: string, right: string): number {
  const leftValue = parseCanonicalUnsignedDecimal(
    left,
    "Freshness fencing token",
    true,
  );
  const rightValue = parseCanonicalUnsignedDecimal(
    right,
    "Current write fencing token",
    true,
  );
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return encodeBase64Url(new Uint8Array(digest));
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertUuid(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    throw invalidInput(`${label} must be a canonical lowercase UUIDv4`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: string | null, label: string): string {
  if (value === null) throw corruptStorage(`Stored ${label} is missing`);
  return value;
}

function invalidInput(message: string): FreshnessIssueCoordinatorStorageError {
  return new FreshnessIssueCoordinatorStorageError("INVALID_INPUT", message);
}

function transitionError(message: string): FreshnessIssueCoordinatorStorageError {
  return new FreshnessIssueCoordinatorStorageError("ILLEGAL_TRANSITION", message);
}

function corruptStorage(message: string): FreshnessIssueCoordinatorStorageError {
  return new FreshnessIssueCoordinatorStorageError("CORRUPT_STORAGE", message);
}
