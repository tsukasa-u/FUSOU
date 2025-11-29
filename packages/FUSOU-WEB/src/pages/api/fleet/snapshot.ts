import type { APIRoute } from "astro";
import {
  createSignedToken,
  verifySignedToken,
} from "../_utils/signature";
import {
  readJsonBody,
  handleJsonReadError,
  CORS_HEADERS,
} from "../_utils/http";

// 環境変数の型定義
type CloudflareEnv = {
  ASSET_PAYLOAD_BUCKET?: R2BucketBinding;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAX_SNAPSHOT_BYTES?: string | number;
  FLEET_SNAPSHOT_SIGNING_SECRET?: string;
  PUBLIC_SUPABASE_ANON_KEY?: string;
  // Optional: disable retention behavior by setting to 'false'
  SNAPSHOT_RETENTION_ENABLED?: string | boolean;
};

// R2の型定義（簡易版）
type R2BucketBinding = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string,
    options?: { httpMetadata?: Record<string, string> }
  ): Promise<any>;
};

export const prerender = false;

// 定数
const MAX_BODY_SIZE = 2 * 1024 * 1024; // 修正2: 入力JSONの上限 (2MB)
const SNAPSHOT_TOKEN_TTL_SECONDS = 300;

type SnapshotDescriptor = {
  owner_id: string;
  tag: string;
  title?: string | null;
  version?: number | null;
  is_public?: boolean;
};

