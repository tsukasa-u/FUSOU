import type { KVNamespace } from "@cloudflare/workers-types";

// Configuration
const DEFAULT_MAX_RU = 1000;
const DEFAULT_REFILL_RATE = 10; // RU per second
const RU_COSTS = {
  LATEST: 10,
  ARCHIVE_BASE: 50,
  ARCHIVE_PER_FILE: 1,
  LIST: 1,
  VERIFY: 0,
};

interface RUStatus {
  allowed: boolean;
  remaining: number;
  consumed: number;
  resetAt?: number;
}

/**
 * Check and deduct RUs using Token Bucket algorithm backed by KV.
 */
export async function checkAndDeductRU(
  kv: KVNamespace,
  userId: string,
  cost: number
): Promise<RUStatus> {
  const key = `ru_bucket:${userId}`;
  const now = Date.now();
  
  // Read current bucket state
  // Format: { tokens: number, lastRefill: number }
  const data = await kv.get(key, "json") as { tokens: number; lastRefill: number } | null;
  
  let tokens = DEFAULT_MAX_RU;
  let lastRefill = now;
  
  if (data) {
    tokens = data.tokens;
    lastRefill = data.lastRefill;
  }
  
  // Refill
  const elapsedSeconds = (now - lastRefill) / 1000;
  const newTokens = elapsedSeconds * DEFAULT_REFILL_RATE;
  tokens = Math.min(DEFAULT_MAX_RU, tokens + newTokens);
  
  // Check
  if (tokens < cost) {
    return {
      allowed: false,
      remaining: Math.floor(tokens),
      consumed: 0,
      resetAt: now + ((cost - tokens) / DEFAULT_REFILL_RATE) * 1000
    };
  }
  
  // Deduct
  tokens -= cost;
  
  // Save (TTL 1 hour is enough as tokens cap at MAX)
  await kv.put(key, JSON.stringify({ tokens, lastRefill: now }), { expirationTtl: 3600 });
  
  return {
    allowed: true,
    remaining: Math.floor(tokens),
    consumed: cost
  };
}

export { RU_COSTS };
