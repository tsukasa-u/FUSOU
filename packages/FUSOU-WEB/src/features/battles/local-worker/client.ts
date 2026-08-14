import {
  deserializeLocalBattleError,
  type SerializableManifest,
  type WorkerRequest,
  type WorkerRequestPayload,
  type WorkerResponse,
  type WorkerResult,
} from "./protocol";

type PendingRequest = {
  resolve: (value: WorkerResult) => void;
  reject: (error: unknown) => void;
  onProgress?: (response: Extract<WorkerResponse, { type: "progress" }>) => void;
};

export type WorkerFactory = () => Worker;

function defaultWorkerFactory(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

export class LocalAvroWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 0;
  private disposed = false;
  private workerFailed = false;

  constructor(workerFactory: WorkerFactory = defaultWorkerFactory) {
    this.worker = workerFactory();
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  initialize(manifest: SerializableManifest): Promise<WorkerResult> {
    return this.request({ type: "initialize", manifest });
  }

  listPeriods(table: string): Promise<WorkerResult> {
    return this.request({ type: "list-periods", table });
  }

  records(
    query: Extract<WorkerRequest, { type: "records" }>["query"],
    options: {
      signal?: AbortSignal;
      onProgress?: PendingRequest["onProgress"];
    } = {},
  ): Promise<WorkerResult> {
    return this.request({ type: "records", query }, options);
  }

  overview(
    query: Extract<WorkerRequest, { type: "overview" }>["query"],
    options: {
      signal?: AbortSignal;
      onProgress?: PendingRequest["onProgress"];
    } = {},
  ): Promise<WorkerResult> {
    return this.request({ type: "overview", query }, options);
  }

  drops(
    query: Extract<WorkerRequest, { type: "drops" }>["query"],
    options: {
      signal?: AbortSignal;
      onProgress?: PendingRequest["onProgress"];
    } = {},
  ): Promise<WorkerResult> {
    return this.request({ type: "drops", query }, options);
  }

  detail(
    query: Extract<WorkerRequest, { type: "detail" }>["query"],
    options: {
      signal?: AbortSignal;
      onProgress?: PendingRequest["onProgress"];
    } = {},
  ): Promise<WorkerResult> {
    return this.request({ type: "detail", query }, options);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.workerFailed) await this.request({ type: "dispose" });
    } finally {
      this.disposed = true;
      for (const request of this.pending.values()) {
        request.reject(new Error("Local AVRO worker disposed"));
      }
      this.pending.clear();
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleWorkerError);
      this.worker.terminate();
    }
  }

  private request(
    request: WorkerRequestPayload,
    options: {
      signal?: AbortSignal;
      onProgress?: PendingRequest["onProgress"];
    } = {},
  ): Promise<WorkerResult> {
    if (this.disposed) return Promise.reject(new Error("Local AVRO worker disposed"));
    if (this.workerFailed) return Promise.reject(new Error("Local AVRO worker failed"));
    const id = `local-avro-${this.nextId++}`;
    const promise = new Promise<WorkerResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject,
        ...(options.onProgress === undefined
          ? {}
          : { onProgress: options.onProgress }),
      });
      this.worker.postMessage({ id, ...request } satisfies WorkerRequest);
    });
    if (options.signal) {
      const cancel = () => {
        if (!this.pending.has(id)) return;
        this.worker.postMessage({
          id: `${id}-cancel`,
          type: "cancel",
          targetId: id,
        } satisfies WorkerRequest);
      };
      if (options.signal.aborted) cancel();
      else options.signal.addEventListener("abort", cancel, { once: true });
    }
    return promise;
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === "progress") {
      pending.onProgress?.(response);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === "result") pending.resolve(response.value);
    else if (response.type === "cancelled") {
      pending.reject(deserializeLocalBattleError({ code: "CANCELLED", message: "ローカル AVRO query がキャンセルされました。" }));
    } else {
      pending.reject(deserializeLocalBattleError(response.error));
    }
  };

  private readonly handleWorkerError = (): void => {
    this.workerFailed = true;
    const error = new Error("Local AVRO worker failed");
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  };
}