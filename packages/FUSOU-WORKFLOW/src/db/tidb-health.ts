/**
 * TiDB Health Check and Rate Limit Detection
 * 
 * Provides utilities for:
 * - Connection health check (lightweight SELECT 1)
 * - 429 Rate limit error detection
 * - RU exhaustion detection
 */

import { TiDBConnection } from './tidb-client';

/**
 * Error types that indicate TiDB should be skipped
 */
export const TIDB_SKIP_ERROR_PATTERNS = [
  '429',
  'Too Many Requests',
  'rate limit',
  'RU limit',
  'quota exceeded',
  'resource exhausted',
] as const;

/**
 * Check if an error indicates TiDB rate limiting or RU exhaustion
 */
export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TIDB_SKIP_ERROR_PATTERNS.some(pattern => 
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Check if TiDB connection is healthy
 * Uses lightweight SELECT 1 query (~1 RU)
 * 
 * @returns true if healthy, false if unhealthy or rate limited
 */
export async function checkTiDBHealth(conn: TiDBConnection): Promise<{
  healthy: boolean;
  rateLimited: boolean;
  error?: string;
}> {
  try {
    await conn.execute('SELECT 1');
    return { healthy: true, rateLimited: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    
    if (isRateLimitError(err)) {
      console.warn('[TiDB Health] Rate limit detected:', message);
      return { healthy: false, rateLimited: true, error: message };
    }
    
    console.error('[TiDB Health] Connection error:', message);
    return { healthy: false, rateLimited: false, error: message };
  }
}

/**
 * Execute a TiDB operation with rate limit detection
 * Returns the result or throws an error with rate limit flag
 */
export async function executeWithRateLimitDetection<T>(
  operation: () => Promise<T>,
  operationName: string = 'TiDB operation'
): Promise<{ result: T; rateLimited: false } | { result: null; rateLimited: true; error: string }> {
  try {
    const result = await operation();
    return { result, rateLimited: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    
    if (isRateLimitError(err)) {
      console.warn(`[TiDB] Rate limit during ${operationName}:`, message);
      return { result: null, rateLimited: true, error: message };
    }
    
    // Re-throw non-rate-limit errors
    throw err;
  }
}

/**
 * TiDB health status for caching
 */
let lastHealthCheck: {
  timestamp: number;
  healthy: boolean;
  rateLimited: boolean;
} | null = null;

const HEALTH_CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Check TiDB health with caching to avoid excessive health checks
 */
export async function checkTiDBHealthCached(
  conn: TiDBConnection,
  forceFresh: boolean = false
): Promise<{ healthy: boolean; rateLimited: boolean; cached: boolean }> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (
    !forceFresh &&
    lastHealthCheck &&
    now - lastHealthCheck.timestamp < HEALTH_CACHE_TTL_MS
  ) {
    return {
      healthy: lastHealthCheck.healthy,
      rateLimited: lastHealthCheck.rateLimited,
      cached: true,
    };
  }
  
  // Fresh health check
  const result = await checkTiDBHealth(conn);
  lastHealthCheck = {
    timestamp: now,
    healthy: result.healthy,
    rateLimited: result.rateLimited,
  };
  
  return { ...result, cached: false };
}

/**
 * Clear health cache (useful after successful operations)
 */
export function clearHealthCache(): void {
  lastHealthCheck = null;
}
