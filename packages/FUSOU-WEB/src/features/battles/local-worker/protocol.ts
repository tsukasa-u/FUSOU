import type { LocalAvroFileEntry } from "../local-directory/manifest";
import type { BattleDataProgressPhase } from "../repository/types";
import type {
  BattleDetailQuery,
  BattleDetailPayload,
  BattleDropsPayload,
  BattleOverviewPayload,
  BattlePeriod,
  DropsQuery,
  OverviewQuery,
  RecordQuery,
  RecordResult,
} from "../repository/types";

export type LocalBattleErrorCode =
  | "PERMISSION_REQUIRED"
  | "PERMISSION_DENIED"
  | "INVALID_DIRECTORY_LAYOUT"
  | "NO_BATTLE_DATA"
  | "FILE_LIMIT_EXCEEDED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_CODEC"
  | "UNKNOWN_SCHEMA"
  | "SCHEMA_PATH_MISMATCH"
  | "CORRUPT_AVRO"
  | "OUT_OF_MEMORY_GUARD"
  | "BATTLE_NOT_FOUND"
  | "CANCELLED";

export class LocalBattleError extends Error {
  constructor(
    readonly code: LocalBattleErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LocalBattleError";
  }
}

export type ProgressPhase = BattleDataProgressPhase;

export type LocalManifestEntry = LocalAvroFileEntry & {
  file?: File;
  handle?: FileSystemFileHandle;
};

export type SerializableManifest = {
  entries: LocalManifestEntry[];
  fingerprint: string;
};

export type WorkerRecordQuery = Omit<RecordQuery, "signal" | "forceRefresh">;
export type WorkerOverviewQuery = Omit<OverviewQuery, "signal" | "forceRefresh">;
export type WorkerDropsQuery = Omit<DropsQuery, "signal" | "forceRefresh">;
export type WorkerDetailQuery = Omit<BattleDetailQuery, "signal" | "forceRefresh">;

export type WorkerRequestPayload =
  | { type: "initialize"; manifest: SerializableManifest }
  | { type: "list-periods"; table: string }
  | { type: "records"; query: WorkerRecordQuery }
  | { type: "overview"; query: WorkerOverviewQuery }
  | { type: "drops"; query: WorkerDropsQuery }
  | { type: "detail"; query: WorkerDetailQuery }
  | { type: "cancel"; targetId: string }
  | { type: "dispose" };

export type WorkerRequest = WorkerRequestPayload & { id: string };

export type WorkerResult =
  | BattlePeriod[]
  | RecordResult
  | BattleOverviewPayload
  | BattleDropsPayload
  | BattleDetailPayload
  | Record<string, unknown>;

export type WorkerResponse =
  | { id: string; type: "result"; value: WorkerResult }
  | {
      id: string;
      type: "progress";
      phase: ProgressPhase;
      completed: number;
      total: number;
      label?: string;
      completedBytes?: number;
      totalBytes?: number;
      records?: number;
    }
  | { id: string; type: "error"; error: SerializedLocalBattleError }
  | { id: string; type: "cancelled" };

export type SerializedLocalBattleError = {
  code: LocalBattleErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

export function serializeLocalBattleError(
  error: unknown,
): SerializedLocalBattleError {
  if (error instanceof LocalBattleError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  return {
    code: "CORRUPT_AVRO",
    message: "ローカル AVRO の処理に失敗しました。",
  };
}

export function deserializeLocalBattleError(
  error: SerializedLocalBattleError,
): LocalBattleError {
  return new LocalBattleError(error.code, error.message, error.details);
}