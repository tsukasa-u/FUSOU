import {
  parseCanonicalUnsignedDecimal,
} from "../../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import {
  SqliteFreshnessIssueCoordinatorDO,
} from "../../src/sqlite-freshness-issue-coordinator.ts";
import type { CoordinatorEnv } from "../../src/sqlite-freshness-issue-coordinator.ts";
import {
  RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
  RuntimeConfigR2ReleaseStore,
} from "../../src/r2-release-store.ts";
import type {
  ReleaseLedgerActionResult,
  ReleaseLedgerHead,
  ReleaseLedgerOperation,
} from "../../src/release-ledger.ts";
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

export interface LocalReleaseLedgerSeed {
  readonly operationId: string;
  readonly requestSha256: string;
  readonly chainId: string;
  readonly head: ReleaseLedgerHead;
}

export interface LocalInitialReleaseCheckpointSeed extends LocalReleaseLedgerSeed {
  readonly restoreEpoch: string;
  readonly clock: FreshnessIssueClockReading;
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

  async bootstrapReleaseLedgerForLocalTest(
    seed: LocalReleaseLedgerSeed,
    initialCheckpoint?: Pick<
      LocalInitialReleaseCheckpointSeed,
      "restoreEpoch" | "clock"
    >,
  ): Promise<void> {
    const head = seed.head;
    assertUuid(seed.operationId);
    if (
      !/^[A-Za-z0-9_-]{43}$/u.test(seed.requestSha256) ||
      seed.chainId.length === 0 ||
      head.environment !== "production" ||
      head.chainId !== seed.chainId ||
      head.position !== head.generation ||
      head.previousRecordSha256 !== null ||
      head.recordBytes.byteLength === 0 ||
      head.releaseDelegationBytes.byteLength === 0 ||
      head.manifestBytes.byteLength === 0 ||
      head.pointerEtag.length === 0 ||
      head.manifestRef.length === 0 ||
      (initialCheckpoint !== undefined &&
        (head.position !== "1" ||
          head.generation !== "1" ||
          head.previousRecordSha256 !== null ||
          initialCheckpoint.restoreEpoch.length === 0))
    ) {
      throw new Error("Local Release ledger baseline is invalid");
    }

    this.ctx.storage.transactionSync(() => {
      const stateRows = this.ctx.storage.sql
        .exec<{ readonly singleton: number }>(
          "SELECT singleton FROM coordinator_state WHERE singleton = 1",
        )
        .toArray();
      if (initialCheckpoint === undefined) {
        const state = requireStateRow(this.ctx.storage.sql);
        const currentState = parseCurrentState(state.current_state_json);
        if (
          currentState.generation !== head.generation ||
          currentState.journalHeadSha256 !== head.recordSha256 ||
          currentState.releaseCommitRecordSha256 !== head.recordSha256 ||
          currentState.releaseCommitId !== head.releaseCommitId ||
          currentState.manifestEpoch !== head.manifestEpoch ||
          currentState.manifestSha256 !== head.manifestSha256 ||
          currentState.manifestRef !== head.manifestRef ||
          currentState.pointerEtag !== head.pointerEtag
        ) {
          throw new Error(
            "Local Release ledger baseline differs from its test current-state binding",
          );
        }
      } else if (stateRows.length !== 0) {
        throw new Error(
          "Initial Release checkpoint must not seed current-state binding",
        );
      }
      const existing = this.ctx.storage.sql
        .exec<{ readonly count: number }>(
          `SELECT
             (SELECT COUNT(*) FROM release_ledger_operations) +
             (SELECT COUNT(*) FROM release_ledger_entries) +
             (SELECT COUNT(*) FROM release_ledger_head) AS count`,
        )
        .toArray();
      if (existing.length !== 1 || existing[0]!.count !== 0) {
        throw new Error("Local Release ledger is already initialized");
      }

      const bytes = (value: Uint8Array) => {
        const buffer = new ArrayBuffer(value.byteLength);
        new Uint8Array(buffer).set(value);
        return buffer;
      };
      this.ctx.storage.sql.exec(
        `INSERT INTO release_ledger_operations (
           operation_id, request_sha256, environment, chain_id, status,
           reason, unknown_stage, resume_status, fencing_token,
           expected_position, expected_generation, expected_record_sha256,
           expected_pointer_etag, manifest_bytes, manifest_length,
           manifest_sha256, manifest_epoch, manifest_ref, pointer_bytes,
           pointer_etag, snapshot_bytes, record_bytes, record_length,
           record_sha256, record_appended_at, release_delegation_bytes,
           position, generation, previous_record_sha256, release_commit_id
         ) VALUES (?, ?, 'production', ?, 'AVAILABLE', NULL, NULL, NULL,
                   ?, NULL, NULL, NULL, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, NULL, ?)`,
        seed.operationId,
        seed.requestSha256,
        seed.chainId,
        initialCheckpoint === undefined ? null : "1",
        bytes(head.manifestBytes),
        head.manifestBytes.byteLength,
        head.manifestSha256,
        head.manifestEpoch,
        head.manifestRef,
        bytes(head.manifestBytes),
        head.pointerEtag,
        bytes(head.manifestBytes),
        bytes(head.recordBytes),
        head.recordBytes.byteLength,
        head.recordSha256,
        head.localAppendObservedAt,
        bytes(head.releaseDelegationBytes),
        head.position,
        head.generation,
        head.releaseCommitId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO release_ledger_entries (
           position, environment, chain_id, operation_id, generation,
           record_sha256, record_appended_at, record_bytes, record_length,
           release_delegation_bytes, previous_record_sha256,
           release_commit_id, manifest_epoch, manifest_sha256, manifest_ref,
           pointer_etag, manifest_bytes, pointer_bytes, snapshot_bytes
         ) VALUES (?, 'production', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?,
                   ?, ?, ?, ?, ?)`,
        head.position,
        seed.chainId,
        seed.operationId,
        head.generation,
        head.recordSha256,
        head.localAppendObservedAt,
        bytes(head.recordBytes),
        head.recordBytes.byteLength,
        bytes(head.releaseDelegationBytes),
        head.releaseCommitId,
        head.manifestEpoch,
        head.manifestSha256,
        head.manifestRef,
        head.pointerEtag,
        bytes(head.manifestBytes),
        bytes(head.manifestBytes),
        bytes(head.manifestBytes),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO release_ledger_head (
           singleton, environment, chain_id, position, generation,
           record_sha256, previous_record_sha256, release_commit_id,
           manifest_epoch, manifest_sha256, manifest_ref, pointer_etag
         ) VALUES (1, 'production', ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        seed.chainId,
        head.position,
        head.generation,
        head.recordSha256,
        head.releaseCommitId,
        head.manifestEpoch,
        head.manifestSha256,
        head.manifestRef,
        head.pointerEtag,
      );
      if (initialCheckpoint !== undefined) {
        assertClock(initialCheckpoint.clock);
        this.ctx.storage.sql.exec(
          `INSERT INTO current_state_bootstrap_authorizations (
             singleton, operation_id, chain_id, position, generation,
             record_sha256, restore_epoch, clock_id, clock_epoch,
             clock_now_ms, clock_uncertainty_ms
           ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          seed.operationId,
          seed.chainId,
          head.position,
          head.generation,
          head.recordSha256,
          initialCheckpoint.restoreEpoch,
          initialCheckpoint.clock.clockId,
          initialCheckpoint.clock.clockEpoch,
          initialCheckpoint.clock.nowMs,
          initialCheckpoint.clock.uncertaintyMs,
        );
      }
    });

    const observed = await this.readReleaseLedgerHead();
    if (
      observed === null ||
      observed.recordSha256 !== head.recordSha256 ||
      !equalBytes(observed.recordBytes, head.recordBytes) ||
      !equalBytes(observed.manifestBytes, head.manifestBytes)
    ) {
      throw new Error("Local Release ledger baseline failed source verification");
    }
  }

