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
  runtimeConfigManifestAudienceSha256,
  RuntimeConfigDomainError,
  verifyRuntimeConfigManifestEpochPointer,
  verifyRuntimeConfigFreshnessRequest,
  verifyRuntimeConfigFreshnessResponse,
  verifyRuntimeConfigReleaseCommitRecord,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import {
  createCloudflareOperatorCurrentStateBinding,
  createCloudflareOperatorReleaseStateReader,
  verifyCloudflareOperatorFreshnessResponse,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-cloudflare-operator.ts";
import {
  CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";
import {
  createFreshnessIssueCurrentStateBindingFromReleaseState,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/freshness-issue.ts";
import type { RuntimeConfigRootSigner } from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/domain.ts";
import type {
  FreshnessAntiRollbackWitnessBinding,
  FreshnessCurrentStateInstallProofContext,
  FreshnessIssueCoordinatorSnapshot,
  FreshnessIssueCurrentStateBinding,
  FreshnessIssueLeaseBinding,
  FreshnessIssueOperationBinding,
  CloudflareOperatorCurrentStateBinding,
  CloudflareOperatorBindingInstallAction,
  CloudflareOperatorBindingInstallOperation,
  CloudflareOperatorIssueAdmission,
  CloudflareOperatorIssueOperationBinding,
  CloudflareOperatorIssueSigningAuthorization,
  CloudflareOperatorIssueSigningClaim,
  CloudflareOperatorReleaseLedgerSnapshot,
  VerifiedFreshnessReleaseState,
} from "../../FUSOU-TLSN-RUNTIME-CONFIG-DOMAIN/src/signers.ts";
import {
  RuntimeConfigR2ReleaseConflictError,
  RuntimeConfigR2ReleaseIntegrityError,
  RuntimeConfigR2ReleaseStore,
} from "./r2-release-store.ts";
import type {
  CloudflareOperatorGenesisOperation,
  ReleaseBindingInstallActionResult,
  ReleaseBindingInstallOperation,
  ReleaseLedgerActionResult,
  ReleaseLedgerHead,
  ReleaseLedgerOperation,
  ReleaseLedgerStatus,
} from "./release-ledger.ts";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const GENESIS_COORDINATOR_ID_PATTERN = /^[a-f0-9]{64}$/u;
const GENESIS_CHAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const GENESIS_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const GENESIS_MAX_RECORD_BYTES = 262_144;
const GENESIS_MAX_DELEGATION_BYTES = 8_192;
const GENESIS_MAX_MANIFEST_BYTES = 1_048_576;
const GENESIS_ADMIN_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const GENESIS_OPERATION_ID_DOMAIN =
  "FUSOU-TLSN-CLOUDFLARE-OPERATOR-GENESIS-OPERATION-ID-V1\0";
const GENESIS_APPROVAL_FIELDS = [
  "audience_manifest_url_sha256",
  "chain_id",
  "coordinator_id",
  "coordinator_name",
  "environment",
  "initial_generation",
  "initial_position",
  "manifest_epoch",
  "manifest_ref",
  "manifest_root_key_id",
  "manifest_root_public_key_spki",
  "manifest_sha256",
  "manifest_url",
  "profile_id",
  "release_delegation_sha256",
  "release_record_manifest_schema_version",
  "release_record_sha256",
  "release_root_key_id",
  "release_root_public_key_spki",
  "restore_epoch",
  "schema_version",
  "scope",
] as const;
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
    | "RELEASE_BLOCKED"
    | "PROFILE_MISMATCH"
    | "INVALID_TIME"
    | "MISSING_ADAPTER";

  constructor(
    code: FreshnessIssueCoordinatorStorageError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FreshnessIssueCoordinatorStorageError";
    this.code = code;
  }
}

export interface CoordinatorEnv {
  readonly RELEASE_LEDGER_CHAIN_ID?: string;
  readonly RELEASE_LEDGER_ROOT_KEY_ID?: string;
  readonly RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI?: string;
  readonly RELEASE_LEDGER_MANIFEST_KEY_ID?: string;
  readonly RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI?: string;
  readonly RELEASE_LEDGER_R2?: R2Bucket;
  readonly FRESHNESS_MANIFEST_URL?: string;
  readonly FRESHNESS_COORDINATOR_NAME?: string;
  readonly FRESHNESS_GENESIS_APPROVAL_JSON?: string;
  readonly FRESHNESS_GENESIS_ADMIN_CAPABILITY?: string;
}

interface CloudflareOperatorGenesisApproval {
  readonly schema_version: 1;
  readonly scope: "fusou-cloudflare-operator-genesis-v1";
  readonly environment: "production";
  readonly profile_id: typeof CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID;
  readonly coordinator_name: string;
  readonly coordinator_id: string;
  readonly chain_id: string;
  readonly restore_epoch: string;
  readonly initial_position: "1";
  readonly initial_generation: "1";
  readonly release_record_sha256: string;
  readonly release_delegation_sha256: string;
  readonly release_record_manifest_schema_version: 2;
  readonly manifest_epoch: string;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly manifest_url: string;
  readonly audience_manifest_url_sha256: string;
  readonly release_root_key_id: string;
  readonly release_root_public_key_spki: string;
  readonly manifest_root_key_id: string;
  readonly manifest_root_public_key_spki: string;
}

interface CloudflareOperatorGenesisRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly request_sha256: string;
  readonly approval_sha256: string;
  readonly record_bytes: ArrayBuffer;
  readonly release_delegation_bytes: ArrayBuffer;
  readonly manifest_bytes: ArrayBuffer;
  readonly restore_epoch: string;
  readonly status: string;
  readonly reason: string | null;
  readonly created_at_ms: number;
}

interface CloudflareOperatorGenesisInput {
  readonly recordBytes: Uint8Array;
  readonly releaseDelegationBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
}

interface PreparedCloudflareOperatorGenesis {
  readonly approval: CloudflareOperatorGenesisApproval;
  readonly approvalSha256: string;
  readonly operationId: string;
  readonly requestSha256: string;
  readonly input: CloudflareOperatorGenesisInput;
}

interface VerifiedCloudflareOperatorGenesis {
  readonly manifest: Awaited<
    ReturnType<typeof verifyRuntimeConfigManifestEpochPointer>
  >;
  readonly record: Awaited<
    ReturnType<typeof verifyRuntimeConfigReleaseCommitRecord>
  >;
  readonly pointerEtag: string;
}

interface CloudflareOperatorProfileRow {
  readonly [column: string]: string | number | null;
  readonly profile_id: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly current_state_json: string | null;
  readonly local_restore_epoch: string;
  readonly last_observed_utc_ms: number;
  readonly next_fencing_token: string;
  readonly write_fencing_token: string;
  readonly writer_pending: number;
  readonly writer_operation_id: string | null;
}

interface CloudflareOperatorInstallRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly request_sha256: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly mode: string;
  readonly status: string;
  readonly reason: string | null;
  readonly release_operation_id: string;
  readonly release_fencing_token: string;
  readonly install_fencing_token: string;
  readonly expected_current_state_sha256: string | null;
  readonly expected_restore_epoch: string;
  readonly target_position: string;
  readonly target_generation: string;
  readonly target_record_sha256: string;
  readonly installed_state_json: string | null;
}

interface CloudflareOperatorIssueRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly profile_id: string;
  readonly signer_operation_id: string;
  readonly request_bytes: ArrayBuffer;
  readonly request_sha256: string;
  readonly request_nonce: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly audience_manifest_url_sha256: string;
  readonly status: string;
  readonly blocker: string;
  readonly fencing_token: string;
  readonly signing_claimed: number;
  readonly current_state_json: string;
  readonly response_bytes: ArrayBuffer | null;
  readonly response_length: number | null;
  readonly response_sha256: string | null;
  readonly rejection_reason: string | null;
}

interface PreparedCloudflareOperatorIssueSigningAuthorization {
  readonly authorization: CloudflareOperatorIssueSigningAuthorization;
  readonly requestSha256: string;
  readonly audienceManifestUrlSha256: string;
  readonly challenge: Awaited<
    ReturnType<typeof verifyRuntimeConfigFreshnessRequest>
  >;
}

interface ReleaseLedgerOperationRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly request_sha256: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly status: string;
  readonly reason: string | null;
  readonly unknown_stage: string | null;
  readonly resume_status: string | null;
  readonly fencing_token: string | null;
  readonly expected_position: string | null;
  readonly expected_generation: string | null;
  readonly expected_record_sha256: string | null;
  readonly expected_pointer_etag: string;
  readonly manifest_bytes: ArrayBuffer;
  readonly manifest_length: number;
  readonly manifest_sha256: string;
  readonly manifest_epoch: string;
  readonly manifest_ref: string;
  readonly pointer_bytes: ArrayBuffer | null;
  readonly pointer_etag: string | null;
  readonly snapshot_bytes: ArrayBuffer | null;
  readonly record_bytes: ArrayBuffer | null;
  readonly record_length: number | null;
  readonly record_sha256: string | null;
  readonly record_appended_at: string | null;
  readonly release_delegation_bytes: ArrayBuffer | null;
  readonly position: string | null;
  readonly generation: string | null;
  readonly previous_record_sha256: string | null;
  readonly release_commit_id: string | null;
}

interface ReleaseLedgerHeadRow {
  readonly [column: string]: string | number | ArrayBuffer | null;
  readonly operation_id: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly position: string;
  readonly generation: string;
  readonly record_sha256: string;
  readonly record_appended_at: string;
  readonly record_bytes: ArrayBuffer;
  readonly record_length: number;
  readonly release_delegation_bytes: ArrayBuffer;
  readonly previous_record_sha256: string | null;
  readonly release_commit_id: string;
  readonly manifest_epoch: string;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly pointer_etag: string;
  readonly manifest_bytes: ArrayBuffer;
  readonly pointer_bytes: ArrayBuffer;
  readonly snapshot_bytes: ArrayBuffer;
}

interface ReleaseLedgerHeadMetadataRow {
  readonly [column: string]: string | null;
  readonly environment: string;
  readonly chain_id: string;
  readonly position: string;
  readonly generation: string;
  readonly record_sha256: string;
  readonly previous_record_sha256: string | null;
  readonly release_commit_id: string;
  readonly manifest_epoch: string;
  readonly manifest_sha256: string;
  readonly manifest_ref: string;
  readonly pointer_etag: string;
}

interface ReleaseBindingInstallRow {
  readonly [column: string]: string | ArrayBuffer | null;
  readonly operation_id: string;
  readonly request_sha256: string;
  readonly environment: string;
  readonly chain_id: string;
  readonly mode: string;
  readonly status: string;
  readonly reason: string | null;
  readonly release_operation_id: string;
  readonly release_fencing_token: string;
  readonly install_fencing_token: string;
  readonly expected_current_state_sha256: string | null;
  readonly expected_restore_epoch: string;
  readonly target_position: string;
  readonly target_generation: string;
  readonly target_record_sha256: string;
  readonly proof_context_sha256: string | null;
  readonly installed_state_json: string | null;
}

