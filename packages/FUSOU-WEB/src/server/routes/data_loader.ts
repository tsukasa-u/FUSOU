/**
 * Data Loader Routes
 *
 * Provides secure data distribution with Device Trust authentication.
 * Python clients can request Avro datasets after API key and device verification.
 *
 * Features:
 * - Period tag filtering (latest, specific tag, or all)
 * - Dataset/table discovery endpoints
 * - Device trust authentication
 */

import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { checkAndDeductRU, RU_COSTS } from "../utils/ru";

import { createEnvContext, resolveSupabaseConfig, getEnv, type EnvContext } from "../utils";

// CORS headers for Python client access
const DATA_LOADER_CORS_HEADERS = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Headers": "Content-Type, X-API-KEY, X-CLIENT-ID",
};

// Helper to add RU headers
function jsonResponse(data: object, status = 200, ruStatus?: { remaining: number; consumed: number; resetAt?: number }): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...DATA_LOADER_CORS_HEADERS,
  };
  if (ruStatus) {
    if (ruStatus.consumed !== undefined) headers["X-Consumed-RU"] = String(ruStatus.consumed);
    if (ruStatus.remaining !== undefined) headers["X-Remaining-RU"] = String(ruStatus.remaining);
    // If rate limited, add Retry-After
    if (status === 429 && ruStatus.resetAt) {
        const retryAfter = Math.ceil((ruStatus.resetAt - Date.now()) / 1000);
        headers["Retry-After"] = String(Math.max(1, retryAfter));
    }
  }
  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

const app = new Hono<{ Bindings: Bindings }>();

// ...

/**
 * GET /data-loader/tables - List available tables
 * Returns list of distinct table names from archive index
 */
app.get("/tables", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");

  if (!apiKey || !clientId) {
    return jsonResponse({ error: "MISSING_HEADERS", message: "Authentication required" }, 401);
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid API key" }, 403);
    }

    // RU Check
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let ruStatus: { allowed: boolean; remaining: number; consumed: number; resetAt?: number } | undefined;
    if (kv) {
      ruStatus = await checkAndDeductRU(kv, apiKeyData.user_id, RU_COSTS.LIST);
      if (!ruStatus.allowed) {
        return jsonResponse({
          error: "RATE_LIMITED", 
          message: `RU limit exceeded. Reset in ${Math.ceil((ruStatus.resetAt! - Date.now())/1000)}s`
        }, 429, ruStatus);
      }
    }

    const trusted = await isDeviceTrusted(getSupabaseConfig(c), apiKeyData.user_id, clientId, env.runtime.DATA_LOADER_CACHE_KV);
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(getSupabaseConfig(c), apiKeyData.user_id, clientId, code);
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse({
        error: "DEVICE_UNVERIFIED",
        message: "New device detected. Verification code sent to your email.",
      }, 403, ruStatus);
    }
    const indexDb = env.runtime.BATTLE_INDEX_DB;
    if (!indexDb) {
      return jsonResponse({ error: "D1 database not configured" }, 500);
    }

    const stmt = indexDb.prepare(
      `SELECT DISTINCT table_name FROM block_indexes ORDER BY table_name`
    );
    const result = await stmt.all?.();
    const tables = (result?.results || []).map((r: any) => r.table_name);

    return jsonResponse({
      success: true,
      tables,
    }, 200, ruStatus);
  } catch (error) {
    console.error("Tables list error:", error);
    return jsonResponse({ error: "INTERNAL_ERROR", message: "An internal error occurred" }, 500);
  }
});

/**
 * GET /data-loader/period-tags - List available period tags
 * Returns list of distinct period tags
 */
