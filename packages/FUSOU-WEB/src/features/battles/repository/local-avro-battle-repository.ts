import {
  LocalAvroWorkerClient,
  type WorkerFactory,
} from "../local-worker/client";
import type { SerializableManifest, WorkerResult } from "../local-worker/protocol";
import { LocalBattleError } from "../local-worker/protocol";
import type {
  BattleDataRepository,
  BattleRepositoryRequestOptions,
  BattleDetailPayload,
  BattleDetailQuery,
  BattleDropsPayload,
  BattleOverviewPayload,
  BattlePeriod,
  BattleSourceKind,
  DropsQuery,
  OverviewQuery,
  RecordQuery,
  RecordResult,
} from "./types";

type LocalWorkerClientPort = Pick<
  LocalAvroWorkerClient,
  "initialize" | "listPeriods" | "records" | "overview" | "drops" | "detail" | "dispose"
>;

function resultAs<T>(value: WorkerResult): T {
  return value as T;
}

function workerQuery<T extends { signal?: AbortSignal; forceRefresh?: boolean }>(
  query: T,
): Omit<T, "signal" | "forceRefresh"> {
  const { signal: _signal, forceRefresh: _forceRefresh, ...serializable } = query;
  return serializable;
}

export class LocalAvroBattleRepository implements BattleDataRepository {
  readonly kind: BattleSourceKind = "local-avro";

  private readonly client: LocalWorkerClientPort;
  private readonly ready: Promise<void>;
  private disposed = false;

  constructor(
    manifest: SerializableManifest,
    workerFactory?: WorkerFactory,
    client?: LocalWorkerClientPort,
  ) {
    this.client = client || new LocalAvroWorkerClient(workerFactory);
    this.ready = this.client.initialize(manifest).then(() => undefined);
  }

  async listPeriods(table: string): Promise<BattlePeriod[]> {
    await this.ensureReady();
    return resultAs<BattlePeriod[]>(await this.client.listPeriods(table));
  }

  async getRecords(query: RecordQuery, options?: BattleRepositoryRequestOptions): Promise<RecordResult> {
    await this.ensureReady();
    return resultAs<RecordResult>(
      await this.client.records(workerQuery(query), { signal: query.signal, onProgress: options?.onProgress }),
    );
  }

  async getOverview(query: OverviewQuery, options?: BattleRepositoryRequestOptions): Promise<BattleOverviewPayload> {
    await this.ensureReady();
    return resultAs<BattleOverviewPayload>(
      await this.client.overview(workerQuery(query), { signal: query.signal, onProgress: options?.onProgress }),
    );
  }

  async getDrops(query: DropsQuery, options?: BattleRepositoryRequestOptions): Promise<BattleDropsPayload> {
    await this.ensureReady();
    return resultAs<BattleDropsPayload>(
      await this.client.drops(workerQuery(query), { signal: query.signal, onProgress: options?.onProgress }),
    );
  }

  async getDetail(query: BattleDetailQuery, options?: BattleRepositoryRequestOptions): Promise<BattleDetailPayload> {
    await this.ensureReady();
    return resultAs<BattleDetailPayload>(
      await this.client.detail(workerQuery(query), { signal: query.signal, onProgress: options?.onProgress }),
    );
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.client.dispose();
  }

  private async ensureReady(): Promise<void> {
    if (this.disposed) {
      throw new LocalBattleError(
        "PERMISSION_REQUIRED",
        "ローカル AVRO repository は破棄されています。",
      );
    }
    await this.ready;
  }
}