interface CurrentStateBootstrapAuthorizationRow {
  readonly [column: string]: string | number;
  readonly operation_id: string;
  readonly chain_id: string;
  readonly position: string;
  readonly generation: string;
  readonly record_sha256: string;
  readonly restore_epoch: string;
  readonly clock_id: string;
  readonly clock_epoch: string;
  readonly clock_now_ms: number;
  readonly clock_uncertainty_ms: number;
}

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
  readonly #env: CoordinatorEnv;

  constructor(ctx: DurableObjectState, env: CoordinatorEnv) {
    super(ctx, env);
    this.#env = env;
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
        CREATE TABLE IF NOT EXISTS release_ledger_operations (
          operation_id TEXT PRIMARY KEY,
          request_sha256 TEXT NOT NULL,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN (
              'INTENT', 'R2_WRITE_PENDING', 'R2_STAGED',
              'LEDGER_COMMITTED', 'R2_READBACK_PENDING', 'AVAILABLE',
              'RESULT_UNKNOWN', 'QUARANTINED', 'CONFLICT'
            )
          ),
          reason TEXT,
          unknown_stage TEXT CHECK (
            unknown_stage IS NULL OR unknown_stage IN
              ('R2_WRITE', 'RELEASE_SIGNER', 'R2_READBACK')
          ),
          resume_status TEXT,
          fencing_token TEXT,
          expected_position TEXT,
          expected_generation TEXT,
          expected_record_sha256 TEXT,
          expected_pointer_etag TEXT NOT NULL,
          manifest_bytes BLOB NOT NULL,
          manifest_length INTEGER NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          manifest_epoch TEXT NOT NULL,
          manifest_ref TEXT NOT NULL,
          pointer_bytes BLOB,
          pointer_etag TEXT,
          snapshot_bytes BLOB,
          record_bytes BLOB,
          record_length INTEGER,
          record_sha256 TEXT,
          record_appended_at TEXT,
          release_delegation_bytes BLOB,
          position TEXT,
          generation TEXT,
          previous_record_sha256 TEXT,
          release_commit_id TEXT
        );
        CREATE TABLE IF NOT EXISTS release_ledger_entries (
          position TEXT PRIMARY KEY,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          operation_id TEXT NOT NULL UNIQUE,
          generation TEXT NOT NULL UNIQUE,
          record_sha256 TEXT NOT NULL UNIQUE,
          record_appended_at TEXT NOT NULL,
          record_bytes BLOB NOT NULL,
          record_length INTEGER NOT NULL,
          release_delegation_bytes BLOB NOT NULL,
          previous_record_sha256 TEXT,
          release_commit_id TEXT NOT NULL,
          manifest_epoch TEXT NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          manifest_ref TEXT NOT NULL,
          pointer_etag TEXT NOT NULL,
          manifest_bytes BLOB NOT NULL,
          pointer_bytes BLOB NOT NULL,
          snapshot_bytes BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS release_ledger_head (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          position TEXT NOT NULL,
          generation TEXT NOT NULL,
          record_sha256 TEXT NOT NULL,
          previous_record_sha256 TEXT,
          release_commit_id TEXT NOT NULL,
          manifest_epoch TEXT NOT NULL,
          manifest_sha256 TEXT NOT NULL,
          manifest_ref TEXT NOT NULL,
          pointer_etag TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS current_state_binding_installs (
          operation_id TEXT PRIMARY KEY,
          request_sha256 TEXT NOT NULL,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('BOOTSTRAP', 'ADVANCE')),
          status TEXT NOT NULL CHECK (
            status IN ('VERIFYING', 'INSTALLED', 'QUARANTINED', 'CONFLICT')
          ),
          reason TEXT,
          release_operation_id TEXT NOT NULL,
          release_fencing_token TEXT NOT NULL,
          install_fencing_token TEXT NOT NULL,
          expected_current_state_sha256 TEXT,
          expected_restore_epoch TEXT NOT NULL,
          target_position TEXT NOT NULL,
          target_generation TEXT NOT NULL,
          target_record_sha256 TEXT NOT NULL,
          proof_context_sha256 TEXT,
          installed_state_json TEXT
        );
        CREATE INDEX IF NOT EXISTS current_state_binding_install_status
          ON current_state_binding_installs(status);
        CREATE TABLE IF NOT EXISTS current_state_binding_install_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          next_fencing_token TEXT NOT NULL
        );
        INSERT OR IGNORE INTO current_state_binding_install_meta
          (singleton, next_fencing_token) VALUES (1, '0');
        CREATE TABLE IF NOT EXISTS current_state_bootstrap_authorizations (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          operation_id TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          position TEXT NOT NULL,
          generation TEXT NOT NULL,
          record_sha256 TEXT NOT NULL,
          restore_epoch TEXT NOT NULL,
          clock_id TEXT NOT NULL,
          clock_epoch TEXT NOT NULL,
          clock_now_ms INTEGER NOT NULL,
          clock_uncertainty_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS freshness_profile (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          profile_id TEXT NOT NULL,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          current_state_json TEXT,
          local_restore_epoch TEXT NOT NULL,
          last_observed_utc_ms INTEGER NOT NULL,
          next_fencing_token TEXT NOT NULL,
          write_fencing_token TEXT NOT NULL,
          writer_pending INTEGER NOT NULL CHECK (writer_pending IN (0, 1)),
          writer_operation_id TEXT
        );
        CREATE TABLE IF NOT EXISTS cloudflare_operator_bootstrap_authorizations (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          operation_id TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          position TEXT NOT NULL,
          generation TEXT NOT NULL,
          record_sha256 TEXT NOT NULL,
          restore_epoch TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloudflare_operator_genesis_operations (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          operation_id TEXT NOT NULL UNIQUE,
          request_sha256 TEXT NOT NULL,
          approval_sha256 TEXT NOT NULL,
          record_bytes BLOB NOT NULL,
          release_delegation_bytes BLOB NOT NULL,
          manifest_bytes BLOB NOT NULL,
          restore_epoch TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN (
              'ADMITTED', 'LEDGER_COMMITTED', 'R2_READBACK_PENDING',
              'RESULT_UNKNOWN', 'AVAILABLE', 'INSTALLING', 'INSTALLED',
              'QUARANTINED'
            )
          ),
          reason TEXT,
          created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cloudflare_operator_binding_installs (
          operation_id TEXT PRIMARY KEY,
          request_sha256 TEXT NOT NULL,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('BOOTSTRAP', 'ADVANCE')),
          status TEXT NOT NULL CHECK (
            status IN ('VERIFYING', 'INSTALLED', 'QUARANTINED', 'CONFLICT')
          ),
          reason TEXT,
          release_operation_id TEXT NOT NULL,
          release_fencing_token TEXT NOT NULL,
          install_fencing_token TEXT NOT NULL,
          expected_current_state_sha256 TEXT,
          expected_restore_epoch TEXT NOT NULL,
          target_position TEXT NOT NULL,
          target_generation TEXT NOT NULL,
          target_record_sha256 TEXT NOT NULL,
          installed_state_json TEXT
        );
        CREATE INDEX IF NOT EXISTS cloudflare_operator_install_status
          ON cloudflare_operator_binding_installs(status);
        CREATE TABLE IF NOT EXISTS cloudflare_operator_issue_operations (
          operation_id TEXT PRIMARY KEY,
          profile_id TEXT NOT NULL,
          signer_operation_id TEXT NOT NULL UNIQUE,
          request_bytes BLOB NOT NULL,
          request_sha256 TEXT NOT NULL,
          request_nonce TEXT NOT NULL,
          environment TEXT NOT NULL,
          chain_id TEXT NOT NULL,
          audience_manifest_url_sha256 TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('IN_PROGRESS', 'RESULT_UNKNOWN', 'FINALIZED', 'REJECTED')
          ),
          blocker TEXT NOT NULL CHECK (blocker IN ('RETAINED', 'CLEARED')),
          fencing_token TEXT NOT NULL,
          signing_claimed INTEGER NOT NULL DEFAULT 1
            CHECK (signing_claimed IN (0, 1)),
          current_state_json TEXT NOT NULL,
          response_bytes BLOB,
          response_length INTEGER,
          response_sha256 TEXT,
          rejection_reason TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS cloudflare_operator_issue_nonce
          ON cloudflare_operator_issue_operations(
            environment, chain_id, audience_manifest_url_sha256, request_nonce
          );
        CREATE INDEX IF NOT EXISTS cloudflare_operator_issue_blockers
          ON cloudflare_operator_issue_operations(blocker, status);
      `);
      const issueColumns = this.ctx.storage.sql
        .exec<{ readonly name: string }>(
          "PRAGMA table_info(cloudflare_operator_issue_operations)",
        )
        .toArray();
      if (!issueColumns.some((column) => column.name === "signing_claimed")) {
        this.ctx.storage.sql.exec(
          `ALTER TABLE cloudflare_operator_issue_operations
           ADD COLUMN signing_claimed INTEGER NOT NULL DEFAULT 1
             CHECK (signing_claimed IN (0, 1))`,
        );
      }
    });
  }

  async readReleaseLedgerHead(): Promise<ReleaseLedgerHead | null> {
    const row = this.ctx.storage.transactionSync(() =>
      this.readReleaseLedgerHeadRow(),
    );
    if (row === null) return null;
    return this.verifiedReleaseHead(row);
  }

  async getReleaseOperation(
    operationId: string,
  ): Promise<ReleaseLedgerOperation | null> {
    assertUuid(operationId, "Release operation ID");
    const row = this.ctx.storage.transactionSync(() =>
      this.findReleaseOperation(operationId),
    );
    if (row === null) return null;
    const operation = releaseOperationFromRow(row);
    await this.verifyStoredReleaseOperation(operation);
    return operation;
  }

  async readCloudflareOperatorReleaseSnapshot(): Promise<CloudflareOperatorReleaseLedgerSnapshot> {
    return this.readCloudflareOperatorReleaseSnapshotInternal();
  }

  async readCloudflareOperatorIssueReleaseSnapshot(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorReleaseLedgerSnapshot> {
    const prepared = await this.prepareCloudflareOperatorIssueSigningAuthorization(input);
    return this.readCloudflareOperatorReleaseSnapshotInternal(prepared);
  }

  private async readCloudflareOperatorReleaseSnapshotInternal(
    authorization?: PreparedCloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorReleaseLedgerSnapshot> {
    const snapshot = this.ctx.storage.transactionSync(() => {
      const profile = this.requireCloudflareOperatorProfile();
      const observedAtMs = this.observeCloudflareOperatorUtc(profile);
      if (authorization !== undefined) {
        this.requireCloudflareOperatorIssueSigningAuthorizationInTransaction(
          authorization,
          true,
          profile,
          observedAtMs,
        );
      }
      const observedProfile = {
        ...profile,
        last_observed_utc_ms: observedAtMs,
      };
      const head = this.readReleaseLedgerHeadRow();
      const releaseOperation = head === null
        ? null
        : this.findReleaseOperation(head.operation_id);
      const issueBlocker = this.hasRetainedIssueBlockers(
        authorization?.authorization.operation.operationId,
      );
      return {
        profile: observedProfile,
        observedAtMs,
        head,
        releaseOperation,
        issueBlocker,
      };
    });
    const operation = snapshot.releaseOperation === null
      ? null
      : releaseOperationFromRow(snapshot.releaseOperation);
    if (operation !== null) await this.verifyStoredReleaseOperation(operation);
    const headRow = snapshot.head;
    return {
      profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
      environment: "production",
      chainId: snapshot.profile.chain_id,
      observedAtMs: snapshot.observedAtMs,
      lastObservedUtcMs: snapshot.profile.last_observed_utc_ms,
      localRestoreEpoch: snapshot.profile.local_restore_epoch,
      writerPending: snapshot.profile.writer_pending === 1,
      issueBlocker: snapshot.issueBlocker,
      currentState: snapshot.profile.current_state_json === null
        ? null
        : decodeCloudflareOperatorBinding(
            snapshot.profile.current_state_json,
          ),
      head: headRow === null
        ? null
        : {
            operationId: headRow.operation_id,
            position: headRow.position,
            generation: headRow.generation,
            recordSha256: headRow.record_sha256,
            previousRecordSha256: headRow.previous_record_sha256,
            releaseCommitId: headRow.release_commit_id,
            appendedAt: headRow.record_appended_at,
            recordBytes: bytesFromArrayBuffer(headRow.record_bytes),
            releaseDelegationBytes: bytesFromArrayBuffer(
              headRow.release_delegation_bytes,
            ),
            manifestEpoch: headRow.manifest_epoch,
            manifestSha256: headRow.manifest_sha256,
            manifestRef: headRow.manifest_ref,
            pointerEtag: headRow.pointer_etag,
          },
      releaseOperation: operation === null
        ? null
        : {
            operationId: operation.operationId,
            status: operation.status,
            fencingToken: operation.fencingToken,
            recordBytes: operation.recordBytes,
            releaseDelegationBytes: operation.releaseDelegationBytes,
            localAppendObservedAt: operation.localAppendObservedAt,
            manifestBytes: operation.manifestBytes,
            manifestSha256: operation.manifestSha256,
            manifestEpoch: operation.manifestEpoch,
            manifestRef: operation.manifestRef,
            pointerEtag: operation.pointerEtag ?? operation.expectedPointerEtag,
          },
    };
  }

  async readCloudflareOperatorVerifiedReleaseState(
    input?: CloudflareOperatorIssueSigningAuthorization,
  ) {
    return createCloudflareOperatorReleaseStateReader({
          coordinator: {
            readCloudflareOperatorReleaseSnapshot: () =>
              this.readCloudflareOperatorReleaseSnapshot(),
            readCloudflareOperatorIssueReleaseSnapshot: (authorization) =>
              this.readCloudflareOperatorIssueReleaseSnapshot(authorization),
          },
      manifests: this.requireReleaseStore(),
      releaseRootSigner: this.requireReleaseRootSigner(),
      manifestRootSigner: this.requireManifestRootSigner(),
      manifestUrl: this.requireFreshnessManifestUrl(),
    }).readCurrentState(
      input === undefined ? undefined : { issueAuthorization: input },
    );
  }

  async beginReleaseBindingInstall(input: {
    readonly operationId: string;
    readonly mode: "BOOTSTRAP" | "ADVANCE";
    readonly releaseOperationId: string;
    readonly expectedCurrentStateSha256: string | null;
    readonly expectedRestoreEpoch: string;
  }): Promise<ReleaseBindingInstallActionResult> {
    assertUuid(input.operationId, "Current-state install operation ID");
    assertUuid(input.releaseOperationId, "Release operation ID");
    if (
      (input.mode !== "BOOTSTRAP" && input.mode !== "ADVANCE") ||
      (input.mode === "BOOTSTRAP" &&
        input.expectedCurrentStateSha256 !== null) ||
      (input.mode === "ADVANCE" &&
        (input.expectedCurrentStateSha256 === null ||
          !SHA256_BASE64URL_PATTERN.test(input.expectedCurrentStateSha256))) ||
      typeof input.expectedRestoreEpoch !== "string" ||
      input.expectedRestoreEpoch.length === 0
    ) {
      throw invalidInput("Current-state install request is invalid");
    }

    const releaseOperation = await this.getReleaseOperation(
      input.releaseOperationId,
    );
    if (releaseOperation === null || releaseOperation.status !== "AVAILABLE") {
      return { status: "CONFLICT" };
    }
    if (releaseOperation.fencingToken === null) {
      throw corruptStorage("Available Release operation has no persisted fence");
    }
    const environment = "production" as const;
    const chainId = this.requireReleaseChainId();
    const requestSha256 = await sha256Base64Url(
      canonicalJsonBytes({
        operationId: input.operationId,
        mode: input.mode,
        releaseOperationId: input.releaseOperationId,
        releaseFencingToken: releaseOperation.fencingToken,
        expectedCurrentStateSha256: input.expectedCurrentStateSha256,
        expectedRestoreEpoch: input.expectedRestoreEpoch,
        environment,
        chainId,
      }),
    );

    return this.ctx.storage.transactionSync(() => {
      const existing = this.findReleaseBindingInstall(input.operationId);
      if (existing !== null) {
        if (existing.request_sha256 !== requestSha256) {
          return {
            status: "CONFLICT" as const,
            operation: releaseBindingInstallFromRow(existing),
          };
        }
        return releaseBindingInstallActionFromRow(existing);
      }

      const storedRelease = this.findReleaseOperation(input.releaseOperationId);
      const head = this.readReleaseLedgerHeadRow();
      if (
        storedRelease === null ||
        storedRelease.status !== "AVAILABLE" ||
        storedRelease.fencing_token !== releaseOperation.fencingToken ||
        head === null ||
        !releaseHeadMatchesOperation(head, storedRelease) ||
        storedRelease.position === null ||
        storedRelease.generation === null ||
        storedRelease.record_sha256 === null
      ) {
        return { status: "CONFLICT" as const };
      }
      if (this.hasPendingReleaseBindingInstall()) {
        return { status: "CONFLICT" as const };
      }
      if (this.hasRetainedIssueBlockers()) {
        return { status: "WAITING_FOR_ISSUES" as const };
      }

      const stateRow = this.readStateRow();
      let state: ReturnType<typeof this.decodeCoordinatorState> | null = null;
      if (input.mode === "BOOTSTRAP") {
        if (
          stateRow !== null ||
          this.hasCurrentStateInstallHistory() ||
          !this.bootstrapAuthorizationMatches(
            storedRelease,
            input.expectedRestoreEpoch,
          )
        ) {
          return { status: "CONFLICT" as const };
        }
      } else {
        if (stateRow === null) {
          return { status: "CONFLICT" as const };
        }
        state = this.decodeCoordinatorState(stateRow);
        if (
          state.writerPending ||
          state.currentState.stateSha256 !==
            input.expectedCurrentStateSha256 ||
          !releaseOperationPredecessorMatchesState(storedRelease, state.currentState)
        ) {
          return { status: "CONFLICT" as const };
        }
      }

      const installFencingToken = this.nextInstallFencingToken(
        state?.nextFencingToken ?? "0",
      );
      this.sql.exec(
        `INSERT INTO current_state_binding_installs (
           operation_id, request_sha256, environment, chain_id, mode,
           status, reason, release_operation_id, release_fencing_token,
           install_fencing_token, expected_current_state_sha256,
           expected_restore_epoch, target_position, target_generation,
           target_record_sha256, proof_context_sha256, installed_state_json
         ) VALUES (?, ?, ?, ?, ?, 'VERIFYING', NULL, ?, ?, ?, ?, ?, ?, ?, ?,
                   NULL, NULL)`,
        input.operationId,
        requestSha256,
        environment,
        chainId,
        input.mode,
        input.releaseOperationId,
        releaseOperation.fencingToken,
        installFencingToken,
        input.expectedCurrentStateSha256,
        input.expectedRestoreEpoch,
        storedRelease.position,
        storedRelease.generation,
        storedRelease.record_sha256,
      );
      if (stateRow !== null) {
        this.sql.exec(
          `UPDATE coordinator_state
           SET writer_pending = 1, writer_operation_id = ?,
               next_fencing_token = ?, write_fencing_token = ?
           WHERE singleton = 1 AND writer_pending = 0`,
          `current-state-install:${input.operationId}`,
          installFencingToken,
          installFencingToken,
        );
      }
      return releaseBindingInstallActionFromRow(
        this.requireReleaseBindingInstall(input.operationId),
      );
    });
  }

  async finalizeReleaseBindingInstall(input: {
    readonly proofContext: FreshnessCurrentStateInstallProofContext;
    readonly verifiedState: VerifiedFreshnessReleaseState;
  }): Promise<ReleaseBindingInstallActionResult> {
    assertCurrentStateInstallProofContext(input.proofContext);
    const verifiedState = input.verifiedState;
    const installedState =
      await createFreshnessIssueCurrentStateBindingFromReleaseState(
        verifiedState,
      );
    if (
      verifiedState.proofContextSha256 !==
      input.proofContext.readContextSha256
    ) {
      throw invalidInput(
        "Verified Release evidence is bound to a different install proof context",
      );
    }

    return this.ctx.storage.transactionSync(() => {
      const attempt = this.findReleaseBindingInstall(
        input.proofContext.installOperationId,
      );
      if (attempt === null) {
        throw invalidInput("Current-state install operation does not exist");
      }
      if (
        attempt.status === "INSTALLED" &&
        installProofMatchesOperation(input.proofContext, attempt)
      ) {
        return releaseBindingInstallActionFromRow(attempt);
      }
      if (attempt.status === "INSTALLED") {
        return {
          status: "CONFLICT",
          operation: releaseBindingInstallFromRow(attempt),
        };
      }
      if (
        attempt.status !== "VERIFYING" ||
        !installProofMatchesOperation(input.proofContext, attempt)
      ) {
        return this.quarantineReleaseBindingInstall(
          attempt,
          "Current-state install attempt or fence is stale",
        );
      }

      const storedRelease = this.findReleaseOperation(
        attempt.release_operation_id,
      );
      const head = this.readReleaseLedgerHeadRow();
      if (
        storedRelease === null ||
        storedRelease.status !== "AVAILABLE" ||
        storedRelease.fencing_token !== attempt.release_fencing_token ||
        head === null ||
        !releaseHeadMatchesOperation(head, storedRelease) ||
        !verifiedReleaseStateMatchesOperation(
          verifiedState,
          storedRelease,
          head,
          input.proofContext,
        ) ||
        this.hasRetainedIssueBlockers()
      ) {
        return this.quarantineReleaseBindingInstall(
          attempt,
          "Verified Release evidence, available head, or issue gate changed before install",
        );
      }

      const stateRow = this.readStateRow();
      const clock = input.proofContext.clock;
      if (attempt.mode === "BOOTSTRAP") {
        const authorization = this.readBootstrapAuthorization();
        if (
          stateRow !== null ||
          authorization === null ||
          authorization.clock_id !== clock.clockId ||
          authorization.clock_epoch !== clock.clockEpoch ||
          authorization.clock_now_ms !== clock.nowMs ||
          authorization.clock_uncertainty_ms !== clock.uncertaintyMs ||
          !bootstrapAuthorizationMatchesInstall(
            authorization,
            storedRelease,
            input.proofContext.expectedRestoreEpoch,
          )
        ) {
          return this.quarantineReleaseBindingInstall(
            attempt,
            "Explicit test-only initial Release checkpoint is missing or changed",
          );
        }
        this.sql.exec(
          `INSERT INTO coordinator_state (
             singleton, environment, current_state_json, witness_json,
             restore_epoch, clock_id, clock_epoch, clock_now_ms,
             clock_uncertainty_ms, next_fencing_token, write_fencing_token,
             writer_pending, writer_operation_id
           ) VALUES (1, 'production', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
          JSON.stringify(installedState),
          JSON.stringify(installedState.antiRollbackWitness),
          installedState.antiRollbackWitness.restoreEpoch,
          authorization.clock_id,
          authorization.clock_epoch,
          authorization.clock_now_ms,
          authorization.clock_uncertainty_ms,
          attempt.install_fencing_token,
          attempt.install_fencing_token,
        );
        this.sql.exec(
          "DELETE FROM current_state_bootstrap_authorizations WHERE singleton = 1",
        );
      } else {
        if (
          stateRow === null ||
          !this.currentStateInstallWriterMatches(stateRow, attempt) ||
          stateRow.clock_id !== clock.clockId ||
          stateRow.clock_epoch !== clock.clockEpoch
        ) {
          return this.quarantineReleaseBindingInstall(
            attempt,
            "Current-state install writer, clock epoch, or existing binding changed",
          );
        }
        const state = this.decodeCoordinatorState(stateRow);
        if (
          state.currentState.stateSha256 !==
            attempt.expected_current_state_sha256 ||
          !releaseOperationPredecessorMatchesState(
            storedRelease,
            state.currentState,
          )
        ) {
          return this.quarantineReleaseBindingInstall(
            attempt,
            "Expected previous current-state binding no longer matches",
          );
        }
        this.sql.exec(
          `UPDATE coordinator_state
           SET current_state_json = ?, witness_json = ?, restore_epoch = ?,
               writer_pending = 0, writer_operation_id = NULL
           WHERE singleton = 1 AND writer_pending = 1
             AND writer_operation_id = ? AND write_fencing_token = ?`,
          JSON.stringify(installedState),
          JSON.stringify(installedState.antiRollbackWitness),
          installedState.antiRollbackWitness.restoreEpoch,
          `current-state-install:${attempt.operation_id}`,
          attempt.install_fencing_token,
        );
      }
      this.sql.exec(
        `UPDATE current_state_binding_installs
         SET status = 'INSTALLED', reason = NULL, proof_context_sha256 = ?,
             installed_state_json = ?
         WHERE operation_id = ? AND status = 'VERIFYING'
           AND install_fencing_token = ?`,
        input.proofContext.readContextSha256,
        JSON.stringify(installedState),
        attempt.operation_id,
        attempt.install_fencing_token,
      );
      return releaseBindingInstallActionFromRow(
        this.requireReleaseBindingInstall(attempt.operation_id),
      );
    });
  }

  async getReleaseBindingInstall(
    operationId: string,
  ): Promise<ReleaseBindingInstallOperation | null> {
    assertUuid(operationId, "Current-state install operation ID");
    const row = this.ctx.storage.transactionSync(() =>
      this.findReleaseBindingInstall(operationId),
    );
    return row === null ? null : releaseBindingInstallFromRow(row);
  }

  async initializeCloudflareOperatorGenesis(
    input: CloudflareOperatorGenesisInput & {
      readonly adminCapability: string;
    },
  ): Promise<CloudflareOperatorGenesisOperation> {
    this.assertCloudflareOperatorGenesisCapability(input.adminCapability);
    const prepared = await this.prepareCloudflareOperatorGenesis(input);
    const existing = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorGenesis(),
    );
    if (existing !== null) {
      if (!this.genesisInputMatches(existing, prepared)) {
        return genesisConflict(prepared.operationId);
      }
      return this.resumeCloudflareOperatorGenesis(prepared);
    }

    const verified = await this.verifyCloudflareOperatorGenesisMaterial(prepared);
    const admitted = this.ctx.storage.transactionSync(() =>
      this.admitCloudflareOperatorGenesis(prepared, verified),
    );
    if (!admitted) {
      const raced = this.ctx.storage.transactionSync(() =>
        this.findCloudflareOperatorGenesis(),
      );
      if (raced === null || !this.genesisInputMatches(raced, prepared)) {
        return genesisConflict(prepared.operationId);
      }
    }
    return this.resumeCloudflareOperatorGenesis(prepared);
  }

  async getCloudflareOperatorGenesisOperation(
    operationId: string,
    adminCapability: string,
  ): Promise<CloudflareOperatorGenesisOperation> {
    this.assertCloudflareOperatorGenesisCapability(adminCapability);
    return this.readCloudflareOperatorGenesisOperation(operationId);
  }

  private async readCloudflareOperatorGenesisOperation(
    operationId: string,
  ): Promise<CloudflareOperatorGenesisOperation> {
    assertUuid(operationId, "Cloudflare/operator genesis operation ID");
    const approval = await this.requireCloudflareOperatorGenesisApproval();
    const expectedOperationId = await cloudflareOperatorGenesisOperationId(
      canonicalJsonBytes(approval),
    );
    if (operationId !== expectedOperationId) {
      return {
        operationId,
        status: "NOT_FOUND",
        releaseStatus: null,
        installStatus: null,
      };
    }
    const row = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorGenesis(operationId),
    );
    if (row === null) {
      return {
        operationId,
        status: "NOT_FOUND",
        releaseStatus: null,
        installStatus: null,
      };
    }
    const release = await this.getReleaseOperation(operationId);
    if (
      release === null ||
      release.requestSha256 !== row.request_sha256 ||
      !equalBytes(release.manifestBytes, bytesFromArrayBuffer(row.manifest_bytes)) ||
      (release.recordBytes !== null &&
        !equalBytes(
          release.recordBytes,
          bytesFromArrayBuffer(row.record_bytes),
        )) ||
      (release.releaseDelegationBytes !== null &&
        !equalBytes(
          release.releaseDelegationBytes,
          bytesFromArrayBuffer(row.release_delegation_bytes),
        )) ||
      ((release.recordBytes === null) !==
        (release.releaseDelegationBytes === null))
    ) {
      throw corruptStorage(
        "Persisted genesis operation does not match its Release ledger operation",
      );
    }
    const install = await this.getCloudflareOperatorBindingInstall(operationId);
    return {
      operationId,
      status: cloudflareOperatorGenesisStatus(row, release, install),
      releaseStatus: release.status,
      installStatus: install?.status ?? null,
    };
  }

  async beginCloudflareOperatorBindingInstall(input: {
    readonly operationId: string;
    readonly mode: "BOOTSTRAP" | "ADVANCE";
    readonly releaseOperationId: string;
    readonly expectedCurrentStateSha256: string | null;
    readonly expectedRestoreEpoch: string;
  }): Promise<CloudflareOperatorBindingInstallAction> {
    assertUuid(input.operationId, "Cloudflare/operator install operation ID");
    assertUuid(input.releaseOperationId, "Release operation ID");
    if (
      (input.mode !== "BOOTSTRAP" && input.mode !== "ADVANCE") ||
      (input.mode === "BOOTSTRAP" &&
        input.expectedCurrentStateSha256 !== null) ||
      (input.mode === "ADVANCE" &&
        (input.expectedCurrentStateSha256 === null ||
          !SHA256_BASE64URL_PATTERN.test(input.expectedCurrentStateSha256))) ||
      typeof input.expectedRestoreEpoch !== "string" ||
      input.expectedRestoreEpoch.length === 0
    ) {
      throw invalidInput("Cloudflare/operator install request is invalid");
    }
    const releaseOperation = await this.getReleaseOperation(
      input.releaseOperationId,
    );
    if (
      releaseOperation === null ||
      releaseOperation.status !== "AVAILABLE" ||
      releaseOperation.fencingToken === null
    ) {
      return { status: "CONFLICT" };
    }
    const chainId = this.requireReleaseChainId();
    const requestSha256 = await sha256Base64Url(
      cloudflareOperatorInstallRequestBytes({
        ...input,
        releaseFencingToken: releaseOperation.fencingToken,
        chainId,
      }),
    );
    return this.ctx.storage.transactionSync(() => {
      const existing = this.findCloudflareOperatorInstall(input.operationId);
      if (existing !== null) {
        return existing.request_sha256 === requestSha256
          ? cloudflareOperatorInstallAction(existing)
          : {
              status: "CONFLICT" as const,
              operation: cloudflareOperatorInstallFromRow(existing),
            };
      }
      const profile = this.requireCloudflareOperatorProfile();
      const nowMs = this.observeCloudflareOperatorUtc(profile);
      const storedRelease = this.findReleaseOperation(input.releaseOperationId);
      const head = this.readReleaseLedgerHeadRow();
      if (
        storedRelease === null ||
        storedRelease.status !== "AVAILABLE" ||
        storedRelease.fencing_token !== releaseOperation.fencingToken ||
        head === null ||
        !releaseHeadMatchesOperation(head, storedRelease) ||
        storedRelease.position === null ||
        storedRelease.generation === null ||
        storedRelease.record_sha256 === null ||
        nowMs < profile.last_observed_utc_ms
      ) {
        return { status: "CONFLICT" as const };
      }
      if (profile.writer_pending === 1 || this.hasRetainedIssueBlockers()) {
        return { status: "WAITING_FOR_ISSUES" as const };
      }
      const currentState = profile.current_state_json === null
        ? null
        : decodeCloudflareOperatorBinding(profile.current_state_json);
      if (input.expectedRestoreEpoch !== profile.local_restore_epoch) {
        return { status: "CONFLICT" as const };
      }
      if (input.mode === "BOOTSTRAP") {
        const authorization = this.readCloudflareOperatorBootstrapAuthorization();
        if (
          currentState !== null ||
          this.hasCloudflareOperatorInstallHistory() ||
          authorization === null ||
          authorization.operation_id !== input.releaseOperationId ||
          authorization.chain_id !== chainId ||
          authorization.position !== storedRelease.position ||
          authorization.generation !== storedRelease.generation ||
          authorization.record_sha256 !== storedRelease.record_sha256 ||
          authorization.restore_epoch !== input.expectedRestoreEpoch
        ) {
          return { status: "CONFLICT" as const };
        }
      } else if (
        currentState === null ||
        currentState.stateSha256 !== input.expectedCurrentStateSha256 ||
        !operatorReleasePredecessorMatchesState(storedRelease, currentState)
      ) {
        return { status: "CONFLICT" as const };
      }
      const installFencingToken = incrementCounter(
        profile.next_fencing_token,
      );
      this.sql.exec(
        `INSERT INTO cloudflare_operator_binding_installs (
           operation_id, request_sha256, environment, chain_id, mode,
           status, reason, release_operation_id, release_fencing_token,
           install_fencing_token, expected_current_state_sha256,
           expected_restore_epoch, target_position, target_generation,
           target_record_sha256, installed_state_json
         ) VALUES (?, ?, 'production', ?, ?, 'VERIFYING', NULL, ?, ?, ?, ?, ?,
                   ?, ?, ?, NULL)`,
        input.operationId,
        requestSha256,
        chainId,
        input.mode,
        input.releaseOperationId,
        releaseOperation.fencingToken,
        installFencingToken,
        input.expectedCurrentStateSha256,
        input.expectedRestoreEpoch,
        storedRelease.position,
        storedRelease.generation,
        storedRelease.record_sha256,
      );
      this.sql.exec(
        `UPDATE freshness_profile
         SET writer_pending = 1, writer_operation_id = ?,
             next_fencing_token = ?, write_fencing_token = ?
         WHERE singleton = 1 AND writer_pending = 0`,
        `cloudflare-operator-install:${input.operationId}`,
        installFencingToken,
        installFencingToken,
      );
      return cloudflareOperatorInstallAction(
        this.requireCloudflareOperatorInstall(input.operationId),
      );
    });
  }

  async finalizeCloudflareOperatorBindingInstall(input: {
    readonly operationId: string;
  }): Promise<CloudflareOperatorBindingInstallAction> {
    assertUuid(input.operationId, "Cloudflare/operator install operation ID");
    const attempt = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorInstall(input.operationId),
    );
    if (attempt === null) {
      throw invalidInput("Cloudflare/operator install operation does not exist");
    }
    if (attempt.status === "INSTALLED") {
      return cloudflareOperatorInstallAction(attempt);
    }
    if (attempt.status !== "VERIFYING") {
      return cloudflareOperatorInstallAction(attempt);
    }
    const releaseOperation = await this.getReleaseOperation(
      attempt.release_operation_id,
    );
    if (
      releaseOperation === null ||
      releaseOperation.status !== "AVAILABLE" ||
      releaseOperation.fencingToken !== attempt.release_fencing_token ||
      releaseOperation.recordBytes === null ||
      releaseOperation.releaseDelegationBytes === null ||
      releaseOperation.localAppendObservedAt === null ||
      releaseOperation.pointerEtag === null
    ) {
      return this.quarantineCloudflareOperatorInstall(
        attempt.operation_id,
        "Install target is no longer an exact AVAILABLE Release operation",
      );
    }

    const readback = await this.requireReleaseStore().verifyExactReadback({
      manifestRef: releaseOperation.manifestRef,
      manifestBytes: releaseOperation.manifestBytes,
      pointerEtag: releaseOperation.pointerEtag,
    });
    const verifiedRecord = await verifyRuntimeConfigReleaseCommitRecord({
      raw: releaseOperation.recordBytes,
      rootSigner: this.requireReleaseRootSigner(),
      environment: releaseOperation.environment,
      releaseDelegationRaw: releaseOperation.releaseDelegationBytes,
      appendedAt: releaseOperation.localAppendObservedAt,
    });
    assertReleaseRecordMatchesOperation(
      verifiedRecord,
      releaseOperation,
      releaseOperation.recordBytes,
      releaseOperation.releaseDelegationBytes,
    );
    const verifiedManifest = await this.verifyManifestPointer(
      releaseOperation.manifestBytes,
    );
    if (
      verifiedManifest.epoch !== releaseOperation.manifestEpoch ||
      verifiedManifest.manifestSha256 !== releaseOperation.manifestSha256
    ) {
      return this.quarantineCloudflareOperatorInstall(
        attempt.operation_id,
        "Install Manifest bytes do not match the signed Release record",
      );
    }

    const localRestoreEpoch = this.ctx.storage.transactionSync(() =>
      this.requireCloudflareOperatorProfile().local_restore_epoch,
    );
    const installedState = await createCloudflareOperatorCurrentStateBinding({
      chainId: attempt.chain_id,
      releaseOperationId: attempt.release_operation_id,
      releaseFencingToken: attempt.release_fencing_token,
      position: attempt.target_position,
      generation: attempt.target_generation,
      recordSha256: verifiedRecord.digest,
      releaseCommitId: verifiedRecord.payload.release_commit_id,
      appendedAt: releaseOperation.localAppendObservedAt,
      manifestEpoch: verifiedManifest.epoch,
      manifestSha256: verifiedManifest.manifestSha256,
      manifestRef: releaseOperation.manifestRef,
      pointerEtag: releaseOperation.pointerEtag!,
      manifestNotBeforeMs: verifiedManifest.notBeforeMs,
      manifestExpiresAtMs: verifiedManifest.expiresAtMs,
      localRestoreEpoch,
    });

    return this.ctx.storage.transactionSync(() => {
      const currentAttempt = this.requireCloudflareOperatorInstall(
        input.operationId,
      );
      if (currentAttempt.status === "INSTALLED") {
        return cloudflareOperatorInstallAction(currentAttempt);
      }
      const profile = this.requireCloudflareOperatorProfile();
      const nowMs = this.observeCloudflareOperatorUtc(profile);
      const storedRelease = this.findReleaseOperation(
        currentAttempt.release_operation_id,
      );
      const head = this.readReleaseLedgerHeadRow();
      const currentState = profile.current_state_json === null
        ? null
        : decodeCloudflareOperatorBinding(profile.current_state_json);
      if (
        currentAttempt.status !== "VERIFYING" ||
        profile.writer_pending !== 1 ||
        profile.writer_operation_id !==
          `cloudflare-operator-install:${currentAttempt.operation_id}` ||
        profile.write_fencing_token !== currentAttempt.install_fencing_token ||
        profile.local_restore_epoch !== currentAttempt.expected_restore_epoch ||
        storedRelease === null ||
        storedRelease.status !== "AVAILABLE" ||
        storedRelease.fencing_token !== currentAttempt.release_fencing_token ||
        head === null ||
        !releaseHeadMatchesOperation(head, storedRelease) ||
        storedRelease.record_sha256 !== verifiedRecord.digest ||
        storedRelease.position !== currentAttempt.target_position ||
        storedRelease.generation !== currentAttempt.target_generation ||
        this.hasRetainedIssueBlockers() ||
        !equalBytes(readback.pointerBytes, releaseOperation.manifestBytes) ||
        !equalBytes(readback.snapshotBytes, releaseOperation.manifestBytes) ||
        readback.pointerEtag !== storedRelease.pointer_etag
      ) {
        return cloudflareOperatorInstallAction(
          this.quarantineCloudflareOperatorInstallInTransaction(
            currentAttempt,
            "Release, R2, issue gate, state, or install fence changed before binding finalization",
          ),
        );
      }
      if (
        nowMs < verifiedManifest.notBeforeMs ||
        nowMs >= verifiedManifest.expiresAtMs
      ) {
        return cloudflareOperatorInstallAction(
          this.quarantineCloudflareOperatorInstallInTransaction(
            currentAttempt,
            "Manifest expired or is not yet valid at current-state install finalization",
          ),
        );
      }
      if (currentAttempt.mode === "BOOTSTRAP") {
        const authorization = this.readCloudflareOperatorBootstrapAuthorization();
        if (
          currentState !== null ||
          this.hasOtherCloudflareOperatorInstallHistory(
            currentAttempt.operation_id,
          ) ||
          authorization === null ||
          authorization.operation_id !== currentAttempt.release_operation_id ||
          authorization.restore_epoch !== currentAttempt.expected_restore_epoch ||
          authorization.position !== currentAttempt.target_position ||
          authorization.generation !== currentAttempt.target_generation ||
          authorization.record_sha256 !== verifiedRecord.digest
        ) {
          return cloudflareOperatorInstallAction(
            this.quarantineCloudflareOperatorInstallInTransaction(
              currentAttempt,
              "Explicit one-time local bootstrap authorization is missing or changed",
            ),
          );
        }
        this.sql.exec(
          `DELETE FROM cloudflare_operator_bootstrap_authorizations
           WHERE singleton = 1 AND operation_id = ?`,
          currentAttempt.release_operation_id,
        );
      } else if (
        currentState === null ||
        currentState.stateSha256 !==
          currentAttempt.expected_current_state_sha256 ||
        !operatorReleasePredecessorMatchesState(storedRelease, currentState)
      ) {
        return cloudflareOperatorInstallAction(
          this.quarantineCloudflareOperatorInstallInTransaction(
            currentAttempt,
            "Previous current-state binding no longer matches the Release predecessor",
          ),
        );
      }

      const current = profile.current_state_json === null
        ? null
        : decodeCloudflareOperatorBinding(profile.current_state_json);
      if (
        currentAttempt.mode === "BOOTSTRAP"
          ? current !== null
          : current === null ||
            current.stateSha256 !==
              currentAttempt.expected_current_state_sha256
      ) {
        return cloudflareOperatorInstallAction(
          this.quarantineCloudflareOperatorInstallInTransaction(
            currentAttempt,
            "Expected installed state changed before finalization",
          ),
        );
      }
      this.sql.exec(
        `UPDATE freshness_profile
         SET current_state_json = ?, writer_pending = 0,
             writer_operation_id = NULL
         WHERE singleton = 1 AND writer_pending = 1
           AND writer_operation_id = ? AND write_fencing_token = ?`,
        JSON.stringify(installedState),
        `cloudflare-operator-install:${currentAttempt.operation_id}`,
        currentAttempt.install_fencing_token,
      );
      this.sql.exec(
        `UPDATE cloudflare_operator_binding_installs
         SET status = 'INSTALLED', reason = NULL, installed_state_json = ?
         WHERE operation_id = ? AND status = 'VERIFYING'
           AND install_fencing_token = ?`,
        JSON.stringify(installedState),
        currentAttempt.operation_id,
        currentAttempt.install_fencing_token,
      );
      return cloudflareOperatorInstallAction(
        this.requireCloudflareOperatorInstall(currentAttempt.operation_id),
      );
    });
  }

  async getCloudflareOperatorBindingInstall(
    operationId: string,
  ): Promise<CloudflareOperatorBindingInstallOperation | null> {
    assertUuid(operationId, "Cloudflare/operator install operation ID");
    const row = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorInstall(operationId),
    );
    return row === null ? null : cloudflareOperatorInstallFromRow(row);
  }

  async beginReleaseOperation(input: {
    readonly operationId: string;
    readonly expectedHead: ReleaseLedgerHead | null;
    readonly manifestBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult> {
    assertUuid(input.operationId, "Release operation ID");
    if (
      !(input.manifestBytes instanceof Uint8Array) ||
      input.manifestBytes.byteLength === 0 ||
      input.manifestBytes.byteLength > 1_048_576
    ) {
      throw invalidInput("Release Manifest bytes are empty or exceed the wire limit");
    }

    const environment = "production" as const;
    const chainId = this.requireReleaseChainId();
    const manifestBytes = copyBytes(input.manifestBytes);
    const verifiedManifest = await this.verifyManifestPointer(manifestBytes);
    const manifestRef =
      `${runtimeConfigFreshnessWire.immutableManifestPrefix}${verifiedManifest.manifestSha256}`;
    const expectedHead = copyReleaseHead(input.expectedHead);
    const requestSha256 = await sha256Base64Url(
      canonicalJsonBytes({
        operationId: input.operationId,
        environment,
        chainId,
        expectedHead: expectedHead === null
          ? null
          : {
              position: expectedHead.position,
              generation: expectedHead.generation,
              recordSha256: expectedHead.recordSha256,
              pointerEtag: expectedHead.pointerEtag,
            },
        manifestLength: manifestBytes.byteLength,
        manifestSha256: verifiedManifest.manifestSha256,
        manifestEpoch: verifiedManifest.epoch,
        manifestRef,
      }),
    );

    const result = this.ctx.storage.transactionSync(() => {
      const existing = this.findReleaseOperation(input.operationId);
      if (existing !== null) {
        const sameRequest =
          existing.request_sha256 === requestSha256 &&
          existing.environment === environment &&
          existing.chain_id === chainId &&
          equalBytes(bytesFromArrayBuffer(existing.manifest_bytes), manifestBytes);
        return sameRequest
          ? this.releaseActionForRow(existing)
          : { status: "CONFLICT" as const, operation: releaseOperationFromRow(existing) };
      }

      const currentHead = this.readReleaseLedgerHeadRow();
      if (
        currentHead === null ||
        expectedHead === null ||
        !sameReleaseHeadBinding(currentHead, expectedHead)
      ) {
        return this.insertReleaseConflict({
          operationId: input.operationId,
          requestSha256,
          environment,
          chainId,
          expectedHead,
          manifestBytes,
          manifestSha256: verifiedManifest.manifestSha256,
          manifestEpoch: verifiedManifest.epoch,
          manifestRef,
        });
      }
      const operatorProfile = this.readCloudflareOperatorProfileRow();
      let fencingToken: string;
      if (operatorProfile !== null) {
        const profile = this.requireCloudflareOperatorProfile();
        const nowMs = this.observeCloudflareOperatorUtc(profile);
        if (
          nowMs < verifiedManifest.notBeforeMs ||
          nowMs >= verifiedManifest.expiresAtMs
        ) {
          throw new RuntimeConfigDomainError(
            "INVALID_TIME",
            "Release Manifest is not active at Release operation admission",
          );
        }
        const currentState = profile.current_state_json === null
          ? null
          : decodeCloudflareOperatorBinding(profile.current_state_json);
        if (
          currentState === null ||
          !releaseHeadMatchesOperatorBinding(currentHead, currentState)
        ) {
          throw new FreshnessIssueCoordinatorStorageError(
            "RELEASE_BLOCKED",
            "Cloudflare/operator current-state binding does not match the persisted Release ledger head",
          );
        }
        if (profile.writer_pending === 1) {
          return this.insertReleaseConflict({
            operationId: input.operationId,
            requestSha256,
            environment,
            chainId,
            expectedHead,
            manifestBytes,
            manifestSha256: verifiedManifest.manifestSha256,
            manifestEpoch: verifiedManifest.epoch,
            manifestRef,
          });
        }
        fencingToken = incrementCounter(profile.next_fencing_token);
      } else {
        const stateRow = this.readStateRow();
        if (stateRow === null) {
          throw new FreshnessIssueCoordinatorStorageError(
            "NOT_INITIALIZED",
            "Coordinator state must be initialized before a Release operation",
          );
        }
        const state = this.decodeCoordinatorState(stateRow);
        if (!coordinatorStateMatchesReleaseHead(state.currentState, currentHead)) {
          throw new FreshnessIssueCoordinatorStorageError(
            "RELEASE_BLOCKED",
            "Coordinator current state does not match the persisted Release ledger head",
          );
        }
        if (state.writerPending) {
          return this.insertReleaseConflict({
            operationId: input.operationId,
            requestSha256,
            environment,
            chainId,
            expectedHead,
            manifestBytes,
            manifestSha256: verifiedManifest.manifestSha256,
            manifestEpoch: verifiedManifest.epoch,
            manifestRef,
          });
        }
        fencingToken = incrementCounter(state.nextFencingToken);
      }
      this.sql.exec(
        `INSERT INTO release_ledger_operations (
           operation_id, request_sha256, environment, chain_id, status,
           reason, unknown_stage, resume_status, fencing_token,
           expected_position, expected_generation, expected_record_sha256,
           expected_pointer_etag, manifest_bytes, manifest_length,
           manifest_sha256, manifest_epoch, manifest_ref
         ) VALUES (?, ?, ?, ?, 'INTENT', NULL, NULL, NULL, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?)`,
        input.operationId,
        requestSha256,
        environment,
        chainId,
        fencingToken,
        expectedHead.position,
        expectedHead.generation,
        expectedHead.recordSha256,
        expectedHead.pointerEtag,
        arrayBufferFromBytes(manifestBytes),
        manifestBytes.byteLength,
        verifiedManifest.manifestSha256,
        verifiedManifest.epoch,
        manifestRef,
      );
      if (operatorProfile !== null) {
        this.sql.exec(
          `UPDATE freshness_profile
           SET writer_pending = 1, writer_operation_id = ?,
               next_fencing_token = ?, write_fencing_token = ?
           WHERE singleton = 1 AND writer_pending = 0`,
          input.operationId,
          fencingToken,
          fencingToken,
        );
      } else {
        this.sql.exec(
          `UPDATE coordinator_state
           SET writer_pending = 1, writer_operation_id = ?,
               next_fencing_token = ?, write_fencing_token = ?
           WHERE singleton = 1 AND writer_pending = 0`,
          input.operationId,
          fencingToken,
          fencingToken,
        );
      }
      const operation = this.requireReleaseOperation(input.operationId);
      return this.hasRetainedIssueBlockers()
        ? { status: "WAITING_FOR_ISSUES" as const, operation: releaseOperationFromRow(operation) }
        : { status: "STARTED" as const, operation: releaseOperationFromRow(operation) };
    });
    return result;
  }

  async stageReleaseManifest(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    const prepared = this.ctx.storage.transactionSync(() => {
      const operation = this.requireReleaseOperation(input.operationId);
      this.requireReleaseWriter(operation, input.fencingToken);
      if (operation.status === "R2_STAGED") {
        return { result: this.releaseActionForRow(operation) } as const;
      }
      if (operation.status === "R2_WRITE_PENDING") {
        return { result: this.releaseActionForRow(operation) } as const;
      }
      if (
        operation.status === "RESULT_UNKNOWN" &&
        operation.unknown_stage === "R2_WRITE"
      ) {
        return { reconcile: true } as const;
      }
      if (operation.status !== "INTENT") {
        return { result: this.releaseActionForRow(operation) } as const;
      }
      if (this.hasRetainedIssueBlockers()) {
        return {
          result: {
            status: "WAITING_FOR_ISSUES" as const,
            operation: releaseOperationFromRow(operation),
          },
        } as const;
      }
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'R2_WRITE_PENDING', reason = NULL
         WHERE operation_id = ? AND status = 'INTENT'`,
        input.operationId,
      );
      return {
        operation: releaseOperationFromRow(
          this.requireReleaseOperation(input.operationId),
        ),
      } as const;
    });
    if ("result" in prepared) return prepared.result;
    if ("reconcile" in prepared) {
      return this.reconcileReleaseOperation(input);
    }

    const operation = prepared.operation;
    let readback: {
      readonly pointerBytes: Uint8Array;
      readonly pointerEtag: string;
      readonly snapshotBytes: Uint8Array;
    };
    try {
      await this.verifyOperationManifest(operation);
      readback = await this.requireReleaseStore().publishManifest(
        operation.manifestRef,
        operation.manifestBytes,
        operation.expectedPointerEtag,
      );
    } catch (error) {
      if (
        error instanceof RuntimeConfigR2ReleaseConflictError ||
        error instanceof RuntimeConfigR2ReleaseIntegrityError ||
        error instanceof RuntimeConfigDomainError
      ) {
        return this.quarantineReleaseOperation(
          input.operationId,
          input.fencingToken,
          "R2 publication did not match the exact Release intent",
        );
      }
      return this.markReleaseOperationUnknown({
        ...input,
        stage: "R2_WRITE",
      });
    }

    return this.ctx.storage.transactionSync(() => {
      const operationRow = this.requireReleaseOperation(input.operationId);
      if (operationRow.status === "R2_STAGED") {
        if (
          operationRow.pointer_bytes !== null &&
          operationRow.snapshot_bytes !== null &&
          equalBytes(
            bytesFromArrayBuffer(operationRow.pointer_bytes),
            readback.pointerBytes,
          ) &&
          equalBytes(
            bytesFromArrayBuffer(operationRow.snapshot_bytes),
            readback.snapshotBytes,
          ) &&
          operationRow.pointer_etag === readback.pointerEtag
        ) {
          return this.releaseActionForRow(operationRow);
        }
        return this.quarantineReleaseOperationInTransaction(
          operationRow,
          "Concurrent R2 publication produced different readback bytes",
        );
      }
      if (
        operationRow.status !== "R2_WRITE_PENDING" &&
        !(
          operationRow.status === "RESULT_UNKNOWN" &&
          operationRow.unknown_stage === "R2_WRITE"
        )
      ) {
        return this.releaseActionForRow(operationRow);
      }
      this.requireReleaseWriter(operationRow, input.fencingToken);
      this.requireExpectedReleaseHead(operationRow);
      if (
        this.hasRetainedIssueBlockers()
      ) {
        return this.quarantineReleaseOperationInTransaction(
          operationRow,
          "Coordinator changed before R2 publication could be recorded",
        );
      }
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'R2_STAGED', reason = NULL, unknown_stage = NULL,
             resume_status = NULL, pointer_bytes = ?, pointer_etag = ?,
             snapshot_bytes = ?
         WHERE operation_id = ? AND status IN
           ('R2_WRITE_PENDING', 'RESULT_UNKNOWN')
           AND fencing_token = ?`,
        arrayBufferFromBytes(readback.pointerBytes),
        readback.pointerEtag,
        arrayBufferFromBytes(readback.snapshotBytes),
        input.operationId,
        input.fencingToken,
      );
      return this.releaseActionForRow(
        this.requireReleaseOperation(input.operationId),
      );
    });
  }

  async markReleaseOperationUnknown(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly stage: "R2_WRITE" | "RELEASE_SIGNER" | "R2_READBACK";
  }): Promise<ReleaseLedgerActionResult> {
    return this.ctx.storage.transactionSync(() => {
      const operation = this.requireReleaseOperation(input.operationId);
      this.requireReleaseWriter(operation, input.fencingToken);
      if (operation.status === "RESULT_UNKNOWN") {
        if (operation.unknown_stage !== input.stage) {
          throw transitionError(
            "Release operation already has a different unresolved stage",
          );
        }
        return this.releaseActionForRow(operation);
      }
      const allowedStatusByStage = {
        R2_WRITE: ["INTENT", "R2_WRITE_PENDING"],
        RELEASE_SIGNER: ["R2_STAGED"],
        R2_READBACK: ["LEDGER_COMMITTED", "R2_READBACK_PENDING"],
      } as const;
      if (
        !allowedStatusByStage[input.stage].includes(
          operation.status as never,
        )
      ) {
        throw transitionError(
          "Release operation cannot become unknown at this stage",
        );
      }
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'RESULT_UNKNOWN', reason = ?, unknown_stage = ?,
             resume_status = ?
         WHERE operation_id = ? AND fencing_token = ?`,
        `Unresolved ${input.stage} outcome`,
        input.stage,
        operation.status,
        input.operationId,
        input.fencingToken,
      );
      return this.releaseActionForRow(
        this.requireReleaseOperation(input.operationId),
      );
    });
  }

  async appendReleaseRecord(input: {
    readonly operationId: string;
    readonly fencingToken: string;
    readonly recordBytes: Uint8Array;
    readonly releaseDelegationBytes: Uint8Array;
  }): Promise<ReleaseLedgerActionResult> {
    const operation = await this.getReleaseOperation(input.operationId);
    if (operation === null) {
      throw invalidInput("Release operation does not exist");
    }
    if (
      operation.status === "LEDGER_COMMITTED" ||
      operation.status === "R2_READBACK_PENDING" ||
      operation.status === "AVAILABLE"
    ) {
      if (
        operation.recordBytes !== null &&
        operation.releaseDelegationBytes !== null &&
        equalBytes(operation.recordBytes, input.recordBytes) &&
        equalBytes(
          operation.releaseDelegationBytes,
          input.releaseDelegationBytes,
        )
      ) {
        return releaseActionFromOperation(operation);
      }
      return { status: "CONFLICT", operation };
    }
    if (
      operation.status !== "R2_STAGED" &&
      !(
        operation.status === "RESULT_UNKNOWN" &&
        operation.unknownStage === "RELEASE_SIGNER" &&
        operation.resumeStatus === "R2_STAGED"
      )
    ) {
      return releaseActionFromOperation(operation);
    }

    this.requireReleaseRootSigner();
    const recordBytes = copyBytes(input.recordBytes);
    const releaseDelegationBytes = copyBytes(input.releaseDelegationBytes);
    let verifiedManifest;
    try {
      verifiedManifest = await this.verifyOperationManifest(operation);
    } catch (error) {
      await this.quarantineReleaseOperation(
        input.operationId,
        input.fencingToken,
        "Release Manifest expired or failed verification before ledger commit",
      );
      throw error;
    }
    const operatorProfileSelected = this.ctx.storage.transactionSync(
      () => this.readCloudflareOperatorProfileRow() !== null,
    );
    const initialAppendObservedAt = operatorProfileSelected
      ? timestampFromMilliseconds(
          this.ctx.storage.transactionSync(() =>
            this.observeCloudflareOperatorUtc(
              this.requireCloudflareOperatorProfile(),
            ),
          ),
        )
      : timestampFromMilliseconds((await this.readClock()).nowMs);
    let verifiedRecord;
    try {
      verifiedRecord = await verifyRuntimeConfigReleaseCommitRecord({
        raw: recordBytes,
        rootSigner: this.requireReleaseRootSigner(),
        environment: operation.environment,
        releaseDelegationRaw: releaseDelegationBytes,
        appendedAt: initialAppendObservedAt,
      });
      assertReleaseRecordMatchesOperation(
        verifiedRecord,
        operation,
        recordBytes,
        releaseDelegationBytes,
      );
    } catch (error) {
      await this.quarantineReleaseOperation(
        input.operationId,
        input.fencingToken,
        "Release Record or delegation verification failed",
      );
      throw error;
    }

    const recordSha256 = verifiedRecord.digest;
    return this.ctx.storage.transactionSync(() => {
      const storedOperation = this.requireReleaseOperation(input.operationId);
      if (
        storedOperation.status === "LEDGER_COMMITTED" ||
        storedOperation.status === "R2_READBACK_PENDING" ||
        storedOperation.status === "AVAILABLE"
      ) {
        return storedOperation.record_sha256 === recordSha256 &&
            storedOperation.record_bytes !== null &&
            storedOperation.release_delegation_bytes !== null &&
            equalBytes(
              bytesFromArrayBuffer(storedOperation.record_bytes),
              recordBytes,
            ) &&
            equalBytes(
              bytesFromArrayBuffer(storedOperation.release_delegation_bytes),
              releaseDelegationBytes,
            )
          ? this.releaseActionForRow(storedOperation)
          : { status: "CONFLICT" as const, operation: releaseOperationFromRow(storedOperation) };
      }
      this.requireReleaseWriter(storedOperation, input.fencingToken);
      const localAppendObservedAt = operatorProfileSelected
        ? timestampFromMilliseconds(
            this.observeCloudflareOperatorUtc(
              this.requireCloudflareOperatorProfile(),
            ),
          )
        : initialAppendObservedAt;
      if (
        operatorProfileSelected &&
        (
          Date.parse(localAppendObservedAt) < verifiedRecord.delegation.notBeforeMs ||
          Date.parse(localAppendObservedAt) >= verifiedRecord.delegation.notAfterMs ||
          Date.parse(localAppendObservedAt) < verifiedManifest.notBeforeMs ||
          Date.parse(localAppendObservedAt) >= verifiedManifest.expiresAtMs ||
          Date.parse(localAppendObservedAt) <
            Date.parse(verifiedRecord.payload.authorized_at)
        )
      ) {
        return this.quarantineReleaseOperationInTransaction(
          storedOperation,
          "Release delegation expired or authorization is not yet valid at ledger commit",
        );
      }
      this.requireExpectedReleaseHead(storedOperation);
      const currentHead = this.readReleaseLedgerHeadRow();
      if (
        !sameReleaseHeadBinding(
          currentHead,
          storedOperation.expected_position === null
            ? null
            : releaseExpectedHeadFromRow(storedOperation),
        )
      ) {
        return this.quarantineReleaseOperationInTransaction(
          storedOperation,
          "Release predecessor changed before ledger append",
        );
      }
      if (this.hasRetainedIssueBlockers()) {
        return {
          status: "WAITING_FOR_ISSUES" as const,
          operation: releaseOperationFromRow(storedOperation),
        };
      }
      if (
        storedOperation.status !== "R2_STAGED" &&
        !(
          storedOperation.status === "RESULT_UNKNOWN" &&
          storedOperation.unknown_stage === "RELEASE_SIGNER" &&
          storedOperation.resume_status === "R2_STAGED"
        )
      ) {
        return this.releaseActionForRow(storedOperation);
      }

      const expectedGeneration =
        storedOperation.expected_generation === null
          ? 1n
          : parseCanonicalUnsignedDecimal(
              storedOperation.expected_generation,
              "Release predecessor generation",
            ) + 1n;
      const position =
        storedOperation.expected_position === null
          ? "1"
          : (
              parseCanonicalUnsignedDecimal(
                storedOperation.expected_position,
                "Release predecessor position",
              ) + 1n
            ).toString(10);
      if (
        verifiedRecord.payload.commit_generation !==
          expectedGeneration.toString(10) ||
        (storedOperation.expected_generation === null
          ? verifiedRecord.payload.previous_commit_generation !== null ||
            verifiedRecord.payload.previous_commit_record_sha256 !== null
          : verifiedRecord.payload.previous_commit_generation !==
              storedOperation.expected_generation ||
            verifiedRecord.payload.previous_commit_record_sha256 !==
              storedOperation.expected_record_sha256)
      ) {
        return this.quarantineReleaseOperationInTransaction(
          storedOperation,
          "Release Record predecessor or generation is stale",
        );
      }
      this.sql.exec(
        `INSERT INTO release_ledger_entries (
           position, environment, chain_id, operation_id, generation,
           record_sha256, record_appended_at, record_bytes, record_length,
           release_delegation_bytes, previous_record_sha256,
           release_commit_id, manifest_epoch, manifest_sha256, manifest_ref,
           pointer_etag, manifest_bytes, pointer_bytes, snapshot_bytes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        position,
        storedOperation.environment,
        storedOperation.chain_id,
        storedOperation.operation_id,
        verifiedRecord.payload.commit_generation,
        recordSha256,
        localAppendObservedAt,
        arrayBufferFromBytes(recordBytes),
        recordBytes.byteLength,
        arrayBufferFromBytes(releaseDelegationBytes),
        verifiedRecord.payload.previous_commit_record_sha256,
        verifiedRecord.payload.release_commit_id,
        storedOperation.manifest_epoch,
        storedOperation.manifest_sha256,
        storedOperation.manifest_ref,
        storedOperation.pointer_etag!,
        storedOperation.manifest_bytes,
        storedOperation.pointer_bytes!,
        storedOperation.snapshot_bytes!,
      );
      this.sql.exec(
        `INSERT INTO release_ledger_head (
           singleton, environment, chain_id, position, generation,
           record_sha256, previous_record_sha256, release_commit_id,
           manifest_epoch, manifest_sha256, manifest_ref, pointer_etag
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           environment = excluded.environment,
           chain_id = excluded.chain_id,
           position = excluded.position,
           generation = excluded.generation,
           record_sha256 = excluded.record_sha256,
           previous_record_sha256 = excluded.previous_record_sha256,
           release_commit_id = excluded.release_commit_id,
           manifest_epoch = excluded.manifest_epoch,
           manifest_sha256 = excluded.manifest_sha256,
           manifest_ref = excluded.manifest_ref,
           pointer_etag = excluded.pointer_etag`,
        storedOperation.environment,
        storedOperation.chain_id,
        position,
        verifiedRecord.payload.commit_generation,
        recordSha256,
        verifiedRecord.payload.previous_commit_record_sha256,
        verifiedRecord.payload.release_commit_id,
        storedOperation.manifest_epoch,
        storedOperation.manifest_sha256,
        storedOperation.manifest_ref,
        storedOperation.pointer_etag!,
      );
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'LEDGER_COMMITTED', reason = NULL,
             unknown_stage = NULL, resume_status = NULL,
             record_bytes = ?, record_length = ?, record_sha256 = ?,
             record_appended_at = ?,
             release_delegation_bytes = ?, position = ?, generation = ?,
             previous_record_sha256 = ?, release_commit_id = ?
         WHERE operation_id = ? AND status IN ('R2_STAGED', 'RESULT_UNKNOWN')
           AND fencing_token = ?`,
        arrayBufferFromBytes(recordBytes),
        recordBytes.byteLength,
        recordSha256,
        localAppendObservedAt,
        arrayBufferFromBytes(releaseDelegationBytes),
        position,
        verifiedRecord.payload.commit_generation,
        verifiedRecord.payload.previous_commit_record_sha256,
        verifiedRecord.payload.release_commit_id,
        input.operationId,
        input.fencingToken,
      );
      return this.releaseActionForRow(
        this.requireReleaseOperation(input.operationId),
      );
    });
  }

  async finalizeReleaseR2Readback(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    const prepared = this.ctx.storage.transactionSync(() => {
      const operation = this.requireReleaseOperation(input.operationId);
      if (operation.status === "AVAILABLE") {
        return { result: this.releaseActionForRow(operation) } as const;
      }
      this.requireReleaseWriter(operation, input.fencingToken);
      if (
        operation.status !== "LEDGER_COMMITTED" &&
        operation.status !== "R2_READBACK_PENDING" &&
        !(
          operation.status === "RESULT_UNKNOWN" &&
          operation.unknown_stage === "R2_READBACK" &&
          (
            operation.resume_status === "LEDGER_COMMITTED" ||
            operation.resume_status === "R2_READBACK_PENDING"
          )
        )
      ) {
        return { result: this.releaseActionForRow(operation) } as const;
      }
      if (this.hasRetainedIssueBlockers()) {
        return {
          result: {
            status: "WAITING_FOR_ISSUES" as const,
            operation: releaseOperationFromRow(operation),
          },
        } as const;
      }
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'R2_READBACK_PENDING', reason = NULL
             , unknown_stage = NULL, resume_status = NULL
         WHERE operation_id = ? AND status IN
           ('LEDGER_COMMITTED', 'R2_READBACK_PENDING', 'RESULT_UNKNOWN')`,
        input.operationId,
      );
      return {
        operation: releaseOperationFromRow(
          this.requireReleaseOperation(input.operationId),
        ),
      } as const;
    });
    if ("result" in prepared) return prepared.result;
    if ("reconcile" in prepared) {
      return this.reconcileReleaseOperation(input);
    }

    const operation = prepared.operation;
    let readback: {
      readonly pointerBytes: Uint8Array;
      readonly pointerEtag: string;
      readonly snapshotBytes: Uint8Array;
    };
    let verifiedManifest: Awaited<
      ReturnType<typeof verifyRuntimeConfigManifestEpochPointer>
    >;
    try {
      verifiedManifest = await this.verifyOperationManifest(operation);
      readback = await this.requireReleaseStore().verifyExactReadback({
        manifestRef: operation.manifestRef,
        manifestBytes: operation.manifestBytes,
        pointerEtag: operation.pointerEtag!,
      });
      await this.verifyStoredReleaseOperation(operation);
    } catch (error) {
      if (
        error instanceof RuntimeConfigR2ReleaseIntegrityError ||
        error instanceof RuntimeConfigDomainError
      ) {
        return this.quarantineReleaseOperation(
          input.operationId,
          input.fencingToken,
          "Post-append R2 readback did not match the committed Release",
        );
      }
      return this.markReleaseOperationUnknown({
        ...input,
        stage: "R2_READBACK",
      });
    }

    return this.ctx.storage.transactionSync(() => {
      const storedOperation = this.requireReleaseOperation(input.operationId);
      if (storedOperation.status === "AVAILABLE") {
        return this.releaseActionForRow(storedOperation);
      }
      this.requireReleaseWriter(storedOperation, input.fencingToken);
      if (this.readCloudflareOperatorProfileRow() !== null) {
        const nowMs = this.observeCloudflareOperatorUtc(
          this.requireCloudflareOperatorProfile(),
        );
        if (
          nowMs < verifiedManifest.notBeforeMs ||
          nowMs >= verifiedManifest.expiresAtMs
        ) {
          return this.quarantineReleaseOperationInTransaction(
            storedOperation,
            "Release Manifest expired before exact R2 readback finalization",
          );
        }
      }
      this.requireCommittedReleaseHead(storedOperation);
      const head = this.readReleaseLedgerHeadRow();
      if (
        storedOperation.status !== "R2_READBACK_PENDING" ||
        head === null ||
        head.operation_id !== input.operationId ||
        head.record_sha256 !== storedOperation.record_sha256 ||
        !equalBytes(readback.pointerBytes, operation.manifestBytes) ||
        !equalBytes(readback.snapshotBytes, operation.manifestBytes) ||
        readback.pointerEtag !== storedOperation.pointer_etag
      ) {
        return this.quarantineReleaseOperationInTransaction(
          storedOperation,
          "Release attempt, fence, head, or R2 binding changed before finalization",
        );
      }
      if (this.hasRetainedIssueBlockers()) {
        return {
          status: "WAITING_FOR_ISSUES" as const,
          operation: releaseOperationFromRow(storedOperation),
        };
      }
      this.sql.exec(
        `UPDATE release_ledger_operations
         SET status = 'AVAILABLE', reason = NULL,
             unknown_stage = NULL, resume_status = NULL,
             pointer_bytes = ?, snapshot_bytes = ?
         WHERE operation_id = ? AND status = 'R2_READBACK_PENDING'
           AND fencing_token = ?`,
        arrayBufferFromBytes(readback.pointerBytes),
        arrayBufferFromBytes(readback.snapshotBytes),
        input.operationId,
        input.fencingToken,
      );
      if (this.readCloudflareOperatorProfileRow() !== null) {
        this.sql.exec(
          `UPDATE freshness_profile
           SET writer_pending = 0, writer_operation_id = NULL
           WHERE singleton = 1 AND writer_pending = 1
             AND writer_operation_id = ? AND write_fencing_token = ?`,
          input.operationId,
          input.fencingToken,
        );
      } else {
        this.sql.exec(
          `UPDATE coordinator_state
           SET writer_pending = 0, writer_operation_id = NULL
           WHERE singleton = 1 AND writer_pending = 1
             AND writer_operation_id = ? AND write_fencing_token = ?`,
          input.operationId,
          input.fencingToken,
        );
      }
      return this.releaseActionForRow(
        this.requireReleaseOperation(input.operationId),
      );
    });
  }

  async reconcileReleaseOperation(input: {
    readonly operationId: string;
    readonly fencingToken: string;
  }): Promise<ReleaseLedgerActionResult> {
    const operation = await this.getReleaseOperation(input.operationId);
    if (operation === null) {
      throw invalidInput("Release operation does not exist");
    }
    if (operation.fencingToken !== input.fencingToken) {
      throw invalidInput("Release operation fencing token does not match");
    }
    if (
      operation.status === "LEDGER_COMMITTED" ||
      operation.status === "R2_READBACK_PENDING" ||
      (operation.status === "RESULT_UNKNOWN" &&
        operation.unknownStage === "R2_READBACK")
    ) {
      return this.finalizeReleaseR2Readback(input);
    }
    if (
      operation.status !== "R2_WRITE_PENDING" &&
      !(
        operation.status === "RESULT_UNKNOWN" &&
        operation.unknownStage === "R2_WRITE"
      )
    ) {
      return releaseActionFromOperation(operation);
    }

    let state: Awaited<ReturnType<RuntimeConfigR2ReleaseStore["readState"]>>;
    try {
      state = await this.requireReleaseStore().readState(operation.manifestRef);
    } catch {
      return this.markReleaseOperationUnknown({
        ...input,
        stage: "R2_WRITE",
      });
    }
    const pointerIsExpected =
      state.pointer !== null &&
      equalBytes(state.pointer.bytes, operation.manifestBytes);
    const snapshotIsExpected =
      state.snapshotBytes !== null &&
      equalBytes(state.snapshotBytes, operation.manifestBytes);
    if (pointerIsExpected && snapshotIsExpected) {
      return this.ctx.storage.transactionSync(() => {
        const row = this.requireReleaseOperation(input.operationId);
        this.requireReleaseWriter(row, input.fencingToken);
        this.requireExpectedReleaseHead(row);
        if (
          row.status !== "R2_WRITE_PENDING" &&
          !(
            row.status === "RESULT_UNKNOWN" &&
            row.unknown_stage === "R2_WRITE"
          )
        ) {
          return this.releaseActionForRow(row);
        }
        this.sql.exec(
          `UPDATE release_ledger_operations
           SET status = 'R2_STAGED', reason = NULL,
               unknown_stage = NULL, resume_status = NULL,
               pointer_bytes = ?, pointer_etag = ?, snapshot_bytes = ?
           WHERE operation_id = ? AND fencing_token = ?`,
          arrayBufferFromBytes(state.pointer!.bytes),
          state.pointer!.etag,
          arrayBufferFromBytes(state.snapshotBytes!),
          input.operationId,
          input.fencingToken,
        );
        return this.releaseActionForRow(
          this.requireReleaseOperation(input.operationId),
        );
      });
    }
    const oldPointerStillCurrent =
      operation.expectedPointerEtag.length === 0
        ? state.pointer === null
        : state.pointer?.etag === operation.expectedPointerEtag;
    const conflictingSnapshot =
      state.snapshotBytes !== null && !snapshotIsExpected;
    if (!oldPointerStillCurrent || conflictingSnapshot) {
      return this.quarantineReleaseOperation(
        input.operationId,
        input.fencingToken,
        "R2 readback conflicts with both the prior head and the pending Release",
      );
    }
    return this.markReleaseOperationUnknown({
      ...input,
      stage: "R2_WRITE",
    });
  }

  async beginCloudflareOperatorIssue(input: {
    readonly operationId: string;
    readonly requestBytes: Uint8Array;
  }): Promise<CloudflareOperatorIssueAdmission> {
    assertUuid(input.operationId, "Cloudflare/operator issue operation ID");
    if (
      !(input.requestBytes instanceof Uint8Array) ||
      input.requestBytes.byteLength === 0 ||
      input.requestBytes.byteLength > 1_024
    ) {
      throw invalidInput("Freshness request bytes are empty or exceed the wire limit");
    }
    const requestBytes = copyBytes(input.requestBytes);
    const manifestUrl = this.requireFreshnessManifestUrl();
    const audienceManifestUrlSha256 = await sha256Base64Url(
      new TextEncoder().encode(manifestUrl),
    );
    const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
      environment: "production",
      audienceManifestUrlSha256,
    });
    const requestSha256 = await sha256Base64Url(requestBytes);
    const chainId = this.requireReleaseChainId();
    const existing = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorIssue(input.operationId),
    );
    if (existing !== null) {
      if (
        existing.request_sha256 !== requestSha256 ||
        existing.request_nonce !== challenge.request_nonce ||
        !equalBytes(bytesFromArrayBuffer(existing.request_bytes), requestBytes) ||
        existing.chain_id !== chainId ||
        existing.audience_manifest_url_sha256 !== audienceManifestUrlSha256
      ) {
        return { status: "CONFLICT" };
      }
      return this.getCloudflareOperatorIssue({
        operationId: input.operationId,
        requestBytes,
        chainId,
      });
    }

    return this.ctx.storage.transactionSync(() => {
      const profile = this.requireCloudflareOperatorProfile();
      const nowMs = this.observeCloudflareOperatorUtc(profile);
      if (
        profile.environment !== "production" ||
        profile.chain_id !== chainId ||
        profile.writer_pending === 1 ||
        profile.current_state_json === null ||
        this.hasRetainedIssueBlockers()
      ) {
        return { status: "CONFLICT" as const };
      }
      const currentState = decodeCloudflareOperatorBinding(
        profile.current_state_json,
      );
      const head = this.readReleaseLedgerHeadRow();
      const releaseOperation = this.findReleaseOperation(
        currentState.releaseOperationId,
      );
      if (
        currentState.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
        currentState.environment !== "production" ||
        currentState.chainId !== chainId ||
        nowMs < currentState.manifestNotBeforeMs ||
        nowMs >= currentState.manifestExpiresAtMs ||
        head === null ||
        releaseOperation === null ||
        releaseOperation.status !== "AVAILABLE" ||
        releaseOperation.fencing_token !== currentState.releaseFencingToken ||
        !releaseHeadMatchesOperatorBinding(head, currentState)
      ) {
        return { status: "CONFLICT" as const };
      }
      const duplicateNonce = this.sql.exec<{ readonly operation_id: string }>(
        `SELECT operation_id FROM cloudflare_operator_issue_operations
         WHERE environment = 'production' AND chain_id = ?
           AND audience_manifest_url_sha256 = ? AND request_nonce = ?
         LIMIT 1`,
        chainId,
        audienceManifestUrlSha256,
        challenge.request_nonce,
      ).toArray()[0];
      if (duplicateNonce !== undefined) return { status: "CONFLICT" as const };

      const fencingToken = incrementCounter(profile.next_fencing_token);
      const signerOperationId =
        `cloudflare-operator-freshness:${input.operationId}`;
      const operation: CloudflareOperatorIssueOperationBinding = {
        profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
        operationId: input.operationId,
        signerOperationId,
        requestSha256,
        requestNonce: challenge.request_nonce,
        environment: "production",
        chainId,
        audienceManifestUrlSha256,
      };
      this.sql.exec(
        `INSERT INTO cloudflare_operator_issue_operations (
           operation_id, profile_id, signer_operation_id, request_bytes, request_sha256,
           request_nonce, environment, chain_id,
           audience_manifest_url_sha256, status, blocker, fencing_token,
           signing_claimed, current_state_json, response_bytes, response_length,
           response_sha256, rejection_reason
         ) VALUES (?, ?, ?, ?, ?, ?, 'production', ?, ?, 'IN_PROGRESS',
                   'RETAINED', ?, 0, ?, NULL, NULL, NULL, NULL)`,
        input.operationId,
        CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
        signerOperationId,
        arrayBufferFromBytes(requestBytes),
        requestSha256,
        challenge.request_nonce,
        chainId,
        audienceManifestUrlSha256,
        fencingToken,
        JSON.stringify(currentState),
      );
      this.sql.exec(
        `UPDATE freshness_profile
         SET next_fencing_token = ?
         WHERE singleton = 1`,
        fencingToken,
      );
      return {
        status: "ACQUIRED" as const,
        operation,
        fencingToken,
        currentState,
      };
    });
  }

  async claimCloudflareOperatorIssueSigning(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<CloudflareOperatorIssueSigningClaim> {
    const prepared =
      await this.prepareCloudflareOperatorIssueSigningAuthorization(input);
    return this.ctx.storage.transactionSync(() => {
      const { operation } = prepared.authorization;
      const row = this.findCloudflareOperatorIssue(operation.operationId);
      if (row === null) return { status: "REJECTED", reason: "NOT_FOUND" };
      if (
        !cloudflareOperatorIssueMatches(row, operation) ||
        row.fencing_token !== prepared.authorization.fencingToken ||
        row.request_sha256 !== prepared.requestSha256 ||
        row.request_nonce !== prepared.challenge.request_nonce ||
        row.environment !== "production" ||
        row.chain_id !== this.requireReleaseChainId() ||
        row.audience_manifest_url_sha256 !==
          prepared.audienceManifestUrlSha256 ||
        !equalBytes(
          bytesFromArrayBuffer(row.request_bytes),
          prepared.authorization.requestBytes,
        )
      ) {
        return { status: "CONFLICT" };
      }
      if (row.status === "RESULT_UNKNOWN") {
        return { status: "RESULT_UNKNOWN" };
      }
      if (row.status === "FINALIZED") return { status: "FINALIZED" };
      if (row.status === "REJECTED") return { status: "REJECTED" };
      if (row.signing_claimed === 1) {
        return { status: "ALREADY_CLAIMED" };
      }
      const profile = this.requireCloudflareOperatorProfile();
      const nowMs = this.observeCloudflareOperatorUtc(profile);
      this.requireCloudflareOperatorIssueSigningAuthorizationInTransaction(
        prepared,
        false,
        profile,
        nowMs,
      );
      this.sql.exec(
        `UPDATE cloudflare_operator_issue_operations
         SET signing_claimed = 1
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND blocker = 'RETAINED' AND fencing_token = ?
           AND signing_claimed = 0`,
        operation.operationId,
        prepared.authorization.fencingToken,
      );
      const claimed = this.requireCloudflareOperatorIssue(
        operation.operationId,
      );
      if (claimed.signing_claimed !== 1) {
        throw corruptStorage("Cloudflare/operator signing claim was not persisted");
      }
      return { status: "CLAIMED" };
    });
  }

  async getCloudflareOperatorIssue(input: {
    readonly operationId: string;
    readonly requestBytes: Uint8Array;
    readonly chainId: string;
  }): Promise<CloudflareOperatorIssueAdmission> {
    assertUuid(input.operationId, "Cloudflare/operator issue operation ID");
    if (
      !(input.requestBytes instanceof Uint8Array) ||
      input.requestBytes.byteLength === 0 ||
      input.requestBytes.byteLength > 1_024
    ) {
      throw invalidInput("Freshness request bytes are empty or exceed the wire limit");
    }
    const row = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorIssue(input.operationId),
    );
    if (row === null) return { status: "REJECTED", reason: "NOT_FOUND" };
    const requestBytes = copyBytes(input.requestBytes);
    const requestSha256 = await sha256Base64Url(requestBytes);
    if (
      row.request_sha256 !== requestSha256 ||
      !equalBytes(bytesFromArrayBuffer(row.request_bytes), requestBytes) ||
      row.chain_id !== input.chainId ||
      row.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID
    ) {
      return { status: "CONFLICT" };
    }
    const operation = cloudflareOperatorIssueBindingFromRow(row);
    if (row.status !== "FINALIZED") {
      return cloudflareOperatorIssueAdmissionFromRow(row);
    }
    if (
      row.response_bytes === null ||
      row.response_length === null ||
      row.response_sha256 === null
    ) {
      throw corruptStorage("Finalized Cloudflare/operator issue has no exact response bytes");
    }
    const responseBytes = bytesFromArrayBuffer(row.response_bytes);
    if (
      responseBytes.byteLength !== row.response_length ||
      await sha256Base64Url(responseBytes) !== row.response_sha256
    ) {
      throw corruptStorage("Finalized Cloudflare/operator response bytes are corrupt");
    }
    const currentState = decodeCloudflareOperatorBinding(row.current_state_json);
    const nowMs = runtimeUtcNow();
    if (
      nowMs < currentState.manifestNotBeforeMs ||
      nowMs >= currentState.manifestExpiresAtMs
    ) {
      return {
        status: "EXPIRED",
        operation,
        reason: "Installed Manifest is outside its current validity interval",
      };
    }
    try {
      const verified = await verifyCloudflareOperatorFreshnessResponse({
        raw: responseBytes,
        bootstrapSigner: this.requireReleaseRootSigner(),
        manifestUrl: this.requireFreshnessManifestUrl(),
        requestBytes,
        nowMs,
        expectedState: currentState,
      });
      if (
        verified.expiresAtMs <= nowMs ||
        verified.freshnessDelegation.notAfterMs <= nowMs
      ) {
        return {
          status: "EXPIRED",
          operation,
          reason: "Finalized Freshness response or delegation has expired",
        };
      }
    } catch (error) {
      if (
        error instanceof RuntimeConfigDomainError &&
        error.code === "INVALID_TIME"
      ) {
        return {
          status: "EXPIRED",
          operation,
          reason: "Finalized Freshness response is outside its current validity window",
        };
      }
      throw error;
    }
    return {
      status: "FINALIZED",
      operation,
      fencingToken: row.fencing_token,
      currentState,
      responseBytes: Uint8Array.from(responseBytes),
      responseSha256: row.response_sha256,
    };
  }

  async markCloudflareOperatorIssueUnknown(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
  }): Promise<CloudflareOperatorIssueAdmission> {
    assertCloudflareOperatorIssueBinding(input.operation);
    return this.ctx.storage.transactionSync(() => {
      const row = this.requireCloudflareOperatorIssue(input.operation.operationId);
      if (!cloudflareOperatorIssueMatches(row, input.operation)) {
        return { status: "CONFLICT" as const };
      }
      if (row.status === "RESULT_UNKNOWN") {
        return cloudflareOperatorIssueAdmissionFromRow(row);
      }
      if (
        row.status !== "IN_PROGRESS" ||
        row.fencing_token !== input.fencingToken
      ) {
        return cloudflareOperatorIssueAdmissionFromRow(row);
      }
      this.sql.exec(
        `UPDATE cloudflare_operator_issue_operations
         SET status = 'RESULT_UNKNOWN', blocker = 'RETAINED'
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND fencing_token = ?`,
        input.operation.operationId,
        input.fencingToken,
      );
      return cloudflareOperatorIssueAdmissionFromRow(
        this.requireCloudflareOperatorIssue(input.operation.operationId),
      );
    });
  }

  async rejectCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly reason: string;
  }): Promise<CloudflareOperatorIssueAdmission> {
    assertCloudflareOperatorIssueBinding(input.operation);
    if (input.reason.length === 0 || input.reason.length > 512) {
      throw invalidInput("Cloudflare/operator issue rejection reason is invalid");
    }
    return this.ctx.storage.transactionSync(() => {
      const row = this.requireCloudflareOperatorIssue(input.operation.operationId);
      if (!cloudflareOperatorIssueMatches(row, input.operation)) {
        return { status: "CONFLICT" as const };
      }
      if (row.status === "REJECTED") {
        return cloudflareOperatorIssueAdmissionFromRow(row);
      }
      if (
        row.status !== "IN_PROGRESS" ||
        row.fencing_token !== input.fencingToken
      ) {
        return cloudflareOperatorIssueAdmissionFromRow(row);
      }
      this.sql.exec(
        `UPDATE cloudflare_operator_issue_operations
         SET status = 'REJECTED', blocker = 'CLEARED',
             rejection_reason = ?
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND fencing_token = ?`,
        input.reason,
        input.operation.operationId,
        input.fencingToken,
      );
      return cloudflareOperatorIssueAdmissionFromRow(
        this.requireCloudflareOperatorIssue(input.operation.operationId),
      );
    });
  }

  async finalizeCloudflareOperatorIssue(input: {
    readonly operation: CloudflareOperatorIssueOperationBinding;
    readonly fencingToken: string;
    readonly currentStateSha256: string;
    readonly responseBytes: Uint8Array;
  }): Promise<CloudflareOperatorIssueAdmission> {
    assertCloudflareOperatorIssueBinding(input.operation);
    if (
      !SHA256_BASE64URL_PATTERN.test(input.currentStateSha256) ||
      !(input.responseBytes instanceof Uint8Array) ||
      input.responseBytes.byteLength === 0 ||
      input.responseBytes.byteLength > runtimeConfigFreshnessWire.maxResponseBytes
    ) {
      throw invalidInput("Cloudflare/operator issue finalization input is invalid");
    }
    const row = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorIssue(input.operation.operationId),
    );
    if (row === null || !cloudflareOperatorIssueMatches(row, input.operation)) {
      return { status: "CONFLICT" };
    }
    if (
      row.status !== "IN_PROGRESS" ||
      row.blocker !== "RETAINED" ||
      row.fencing_token !== input.fencingToken ||
      row.signing_claimed !== 1
    ) {
      return cloudflareOperatorIssueAdmissionFromRow(row);
    }
    const responseBytes = copyBytes(input.responseBytes);
    const responseSha256 = await sha256Base64Url(responseBytes);
    const requestBytes = bytesFromArrayBuffer(row.request_bytes);
    const operationState = decodeCloudflareOperatorBinding(row.current_state_json);
    const latestState = await this.readCloudflareOperatorVerifiedReleaseState({
      operation: input.operation,
      fencingToken: input.fencingToken,
      requestBytes,
      currentState: operationState,
    });
    if (
      latestState.state.stateSha256 !== input.currentStateSha256 ||
      !sameCloudflareOperatorBinding(latestState.state, operationState)
    ) {
      return this.rejectCloudflareOperatorIssue({
        operation: input.operation,
        fencingToken: input.fencingToken,
        reason: "Current Release state changed before exact finalization",
      });
    }
    const challenge = await verifyRuntimeConfigFreshnessRequest(requestBytes, {
      environment: "production",
      audienceManifestUrlSha256:
        input.operation.audienceManifestUrlSha256,
    });
    const verifiedResponse = await verifyRuntimeConfigFreshnessResponse({
      raw: responseBytes,
      bootstrapSigner: this.requireReleaseRootSigner(),
      manifestUrl: this.requireFreshnessManifestUrl(),
      request: challenge,
      nowMs: runtimeUtcNow(),
    });
    if (
      verifiedResponse.releaseCommit.digest !== operationState.recordSha256 ||
      verifiedResponse.payload.request_nonce !== input.operation.requestNonce
    ) {
      return this.rejectCloudflareOperatorIssue({
        operation: input.operation,
        fencingToken: input.fencingToken,
        reason: "Signed response does not match the admitted request and Release",
      });
    }

    return this.ctx.storage.transactionSync(() => {
      const stored = this.requireCloudflareOperatorIssue(
        input.operation.operationId,
      );
      if (stored.status === "FINALIZED") {
        return cloudflareOperatorIssueAdmissionFromRow(stored);
      }
      const profile = this.requireCloudflareOperatorProfile();
      const nowMs = this.observeCloudflareOperatorUtc(profile);
      const currentState = profile.current_state_json === null
        ? null
        : decodeCloudflareOperatorBinding(profile.current_state_json);
      const head = this.readReleaseLedgerHeadRow();
      const releaseOperation = this.findReleaseOperation(
        operationState.releaseOperationId,
      );
      if (
        stored.status !== "IN_PROGRESS" ||
        stored.blocker !== "RETAINED" ||
        stored.signing_claimed !== 1 ||
        stored.fencing_token !== input.fencingToken ||
        !cloudflareOperatorIssueMatches(stored, input.operation) ||
        !sameCloudflareOperatorBinding(operationState, currentState) ||
        currentState === null ||
        currentState.stateSha256 !== input.currentStateSha256 ||
        profile.writer_pending === 1 ||
        releaseOperation === null ||
        releaseOperation.status !== "AVAILABLE" ||
        releaseOperation.fencing_token !== currentState.releaseFencingToken ||
        head === null ||
        !releaseHeadMatchesOperatorBinding(head, currentState) ||
        currentState.manifestNotBeforeMs > currentState.manifestExpiresAtMs
      ) {
        return cloudflareOperatorIssueAdmissionFromRow(
          this.quarantineCloudflareOperatorIssueInTransaction(
            stored,
            "Issue fence, current state, or Release head changed before finalization",
          ),
        );
      }
      if (
        nowMs < currentState.manifestNotBeforeMs ||
        nowMs >= currentState.manifestExpiresAtMs ||
        verifiedResponse.expiresAtMs <= nowMs ||
        verifiedResponse.freshnessDelegation.notAfterMs <= nowMs
      ) {
        this.sql.exec(
          `UPDATE cloudflare_operator_issue_operations
           SET status = 'REJECTED', blocker = 'CLEARED',
               rejection_reason = 'Signed response expired before finalization'
           WHERE operation_id = ? AND status = 'IN_PROGRESS'
             AND fencing_token = ?`,
          input.operation.operationId,
          input.fencingToken,
        );
        return cloudflareOperatorIssueAdmissionFromRow(
          this.requireCloudflareOperatorIssue(input.operation.operationId),
        );
      }
      this.sql.exec(
        `UPDATE cloudflare_operator_issue_operations
         SET status = 'FINALIZED', blocker = 'CLEARED',
             response_bytes = ?, response_length = ?, response_sha256 = ?,
             rejection_reason = NULL
         WHERE operation_id = ? AND status = 'IN_PROGRESS'
           AND blocker = 'RETAINED' AND fencing_token = ?`,
        arrayBufferFromBytes(responseBytes),
        responseBytes.byteLength,
        responseSha256,
        input.operation.operationId,
        input.fencingToken,
      );
      return cloudflareOperatorIssueAdmissionFromRow(
        this.requireCloudflareOperatorIssue(input.operation.operationId),
      );
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
        state.restoreEpoch === state.witness.restoreEpoch &&
        this.releaseHeadAvailableInTransaction(state.currentState);
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
        !this.releaseHeadAvailableInTransaction(state.currentState) ||
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

  async readCurrentStateSnapshot(input: {
    readonly operation: FreshnessIssueOperationBinding;
    readonly lease: FreshnessIssueLeaseBinding;
  }): Promise<FreshnessIssueCoordinatorSnapshot> {
    assertLeaseShape(input.lease);
    return this.ctx.storage.transactionSync(() => {
      const stateRow = this.readStateRow();
      if (!stateRow) {
        throw new FreshnessIssueCoordinatorStorageError(
          "NOT_INITIALIZED",
          "Coordinator current state is not initialized",
        );
      }
      const state = this.decodeCoordinatorState(stateRow);
      const row = this.findOperation(input.operation.operationId);
      if (!row) {
        throw invalidInput("Current-state snapshot operation does not exist");
      }
      const operation = operationFromRow(row);
      const lease = leaseFromRow(row);
      if (
        !sameOperation(operation, input.operation) ||
        !lease ||
        !sameLease(lease, input.lease)
      ) {
        throw invalidInput("Current-state snapshot operation or lease does not match");
      }
      if (
        operationStatusFromRow(row) !== "IN_PROGRESS" ||
        blockerFromRow(row) !== "RETAINED"
      ) {
        throw transitionError(
          "Current-state snapshot requires an in-progress retained issue",
        );
      }
      const reading = clockFromState(stateRow);
      if (
        state.writerPending ||
        compareCounters(lease.fencingToken, state.writeFencingToken) <= 0 ||
        !this.releaseHeadAvailableInTransaction(state.currentState) ||
        !sameStateBinding(state.currentState, lease.currentState) ||
        !sameWitness(state.currentState.antiRollbackWitness, state.witness) ||
        state.restoreEpoch !== state.witness.restoreEpoch ||
        !clockMatchesLease(reading, lease)
      ) {
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_BLOCKED",
          "Current Release state or issue lease is not eligible for a snapshot",
        );
      }

      const currentState = copyCurrentStateBinding(state.currentState);
      const copiedLease = copyLeaseBinding(lease);
      return Object.freeze({
        operation: { ...operation },
        lease: copiedLease,
        operationStatus: "IN_PROGRESS",
        blocker: "RETAINED",
        environment: state.environment,
        currentState,
        witness: { ...state.witness },
        restoreEpoch: state.restoreEpoch,
        writerPending: state.writerPending,
      });
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
        !this.releaseHeadAvailableInTransaction(state.currentState) ||
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

  private requireReleaseChainId(): string {
    const chainId = this.#env.RELEASE_LEDGER_CHAIN_ID;
    if (
      typeof chainId !== "string" ||
      chainId.length === 0 ||
      chainId.trim() !== chainId
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Release ledger chain identity is not configured",
      );
    }
    return chainId;
  }

  private releaseLedgerConfigured(): boolean {
    return (
      this.#env.RELEASE_LEDGER_CHAIN_ID !== undefined ||
      this.#env.RELEASE_LEDGER_ROOT_KEY_ID !== undefined ||
      this.#env.RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI !== undefined ||
      this.#env.RELEASE_LEDGER_MANIFEST_KEY_ID !== undefined ||
      this.#env.RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI !== undefined ||
      this.#env.RELEASE_LEDGER_R2 !== undefined
    );
  }

  private releaseHeadAvailableInTransaction(
    currentState: FreshnessIssueCurrentStateBinding,
  ): boolean {
    if (!this.releaseLedgerConfigured()) return true;
    const head = this.readReleaseLedgerHeadRow();
    if (head === null) return false;
    const operation = this.requireReleaseOperation(head.operation_id);
    return (
      operation.status === "AVAILABLE" &&
      coordinatorStateMatchesReleaseHead(currentState, head)
    );
  }

  private assertCloudflareOperatorGenesisCapability(
    supplied: string,
  ): void {
    const expected = this.#env.FRESHNESS_GENESIS_ADMIN_CAPABILITY;
    if (
      typeof expected !== "string" ||
      !GENESIS_ADMIN_CAPABILITY_PATTERN.test(expected)
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Cloudflare/operator genesis capability is not configured",
      );
    }
    if (
      typeof supplied !== "string" ||
      !GENESIS_ADMIN_CAPABILITY_PATTERN.test(supplied)
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "PROFILE_MISMATCH",
        "Cloudflare/operator genesis capability is invalid",
      );
    }
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
    }
    if (difference !== 0) {
      throw new FreshnessIssueCoordinatorStorageError(
        "PROFILE_MISMATCH",
        "Cloudflare/operator genesis capability is invalid",
      );
    }
  }

  private async prepareCloudflareOperatorGenesis(
    input: CloudflareOperatorGenesisInput,
  ): Promise<PreparedCloudflareOperatorGenesis> {
    if (
      input === null ||
      typeof input !== "object" ||
      !(input.recordBytes instanceof Uint8Array) ||
      !(input.releaseDelegationBytes instanceof Uint8Array) ||
      !(input.manifestBytes instanceof Uint8Array) ||
      input.recordBytes.byteLength === 0 ||
      input.recordBytes.byteLength > GENESIS_MAX_RECORD_BYTES ||
      input.releaseDelegationBytes.byteLength === 0 ||
      input.releaseDelegationBytes.byteLength > GENESIS_MAX_DELEGATION_BYTES ||
      input.manifestBytes.byteLength === 0 ||
      input.manifestBytes.byteLength > GENESIS_MAX_MANIFEST_BYTES
    ) {
      throw invalidInput("Cloudflare/operator genesis material is invalid");
    }

    const approval = await this.requireCloudflareOperatorGenesisApproval();
    const copiedInput = {
      recordBytes: copyBytes(input.recordBytes),
      releaseDelegationBytes: copyBytes(input.releaseDelegationBytes),
      manifestBytes: copyBytes(input.manifestBytes),
    };
    const recordSha256 = await sha256Base64Url(copiedInput.recordBytes);
    const releaseDelegationSha256 = await sha256Base64Url(
      copiedInput.releaseDelegationBytes,
    );
    const manifestSha256 = await sha256Base64Url(copiedInput.manifestBytes);
    if (
      recordSha256 !== approval.release_record_sha256 ||
      releaseDelegationSha256 !== approval.release_delegation_sha256 ||
      manifestSha256 !== approval.manifest_sha256
    ) {
      throw invalidInput(
        "Cloudflare/operator genesis material does not match the fixed approval",
      );
    }

    const approvalBytes = canonicalJsonBytes(approval);
    const approvalSha256 = await sha256Base64Url(approvalBytes);
    const operationId = await cloudflareOperatorGenesisOperationId(
      approvalBytes,
    );
    const requestSha256 = await sha256Base64Url(
      canonicalJsonBytes({
        scope: "fusou-cloudflare-operator-genesis-request-v1",
        operationId,
        approvalSha256,
        recordLength: copiedInput.recordBytes.byteLength,
        recordSha256,
        releaseDelegationLength:
          copiedInput.releaseDelegationBytes.byteLength,
        releaseDelegationSha256,
        manifestLength: copiedInput.manifestBytes.byteLength,
        manifestSha256,
      }),
    );
    return {
      approval,
      approvalSha256,
      operationId,
      requestSha256,
      input: copiedInput,
    };
  }

  private async requireCloudflareOperatorGenesisApproval():
    Promise<CloudflareOperatorGenesisApproval> {
    const raw = this.#env.FRESHNESS_GENESIS_APPROVAL_JSON;
    if (typeof raw !== "string" || raw.length === 0) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Cloudflare/operator genesis approval is not configured",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw invalidInput("Cloudflare/operator genesis approval is malformed");
    }
    if (!isRecord(parsed)) {
      throw invalidInput("Cloudflare/operator genesis approval is not an object");
    }
    const actualFields = Object.keys(parsed).sort();
    if (
      actualFields.length !== GENESIS_APPROVAL_FIELDS.length ||
      actualFields.some((field, index) => field !== GENESIS_APPROVAL_FIELDS[index]) ||
      !equalBytes(
        new TextEncoder().encode(raw),
        canonicalJsonBytes(parsed),
      )
    ) {
      throw invalidInput(
        "Cloudflare/operator genesis approval is not exact canonical JSON",
      );
    }

    const stringField = (name: string): string => {
      const value = parsed[name];
      if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
        throw invalidInput(
          `Cloudflare/operator genesis approval field ${name} is invalid`,
        );
      }
      return value;
    };
    if (
      parsed.schema_version !== 1 ||
      parsed.scope !== "fusou-cloudflare-operator-genesis-v1" ||
      parsed.environment !== "production" ||
      parsed.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
      parsed.initial_position !== "1" ||
      parsed.initial_generation !== "1" ||
      parsed.release_record_manifest_schema_version !== 2
    ) {
      throw invalidInput(
        "Cloudflare/operator genesis approval has an unsupported scope or initial position",
      );
    }

    const approval: CloudflareOperatorGenesisApproval = {
      schema_version: 1,
      scope: "fusou-cloudflare-operator-genesis-v1",
      environment: "production",
      profile_id: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
      coordinator_name: stringField("coordinator_name"),
      coordinator_id: stringField("coordinator_id"),
      chain_id: stringField("chain_id"),
      restore_epoch: stringField("restore_epoch"),
      initial_position: "1",
      initial_generation: "1",
      release_record_sha256: stringField("release_record_sha256"),
      release_delegation_sha256: stringField("release_delegation_sha256"),
      release_record_manifest_schema_version: 2,
      manifest_epoch: stringField("manifest_epoch"),
      manifest_sha256: stringField("manifest_sha256"),
      manifest_ref: stringField("manifest_ref"),
      manifest_url: stringField("manifest_url"),
      audience_manifest_url_sha256: stringField(
        "audience_manifest_url_sha256",
      ),
      release_root_key_id: stringField("release_root_key_id"),
      release_root_public_key_spki: stringField(
        "release_root_public_key_spki",
      ),
      manifest_root_key_id: stringField("manifest_root_key_id"),
      manifest_root_public_key_spki: stringField(
        "manifest_root_public_key_spki",
      ),
    };
    if (
      !GENESIS_COORDINATOR_ID_PATTERN.test(approval.coordinator_id) ||
      !GENESIS_CHAIN_ID_PATTERN.test(approval.chain_id) ||
      !GENESIS_KEY_ID_PATTERN.test(approval.release_root_key_id) ||
      !GENESIS_KEY_ID_PATTERN.test(approval.manifest_root_key_id) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(approval.coordinator_name) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(approval.restore_epoch) ||
      !SHA256_BASE64URL_PATTERN.test(approval.release_record_sha256) ||
      !SHA256_BASE64URL_PATTERN.test(approval.release_delegation_sha256) ||
      !SHA256_BASE64URL_PATTERN.test(approval.manifest_sha256) ||
      !SHA256_BASE64URL_PATTERN.test(approval.audience_manifest_url_sha256) ||
      !/^[A-Za-z0-9_-]+$/u.test(approval.release_root_public_key_spki) ||
      !/^[A-Za-z0-9_-]+$/u.test(approval.manifest_root_public_key_spki) ||
      approval.manifest_ref !==
        `${runtimeConfigFreshnessWire.immutableManifestPrefix}${approval.manifest_sha256}` ||
      !/^[1-9][0-9]*$/u.test(approval.manifest_epoch)
    ) {
      throw invalidInput("Cloudflare/operator genesis approval binding is invalid");
    }
    parseCanonicalUnsignedDecimal(approval.manifest_epoch, "genesis Manifest epoch");

    const expectedCoordinatorName = this.#env.FRESHNESS_COORDINATOR_NAME;
    if (
      typeof expectedCoordinatorName !== "string" ||
      approval.coordinator_name !== expectedCoordinatorName ||
      approval.coordinator_id !== this.ctx.id.toString() ||
      approval.chain_id !== this.requireReleaseChainId() ||
      approval.manifest_url !== this.requireFreshnessManifestUrl() ||
      approval.release_root_key_id !== this.#env.RELEASE_LEDGER_ROOT_KEY_ID ||
      approval.release_root_public_key_spki !==
        this.#env.RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI ||
      approval.manifest_root_key_id !== this.#env.RELEASE_LEDGER_MANIFEST_KEY_ID ||
      approval.manifest_root_public_key_spki !==
        this.#env.RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "PROFILE_MISMATCH",
        "Cloudflare/operator genesis approval does not match the configured target",
      );
    }
    const audienceSha256 = await runtimeConfigManifestAudienceSha256(
      approval.manifest_url,
    );
    if (audienceSha256 !== approval.audience_manifest_url_sha256) {
      throw invalidInput(
        "Cloudflare/operator genesis Manifest audience pin is invalid",
      );
    }
    return approval;
  }

  private async verifyCloudflareOperatorGenesisMaterial(
    prepared: PreparedCloudflareOperatorGenesis,
  ): Promise<VerifiedCloudflareOperatorGenesis> {
    const { approval, input } = prepared;
    const nowMs = runtimeUtcNow();
    const manifest = await this.verifyManifestPointer(input.manifestBytes);
    const manifestSha256 = await sha256Base64Url(input.manifestBytes);
    if (
      manifestSha256 !== approval.manifest_sha256 ||
      manifest.manifestSha256 !== approval.manifest_sha256 ||
      manifest.epoch !== approval.manifest_epoch ||
      manifest.notBeforeMs > nowMs ||
      manifest.expiresAtMs <= nowMs
    ) {
      throw new RuntimeConfigR2ReleaseIntegrityError(
        "Genesis Manifest does not match the approved active Manifest",
      );
    }

    const record = await verifyRuntimeConfigReleaseCommitRecord({
      raw: input.recordBytes,
      rootSigner: this.requireReleaseRootSigner(),
      environment: "production",
      releaseDelegationRaw: input.releaseDelegationBytes,
      appendedAt: timestampFromMilliseconds(nowMs),
    });
    const releaseDelegationSha256 = await sha256Base64Url(
      input.releaseDelegationBytes,
    );
    if (
      record.digest !== approval.release_record_sha256 ||
      releaseDelegationSha256 !== approval.release_delegation_sha256 ||
      record.payload.environment !== "production" ||
      record.payload.commit_generation !== approval.initial_generation ||
      record.payload.previous_commit_generation !== null ||
      record.payload.previous_commit_record_sha256 !== null ||
      record.payload.manifest_schema_version !==
        approval.release_record_manifest_schema_version ||
      record.payload.manifest_epoch !== manifest.epoch ||
      record.payload.manifest_sha256 !== manifest.manifestSha256 ||
      record.payload.manifest_ref !== approval.manifest_ref
    ) {
      throw new RuntimeConfigR2ReleaseIntegrityError(
        "Genesis Release Record does not match the approved initial Release",
      );
    }

    const readback = await this.requireReleaseStore().verifyExactReadback({
      manifestRef: approval.manifest_ref,
      manifestBytes: input.manifestBytes,
      pointerEtag: record.payload.pointer_etag,
    });
    if (
      !equalBytes(readback.pointerBytes, input.manifestBytes) ||
      !equalBytes(readback.snapshotBytes, input.manifestBytes)
    ) {
      throw new RuntimeConfigR2ReleaseIntegrityError(
        "Genesis R2 pointer and immutable snapshot do not match exact Manifest bytes",
      );
    }
    const verifiedAtMs = runtimeUtcNow();
    if (
      verifiedAtMs < manifest.notBeforeMs ||
      verifiedAtMs >= manifest.expiresAtMs ||
      verifiedAtMs < record.delegation.notBeforeMs ||
      verifiedAtMs >= record.delegation.notAfterMs
    ) {
      throw new RuntimeConfigDomainError(
        "INVALID_TIME",
        "Genesis materials expired during verification",
      );
    }
    return {
      manifest,
      record,
      pointerEtag: readback.pointerEtag,
    };
  }

  private admitCloudflareOperatorGenesis(
    prepared: PreparedCloudflareOperatorGenesis,
    verified: VerifiedCloudflareOperatorGenesis,
  ): boolean {
    if (this.findCloudflareOperatorGenesis() !== null) return false;
    if (!this.cloudflareOperatorGenesisStateIsPristine()) return false;

    const nowMs = runtimeUtcNow();
    if (
      nowMs < verified.manifest.notBeforeMs ||
      nowMs >= verified.manifest.expiresAtMs ||
      nowMs < verified.record.delegation.notBeforeMs ||
      nowMs >= verified.record.delegation.notAfterMs
    ) {
      throw new RuntimeConfigDomainError(
        "INVALID_TIME",
        "Genesis materials expired before durable admission",
      );
    }
    const { approval, input, operationId, requestSha256, approvalSha256 } =
      prepared;
    const manifestBytes = arrayBufferFromBytes(input.manifestBytes);
    this.sql.exec(
      `INSERT INTO cloudflare_operator_genesis_operations (
         singleton, operation_id, request_sha256, approval_sha256,
         record_bytes, release_delegation_bytes, manifest_bytes,
         restore_epoch, status, reason, created_at_ms
       ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'ADMITTED', NULL, ?)`,
      operationId,
      requestSha256,
      approvalSha256,
      arrayBufferFromBytes(input.recordBytes),
      arrayBufferFromBytes(input.releaseDelegationBytes),
      manifestBytes,
      approval.restore_epoch,
      nowMs,
    );
    this.sql.exec(
      `INSERT INTO freshness_profile (
         singleton, profile_id, environment, chain_id, current_state_json,
         local_restore_epoch, last_observed_utc_ms, next_fencing_token,
         write_fencing_token, writer_pending, writer_operation_id
       ) VALUES (1, ?, 'production', ?, NULL, ?, ?, '1', '1', 1, ?)`,
      CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
      approval.chain_id,
      approval.restore_epoch,
      nowMs,
      operationId,
    );
    this.sql.exec(
      `INSERT INTO release_ledger_operations (
         operation_id, request_sha256, environment, chain_id, status,
         reason, unknown_stage, resume_status, fencing_token,
         expected_position, expected_generation, expected_record_sha256,
         expected_pointer_etag, manifest_bytes, manifest_length,
         manifest_sha256, manifest_epoch, manifest_ref,
         pointer_bytes, pointer_etag, snapshot_bytes
       ) VALUES (?, ?, 'production', ?, 'R2_STAGED', NULL, NULL, NULL, '1',
                 NULL, NULL, NULL, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      operationId,
      requestSha256,
      approval.chain_id,
      manifestBytes,
      input.manifestBytes.byteLength,
      approval.manifest_sha256,
      approval.manifest_epoch,
      approval.manifest_ref,
      manifestBytes,
      verified.pointerEtag,
      manifestBytes,
    );
    return true;
  }

  private async resumeCloudflareOperatorGenesis(
    prepared: PreparedCloudflareOperatorGenesis,
  ): Promise<CloudflareOperatorGenesisOperation> {
    let genesis = this.ctx.storage.transactionSync(() =>
      this.findCloudflareOperatorGenesis(prepared.operationId),
    );
    if (genesis === null || !this.genesisInputMatches(genesis, prepared)) {
      return genesisConflict(prepared.operationId);
    }
    if (genesis.status === "QUARANTINED") {
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }

    let release = await this.getReleaseOperation(prepared.operationId);
    if (
      release === null ||
      release.requestSha256 !== prepared.requestSha256 ||
      !equalBytes(release.manifestBytes, prepared.input.manifestBytes)
    ) {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "QUARANTINED",
        "RELEASE_OPERATION_MISMATCH",
      );
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }

    if (release.status === "R2_STAGED") {
      try {
        await this.verifyCloudflareOperatorGenesisMaterial(prepared);
      } catch (error) {
        if (
          error instanceof RuntimeConfigDomainError ||
          error instanceof RuntimeConfigR2ReleaseIntegrityError
        ) {
          if (release.fencingToken === null) {
            throw corruptStorage(
              "Genesis Release operation is missing its fencing token",
            );
          }
          await this.quarantineReleaseOperation(
            prepared.operationId,
            release.fencingToken,
            "Genesis materials failed verification after durable admission",
          );
          this.updateCloudflareOperatorGenesisStatus(
            prepared.operationId,
            "QUARANTINED",
            "MATERIAL_VERIFICATION_FAILED",
          );
          return this.readCloudflareOperatorGenesisOperation(
            prepared.operationId,
          );
        }
        throw error;
      }

      try {
        const appended = await this.appendReleaseRecord({
          operationId: prepared.operationId,
          fencingToken: requireFencingToken(release),
          recordBytes: prepared.input.recordBytes,
          releaseDelegationBytes: prepared.input.releaseDelegationBytes,
        });
        if (
          appended.status === "QUARANTINED" ||
          appended.status === "CONFLICT"
        ) {
          this.updateCloudflareOperatorGenesisStatus(
            prepared.operationId,
            "QUARANTINED",
            "RELEASE_APPEND_REJECTED",
          );
          return this.readCloudflareOperatorGenesisOperation(
            prepared.operationId,
          );
        }
      } catch (error) {
        const persisted = await this.getReleaseOperation(prepared.operationId);
        if (persisted?.status === "QUARANTINED") {
          this.updateCloudflareOperatorGenesisStatus(
            prepared.operationId,
            "QUARANTINED",
            "RELEASE_APPEND_QUARANTINED",
          );
          return this.readCloudflareOperatorGenesisOperation(
            prepared.operationId,
          );
        }
        throw error;
      }
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "LEDGER_COMMITTED",
      );
      release = await this.getReleaseOperation(prepared.operationId);
      if (release === null) {
        throw corruptStorage("Genesis Release operation disappeared after append");
      }
    }

    if (
      release.status === "LEDGER_COMMITTED" ||
      release.status === "R2_READBACK_PENDING" ||
      (release.status === "RESULT_UNKNOWN" &&
        release.unknownStage === "R2_READBACK")
    ) {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        release.status === "RESULT_UNKNOWN"
          ? "RESULT_UNKNOWN"
          : "R2_READBACK_PENDING",
      );
      const readback = release.status === "RESULT_UNKNOWN"
        ? await this.reconcileReleaseOperation({
            operationId: prepared.operationId,
            fencingToken: requireFencingToken(release),
          })
        : await this.finalizeReleaseR2Readback({
            operationId: prepared.operationId,
            fencingToken: requireFencingToken(release),
          });
      if (
        readback.status === "RESULT_UNKNOWN" ||
        readback.status === "R2_READBACK_PENDING"
      ) {
        this.updateCloudflareOperatorGenesisStatus(
          prepared.operationId,
          "RESULT_UNKNOWN",
        );
        return this.readCloudflareOperatorGenesisOperation(
          prepared.operationId,
        );
      }
      if (
        readback.status === "QUARANTINED" ||
        readback.status === "CONFLICT"
      ) {
        this.updateCloudflareOperatorGenesisStatus(
          prepared.operationId,
          "QUARANTINED",
          "R2_EXACT_READBACK_REJECTED",
        );
        return this.readCloudflareOperatorGenesisOperation(
          prepared.operationId,
        );
      }
      if (readback.status === "AVAILABLE") {
        this.updateCloudflareOperatorGenesisStatus(
          prepared.operationId,
          "AVAILABLE",
        );
      }
      release = await this.getReleaseOperation(prepared.operationId);
      if (release === null) {
        throw corruptStorage(
          "Genesis Release operation disappeared after R2 readback",
        );
      }
    }

    if (release.status !== "AVAILABLE") {
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }
    const existingInstall =
      await this.ensureCloudflareOperatorGenesisBootstrapAuthorization(
        prepared,
        requireFencingToken(release),
      );
    if (existingInstall === null) {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "AVAILABLE",
      );
    } else if (existingInstall.status === "INSTALLED") {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "INSTALLED",
      );
      return this.readCloudflareOperatorGenesisOperation(
        prepared.operationId,
      );
    } else if (
      existingInstall.status === "QUARANTINED" ||
      existingInstall.status === "CONFLICT"
    ) {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "QUARANTINED",
        "BINDING_INSTALL_NOT_RESUMABLE",
      );
      return this.readCloudflareOperatorGenesisOperation(
        prepared.operationId,
      );
    } else {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "INSTALLING",
      );
    }

    const installStart = await this.beginCloudflareOperatorBindingInstall({
      operationId: prepared.operationId,
      mode: "BOOTSTRAP",
      releaseOperationId: prepared.operationId,
      expectedCurrentStateSha256: null,
      expectedRestoreEpoch: prepared.approval.restore_epoch,
    });
    if (installStart.status === "CONFLICT") {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "QUARANTINED",
        "BINDING_INSTALL_CONFLICT",
      );
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }
    if (installStart.status === "WAITING_FOR_ISSUES") {
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }
    if (installStart.status === "QUARANTINED") {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "QUARANTINED",
        "BINDING_INSTALL_QUARANTINED",
      );
      return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
    }
    if (installStart.status === "STARTED") {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "INSTALLING",
      );
    }

    if (!("operation" in installStart)) {
      throw corruptStorage("Genesis install operation is missing");
    }
    const install = installStart.operation;
    const installed = install.status === "INSTALLED"
      ? { status: "INSTALLED" as const, operation: install }
      : await this.finalizeCloudflareOperatorBindingInstall({
          operationId: prepared.operationId,
        });
    if (installed.status === "INSTALLED") {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "INSTALLED",
      );
    } else if (
      installed.status === "QUARANTINED" ||
      installed.status === "CONFLICT"
    ) {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "QUARANTINED",
        "BINDING_INSTALL_FINALIZATION_REJECTED",
      );
    } else {
      this.updateCloudflareOperatorGenesisStatus(
        prepared.operationId,
        "INSTALLING",
      );
    }
    return this.readCloudflareOperatorGenesisOperation(prepared.operationId);
  }

  private async ensureCloudflareOperatorGenesisBootstrapAuthorization(
    prepared: PreparedCloudflareOperatorGenesis,
    releaseFencingToken: string,
  ): Promise<CloudflareOperatorBindingInstallOperation | null> {
    const expectedInstallRequestSha256 = await sha256Base64Url(
      cloudflareOperatorInstallRequestBytes({
        operationId: prepared.operationId,
        mode: "BOOTSTRAP",
        releaseOperationId: prepared.operationId,
        releaseFencingToken,
        expectedCurrentStateSha256: null,
        expectedRestoreEpoch: prepared.approval.restore_epoch,
        chainId: prepared.approval.chain_id,
      }),
    );
    return this.ctx.storage.transactionSync(() => {
      const genesis = this.findCloudflareOperatorGenesis(
        prepared.operationId,
      );
      const profile = this.requireCloudflareOperatorProfile();
      const release = this.requireReleaseOperation(prepared.operationId);
      const head = this.readReleaseLedgerHeadRow();
      const existingInstall = this.findCloudflareOperatorInstall(
        prepared.operationId,
      );
      const currentHeadMatchesRelease =
        head !== null &&
        releaseHeadMatchesOperation(head, release) &&
        equalBytes(
          bytesFromArrayBuffer(head.record_bytes),
          prepared.input.recordBytes,
        ) &&
        equalBytes(
          bytesFromArrayBuffer(head.release_delegation_bytes),
          prepared.input.releaseDelegationBytes,
        );
      if (
        genesis === null ||
        !this.genesisInputMatches(genesis, prepared) ||
        genesis.status === "QUARANTINED" ||
        profile.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
        profile.environment !== "production" ||
        profile.chain_id !== prepared.approval.chain_id ||
        profile.local_restore_epoch !== prepared.approval.restore_epoch ||
        release.status !== "AVAILABLE" ||
        release.environment !== "production" ||
        release.chain_id !== prepared.approval.chain_id ||
        release.fencing_token !== releaseFencingToken ||
        !isCanonicalFencingToken(releaseFencingToken) ||
        release.record_sha256 !== prepared.approval.release_record_sha256 ||
        release.record_bytes === null ||
        !equalBytes(
          bytesFromArrayBuffer(release.record_bytes),
          prepared.input.recordBytes,
        ) ||
        release.release_delegation_bytes === null ||
        !equalBytes(
          bytesFromArrayBuffer(release.release_delegation_bytes),
          prepared.input.releaseDelegationBytes,
        ) ||
        release.position !== prepared.approval.initial_position ||
        release.generation !== prepared.approval.initial_generation ||
        release.manifest_sha256 !== prepared.approval.manifest_sha256 ||
        release.manifest_epoch !== prepared.approval.manifest_epoch ||
        release.manifest_ref !== prepared.approval.manifest_ref ||
        !equalBytes(
          bytesFromArrayBuffer(release.manifest_bytes),
          prepared.input.manifestBytes,
        ) ||
        (existingInstall?.status !== "INSTALLED" &&
          !currentHeadMatchesRelease) ||
        (existingInstall?.status !== "INSTALLED" &&
          this.hasRetainedIssueBlockers())
      ) {
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_BLOCKED",
          "Genesis Release is not eligible for binding installation",
        );
      }
      if (existingInstall !== null) {
        const existingOperation =
          cloudflareOperatorInstallFromRow(existingInstall);
        if (
          existingInstall.request_sha256 !== expectedInstallRequestSha256 ||
          existingOperation.environment !== "production" ||
          existingOperation.chainId !== prepared.approval.chain_id ||
          existingOperation.mode !== "BOOTSTRAP" ||
          existingOperation.releaseOperationId !== prepared.operationId ||
          existingOperation.releaseFencingToken !== releaseFencingToken ||
          !isCanonicalFencingToken(existingOperation.installFencingToken) ||
          existingOperation.expectedCurrentStateSha256 !== null ||
          existingOperation.expectedRestoreEpoch !==
            prepared.approval.restore_epoch ||
          existingOperation.targetPosition !==
            prepared.approval.initial_position ||
          existingOperation.targetGeneration !==
            prepared.approval.initial_generation ||
          existingOperation.targetRecordSha256 !==
            prepared.approval.release_record_sha256 ||
          this.hasOtherCloudflareOperatorInstallHistory(
            prepared.operationId,
          )
        ) {
          throw new FreshnessIssueCoordinatorStorageError(
            "RELEASE_BLOCKED",
            "Existing genesis binding install does not match the approved genesis",
          );
        }
        if (
          genesis.status === "INSTALLED" &&
          existingOperation.status !== "INSTALLED"
        ) {
          throw corruptStorage(
            "Genesis operation is installed without a finalized binding",
          );
        }
        if (
          existingOperation.status === "QUARANTINED" ||
          existingOperation.status === "CONFLICT"
        ) {
          return existingOperation;
        }
        if (existingOperation.status === "VERIFYING") {
          const authorization =
            this.readCloudflareOperatorBootstrapAuthorization();
          if (
            !["AVAILABLE", "INSTALLING", "RESULT_UNKNOWN"].includes(
              genesis.status,
            ) ||
            profile.current_state_json !== null ||
            profile.writer_pending !== 1 ||
            profile.writer_operation_id !==
              `cloudflare-operator-install:${prepared.operationId}` ||
            profile.write_fencing_token !==
              existingOperation.installFencingToken ||
            profile.next_fencing_token !==
              existingOperation.installFencingToken ||
            authorization === null ||
            authorization.operation_id !== prepared.operationId ||
            authorization.chain_id !== prepared.approval.chain_id ||
            authorization.position !== prepared.approval.initial_position ||
            authorization.generation !==
              prepared.approval.initial_generation ||
            authorization.record_sha256 !==
              prepared.approval.release_record_sha256 ||
            authorization.restore_epoch !==
              prepared.approval.restore_epoch
          ) {
            throw new FreshnessIssueCoordinatorStorageError(
              "RELEASE_BLOCKED",
              "Genesis install recovery no longer owns its authorized writer gate",
            );
          }
          return existingOperation;
        }
        if (
          !["AVAILABLE", "INSTALLING", "INSTALLED"].includes(genesis.status) ||
          profile.writer_pending !== 0 ||
          profile.writer_operation_id !== null ||
          this.readCloudflareOperatorBootstrapAuthorization() !== null ||
          profile.current_state_json === null ||
          existingInstall.installed_state_json === null
        ) {
          throw new FreshnessIssueCoordinatorStorageError(
            "RELEASE_BLOCKED",
            "Finalized genesis install does not match the durable profile state",
          );
        }
        const installedState = existingOperation.installedState;
        const currentState = decodeCloudflareOperatorBinding(
          profile.current_state_json,
        );
        const installedGeneration = BigInt(existingOperation.targetGeneration);
        const currentGeneration = BigInt(currentState.generation);
        if (
          installedState === null ||
          installedState.profileId !==
            CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
          installedState.environment !== "production" ||
          installedState.chainId !== prepared.approval.chain_id ||
          installedState.releaseOperationId !== prepared.operationId ||
          installedState.releaseFencingToken !== releaseFencingToken ||
          installedState.position !== prepared.approval.initial_position ||
          installedState.generation !==
            prepared.approval.initial_generation ||
          installedState.recordSha256 !==
            prepared.approval.release_record_sha256 ||
          installedState.localRestoreEpoch !==
            prepared.approval.restore_epoch ||
          installedState.manifestEpoch !== prepared.approval.manifest_epoch ||
          installedState.manifestSha256 !== prepared.approval.manifest_sha256 ||
          installedState.manifestRef !== prepared.approval.manifest_ref ||
          installedState.pointerEtag !== release.pointer_etag ||
          installedState.releaseCommitId !== release.release_commit_id ||
          installedState.appendedAt !== release.record_appended_at ||
          currentState.profileId !==
            CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
          currentState.environment !== "production" ||
          currentState.chainId !== prepared.approval.chain_id ||
          currentState.localRestoreEpoch !==
            prepared.approval.restore_epoch ||
          currentGeneration < installedGeneration ||
          !isCanonicalFencingToken(profile.write_fencing_token) ||
          !isCanonicalFencingToken(profile.next_fencing_token) ||
          BigInt(profile.write_fencing_token) <
            BigInt(existingOperation.installFencingToken) ||
          BigInt(profile.next_fencing_token) <
            BigInt(existingOperation.installFencingToken) ||
          (currentGeneration === installedGeneration &&
            currentState.stateSha256 !== installedState.stateSha256)
        ) {
          throw new FreshnessIssueCoordinatorStorageError(
            "RELEASE_BLOCKED",
            "Finalized genesis result does not match its approved binding",
          );
        }
        return existingOperation;
      }
      if (
        genesis.status === "INSTALLED" ||
        profile.current_state_json !== null ||
        profile.writer_pending !== 0 ||
        profile.writer_operation_id !== null
      ) {
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_BLOCKED",
          "Genesis bootstrap is no longer in its pristine profile state",
        );
      }
      const authorization = this.readCloudflareOperatorBootstrapAuthorization();
      if (authorization !== null) {
        if (
          authorization.operation_id === prepared.operationId &&
          authorization.chain_id === prepared.approval.chain_id &&
          authorization.position === prepared.approval.initial_position &&
          authorization.generation === prepared.approval.initial_generation &&
          authorization.record_sha256 ===
            prepared.approval.release_record_sha256 &&
          authorization.restore_epoch === prepared.approval.restore_epoch &&
          !this.hasOtherCloudflareOperatorInstallHistory(
            prepared.operationId,
          )
        ) {
          return null;
        }
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_CONFLICT",
          "Existing bootstrap authorization differs from the approved genesis",
        );
      }
      if (
        this.hasCloudflareOperatorInstallHistory() ||
        this.hasOtherCloudflareOperatorInstallHistory(prepared.operationId)
      ) {
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_CONFLICT",
          "Genesis binding install history already exists",
        );
      }
      this.sql.exec(
        `INSERT INTO cloudflare_operator_bootstrap_authorizations (
           singleton, operation_id, chain_id, position, generation,
           record_sha256, restore_epoch
         ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
        prepared.operationId,
        prepared.approval.chain_id,
        prepared.approval.initial_position,
        prepared.approval.initial_generation,
        prepared.approval.release_record_sha256,
        prepared.approval.restore_epoch,
      );
      return null;
    });
  }

  private cloudflareOperatorGenesisStateIsPristine(): boolean {
    const rows = this.sql.exec<{ readonly count: number }>(
      `SELECT
         (SELECT COUNT(*) FROM coordinator_state) +
         (SELECT COUNT(*) FROM freshness_profile) +
         (SELECT COUNT(*) FROM freshness_issue_operations) +
         (SELECT COUNT(*) FROM cloudflare_operator_issue_operations) +
         (SELECT COUNT(*) FROM release_ledger_operations) +
         (SELECT COUNT(*) FROM release_ledger_entries) +
         (SELECT COUNT(*) FROM release_ledger_head) +
         (SELECT COUNT(*) FROM current_state_binding_installs) +
         (SELECT COUNT(*) FROM current_state_bootstrap_authorizations) +
         (SELECT COUNT(*) FROM cloudflare_operator_bootstrap_authorizations) +
         (SELECT COUNT(*) FROM cloudflare_operator_binding_installs)
         AS count`,
    ).toArray();
    if (
      rows.length !== 1 ||
      !Number.isSafeInteger(rows[0]!.count) ||
      rows[0]!.count < 0
    ) {
      throw corruptStorage("Genesis pristine-state count is invalid");
    }
    return rows[0]!.count === 0;
  }

  private findCloudflareOperatorGenesis(
    operationId?: string,
  ): CloudflareOperatorGenesisRow | null {
    const rows = operationId === undefined
      ? this.sql.exec<CloudflareOperatorGenesisRow>(
          `SELECT operation_id, request_sha256, approval_sha256,
                  record_bytes, release_delegation_bytes, manifest_bytes,
                  restore_epoch, status, reason, created_at_ms
           FROM cloudflare_operator_genesis_operations
           WHERE singleton = 1`,
        ).toArray()
      : this.sql.exec<CloudflareOperatorGenesisRow>(
          `SELECT operation_id, request_sha256, approval_sha256,
                  record_bytes, release_delegation_bytes, manifest_bytes,
                  restore_epoch, status, reason, created_at_ms
           FROM cloudflare_operator_genesis_operations
           WHERE operation_id = ?`,
          operationId,
        ).toArray();
    if (rows.length > 1) {
      throw corruptStorage("Cloudflare/operator genesis operation is not unique");
    }
    if (rows.length === 0) return null;
    const row = rows[0]!;
    if (
      !UUID_V4_PATTERN.test(row.operation_id) ||
      !SHA256_BASE64URL_PATTERN.test(row.request_sha256) ||
      !SHA256_BASE64URL_PATTERN.test(row.approval_sha256) ||
      !(row.record_bytes instanceof ArrayBuffer) ||
      !(row.release_delegation_bytes instanceof ArrayBuffer) ||
      !(row.manifest_bytes instanceof ArrayBuffer) ||
      typeof row.restore_epoch !== "string" ||
      ![
        "ADMITTED",
        "LEDGER_COMMITTED",
        "R2_READBACK_PENDING",
        "RESULT_UNKNOWN",
        "AVAILABLE",
        "INSTALLING",
        "INSTALLED",
        "QUARANTINED",
      ].includes(row.status) ||
      (row.reason !== null && typeof row.reason !== "string") ||
      !Number.isSafeInteger(row.created_at_ms) ||
      row.created_at_ms < 0
    ) {
      throw corruptStorage("Cloudflare/operator genesis operation is malformed");
    }
    return row;
  }

  private genesisInputMatches(
    row: CloudflareOperatorGenesisRow,
    prepared: PreparedCloudflareOperatorGenesis,
  ): boolean {
    return (
      row.operation_id === prepared.operationId &&
      row.request_sha256 === prepared.requestSha256 &&
      row.approval_sha256 === prepared.approvalSha256 &&
      row.restore_epoch === prepared.approval.restore_epoch &&
      equalBytes(
        bytesFromArrayBuffer(row.record_bytes),
        prepared.input.recordBytes,
      ) &&
      equalBytes(
        bytesFromArrayBuffer(row.release_delegation_bytes),
        prepared.input.releaseDelegationBytes,
      ) &&
      equalBytes(
        bytesFromArrayBuffer(row.manifest_bytes),
        prepared.input.manifestBytes,
      )
    );
  }

  private updateCloudflareOperatorGenesisStatus(
    operationId: string,
    status:
      | "LEDGER_COMMITTED"
      | "R2_READBACK_PENDING"
      | "RESULT_UNKNOWN"
      | "AVAILABLE"
      | "INSTALLING"
      | "INSTALLED"
      | "QUARANTINED",
    reason: string | null = null,
  ): void {
    const statusRank = {
      ADMITTED: 0,
      LEDGER_COMMITTED: 1,
      R2_READBACK_PENDING: 2,
      RESULT_UNKNOWN: 2,
      AVAILABLE: 3,
      INSTALLING: 4,
      INSTALLED: 5,
      QUARANTINED: 6,
    } as const;
    this.ctx.storage.transactionSync(() => {
      const row = this.findCloudflareOperatorGenesis(operationId);
      if (row === null) {
        throw corruptStorage("Cloudflare/operator genesis operation disappeared");
      }
      if (
        row.status === "INSTALLED" ||
        row.status === "QUARANTINED" ||
        statusRank[status] < statusRank[row.status as keyof typeof statusRank] ||
        (row.status === "RESULT_UNKNOWN" && status === "R2_READBACK_PENDING")
      ) {
        return;
      }
      this.sql.exec(
        `UPDATE cloudflare_operator_genesis_operations
         SET status = ?, reason = ?
         WHERE singleton = 1 AND operation_id = ?`,
        status,
        reason,
        operationId,
      );
    });
  }

  private requireReleaseRootSigner(): RuntimeConfigRootSigner {
    const keyId = this.#env.RELEASE_LEDGER_ROOT_KEY_ID;
    const publicKeySpki = this.#env.RELEASE_LEDGER_ROOT_PUBLIC_KEY_SPKI;
    if (
      typeof keyId !== "string" ||
      keyId.length === 0 ||
      typeof publicKeySpki !== "string" ||
      publicKeySpki.length === 0
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Release root trust pin is not configured",
      );
    }
    return {
      scope: "fusou-tlsn-runtime-config-signing-root-v2",
      key_id: keyId,
      public_key_spki: publicKeySpki,
    };
  }

  private requireManifestRootSigner(): RuntimeConfigRootSigner {
    const keyId = this.#env.RELEASE_LEDGER_MANIFEST_KEY_ID;
    const publicKeySpki =
      this.#env.RELEASE_LEDGER_MANIFEST_PUBLIC_KEY_SPKI;
    if (
      typeof keyId !== "string" ||
      keyId.length === 0 ||
      typeof publicKeySpki !== "string" ||
      publicKeySpki.length === 0
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Manifest root trust pin is not configured",
      );
    }
    return {
      scope: "fusou-tlsn-runtime-config-signing-root-v2",
      key_id: keyId,
      public_key_spki: publicKeySpki,
    };
  }

  private verifyManifestPointer(
    raw: Uint8Array,
  ): ReturnType<typeof verifyRuntimeConfigManifestEpochPointer> {
    return verifyRuntimeConfigManifestEpochPointer({
      raw,
      trustedSigner: this.requireManifestRootSigner(),
      manifestUrl: this.requireFreshnessManifestUrl(),
      nowMs: runtimeUtcNow(),
    });
  }

  private requireReleaseStore(): RuntimeConfigR2ReleaseStore {
    const bucket = this.#env.RELEASE_LEDGER_R2;
    if (bucket === undefined) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Release ledger R2 binding is not configured",
      );
    }
    return new RuntimeConfigR2ReleaseStore(bucket);
  }

  private async verifyOperationManifest(
    operation: ReleaseLedgerOperation,
  ): Promise<Awaited<ReturnType<typeof verifyRuntimeConfigManifestEpochPointer>>> {
    const manifest = await this.verifyManifestPointer(operation.manifestBytes);
    const digest = await sha256Base64Url(operation.manifestBytes);
    if (
      operation.manifestLength !== operation.manifestBytes.byteLength ||
      digest !== operation.manifestSha256 ||
      manifest.manifestSha256 !== operation.manifestSha256 ||
      manifest.epoch !== operation.manifestEpoch ||
      operation.manifestRef !==
        `${runtimeConfigFreshnessWire.immutableManifestPrefix}${operation.manifestSha256}`
    ) {
      throw new RuntimeConfigR2ReleaseIntegrityError(
        "Release operation does not bind the exact signed Manifest bytes",
      );
    }
    if (this.readCloudflareOperatorProfileRow() !== null) {
      this.ctx.storage.transactionSync(() => {
        const nowMs = this.observeCloudflareOperatorUtc(
          this.requireCloudflareOperatorProfile(),
        );
        if (nowMs < manifest.notBeforeMs || nowMs >= manifest.expiresAtMs) {
          throw new RuntimeConfigDomainError(
            "INVALID_TIME",
            "Release Manifest is not active in the Cloudflare/operator profile",
          );
        }
      });
    }
    return manifest;
  }

  private readReleaseLedgerHeadRow(): ReleaseLedgerHeadRow | null {
    const chainId = this.requireReleaseChainId();
    const rows = this.sql
      .exec<ReleaseLedgerHeadMetadataRow>(
        `SELECT environment, chain_id, position, generation,
                record_sha256, previous_record_sha256, release_commit_id,
                manifest_epoch, manifest_sha256, manifest_ref, pointer_etag
         FROM release_ledger_head WHERE singleton = 1`,
      )
      .toArray();
    if (rows.length === 0) {
      const entries = this.sql
        .exec<{ readonly count: number }>(
          "SELECT COUNT(*) AS count FROM release_ledger_entries",
        )
        .toArray();
      const committedOperations = this.sql
        .exec<{ readonly count: number }>(
          `SELECT COUNT(*) AS count FROM release_ledger_operations
           WHERE status IN ('LEDGER_COMMITTED', 'R2_READBACK_PENDING', 'AVAILABLE')
              OR (status = 'RESULT_UNKNOWN'
                  AND resume_status IN ('LEDGER_COMMITTED', 'R2_READBACK_PENDING'))`,
        )
        .toArray();
      if (
        entries.length !== 1 ||
        committedOperations.length !== 1 ||
        entries[0]!.count !== 0 ||
        committedOperations[0]!.count !== 0
      ) {
        throw corruptStorage(
          "Release ledger head is missing while committed ledger state remains",
        );
      }
      return null;
    }
    if (rows.length !== 1) {
      throw corruptStorage("Release ledger singleton head is not unique");
    }

    const head = rows[0]!;
    const entryRows = this.sql
      .exec<ReleaseLedgerHeadRow>(
        `SELECT operation_id, environment, chain_id, position, generation,
                record_sha256, record_appended_at, record_bytes, record_length,
                release_delegation_bytes, previous_record_sha256,
                release_commit_id, manifest_epoch, manifest_sha256,
                manifest_ref, pointer_etag, manifest_bytes, pointer_bytes,
                snapshot_bytes
         FROM release_ledger_entries
         WHERE position = ? AND record_sha256 = ?`,
        head.position,
        head.record_sha256,
      )
      .toArray();
    if (
      entryRows.length !== 1 ||
      head.environment !== "production" ||
      head.chain_id !== chainId
    ) {
      throw corruptStorage(
        "Release ledger head does not identify one entry in the configured chain",
      );
    }
    const entry = entryRows[0]!;
    if (
      entry.environment !== head.environment ||
      entry.chain_id !== head.chain_id ||
      entry.position !== head.position ||
      entry.generation !== head.generation ||
      entry.record_sha256 !== head.record_sha256 ||
      entry.previous_record_sha256 !== head.previous_record_sha256 ||
      entry.release_commit_id !== head.release_commit_id ||
      entry.manifest_epoch !== head.manifest_epoch ||
      entry.manifest_sha256 !== head.manifest_sha256 ||
      entry.manifest_ref !== head.manifest_ref ||
      entry.pointer_etag !== head.pointer_etag
    ) {
      throw corruptStorage("Release ledger head differs from its exact entry");
    }

    const position = parseCanonicalUnsignedDecimal(
      entry.position,
      "Stored Release ledger position",
    );
    const generation = parseCanonicalUnsignedDecimal(
      entry.generation,
      "Stored Release ledger generation",
    );
    const entryCountRows = this.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM release_ledger_entries",
      )
      .toArray();
    if (
      entryCountRows.length !== 1 ||
      BigInt(entryCountRows[0]!.count) !== position ||
      generation !== position
    ) {
      throw corruptStorage(
        "Release ledger positions are not contiguous with the persisted head",
      );
    }

    return entry;
  }

  private async verifiedReleaseHead(
    row: ReleaseLedgerHeadRow,
  ): Promise<ReleaseLedgerHead> {
    const recordBytes = bytesFromArrayBuffer(row.record_bytes);
    const releaseDelegationBytes = bytesFromArrayBuffer(
      row.release_delegation_bytes,
    );
    const manifestBytes = bytesFromArrayBuffer(row.manifest_bytes);
    const pointerBytes = bytesFromArrayBuffer(row.pointer_bytes);
    const snapshotBytes = bytesFromArrayBuffer(row.snapshot_bytes);
    const record = await verifyRuntimeConfigReleaseCommitRecord({
      raw: recordBytes,
      rootSigner: this.requireReleaseRootSigner(),
      environment: "production",
      releaseDelegationRaw: releaseDelegationBytes,
      appendedAt: row.record_appended_at,
    });
    const manifest = await this.verifyManifestPointer(manifestBytes);
    if (
      record.digest !== row.record_sha256 ||
      recordBytes.byteLength !== row.record_length ||
      record.payload.commit_generation !== row.generation ||
      record.payload.previous_commit_record_sha256 !==
        row.previous_record_sha256 ||
      record.payload.release_commit_id !== row.release_commit_id ||
      record.payload.manifest_epoch !== row.manifest_epoch ||
      record.payload.manifest_sha256 !== row.manifest_sha256 ||
      record.payload.manifest_ref !== row.manifest_ref ||
      record.payload.pointer_etag !== row.pointer_etag ||
      manifest.epoch !== row.manifest_epoch ||
      manifest.manifestSha256 !== row.manifest_sha256 ||
      !equalBytes(pointerBytes, manifestBytes) ||
      !equalBytes(snapshotBytes, manifestBytes)
    ) {
      throw corruptStorage(
        "Release ledger head fails exact Record, Manifest, or R2 binding verification",
      );
    }
    return {
      environment: "production",
      chainId: row.chain_id,
      position: row.position,
      generation: row.generation,
      recordSha256: row.record_sha256,
      recordBytes,
      releaseDelegationBytes,
      previousRecordSha256: row.previous_record_sha256,
      releaseCommitId: row.release_commit_id,
      localAppendObservedAt: row.record_appended_at,
      manifestEpoch: row.manifest_epoch,
      manifestSha256: row.manifest_sha256,
      manifestRef: row.manifest_ref,
      pointerEtag: row.pointer_etag,
      manifestBytes,
    };
  }

  private async verifyStoredReleaseOperation(
    operation: ReleaseLedgerOperation,
  ): Promise<void> {
    const manifest = await this.verifyManifestPointer(operation.manifestBytes);
    const manifestSha256 = await sha256Base64Url(operation.manifestBytes);
    if (
      manifestSha256 !== operation.manifestSha256 ||
      manifest.epoch !== operation.manifestEpoch ||
      manifest.manifestSha256 !== operation.manifestSha256 ||
      operation.manifestRef !==
        `tlsn/runtime-config/v2/manifests/${operation.manifestSha256}`
    ) {
      throw corruptStorage(
        "Persisted Release operation Manifest binding is invalid",
      );
    }
    if (
      operation.recordBytes === null ||
      operation.releaseDelegationBytes === null
    ) {
      if (
        operation.recordBytes !== null ||
        operation.releaseDelegationBytes !== null ||
        operation.recordSha256 !== null ||
        operation.localAppendObservedAt !== null ||
        operation.position !== null ||
        operation.generation !== null
      ) {
        throw corruptStorage(
          "Persisted Release operation has a partial Record binding",
        );
      }
      return;
    }
    if (
      operation.recordSha256 === null ||
      operation.localAppendObservedAt === null ||
      operation.position === null ||
      operation.generation === null
    ) {
      throw corruptStorage(
        "Persisted Release operation has an incomplete Record binding",
      );
    }
    const verifiedRecord = await verifyRuntimeConfigReleaseCommitRecord({
      raw: operation.recordBytes,
      rootSigner: this.requireReleaseRootSigner(),
      environment: operation.environment,
      releaseDelegationRaw: operation.releaseDelegationBytes,
      appendedAt: operation.localAppendObservedAt,
    });
    assertReleaseRecordMatchesOperation(
      verifiedRecord,
      operation,
      operation.recordBytes,
      operation.releaseDelegationBytes,
    );
    if (
      verifiedRecord.digest !== operation.recordSha256 ||
      verifiedRecord.payload.commit_generation !== operation.generation ||
      verifiedRecord.payload.manifest_epoch !== operation.manifestEpoch ||
      verifiedRecord.payload.manifest_sha256 !== operation.manifestSha256 ||
      verifiedRecord.payload.manifest_ref !== operation.manifestRef
    ) {
      throw corruptStorage(
        "Persisted Release operation Record binding is invalid",
      );
    }
  }

  private findReleaseOperation(
    operationId: string,
  ): ReleaseLedgerOperationRow | null {
    const rows = this.sql
      .exec<ReleaseLedgerOperationRow>(
        `SELECT operation_id, request_sha256, environment, chain_id, status,
                reason, unknown_stage, resume_status, fencing_token,
                expected_position, expected_generation, expected_record_sha256,
                expected_pointer_etag, manifest_bytes, manifest_length,
                manifest_sha256, manifest_epoch, manifest_ref, pointer_bytes,
                pointer_etag, snapshot_bytes, record_bytes, record_length,
                record_sha256, record_appended_at,
                release_delegation_bytes, position, generation,
                previous_record_sha256, release_commit_id
         FROM release_ledger_operations WHERE operation_id = ?`,
        operationId,
      )
      .toArray();
    if (rows.length > 1) {
      throw corruptStorage("Release operation ID is not unique");
    }
    if (rows.length === 0) return null;
    assertReleaseOperationRow(rows[0]!, this.requireReleaseChainId());
    return rows[0]!;
  }

  private requireReleaseOperation(
    operationId: string,
  ): ReleaseLedgerOperationRow {
    const operation = this.findReleaseOperation(operationId);
    if (operation === null) {
      throw invalidInput("Release operation does not exist");
    }
    return operation;
  }

  private insertReleaseConflict(input: {
    readonly operationId: string;
    readonly requestSha256: string;
    readonly environment: "production";
    readonly chainId: string;
    readonly expectedHead: ReleaseLedgerHead | null;
    readonly manifestBytes: Uint8Array;
    readonly manifestSha256: string;
    readonly manifestEpoch: string;
    readonly manifestRef: string;
  }): ReleaseLedgerActionResult {
    this.sql.exec(
      `INSERT INTO release_ledger_operations (
         operation_id, request_sha256, environment, chain_id, status, reason,
         unknown_stage, resume_status, fencing_token, expected_position,
         expected_generation, expected_record_sha256, expected_pointer_etag,
         manifest_bytes, manifest_length, manifest_sha256, manifest_epoch,
         manifest_ref
       ) VALUES (?, ?, ?, ?, 'CONFLICT', 'Release predecessor or writer is not current',
                 NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.operationId,
      input.requestSha256,
      input.environment,
      input.chainId,
      input.expectedHead?.position ?? null,
      input.expectedHead?.generation ?? null,
      input.expectedHead?.recordSha256 ?? null,
      input.expectedHead?.pointerEtag ?? "",
      arrayBufferFromBytes(input.manifestBytes),
      input.manifestBytes.byteLength,
      input.manifestSha256,
      input.manifestEpoch,
      input.manifestRef,
    );
    return {
      status: "CONFLICT",
      operation: releaseOperationFromRow(
        this.requireReleaseOperation(input.operationId),
      ),
    };
  }

  private requireReleaseWriter(
    operation: ReleaseLedgerOperationRow,
    fencingToken: string,
  ): void {
    parseCanonicalUnsignedDecimal(fencingToken, "Release fencing token");
    if (operation.fencing_token !== fencingToken) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_CONFLICT",
        "Release operation fencing token is stale",
      );
    }
    const profile = this.readCloudflareOperatorProfileRow();
    if (profile !== null) {
      if (
        profile.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
        profile.environment !== operation.environment ||
        profile.chain_id !== operation.chain_id ||
        profile.writer_pending !== 1 ||
        profile.writer_operation_id !== operation.operation_id ||
        profile.write_fencing_token !== fencingToken
      ) {
        throw new FreshnessIssueCoordinatorStorageError(
          "RELEASE_CONFLICT",
          "Cloudflare/operator Release writer gate or fencing token is no longer current",
        );
      }
      return;
    }
    const stateRow = this.readStateRow();
    if (stateRow === null) {
      throw new FreshnessIssueCoordinatorStorageError(
        "NOT_INITIALIZED",
        "Coordinator state is not initialized",
      );
    }
    const state = this.decodeCoordinatorState(stateRow);
    if (
      !state.writerPending ||
      state.writerOperationId !== operation.operation_id ||
      state.writeFencingToken !== fencingToken
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_CONFLICT",
        "Release writer gate or fencing token is no longer current",
      );
    }
  }

  private requireExpectedReleaseHead(
    operation: ReleaseLedgerOperationRow,
  ): void {
    const currentHead = this.readReleaseLedgerHeadRow();
    const expectedHead =
      operation.expected_position === null
        ? null
        : releaseExpectedHeadFromRow(operation);
    if (!sameReleaseHeadBinding(currentHead, expectedHead)) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_CONFLICT",
        "Release operation predecessor is no longer the current ledger head",
      );
    }
  }

  private requireCommittedReleaseHead(
    operation: ReleaseLedgerOperationRow,
  ): void {
    const head = this.readReleaseLedgerHeadRow();
    if (
      head === null ||
      head.operation_id !== operation.operation_id ||
      head.environment !== operation.environment ||
      head.chain_id !== operation.chain_id ||
      head.position !== operation.position ||
      head.generation !== operation.generation ||
      head.record_sha256 !== operation.record_sha256 ||
      head.release_commit_id !== operation.release_commit_id ||
      head.manifest_epoch !== operation.manifest_epoch ||
      head.manifest_sha256 !== operation.manifest_sha256 ||
      head.manifest_ref !== operation.manifest_ref ||
      head.pointer_etag !== operation.pointer_etag
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_CONFLICT",
        "Persisted Release operation is no longer the current ledger head",
      );
    }
  }

  private hasRetainedIssueBlockers(excludeOperatorOperationId?: string): boolean {
    const rows = this.sql
      .exec<{ readonly count: number }>(
        `SELECT
           (SELECT COUNT(*) FROM freshness_issue_operations
            WHERE blocker = 'RETAINED'
              AND status IN ('IN_PROGRESS', 'RESULT_UNKNOWN'))
           +
           (SELECT COUNT(*) FROM cloudflare_operator_issue_operations
            WHERE blocker = 'RETAINED'
              AND status IN ('IN_PROGRESS', 'RESULT_UNKNOWN')
              AND (? IS NULL OR operation_id != ?)) AS count`,
        excludeOperatorOperationId ?? null,
        excludeOperatorOperationId ?? null,
      )
      .toArray();
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.count)) {
      throw corruptStorage("Freshness issue blocker count is invalid");
    }
    return rows[0]!.count > 0;
  }

  private async prepareCloudflareOperatorIssueSigningAuthorization(
    input: CloudflareOperatorIssueSigningAuthorization,
  ): Promise<PreparedCloudflareOperatorIssueSigningAuthorization> {
    assertCloudflareOperatorIssueBinding(input.operation);
    if (
      typeof input.fencingToken !== "string" ||
      !(input.requestBytes instanceof Uint8Array) ||
      input.requestBytes.byteLength === 0 ||
      input.requestBytes.byteLength > 1_024
    ) {
      throw invalidInput("Cloudflare/operator signing authorization is invalid");
    }
    parseCanonicalUnsignedDecimal(
      input.fencingToken,
      "Cloudflare/operator issue fencing token",
    );
    const authorization: CloudflareOperatorIssueSigningAuthorization = {
      operation: Object.freeze({ ...input.operation }),
      fencingToken: input.fencingToken,
      requestBytes: copyBytes(input.requestBytes),
      currentState: Object.freeze({ ...input.currentState }),
    };
    const audienceManifestUrlSha256 = await sha256Base64Url(
      new TextEncoder().encode(this.requireFreshnessManifestUrl()),
    );
    const challenge = await verifyRuntimeConfigFreshnessRequest(
      authorization.requestBytes,
      {
        environment: "production",
        audienceManifestUrlSha256,
      },
    );
    const requestSha256 = await sha256Base64Url(
      authorization.requestBytes,
    );
    if (
      challenge.request_nonce !== authorization.operation.requestNonce ||
      authorization.operation.audienceManifestUrlSha256 !==
        audienceManifestUrlSha256
    ) {
      throw invalidInput(
        "Cloudflare/operator signing challenge does not match its persisted binding",
      );
    }
    return {
      authorization,
      requestSha256,
      audienceManifestUrlSha256,
      challenge,
    };
  }

  private requireCloudflareOperatorIssueSigningAuthorizationInTransaction(
    prepared: PreparedCloudflareOperatorIssueSigningAuthorization,
    requireClaimed: boolean,
    profile: CloudflareOperatorProfileRow,
    nowMs: number,
  ): CloudflareOperatorIssueRow {
    const { authorization } = prepared;
    const operation = authorization.operation;
    const row = this.findCloudflareOperatorIssue(operation.operationId);
    if (
      row === null ||
      !cloudflareOperatorIssueMatches(row, operation) ||
      row.fencing_token !== authorization.fencingToken ||
      row.request_sha256 !== prepared.requestSha256 ||
      row.request_nonce !== prepared.challenge.request_nonce ||
      row.environment !== "production" ||
      row.chain_id !== this.requireReleaseChainId() ||
      row.audience_manifest_url_sha256 !==
        prepared.audienceManifestUrlSha256 ||
      !equalBytes(
        bytesFromArrayBuffer(row.request_bytes),
        authorization.requestBytes,
      ) ||
      !sameCloudflareOperatorBinding(
        decodeCloudflareOperatorBinding(row.current_state_json),
        authorization.currentState,
      )
    ) {
      throw invalidInput(
        "Cloudflare/operator issue authorization does not match the persisted request",
      );
    }
    if (
      row.status !== "IN_PROGRESS" ||
      row.blocker !== "RETAINED" ||
      row.signing_claimed !== (requireClaimed ? 1 : 0)
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_CONFLICT",
        "Cloudflare/operator issue is not in the required signing state",
      );
    }
    const operationState = decodeCloudflareOperatorBinding(
      row.current_state_json,
    );
    const currentState = profile.current_state_json === null
      ? null
      : decodeCloudflareOperatorBinding(profile.current_state_json);
    const head = this.readReleaseLedgerHeadRow();
    const releaseOperation = this.findReleaseOperation(
      operationState.releaseOperationId,
    );
    if (
      profile.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
      profile.environment !== "production" ||
      profile.chain_id !== operation.chainId ||
      profile.writer_pending !== 0 ||
      currentState === null ||
      !sameCloudflareOperatorBinding(currentState, operationState) ||
      nowMs < currentState.manifestNotBeforeMs ||
      nowMs >= currentState.manifestExpiresAtMs ||
      head === null ||
      releaseOperation === null ||
      releaseOperation.operation_id !== currentState.releaseOperationId ||
      releaseOperation.status !== "AVAILABLE" ||
      releaseOperation.fencing_token !== currentState.releaseFencingToken ||
      !releaseHeadMatchesOperatorBinding(head, currentState) ||
      this.hasRetainedIssueBlockers(operation.operationId)
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "RELEASE_BLOCKED",
        "Current Release, issue fence, or blocker state no longer authorizes signing",
      );
    }
    return row;
  }

  private releaseActionForRow(
    row: ReleaseLedgerOperationRow,
  ): ReleaseLedgerActionResult {
    return releaseActionFromOperation(releaseOperationFromRow(row));
  }

  private quarantineReleaseOperationInTransaction(
    operation: ReleaseLedgerOperationRow,
    reason: string,
  ): ReleaseLedgerActionResult {
    this.sql.exec(
      `UPDATE release_ledger_operations
       SET status = 'QUARANTINED', reason = ?, unknown_stage = NULL,
           resume_status = NULL
       WHERE operation_id = ? AND status NOT IN ('AVAILABLE', 'CONFLICT')`,
      reason,
      operation.operation_id,
    );
    return this.releaseActionForRow(
      this.requireReleaseOperation(operation.operation_id),
    );
  }

  private async quarantineReleaseOperation(
    operationId: string,
    fencingToken: string,
    reason: string,
  ): Promise<ReleaseLedgerActionResult> {
    return this.ctx.storage.transactionSync(() => {
      const operation = this.requireReleaseOperation(operationId);
      this.requireReleaseWriter(operation, fencingToken);
      return this.quarantineReleaseOperationInTransaction(operation, reason);
    });
  }

  private findReleaseBindingInstall(
    operationId: string,
  ): ReleaseBindingInstallRow | null {
    const rows = this.sql
      .exec<ReleaseBindingInstallRow>(
        `SELECT operation_id, request_sha256, environment, chain_id, mode,
                status, reason, release_operation_id, release_fencing_token,
                install_fencing_token, expected_current_state_sha256,
                expected_restore_epoch, target_position, target_generation,
                target_record_sha256, proof_context_sha256,
                installed_state_json
         FROM current_state_binding_installs WHERE operation_id = ?`,
        operationId,
      )
      .toArray();
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw corruptStorage("Current-state install operation ID is not unique");
    }
    releaseBindingInstallFromRow(rows[0]!);
    return rows[0]!;
  }

  private requireReleaseBindingInstall(
    operationId: string,
  ): ReleaseBindingInstallRow {
    const row = this.findReleaseBindingInstall(operationId);
    if (row === null) {
      throw corruptStorage("Current-state install operation disappeared");
    }
    return row;
  }

  private currentStateInstallWriterMatches(
    state: CoordinatorStateRow,
    attempt: ReleaseBindingInstallRow,
  ): boolean {
    return (
      state.writer_pending === 1 &&
      state.writer_operation_id ===
        `current-state-install:${attempt.operation_id}` &&
      state.write_fencing_token === attempt.install_fencing_token
    );
  }

  private nextInstallFencingToken(stateNextFencingToken: string): string {
    const rows = this.sql
      .exec<{ readonly next_fencing_token: string }>(
        `SELECT next_fencing_token
         FROM current_state_binding_install_meta WHERE singleton = 1`,
      )
      .toArray();
    if (rows.length !== 1) {
      throw corruptStorage("Current-state install fence metadata is missing");
    }
    const installCounter = parseCanonicalUnsignedDecimal(
      rows[0]!.next_fencing_token,
      "Stored current-state install fence",
      true,
    );
    const stateCounter = parseCanonicalUnsignedDecimal(
      stateNextFencingToken,
      "Coordinator next fence during current-state install",
      true,
    );
    const base = installCounter > stateCounter ? installCounter : stateCounter;
    const fencingToken = incrementCounter(base.toString(10));
    this.sql.exec(
      `UPDATE current_state_binding_install_meta
       SET next_fencing_token = ? WHERE singleton = 1`,
      fencingToken,
    );
    return fencingToken;
  }

  private readBootstrapAuthorization():
    | CurrentStateBootstrapAuthorizationRow
    | null {
    const rows = this.sql
      .exec<CurrentStateBootstrapAuthorizationRow>(
        `SELECT operation_id, chain_id, position, generation,
                record_sha256, restore_epoch, clock_id, clock_epoch,
                clock_now_ms, clock_uncertainty_ms
         FROM current_state_bootstrap_authorizations WHERE singleton = 1`,
      )
      .toArray();
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw corruptStorage(
        "Current-state bootstrap authorization singleton is not unique",
      );
    }
    const authorization = rows[0]!;
    if (
      authorization.restore_epoch.length === 0 ||
      authorization.clock_id.length === 0 ||
      authorization.clock_epoch.length === 0 ||
      !Number.isSafeInteger(authorization.clock_now_ms) ||
      !Number.isSafeInteger(authorization.clock_uncertainty_ms) ||
      authorization.clock_uncertainty_ms < 0
    ) {
      throw corruptStorage("Current-state bootstrap authorization is corrupt");
    }
    return authorization;
  }

  private bootstrapAuthorizationMatches(
    release: ReleaseLedgerOperationRow,
    restoreEpoch: string,
  ): boolean {
    const authorization = this.readBootstrapAuthorization();
    return authorization !== null &&
      bootstrapAuthorizationMatchesInstall(
        authorization,
        release,
        restoreEpoch,
      );
  }

  private hasPendingReleaseBindingInstall(): boolean {
    const rows = this.sql
      .exec<{ readonly count: number }>(
        `SELECT COUNT(*) AS count
         FROM current_state_binding_installs
         WHERE status IN ('VERIFYING', 'QUARANTINED')`,
      )
      .toArray();
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.count)) {
      throw corruptStorage("Current-state install blocker count is invalid");
    }
    return rows[0]!.count > 0;
  }

  private hasCurrentStateInstallHistory(): boolean {
    const rows = this.sql
      .exec<{ readonly count: number }>(
        "SELECT COUNT(*) AS count FROM current_state_binding_installs",
      )
      .toArray();
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.count)) {
      throw corruptStorage("Current-state install history count is invalid");
    }
    return rows[0]!.count > 0;
  }

  private quarantineReleaseBindingInstall(
    attempt: ReleaseBindingInstallRow,
    reason: string,
  ): ReleaseBindingInstallActionResult {
    this.sql.exec(
      `UPDATE current_state_binding_installs
       SET status = 'QUARANTINED', reason = ?
       WHERE operation_id = ? AND status = 'VERIFYING'`,
      reason,
      attempt.operation_id,
    );
    return releaseBindingInstallActionFromRow(
      this.requireReleaseBindingInstall(attempt.operation_id),
    );
  }

  private readCloudflareOperatorProfileRow(): CloudflareOperatorProfileRow | null {
    const rows = this.sql.exec<CloudflareOperatorProfileRow>(
      `SELECT profile_id, environment, chain_id, current_state_json,
              local_restore_epoch, last_observed_utc_ms,
              next_fencing_token, write_fencing_token, writer_pending,
              writer_operation_id
       FROM freshness_profile WHERE singleton = 1`,
    ).toArray();
    if (rows.length === 0) return null;
    if (rows.length !== 1) {
      throw corruptStorage("Freshness profile singleton is not unique");
    }
    return rows[0]!;
  }

  private requireCloudflareOperatorProfile(): CloudflareOperatorProfileRow {
    const profile = this.readCloudflareOperatorProfileRow();
    if (profile === null) {
      throw new FreshnessIssueCoordinatorStorageError(
        "PROFILE_MISMATCH",
        "Cloudflare/operator profile was not explicitly initialized",
      );
    }
    if (
      profile.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
      profile.environment !== "production" ||
      profile.chain_id !== this.requireReleaseChainId() ||
      profile.local_restore_epoch.length === 0 ||
      !Number.isSafeInteger(profile.last_observed_utc_ms) ||
      (profile.writer_pending !== 0 && profile.writer_pending !== 1) ||
      (profile.writer_pending === 1) !== (profile.writer_operation_id !== null)
    ) {
      throw corruptStorage(
        "Persisted Cloudflare/operator profile identity or writer state is invalid",
      );
    }
    parseCanonicalUnsignedDecimal(
      profile.next_fencing_token,
      "Cloudflare/operator next fencing token",
      true,
    );
    parseCanonicalUnsignedDecimal(
      profile.write_fencing_token,
      "Cloudflare/operator write fencing token",
      true,
    );
    if (
      parseCanonicalUnsignedDecimal(
        profile.next_fencing_token,
        "Cloudflare/operator next fencing token",
        true,
      ) <
      parseCanonicalUnsignedDecimal(
        profile.write_fencing_token,
        "Cloudflare/operator write fencing token",
        true,
      )
    ) {
      throw corruptStorage(
        "Cloudflare/operator fencing counter is behind its active fence",
      );
    }
    return profile;
  }

  private observeCloudflareOperatorUtc(
    profile: CloudflareOperatorProfileRow,
  ): number {
    const current = this.readCloudflareOperatorProfileRow();
    if (current === null) {
      throw corruptStorage("Cloudflare/operator profile disappeared");
    }
    const nowMs = this.readCloudflareOperatorRuntimeUtc();
    if (nowMs < current.last_observed_utc_ms) {
      throw new FreshnessIssueCoordinatorStorageError(
        "INVALID_TIME",
        "Runtime UTC moved backwards from the last persisted profile observation",
      );
    }
    this.sql.exec(
      `UPDATE freshness_profile
       SET last_observed_utc_ms = ?
       WHERE singleton = 1 AND profile_id = ? AND environment = ?
         AND chain_id = ? AND last_observed_utc_ms = ?`,
      nowMs,
      profile.profile_id,
      profile.environment,
      profile.chain_id,
      current.last_observed_utc_ms,
    );
    return nowMs;
  }

  protected readCloudflareOperatorRuntimeUtc(): number {
    return runtimeUtcNow();
  }

  private requireFreshnessManifestUrl(): string {
    const value = this.#env.FRESHNESS_MANIFEST_URL;
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.trim() !== value
    ) {
      throw new FreshnessIssueCoordinatorStorageError(
        "MISSING_ADAPTER",
        "Freshness Manifest URL is not configured",
      );
    }
    return value;
  }

  private findCloudflareOperatorInstall(
    operationId: string,
  ): CloudflareOperatorInstallRow | null {
    const rows = this.sql.exec<CloudflareOperatorInstallRow>(
      `SELECT operation_id, request_sha256, environment, chain_id, mode,
              status, reason, release_operation_id, release_fencing_token,
              install_fencing_token, expected_current_state_sha256,
              expected_restore_epoch, target_position, target_generation,
              target_record_sha256, installed_state_json
       FROM cloudflare_operator_binding_installs WHERE operation_id = ?`,
      operationId,
    ).toArray();
    if (rows.length > 1) {
      throw corruptStorage("Cloudflare/operator install operation is not unique");
    }
    return rows[0] ?? null;
  }

  private requireCloudflareOperatorInstall(
    operationId: string,
  ): CloudflareOperatorInstallRow {
    const row = this.findCloudflareOperatorInstall(operationId);
    if (row === null) {
      throw invalidInput("Cloudflare/operator install operation does not exist");
    }
    return row;
  }

  private readCloudflareOperatorBootstrapAuthorization():
    | {
        readonly operation_id: string;
        readonly chain_id: string;
        readonly position: string;
        readonly generation: string;
        readonly record_sha256: string;
        readonly restore_epoch: string;
      }
    | null {
    const rows = this.sql.exec<{
      readonly operation_id: string;
      readonly chain_id: string;
      readonly position: string;
      readonly generation: string;
      readonly record_sha256: string;
      readonly restore_epoch: string;
    }>(
      `SELECT operation_id, chain_id, position, generation,
              record_sha256, restore_epoch
       FROM cloudflare_operator_bootstrap_authorizations WHERE singleton = 1`,
    ).toArray();
    if (rows.length > 1) {
      throw corruptStorage(
        "Cloudflare/operator bootstrap authorization is not unique",
      );
    }
    return rows[0] ?? null;
  }

  private hasCloudflareOperatorInstallHistory(): boolean {
    const rows = this.sql.exec<{ readonly count: number }>(
      "SELECT COUNT(*) AS count FROM cloudflare_operator_binding_installs",
    ).toArray();
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.count)) {
      throw corruptStorage(
        "Cloudflare/operator install history count is invalid",
      );
    }
    return rows[0]!.count > 0;
  }

  private hasOtherCloudflareOperatorInstallHistory(
    excludingOperationId: string,
  ): boolean {
    const rows = this.sql.exec<{ readonly count: number }>(
      `SELECT COUNT(*) AS count FROM cloudflare_operator_binding_installs
       WHERE operation_id != ?`,
      excludingOperationId,
    ).toArray();
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]!.count)) {
      throw corruptStorage(
        "Cloudflare/operator prior install history count is invalid",
      );
    }
    return rows[0]!.count > 0;
  }

  private quarantineCloudflareOperatorInstall(
    operationId: string,
    reason: string,
  ): CloudflareOperatorBindingInstallAction {
    return this.ctx.storage.transactionSync(() =>
      cloudflareOperatorInstallAction(
        this.quarantineCloudflareOperatorInstallInTransaction(
          this.requireCloudflareOperatorInstall(operationId),
          reason,
        ),
      ),
    );
  }

  private quarantineCloudflareOperatorInstallInTransaction(
    attempt: CloudflareOperatorInstallRow,
    reason: string,
  ): CloudflareOperatorInstallRow {
    this.sql.exec(
      `UPDATE cloudflare_operator_binding_installs
       SET status = 'QUARANTINED', reason = ?
       WHERE operation_id = ? AND status = 'VERIFYING'`,
      reason,
      attempt.operation_id,
    );
    return this.requireCloudflareOperatorInstall(attempt.operation_id);
  }

  private findCloudflareOperatorIssue(
    operationId: string,
  ): CloudflareOperatorIssueRow | null {
    const rows = this.sql.exec<CloudflareOperatorIssueRow>(
      `SELECT operation_id, signer_operation_id, request_bytes,
              profile_id, request_sha256, request_nonce, environment, chain_id,
              audience_manifest_url_sha256, status, blocker, fencing_token,
              signing_claimed,
              current_state_json, response_bytes, response_length,
              response_sha256, rejection_reason
       FROM cloudflare_operator_issue_operations WHERE operation_id = ?`,
      operationId,
    ).toArray();
    if (rows.length > 1) {
      throw corruptStorage("Cloudflare/operator issue operation is not unique");
    }
    return rows[0] ?? null;
  }

  private requireCloudflareOperatorIssue(
    operationId: string,
  ): CloudflareOperatorIssueRow {
    const row = this.findCloudflareOperatorIssue(operationId);
    if (row === null) {
      throw invalidInput("Cloudflare/operator issue operation does not exist");
    }
    return row;
  }

  private quarantineCloudflareOperatorIssueInTransaction(
    row: CloudflareOperatorIssueRow,
    reason: string,
  ): CloudflareOperatorIssueRow {
    this.sql.exec(
      `UPDATE cloudflare_operator_issue_operations
       SET status = 'RESULT_UNKNOWN', blocker = 'RETAINED',
           rejection_reason = ?
       WHERE operation_id = ? AND status IN ('IN_PROGRESS', 'RESULT_UNKNOWN')`,
      reason,
      row.operation_id,
    );
    return this.requireCloudflareOperatorIssue(row.operation_id);
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
      writerOperationId: row.writer_operation_id,
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

function decodeCloudflareOperatorBinding(
  json: string,
): CloudflareOperatorCurrentStateBinding {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw corruptStorage("Cloudflare/operator current-state JSON is invalid");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw corruptStorage("Cloudflare/operator current-state binding is invalid");
  }
  const record = value as Record<string, unknown>;
  const keys = [
    "profileId",
    "environment",
    "chainId",
    "releaseOperationId",
    "releaseFencingToken",
    "position",
    "generation",
    "recordSha256",
    "releaseCommitId",
    "appendedAt",
    "manifestEpoch",
    "manifestSha256",
    "manifestRef",
    "pointerEtag",
    "manifestNotBeforeMs",
    "manifestExpiresAtMs",
    "localRestoreEpoch",
    "stateSha256",
  ];
  if (
    Object.keys(record).sort().join(",") !== [...keys].sort().join(",") ||
    record.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    record.environment !== "production" ||
    typeof record.chainId !== "string" ||
    record.chainId.length === 0 ||
    typeof record.releaseOperationId !== "string" ||
    typeof record.releaseFencingToken !== "string" ||
    typeof record.position !== "string" ||
    typeof record.generation !== "string" ||
    typeof record.recordSha256 !== "string" ||
    !SHA256_BASE64URL_PATTERN.test(record.recordSha256) ||
    typeof record.releaseCommitId !== "string" ||
    typeof record.appendedAt !== "string" ||
    typeof record.manifestEpoch !== "string" ||
    typeof record.manifestSha256 !== "string" ||
    !SHA256_BASE64URL_PATTERN.test(record.manifestSha256) ||
    typeof record.manifestRef !== "string" ||
    typeof record.pointerEtag !== "string" ||
    typeof record.manifestNotBeforeMs !== "number" ||
    !Number.isSafeInteger(record.manifestNotBeforeMs) ||
    typeof record.manifestExpiresAtMs !== "number" ||
    !Number.isSafeInteger(record.manifestExpiresAtMs) ||
    record.manifestNotBeforeMs >= record.manifestExpiresAtMs ||
    typeof record.localRestoreEpoch !== "string" ||
    record.localRestoreEpoch.length === 0 ||
    typeof record.stateSha256 !== "string" ||
    !SHA256_BASE64URL_PATTERN.test(record.stateSha256)
  ) {
    throw corruptStorage("Cloudflare/operator current-state binding fields are invalid");
  }
  parseCanonicalUnsignedDecimal(record.position, "Cloudflare/operator position");
  parseCanonicalUnsignedDecimal(record.generation, "Cloudflare/operator generation");
  parseCanonicalUnsignedDecimal(
    record.releaseFencingToken,
    "Cloudflare/operator Release fencing token",
    true,
  );
  assertUuid(record.releaseOperationId, "Cloudflare/operator Release operation ID");
  assertUuid(record.releaseCommitId, "Cloudflare/operator Release commit ID");
  return value as CloudflareOperatorCurrentStateBinding;
}

function sameCloudflareOperatorBinding(
  left: CloudflareOperatorCurrentStateBinding | null,
  right: CloudflareOperatorCurrentStateBinding | null,
): boolean {
  return left !== null &&
    right !== null &&
    equalBytes(canonicalJsonBytes(left), canonicalJsonBytes(right));
}

function releaseHeadMatchesOperatorBinding(
  head: ReleaseLedgerHeadRow,
  state: CloudflareOperatorCurrentStateBinding,
): boolean {
  return head.environment === state.environment &&
    head.chain_id === state.chainId &&
    head.operation_id === state.releaseOperationId &&
    head.position === state.position &&
    head.generation === state.generation &&
    head.record_sha256 === state.recordSha256 &&
    head.release_commit_id === state.releaseCommitId &&
    head.record_appended_at === state.appendedAt &&
    head.manifest_epoch === state.manifestEpoch &&
    head.manifest_sha256 === state.manifestSha256 &&
    head.manifest_ref === state.manifestRef &&
    head.pointer_etag === state.pointerEtag;
}

function operatorReleasePredecessorMatchesState(
  operation: ReleaseLedgerOperationRow,
  state: CloudflareOperatorCurrentStateBinding,
): boolean {
  return operation.environment === state.environment &&
    operation.chain_id === state.chainId &&
    operation.expected_position === state.position &&
    operation.expected_generation === state.generation &&
    operation.expected_record_sha256 === state.recordSha256;
}

function cloudflareOperatorInstallFromRow(
  row: CloudflareOperatorInstallRow,
): CloudflareOperatorBindingInstallOperation {
  if (
    row.environment !== "production" ||
    (row.mode !== "BOOTSTRAP" && row.mode !== "ADVANCE") ||
    !["VERIFYING", "INSTALLED", "QUARANTINED", "CONFLICT"].includes(row.status)
  ) {
    throw corruptStorage("Stored Cloudflare/operator install operation is invalid");
  }
  return {
    operationId: row.operation_id,
    requestSha256: row.request_sha256,
    profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
    environment: "production",
    chainId: row.chain_id,
    mode: row.mode,
    status: row.status as CloudflareOperatorBindingInstallOperation["status"],
    reason: row.reason,
    releaseOperationId: row.release_operation_id,
    releaseFencingToken: row.release_fencing_token,
    installFencingToken: row.install_fencing_token,
    expectedCurrentStateSha256: row.expected_current_state_sha256,
    expectedRestoreEpoch: row.expected_restore_epoch,
    targetPosition: row.target_position,
    targetGeneration: row.target_generation,
    targetRecordSha256: row.target_record_sha256,
    installedState: row.installed_state_json === null
      ? null
      : decodeCloudflareOperatorBinding(row.installed_state_json),
  };
}

function cloudflareOperatorInstallAction(
  row: CloudflareOperatorInstallRow,
): CloudflareOperatorBindingInstallAction {
  const operation = cloudflareOperatorInstallFromRow(row);
  return {
    status: operation.status === "INSTALLED"
      ? "INSTALLED"
      : operation.status === "QUARANTINED"
        ? "QUARANTINED"
        : operation.status === "CONFLICT"
          ? "CONFLICT"
          : "STARTED",
    operation,
  };
}

function cloudflareOperatorIssueBindingFromRow(
  row: CloudflareOperatorIssueRow,
): CloudflareOperatorIssueOperationBinding {
  if (
    row.profile_id !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    row.environment !== "production" ||
    !SHA256_BASE64URL_PATTERN.test(row.request_sha256) ||
    !SHA256_BASE64URL_PATTERN.test(row.audience_manifest_url_sha256)
  ) {
    throw corruptStorage("Stored Cloudflare/operator issue binding is invalid");
  }
  return {
    profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
    operationId: row.operation_id,
    signerOperationId: row.signer_operation_id,
    requestSha256: row.request_sha256,
    requestNonce: row.request_nonce,
    environment: "production",
    chainId: row.chain_id,
    audienceManifestUrlSha256: row.audience_manifest_url_sha256,
  };
}

function assertCloudflareOperatorIssueBinding(
  operation: CloudflareOperatorIssueOperationBinding,
): void {
  if (
    operation.profileId !== CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID ||
    operation.environment !== "production" ||
    !SHA256_BASE64URL_PATTERN.test(operation.requestSha256) ||
    !SHA256_BASE64URL_PATTERN.test(operation.audienceManifestUrlSha256) ||
    operation.chainId.length === 0 ||
    operation.requestNonce.length === 0
  ) {
    throw invalidInput("Cloudflare/operator issue operation binding is invalid");
  }
  assertUuid(operation.operationId, "Cloudflare/operator issue operation ID");
}

function cloudflareOperatorIssueMatches(
  row: CloudflareOperatorIssueRow,
  operation: CloudflareOperatorIssueOperationBinding,
): boolean {
  return row.profile_id === operation.profileId &&
    row.operation_id === operation.operationId &&
    row.signer_operation_id === operation.signerOperationId &&
    row.request_sha256 === operation.requestSha256 &&
    row.request_nonce === operation.requestNonce &&
    row.environment === operation.environment &&
    row.chain_id === operation.chainId &&
    row.audience_manifest_url_sha256 ===
      operation.audienceManifestUrlSha256;
}

function cloudflareOperatorIssueAdmissionFromRow(
  row: CloudflareOperatorIssueRow,
): CloudflareOperatorIssueAdmission {
  const operation = cloudflareOperatorIssueBindingFromRow(row);
  const currentState = decodeCloudflareOperatorBinding(row.current_state_json);
  if (row.blocker !== "RETAINED" && row.blocker !== "CLEARED") {
    throw corruptStorage("Stored Cloudflare/operator issue blocker is invalid");
  }
  if (row.status === "IN_PROGRESS") {
    return {
      status: "IN_PROGRESS",
      operation,
      fencingToken: row.fencing_token,
      currentState,
    };
  }
  if (row.status === "RESULT_UNKNOWN") {
    if (row.blocker !== "RETAINED") {
      throw corruptStorage("Unknown Cloudflare/operator issue lost its blocker");
    }
    return {
      status: "RESULT_UNKNOWN",
      operation,
      fencingToken: row.fencing_token,
      currentState,
      ...(row.rejection_reason === null
        ? {}
        : { reason: row.rejection_reason }),
    };
  }
  if (row.status === "FINALIZED") {
    if (
      row.blocker !== "CLEARED" ||
      row.response_bytes === null ||
      row.response_length === null ||
      row.response_sha256 === null
    ) {
      throw corruptStorage("Finalized Cloudflare/operator issue is incomplete");
    }
    const responseBytes = bytesFromArrayBuffer(row.response_bytes);
    if (
      responseBytes.byteLength !== row.response_length ||
      !SHA256_BASE64URL_PATTERN.test(row.response_sha256)
    ) {
      throw corruptStorage("Finalized Cloudflare/operator response shape is invalid");
    }
    return {
      status: "FINALIZED",
      operation,
      fencingToken: row.fencing_token,
      currentState,
      responseBytes,
      responseSha256: row.response_sha256,
    };
  }
  if (row.status === "REJECTED") {
    if (row.blocker !== "CLEARED") {
      throw corruptStorage("Rejected Cloudflare/operator issue retained a blocker");
    }
    return {
      status: "REJECTED",
      operation,
      reason: row.rejection_reason ?? "Freshness issue was rejected",
    };
  }
  throw corruptStorage("Stored Cloudflare/operator issue status is invalid");
}

function runtimeUtcNow(): number {
  const nowMs = Date.now();
  if (!Number.isSafeInteger(nowMs)) {
    throw new FreshnessIssueCoordinatorStorageError(
      "INVALID_TIME",
      "Runtime host UTC is not a safe integer",
    );
  }
  return nowMs;
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

function copyCurrentStateBinding(
  state: FreshnessIssueCurrentStateBinding,
): FreshnessIssueCurrentStateBinding {
  return {
    ...state,
    antiRollbackWitness: { ...state.antiRollbackWitness },
  };
}

function copyLeaseBinding(
  lease: FreshnessIssueLeaseBinding,
): FreshnessIssueLeaseBinding {
  return {
    ...lease,
    operation: { ...lease.operation },
    currentState: copyCurrentStateBinding(lease.currentState),
  };
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

type ReleaseHeadBinding = Pick<
  ReleaseLedgerHead,
  "environment" | "chainId" | "position" | "generation" | "recordSha256" | "pointerEtag"
>;

const RELEASE_LEDGER_STATUSES: readonly ReleaseLedgerStatus[] = [
  "INTENT",
  "R2_WRITE_PENDING",
  "R2_STAGED",
  "LEDGER_COMMITTED",
  "R2_READBACK_PENDING",
  "AVAILABLE",
  "RESULT_UNKNOWN",
  "QUARANTINED",
  "CONFLICT",
];

function assertReleaseOperationRow(
  row: ReleaseLedgerOperationRow,
  expectedChainId: string,
): void {
  if (
    !UUID_V4_PATTERN.test(row.operation_id) ||
    !SHA256_BASE64URL_PATTERN.test(row.request_sha256) ||
    row.environment !== "production" ||
    row.chain_id !== expectedChainId ||
    !RELEASE_LEDGER_STATUSES.includes(row.status as ReleaseLedgerStatus) ||
    !(row.manifest_bytes instanceof ArrayBuffer) ||
    !Number.isSafeInteger(row.manifest_length) ||
    row.manifest_length !== row.manifest_bytes.byteLength ||
    row.manifest_length === 0 ||
    row.manifest_length > 1_048_576 ||
    !SHA256_BASE64URL_PATTERN.test(row.manifest_sha256) ||
    typeof row.manifest_epoch !== "string" ||
    typeof row.manifest_ref !== "string" ||
    typeof row.expected_pointer_etag !== "string"
  ) {
    throw corruptStorage("Persisted Release operation binding is invalid");
  }
  parseCanonicalUnsignedDecimal(row.manifest_epoch, "Stored Manifest epoch");
  if (row.fencing_token !== null) {
    parseCanonicalUnsignedDecimal(
      row.fencing_token,
      "Stored Release fencing token",
    );
  }
  if (
    (row.expected_position === null) !==
      (row.expected_generation === null) ||
    (row.expected_position === null) !==
      (row.expected_record_sha256 === null)
  ) {
    throw corruptStorage("Persisted Release predecessor binding is incomplete");
  }
  if (row.expected_position !== null) {
    parseCanonicalUnsignedDecimal(
      row.expected_position,
      "Stored Release predecessor position",
    );
    parseCanonicalUnsignedDecimal(
      row.expected_generation!,
      "Stored Release predecessor generation",
    );
    if (
      !SHA256_BASE64URL_PATTERN.test(row.expected_record_sha256!) ||
      row.expected_pointer_etag.length === 0
    ) {
      throw corruptStorage("Persisted Release predecessor binding is invalid");
    }
  }
  if (
    row.unknown_stage !== null &&
    row.unknown_stage !== "R2_WRITE" &&
    row.unknown_stage !== "RELEASE_SIGNER" &&
    row.unknown_stage !== "R2_READBACK"
  ) {
    throw corruptStorage("Persisted Release Unknown stage is invalid");
  }
  if (
    row.resume_status !== null &&
    !RELEASE_LEDGER_STATUSES.includes(
      row.resume_status as ReleaseLedgerStatus,
    )
  ) {
    throw corruptStorage("Persisted Release resume status is invalid");
  }
  if (
    (row.status === "RESULT_UNKNOWN") !== (row.unknown_stage !== null) ||
    (row.status !== "RESULT_UNKNOWN" &&
      (row.unknown_stage !== null || row.resume_status !== null))
  ) {
    throw corruptStorage("Persisted Release Unknown state is inconsistent");
  }

  const recordFieldsPresent = [
    row.record_bytes,
    row.record_length,
    row.record_sha256,
    row.record_appended_at,
    row.release_delegation_bytes,
    row.position,
    row.generation,
    row.release_commit_id,
  ].every((value) => value !== null);
  const recordFieldsAbsent = [
    row.record_bytes,
    row.record_length,
    row.record_sha256,
    row.record_appended_at,
    row.release_delegation_bytes,
    row.position,
    row.generation,
    row.release_commit_id,
  ].every((value) => value === null);
  if (!recordFieldsPresent && !recordFieldsAbsent) {
    throw corruptStorage("Persisted Release Record binding is incomplete");
  }
  if (recordFieldsPresent) {
    if (
      !(row.record_bytes instanceof ArrayBuffer) ||
      row.record_length !== row.record_bytes.byteLength ||
      row.record_length === 0 ||
      !SHA256_BASE64URL_PATTERN.test(row.record_sha256!) ||
      !(row.release_delegation_bytes instanceof ArrayBuffer) ||
      row.release_delegation_bytes.byteLength === 0 ||
      !UUID_V4_PATTERN.test(row.release_commit_id!)
    ) {
      throw corruptStorage("Persisted Release Record binding is invalid");
    }
    parseCanonicalUnsignedDecimal(row.position!, "Stored Release position");
    parseCanonicalUnsignedDecimal(row.generation!, "Stored Release generation");
    assertTimestampString(row.record_appended_at!);
  }

  if (
    (row.pointer_bytes === null) !== (row.pointer_etag === null) ||
    (row.pointer_bytes !== null &&
      (!(row.pointer_bytes instanceof ArrayBuffer) ||
        row.pointer_bytes.byteLength === 0 ||
        row.pointer_etag!.length === 0)) ||
    (row.snapshot_bytes !== null &&
      (!(row.snapshot_bytes instanceof ArrayBuffer) ||
        row.snapshot_bytes.byteLength === 0)) ||
    (row.snapshot_bytes !== null && row.pointer_bytes === null)
  ) {
    throw corruptStorage("Persisted Release R2 binding is incomplete");
  }
  if (
    row.status === "R2_STAGED" ||
    row.status === "LEDGER_COMMITTED" ||
    row.status === "R2_READBACK_PENDING" ||
    row.status === "AVAILABLE"
  ) {
    if (
      row.pointer_bytes === null ||
      row.snapshot_bytes === null ||
      !equalBytes(
        bytesFromArrayBuffer(row.pointer_bytes),
        bytesFromArrayBuffer(row.snapshot_bytes),
      ) ||
      !equalBytes(
        bytesFromArrayBuffer(row.pointer_bytes),
        bytesFromArrayBuffer(row.manifest_bytes),
      )
    ) {
      throw corruptStorage("Persisted Release R2 bytes differ from the Manifest");
    }
  }
  if (
    row.status === "AVAILABLE" &&
    (!recordFieldsPresent ||
      row.reason !== null ||
      row.pointer_etag === null)
  ) {
    throw corruptStorage("Available Release operation has incomplete proof state");
  }
}

function releaseOperationFromRow(
  row: ReleaseLedgerOperationRow,
): ReleaseLedgerOperation {
  if (!RELEASE_LEDGER_STATUSES.includes(row.status as ReleaseLedgerStatus)) {
    throw corruptStorage("Persisted Release operation status is invalid");
  }
  return {
    operationId: row.operation_id,
    requestSha256: row.request_sha256,
    status: row.status as ReleaseLedgerStatus,
    reason: row.reason,
    unknownStage: row.unknown_stage as
      | "R2_WRITE"
      | "RELEASE_SIGNER"
      | "R2_READBACK"
      | null,
    resumeStatus: row.resume_status as ReleaseLedgerStatus | null,
    fencingToken: row.fencing_token,
    expectedHead:
      row.expected_position === null
        ? null
        : {
            position: row.expected_position,
            generation: requiredString(
              row.expected_generation,
              "expected_generation",
            ),
            recordSha256: requiredString(
              row.expected_record_sha256,
              "expected_record_sha256",
            ),
            pointerEtag: row.expected_pointer_etag,
          },
    environment: row.environment as "production",
    chainId: row.chain_id,
    manifestBytes: copyBytes(bytesFromArrayBuffer(row.manifest_bytes)),
    manifestLength: row.manifest_length,
    manifestSha256: row.manifest_sha256,
    manifestEpoch: row.manifest_epoch,
    manifestRef: row.manifest_ref,
    expectedPointerEtag: row.expected_pointer_etag,
    pointerBytes:
      row.pointer_bytes === null
        ? null
        : copyBytes(bytesFromArrayBuffer(row.pointer_bytes)),
    pointerEtag: row.pointer_etag,
    snapshotBytes:
      row.snapshot_bytes === null
        ? null
        : copyBytes(bytesFromArrayBuffer(row.snapshot_bytes)),
    recordBytes:
      row.record_bytes === null
        ? null
        : copyBytes(bytesFromArrayBuffer(row.record_bytes)),
    recordLength: row.record_length,
    recordSha256: row.record_sha256,
    localAppendObservedAt: row.record_appended_at,
    releaseDelegationBytes:
      row.release_delegation_bytes === null
        ? null
        : copyBytes(bytesFromArrayBuffer(row.release_delegation_bytes)),
    position: row.position,
    generation: row.generation,
  };
}

const RELEASE_BINDING_INSTALL_STATUSES = [
  "VERIFYING",
  "INSTALLED",
  "QUARANTINED",
  "CONFLICT",
] as const;

function releaseBindingInstallFromRow(
  row: ReleaseBindingInstallRow,
): ReleaseBindingInstallOperation {
  if (
    !UUID_V4_PATTERN.test(row.operation_id) ||
    !SHA256_BASE64URL_PATTERN.test(row.request_sha256) ||
    row.environment !== "production" ||
    row.chain_id.length === 0 ||
    (row.mode !== "BOOTSTRAP" && row.mode !== "ADVANCE") ||
    !RELEASE_BINDING_INSTALL_STATUSES.includes(
      row.status as (typeof RELEASE_BINDING_INSTALL_STATUSES)[number],
    ) ||
    row.release_operation_id.length === 0 ||
    row.release_fencing_token.length === 0 ||
    row.install_fencing_token.length === 0 ||
    row.expected_restore_epoch.length === 0 ||
    !/^[1-9][0-9]*$/u.test(row.target_position) ||
    !/^[1-9][0-9]*$/u.test(row.target_generation) ||
    !SHA256_BASE64URL_PATTERN.test(row.target_record_sha256) ||
    (row.mode === "BOOTSTRAP" &&
      row.expected_current_state_sha256 !== null) ||
    (row.mode === "ADVANCE" &&
      (row.expected_current_state_sha256 === null ||
        !SHA256_BASE64URL_PATTERN.test(row.expected_current_state_sha256))) ||
    (row.proof_context_sha256 !== null &&
      !SHA256_BASE64URL_PATTERN.test(row.proof_context_sha256)) ||
    (row.status === "INSTALLED") !== (row.installed_state_json !== null)
  ) {
    throw corruptStorage("Persisted current-state install operation is invalid");
  }
  const installedState = row.installed_state_json === null
    ? null
    : parseCurrentState(row.installed_state_json);
  if (
    (row.status === "INSTALLED") !== (row.proof_context_sha256 !== null)
  ) {
    throw corruptStorage("Persisted current-state install result is incomplete");
  }
  return {
    operationId: row.operation_id,
    requestSha256: row.request_sha256,
    environment: "production",
    chainId: row.chain_id,
    mode: row.mode as "BOOTSTRAP" | "ADVANCE",
    status: row.status as ReleaseBindingInstallOperation["status"],
    reason: row.reason,
    releaseOperationId: row.release_operation_id,
    releaseFencingToken: row.release_fencing_token,
    installFencingToken: row.install_fencing_token,
    expectedCurrentStateSha256: row.expected_current_state_sha256,
    expectedRestoreEpoch: row.expected_restore_epoch,
    targetPosition: row.target_position,
    targetGeneration: row.target_generation,
    targetRecordSha256: row.target_record_sha256,
    proofContextSha256: row.proof_context_sha256,
    installedState:
      installedState === null ? null : copyCurrentStateBinding(installedState),
  };
}

function releaseBindingInstallActionFromRow(
  row: ReleaseBindingInstallRow,
): ReleaseBindingInstallActionResult {
  const operation = releaseBindingInstallFromRow(row);
  if (operation.status === "VERIFYING") {
    return { status: "STARTED", operation };
  }
  if (operation.status === "INSTALLED") {
    return { status: "INSTALLED", operation };
  }
  if (operation.status === "QUARANTINED") {
    return { status: "QUARANTINED", operation };
  }
  return { status: "CONFLICT", operation };
}

function assertCurrentStateInstallProofContext(
  context: FreshnessCurrentStateInstallProofContext,
): void {
  assertUuid(context.installOperationId, "Current-state install operation ID");
  assertUuid(context.releaseOperationId, "Release operation ID");
  const validFence = (value: string) =>
    typeof value === "string" &&
    value.length <= 20 &&
    /^(0|[1-9][0-9]*)$/u.test(value);
  if (
    (context.mode !== "BOOTSTRAP" && context.mode !== "ADVANCE") ||
    context.environment !== "production" ||
    context.chainId.length === 0 ||
    !validFence(context.installFencingToken) ||
    !validFence(context.releaseFencingToken) ||
    !/^[1-9][0-9]*$/u.test(context.targetPosition) ||
    !/^[1-9][0-9]*$/u.test(context.targetGeneration) ||
    !SHA256_BASE64URL_PATTERN.test(context.targetRecordSha256) ||
    context.expectedRestoreEpoch.length === 0 ||
    (context.mode === "BOOTSTRAP" &&
      context.expectedCurrentStateSha256 !== null) ||
    (context.mode === "ADVANCE" &&
      (context.expectedCurrentStateSha256 === null ||
        !SHA256_BASE64URL_PATTERN.test(context.expectedCurrentStateSha256))) ||
    !SHA256_BASE64URL_PATTERN.test(context.readContextSha256) ||
    !Number.isSafeInteger(context.clock.nowMs) ||
    !Number.isSafeInteger(context.clock.uncertaintyMs) ||
    context.clock.uncertaintyMs < 0
  ) {
    throw invalidInput("Current-state install proof context is invalid");
  }
}

function installProofMatchesOperation(
  context: FreshnessCurrentStateInstallProofContext,
  operation: ReleaseBindingInstallRow,
): boolean {
  return (
    context.installOperationId === operation.operation_id &&
    context.installFencingToken === operation.install_fencing_token &&
    context.mode === operation.mode &&
    context.environment === operation.environment &&
    context.chainId === operation.chain_id &&
    context.releaseOperationId === operation.release_operation_id &&
    context.releaseFencingToken === operation.release_fencing_token &&
    context.targetPosition === operation.target_position &&
    context.targetGeneration === operation.target_generation &&
    context.targetRecordSha256 === operation.target_record_sha256 &&
    context.expectedRestoreEpoch === operation.expected_restore_epoch &&
    context.expectedCurrentStateSha256 ===
      operation.expected_current_state_sha256
  );
}

function releaseHeadMatchesOperation(
  head: ReleaseLedgerHeadRow,
  operation: ReleaseLedgerOperationRow,
): boolean {
  return (
    head.operation_id === operation.operation_id &&
    head.environment === operation.environment &&
    head.chain_id === operation.chain_id &&
    head.position === operation.position &&
    head.generation === operation.generation &&
    head.record_sha256 === operation.record_sha256 &&
    head.manifest_epoch === operation.manifest_epoch &&
    head.manifest_sha256 === operation.manifest_sha256 &&
    head.manifest_ref === operation.manifest_ref &&
    head.pointer_etag === operation.pointer_etag
  );
}

function releaseOperationPredecessorMatchesState(
  operation: ReleaseLedgerOperationRow,
  state: FreshnessIssueCurrentStateBinding,
): boolean {
  return (
    operation.expected_position === state.generation &&
    operation.expected_generation === state.generation &&
    operation.expected_record_sha256 === state.releaseCommitRecordSha256 &&
    operation.expected_pointer_etag === state.pointerEtag &&
    state.journalHeadSha256 === state.releaseCommitRecordSha256
  );
}

function verifiedReleaseStateMatchesOperation(
  state: VerifiedFreshnessReleaseState,
  operation: ReleaseLedgerOperationRow,
  head: ReleaseLedgerHeadRow,
  context: FreshnessCurrentStateInstallProofContext,
): boolean {
  const recordPayload = state.verifiedReleaseCommitRecord.payload;
  if (
    operation.record_bytes === null ||
    operation.record_length === null ||
    operation.record_sha256 === null ||
    operation.release_delegation_bytes === null ||
    operation.pointer_bytes === null ||
    operation.snapshot_bytes === null ||
    operation.pointer_etag === null ||
    state.source !== "verified-release-journal-r2-witness" ||
    state.environment !== "production" ||
    state.chainId !== operation.chain_id ||
    state.journalHead.position !== context.targetPosition ||
    state.journalHead.generation !== operation.generation ||
    state.journalHead.record_sha256 !== operation.record_sha256 ||
    state.releaseCommitRecordSha256 !== operation.record_sha256 ||
    state.releaseCommitRecordSha256 !== head.record_sha256 ||
    recordPayload.commit_generation !== operation.generation ||
    recordPayload.previous_commit_record_sha256 !==
      operation.previous_record_sha256 ||
    recordPayload.manifest_sha256 !== operation.manifest_sha256 ||
    recordPayload.manifest_epoch !== operation.manifest_epoch ||
    recordPayload.manifest_ref !== operation.manifest_ref ||
    recordPayload.pointer_etag !== operation.pointer_etag ||
    state.manifestSha256 !== operation.manifest_sha256 ||
    state.manifestEpoch !== operation.manifest_epoch ||
    state.manifestRef !== operation.manifest_ref ||
    state.pointerEtag !== operation.pointer_etag ||
    state.pointerGeneration !== operation.generation ||
    state.antiRollbackWitness.generation !== operation.generation ||
    state.antiRollbackWitness.recordSha256 !== operation.record_sha256 ||
    state.antiRollbackWitness.restoreEpoch !== context.expectedRestoreEpoch ||
    state.proofContextSha256 !== context.readContextSha256 ||
    !equalBytes(state.releaseDelegationBytes, bytesFromArrayBuffer(operation.release_delegation_bytes)) ||
    !equalBytes(
      state.recordBytes,
      bytesFromArrayBuffer(operation.record_bytes),
    ) ||
    !equalBytes(
      state.manifestBytes,
      bytesFromArrayBuffer(operation.manifest_bytes),
    ) ||
    !equalBytes(
      state.manifestBytes,
      bytesFromArrayBuffer(operation.pointer_bytes),
    ) ||
    !equalBytes(
      state.manifestBytes,
      bytesFromArrayBuffer(operation.snapshot_bytes),
    ) ||
    !equalBytes(
      bytesFromArrayBuffer(operation.record_bytes),
      bytesFromArrayBuffer(head.record_bytes),
    )
  ) {
    return false;
  }
  return operation.record_length === operation.record_bytes.byteLength;
}

function bootstrapAuthorizationMatchesInstall(
  authorization: CurrentStateBootstrapAuthorizationRow,
  release: ReleaseLedgerOperationRow,
  expectedRestoreEpoch: string,
): boolean {
  return (
    release.environment === "production" &&
    release.position === "1" &&
    release.generation === "1" &&
    release.previous_record_sha256 === null &&
    authorization.operation_id === release.operation_id &&
    authorization.chain_id === release.chain_id &&
    authorization.position === release.position &&
    authorization.generation === release.generation &&
    authorization.record_sha256 === release.record_sha256 &&
    authorization.restore_epoch === expectedRestoreEpoch
  );
}

function releaseActionFromOperation(
  operation: ReleaseLedgerOperation,
): ReleaseLedgerActionResult {
  const status =
    operation.status === "INTENT" ? "STARTED" : operation.status;
  return { status, operation };
}

function releaseExpectedHeadFromRow(
  row: ReleaseLedgerOperationRow,
): ReleaseHeadBinding {
  if (
    row.expected_position === null ||
    row.expected_generation === null ||
    row.expected_record_sha256 === null
  ) {
    throw corruptStorage("Release operation has no complete predecessor");
  }
  return {
    environment: "production",
    chainId: row.chain_id,
    position: row.expected_position,
    generation: row.expected_generation,
    recordSha256: row.expected_record_sha256,
    pointerEtag: row.expected_pointer_etag,
  };
}

function sameReleaseHeadBinding(
  left: ReleaseLedgerHeadRow | null,
  right: ReleaseLedgerHead | ReleaseHeadBinding | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.environment === right.environment &&
    left.chain_id === right.chainId &&
    left.position === right.position &&
    left.generation === right.generation &&
    left.record_sha256 === right.recordSha256 &&
    left.pointer_etag === right.pointerEtag
  );
}

function coordinatorStateMatchesReleaseHead(
  currentState: FreshnessIssueCurrentStateBinding,
  head: ReleaseLedgerHeadRow,
): boolean {
  return (
    currentState.environment === "production" &&
    currentState.generation === head.generation &&
    currentState.journalHeadSha256 === head.record_sha256 &&
    currentState.releaseCommitId === head.release_commit_id &&
    currentState.releaseCommitRecordSha256 === head.record_sha256 &&
    currentState.manifestEpoch === head.manifest_epoch &&
    currentState.manifestSha256 === head.manifest_sha256 &&
    currentState.manifestRef === head.manifest_ref &&
    currentState.pointerEtag === head.pointer_etag &&
    currentState.pointerGeneration === head.generation
  );
}

function assertReleaseRecordMatchesOperation(
  record: Awaited<ReturnType<typeof verifyRuntimeConfigReleaseCommitRecord>>,
  operation: ReleaseLedgerOperation,
  recordBytes: Uint8Array,
  releaseDelegationBytes: Uint8Array,
): void {
  if (
    operation.environment !== "production" ||
    (operation.recordSha256 !== null &&
      record.digest !== operation.recordSha256) ||
    (operation.recordBytes !== null &&
      !equalBytes(recordBytes, operation.recordBytes)) ||
    (operation.releaseDelegationBytes !== null &&
      !equalBytes(
        releaseDelegationBytes,
        operation.releaseDelegationBytes,
      )) ||
    record.payload.manifest_epoch !== operation.manifestEpoch ||
    record.payload.manifest_sha256 !== operation.manifestSha256 ||
    record.payload.manifest_ref !== operation.manifestRef ||
    (operation.pointerEtag !== null &&
      record.payload.pointer_etag !== operation.pointerEtag)
  ) {
    throw invalidInput("Release Record does not match the stored operation binding");
  }
}

function copyReleaseHead(
  value: ReleaseLedgerHead | null,
): ReleaseLedgerHead | null {
  if (value === null) return null;
  const head: ReleaseLedgerHead = {
    environment: value.environment,
    chainId: value.chainId,
    position: value.position,
    generation: value.generation,
    recordSha256: value.recordSha256,
    recordBytes: copyBytes(value.recordBytes),
    releaseDelegationBytes: copyBytes(value.releaseDelegationBytes),
    previousRecordSha256: value.previousRecordSha256,
    releaseCommitId: value.releaseCommitId,
    localAppendObservedAt: value.localAppendObservedAt,
    manifestEpoch: value.manifestEpoch,
    manifestSha256: value.manifestSha256,
    manifestRef: value.manifestRef,
    pointerEtag: value.pointerEtag,
    manifestBytes: copyBytes(value.manifestBytes),
  };
  if (
    head.environment !== "production" ||
    head.chainId.length === 0 ||
    head.position.length === 0 ||
    head.generation.length === 0 ||
    !SHA256_BASE64URL_PATTERN.test(head.recordSha256) ||
    !UUID_V4_PATTERN.test(head.releaseCommitId) ||
    !SHA256_BASE64URL_PATTERN.test(head.manifestSha256) ||
    head.manifestEpoch.length === 0 ||
    head.manifestRef.length === 0 ||
    head.pointerEtag.length === 0 ||
    head.recordBytes.byteLength === 0 ||
    head.releaseDelegationBytes.byteLength === 0 ||
    head.manifestBytes.byteLength === 0
  ) {
    throw invalidInput("Expected Release head binding is invalid");
  }
  parseCanonicalUnsignedDecimal(head.position, "Expected Release position");
  parseCanonicalUnsignedDecimal(head.generation, "Expected Release generation");
  parseCanonicalUnsignedDecimal(head.manifestEpoch, "Expected Manifest epoch");
  if (
    head.previousRecordSha256 !== null &&
    !SHA256_BASE64URL_PATTERN.test(head.previousRecordSha256)
  ) {
    throw invalidInput("Expected Release predecessor digest is invalid");
  }
  assertTimestampString(head.localAppendObservedAt);
  return head;
}

function assertTimestampString(value: string): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw corruptStorage("Stored Release append observation time is invalid");
  }
}

function timestampFromMilliseconds(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw invalidInput("Release append observation clock is invalid");
  }
  try {
    return new Date(value).toISOString();
  } catch {
    throw invalidInput(
      "Release append observation time is outside the valid range",
    );
  }
}

async function sha256Base64Url(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return encodeBase64Url(new Uint8Array(digest));
}

async function cloudflareOperatorGenesisOperationId(
  approvalBytes: Uint8Array,
): Promise<string> {
  const preimage = canonicalJsonBytes({
    domain: GENESIS_OPERATION_ID_DOMAIN,
    approval: encodeBase64Url(approvalBytes),
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", arrayBufferFromBytes(preimage)),
  );
  const uuid = digest.slice(0, 16);
  uuid[6] = (uuid[6]! & 0x0f) | 0x40;
  uuid[8] = (uuid[8]! & 0x3f) | 0x80;
  const hex = [...uuid]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}

function genesisConflict(
  operationId: string,
): CloudflareOperatorGenesisOperation {
  return {
    operationId,
    status: "CONFLICT",
    releaseStatus: null,
    installStatus: null,
  };
}

function requireFencingToken(operation: ReleaseLedgerOperation): string {
  if (operation.fencingToken === null) {
    throw corruptStorage("Release operation is missing its fencing token");
  }
  return operation.fencingToken;
}

function isCanonicalFencingToken(value: string): boolean {
  return value.length <= 20 && /^(0|[1-9][0-9]*)$/u.test(value);
}

function cloudflareOperatorInstallRequestBytes(input: {
  readonly operationId: string;
  readonly mode: "BOOTSTRAP" | "ADVANCE";
  readonly releaseOperationId: string;
  readonly releaseFencingToken: string;
  readonly expectedCurrentStateSha256: string | null;
  readonly expectedRestoreEpoch: string;
  readonly chainId: string;
}): Uint8Array {
  return canonicalJsonBytes({
    profileId: CLOUDFLARE_OPERATOR_FRESHNESS_PROFILE_ID,
    operationId: input.operationId,
    mode: input.mode,
    releaseOperationId: input.releaseOperationId,
    releaseFencingToken: input.releaseFencingToken,
    expectedCurrentStateSha256: input.expectedCurrentStateSha256,
    expectedRestoreEpoch: input.expectedRestoreEpoch,
    environment: "production",
    chainId: input.chainId,
  });
}

function cloudflareOperatorGenesisStatus(
  row: CloudflareOperatorGenesisRow,
  release: ReleaseLedgerOperation,
  install: CloudflareOperatorBindingInstallOperation | null,
): CloudflareOperatorGenesisOperation["status"] {
  if (row.status === "QUARANTINED" || release.status === "QUARANTINED") {
    return "QUARANTINED";
  }
  if (install?.status === "QUARANTINED") return "QUARANTINED";
  if (install?.status === "CONFLICT" || release.status === "CONFLICT") {
    return "CONFLICT";
  }
  if (install?.status === "INSTALLED") {
    if (release.status !== "AVAILABLE") {
      throw corruptStorage(
        "Genesis binding is installed without an Available Release",
      );
    }
    return "INSTALLED";
  }
  if (row.status === "INSTALLED") {
    throw corruptStorage(
      "Genesis operation is installed without a finalized binding",
    );
  }
  if (install?.status === "VERIFYING") return "INSTALLING";

  switch (release.status) {
    case "R2_STAGED":
      return row.status === "RESULT_UNKNOWN" ? "RESULT_UNKNOWN" : "VERIFYING";
    case "LEDGER_COMMITTED":
      return row.status === "RESULT_UNKNOWN"
        ? "RESULT_UNKNOWN"
        : "LEDGER_COMMITTED";
    case "R2_READBACK_PENDING":
      return row.status === "RESULT_UNKNOWN"
        ? "RESULT_UNKNOWN"
        : "R2_READBACK_PENDING";
    case "RESULT_UNKNOWN":
      return "RESULT_UNKNOWN";
    case "AVAILABLE":
      return row.status === "INSTALLING" ? "INSTALLING" : "AVAILABLE";
    case "INTENT":
    case "R2_WRITE_PENDING":
      throw corruptStorage(
        "Genesis Release operation is in an unsupported pre-staged state",
      );
  }
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

function bytesFromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
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