app.get("/period-tags", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");

  if (!apiKey || !clientId) {
    return jsonResponse({ error: "MISSING_HEADERS", message: "Authentication required" }, 401);
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid API key" }, 403);
    }

    // RU Check
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let ruStatus: { allowed: boolean; remaining: number; consumed: number; resetAt?: number } | undefined;
    if (kv) {
      ruStatus = await checkAndDeductRU(kv, apiKeyData.user_id, RU_COSTS.LIST);
      if (!ruStatus.allowed) {
        return jsonResponse({
          error: "RATE_LIMITED", 
          message: `RU limit exceeded. Reset in ${Math.ceil((ruStatus.resetAt! - Date.now())/1000)}s`
        }, 429, ruStatus);
      }
    }

    const trusted = await isDeviceTrusted(getSupabaseConfig(c), apiKeyData.user_id, clientId, env.runtime.DATA_LOADER_CACHE_KV);
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(getSupabaseConfig(c), apiKeyData.user_id, clientId, code);
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse({
        error: "DEVICE_UNVERIFIED",
        message: "New device detected. Verification code sent to your email.",
      }, 403, ruStatus);
    }

    // Get period tags from Supabase
    const { url, key } = getSupabaseConfig(c);

    if (!url || !key) {
      return jsonResponse({ error: "Supabase configuration missing" }, 500);
    }

    const response = await fetch(
      `${url}/rest/v1/kc_period_tag?select=tag&order=tag.desc&limit=100`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch period tags");
    }

    const rows = (await response.json()) as Array<{ tag: string }>;
    
    // Convert ISO8601 to YYYY-MM-DD in Tokyo timezone (matching Rust/D1 format)
    const periodTags = rows.map((r) => {
      const parsed = new Date(r.tag);
      return parsed.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    });

    // Get latest period tag (already converted to YYYY-MM-DD)
    const latest = periodTags.length > 0 ? periodTags[0] : null;

    return jsonResponse({
        success: true,
        period_tags: periodTags,
        latest,
    }, 200, ruStatus);
  } catch (error) {
    console.error("Period tags list error:", error);
    return jsonResponse({ error: "INTERNAL_ERROR", message: "An internal error occurred" }, 500);
  }
});

/**
 * GET /data-loader/data/:table - Get data access for a table
 * Query params:
 *   - period_tag: specific period tag, "latest", or "all" (default: "latest")
 *   - limit: max number of files (default: 100)
 *   - scope: "own" (user's data only) or "all" (all users' data, default)
 */
