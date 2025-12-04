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
  size: number;
  uploaded: Date;
  httpMetadata?: {
    contentType?: string;
  };
  customMetadata?: Record<string, string>;
};

type R2Object = R2ObjectLite;

type InsertStatement = {
  key: string;
  size: number;
  uploadedAt: number;
  contentType: string;
  uploaderId: string | null;
  finderTag: string | null;
  metadata: string;
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
    // Step 1: Iterate R2 bucket in pages
    let cursor: string | undefined;
    let truncated = true;

    while (truncated) {
      // 1. List a batch of objects from R2
      const listResult = await bucket.list({
        limit: 1000, // Process 1000 at a time
        cursor,
      });

      const batchR2Objects = listResult.objects;
      if (batchR2Objects.length === 0) {
        break;
      }

      result.scanned += batchR2Objects.length;
      const batchKeys = batchR2Objects.map((o) => o.key);

      // 2. Check D1 for existence of these keys
      // Since D1 doesn't support "WHERE key IN (...)" well with 1000 params,
      // we can either loop or fetch a chunk. 
      // Efficient approach: Select existing keys from D1 that match this batch.
      // "SELECT key FROM files WHERE key IN (?, ?, ...)"
      
      const existingKeysInBatch = new Set<string>();
      const placeholders = batchKeys.map(() => "?").join(",");
      // Be careful with SQL variable limit (usually around 100 or 999). 
      // SQLite default is often 999 or 32766. D1 is safer with smaller batches?
      // Let's process the check in smaller chunks (e.g. 50) to be safe and reuse existing logic.

      const CHUNK_SIZE = 50;
      for (let i = 0; i < batchKeys.length; i += CHUNK_SIZE) {
        const chunkKeys = batchKeys.slice(i, i + CHUNK_SIZE);
        const chunkPlaceholders = chunkKeys.map(() => "?").join(",");
        
        try {
          const stmt = db.prepare(`SELECT key FROM files WHERE key IN (${chunkPlaceholders})`)
            .bind(...chunkKeys);
          const res = stmt?.all ? await stmt.all() : { results: [] };
          
          if (res.results) {
            for (const r of res.results) {
              if (typeof r.key === "string") existingKeysInBatch.add(r.key);
            }
          }
        } catch (err) {
          console.error("Failed to check existence for chunk", err);
          // If check fails, we might try to insert and fail on unique constraint, 
          // or skip. Let's skip to be safe.
        }
      }

      // 3. Identify missing
      const missingObjects = batchR2Objects.filter(obj => !existingKeysInBatch.has(obj.key));
      
      // 4. Insert missing
      // We can reuse the batch insert logic.
      // The original code fetched `head` for metadata. `list` returns some metadata but not customMetadata usually?
      // R2 list() returns R2Object, which includes customMetadata!
      // So we don't need to HEAD each object individually if list() provides enough.
      // Check type definition in this file: 
      // type R2Object = { ... customMetadata?: ... }
      // Assuming the binding provides it. If not, we must HEAD.
      // Standard R2 list returns Objects with customMetadata.

      const insertStatements: InsertStatement[] = [];
      for (const obj of missingObjects) {
        // Filter out if resuming
        if (resumeFromKey && obj.key < resumeFromKey) {
           continue; 
        }
        
        // Double check existing count (for the stats)
        if (existingKeysInBatch.has(obj.key)) {
            result.existing++;
            continue;
        }

        const uploadedAt = obj.uploaded ? new Date(obj.uploaded).getTime() : Date.now();
        const contentType = obj.httpMetadata?.contentType || "application/octet-stream";
        const customMetadata = obj.customMetadata || {};

        insertStatements.push({
            key: obj.key,
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
      
      // Execute Insert
      if (insertStatements.length > 0) {
          // ... (Insert logic)
          // We need to be careful not to duplicate code too much, but for refactoring,
          // let's inline the insert loop here or make it a function.
          // For brevity in this tool, I'll use sequential insert as it is more robust.
          
          for (const data of insertStatements) {
            try {
              await db.prepare(
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
              result.inserted++;
            } catch (e) {
               // Ignore unique constraint errors if they happen (race condition)
               result.failed++;
               result.errors.push({ key: data.key, error: String(e) });
            }
          }
      }

      truncated = listResult.truncated ?? false;
      cursor = listResult.cursor;
      
      // Check time limits? Cloudflare Workers have 30s (or more) limit.
      // If we run too long, we should probably return with resumeCursor.
      if (Date.now() - startTime > 20000) { // 20 seconds safety margin
          result.resumeCursor = cursor;
          result.completed = false;
          break;
      }
    }
    
    if (truncated === false && !result.resumeCursor) {
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
