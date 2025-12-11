import type { APIRoute } from "astro";
import {
  resolveAllowedExtensions,
  violatesAllowList,
  extractExtension,
} from "./blocked-extensions";
import { createSignedToken, verifySignedToken } from "../_utils/signature";
import { SAFE_MIME_BY_EXTENSION, isSafeContentType } from "./mime";
import type { D1Database } from "./types";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MiB hard ceiling until we add chunked uploads
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};
const SIGNED_URL_TTL_SECONDS = 120;

type BucketBinding = {
  head(key: string): Promise<R2ObjectLike | null>;
  put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
    options?: BucketPutOptions
  ): Promise<R2ObjectLike | null>;
  delete?(key: string): Promise<void>;
};

type R2ObjectLike = {
  size: number;
  etag?: string;
};

type BucketPutOptions = {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
  };
  customMetadata?: Record<string, string | undefined>;
};

interface CloudflareEnv {
  ASSET_SYNC_BUCKET?: BucketBinding;
  ASSET_INDEX_DB?: D1Database;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  ASSET_SYNC_SKIP_EXTENSIONS?: string;
  ASSET_SYNC_ALLOWED_EXTENSIONS?: string;
  ASSET_UPLOAD_SIGNING_SECRET?: string;
}

type SignedAssetDescriptor = {
  key: string;
  relative_path: string;
  finder_tag?: string | null;
  declared_size: number;
  content_type: string;
  user_id: string;
  uploader_email?: string | null;
  file_name?: string | null;
};

type SupabaseUser = {
  id: string;
  email?: string;
  aud?: string;
};

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = extractEnv(locals.runtime?.env);
  const bucket = env?.ASSET_SYNC_BUCKET;
  const signingSecret =
    env?.ASSET_UPLOAD_SIGNING_SECRET ||
    import.meta.env.ASSET_UPLOAD_SIGNING_SECRET;
  if (!bucket) {
    return errorResponse(
      "Asset sync bucket is not configured. Bind ASSET_SYNC_BUCKET in Cloudflare.",
      503
    );
  }
  const db = env?.ASSET_INDEX_DB;
  if (!db) {
    return errorResponse(
      "ASSET_INDEX_DB is required for D1-only mode. Bind ASSET_INDEX_DB.",
      503
    );
  }
  if (!signingSecret) {
    return errorResponse("Asset upload signing secret is not configured", 500);
  }

  const allowedExtensions = resolveAllowedExtensions(
    env?.ASSET_SYNC_ALLOWED_EXTENSIONS,
    import.meta.env.ASSET_SYNC_ALLOWED_EXTENSIONS
  );

  const url = new URL(request.url);
  if (!url.searchParams.has("token")) {
    return handleSignedUploadRequest(
      request,
      bucket,
      env,
      allowedExtensions,
      signingSecret,
      url
    );
  }
  return handleSignedUploadExecution(
    request,
    locals,
    bucket,
    env,
    allowedExtensions,
    signingSecret,
    url
  );
};