app.get("/data/:table", async (c) => {
  const tableName = c.req.param("table");
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");
  const periodTagParam = c.req.query("period_tag") || "latest";
  const scopeParam = c.req.query("scope") || "all";
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 1000);

  if (!apiKey) {
    return jsonResponse({ error: "MISSING_API_KEY", message: "X-API-KEY header is required" }, 401);
  }

  if (!clientId) {
    return jsonResponse({ error: "MISSING_CLIENT_ID", message: "X-CLIENT-ID header is required" }, 400);
  }

  // Validate scope parameter
  if (scopeParam !== "own" && scopeParam !== "all") {
    return jsonResponse({ error: "INVALID_SCOPE", message: "scope must be 'own' or 'all'" }, 400);
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid or inactive API key" }, 403);
    }

    // Determine Base Cost
    let cost = RU_COSTS.LATEST;
    if (periodTagParam === "all" || periodTagParam !== "latest") {
      cost = RU_COSTS.ARCHIVE_BASE;
    }

    // Pre-check RU (Base cost)
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let ruStatus: { allowed: boolean; remaining: number; consumed: number; resetAt?: number } | undefined;
    if (kv) {
      ruStatus = await checkAndDeductRU(kv, apiKeyData.user_id, cost);
      if (!ruStatus.allowed) {
        return jsonResponse({
          error: "RATE_LIMITED",
          message: `RU limit exceeded. Cost: ${cost}. Remaining: ${ruStatus.remaining}.`
        }, 429, ruStatus);
      }
    }

    const trusted = await isDeviceTrusted(getSupabaseConfig(c), apiKeyData.user_id, clientId, env.runtime.DATA_LOADER_CACHE_KV);
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(getSupabaseConfig(c), apiKeyData.user_id, clientId, code);
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse({
        error: "DEVICE_UNVERIFIED",
        message: "New device detected. A verification code has been sent to your email.",
      }, 403, ruStatus);
    }

    const indexDb = env.runtime.BATTLE_INDEX_DB;
    if (!indexDb) {
      return jsonResponse({ error: "D1 database not configured" }, 500);
    }

    // Resolve period tag
    let periodTag: string | null = null;
    if (periodTagParam === "latest") {
      periodTag = await getLatestPeriodTag(getSupabaseConfig(c), env.runtime.DATA_LOADER_CACHE_KV);
    } else if (periodTagParam !== "all") {
      periodTag = periodTagParam;
    }

    // For scope=own, get user's dataset_id (member_id_hash) from Supabase
    let userDatasetId: string | null = null;
    if (scopeParam === "own") {
      const memberResult = await supabaseRequest<{ member_id_hash: string }[]>(
        getSupabaseConfig(c),
        "app_user_members",
        { query: `?select=member_id_hash&user_id=eq.${apiKeyData.user_id}&limit=1` }
      );
      if (memberResult && memberResult.length > 0 && memberResult[0].member_id_hash) {
        userDatasetId = memberResult[0].member_id_hash;
      } else {
        return jsonResponse({
          error: "NO_LINKED_MEMBER",
          message: "No member account linked. Please link your game account first.",
        }, 400, ruStatus);
      }
    }

    const includeBuffer = c.req.query("include_buffer") === "true";
    
    // Query D1 for archived files
    let sql = `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name,
         bi.length AS size,
         bi.record_count,
         bi.start_timestamp,
         bi.end_timestamp,
         bi.period_tag,
         bi.start_byte,
         af.file_path
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.table_name = ?`;
    const params: unknown[] = [tableName];

    // Filter by dataset_id for scope=own
    if (scopeParam === "own" && userDatasetId) {
      sql += ` AND bi.dataset_id = ?`;
      params.push(userDatasetId);
    }

    if (periodTag && periodTagParam !== "all") {
        sql += ` AND bi.period_tag = ?`;
        params.push(periodTag);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ?`;
    params.push(limit);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();

    if ((!result || !result.results || result.results.length === 0) && !includeBuffer) {
      return jsonResponse({
        error: "DATASET_NOT_FOUND",
        message: `No data found for table '${tableName}'${scopeParam === "own" ? " (your uploads only)" : ""}`,
      }, 404, ruStatus);
    }

    const archivedFiles = (result?.results as any[] || []).map((r) => ({
      id: r.id,
      file_path: r.file_path,
      period_tag: r.period_tag,
      size: r.size,
      record_count: r.record_count,
      start_timestamp: r.start_timestamp,
      end_timestamp: r.end_timestamp,
      // Always use block_id for download, as files may contain multiple merged datasets
      // Range Read extracts Header + specific data block for a valid single-dataset Avro
      download_url: `/api/data-loader/download?block_id=${r.id}`,
      type: "archive"
    }));

    // Fetch buffer data if requested
    let bufferFiles: any[] = [];
    if (includeBuffer) {
      try {
        let bufferSql = `SELECT id, dataset_id, period_tag, timestamp, length(data) as size FROM buffer_logs WHERE table_name = ?`;
        const bufferParams: unknown[] = [tableName];

        if (scopeParam === "own" && userDatasetId) {
            bufferSql += ` AND dataset_id = ?`;
            bufferParams.push(userDatasetId);
        }

        if (periodTag && periodTagParam !== "all") {
            bufferSql += ` AND period_tag = ?`;
            bufferParams.push(periodTag);
        }
        
        bufferSql += ` ORDER BY timestamp DESC LIMIT ?`;
        bufferParams.push(limit); // Limit per type, or share limit? Let's use same limit for safety

        const bufferResult = await indexDb.prepare(bufferSql).bind(...bufferParams).all();
        if (bufferResult && bufferResult.results) {
           bufferFiles = (bufferResult.results as any[]).map((r) => ({
             id: r.id,
             file_path: `buffer://${r.id}`, // Virtual path
             period_tag: r.period_tag,
             size: r.size,
             record_count: null, // Buffer logs might not store record count easily visible
             start_timestamp: r.timestamp,
             end_timestamp: r.timestamp,
             download_url: `/api/data-loader/download?buffer_id=${r.id}`,
             type: "buffer"
           }));
        }
      } catch (e) {
        console.warn("Failed to fetch buffer_logs:", e);
      }
    }

    const files = [...bufferFiles, ...archivedFiles];
    
    if (files.length === 0) {
       return jsonResponse({
        error: "DATASET_NOT_FOUND",
        message: `No data found for table '${tableName}'${scopeParam === "own" ? " (your uploads only)" : ""}`,
      }, 404, ruStatus);
    }

    return jsonResponse({
        success: true,
        table: tableName,
        period_tag: periodTag || "all",
        scope: scopeParam,
        count: files.length,
        files,
    }, 200, ruStatus);
  } catch (error) {
    console.error("Data loader error:", error);
    return jsonResponse({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred",
    }, 500);
  }
});

/**
 * GET /data-loader/usage - Get current usage status
 */
