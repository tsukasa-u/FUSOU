import { describe, expect, it, vi } from "vitest";
import {
  getQueueErrorStatus,
  sendQueueMessageWithRetry,
} from "../queue-retry";

describe("sendQueueMessageWithRetry", () => {
  it("retries a rate-limited send and resolves after recovery", async () => {
    const send = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce();
    const delay = vi.fn(async () => undefined);

    await sendQueueMessageWithRetry(
      { send },
      { datasetId: "dataset-1" },
      { delay, baseDelayMs: 25 },
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(25);
  });

  it("does not retry non-transient failures", async () => {
    const error = { status: 400 };
    const send = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const delay = vi.fn(async () => undefined);

    await expect(
      sendQueueMessageWithRetry(
        { send },
        { datasetId: "dataset-1" },
        { delay },
      ),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });
});

describe("getQueueErrorStatus", () => {
  it("reads status from common queue error shapes", () => {
    expect(getQueueErrorStatus({ statusCode: 503 })).toBe(503);
    expect(getQueueErrorStatus({ response: { status: 429 } })).toBe(429);
    expect(getQueueErrorStatus(new Error("network failure"))).toBeNull();
  });
});