async function handleSignedUploadRequest(
  request: Request,
  bucket: BucketBinding,
  env: CloudflareEnv | undefined,
  allowedExtensions: Set<string>,
  signingSecret: string,
  url: URL
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse("Signed upload requests must be JSON", 415);
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return errorResponse("Missing Authorization bearer token", 401);
  }
  const supabaseUser = await validateSupabase(accessToken, env);
  if (!supabaseUser) {
    return errorResponse("Invalid Supabase session", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const bodyObj = body as Record<string, unknown>;

  const key = sanitizeKey(typeof bodyObj.key === "string" ? bodyObj.key : null);
  if (!key) {
    return errorResponse("Invalid or empty key", 400);
  }

  const relativePath = sanitizeKey(
    typeof bodyObj.relative_path === "string" ? bodyObj.relative_path : null
  );
  if (!relativePath) {
    return errorResponse("Invalid relative_path", 400);
  }

  const finderTag =
    typeof bodyObj.finder_tag === "string" ? bodyObj.finder_tag : undefined;
  const declaredSize = parseSize(
    typeof bodyObj.file_size === "string" ? bodyObj.file_size : undefined
  );
  if (!declaredSize || declaredSize <= 0) {
    return errorResponse("file_size must be greater than zero", 400);
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return errorResponse("Declared payload exceeds allowed size", 413);
  }

  const fileName = sanitizeFileName(
    typeof bodyObj.file_name === "string" ? bodyObj.file_name : null
  );

  const candidateNames = [fileName, key, relativePath];
  if (violatesAllowList(candidateNames, allowedExtensions)) {
    return errorResponse("This file type is not allowed for upload", 415);
  }

  if (await bucket.head(key)) {
    return errorResponse("Asset already exists", 409);
  }

  const descriptor: SignedAssetDescriptor = {
    key,
    relative_path: relativePath,
    finder_tag: finderTag ?? null,
    declared_size: declaredSize,
    content_type:
      typeof bodyObj.content_type === "string" &&
      bodyObj.content_type.trim().length > 0
        ? (bodyObj.content_type as string)
        : "application/octet-stream",
    user_id: supabaseUser.id,
    uploader_email: supabaseUser.email ?? null,
    file_name: fileName,
  };

  const token = await createSignedToken(
    descriptor,
    signingSecret,
    SIGNED_URL_TTL_SECONDS
  );
  const signedUrl = new URL(url.toString());
  signedUrl.searchParams.set("token", token.token);
  signedUrl.searchParams.set("expires", String(token.expires));
  signedUrl.searchParams.set("signature", token.signature);

  return jsonResponse({
    uploadUrl: signedUrl.toString(),
    expiresAt: new Date(token.expires * 1000).toISOString(),
    fields: {
      key,
      relative_path: relativePath,
      finder_tag: finderTag,
      declared_size: declaredSize,
      file_name: fileName,
    },
  });
}

async function handleSignedUploadExecution(
  request: Request,
  locals: App.Locals,
  bucket: BucketBinding,
  env: CloudflareEnv | undefined,
  allowedExtensions: Set<string>,
  signingSecret: string,
  url: URL
): Promise<Response> {
  const db = env?.ASSET_INDEX_DB;
  if (!db) {
    return errorResponse(
      "ASSET_INDEX_DB is required for D1-only mode. Bind ASSET_INDEX_DB.",
      503
    );
  }
  const descriptor = await verifySignedToken<SignedAssetDescriptor>(
    url.searchParams.get("token"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    signingSecret
  );
  if (!descriptor) {
    return errorResponse("Invalid or expired upload token", 403);
  }

  const authHeader = request.headers.get("authorization");
  const accessToken = extractBearer(authHeader);
  if (!accessToken) {
    return errorResponse("Missing Authorization bearer token", 401);
  }
  const supabaseUser = await validateSupabase(accessToken, env);
  if (!supabaseUser || supabaseUser.id !== descriptor.user_id) {
    return errorResponse("Supabase user mismatch for this upload", 403);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    return errorResponse("Multipart uploads are no longer accepted", 415);
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const parsed = Number(contentLengthHeader);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return errorResponse("Invalid content-length header", 400);
    }
    if (parsed > MAX_UPLOAD_BYTES) {
      return errorResponse("Uploaded file exceeds allowed size", 413);
    }
  }

  const candidateNames = [
    descriptor.file_name,
    descriptor.key,
    descriptor.relative_path,
  ];
  if (violatesAllowList(candidateNames, allowedExtensions)) {
    return errorResponse("This file type is not allowed for upload", 415);
  }

  if (await bucket.head(descriptor.key)) {
    return errorResponse("Asset already exists", 409);
  }

  const bodyStream = request.body;
  if (!bodyStream) {
    return errorResponse("Upload payload is missing", 400);
  }

  // Extract content-length for R2 (required for FixedLengthStream compatibility)
  // const contentLength = contentLengthHeader
  //   ? Number(contentLengthHeader)
  //   : descriptor.declared_size;

  // R2 requires known-length streams; use FixedLengthStream if available
  // For Cloudflare Workers, request.body already has length info from content-length
  let uploadBody: ReadableStream | Uint8Array = bodyStream;

  // If no content-length and we have declared_size as fallback,
  // buffer the entire body to get actual length
  if (!contentLengthHeader && descriptor.declared_size) {
    try {
      const chunks: Uint8Array[] = [];
      const reader = bodyStream.getReader();
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          totalBytes += value.byteLength;
          if (totalBytes > MAX_UPLOAD_BYTES) {
            return errorResponse("Upload exceeds maximum allowed size", 413);
          }
        }
      }

      // Concatenate all chunks into single buffer
      const buffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      uploadBody = buffer;
    } catch (err) {
      console.error("Failed to buffer upload body", err);
      return errorResponse("Failed to process upload stream", 400);
    }
  }

  // If neither contentLengthHeader nor descriptor.declared_size is present, fail early
  if (!contentLengthHeader && !descriptor.declared_size) {
    return errorResponse(
      "Missing content length: either Content-Length header or declared_size is required for upload",
      411
    );
  }

  let storedSize = 0;
  try {
    const result = await bucket.put(descriptor.key, uploadBody, {
      httpMetadata: {
        contentType: deriveContentType(descriptor),
        cacheControl: CACHE_CONTROL,
      },
      customMetadata: {
        relative_path: descriptor.relative_path,
        finder_tag: descriptor.finder_tag ?? undefined,
        uploaded_by: descriptor.user_id,
        declared_size: descriptor.declared_size.toString(),
        file_name: descriptor.file_name ?? undefined,
        uploader_email: descriptor.uploader_email ?? undefined,
      },
    });

    // result.size is reliable when provided by R2 binding
    // If it's missing (mock env?), fallback to declared_size or throw
    if (result && typeof result.size === "number") {
      storedSize = result.size;
    } else {
      // Fallback for environments where put() returns null or missing size (rare but safe to handle)
      // We can't trust body stream length after consumption without counting,
      // but we can trust the declared_size if we assume the upload succeeded.
      storedSize = descriptor.declared_size;
    }
  } catch (error) {
    console.error("Failed to store asset payload", error);
    return errorResponse("Failed to store payload in R2", 502);
  }

  if (
    descriptor.declared_size &&
    Math.abs(descriptor.declared_size - storedSize) > 1024
  ) {
    console.warn(
      `Asset sync size mismatch for ${descriptor.key}: declared ${descriptor.declared_size} but received ${storedSize}`
    );
  }

  // Insert metadata into D1 (required in D1-only mode). If insert fails, roll back the R2 object.
  try {
    const uploadedAt = Date.now();
    const size = storedSize;
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) VALUES (?, ?, ?, ?, ?, ?, ?);`
    );
    const result = await stmt
      .bind(
        descriptor.key,
        size,
        uploadedAt,
        deriveContentType(descriptor),
        descriptor.user_id,
        descriptor.finder_tag ?? null,
        JSON.stringify({
          file_name: descriptor.file_name ?? null,
          declared_size: descriptor.declared_size,
        })
      )
      .run();

    // Check if D1 operation succeeded
    if (
      result &&
      typeof result === "object" &&
      "success" in result &&
      !result.success
    ) {
      const errorMsg =
        "error" in result ? String(result.error) : "Unknown D1 error";
      throw new Error(`D1 INSERT failed: ${errorMsg}`);
    }

    // Purge the cache for the keys endpoint
    try {
      const purgeUrl = new URL(url);
      purgeUrl.pathname = "/api/asset-sync/keys";
      purgeUrl.search = "";
      const purgeRequest = new Request(purgeUrl.toString(), {
        method: "GET",
      });

      const cache = await caches.open("asset-sync-cache");
      locals.runtime?.waitUntil(cache.delete(purgeRequest));
    } catch (cacheErr) {
      // Log cache purge failure but don't fail the upload
      console.warn("Failed to purge asset-sync cache:", cacheErr);
    }
  } catch (e) {
    console.error("D1 insert failed for", descriptor.key, e);
    console.error(
      "Descriptor details:",
      JSON.stringify({
        key: descriptor.key,
        user_id: descriptor.user_id,
        finder_tag: descriptor.finder_tag,
        declared_size: descriptor.declared_size,
        file_name: descriptor.file_name,
      })
    );
    // Attempt to delete the uploaded R2 object to avoid orphaned blobs
    try {
      if (typeof bucket.delete === "function") {
        await bucket.delete(descriptor.key);
      } else {
        console.warn(
          "Bucket delete not available to roll back",
          descriptor.key
        );
      }
    } catch (delErr) {
      console.error(
        "Failed to delete R2 object after D1 insert failure",
        delErr
      );
    }
    return errorResponse("Failed to write asset metadata to D1", 500);
  }

  return jsonResponse({ key: descriptor.key, size: storedSize });
}

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

function sanitizeKey(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return null;
  }
  return normalized;
}

function parseSize(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

async function validateSupabase(
  token: string,
  env: CloudflareEnv | undefined
): Promise<SupabaseUser | null> {
  const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
  if (!supabaseUrl) {
    console.error("PUBLIC_SUPABASE_URL is not configured");
    return null;
  }

  const apikey =
    env?.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!apikey) {
    console.error("PUBLIC_SUPABASE_ANON_KEY is not configured");
    return null;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    console.warn(`Supabase validation failed with status ${response.status}`);
    return null;
  }

  return (await response.json()) as SupabaseUser;
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

function sanitizeFileName(input: string | null): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const candidate = parts[parts.length - 1]?.trim();
  if (!candidate) {
    return null;
  }
  return candidate.replace(/[\0-\x1F]/g, "");
}

function deriveContentType(descriptor: SignedAssetDescriptor): string {
  const ext =
    extractExtension(descriptor.file_name ?? undefined) ??
    extractExtension(descriptor.key);
  if (ext && SAFE_MIME_BY_EXTENSION[ext]) {
    return SAFE_MIME_BY_EXTENSION[ext];
  }
  if (isSafeContentType(descriptor.content_type)) {
    return descriptor.content_type;
  }
  return "application/octet-stream";
}
