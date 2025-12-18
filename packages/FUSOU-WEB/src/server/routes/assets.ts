import { Hono } from "hono";
import type { Bindings } from "../types";
import {
  MAX_UPLOAD_BYTES,
  CACHE_CONTROL,
  CORS_HEADERS,
  SIGNED_URL_TTL_SECONDS,
  SAFE_MIME_BY_EXTENSION,
  CACHE_TTL_SECONDS,
} from "../constants";
import {
  extractBearer,
  validateJWT,
  resolveAllowedExtensions,
  sanitizeKey,
  sanitizeFileName,
  violatesAllowList,
  parseSize,
  createEnvContext,
  getEnv,
} from "../utils";
import { handleTwoStageUpload } from "../utils/upload";

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// POST /upload
app.post("/upload", async (c) => {
  const envCtx = createEnvContext(c);
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;
  const db = envCtx.runtime.ASSET_INDEX_DB;
  const signingSecret = getEnv(envCtx, "ASSET_UPLOAD_SIGNING_SECRET");

  if (!bucket || !db || !signingSecret) {
    console.error("[asset-sync] missing bindings", {
      hasBucket: !!bucket,
      hasDb: !!db,
      hasSigningSecret: !!signingSecret,
      envKeys: Object.keys(envCtx.runtime || {}),
    });
    return c.json({ error: "Asset sync bucket not configured" }, 503);
  }

  const allowedExtensions = resolveAllowedExtensions(
    getEnv(envCtx, "ASSET_SYNC_ALLOWED_EXTENSIONS"),
  );

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    tokenTTL: SIGNED_URL_TTL_SECONDS,
    maxBodySize: MAX_UPLOAD_BYTES,

    // Preparation validation - check extension, size, hash, uniqueness
    preparationValidator: async (body, _user) => {
      const key = sanitizeKey(typeof body.key === "string" ? body.key : null);
      if (!key) {
        return c.json({ error: "Invalid or empty key" }, 400);
      }

      const relativePath = sanitizeKey(
        typeof body.relative_path === "string" ? body.relative_path : null,
      );
      if (!relativePath) {
        return c.json({ error: "Invalid relative_path" }, 400);
      }

      const declaredSize = parseSize(
        typeof body.file_size === "string" ? body.file_size : undefined,
      );
      if (!declaredSize || declaredSize <= 0 || declaredSize > MAX_UPLOAD_BYTES) {
        return c.json({ error: "Invalid file size" }, 400);
      }

      const contentHash = typeof body.content_hash === "string" ? body.content_hash.trim() : "";
      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }

      const fileName = sanitizeFileName(
        typeof body.file_name === "string" ? body.file_name : null,
      );
      const candidateNames = [fileName, key, relativePath];

      if (violatesAllowList(candidateNames, allowedExtensions)) {
        return c.json({ error: "This file type is not allowed for upload" }, 415);
      }

      // Check if file exists and compare content_hash for updates
      try {
        const existingStmt = db.prepare(
          "SELECT content_hash FROM files WHERE key = ? LIMIT 1"
        );
        const existingRes = await existingStmt.bind(key).first();
        
        if (existingRes) {
          const existingHash = existingRes.content_hash as string | null;
          if (existingHash === contentHash) {
            // Content unchanged - return 409 Conflict
            return c.json({ error: "Asset already exists and content has not changed" }, 409);
          }
          // Content updated - allow re-upload
          console.info(`Asset ${key} content updated, proceeding with re-upload`);
        }
      } catch (err) {
        // If query fails, continue with upload (table may not have content_hash column yet)
        console.warn("[asset-sync] Could not check existing content_hash:", String(err));
      }

      return {
        tokenPayload: {
          key,
          relative_path: relativePath,
          declared_size: declaredSize,
          file_name: fileName,
          content_hash: contentHash,
        },
        fields: {
          key,
          relative_path: relativePath,
          declared_size: declaredSize,
          file_name: fileName,
        },
      };
    },

    // Execution processing - validate size, upload to R2, record to D1
    executionProcessor: async (tokenPayload, data, user) => {
      const key = tokenPayload.key;
      const declaredSize = tokenPayload.declared_size;

      if (!key || !declaredSize) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      const result = await bucket.put(key, data, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: CACHE_CONTROL,
        },
        customMetadata: { uploaded_by: user.id },
      });

      const storedSize = result?.size || 0;
      const uploadedAt = Date.now();

      const stmt = db.prepare(
        "INSERT OR REPLACE INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      );

      await stmt
        .bind(
          key,
          storedSize,
          uploadedAt,
          "application/octet-stream",
          user.id,
          null,
          JSON.stringify({ synced_at: uploadedAt }),
          tokenPayload.content_hash,
          new Date(uploadedAt).toISOString(),
        )
        .run();

      return {
        response: { key, size: storedSize },
      };
    },
  });
});

