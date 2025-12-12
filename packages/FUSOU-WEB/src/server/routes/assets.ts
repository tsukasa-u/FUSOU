import { Hono } from "hono";
import type { Bindings, BucketBinding, D1Database } from "../types";
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
} from "../utils";

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
);

// POST /upload
app.post("/upload", async (c) => {
  const bucket = c.env.ASSET_SYNC_BUCKET;
  const db = c.env.ASSET_INDEX_DB;
  const signingSecret =
    c.env.ASSET_UPLOAD_SIGNING_SECRET ||
    import.meta.env.ASSET_UPLOAD_SIGNING_SECRET;

  if (!bucket || !db || !signingSecret) {
    return c.json({ error: "Asset sync bucket not configured" }, 503);
  }

  const allowedExtensions = resolveAllowedExtensions(
    c.env.ASSET_SYNC_ALLOWED_EXTENSIONS,
    import.meta.env.ASSET_SYNC_ALLOWED_EXTENSIONS
  );

  const url = new URL(c.req.url);
  const request = c.req.raw;

  if (!url.searchParams.has("token")) {
    return await handleSignedUploadRequest(
      c,
      request,
      bucket,
      db,
      allowedExtensions,
      signingSecret,
      url
    );
  }

  return await handleSignedUploadExecution(
    c,
    request,
    bucket,
    db,
    allowedExtensions,
    signingSecret,
    url
  );
});

// GET /keys
app.get("/keys", async (c) => {
  // Require valid Supabase access token
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  const db = c.env.ASSET_INDEX_DB;

  if (!db) {
    return c.json({ error: "ASSET_INDEX_DB is not configured" }, 503);
  }

  try {
    const keys: string[] = [];
    let cursor = 0;
    const BATCH_SIZE = 1000;

    while (true) {
      const stmt = db
        .prepare(
          "SELECT key FROM files ORDER BY uploaded_at DESC LIMIT ? OFFSET ?"
        )
        .bind(BATCH_SIZE, cursor);

      const res = await stmt.all?.();
      const batch = (res?.results || [])
        .map((r) =>
          typeof (r as any).key === "string" ? (r as any).key : undefined
        )
        .filter(Boolean) as string[];

      if (batch.length === 0) break;
      keys.push(...batch);
      cursor += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }

    const refreshedAt = Date.now();
    const expiresAt = refreshedAt + CACHE_TTL_SECONDS * 1000;

    return c.json({
      keys,
      total: keys.length,
      refreshedAt: new Date(refreshedAt).toISOString(),
      cacheExpiresAt: new Date(expiresAt).toISOString(),
      cached: false,
    });
  } catch (e) {
    return c.json({ error: "Failed to list assets" }, 502);
  }
});

// GET /mime
app.get("/mime", async (c) => {
  return c.json(SAFE_MIME_BY_EXTENSION);
});

// ------------------------
// Handlers
// ------------------------

async function handleSignedUploadRequest(
  c: any,
  request: Request,
  bucket: BucketBinding,
  db: D1Database,
  allowedExtensions: Set<string>,
  signingSecret: string,
  url: URL
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return c.json({ error: "Signed upload requests must be JSON" }, 415);
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const bodyObj = body as Record<string, unknown>;
  const key = sanitizeKey(typeof bodyObj.key === "string" ? bodyObj.key : null);
  if (!key) {
    return c.json({ error: "Invalid or empty key" }, 400);
  }

  const relativePath = sanitizeKey(
    typeof bodyObj.relative_path === "string" ? bodyObj.relative_path : null
  );
  if (!relativePath) {
    return c.json({ error: "Invalid relative_path" }, 400);
  }

  const declaredSize = parseSize(
    typeof bodyObj.file_size === "string" ? bodyObj.file_size : undefined
  );
  if (!declaredSize || declaredSize <= 0 || declaredSize > MAX_UPLOAD_BYTES) {
    return c.json({ error: "Invalid file size" }, 400);
  }

  const fileName = sanitizeFileName(
    typeof bodyObj.file_name === "string" ? bodyObj.file_name : null
  );
  const candidateNames = [fileName, key, relativePath];

  if (violatesAllowList(candidateNames, allowedExtensions)) {
    return c.json({ error: "This file type is not allowed for upload" }, 415);
  }

  if (await bucket.head(key)) {
    return c.json({ error: "Asset already exists" }, 409);
  }

  return c.json({
    uploadUrl: url.toString(),
    expiresAt: new Date(
      Date.now() + SIGNED_URL_TTL_SECONDS * 1000
    ).toISOString(),
    fields: {
      key,
      relative_path: relativePath,
      declared_size: declaredSize,
      file_name: fileName,
    },
  });
}

async function handleSignedUploadExecution(
  c: any,
  request: Request,
  bucket: BucketBinding,
  db: D1Database,
  allowedExtensions: Set<string>,
  signingSecret: string,
  url: URL
): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const accessToken = extractBearer(authHeader);

  if (!accessToken) {
    return c.json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUser = await validateJWT(accessToken);
  if (!supabaseUser) {
    return c.json({ error: "Invalid or expired JWT token" }, 401);
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsed = Number(contentLength);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > MAX_UPLOAD_BYTES) {
      return c.json({ error: "Uploaded file exceeds allowed size" }, 413);
    }
  }

  const bodyStream = request.body;
  if (!bodyStream) {
    return c.json({ error: "Upload payload is missing" }, 400);
  }

  try {
    const key = `uploads/${supabaseUser.id}/${Date.now()}`;
    const result = await bucket.put(key, bodyStream, {
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: CACHE_CONTROL,
      },
      customMetadata: { uploaded_by: supabaseUser.id },
    });

    const storedSize = result?.size || 0;

    const uploadedAt = Date.now();
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    await stmt
      .bind(
        key,
        storedSize,
        uploadedAt,
        "application/octet-stream",
        supabaseUser.id,
        null,
        JSON.stringify({ synced_at: uploadedAt })
      )
      .run();

    return c.json({ key, size: storedSize });
  } catch (error) {
    console.error("Upload failed:", error);
    return c.json({ error: "Failed to process upload" }, 500);
  }
}

export default app;
