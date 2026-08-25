import { describe, expect, it } from "vitest";
import { LocalAvroWorkerClient } from "../client";
import type { WorkerRequest, WorkerResponse } from "../protocol";

class FakeWorker {
  terminated = false;
  private messageListener: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  private errorListener: (() => void) | null = null;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === "message") {
      this.messageListener = listener as (event: MessageEvent<WorkerResponse>) => void;
    } else if (type === "error") {
      this.errorListener = listener as () => void;
    }
  }

  removeEventListener(type: string): void {
    if (type === "message") this.messageListener = null;
    if (type === "error") this.errorListener = null;
  }

  postMessage(request: WorkerRequest): void {
    if (request.type === "cancel") {
      this.emit({ id: request.targetId, type: "cancelled" });
      return;
    }
    if (request.type === "initialize") {
      this.emit({
        id: request.id,
        type: "progress",
        phase: "manifest-validation",
        completed: 1,
        total: 1,
      });
      this.emit({ id: request.id, type: "result", value: { initialized: true } });
      return;
    }
    if (request.type === "dispose") {
      this.emit({ id: request.id, type: "result", value: {} });
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  fail(): void {
    this.errorListener?.();
  }

  private emit(response: WorkerResponse): void {
    queueMicrotask(() => this.messageListener?.({ data: response } as MessageEvent<WorkerResponse>));
  }
}

describe("LocalAvroWorkerClient", () => {
  it("correlates results, ignores progress without resolving, and terminates on dispose", async () => {
    const worker = new FakeWorker();
    const client = new LocalAvroWorkerClient(() => worker as unknown as Worker);
    const progress: string[] = [];

    await expect(
      client.initialize({ fingerprint: "fixture", entries: [] }),
    ).resolves.toEqual({ initialized: true });
    expect(progress).toEqual([]);

    await client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("rejects the target request when its AbortSignal is cancelled", async () => {
    const worker = new FakeWorker();
    const client = new LocalAvroWorkerClient(() => worker as unknown as Worker);
    const controller = new AbortController();
    const request = client.records(
      { table: "battle", periodTag: "2026-07-08", limitRecords: 10 },
      { signal: controller.signal },
    );

    controller.abort();

    await expect(request).rejects.toMatchObject({
      name: "LocalBattleError",
      code: "CANCELLED",
    });
    await client.dispose();
  });

  it("does not reuse a worker client after the worker fails", async () => {
    const worker = new FakeWorker();
    const client = new LocalAvroWorkerClient(() => worker as unknown as Worker);

    worker.fail();

    await expect(client.listPeriods("battle")).rejects.toThrow(
      "Local AVRO worker failed",
    );
    await client.dispose();
    expect(worker.terminated).toBe(true);
  });
});