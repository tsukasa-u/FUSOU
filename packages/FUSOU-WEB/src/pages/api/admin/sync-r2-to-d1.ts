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
};

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

  const result: SyncResult = {
    scanned: 0,
    existing: 0,
    inserted: 0,
    failed: 0,
    errors: [],
    duration: 0,
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

    // Step 3: Identify missing keys and insert them
    const missingKeys = r2Keys.filter((key) => !existingKeysSet.has(key));

    for (const key of missingKeys) {
      try {
        // Fetch metadata from R2
        const obj = await bucket.head(key);
        if (!obj) {
          result.failed++;
          result.errors.push({
            key,
            error: "Object not found in R2 (deleted after listing?)",
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

        // Insert into D1
        const uploadedAt = obj.uploaded ? obj.uploaded.getTime() : Date.now();
        const contentType =
          obj.httpMetadata?.contentType || "application/octet-stream";
        const metadata = obj.customMetadata || {};

        const insertStmt = db.prepare(
          `INSERT INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        const insertResult = await insertStmt
          .bind(
            key,
            obj.size,
            uploadedAt,
            contentType,
            metadata.uploaded_by || null,
            metadata.finder_tag || null,
            JSON.stringify({
              file_name: metadata.file_name || null,
              declared_size: metadata.declared_size || null,
              synced_from_r2: true,
              synced_at: Date.now(),
            })
          )
          .run();

        if (insertResult && "success" in insertResult && insertResult.success) {
          result.inserted++;
        } else {
          result.failed++;
          const errorMsg =
            "error" in insertResult
              ? String(insertResult.error)
              : "Unknown error";
          result.errors.push({ key, error: errorMsg });
        }
      } catch (e) {
        result.failed++;
        result.errors.push({
          key,
          error: e instanceof Error ? e.message : String(e),
        });
        console.error(`Failed to sync key ${key}:`, e);
      }
    }

    // Purge cache
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
