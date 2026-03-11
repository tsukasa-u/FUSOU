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
  validateDatasetToken,
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
      // Validate dataset_token if provided
      const datasetTokenHeader = c.req.header('X-Dataset-Token');
      const datasetTokenBody = typeof body?.dataset_token === 'string' ? body.dataset_token.trim() : '';
      const datasetToken = datasetTokenHeader || datasetTokenBody;

      if (datasetToken) {
        const datasetTokenSecret = getEnv(envCtx, 'DATASET_TOKEN_SECRET');
        if (!datasetTokenSecret) {
          console.error('[asset-sync] DATASET_TOKEN_SECRET not configured');
          return c.json({ error: 'Server configuration error' }, 500);
        }

        const validatedToken = await validateDatasetToken(datasetToken, datasetTokenSecret);
        if (!validatedToken) {
          console.warn('[asset-sync] Invalid or expired dataset_token');
          return c.json({ error: 'Invalid or expired dataset_token' }, 401);
        }

        console.log(`[asset-sync] dataset_token validated successfully`);
      }

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
// Supports incremental sync via optional 'since' query parameter (ms since epoch)
// When 'since' is provided, returns only files with uploaded_at > since
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

  // Parse optional 'since' parameter for incremental sync
  const sinceParam = c.req.query("since");
  let sinceMs: number | null = null;
  if (sinceParam) {
    const parsed = parseInt(sinceParam, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      sinceMs = parsed;
      console.log(`GET /keys: incremental sync requested, since=${sinceMs}`);
    }
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
      // Use conditional query based on whether 'since' is provided
      let stmt: D1PreparedStatement;
      if (sinceMs) {
        stmt = db
          .prepare(
            "SELECT key, content_hash, size, uploaded_at FROM files WHERE uploaded_at > ? ORDER BY uploaded_at DESC LIMIT ? OFFSET ?",
          )
          .bind(sinceMs, BATCH_SIZE, cursor);
      } else {
        stmt = db
          .prepare(
            "SELECT key, content_hash, size, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?",
          )
          .bind(BATCH_SIZE, cursor);
      }

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

    console.log(`GET /keys: returning ${items.length} items (incremental=${!!sinceMs})`);

    return c.json({
      keys,
      items,
      total: items.length,
      refreshedAt: new Date(refreshedAt).toISOString(),
      cacheExpiresAt: new Date(expiresAt).toISOString(),
      cached: false,
      incremental: !!sinceMs,  // Indicates whether this is a partial or full sync
    });
  } catch (e) {
    console.error("GET /keys: error", e);
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

/**
 * GET /ship-banner-map - Bulk mapping of ship IDs to R2 keys
 *
 * Returns a JSON object { base_url, banners: { [shipId]: r2Key } }
 * so the client can construct direct R2 URLs: `${base_url}/${r2Key}`
 *
 * Heavily cached — banner keys rarely change.
 * No authentication required — public reference data.
 */
app.get("/ship-banner-map", async (c) => {
  const envCtx = createEnvContext(c);
  const db = envCtx.runtime.ASSET_INDEX_DB;
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;
  const assetBaseUrl = getEnv(envCtx, "ASSET_BASE_URL") || "";

  if (!db && !bucket) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  try {
    const banners: Record<string, string> = {};

    if (db) {
      try {
        const rows = await db
          .prepare("SELECT key FROM files WHERE key LIKE 'assets/kcs2/resources/ship/banner/%'")
          .all();
        if (rows.results) {
          for (const row of rows.results as { key: string }[]) {
            // Extract ship ID from key: assets/kcs2/resources/ship/banner/0001_ver.png -> 1
            const match = row.key.match(/\/banner\/(\d{4})_/);
            if (match) {
              const shipId = String(parseInt(match[1], 10));
              // Keep only the first (or latest) entry per ship
              if (!banners[shipId]) {
                banners[shipId] = row.key;
              }
            }
          }
        }
      } catch {
        // D1 unavailable
      }
    }

    // Fallback: R2 list if D1 was empty
    if (Object.keys(banners).length === 0 && bucket) {
      const listed = await bucket.list({
        prefix: "assets/kcs2/resources/ship/banner/",
        limit: 1000,
      });
      for (const obj of listed.objects) {
        const match = obj.key.match(/\/banner\/(\d{4})_/);
        if (match) {
          const shipId = String(parseInt(match[1], 10));
          if (!banners[shipId]) {
            banners[shipId] = obj.key;
          }
        }
      }
    }

    // Local dev: fetch full banner map from production when local data is sparse
    if (envCtx.isDev && assetBaseUrl && Object.keys(banners).length < 100) {
      try {
        const prodApiBase = assetBaseUrl.replace(/^(https?:\/\/)assets\./, "$1");
        const res = await fetch(`${prodApiBase}/api/asset-sync/ship-banner-map`, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const remote = (await res.json()) as { banners?: Record<string, string> };
          if (remote.banners) {
            for (const [id, key] of Object.entries(remote.banners)) {
              if (!banners[id]) banners[id] = key;
            }
          }
        }
      } catch {
        // Production API unavailable — continue with local data
      }
    }

    const cacheControl = envCtx.isDev
      ? "no-store"
      : "public, max-age=86400, stale-while-revalidate=604800";

    return c.json(
      { base_url: assetBaseUrl, banners },
      200,
      {
        "Cache-Control": cacheControl,
        ...CORS_HEADERS,
      },
    );
  } catch (err) {
    console.error("[asset-sync] ship-banner-map error:", err);
    return c.json({ error: "Failed to build banner map" }, 500);
  }
});

/**
 * GET /ship-card-map - Bulk mapping of ship IDs to R2 keys for card images
 *
 * Returns { base_url, cards: { [shipId]: r2Key } }
 * Card images are full character illustrations (larger than banners).
 */
app.get("/ship-card-map", async (c) => {
  const envCtx = createEnvContext(c);
  const db = envCtx.runtime.ASSET_INDEX_DB;
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;
  const assetBaseUrl = getEnv(envCtx, "ASSET_BASE_URL") || "";

  if (!db && !bucket) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  try {
    const cards: Record<string, string> = {};

    if (db) {
      try {
        const rows = await db
          .prepare("SELECT key FROM files WHERE key LIKE 'assets/kcs2/resources/ship/card/%'")
          .all();
        if (rows.results) {
          for (const row of rows.results as { key: string }[]) {
            const match = row.key.match(/\/card\/(\d{4})_/);
            if (match) {
              const shipId = String(parseInt(match[1], 10));
              if (!cards[shipId]) {
                cards[shipId] = row.key;
              }
            }
          }
        }
      } catch {
        // D1 unavailable
      }
    }

    if (Object.keys(cards).length === 0 && bucket) {
      const listed = await bucket.list({
        prefix: "assets/kcs2/resources/ship/card/",
        limit: 1000,
      });
      for (const obj of listed.objects) {
        const match = obj.key.match(/\/card\/(\d{4})_/);
        if (match) {
          const shipId = String(parseInt(match[1], 10));
          if (!cards[shipId]) {
            cards[shipId] = obj.key;
          }
        }
      }
    }

    // Local dev: fetch from production when local data is sparse
    if (envCtx.isDev && assetBaseUrl && Object.keys(cards).length < 100) {
      try {
        const prodApiBase = assetBaseUrl.replace(/^(https?:\/\/)assets\./, "$1");
        const res = await fetch(`${prodApiBase}/api/asset-sync/ship-card-map`, {
          headers: { "Accept": "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const remote = (await res.json()) as { cards?: Record<string, string> };
          if (remote.cards) {
            for (const [id, key] of Object.entries(remote.cards)) {
              if (!cards[id]) cards[id] = key;
            }
          }
        }
      } catch {
        // Production API unavailable
      }
    }

    const cacheControl = envCtx.isDev
      ? "no-store"
      : "public, max-age=86400, stale-while-revalidate=604800";

    return c.json(
      { base_url: assetBaseUrl, cards },
      200,
      { "Cache-Control": cacheControl, ...CORS_HEADERS },
    );
  } catch (err) {
    console.error("[asset-sync] ship-card-map error:", err);
    return c.json({ error: "Failed to build card map" }, 500);
  }
});

/**
 * GET /equip-image-map - Bulk mapping of equipment IDs to R2 keys
 *
 * Returns { base_url, card: { [equipId]: r2Key }, item_up: { [equipId]: r2Key } }
 * so the client can build CDN URLs for equipment images.
 */
app.get("/equip-image-map", async (c) => {
  const envCtx = createEnvContext(c);
  const db = envCtx.runtime.ASSET_INDEX_DB;
  const assetBaseUrl = getEnv(envCtx, "ASSET_BASE_URL") || "";

  if (!db) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  try {
    const card: Record<string, string> = {};
    const itemUp: Record<string, string> = {};

    const rows = await db
      .prepare(
        "SELECT key FROM files WHERE key LIKE 'assets/kcs2/resources/slot/card/%' OR key LIKE 'assets/kcs2/resources/slot/item_up/%'",
      )
      .all();

    if (rows.results) {
      for (const row of rows.results as { key: string }[]) {
        const match = row.key.match(/\/slot\/(card|item_up)\/(\d{4})_/);
        if (!match) continue;
        const [, type, padded] = match;
        const equipId = String(parseInt(padded, 10));
        const target = type === "card" ? card : itemUp;
        if (!target[equipId]) target[equipId] = row.key;
      }
    }

    const cacheControl = envCtx.isDev
      ? "no-store"
      : "public, max-age=86400, stale-while-revalidate=604800";

    return c.json(
      { base_url: assetBaseUrl, card, item_up: itemUp },
      200,
      { "Cache-Control": cacheControl, ...CORS_HEADERS },
    );
  } catch (err) {
    console.error("[asset-sync] equip-image-map error:", err);
    return c.json({ error: "Failed to build equip image map" }, 500);
  }
});

/**
 * GET /ship-banner/:shipId - Serve ship banner image from R2
 *
 * Looks up the banner image in ASSET_SYNC_BUCKET by ship_id.
 * The R2 key format is: assets/kcs2/resources/ship/banner/{paddedId}_{version}.png
 * Since we don't know the version suffix, we query D1 files table with a prefix match.
 *
 * No authentication required — images are public reference data.
 */
app.get("/ship-banner/:shipId", async (c) => {
  const envCtx = createEnvContext(c);
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;
  const db = envCtx.runtime.ASSET_INDEX_DB;

  if (!bucket) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  const shipIdParam = c.req.param("shipId");
  const shipId = parseInt(shipIdParam, 10);
  if (isNaN(shipId) || shipId < 1 || shipId > 9999) {
    return c.json({ error: "Invalid ship ID" }, 400);
  }

  const paddedId = String(shipId).padStart(4, "0");
  const prefix = `assets/kcs2/resources/ship/banner/${paddedId}_`;

  try {
    // Try D1 lookup first, fall back to R2 list if D1 is unavailable
    let r2Key: string | null = null;

    if (db) {
      try {
        const result = await db
          .prepare("SELECT key FROM files WHERE key LIKE ? LIMIT 1")
          .bind(`${prefix}%`)
          .first() as { key: string } | null;
        if (result) r2Key = result.key;
      } catch {
        // D1 not available (e.g. local dev without seeded asset index)
      }
    }

    // Fallback: R2 list with prefix
    if (!r2Key && bucket) {
      const listed = await bucket.list({ prefix, limit: 1 });
      if (listed.objects.length > 0) {
        r2Key = listed.objects[0].key;
      }
    }

    if (!r2Key) {
      return new Response(null, { status: 404 });
    }

    // Conditional request: check If-None-Match
    const ifNoneMatch = c.req.header("If-None-Match");
    const r2Object = await bucket.get(r2Key, {
      onlyIf: ifNoneMatch ? undefined : undefined,
    });
    if (!r2Object) {
      return new Response(null, { status: 404 });
    }

    const etag = r2Object.httpEtag;
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
      return new Response(null, {
        status: 304,
        headers: { "ETag": etag, ...CORS_HEADERS },
      });
    }

    const body = await r2Object.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "ETag": etag,
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error(`[asset-sync] ship-banner error for ${shipId}:`, err);
    return c.json({ error: "Failed to fetch banner" }, 500);
  }
});

/**
 * GET /weapon-icons - Serve the weapon icon sprite sheet from R2
 *
 * Returns the common_icon_weapon.png sprite image for equipment icons.
 */
app.get("/weapon-icons", async (c) => {
  const envCtx = createEnvContext(c);
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;

  if (!bucket) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  const r2Key = "assets/kcs2/img/common/common_icon_weapon.png";

  try {
    const ifNoneMatch = c.req.header("If-None-Match");
    const r2Object = await bucket.get(r2Key);
    if (!r2Object) {
      return new Response(null, { status: 404 });
    }

    const etag = r2Object.httpEtag;
    if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
      return new Response(null, {
        status: 304,
        headers: { "ETag": etag, ...CORS_HEADERS },
      });
    }

    const body = await r2Object.arrayBuffer();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(body.byteLength),
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=604800",
        "ETag": etag,
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error("[asset-sync] weapon-icons error:", err);
    return c.json({ error: "Failed to fetch weapon icons" }, 500);
  }
});

/**
 * GET /weapon-icon-frames - Return weapon icon sprite frame atlas
 *
 * Serves the TexturePacker atlas JSON for common_icon_weapon.
 * The file stored in R2 is Brotli-compressed; it is served to the browser
 * with Content-Encoding: br so the browser handles decompression natively.
 * If the raw bytes happen to be plain JSON already, they are served as-is.
 */
app.get("/weapon-icon-frames", async (c) => {
  const envCtx = createEnvContext(c);
  const bucket = envCtx.runtime.ASSET_SYNC_BUCKET;
  const assetBaseUrl = getEnv(envCtx, "ASSET_BASE_URL") || "";

  if (!bucket) {
    return c.json({ error: "Asset storage not configured" }, 503);
  }

  try {
    const jsonKey = "assets/kcs2/img/common/common_icon_weapon.json";
    let atlasRaw: ArrayBuffer | null = null;

    const r2Object = await bucket.get(jsonKey);
    if (r2Object) {
      atlasRaw = await r2Object.arrayBuffer();
    } else if (assetBaseUrl) {
      // Local R2 may not have the file — fetch from CDN instead
      const cdnRes = await fetch(`${assetBaseUrl}/${jsonKey}`);
      if (cdnRes.ok) atlasRaw = await cdnRes.arrayBuffer();
    }

    if (!atlasRaw) {
      return c.json({ error: "Sprite atlas not found" }, 404);
    }

    const cacheControl = envCtx.isDev
      ? "no-store"
      : "public, max-age=86400, stale-while-revalidate=604800";

    // Detect whether the bytes are Brotli-compressed or plain JSON.
    // Brotli streams never start with '{' (0x7B); they start with a
    // window-size nibble (high bits set). Plain JSON starts with '{'.
    const firstByte = new Uint8Array(atlasRaw)[0];
    const isBrotli = firstByte !== 0x7b; // 0x7b = '{'

    if (isBrotli) {
      // Return raw Brotli bytes — browser decompresses via Content-Encoding: br
      return new Response(atlasRaw, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "br",
          "Cache-Control": cacheControl,
          ...CORS_HEADERS,
        },
      });
    }

    // Already plain JSON — return as-is
    return new Response(atlasRaw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": cacheControl,
        ...CORS_HEADERS,
      },
    });
  } catch (err) {
    console.error("[asset-sync] weapon-icon-frames error:", String(err), err instanceof Error ? err.stack : "");
    return c.json({ error: "Failed to parse sprite atlas", detail: String(err) }, 500);
  }
});

export default app;
