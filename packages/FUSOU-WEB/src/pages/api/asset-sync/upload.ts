import type { APIRoute } from "astro";
import {
  resolveAllowedExtensions,
  violatesAllowList,
  extractExtension,
} from "./blocked-extensions";
import { createSignedToken, verifySignedToken } from "../_utils/signature";
import { SAFE_MIME_BY_EXTENSION, isSafeContentType } from "./mime";

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
  ASSET_INDEX_DB?: any;
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

  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const key = sanitizeKey(typeof body.key === "string" ? body.key : null);
  if (!key) {
    return errorResponse("Invalid or empty key", 400);
  }

  const relativePath = sanitizeKey(
    typeof body.relative_path === "string" ? body.relative_path : null
  );
  if (!relativePath) {
    return errorResponse("Invalid relative_path", 400);
  }

  const finderTag =
    typeof body.finder_tag === "string" ? body.finder_tag : undefined;
  const declaredSize = parseSize(
    typeof body.file_size === "string" ? body.file_size : undefined
  );
  if (!declaredSize || declaredSize <= 0) {
    return errorResponse("file_size must be greater than zero", 400);
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return errorResponse("Declared payload exceeds allowed size", 413);
  }

  const fileName = sanitizeFileName(
    typeof body.file_name === "string" ? body.file_name : null
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
      typeof body.content_type === "string" &&
      body.content_type.trim().length > 0
        ? body.content_type
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

  let bodyBuffer: ArrayBuffer;
  try {
    bodyBuffer = await request.arrayBuffer();
  } catch {
    return errorResponse("Failed to read upload body", 400);
  }

  if (bodyBuffer.byteLength > MAX_UPLOAD_BYTES) {
    return errorResponse("Uploaded file exceeds allowed size", 413);
  }

  let storedSize = 0;
  try {
    const result = await bucket.put(descriptor.key, bodyBuffer, {
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
    storedSize = result?.size ?? bodyBuffer.byteLength;
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
    await stmt
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
  } catch (e) {
    console.error("D1 insert failed for", descriptor.key, e);
    // Attempt to delete the uploaded R2 object to avoid orphaned blobs
    try {
      await (bucket as any).delete(descriptor.key);
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
