import {
  parseCanonicalUnsignedDecimal,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import {
  SqliteFreshnessIssueCoordinatorDO,
} from "../../src/sqlite-freshness-issue-coordinator.ts";
import type {
  FreshnessIssueBeginInput,
  FreshnessIssueBeginResult,
  FreshnessIssueClockReading,
  FreshnessIssueMutationReceipt,
  FreshnessIssueRejectionReason,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import type {
  FreshnessAntiRollbackWitnessBinding,
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISSUE_STATUSES = [
  "IN_PROGRESS",
  "RESULT_UNKNOWN",
  "FINALIZED",
  "REJECTED",
] as const;
const BLOCKER_STATES = ["RETAINED", "CLEARED"] as const;
const REJECTION_REASONS = [
  "LEASE_NOT_ACTIVE",
  "CURRENT_STATE_UNAVAILABLE",
  "CURRENT_STATE_MISMATCH",
  "SIGNER_RESPONSE_INVALID",
  "FINALIZATION_REJECTED",
] as const;

type IssueStatus = (typeof ISSUE_STATUSES)[number];
type BlockerState = (typeof BLOCKER_STATES)[number];
type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface LocalCoordinatorSeed {
  readonly environment: "production";
  readonly currentState: FreshnessIssueCurrentStateBinding;
  readonly witness: FreshnessAntiRollbackWitnessBinding;
  readonly clock: FreshnessIssueClockReading;
}

export interface LocalReleaseStartResult {
  readonly status: "READY" | "WAITING_FOR_ISSUES" | "CONFLICT";
  readonly fencingToken?: string;
}

export interface LocalCoordinatorSnapshot {
  readonly operation: FreshnessIssueOperationBinding;
  readonly status: IssueStatus;
  readonly blocker: BlockerState;
  readonly lease?: FreshnessIssueLeaseBinding;
  readonly signerResultSha256: string | null;
  readonly signedAtMs: number | null;
  readonly finalizedAt: FreshnessIssueClockReading | null;
  readonly responseBytes: Uint8Array | null;
  readonly responseLength: number | null;
  readonly responseSha256: string | null;
  readonly rejectionReason: RejectionReason | null;
  readonly writerPending: boolean;
}

export type LocalTestCallOutcome<T> =
  | { readonly status: "RETURNED"; readonly value: T }
  | {
      readonly status: "THREW";
      readonly errorName: string;
      readonly errorMessage: string;
    };

interface StateRow {
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

interface OperationRow {
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

export class LocalTestFreshnessIssueCoordinatorDO
  extends SqliteFreshnessIssueCoordinatorDO
{
  async bootstrapLocalTestState(seed: LocalCoordinatorSeed): Promise<void> {
    assertSeed(seed);
    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ readonly singleton: number }>(
          "SELECT singleton FROM coordinator_state WHERE singleton = 1",
        )
        .toArray();
      if (existing.length !== 0) {
        throw new Error("Local coordinator state is already initialized");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO coordinator_state (
           singleton, environment, current_state_json, witness_json,
           restore_epoch, clock_id, clock_epoch, clock_now_ms,
           clock_uncertainty_ms, next_fencing_token, write_fencing_token,
           writer_pending, writer_operation_id
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, '0', '0', 0, NULL)`,
        seed.environment,
        JSON.stringify(seed.currentState),
        JSON.stringify(seed.witness),
        seed.witness.restoreEpoch,
        seed.clock.clockId,
        seed.clock.clockEpoch,
        seed.clock.nowMs,
        seed.clock.uncertaintyMs,
      );
    });
  }

  async setClockForLocalTest(
    reading: FreshnessIssueClockReading,
  ): Promise<void> {
    assertClock(reading);
    this.ctx.storage.transactionSync(() => {
      const row = requireStateRow(this.ctx.storage.sql);
      if (
        row.clock_id === reading.clockId &&
        row.clock_epoch === reading.clockEpoch &&
        reading.nowMs < row.clock_now_ms
      ) {
        throw new Error("Local test clock cannot move backwards within an epoch");
      }
      let nextFence = row.next_fencing_token;
      let writeFence = row.write_fencing_token;
      if (
        row.clock_id !== reading.clockId ||
        row.clock_epoch !== reading.clockEpoch
      ) {
        nextFence = incrementCounter(nextFence);
        writeFence = nextFence;
      }
      this.ctx.storage.sql.exec(
        `UPDATE coordinator_state
         SET clock_id = ?, clock_epoch = ?, clock_now_ms = ?,
             clock_uncertainty_ms = ?, next_fencing_token = ?,
             write_fencing_token = ?
         WHERE singleton = 1`,
        reading.clockId,
        reading.clockEpoch,
        reading.nowMs,
        reading.uncertaintyMs,
        nextFence,
        writeFence,
      );
    });
  }

  async setWitnessForLocalTest(
    witness: FreshnessAntiRollbackWitnessBinding,
  ): Promise<void> {
    assertWitness(witness);
    this.ctx.storage.transactionSync(() => {
      requireStateRow(this.ctx.storage.sql);
      this.ctx.storage.sql.exec(
        `UPDATE coordinator_state
         SET witness_json = ?, restore_epoch = ?
         WHERE singleton = 1`,
        JSON.stringify(witness),
        witness.restoreEpoch,
      );
    });
  }

  async restoreCoordinationStateForLocalTest(
    state: FreshnessIssueCurrentStateBinding,
  ): Promise<void> {
    assertCurrentState(state);
    this.ctx.storage.transactionSync(() => {
      requireStateRow(this.ctx.storage.sql);
      this.ctx.storage.sql.exec(
        `UPDATE coordinator_state
         SET current_state_json = ?, environment = ?
         WHERE singleton = 1`,
        JSON.stringify(state),
        state.environment,
      );
    });
  }

  async beginReleaseForLocalTest(
    writerOperationId: string,
  ): Promise<LocalReleaseStartResult> {
    assertUuid(writerOperationId);
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const row = requireStateRow(sql);
      if (row.writer_pending === 1) {
        if (row.writer_operation_id !== writerOperationId) {
          return { status: "CONFLICT" };
        }
        return {
          status: hasRetainedIssueBlocker(sql) ? "WAITING_FOR_ISSUES" : "READY",
          fencingToken: row.write_fencing_token,
        };
      }
      const fencingToken = incrementCounter(row.next_fencing_token);
      sql.exec(
        `UPDATE coordinator_state
         SET writer_pending = 1, writer_operation_id = ?,
             next_fencing_token = ?, write_fencing_token = ?
         WHERE singleton = 1 AND writer_pending = 0`,
        writerOperationId,
        fencingToken,
        fencingToken,
      );
      return {
        status: hasRetainedIssueBlocker(sql) ? "WAITING_FOR_ISSUES" : "READY",
        fencingToken,
      };
    });
  }

  async completeReleaseForLocalTest(
    writerOperationId: string,
    currentState: FreshnessIssueCurrentStateBinding,
    witness: FreshnessAntiRollbackWitnessBinding,
  ): Promise<"COMMITTED" | "WAITING_FOR_ISSUES"> {
    assertUuid(writerOperationId);
    assertCurrentState(currentState);
    assertWitness(witness);
    if (!sameWitness(currentState.antiRollbackWitness, witness)) {
      throw new Error("Local Release state does not match its witness");
    }
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const row = requireStateRow(sql);
      if (
        row.writer_pending !== 1 ||
        row.writer_operation_id !== writerOperationId
      ) {
        throw new Error("Local Release operation does not own writer-pending");
      }
      if (hasRetainedIssueBlocker(sql)) return "WAITING_FOR_ISSUES";
      const previousState = parseCurrentState(row.current_state_json);
      if (
        currentState.environment !== row.environment ||
        parseCanonicalUnsignedDecimal(
          currentState.generation,
          "Local Release generation",
        ) !==
          parseCanonicalUnsignedDecimal(
            previousState.generation,
            "Current generation",
          ) + 1n ||
        currentState.antiRollbackWitness.restoreEpoch !== row.restore_epoch
      ) {
        throw new Error("Local Release head must advance the current generation by one");
      }
      sql.exec(
        `UPDATE coordinator_state
         SET current_state_json = ?, witness_json = ?, restore_epoch = ?,
             writer_pending = 0, writer_operation_id = NULL
         WHERE singleton = 1 AND writer_pending = 1
           AND writer_operation_id = ?`,
        JSON.stringify(currentState),
        JSON.stringify(witness),
        witness.restoreEpoch,
        writerOperationId,
      );
      return "COMMITTED";
    });
  }

  async setNextFenceForLocalTest(value: string): Promise<void> {
    parseCanonicalUnsignedDecimal(value, "Local test fencing counter", true);
    this.ctx.storage.transactionSync(() => {
      requireStateRow(this.ctx.storage.sql);
      this.ctx.storage.sql.exec(
        "UPDATE coordinator_state SET next_fencing_token = ? WHERE singleton = 1",
        value,
      );
    });
  }

  async inspectOperationForLocalTest(
    operationId: string,
  ): Promise<LocalCoordinatorSnapshot | null> {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const state = requireStateRow(sql);
      const rows = sql
        .exec<OperationRow>(
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
        throw new Error("Local operation ID is not unique");
      }
      const row = rows[0]!;
      const status = issueStatus(row.status);
      const blocker = blockerState(row.blocker);
      const operation = operationFromRow(row);
      const lease = leaseFromRow(row, operation);
      return {
        operation,
        status,
        blocker,
        ...(lease === null ? {} : { lease }),
        signerResultSha256: row.signer_result_sha256,
        signedAtMs: row.signed_at_ms,
        finalizedAt:
          row.finalized_at_json === null
            ? null
            : parseClock(row.finalized_at_json),
        responseBytes:
          row.response_bytes === null
            ? null
            : new Uint8Array(row.response_bytes),
        responseLength: row.response_length,
        responseSha256: row.response_sha256,
        rejectionReason: rejectionReason(row.rejection_reason),
        writerPending: state.writer_pending === 1,
      };
    });
  }

  async inspectStateForLocalTest(): Promise<{
    readonly currentState: FreshnessIssueCurrentStateBinding;
    readonly witness: FreshnessAntiRollbackWitnessBinding;
    readonly clock: FreshnessIssueClockReading;
    readonly writerPending: boolean;
    readonly nextFencingToken: string;
    readonly writeFencingToken: string;
  }> {
    return this.ctx.storage.transactionSync(() => {
      const row = requireStateRow(this.ctx.storage.sql);
      return {
        currentState: parseCurrentState(row.current_state_json),
        witness: parseWitness(row.witness_json),
        clock: {
          clockId: row.clock_id,
          clockEpoch: row.clock_epoch,
          nowMs: row.clock_now_ms,
          uncertaintyMs: row.clock_uncertainty_ms,
        },
        writerPending: row.writer_pending === 1,
        nextFencingToken: row.next_fencing_token,
        writeFencingToken: row.write_fencing_token,
      };
    });
  }

  async attemptBeginOrGetForLocalTest(
    input: FreshnessIssueBeginInput,
  ): Promise<LocalTestCallOutcome<FreshnessIssueBeginResult>> {
    try {
      return {
        status: "RETURNED",
        value: await this.beginOrGet(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptRejectBeforeSignerForLocalTest(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly reason: FreshnessIssueRejectionReason;
  }): Promise<LocalTestCallOutcome<FreshnessIssueMutationReceipt>> {
    try {
      return {
        status: "RETURNED",
        value: await this.rejectBeforeSigner(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptMarkResultUnknownForLocalTest(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
    readonly signerOperationId: string;
  }): Promise<LocalTestCallOutcome<FreshnessIssueMutationReceipt>> {
    try {
      return {
        status: "RETURNED",
        value: await this.markResultUnknown(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }
}

function localTestErrorOutcome(error: unknown): LocalTestCallOutcome<never> {
  return {
    status: "THREW",
    errorName: error instanceof Error ? error.name : "NonErrorThrow",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function assertSeed(seed: LocalCoordinatorSeed): void {
  assertCurrentState(seed.currentState);
  assertWitness(seed.witness);
  assertClock(seed.clock);
  if (
    seed.environment !== "production" ||
    !sameWitness(seed.currentState.antiRollbackWitness, seed.witness)
  ) {
    throw new Error("Local coordinator seed is inconsistent");
  }
}

function assertCurrentState(
  value: unknown,
): asserts value is FreshnessIssueCurrentStateBinding {
  if (!isRecord(value) || !isRecord(value.antiRollbackWitness)) {
    throw new Error("Local current-state binding is invalid");
  }
  for (const field of [
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
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new Error(`Local current-state field ${field} is invalid`);
    }
  }
  const generation = value.generation;
  const pointerGeneration = value.pointerGeneration;
  const manifestEpoch = value.manifestEpoch;
  if (
    value.environment !== "production" ||
    typeof generation !== "string" ||
    typeof pointerGeneration !== "string" ||
    typeof manifestEpoch !== "string"
  ) {
    throw new Error("Local current-state binding is invalid");
  }
  assertWitness(value.antiRollbackWitness);
  const parsedGeneration = parseCanonicalUnsignedDecimal(
    generation,
    "Local current generation",
  );
  const parsedPointerGeneration = parseCanonicalUnsignedDecimal(
    pointerGeneration,
    "Local pointer generation",
  );
  parseCanonicalUnsignedDecimal(manifestEpoch, "Local manifest epoch");
  if (
    parsedGeneration !== parsedPointerGeneration ||
    generation !== value.antiRollbackWitness.generation
  ) {
    throw new Error("Local current-state generation bindings do not match");
  }
}

function assertWitness(
  witness: unknown,
): asserts witness is FreshnessAntiRollbackWitnessBinding {
  if (!isRecord(witness)) throw new Error("Local rollback witness is invalid");
  if (
    typeof witness.sourceId !== "string" ||
    witness.sourceId.length === 0 ||
    typeof witness.restoreEpoch !== "string" ||
    witness.restoreEpoch.length === 0 ||
    typeof witness.generation !== "string" ||
    typeof witness.recordSha256 !== "string"
  ) {
    throw new Error("Local rollback witness is invalid");
  }
  parseCanonicalUnsignedDecimal(witness.generation, "Local witness generation");
}

function assertClock(
  reading: unknown,
): asserts reading is FreshnessIssueClockReading {
  if (!isRecord(reading)) throw new Error("Local clock reading is invalid");
  const { clockId, clockEpoch, nowMs, uncertaintyMs } = reading;
  if (
    typeof clockId !== "string" ||
    clockId.length === 0 ||
    typeof clockEpoch !== "string" ||
    clockEpoch.length === 0 ||
    typeof nowMs !== "number" ||
    !Number.isSafeInteger(nowMs) ||
    typeof uncertaintyMs !== "number" ||
    !Number.isSafeInteger(uncertaintyMs) ||
    uncertaintyMs < 0
  ) {
    throw new Error("Local clock reading is invalid");
  }
}

function assertUuid(value: string): void {
  if (!UUID_V4_PATTERN.test(value)) throw new Error("Invalid Local test UUID");
}

function incrementCounter(value: string): string {
  const next = parseCanonicalUnsignedDecimal(value, "Local fence counter", true) + 1n;
  if (next > UINT64_MAX) throw new Error("Local fence counter exhausted");
  return next.toString();
}

function requireStateRow(sql: SqlStorage): StateRow {
  const rows = sql
    .exec<StateRow>(
      `SELECT environment, current_state_json, witness_json, restore_epoch,
              clock_id, clock_epoch, clock_now_ms, clock_uncertainty_ms,
              next_fencing_token, write_fencing_token, writer_pending,
              writer_operation_id
       FROM coordinator_state WHERE singleton = 1`,
    )
    .toArray();
  if (rows.length !== 1) throw new Error("Local coordinator state is not initialized");
  return rows[0]!;
}

function hasRetainedIssueBlocker(sql: SqlStorage): boolean {
  return sql
    .exec<{ readonly operation_id: string }>(
      `SELECT operation_id FROM freshness_issue_operations
       WHERE blocker = 'RETAINED' LIMIT 1`,
    )
    .toArray().length > 0;
}

function operationFromRow(row: OperationRow): FreshnessIssueOperationBinding {
  if (row.environment !== "production") {
    throw new Error("Local stored operation environment is invalid");
  }
  return {
    operationId: row.operation_id,
    signerOperationId: row.signer_operation_id,
    requestSha256: row.request_sha256,
    requestNonce: row.request_nonce,
    environment: row.environment,
    audienceManifestUrlSha256: row.audience_manifest_url_sha256,
  };
}

function leaseFromRow(
  row: OperationRow,
  operation: FreshnessIssueOperationBinding,
): FreshnessIssueLeaseBinding | null {
  if (row.lease_id === null) {
    if (
      row.fencing_token !== null ||
      row.acquired_at_ms !== null ||
      row.expires_at_ms !== null ||
      row.clock_id !== null ||
      row.clock_epoch !== null ||
      row.clock_uncertainty_ms !== null ||
      row.current_state_json !== null
    ) {
      throw new Error("Local stored lease fields are incomplete");
    }
    return null;
  }
  if (
    row.fencing_token === null ||
    row.acquired_at_ms === null ||
    row.expires_at_ms === null ||
    row.clock_id === null ||
    row.clock_epoch === null ||
    row.clock_uncertainty_ms === null ||
    row.current_state_json === null
  ) {
    throw new Error("Local stored lease fields are incomplete");
  }
  return {
    operation,
    leaseId: row.lease_id,
    fencingToken: row.fencing_token,
    acquiredAtMs: row.acquired_at_ms,
    expiresAtMs: row.expires_at_ms,
    clockId: row.clock_id,
    clockEpoch: row.clock_epoch,
    clockUncertaintyMs: row.clock_uncertainty_ms,
    currentState: parseCurrentState(row.current_state_json),
  };
}

function parseCurrentState(value: string): FreshnessIssueCurrentStateBinding {
  const parsed: unknown = JSON.parse(value);
  assertCurrentState(parsed);
  return parsed;
}

function parseWitness(value: string): FreshnessAntiRollbackWitnessBinding {
  const parsed: unknown = JSON.parse(value);
  assertWitness(parsed);
  return parsed;
}

function parseClock(value: string): FreshnessIssueClockReading {
  const parsed: unknown = JSON.parse(value);
  assertClock(parsed);
  return parsed;
}

function issueStatus(value: string): IssueStatus {
  switch (value) {
    case "IN_PROGRESS":
    case "RESULT_UNKNOWN":
    case "FINALIZED":
    case "REJECTED":
      return value;
    default:
      throw new Error(`Unknown Local issue status: ${value}`);
  }
}

function blockerState(value: string): BlockerState {
  switch (value) {
    case "RETAINED":
    case "CLEARED":
      return value;
    default:
      throw new Error(`Unknown Local blocker state: ${value}`);
  }
}

function rejectionReason(value: string | null): RejectionReason | null {
  switch (value) {
    case null:
      return null;
    case "LEASE_NOT_ACTIVE":
    case "CURRENT_STATE_UNAVAILABLE":
    case "CURRENT_STATE_MISMATCH":
    case "SIGNER_RESPONSE_INVALID":
    case "FINALIZATION_REJECTED":
      return value;
    default:
      throw new Error(`Unknown Local rejection reason: ${value}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
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