app.get("/usage", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  
  if (!apiKey) {
    return jsonResponse({ error: "MISSING_API_KEY", message: "X-API-KEY header is required" }, 401);
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid or inactive API key" }, 403);
    }

    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let usage = {
      remaining: 1000, // Default Default Max
      consumed: 0,
      reset_at: null as number | null,
    };

    if (kv) {
        // Reuse checkAndDeductRU with 0 cost to get status
        // But checkAndDeductRU modifies KV if refilled? Yes.
        // We can just peek?
        // Or just call checkAndDeductRU(..., 0).
        const result = await checkAndDeductRU(kv, apiKeyData.user_id, 0);
        usage.remaining = result.remaining;
        usage.consumed = 0; // Usage endpoint itself is free? Or cost 0.
        // If we want "Total Consumed Today", we need a separate counter.
        // The bucket only tracks "Remaining Capacity".
        // Use "remaining" as primary metric.
    }

    return jsonResponse({
      success: true,
      usage,
    });
  } catch (error) {
    console.error("Usage check error:", error);
    return jsonResponse({ error: "INTERNAL_ERROR", message: "An internal error occurred" }, 500);
  }
});

/**
 * GET /data-loader/download - Download file from R2
 * Query params:
 *   - file: Full file path (for scope=all, downloads entire file)
 *   - block_id: Block index ID (for scope=own, downloads Header + specific data block)
 */
