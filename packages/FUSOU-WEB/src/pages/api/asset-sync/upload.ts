import type { APIRoute } from "astro";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MiB hard ceiling until we add chunked uploads
const CACHE_CONTROL = "public, max-age=31536000, immutable";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};

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
    options?: BucketPutOptions,
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
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

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

  if (!bucket) {
    return errorResponse(
      "Asset sync bucket is not configured. Bind ASSET_SYNC_BUCKET in Cloudflare.",
      503,
    );
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

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return errorResponse("Unsupported media type", 415);
  }

  const form = await request.formData();
  const rawKey = readFormValue(form, "key");
  const rawRelativePath = readFormValue(form, "relative_path");
  const finderTag = readOptionalFormValue(form, "finder_tag");
  const fileSizeField = readOptionalFormValue(form, "file_size");
  const file = form.get("file");

  if (!(file instanceof File)) {
    return errorResponse("Multipart payload must include a file field", 400);
  }

  const key = sanitizeKey(rawKey);
  if (!key) {
    return errorResponse("Invalid or empty key", 400);
  }

  const relativePath = sanitizeKey(rawRelativePath);
  if (!relativePath) {
    return errorResponse("Invalid relative_path", 400);
  }

  const declaredSize = parseSize(fileSizeField);
  if (declaredSize && declaredSize <= 0) {
    return errorResponse("file_size must be greater than zero", 400);
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse("Uploaded file exceeds allowed size", 413);
  }

  if (declaredSize && Math.abs(declaredSize - file.size) > 1024) {
    console.warn(
      `Asset sync size mismatch for ${key}: declared ${declaredSize} but received ${file.size}`,
    );
  }

  if (await bucket.head(key)) {
    return errorResponse("Asset already exists", 409);
  }

  await bucket.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      cacheControl: CACHE_CONTROL,
    },
    customMetadata: {
      relative_path: relativePath,
      finder_tag: finderTag,
      uploaded_by: supabaseUser.id,
      declared_size: declaredSize?.toString() ?? file.size.toString(),
      file_name: file.name,
      uploader_email: supabaseUser.email,
    },
  });

  return jsonResponse({ key, size: file.size });
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

function readFormValue(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function readOptionalFormValue(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
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
  env: CloudflareEnv | undefined,
): Promise<SupabaseUser | null> {
  const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl) {
    console.error("PUBLIC_SUPABASE_URL is not configured");
    return null;
  }

  const apikey =
    env?.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!apikey) {
    console.error("No Supabase API key available for validation");
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