// 保持ポリシー
// By default, when a new snapshot is uploaded the system will attempt to keep
// only the newest snapshot for each tag (owner_id + tag) by removing older
// objects in R2. This behavior can be disabled by setting
// `SNAPSHOT_RETENTION_ENABLED=false` in your Pages/Cloudflare env.

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals?.runtime?.env as unknown as CloudflareEnv | undefined;

  const bucket = env?.ASSET_PAYLOAD_BUCKET;
  const supabaseUrl = env?.PUBLIC_SUPABASE_URL;
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  const signingSecret =
    env?.FLEET_SNAPSHOT_SIGNING_SECRET ||
    import.meta.env.FLEET_SNAPSHOT_SIGNING_SECRET;

  if (!bucket || !supabaseUrl || !supabaseKey) {
    console.error("Missing environment variables");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  if (!signingSecret) {
    console.error("Snapshot signing secret is not configured");
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const url = new URL(request.url);
  if (!url.searchParams.has("token")) {
    return handleSnapshotPreparation(
      request,
      url,
      supabaseUrl,
      signingSecret,
      locals,
    );
  }

  return handleSnapshotUpload(
    request,
    env,
    url,
    bucket as R2BucketBinding,
    supabaseUrl as string,
    supabaseKey as string,
    signingSecret as string,
    locals,
  );
}

// Keep only the single latest snapshot per owner/tag in R2.
// Uses the key format `fleets/{owner}/{encodedTag}/{version}-{hash}.json.gz`.
async function cleanupLatestOnly(
  bucket: any,
  ownerId: string,
  tag: string,
  currentKey: string,
) {
  if (!bucket || typeof bucket.list !== "function") return;

  const prefix = `fleets/${ownerId}/${encodeURIComponent(tag)}/`;
  console.info(`cleanupLatestOnly: invoked for owner=${ownerId}, tag=${tag}, prefix=${prefix}`);
  
  try {
    console.debug(`cleanupLatestOnly: bucket.list type=${typeof bucket.list}, bucket.delete type=${typeof bucket.delete}`);
  } catch (e) {
    console.warn("cleanupLatestOnly: cannot inspect bucket methods", e);
  }
  const objs: Array<{ key: string; size?: number; uploaded?: string }> = [];
  let cursor: string | undefined = undefined;
  do {
    const res = await bucket.list({ prefix, cursor, limit: 1000 });
    if (res?.objects?.length) {
      objs.push(...res.objects.map((o: any) => {
        // R2 bindings sometimes name the field `key` or `name` depending on runtime
        const key = o.key ?? o.name ?? o.Key ?? o.Name ?? o['Key'] ?? o['key'];
        return { key, size: o.size, uploaded: o.uploaded };
      }));
    }
    cursor = res?.truncated ? res?.cursor : undefined;
  } while (cursor);
  console.info(`cleanupLatestOnly: found ${objs.length} object(s) under ${prefix}`);
  if (objs.length > 0) {
    console.debug(`cleanupLatestOnly: sample keys: ${objs.slice(0, 10).map(o => o.key).join(', ')}`);
  }

  if (!objs.length) return;

  // Parse versions from key's last segment. If none parse, skip.
  const parsed = objs
    .map((o) => {
      const parts = o.key.split("/");
      const last = parts[parts.length - 1] || "";
      const m = last.match(/^(\d+)-([0-9a-f]+)\.json\.gz$/i);
      const version = m ? Number(m[1]) : null;
      const uploadedTs = o.uploaded ? new Date(o.uploaded).getTime() : 0;
      return { key: o.key, version, uploadedTs };
    })
    .filter((p) => p.version !== null);

  if (!parsed.length) {
    console.info(`cleanupLatestOnly: found ${objs.length} object(s) but could not parse versions under prefix ${prefix}; falling back to uploaded timestamp`);
    // fallback: sort by uploaded timestamp when version parsing failed
    const fallback = objs
      .map((o) => ({ key: o.key, uploadedTs: o.uploaded ? new Date(o.uploaded).getTime() : 0 }))
      .sort((a, b) => b.uploadedTs - a.uploadedTs);
    const toKeepFb = fallback[0]?.key;
    if (!toKeepFb) return;
    const toDeleteFb = fallback.slice(1).map((p) => p.key);
    console.info(`cleanupLatestOnly-fallback: keep=${toKeepFb}, delete_count=${toDeleteFb.length}`);
    for (const k of toDeleteFb) {
      try {
        if (typeof bucket.delete === "function") {
          console.debug(`cleanupLatestOnly-fallback: deleting key=${k}`);
          await bucket.delete(k);
          console.info(`cleanupLatestOnly-fallback: deleted key=${k}`);
        } else {
          console.warn("cleanupLatestOnly: bucket.delete is not a function; cannot delete.");
        }
      } catch (e) {
        console.warn("Failed to delete old snapshot key (fallback)", k, e);
      }
    }
    return;
  }

  // Sort descending by version (newest first), then by uploaded timestamp as tiebreaker.
  parsed.sort((a: any, b: any) => b.version - a.version || b.uploadedTs - a.uploadedTs);

  const toKeep = parsed[0]?.key;
  if (!toKeep) return;

  // If the latest is not the one we just uploaded, it may mean another upload happened concurrently.
  // We prefer to keep the absolute newest as determined by version.
  const toDelete = parsed.filter((p) => p.key !== toKeep).map((p) => p.key);
  console.info(`cleanupLatestOnly: prefix=${prefix}, keep=${toKeep}, delete_count=${toDelete.length}`);
  for (const k of toDelete) {
    try {
      if (typeof bucket.delete === "function") {
        console.debug(`cleanupLatestOnly: deleting key=${k}`);
        await bucket.delete(k);
        console.info(`cleanupLatestOnly: deleted key=${k}`);
      } else {
        console.warn("cleanupLatestOnly: bucket.delete is not a function; cannot delete.");
      }
    } catch (e) {
      console.warn("Failed to delete old snapshot key", k, e);
    }
  }
}

async function handleSnapshotUpload(
  request: Request,
  env: CloudflareEnv | undefined,
  url: URL,
  bucket: R2BucketBinding,
  supabaseUrl: string,
  supabaseKey: string,
  signingSecret: string,
  locals: any,
): Promise<Response> {
  const descriptor = await verifySignedToken<SnapshotDescriptor>(
    url.searchParams.get("token"),
    url.searchParams.get("expires"),
    url.searchParams.get("signature"),
    signingSecret,
  );

  let cleanupQueued = false;

  if (!descriptor?.owner_id || !descriptor.tag) {
    return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const auth = await resolveSupabaseUser(request, supabaseUrl, locals);
  if (!auth || auth.userId !== descriptor.owner_id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: "Request payload too large" }), {
      status: 413,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await readJsonBody(request, MAX_BODY_SIZE);
  } catch (err) {
    return handleJsonReadError(err);
  }

  const payload = body?.payload;
  if (!payload) {
    return new Response(JSON.stringify({ error: "payload is required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const text = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  let compressed: Uint8Array;
  try {
    const cs = new CompressionStream("gzip");
    const stream = new Response(data).body!.pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    compressed = new Uint8Array(buf);
  } catch {
    return new Response(JSON.stringify({ error: "Compression failed" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const maxStoredBytes = Number(env?.MAX_SNAPSHOT_BYTES ?? 2_500_000);
  if (compressed.byteLength > maxStoredBytes) {
    return new Response(
      JSON.stringify({
        error: "Compressed payload too large",
        size: compressed.byteLength,
      }),
      {
        status: 413,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      },
    );
  }

  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(compressed).buffer,
  );
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const version =
    descriptor.version ??
    (Number.isFinite(Number(body?.version))
      ? Number(body.version)
      : Date.now());
  const title =
    descriptor.title ??
    (typeof body?.title === "string" ? body.title.slice(0, 128) : null);
  const isPublic =
    typeof descriptor.is_public === "boolean"
      ? descriptor.is_public
      : Boolean(body?.is_public);

  const ownerId = descriptor.owner_id;
  const key = `fleets/${ownerId}/${encodeURIComponent(descriptor.tag)}/${version}-${hashHex}.json.gz`;

  try {
    await bucket.put(key, compressed, {
      httpMetadata: {
        contentType: "application/json",
        contentEncoding: "gzip",
      },
    });
    console.info(`handleSnapshotUpload: R2 put complete for key=${key} size=${compressed.byteLength}`);
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Failed to store payload in R2",
        detail: String(err),
      }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      },
    );
  }

  const meta = {
    owner_id: ownerId,
    tag: descriptor.tag,
    title: title || null,
    r2_key: key,
    size_bytes: compressed.byteLength,
    version,
    is_public: !!isPublic,
    updated_at: new Date().toISOString(),
  };

  try {
    let resp = await fetch(`${supabaseUrl}/rest/v1/fleets`, {
      method: "POST",
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(meta),
    });

    if (!resp.ok) {
      const text = (await resp.text()) || "";
      // if column 'size_bytes' is missing in DB schema cache, retry without it
      if (text.includes("Could not find the 'size_bytes' column")) {
        const sanitizedMeta: any = { ...meta };
        delete sanitizedMeta.size_bytes;
        try {
          resp = await fetch(`${supabaseUrl}/rest/v1/fleets`, {
            method: "POST",
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=merge-duplicates",
            },
            body: JSON.stringify(sanitizedMeta),
          });
        } catch (e) {
          // ignore and let the subsequent error check handle it
        }
      }
      if (!resp.ok) {
        const text2 = (await resp.text()) || "";
        return new Response(
          JSON.stringify({ error: "Failed to upsert metadata", detail: text2 }),
          {
            status: 502,
            headers: { ...CORS_HEADERS, "content-type": "application/json" },
          },
        );
      }
    }
    // Best-effort: keep only the newest snapshot per owner/tag on R2
    // Controlled by SNAPSHOT_RETENTION_ENABLED environment variable (default enabled)
    const retentionEnabled = String(env?.SNAPSHOT_RETENTION_ENABLED ?? "true") !== "false";
    console.info(`handleSnapshotUpload: retentionEnabled=${retentionEnabled}, owner=${ownerId}, tag=${descriptor.tag}, key=${key}`);
    if (retentionEnabled) {
      // Do not block upload: run in background and ignore errors
      cleanupQueued = true;
      void (async () => {
        try {
          await cleanupLatestOnly(bucket as any, ownerId, descriptor.tag, key);
        } catch (e) {
          console.warn("cleanupLatestOnly failed", e);
        }
      })();
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Supabase upsert failed", detail: String(err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      },
    );
  }

  const responseHeaders: Record<string, string> = { ...CORS_HEADERS, "content-type": "application/json", "X-Retention-Cleanup-Queued": cleanupQueued ? "1" : "0" };
  return new Response(
    JSON.stringify({
      ok: true,
      owner_id: ownerId,
      tag: descriptor.tag,
      version,
      r2_key: key,
    }),
    {
      status: 200,
      headers: responseHeaders,
    },
  );
}

async function handleSnapshotPreparation(
  request: Request,
  url: URL,
  supabaseUrl: string,
  signingSecret: string,
  locals: any,
): Promise<Response> {
  const auth = await resolveSupabaseUser(request, supabaseUrl, locals);
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_SIZE) {
    return new Response(JSON.stringify({ error: "Request payload too large" }), {
      status: 413,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await readJsonBody(request, MAX_BODY_SIZE);
  } catch (err) {
    return handleJsonReadError(err);
  }

  const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
  if (!tag) {
    return new Response(JSON.stringify({ error: "tag is required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const title =
    typeof body?.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, 128)
      : null;
  const requestedVersion = Number(body?.version);
  const descriptor: SnapshotDescriptor = {
    owner_id: auth.userId,
    tag,
    title,
    version: Number.isFinite(requestedVersion) ? requestedVersion : null,
    is_public: Boolean(body?.is_public),
  };

  const signedToken = await createSignedToken(
    descriptor,
    signingSecret,
    SNAPSHOT_TOKEN_TTL_SECONDS,
  );

  const signedUrl = new URL(url.toString());
  signedUrl.searchParams.set("token", signedToken.token);
  signedUrl.searchParams.set("expires", String(signedToken.expires));
  signedUrl.searchParams.set("signature", signedToken.signature);

  return new Response(
    JSON.stringify({
      uploadUrl: signedUrl.toString(),
      expiresAt: new Date(signedToken.expires * 1000).toISOString(),
      maxBodyBytes: MAX_BODY_SIZE,
      fields: {
        tag,
        title,
        version: descriptor.version,
        is_public: descriptor.is_public,
      },
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    },
  );
}

async function resolveSupabaseUser(
  request: Request,
  supabaseUrl: string,
  locals: any,
): Promise<{ token: string; userId: string } | null> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return null;
  }

  const anonKey = (locals.runtime?.env as any)?.PUBLIC_SUPABASE_ANON_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) {
    console.error("PUBLIC_SUPABASE_ANON_KEY is not configured");
    return null;
  }

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    console.warn(`Supabase validation failed with status ${response.status}`);
    return null;
  }

  const user = await response.json();
  if (!user?.id) {
    return null;
  }

  return { token, userId: user.id };
}
