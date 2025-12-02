import type { APIRoute } from "astro";
import type { D1Database } from "../asset-sync/types";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

interface CloudflareEnv {
  ASSET_SYNC_BUCKET?: R2BucketBinding;
  ASSET_INDEX_DB?: D1Database;
  ADMIN_API_SECRET?: string;
}

type R2BucketBinding = {
  list(options?: R2ListOptions): Promise<R2ListResponse>;
  head(key: string): Promise<R2Object | null>;
};

type R2ListOptions = {
  limit?: number;
  cursor?: string;
};

type R2ListResponse = {
  objects: R2ObjectLite[];
  truncated?: boolean;
  cursor?: string;
};

type R2ObjectLite = {
  key: string;
};

type R2Object = {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
};

type SyncResult = {
  scanned: number;
  existing: number;
  inserted: number;
  failed: number;
  errors: Array<{ key: string; error: string }>;
  duration: number;
  resumeCursor?: string;
  completed: boolean;
};

// Process up to this many missing keys per invocation to avoid API limits
const MAX_KEYS_PER_INVOCATION = 50;

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  const startTime = Date.now();

  // Verify admin authorization
  const env = extractEnv(locals.runtime?.env);
  const adminSecret = env?.ADMIN_API_SECRET || import.meta.env.ADMIN_API_SECRET;
  if (!adminSecret) {
    return errorResponse("Admin API is not configured on this server", 503);
  }

  const authHeader = request.headers.get("authorization");
  const providedSecret = extractBearer(authHeader);
  if (!providedSecret || providedSecret !== adminSecret) {
    return errorResponse("Unauthorized: Invalid admin secret", 401);
  }

  // Check environment bindings
  const bucket = env?.ASSET_SYNC_BUCKET;
  if (!bucket) {
    return errorResponse(
      "ASSET_SYNC_BUCKET is not configured. Bind R2 bucket.",
      503
    );
  }

  const db = env?.ASSET_INDEX_DB;
  if (!db) {
    return errorResponse(
      "ASSET_INDEX_DB is not configured. Bind D1 database.",
      503
    );
  }

  // Parse request body to get resume cursor if provided
  let resumeFromKey: string | undefined;
  try {
    const contentType = request.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      const body = (await request.json()) as { resumeFromKey?: string };
      resumeFromKey = body.resumeFromKey;
    }
  } catch {
    // No body or invalid JSON, proceed without resume
  }

  const result: SyncResult = {
    scanned: 0,
    existing: 0,
    inserted: 0,
    failed: 0,
    errors: [],
    duration: 0,
    completed: false,
  };

  try {
    // Step 1: Load all keys from D1
    const existingKeysSet = new Set<string>();
    try {
      const stmt = db.prepare("SELECT key FROM files");
      const res = await stmt.all?.();
      if (res?.results) {
        for (const row of res.results) {
          if (typeof row.key === "string") {
            existingKeysSet.add(row.key);
          }
        }
      }
    } catch (e) {
      console.error("Failed to load existing keys from D1", e);
      return errorResponse("Failed to query D1 database", 500);
    }

    // Step 2: List all objects from R2 bucket
    const r2Keys: string[] = [];
    let cursor: string | undefined;
    let truncated = true;

    while (truncated) {
      const listResult = await bucket.list({
        limit: 10000,
        cursor,
      });

      for (const obj of listResult.objects) {
        r2Keys.push(obj.key);
      }

      truncated = listResult.truncated ?? false;
      cursor = listResult.cursor;
    }

    result.scanned = r2Keys.length;

    // Step 3: Identify missing keys
    let missingKeys = r2Keys.filter((key) => !existingKeysSet.has(key));

    // If resuming, skip keys before the resume point
    if (resumeFromKey) {
      const resumeIndex = missingKeys.indexOf(resumeFromKey);
      if (resumeIndex >= 0) {
        missingKeys = missingKeys.slice(resumeIndex);
      }
    }

    // Step 4: Process in batches to avoid API limits
    const keysToProcess = missingKeys.slice(0, MAX_KEYS_PER_INVOCATION);
    const hasMoreKeys = missingKeys.length > MAX_KEYS_PER_INVOCATION;

    // Batch process: collect metadata first
    const metadataPromises = keysToProcess.map(async (key) => {
      try {
        const obj = await bucket.head(key);
        return { key, obj };
      } catch (e) {
        return { key, obj: null, error: e };
      }
    });

    const metadataResults = await Promise.all(metadataPromises);

    // Prepare batch insert statements
    const insertStatements: Array<{
      key: string;
      size: number;
      uploadedAt: number;
      contentType: string;
      uploaderId: string | null;
      finderTag: string | null;
      metadata: string;
    }> = [];

    for (const { key, obj, error } of metadataResults) {
      if (error || !obj) {
        result.failed++;
        result.errors.push({
          key,
          error:
            error instanceof Error ? error.message : "Object not found in R2",
        });
        continue;
      }

      // Check if key already exists (race condition safety)
      const checkStmt = db.prepare("SELECT key FROM files WHERE key = ?");
      const existing = await checkStmt.bind(key).first?.();
      if (existing) {
        result.existing++;
        continue;
      }

      const uploadedAt = obj.uploaded ? obj.uploaded.getTime() : Date.now();
      const contentType =
        obj.httpMetadata?.contentType || "application/octet-stream";
      const customMetadata = obj.customMetadata || {};

      insertStatements.push({
        key,
        size: obj.size,
        uploadedAt,
        contentType,
        uploaderId: customMetadata.uploaded_by || null,
        finderTag: customMetadata.finder_tag || null,
        metadata: JSON.stringify({
          file_name: customMetadata.file_name || null,
          declared_size: customMetadata.declared_size || null,
          synced_from_r2: true,
          synced_at: Date.now(),
        }),
      });
    }

    // Execute batch insert using D1 batch API
    if (insertStatements.length > 0) {
      try {
        const batchStmts = insertStatements.map((data) => {
          return db
            .prepare(
              `INSERT INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              data.key,
              data.size,
              data.uploadedAt,
              data.contentType,
              data.uploaderId,
              data.finderTag,
              data.metadata
            );
        });

        // D1 batch execution (if supported)
        // Note: D1 batch() may not be available in all environments
        if (typeof (db as any).batch === "function") {
          const batchResults = await (db as any).batch(batchStmts);
          for (let i = 0; i < batchResults.length; i++) {
            const res = batchResults[i];
            if (res && "success" in res && res.success) {
              result.inserted++;
            } else {
              result.failed++;
              result.errors.push({
                key: insertStatements[i].key,
                error:
                  "error" in res ? String(res.error) : "Batch insert failed",
              });
            }
          }
        } else {
          // Fallback: execute sequentially
          for (const data of insertStatements) {
            try {
              const insertResult = await db
                .prepare(
                  `INSERT INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  data.key,
                  data.size,
                  data.uploadedAt,
                  data.contentType,
                  data.uploaderId,
                  data.finderTag,
                  data.metadata
                )
                .run();

              if (
                insertResult &&
                "success" in insertResult &&
                insertResult.success
              ) {
                result.inserted++;
              } else {
                result.failed++;
                result.errors.push({
                  key: data.key,
                  error:
                    "error" in insertResult
                      ? String(insertResult.error)
                      : "Insert failed",
                });
              }
            } catch (e) {
              result.failed++;
              result.errors.push({
                key: data.key,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      } catch (e) {
        console.error("Batch insert failed", e);
        return errorResponse(
          `Batch insert failed: ${e instanceof Error ? e.message : String(e)}`,
          500
        );
      }
    }

    // Set resume cursor if there are more keys to process
    if (hasMoreKeys && keysToProcess.length > 0) {
      result.resumeCursor = keysToProcess[keysToProcess.length - 1];
      result.completed = false;
    } else {
      result.completed = true;
    }

    // Purge cache only when completed
    if (result.completed) {
      try {
        const url = new URL(request.url);
        const keysUrl = new URL(url.origin);
        keysUrl.pathname = "/api/asset-sync/keys";
        const purgeRequest = new Request(keysUrl.toString(), { method: "GET" });
        const cache = await caches.open("asset-sync-cache");
        locals.runtime?.waitUntil(cache.delete(purgeRequest));
      } catch (cacheErr) {
        console.warn("Failed to purge cache:", cacheErr);
      }
    }

    result.duration = Date.now() - startTime;
    return jsonResponse(result);
  } catch (e) {
    console.error("Sync operation failed", e);
    return errorResponse(
      `Sync failed: ${e instanceof Error ? e.message : String(e)}`,
      500
    );
  }
};

function extractEnv(value: unknown): CloudflareEnv | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as CloudflareEnv;
}

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (!rest.length || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return rest.join(" ");
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}
