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

import {
  createEnvContext,
  resolveSupabaseConfig,
  getEnv,
  type EnvContext,
} from "../utils";

// CORS headers for Python client access
const DATA_LOADER_CORS_HEADERS = {
  ...CORS_HEADERS,
  "Access-Control-Allow-Headers": "Content-Type, X-API-KEY, X-CLIENT-ID",
};

// Helper to add RU headers
function jsonResponse(
  data: object,
  status = 200,
  ruStatus?: { remaining: number; consumed: number; resetAt?: number },
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...DATA_LOADER_CORS_HEADERS,
  };
  if (ruStatus) {
    if (ruStatus.consumed !== undefined)
      headers["X-Consumed-RU"] = String(ruStatus.consumed);
    if (ruStatus.remaining !== undefined)
      headers["X-Remaining-RU"] = String(ruStatus.remaining);
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
    return jsonResponse(
      { error: "MISSING_HEADERS", message: "Authentication required" },
      401,
    );
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid API key" },
        403,
      );
    }

    // RU Check
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let ruStatus:
      | {
          allowed: boolean;
          remaining: number;
          consumed: number;
          resetAt?: number;
        }
      | undefined;
    if (kv) {
      ruStatus = await checkAndDeductRU(kv, apiKeyData.user_id, RU_COSTS.LIST);
      if (!ruStatus.allowed) {
        return jsonResponse(
          {
            error: "RATE_LIMITED",
            message: `RU limit exceeded. Reset in ${Math.ceil((ruStatus.resetAt! - Date.now()) / 1000)}s`,
          },
          429,
          ruStatus,
        );
      }
    }

    const trusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      env.runtime.DATA_LOADER_CACHE_KV,
    );
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(
        getSupabaseConfig(c),
        apiKeyData.user_id,
        clientId,
        code,
      );
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse(
        {
          error: "DEVICE_UNVERIFIED",
          message: "New device detected. Verification code sent to your email.",
        },
        403,
        ruStatus,
      );
    }
    const indexDb = env.runtime.BATTLE_INDEX_DB;
    const masterDb = env.runtime.MASTER_DATA_INDEX_DB;
    if (!indexDb) {
      return jsonResponse({ error: "D1 database not configured" }, 500);
    }

    const stmt = indexDb.prepare(
      `SELECT DISTINCT table_name FROM block_indexes ORDER BY table_name`,
    );
    const result = await stmt.all?.();
    const battleTables = (result?.results || []).map((r: any) => r.table_name);

    // Add master-data tables if available
    const masterTables: string[] = [];
    if (masterDb) {
      const masterStmt = masterDb.prepare(
        `SELECT DISTINCT mdt.table_name 
         FROM master_data_tables mdt
         JOIN master_data_index mdi ON mdt.master_data_id = mdi.id
         WHERE mdi.upload_status = 'completed'
         ORDER BY mdt.table_name`,
      );
      const masterResult = await masterStmt.all?.();
      if (masterResult?.results) {
        masterTables.push(
          ...(masterResult.results as any[]).map((r: any) => r.table_name),
        );
      }
    }

    const tables = [...battleTables, ...masterTables];

    return jsonResponse(
      {
        success: true,
        tables,
      },
      200,
      ruStatus,
    );
  } catch (error) {
    console.error("Tables list error:", error);
    return jsonResponse(
      { error: "INTERNAL_ERROR", message: "An internal error occurred" },
      500,
    );
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
    return jsonResponse(
      { error: "MISSING_HEADERS", message: "Authentication required" },
      401,
    );
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid API key" },
        403,
      );
    }

    // RU Check - fail-closed if KV unavailable
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    if (!kv) {
      return jsonResponse(
        {
          error: "SERVICE_UNAVAILABLE",
          message:
            "Rate limiting system is unavailable. Please try again later.",
        },
        503,
      );
    }
    const ruStatus = await checkAndDeductRU(
      kv,
      apiKeyData.user_id,
      RU_COSTS.LIST,
    );
    if (!ruStatus.allowed) {
      return jsonResponse(
        {
          error: "RATE_LIMITED",
          message: `RU limit exceeded. Reset in ${Math.ceil((ruStatus.resetAt! - Date.now()) / 1000)}s`,
        },
        429,
        ruStatus,
      );
    }

    const trusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      kv,
    );
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(
        getSupabaseConfig(c),
        apiKeyData.user_id,
        clientId,
        code,
      );
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse(
        {
          error: "DEVICE_UNVERIFIED",
          message: "New device detected. Verification code sent to your email.",
        },
        403,
        ruStatus,
      );
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
      },
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

    return jsonResponse(
      {
        success: true,
        period_tags: periodTags,
        latest,
      },
      200,
      ruStatus,
    );
  } catch (error) {
    console.error("Period tags list error:", error);
    return jsonResponse(
      { error: "INTERNAL_ERROR", message: "An internal error occurred" },
      500,
    );
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
  const tableVersionParam = c.req.query("table_version") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "100", 10), 1000);

  if (!apiKey) {
    return jsonResponse(
      { error: "MISSING_API_KEY", message: "X-API-KEY header is required" },
      401,
    );
  }

  if (!clientId) {
    return jsonResponse(
      { error: "MISSING_CLIENT_ID", message: "X-CLIENT-ID header is required" },
      400,
    );
  }

  // Validate scope parameter
  if (scopeParam !== "own" && scopeParam !== "all") {
    return jsonResponse(
      { error: "INVALID_SCOPE", message: "scope must be 'own' or 'all'" },
      400,
    );
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid or inactive API key" },
        403,
      );
    }

    // Pre-check RU (Base cost)
    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    let ruStatus:
      | {
          allowed: boolean;
          remaining: number;
          consumed: number;
          resetAt?: number;
        }
      | undefined;
    if (!kv) {
      // Fail-closed: if KV is unavailable, reject the request
      return jsonResponse(
        {
          error: "SERVICE_UNAVAILABLE",
          message:
            "Rate limiting system is unavailable. Please try again later.",
        },
        503,
      );
    }
    const cost = RU_COSTS.LIST;
    ruStatus = await checkAndDeductRU(kv, apiKeyData.user_id, cost);
    if (!ruStatus.allowed) {
      return jsonResponse(
        {
          error: "RATE_LIMITED",
          message: `RU limit exceeded. Cost: ${cost}. Remaining: ${ruStatus.remaining}.`,
        },
        429,
        ruStatus,
      );
    }

    const trusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      env.runtime.DATA_LOADER_CACHE_KV,
    );
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(
        getSupabaseConfig(c),
        apiKeyData.user_id,
        clientId,
        code,
      );
      await sendVerificationEmail(env, apiKeyData.email, code);
      return jsonResponse(
        {
          error: "DEVICE_UNVERIFIED",
          message:
            "New device detected. A verification code has been sent to your email.",
        },
        403,
        ruStatus,
      );
    }

    const indexDb = env.runtime.BATTLE_INDEX_DB;
    const masterDb = env.runtime.MASTER_DATA_INDEX_DB;
    const bucket = env.runtime.MASTER_DATA_BUCKET;
    if (!indexDb) {
      return jsonResponse({ error: "D1 database not configured" }, 500);
    }

    // Detect if this is a master-data table (starts with "mst_")
    const isMasterTable = tableName.startsWith("mst_");

    // Handle master-data tables differently
    if (isMasterTable) {
      if (!masterDb || !bucket) {
        return jsonResponse(
          {
            error: "MASTER_DATA_UNAVAILABLE",
            message: "Master data endpoints are not configured",
          },
          503,
          ruStatus,
        );
      }

      // For master-data, ignore scope parameter (always "all")
      let periodTag: string | null = null;
      if (periodTagParam === "latest") {
        // Get latest period_tag from master_data_index
        const latestStmt = masterDb.prepare(
          `SELECT mdi.period_tag FROM master_data_tables mdt
           JOIN master_data_index mdi ON mdt.master_data_id = mdi.id
           WHERE mdt.table_name = ? AND mdi.upload_status = 'completed'
            ORDER BY mdi.completed_at DESC, mdi.period_revision DESC LIMIT 1`,
        );
        const latestResult = await latestStmt.bind(tableName).first();
        const latestPeriodTag = (latestResult as { period_tag?: string } | null)
          ?.period_tag;
        if (latestPeriodTag) {
          periodTag = latestPeriodTag;
        } else {
          return jsonResponse(
            {
              error: "DATASET_NOT_FOUND",
              message: `No master data found for table '${tableName}'`,
            },
            404,
            ruStatus,
          );
        }
      } else if (periodTagParam !== "all") {
        periodTag = periodTagParam;
      }

      // Query master_data tables via join
      let masterSql = `SELECT 
           mdt.id AS id,
           mdi.period_tag AS period_tag,
           mdi.table_version AS table_version,
         mdi.period_revision AS period_revision,
           mdt.table_name AS table_name,
           mdt.r2_key AS r2_key,
         mdi.completed_at AS completed_at
         FROM master_data_tables mdt
         JOIN master_data_index mdi ON mdt.master_data_id = mdi.id
         WHERE mdt.table_name = ? AND mdi.upload_status = 'completed'`;
      const masterParams: unknown[] = [tableName];

      if (periodTag && periodTagParam !== "all") {
        masterSql += ` AND mdi.period_tag = ?`;
        masterParams.push(periodTag);
      }

      if (tableVersionParam) {
        masterSql += ` AND mdi.table_version = ?`;
        masterParams.push(tableVersionParam);
      }

      masterSql += ` ORDER BY completed_at DESC, period_revision DESC LIMIT ?`;
      masterParams.push(limit);

      const masterStmt = masterDb.prepare(masterSql);
      const masterResult = await masterStmt.bind(...masterParams).all?.();

      if (
        !masterResult ||
        !masterResult.results ||
        masterResult.results.length === 0
      ) {
        return jsonResponse(
          {
            error: "DATASET_NOT_FOUND",
            message: `No master data found for table '${tableName}'`,
          },
          404,
          ruStatus,
        );
      }

      const files = (masterResult.results as any[]).map((r) => ({
        id: r.id,
        period_tag: r.period_tag,
        table_version: r.table_version,
        period_revision: r.period_revision,
        table_name: r.table_name,
        r2_key: r.r2_key,
        completed_at: r.completed_at,
        download_url: `/api/data-loader/download-master?period_tag=${encodeURIComponent(r.period_tag)}&table_name=${encodeURIComponent(r.table_name)}${r.table_version ? `&table_version=${encodeURIComponent(r.table_version)}` : ""}${r.period_revision ? `&period_revision=${encodeURIComponent(String(r.period_revision))}` : ""}`,
        type: "master",
      }));

      return jsonResponse(
        {
          success: true,
          table: tableName,
          period_tag: periodTag || "all",
          scope: "all",
          count: files.length,
          files,
        },
        200,
        ruStatus,
      );
    }

    // Original battle-data logic below
    // Resolve period tag
    let periodTag: string | null = null;
    if (periodTagParam === "latest") {
      periodTag = await getLatestPeriodTag(
        getSupabaseConfig(c),
        env.runtime.DATA_LOADER_CACHE_KV,
      );
    } else if (periodTagParam !== "all") {
      periodTag = periodTagParam;
    }

    // For scope=own, get user's dataset_id (member_id_hash) from Supabase
    let userDatasetId: string | null = null;
    if (scopeParam === "own") {
      const memberResult = await supabaseRequest<{ member_id_hash: string }[]>(
        getSupabaseConfig(c),
        "app_user_members",
        {
          query: `?select=member_id_hash&user_id=eq.${apiKeyData.user_id}&limit=1`,
        },
      );
      if (
        memberResult &&
        memberResult.length > 0 &&
        memberResult[0].member_id_hash
      ) {
        userDatasetId = memberResult[0].member_id_hash;
      } else {
        return jsonResponse(
          {
            error: "NO_LINKED_MEMBER",
            message:
              "No member account linked. Please link your game account first.",
          },
          400,
          ruStatus,
        );
      }
    }

    const includeBuffer = c.req.query("include_buffer") === "true";

    // Query D1 for archived files
    let sql = `SELECT 
         bi.id,
         bi.dataset_id,
         bi.table_name,
          bi.table_version,
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

    if (tableVersionParam) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersionParam);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ?`;
    params.push(limit);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();

    if (
      (!result || !result.results || result.results.length === 0) &&
      !includeBuffer
    ) {
      return jsonResponse(
        {
          error: "DATASET_NOT_FOUND",
          message: `No data found for table '${tableName}'${scopeParam === "own" ? " (your uploads only)" : ""}`,
        },
        404,
        ruStatus,
      );
    }

    const archivedFiles = ((result?.results as any[]) || []).map((r) => ({
      id: r.id,
      file_path: r.file_path,
      period_tag: r.period_tag,
      table_version: r.table_version,
      size: r.size, // Block length
      record_count: r.record_count,
      start_timestamp: r.start_timestamp,
      end_timestamp: r.end_timestamp,
      // Use block_id for own scope (partial download), file path for all scope (full file)
      download_url:
        scopeParam === "own"
          ? `/api/data-loader/download?block_id=${r.id}`
          : `/api/data-loader/download?file=${r.file_path}`,
      type: "archive",
    }));

    const files = archivedFiles;

    if (files.length === 0) {
      return jsonResponse(
        {
          error: "DATASET_NOT_FOUND",
          message: `No data found for table '${tableName}'${scopeParam === "own" ? " (your uploads only)" : ""}`,
        },
        404,
        ruStatus,
      );
    }

    return jsonResponse(
      {
        success: true,
        table: tableName,
        period_tag: periodTag || "all",
        scope: scopeParam,
        count: files.length,
        files,
      },
      200,
      ruStatus,
    );
  } catch (error) {
    console.error("Data loader error:", error);
    return jsonResponse(
      {
        error: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
      500,
    );
  }
});