app.get("/download", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");
  const filePath = c.req.query("file");
  const blockIdParam = c.req.query("block_id");
  const bufferIdParam = c.req.query("buffer_id");
  
  if (!apiKey || !clientId) {
    return jsonResponse({ error: "MISSING_HEADERS", message: "Authentication required" }, 401);
  }
  
  if (!filePath && !blockIdParam && !bufferIdParam) {
    return jsonResponse({ error: "MISSING_PARAMS", message: "One of file, block_id, or buffer_id parameter is required" }, 400);
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid or inactive API key" }, 403);
    }
    
    // RU Check: Download is FREE (0 RU)
    // We still check just to ensure they aren't "banned" (remaining > -100 etc)
    // but effectively it's free.
    
    const trusted = await isDeviceTrusted(getSupabaseConfig(c), apiKeyData.user_id, clientId, env.runtime.DATA_LOADER_CACHE_KV);
    if (!trusted) {
        // For download, if unreachable, just error? Or 403.
        return jsonResponse({ error: "DEVICE_UNVERIFIED", message: "Device not verified" }, 403);
    }

    const bucket = env.runtime.BATTLE_DATA_BUCKET;
    const indexDb = env.runtime.BATTLE_INDEX_DB;
    if (!bucket || !indexDb) {
      return jsonResponse({ error: "Configuration Error", message: "R2 bucket or D1 database not configured" }, 500);
    }

    // Buffer download (from buffer_logs)
    if (bufferIdParam) {
      const bufferId = parseInt(bufferIdParam, 10);
      if (isNaN(bufferId)) {
        return jsonResponse({ error: "INVALID_BUFFER_ID", message: "buffer_id must be a number" }, 400);
      }

      const bufferRecord = await indexDb.prepare(
        `SELECT data, period_tag FROM buffer_logs WHERE id = ? LIMIT 1`
      ).bind(bufferId).first() as { data: unknown, period_tag: string } | null;

      if (!bufferRecord || !bufferRecord.data) {
        return jsonResponse({ error: "BUFFER_NOT_FOUND", message: "Buffer log not found or empty" }, 404);
      }
      
      // D1 BLOBs are returned as ArrayBuffer (or number[] in some cases, verify cast)
      const data = bufferRecord.data instanceof ArrayBuffer 
          ? bufferRecord.data 
          : new Uint8Array(bufferRecord.data as number[]).buffer;

      return new Response(data, {
        headers: {
          "Content-Type": "application/avro",
          "Content-Length": String(data.byteLength),
          "Content-Disposition": `attachment; filename="buffer-${bufferId}.avro"`,
        },
      });
    }

    // Block-based download (for scope=own)
    if (blockIdParam) {
      const blockId = parseInt(blockIdParam, 10);
      if (isNaN(blockId)) {
        return jsonResponse({ error: "INVALID_BLOCK_ID", message: "block_id must be a number" }, 400);
      }

      // Get block info from D1
      const blockInfo = await indexDb.prepare(`
        SELECT bi.id, bi.start_byte, bi.length, bi.dataset_id, af.file_path
        FROM block_indexes bi
        JOIN archived_files af ON af.id = bi.file_id
        WHERE bi.id = ?
      `).bind(blockId).first() as {
        id: number;
        start_byte: number;
        length: number;
        dataset_id: string;
        file_path: string;
      } | null;

      if (!blockInfo) {
        return jsonResponse({ error: "BLOCK_NOT_FOUND", message: "Block not found" }, 404);
      }

      // Note: No ownership check - all uploaded data is public (shared dataset)
      // Security is ensured by: valid API key + verified device + block exists in registry

      // Fetch Header (0 to start_byte-1) and Data block (start_byte to start_byte+length-1)
      // We need to make two Range requests and concatenate them
      const headerEnd = blockInfo.start_byte - 1;
      const dataStart = blockInfo.start_byte;
      const dataEnd = blockInfo.start_byte + blockInfo.length - 1;

      // Fetch header
      const headerObject = await bucket.get(blockInfo.file_path, {
        range: { offset: 0, length: blockInfo.start_byte }
      });

      if (!headerObject?.body) {
        return jsonResponse({ error: "FILE_NOT_FOUND", message: "File not found in storage" }, 404);
      }

      // Fetch data block
      const dataObject = await bucket.get(blockInfo.file_path, {
        range: { offset: blockInfo.start_byte, length: blockInfo.length }
      });

      if (!dataObject?.body) {
        return jsonResponse({ error: "DATA_NOT_FOUND", message: "Data block not found" }, 404);
      }

      // Read both streams and concatenate
      const headerBytes = await headerObject.arrayBuffer();
      const dataBytes = await dataObject.arrayBuffer();
      
      const combined = new Uint8Array(headerBytes.byteLength + dataBytes.byteLength);
      combined.set(new Uint8Array(headerBytes), 0);
      combined.set(new Uint8Array(dataBytes), headerBytes.byteLength);

      const fileName = blockInfo.file_path.split('/').pop() || 'data.avro';
      return new Response(combined, {
        headers: {
          "Content-Type": "application/avro",
          "Content-Length": String(combined.byteLength),
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    // File-based download (for scope=all)
    // Security Check: Validate file exists in our registry (D1)
    // This prevents IDOR where user requests random key from bucket
    const fileRecord = await indexDb.prepare(
      "SELECT 1 FROM archived_files WHERE file_path = ? LIMIT 1"
    ).bind(filePath).first();

    if (!fileRecord) {
        console.warn(`[Security] IDOR attempt or Invalid File? User=${apiKeyData.user_id} File=${filePath}`);
        return jsonResponse({ error: "FORBIDDEN", message: "Access to this file is not authorized" }, 403);
    }

    // Generate Signed URL?
    // Cloudflare Workers R2 binding doesn't support 'getSignedUrl' easily without aws4fetch.
    // However, if the bucket is PRIVATE, we must Proxy or use Presigned.
    // Since we don't have aws4fetch installed in this file's context easily...
    // We will Proxy the body for now, but NOT charge RU.
    // Proxying consumes Worker CPU time but for small files it's ok.
    // If files are large, this might hit CPU limits.
    // Given the constraints and libraries available:
    // We will stream the object.
    
    const object = await bucket.get(filePath!);

    if (!object) {
      return jsonResponse({ error: "FILE_NOT_FOUND", message: "File not found in storage" }, 404);
    }
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Content-Disposition", `attachment; filename="${filePath!.split('/').pop()}"`);
    
    return new Response(object.body, {
      headers,
    });
    
  } catch (error) {
    console.error("Download error:", error);
    return jsonResponse({ error: "INTERNAL_ERROR", message: "An internal error occurred" }, 500);
  }
});

const VERIFICATION_CODE_EXPIRY_MINUTES = 10;
const LAST_USED_UPDATE_BATCH_HOURS = 1; // Only update last_used_at if older than this



// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Generate a 6-digit random verification code
 * using a cryptographically secure random number generator.
 */
function generateVerificationCode(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const code = (array[0] % 900000) + 100000;
  return String(code);
}

/**
 * Check and enforce rate limiting for verification attempts
 * Returns true if rate limit is exceeded, false otherwise
 */
async function checkRateLimit(
  kv: KVNamespace,
  key: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<boolean> {
  const rateLimitKey = `ratelimit:${key}`;
  const now = Date.now();
  
  const data = await kv.get(rateLimitKey);
  let attempts: number[] = data ? JSON.parse(data) : [];
  
  // Remove attempts outside the time window
  attempts = attempts.filter(timestamp => now - timestamp < windowSeconds * 1000);
  
  // Check if limit exceeded
  if (attempts.length >= maxAttempts) {
    return true;
  }
  
  // Add current attempt
  attempts.push(now);
  await kv.put(rateLimitKey, JSON.stringify(attempts), {
    expirationTtl: windowSeconds,
  });
  
  return false;
}



// =============================================================================
// Supabase Client Functions
/**
 * Supabase configuration type
 */
type SupabaseConfig = {
  url: string;
  key: string;
};

/**
 * Get Supabase config from Hono context using project conventions
 */
function getSupabaseConfig(c: { env: Bindings }): SupabaseConfig {
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
  return { url: url || "", key: serviceRoleKey || "" };
}

/**
 * Make a request to Supabase REST API
 */
async function supabaseRequest<T = unknown[]>(
  config: SupabaseConfig,
  table: string,
  options: {
    method?: string;
    query?: string;
    body?: object | null;
    headers?: Record<string, string>;
  } = {}
): Promise<T | null> {
  const { method = "GET", query = "", body = null, headers = {} } = options;
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase configuration missing");
  }

  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${response.status} - ${error}`);
  }

  if (method === "GET" || headers.Prefer?.includes("return=representation")) {
    return response.json() as Promise<T>;
  }

  return null;
}

/**
 * Validate API key and return user info
 */
async function validateApiKey(
  config: SupabaseConfig,
  apiKey: string
): Promise<{ id: string; user_id: string; email: string } | null> {
  const results = await supabaseRequest<{ id: string; user_id: string; email: string }[]>(config, "api_keys", {
    query: `?key=eq.${encodeURIComponent(apiKey)}&is_active=eq.true&select=id,user_id,email`,
  });

  return results && results.length > 0 ? results[0] : null;
}

/**
 * Check if device is trusted for user
 * Updates last_used_at with batching (only if older than 1 hour)
 */
async function isDeviceTrusted(
  config: SupabaseConfig,
  userId: string,
  clientId: string,
  kv?: KVNamespace
): Promise<boolean> {
  const results = await supabaseRequest<{ id: string; last_used_at: string }[]>(config, "trusted_devices", {
    query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}&select=id,last_used_at`,
  });

  if (results && results.length > 0) {
    const device = results[0];
    const now = new Date();
    const lastUsed = new Date(device.last_used_at);
    const hoursSinceLastUpdate = (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60);
    
    // Only update if last_used_at is older than configured hours to reduce write amplification
    if (hoursSinceLastUpdate >= LAST_USED_UPDATE_BATCH_HOURS) {
      // Use KV to track pending updates to avoid race conditions
      const kvKey = `last_used_pending:${userId}:${clientId}`;
      let shouldUpdate = true;
      
      if (kv) {
        const pending = await kv.get(kvKey);
        if (pending) {
          shouldUpdate = false; // Update already pending
        } else {
          await kv.put(kvKey, now.toISOString(), { 
            expirationTtl: LAST_USED_UPDATE_BATCH_HOURS * 3600 
          });
        }
      }
      
      if (shouldUpdate) {
        await supabaseRequest(config, "trusted_devices", {
          method: "PATCH",
          query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}`,
          body: { last_used_at: now.toISOString() },
        });
      }
    }
    return true;
  }

  return false;
}

/**
 * Save verification code to database
 */
async function saveVerificationCode(
  config: SupabaseConfig,
  userId: string,
  clientId: string,
  code: string
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000
  );

  await supabaseRequest(config, "verification_codes", {
    method: "DELETE",
    query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}`,
  });

  await supabaseRequest(config, "verification_codes", {
    method: "POST",
    body: {
      user_id: userId,
      client_id: clientId,
      code: code,
      expires_at: expiresAt.toISOString(),
    },
    headers: { Prefer: "return=representation" },
  });
}

/**
 * Verify code and register device
 */
async function verifyCodeAndRegisterDevice(
  config: SupabaseConfig,
  userId: string,
  clientId: string,
  code: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const results = await supabaseRequest<{ id: string }[]>(config, "verification_codes", {
    query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}&code=eq.${code}&is_used=eq.false&expires_at=gt.${now}&select=id`,
  });

  if (!results || results.length === 0) {
    return false;
  }

  await supabaseRequest(config, "verification_codes", {
    method: "PATCH",
    query: `?id=eq.${results[0].id}`,
    body: { is_used: true },
  });

  await supabaseRequest(config, "trusted_devices", {
    method: "POST",
    body: {
      user_id: userId,
      client_id: clientId,
    },
    headers: { Prefer: "return=representation" },
  });

  return true;
}

/**
 * Send verification code via Resend email
 */
async function sendVerificationEmail(
  envCtx: EnvContext,
  email: string,
  code: string
): Promise<void> {
  const resendApiKey = getEnv(envCtx, "RESEND_API_KEY");

  if (!resendApiKey) {
    throw new Error("Resend API key not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FUSOU Data Loader <noreply@fusou.dev>",
      to: [email],
      subject: "[FUSOU] Device Verification Code / デバイス認証コード",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Device Verification / デバイス認証</h2>
          <p><strong>English:</strong> A new device is attempting to access your FUSOU Data account.</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>This code will expire in ${VERIFICATION_CODE_EXPIRY_MINUTES} minutes.</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
          <p><strong>日本語:</strong> 新しいデバイスからFUSOU Dataアカウントへのアクセスがありました。</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0;">
            ${code}
          </div>
          <p>このコードは${VERIFICATION_CODE_EXPIRY_MINUTES}分で有効期限が切れます。</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    console.error("Resend API error:", await response.text());
    throw new Error("Failed to send verification email");
  }
}

/**
 * Get latest period tag from Supabase with optional KV caching
 * Cache TTL: 5 minutes
 */
const PERIOD_TAG_CACHE_KEY = "data_loader:latest_period_tag";
const PERIOD_TAG_CACHE_TTL = 300; // 5 minutes

async function getLatestPeriodTag(
  config: SupabaseConfig,
  cacheKV?: KVNamespace
): Promise<string | null> {
  // Try cache first (cache stores already-converted YYYY-MM-DD format)
  if (cacheKV) {
    try {
      const cached = await cacheKV.get(PERIOD_TAG_CACHE_KEY);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.warn("[data_loader] KV cache read failed:", e);
    }
  }

  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase configuration missing");
  }

  const nowIso = new Date(Date.now() - 5000).toISOString();
  const queryUrl = `${url}/rest/v1/kc_period_tag?select=tag&tag=lte.${nowIso}&order=tag.desc.nullslast&limit=1`;

  const response = await fetch(queryUrl, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch period tag");
  }

  const rows = (await response.json()) as Array<{ tag: string | null }>;
  const rawTag = Array.isArray(rows) && rows.length > 0 ? rows[0].tag ?? null : null;

  if (!rawTag) {
    return null;
  }

  // Convert ISO8601 to YYYY-MM-DD in Tokyo timezone (matching Rust behavior)
  // Rust: parsed_tag.with_timezone(&chrono_tz::Asia::Tokyo).date_naive().to_string()
  const parsedDate = new Date(rawTag);
  const tokyoDate = parsedDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "sv-SE" locale gives YYYY-MM-DD format

  // Store in cache (store converted format)
  if (cacheKV && tokyoDate) {
    try {
      await cacheKV.put(PERIOD_TAG_CACHE_KEY, tokyoDate, {
        expirationTtl: PERIOD_TAG_CACHE_TTL,
      });
    } catch (e) {
      console.warn("[data_loader] KV cache write failed:", e);
    }
  }

  return tokyoDate;
}



/**
 * POST /data-loader/verify - Verify OTP and register device
 */
app.post("/verify", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");

  if (!apiKey || !clientId) {
    return jsonResponse({
      error: "MISSING_HEADERS",
      message: "X-API-KEY and X-CLIENT-ID headers are required",
    }, 400);
  }

  // Rate limiting: 5 attempts per client per 5 minutes
  const env = createEnvContext(c);
  const kv = env.runtime.DATA_LOADER_CACHE_KV;
  if (kv) {
    const isRateLimited = await checkRateLimit(kv, `verify:${clientId}`, 5, 300);
    if (isRateLimited) {
      return jsonResponse({
        error: "RATE_LIMITED",
        message: "Too many verification attempts. Please try again later.",
      }, 429);
    }
  }

  let body: { code?: string };
  try {
    body = await c.req.json();
  } catch {
    return jsonResponse({ error: "INVALID_BODY", message: "Invalid JSON body" }, 400);
  }

  const { code } = body;
  if (!code) {
    return jsonResponse({ error: "MISSING_CODE", message: "Verification code is required" }, 400);
  }

  try {
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid or inactive API key" }, 403);
    }

    const success = await verifyCodeAndRegisterDevice(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      code
    );

    if (!success) {
      return jsonResponse({
        error: "INVALID_CODE",
        message: "Invalid or expired verification code",
      }, 400);
    }

    return jsonResponse({
      success: true,
      message: "Device verified and registered successfully",
    });
  } catch (error) {
    console.error("Verification error:", error);
    return jsonResponse({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred",
    }, 500);
  }
});

/**
 * POST /data-loader/verify-google - Verify via Google account (for Colab)
 * If the Google account email matches the API key's email, auto-verify the device
 */
app.post("/verify-google", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");

  if (!apiKey || !clientId) {
    return jsonResponse({
      error: "MISSING_HEADERS",
      message: "X-API-KEY and X-CLIENT-ID headers are required",
    }, 400);
  }

  // Rate limiting: 5 attempts per client per 5 minutes
  const env = createEnvContext(c);
  const kv = env.runtime.DATA_LOADER_CACHE_KV;
  if (kv) {
    const isRateLimited = await checkRateLimit(kv, `verify-google:${clientId}`, 5, 300);
    if (isRateLimited) {
      return jsonResponse({
        error: "RATE_LIMITED",
        message: "Too many verification attempts. Please try again later.",
      }, 429);
    }
  }

  let body: { email?: string; google_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return jsonResponse({ error: "INVALID_BODY", message: "Invalid JSON body" }, 400);
  }

  const { email, google_token } = body;
  
  if (!email && !google_token) {
    return jsonResponse({ 
      error: "MISSING_CREDENTIALS", 
      message: "Email or Google token is required" 
    }, 400);
  }

  try {
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse({ error: "INVALID_API_KEY", message: "Invalid or inactive API key" }, 403);
    }

    // If google_token is provided, verify it and get email
    let verifiedEmail = email;
    if (google_token) {
      try {
        // Use POST to avoid token appearing in Google's server logs
        const tokenInfoResp = await fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `access_token=${encodeURIComponent(google_token)}`
          }
        );
        if (tokenInfoResp.ok) {
          const tokenInfo = await tokenInfoResp.json() as { email?: string };
          verifiedEmail = tokenInfo.email || email;
        } else {
             throw new Error(`Google token validation failed: ${tokenInfoResp.status}`);
        }
      } catch (e) {
        console.error("Failed to verify Google token:", e);
        return jsonResponse({ 
          error: "INVALID_TOKEN", 
          message: "Failed to verify Google account token" 
        }, 401);
      }
    }

    // Check if email matches
    if (!verifiedEmail) {
      return jsonResponse({ 
        error: "EMAIL_REQUIRED", 
        message: "Could not determine email from Google account" 
      }, 400);
    }

    // Normalize email comparison (case-insensitive)
    if (verifiedEmail.toLowerCase() !== apiKeyData.email.toLowerCase()) {
      return jsonResponse({
        error: "EMAIL_MISMATCH",
        message: "Google account email does not match API key email",
      }, 403);
    }

    // Email matches - register device as trusted
    const alreadyTrusted = await isDeviceTrusted(getSupabaseConfig(c), apiKeyData.user_id, clientId, env.runtime.DATA_LOADER_CACHE_KV);
    if (!alreadyTrusted) {
      await supabaseRequest(getSupabaseConfig(c), "trusted_devices", {
        method: "POST",
        body: {
          user_id: apiKeyData.user_id,
          client_id: clientId,
          device_name: "Google Colab",
        },
        headers: { Prefer: "return=representation" },
      });
    }

    return jsonResponse({
      success: true,
      message: "Device verified via Google account",
    });
  } catch (error) {
    console.error("Google verification error:", error);
    return jsonResponse({
      error: "INTERNAL_ERROR",
      message: "An internal error occurred",
    }, 500);
  }
});
/**
 * GET /data-loader/health - Health check
 */
app.get("/health", () => {
  return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
