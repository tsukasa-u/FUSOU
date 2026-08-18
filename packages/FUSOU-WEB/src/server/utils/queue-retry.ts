type QueueSender<Body> = {
  send: (message: Body) => Promise<unknown>;
};

export type QueueSendRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  delay?: (ms: number) => Promise<void>;
};

export function getQueueErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status,
  ]) {
    const status = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  return null;
}

function isRetryableQueueError(error: unknown): boolean {
  const status = getQueueErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /(?:network|timeout|temporar|unavailable|overload|rate.?limit|429)/i.test(
    message,
  );
}

export async function sendQueueMessageWithRetry<Body>(
  queue: QueueSender<Body>,
  message: Body,
  options: QueueSendRetryOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const baseDelayMs = Math.max(0, Math.floor(options.baseDelayMs ?? 100));
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await queue.send(message);
      return;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableQueueError(error)) {
        throw error;
      }
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }
}