/**
 * GET /data-loader/usage - Get current usage status
 */
app.get("/usage", async (c) => {
  const apiKey = c.req.header("X-API-KEY");

  if (!apiKey) {
    return jsonResponse(
      { error: "MISSING_API_KEY", message: "X-API-KEY header is required" },
      401,
    );
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid or inactive API key" },
        403,
      );
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
    return jsonResponse(
      { error: "INTERNAL_ERROR", message: "An internal error occurred" },
      500,
    );
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

  if (!apiKey || !clientId) {
    return jsonResponse(
      { error: "MISSING_HEADERS", message: "Authentication required" },
      401,
    );
  }

  if (!filePath && !blockIdParam) {
    return jsonResponse(
      {
        error: "MISSING_PARAMS",
        message: "Either file or block_id parameter is required",
      },
      400,
    );
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid or inactive API key" },
        403,
      );
    }

    // Device trust check
    const trusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      env.runtime.DATA_LOADER_CACHE_KV,
    );
    if (!trusted) {
      // For download, if unreachable, just error? Or 403.
      return jsonResponse(
        { error: "DEVICE_UNVERIFIED", message: "Device not verified" },
        403,
      );
    }

    const bucket = env.runtime.BATTLE_DATA_BUCKET;
    const indexDb = env.runtime.BATTLE_INDEX_DB;
    if (!bucket || !indexDb) {
      return jsonResponse(
        {
          error: "Configuration Error",
          message: "R2 bucket or D1 database not configured",
        },
        500,
      );
    }

    // Block-based download (for scope=own)
    if (blockIdParam) {
      const blockId = parseInt(blockIdParam, 10);
      if (isNaN(blockId)) {
        return jsonResponse(
          { error: "INVALID_BLOCK_ID", message: "block_id must be a number" },
          400,
        );
      }

      // Get block info from D1
      const blockInfo = (await indexDb
        .prepare(
          `
        SELECT bi.id, bi.start_byte, bi.length, bi.dataset_id, af.file_path
        FROM block_indexes bi
        JOIN archived_files af ON af.id = bi.file_id
        WHERE bi.id = ?
      `,
        )
        .bind(blockId)
        .first()) as {
        id: number;
        start_byte: number;
        length: number;
        dataset_id: string;
        file_path: string;
      } | null;

      if (!blockInfo) {
        return jsonResponse(
          { error: "BLOCK_NOT_FOUND", message: "Block not found" },
          404,
        );
      }

      // Extract Avro header and data block
      // Note: start_byte is the accurate position where the dataset's data block starts
      // (after the Avro OCF header). This is correctly set by mergeAvroOCFWithBoundaries
      // in the compaction workflow when multiple datasets are merged into a single file.

      const headerObject = await bucket.get(blockInfo.file_path, {
        range: { offset: 0, length: blockInfo.start_byte }, // Fetches header (everything before data block)
      });

      if (!headerObject?.body) {
        return jsonResponse(
          { error: "FILE_NOT_FOUND", message: "File not found in storage" },
          404,
        );
      }

      const dataObject = await bucket.get(blockInfo.file_path, {
        range: { offset: blockInfo.start_byte, length: blockInfo.length },
      });

      if (!dataObject?.body) {
        return jsonResponse(
          { error: "DATA_NOT_FOUND", message: "Data block not found" },
          404,
        );
      }

      const headerBytes = await headerObject.arrayBuffer();
      const dataBytes = await dataObject.arrayBuffer();

      const combined = new Uint8Array(
        headerBytes.byteLength + dataBytes.byteLength,
      );
      combined.set(new Uint8Array(headerBytes), 0);
      combined.set(new Uint8Array(dataBytes), headerBytes.byteLength);

      const fileName = blockInfo.file_path.split("/").pop() || "data.avro";
      return new Response(combined, {
        headers: {
          "Content-Type": "application/avro",
          "Content-Length": String(combined.byteLength),
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    // File-based download (for scope=all fallback)
    if (filePath) {
      // Security check: Verify file exists in registry to prevent IDOR
      const fileRecord = await indexDb
        .prepare("SELECT 1 FROM archived_files WHERE file_path = ? LIMIT 1")
        .bind(filePath)
        .first();

      if (!fileRecord) {
        return jsonResponse(
          {
            error: "FORBIDDEN",
            message: "Access to this file is not authorized",
          },
          403,
        );
      }

      const object = await bucket.get(filePath);
      if (!object || !object.body) {
        return jsonResponse(
          { error: "FILE_NOT_FOUND", message: "File not found in storage" },
          404,
        );
      }

      const fileName = filePath.split("/").pop() || "data.avro";
      const headers = new Headers();
      headers.set("Content-Type", "application/avro");
      headers.set("Content-Length", String(object.size));
      headers.set("Content-Disposition", `attachment; filename="${fileName}"`);

      return new Response(object.body, { headers });
    }

    return jsonResponse(
      { error: "INVALID_REQUEST", message: "Invalid download parameters" },
      400,
    );
  } catch (error) {
    console.error("Download error:", error);
    return jsonResponse(
      { error: "INTERNAL_ERROR", message: "An internal error occurred" },
      500,
    );
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
  windowSeconds: number,
): Promise<boolean> {
  const rateLimitKey = `ratelimit:${key}`;
  const now = Date.now();

  const data = await kv.get(rateLimitKey);
  let attempts: number[] = data ? JSON.parse(data) : [];

  // Remove attempts outside the time window
  attempts = attempts.filter(
    (timestamp) => now - timestamp < windowSeconds * 1000,
  );

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
  } = {},
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
  apiKey: string,
): Promise<{ id: string; user_id: string; email: string } | null> {
  const results = await supabaseRequest<
    { id: string; user_id: string; email: string }[]
  >(config, "api_keys", {
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
  kv?: KVNamespace,
): Promise<boolean> {
  const results = await supabaseRequest<{ id: string; last_used_at: string }[]>(
    config,
    "trusted_devices",
    {
      query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}&select=id,last_used_at`,
    },
  );

  if (results && results.length > 0) {
    const device = results[0];
    const now = new Date();
    const lastUsed = new Date(device.last_used_at);
    const hoursSinceLastUpdate =
      (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60);

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
            expirationTtl: LAST_USED_UPDATE_BATCH_HOURS * 3600,
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
  code: string,
): Promise<void> {
  const expiresAt = new Date(
    Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000,
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
  code: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const results = await supabaseRequest<{ id: string }[]>(
    config,
    "verification_codes",
    {
      query: `?user_id=eq.${userId}&client_id=eq.${encodeURIComponent(clientId)}&code=eq.${code}&is_used=eq.false&expires_at=gt.${now}&select=id`,
    },
  );

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
  code: string,
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
  cacheKV?: KVNamespace,
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
  const rawTag =
    Array.isArray(rows) && rows.length > 0 ? (rows[0].tag ?? null) : null;

  if (!rawTag) {
    return null;
  }

  // Convert ISO8601 to YYYY-MM-DD in Tokyo timezone (matching Rust behavior)
  // Rust: parsed_tag.with_timezone(&chrono_tz::Asia::Tokyo).date_naive().to_string()
  const parsedDate = new Date(rawTag);
  const tokyoDate = parsedDate.toLocaleDateString("sv-SE", {
    timeZone: "Asia/Tokyo",
  }); // "sv-SE" locale gives YYYY-MM-DD format

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
 * GET /data-loader/download-master - Download master-data from R2
 * Query params:
 *   - period_tag: Period tag
 *   - table_name: Table name
 */
app.get("/download-master", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");
  const periodTag = c.req.query("period_tag");
  const tableName = c.req.query("table_name");
  const tableVersion = c.req.query("table_version");
  const periodRevision = c.req.query("period_revision");

  if (!apiKey || !clientId) {
    return new Response("Authentication required", { status: 401 });
  }

  if (!periodTag || !tableName) {
    return new Response("period_tag and table_name parameters are required", {
      status: 400,
    });
  }

  const VALID_MASTER_TABLE_NAMES = new Set([
    "mst_ship", "mst_shipgraph", "mst_slotitem", "mst_slotitem_equiptype",
    "mst_payitem", "mst_equip_exslot", "mst_equip_exslot_ship",
    "mst_equip_limit_exslot", "mst_equip_ship", "mst_stype",
    "mst_map_area", "mst_map_info", "mst_ship_upgrade",
  ]);
  if (!VALID_MASTER_TABLE_NAMES.has(tableName)) {
    return new Response("Invalid table_name", { status: 400 });
  }

  try {
    const env = createEnvContext(c);
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return new Response("Invalid API key", { status: 403 });
    }

    const kv = env.runtime.DATA_LOADER_CACHE_KV;
    if (!kv) {
      return new Response("Service unavailable", { status: 503 });
    }

    const ruStatus = await checkAndDeductRU(
      kv,
      apiKeyData.user_id,
      RU_COSTS.DOWNLOAD,
    );
    if (!ruStatus.allowed) {
      return new Response("RU limit exceeded", { status: 429 });
    }

    const trusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      kv,
    );
    if (!trusted) {
      const code = generateVerificationCode();
      await saveVerificationCode(
        getSupabaseConfig(c),
        apiKeyData.user_id,
        clientId,
        code,
      );
      await sendVerificationEmail(env, apiKeyData.email, code);
      return new Response("Device unverified", { status: 403 });
    }

    const masterDb = env.runtime.MASTER_DATA_INDEX_DB;
    const bucket = env.runtime.MASTER_DATA_BUCKET;

    if (!masterDb || !bucket) {
      return new Response("Master data service not configured", {
        status: 503,
      });
    }

    // Get r2_key from master_data_index
    let sql = `SELECT mdt.r2_key FROM master_data_tables mdt
       JOIN master_data_index mdi ON mdt.master_data_id = mdi.id
       WHERE mdi.period_tag = ? AND mdt.table_name = ? AND mdi.upload_status = 'completed'`;
    const params: unknown[] = [periodTag, tableName];
    if (tableVersion) {
      sql += " AND mdi.table_version = ?";
      params.push(tableVersion);
    }
    if (periodRevision) {
      const parsedRevision = Number(periodRevision);
      if (!Number.isInteger(parsedRevision) || parsedRevision < 1) {
        return new Response("Invalid period_revision", { status: 400 });
      }
      sql += " AND mdi.period_revision = ?";
      params.push(parsedRevision);
    }
    sql += " ORDER BY mdi.completed_at DESC, mdi.period_revision DESC LIMIT 1";
    const stmt = masterDb.prepare(sql);
    const row = await stmt.bind(...params).first();
    const r2Key = (row as { r2_key?: string } | null)?.r2_key;

    if (!r2Key) {
      return new Response("Master data not found", { status: 404 });
    }

    // Fetch from R2
    const object = await bucket.get(r2Key);
    if (!object) {
      return new Response("R2 object not found", { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${tableName}.avro"`,
        ...DATA_LOADER_CORS_HEADERS,
      },
    });
  } catch (error) {
    console.error("Master data download error:", error);
    return new Response("Internal error", { status: 500 });
  }
});