// GET /keys
app.get("/keys", async (c) => {
  console.log("GET /keys: request received");

  // Require valid Supabase access token
  const authHeader = c.req.header("Authorization");
  console.log(`GET /keys: Authorization header present: ${!!authHeader}`);

  const accessToken = extractBearer(authHeader);

  if (!accessToken) {
    console.log("GET /keys: no bearer token found in Authorization header");
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  console.log("GET /keys: bearer token extracted, calling validateJWT");
  const supabaseUser = await validateJWT(accessToken);

  if (!supabaseUser) {
    console.log("GET /keys: JWT validation failed, returning 401");
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  console.log(
    `GET /keys: JWT validation successful, user_id=${supabaseUser.id}`,
  );

  const envCtx = createEnvContext(c);
  const db = envCtx.runtime.ASSET_INDEX_DB;

  if (!db) {
    console.log("GET /keys: ASSET_INDEX_DB not configured");
    return c.json({ error: "ASSET_INDEX_DB is not configured" }, 503);
  }

  try {
    const keys: string[] = [];
    const items: {
      key: string;
      contentHash: string | null;
      size: number;
      uploadedAt: number | null;
    }[] = [];
    let cursor = 0;
    const BATCH_SIZE = 1000;

    while (true) {
      const stmt = db
        .prepare(
          "SELECT key, content_hash, size, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?",
        )
        .bind(BATCH_SIZE, cursor);

      const res = await stmt.all?.();
      const batch = (res?.results || []) as Array<{
        key?: unknown;
        content_hash?: unknown;
        size?: unknown;
        uploaded_at?: unknown;
      }>;

      const filtered = batch.filter((r) => typeof r.key === "string");
      for (const r of filtered) {
        const key = r.key as string;
        keys.push(key);
        items.push({
          key,
          contentHash:
            typeof r.content_hash === "string" ? r.content_hash : null,
          size: typeof r.size === "number" ? r.size : 0,
          uploadedAt:
            typeof r.uploaded_at === "number" ? r.uploaded_at : null,
        });
      }

      if (batch.length === 0) break;
      cursor += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }

    const refreshedAt = Date.now();
    const expiresAt = refreshedAt + CACHE_TTL_SECONDS * 1000;

    return c.json({
      keys,
      items,
      total: items.length,
      refreshedAt: new Date(refreshedAt).toISOString(),
      cacheExpiresAt: new Date(expiresAt).toISOString(),
      cached: false,
    });
  } catch (e) {
    return c.json({ error: "Failed to list assets" }, 502);
  }
});

// GET /check-hash
// Check if a file with the same content hash already exists
app.get("/check-hash", async (c) => {
  const envCtx = createEnvContext(c);
  const db = envCtx.runtime.ASSET_INDEX_DB;

  if (!db) {
    return c.json({ error: "Database not configured" }, 503);
  }

  const contentHash = c.req.query("hash");
  if (!contentHash) {
    return c.json({ error: "Missing hash parameter" }, 400);
  }

  try {
    const stmt = db.prepare(
      "SELECT key, size, uploaded_at FROM files WHERE content_hash = ? LIMIT 1"
    );
    const result = await stmt.bind(contentHash).first();

    if (result) {
      return c.json({
        exists: true,
        file: {
          key: result.key,
          size: result.size,
          uploadedAt: result.uploaded_at,
        },
      });
    } else {
      return c.json({ exists: false });
    }
  } catch (err) {
    console.error("[asset-sync] hash check error", err);
    return c.json({ error: "Failed to check hash" }, 500);
  }
});

// GET /mime
app.get("/mime", async (c) => {
  return c.json(SAFE_MIME_BY_EXTENSION);
});

export default app;