  async bootstrapInitialReleaseCheckpointForLocalTest(
    seed: LocalInitialReleaseCheckpointSeed,
  ): Promise<void> {
    await this.bootstrapReleaseLedgerForLocalTest(seed, {
      restoreEpoch: seed.restoreEpoch,
      clock: seed.clock,
    });
  }

  deleteReleaseLedgerHeadForLocalTest(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM release_ledger_head WHERE singleton = 1");
    });
  }

  corruptReleaseOperationBindingForLocalTest(
    operationId: string,
    binding: "MANIFEST_DIGEST" | "MANIFEST_REFERENCE",
  ): void {
    assertUuid(operationId);
    this.ctx.storage.transactionSync(() => {
      const field = binding === "MANIFEST_DIGEST"
        ? "manifest_sha256"
        : "manifest_ref";
      const value = binding === "MANIFEST_DIGEST"
        ? "A".repeat(43)
        : "tlsn/runtime-config/v2/manifests/corrupt";
      const result = this.ctx.storage.sql.exec(
        `UPDATE release_ledger_operations SET ${field} = ?
         WHERE operation_id = ?`,
        value,
        operationId,
      );
      if (result.rowsWritten !== 1) {
        throw new Error("Local Release operation corruption target is missing");
      }
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

  deleteCoordinatorStateForLocalTest(): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "DELETE FROM coordinator_state WHERE singleton = 1",
      );
    });
  }

  corruptCoordinatorStateForLocalTest(): void {
    this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec(
        `UPDATE coordinator_state SET current_state_json = ?
         WHERE singleton = 1`,
        "{",
      );
      if (result.rowsWritten !== 1) {
        throw new Error("Local coordinator corruption target is missing");
      }
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

type R2FaultMode =
  | "NONE"
  | "DELAY_POINTER_WRITE"
  | "FAIL_NEXT_READBACK"
  | "WRONG_POINTER_ETAG";

interface LocalR2FaultState {
  mode: R2FaultMode;
  remainingReadFailures: number;
  loseNextAppendResponse: boolean;
  startedPromise: Promise<void> | null;
  signalStarted: (() => void) | null;
  releasePromise: Promise<void> | null;
  releaseWrite: (() => void) | null;
}

export class LocalTestReleaseLedgerCoordinatorDO
  extends LocalTestFreshnessIssueCoordinatorDO
{
  readonly #fault: LocalR2FaultState;
  readonly #releaseBucket: R2Bucket;

  constructor(ctx: DurableObjectState, env: CoordinatorEnv) {
    const fault: LocalR2FaultState = {
      mode: "NONE",
      remainingReadFailures: 0,
      loseNextAppendResponse: false,
      startedPromise: null,
      signalStarted: null,
      releasePromise: null,
      releaseWrite: null,
    };
    const bucket = env.RELEASE_LEDGER_R2;
    if (bucket === undefined) {
      throw new Error("Local Release test Worker requires its R2 binding");
    }
    const faultingBucket = new Proxy(bucket, {
      get(target, property) {
        if (property === "put") {
          return async (...args: Parameters<R2Bucket["put"]>) => {
            const [key] = args;
            if (
              key === RUNTIME_CONFIG_MANIFEST_POINTER_KEY &&
              fault.mode === "DELAY_POINTER_WRITE"
            ) {
              fault.mode = "NONE";
              fault.signalStarted?.();
              await fault.releasePromise;
              await Reflect.apply(target.put, target, args);
              throw new Error(
                "Local test simulated lost R2 pointer-write response",
              );
            }
            return Reflect.apply(target.put, target, args);
          };
        }
        if (property === "get") {
          return async (...args: Parameters<R2Bucket["get"]>) => {
            if (fault.mode === "FAIL_NEXT_READBACK") {
              fault.remainingReadFailures -= 1;
              if (fault.remainingReadFailures === 0) {
                fault.mode = "NONE";
              }
              throw new Error("Local test simulated R2 readback failure");
            }
            const object = await Reflect.apply(target.get, target, args);
            if (
              object !== null &&
              fault.mode === "WRONG_POINTER_ETAG" &&
              args[0] === RUNTIME_CONFIG_MANIFEST_POINTER_KEY
            ) {
              fault.mode = "NONE";
              return new Proxy(object, {
                get(targetObject, key) {
                  if (key === "etag") return `${targetObject.etag}-mismatch`;
                  const value = Reflect.get(targetObject, key, targetObject);
                  return typeof value === "function"
                    ? value.bind(targetObject)
                    : value;
                },
              });
            }
            return object;
          };
        }
        if (property === "delete") {
          return (...args: Parameters<R2Bucket["delete"]>) =>
            Reflect.apply(target.delete, target, args);
        }
        return Reflect.get(target, property, target);
      },
    });
    super(ctx, { ...env, RELEASE_LEDGER_R2: faultingBucket });
    this.#fault = fault;
    this.#releaseBucket = faultingBucket;
  }

  publishBaselineManifestForLocalTest(
    manifestRef: string,
    manifestBytes: Uint8Array,
  ): Promise<{
    readonly pointerBytes: Uint8Array;
    readonly pointerEtag: string;
    readonly snapshotBytes: Uint8Array;
  }> {
    return new RuntimeConfigR2ReleaseStore(this.#releaseBucket).publishManifest(
      manifestRef,
      manifestBytes,
      "",
    );
  }

  async clearReleasePointerForLocalTest(): Promise<void> {
    const deleteCall = this.#releaseBucket.delete(
      RUNTIME_CONFIG_MANIFEST_POINTER_KEY,
    );
    try {
      await deleteCall;
    } finally {
      disposeLocalRpcResult(deleteCall);
    }
  }

  async attemptClearReleasePointerForLocalTest(): Promise<
    LocalTestCallOutcome<null>
  > {
    try {
      await this.clearReleasePointerForLocalTest();
      return { status: "RETURNED", value: null };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async writeReleaseObjectForLocalTest(
    key: string,
    bytes: Uint8Array,
  ): Promise<void> {
    if (
      key !== RUNTIME_CONFIG_MANIFEST_POINTER_KEY &&
      !key.startsWith("tlsn/runtime-config/v2/manifests/")
    ) {
      throw new Error("Local test R2 mutation is outside the Release namespace");
    }
    const putCall = this.#releaseBucket.put(key, bytes);
    let putResult: R2Object | null = null;
    try {
      putResult = await putCall;
    } finally {
      disposeLocalRpcResult(putResult);
      disposeLocalRpcResult(putCall);
    }
  }

  override async appendReleaseRecord(
    input: Parameters<
      SqliteFreshnessIssueCoordinatorDO["appendReleaseRecord"]
    >[0],
  ) {
    const result = await super.appendReleaseRecord(input);
    if (
      this.#fault.loseNextAppendResponse &&
      result.status === "LEDGER_COMMITTED"
    ) {
      this.#fault.loseNextAppendResponse = false;
      throw new Error("Local test simulated lost Release append response");
    }
    return result;
  }

  loseNextAppendResponseForLocalTest(): void {
    if (this.#fault.loseNextAppendResponse) {
      throw new Error("A lost append response is already armed");
    }
    this.#fault.loseNextAppendResponse = true;
  }

  async attemptBeginReleaseOperationForLocalTest(
    input: Parameters<
      SqliteFreshnessIssueCoordinatorDO["beginReleaseOperation"]
    >[0],
  ): Promise<LocalTestCallOutcome<ReleaseLedgerActionResult>> {
    try {
      return {
        status: "RETURNED",
        value: await this.beginReleaseOperation(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptStageReleaseManifestForLocalTest(
    input: Parameters<
      SqliteFreshnessIssueCoordinatorDO["stageReleaseManifest"]
    >[0],
  ): Promise<LocalTestCallOutcome<ReleaseLedgerActionResult>> {
    try {
      return {
        status: "RETURNED",
        value: await this.stageReleaseManifest(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptAppendReleaseRecordForLocalTest(
    input: Parameters<
      SqliteFreshnessIssueCoordinatorDO["appendReleaseRecord"]
    >[0],
  ): Promise<LocalTestCallOutcome<ReleaseLedgerActionResult>> {
    try {
      return {
        status: "RETURNED",
        value: await this.appendReleaseRecord(input),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptReadReleaseLedgerHeadForLocalTest(): Promise<
    LocalTestCallOutcome<ReleaseLedgerHead | null>
  > {
    try {
      return {
        status: "RETURNED",
        value: await this.readReleaseLedgerHead(),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  async attemptGetReleaseOperationForLocalTest(
    operationId: string,
  ): Promise<LocalTestCallOutcome<ReleaseLedgerOperation | null>> {
    try {
      return {
        status: "RETURNED",
        value: await this.getReleaseOperation(operationId),
      };
    } catch (error) {
      return localTestErrorOutcome(error);
    }
  }

  armDelayedPointerWriteForLocalTest(): void {
    if (this.#fault.mode !== "NONE") {
      throw new Error("An R2 fault is already armed");
    }
    this.#fault.mode = "DELAY_POINTER_WRITE";
    this.#fault.startedPromise = new Promise((resolve) => {
      this.#fault.signalStarted = resolve;
    });
    this.#fault.releasePromise = new Promise((resolve) => {
      this.#fault.releaseWrite = resolve;
    });
  }

  waitForDelayedPointerWriteForLocalTest(): Promise<void> {
    if (this.#fault.startedPromise === null) {
      throw new Error("No delayed R2 pointer write has been armed");
    }
    return this.#fault.startedPromise;
  }

  releaseDelayedPointerWriteForLocalTest(): void {
    if (this.#fault.releaseWrite === null) {
      throw new Error("No delayed R2 pointer write is waiting");
    }
    this.#fault.releaseWrite();
    this.#fault.releaseWrite = null;
    this.#fault.releasePromise = null;
  }

  failNextR2ReadbackForLocalTest(): void {
    if (this.#fault.mode !== "NONE") {
      throw new Error("An R2 fault is already armed");
    }
    this.#fault.mode = "FAIL_NEXT_READBACK";
    this.#fault.remainingReadFailures = 2;
  }

  mismatchNextPointerEtagForLocalTest(): void {
    if (this.#fault.mode !== "NONE") {
      throw new Error("An R2 fault is already armed");
    }
    this.#fault.mode = "WRONG_POINTER_ETAG";
  }
}

function localTestErrorOutcome(error: unknown): LocalTestCallOutcome<never> {
  return {
    status: "THREW",
    errorName: error instanceof Error ? error.name : "NonErrorThrow",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

function disposeLocalRpcResult(value: object | null | undefined): void {
  if (value == null) return;
  const dispose = Reflect.get(value, Symbol.for("dispose"));
  if (typeof dispose === "function") {
    Reflect.apply(dispose, value, []);
  }
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