/**
 * POST /data-loader/verify - Verify OTP and register device
 */
app.post("/verify", async (c) => {
  const apiKey = c.req.header("X-API-KEY");
  const clientId = c.req.header("X-CLIENT-ID");

  if (!apiKey || !clientId) {
    return jsonResponse(
      {
        error: "MISSING_HEADERS",
        message: "X-API-KEY and X-CLIENT-ID headers are required",
      },
      400,
    );
  }

  // Rate limiting: 5 attempts per client per 5 minutes
  const env = createEnvContext(c);
  const kv = env.runtime.DATA_LOADER_CACHE_KV;
  if (kv) {
    const isRateLimited = await checkRateLimit(
      kv,
      `verify:${clientId}`,
      5,
      300,
    );
    if (isRateLimited) {
      return jsonResponse(
        {
          error: "RATE_LIMITED",
          message: "Too many verification attempts. Please try again later.",
        },
        429,
      );
    }
  }

  let body: { code?: string };
  try {
    body = await c.req.json();
  } catch {
    return jsonResponse(
      { error: "INVALID_BODY", message: "Invalid JSON body" },
      400,
    );
  }

  const { code } = body;
  if (!code) {
    return jsonResponse(
      { error: "MISSING_CODE", message: "Verification code is required" },
      400,
    );
  }

  try {
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid or inactive API key" },
        403,
      );
    }

    const success = await verifyCodeAndRegisterDevice(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      code,
    );

    if (!success) {
      return jsonResponse(
        {
          error: "INVALID_CODE",
          message: "Invalid or expired verification code",
        },
        400,
      );
    }

    return jsonResponse({
      success: true,
      message: "Device verified and registered successfully",
    });
  } catch (error) {
    console.error("Verification error:", error);
    return jsonResponse(
      {
        error: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
      500,
    );
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
    return jsonResponse(
      {
        error: "MISSING_HEADERS",
        message: "X-API-KEY and X-CLIENT-ID headers are required",
      },
      400,
    );
  }

  // Rate limiting: 5 attempts per client per 5 minutes
  const env = createEnvContext(c);
  const kv = env.runtime.DATA_LOADER_CACHE_KV;
  if (kv) {
    const isRateLimited = await checkRateLimit(
      kv,
      `verify-google:${clientId}`,
      5,
      300,
    );
    if (isRateLimited) {
      return jsonResponse(
        {
          error: "RATE_LIMITED",
          message: "Too many verification attempts. Please try again later.",
        },
        429,
      );
    }
  }

  let body: { email?: string; google_token?: string };
  try {
    body = await c.req.json();
  } catch {
    return jsonResponse(
      { error: "INVALID_BODY", message: "Invalid JSON body" },
      400,
    );
  }

  const { email, google_token } = body;

  if (!email && !google_token) {
    return jsonResponse(
      {
        error: "MISSING_CREDENTIALS",
        message: "Email or Google token is required",
      },
      400,
    );
  }

  try {
    const apiKeyData = await validateApiKey(getSupabaseConfig(c), apiKey);
    if (!apiKeyData) {
      return jsonResponse(
        { error: "INVALID_API_KEY", message: "Invalid or inactive API key" },
        403,
      );
    }

    // If google_token is provided, verify it and get email
    let verifiedEmail = email;
    if (google_token) {
      try {
        // Use userinfo endpoint (recommended by Google, v3/tokeninfo is deprecated)
        const userinfoResp = await fetch(
          `https://www.googleapis.com/oauth2/v2/userinfo`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${google_token}` },
          },
        );
        if (userinfoResp.ok) {
          const userinfo = (await userinfoResp.json()) as { email?: string };
          verifiedEmail = userinfo.email || email;
        } else if (userinfoResp.status === 401) {
          throw new Error("Invalid or expired Google token");
        } else {
          throw new Error(`Google userinfo failed: ${userinfoResp.status}`);
        }
      } catch (e) {
        console.error("Failed to verify Google token:", e);
        return jsonResponse(
          {
            error: "INVALID_TOKEN",
            message: "Failed to verify Google account token",
          },
          401,
        );
      }
    }

    // Check if email matches
    if (!verifiedEmail) {
      return jsonResponse(
        {
          error: "EMAIL_REQUIRED",
          message: "Could not determine email from Google account",
        },
        400,
      );
    }

    // Normalize email comparison (case-insensitive)
    if (verifiedEmail.toLowerCase() !== apiKeyData.email.toLowerCase()) {
      return jsonResponse(
        {
          error: "EMAIL_MISMATCH",
          message: "Google account email does not match API key email",
        },
        403,
      );
    }

    // Email matches - register device as trusted
    const alreadyTrusted = await isDeviceTrusted(
      getSupabaseConfig(c),
      apiKeyData.user_id,
      clientId,
      env.runtime.DATA_LOADER_CACHE_KV,
    );
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
    return jsonResponse(
      {
        error: "INTERNAL_ERROR",
        message: "An internal error occurred",
      },
      500,
    );
  }
});
/**
 * GET /data-loader/health - Health check
 */
app.get("/health", () => {
  return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
