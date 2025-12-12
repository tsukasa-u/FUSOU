import { Hono } from "hono";
import type { Bindings, R2BucketBinding } from "../types";
import { getEnvValue } from "../utils";
import {
  CORS_HEADERS,
  MAX_BODY_SIZE,
  SNAPSHOT_TOKEN_TTL_SECONDS,
} from "../constants";

const app = new Hono<{ Bindings: Bindings }>();

type SnapshotConfig = {
  bucket: R2BucketBinding | undefined;
  supabaseUrl: string | null;
  signingSecret: string | null;
};

function resolveSnapshotConfig(c: any): SnapshotConfig {
  const runtimeEnv = c.env ?? {};
  const supabaseUrl = getEnvValue("PUBLIC_SUPABASE_URL", runtimeEnv);
  const signingSecret = getEnvValue(
    "FLEET_SNAPSHOT_SIGNING_SECRET",
    runtimeEnv
  );

  return {
    bucket: runtimeEnv.ASSET_PAYLOAD_BUCKET,
    supabaseUrl: supabaseUrl ? supabaseUrl.replace(/\/$/, "") : null,
    signingSecret: signingSecret ?? null,
  };
}

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS })
);

// POST /snapshot
app.post("/snapshot", async (c) => {
  const { bucket, supabaseUrl, signingSecret } = resolveSnapshotConfig(c);

  if (!bucket || !supabaseUrl || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const url = new URL(c.req.url);
  const request = c.req.raw;

  if (!url.searchParams.has("token")) {
    return await handleSnapshotPreparation(
      c,
      request,
      url,
      supabaseUrl,
      signingSecret
    );
  }

  return await handleSnapshotUpload(
    c,
    request,
    url,
    bucket,
    supabaseUrl,
    signingSecret
  );
});

async function handleSnapshotPreparation(
  c: any,
  request: Request,
  url: URL,
  supabaseUrl: string,
  signingSecret: string
): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
  if (!tag) {
    return c.json({ error: "tag is required" }, 400);
  }

  const { generateSignedToken } = await import("../utils");
  const signedToken = await generateSignedToken(
    { tag },
    signingSecret,
    SNAPSHOT_TOKEN_TTL_SECONDS
  );

  const uploadUrl = new URL(url);
  uploadUrl.searchParams.set("token", signedToken);

  return c.json({
    uploadUrl: uploadUrl.toString(),
    expiresAt: new Date(
      Date.now() + SNAPSHOT_TOKEN_TTL_SECONDS * 1000
    ).toISOString(),
    maxBodyBytes: MAX_BODY_SIZE,
    fields: { tag },
  });
}

async function handleSnapshotUpload(
  c: any,
  request: Request,
  url: URL,
  bucket: R2BucketBinding,
  supabaseUrl: string,
  signingSecret: string
): Promise<Response> {
  const token = url.searchParams.get("token");
  if (!token) {
    return c.json({ error: "Missing token parameter" }, 400);
  }

  const { verifySignedToken } = await import("../utils");
  const tokenPayload = await verifySignedToken(token, signingSecret);
  if (!tokenPayload) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const expectedTag = tokenPayload.tag;
  if (!expectedTag) {
    return c.json({ error: "Invalid token payload" }, 400);
  }

  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const tag = body?.tag || "default";
    if (tag !== expectedTag) {
      return c.json({ error: "Tag mismatch" }, 400);
    }

    const payload = body?.payload;
    if (!payload) {
      return c.json({ error: "payload is required" }, 400);
    }

    const isEmptyObject =
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      Object.keys(payload).length === 0;
    const isEmptyArray = Array.isArray(payload) && payload.length === 0;

    if (isEmptyObject || isEmptyArray) {
      return c.json({ error: "Empty payload is not allowed" }, 400);
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
      return c.json({ error: "Compression failed" }, 500);
    }

    const hashBuf = await crypto.subtle.digest("SHA-256", compressed.slice(0));
    const hashHex = Array.from(new Uint8Array(hashBuf as ArrayBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const version = body?.version || Date.now();
    const ownerId = "user-" + Date.now();
    const key = `fleets/${ownerId}/${encodeURIComponent(
      tag
    )}/${version}-${hashHex}.json.gz`;

    await bucket.put(key, compressed, {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "no-cache",
      },
    });

    return c.json({ ok: true, owner_id: ownerId, tag, version, r2_key: key });
  } catch (error) {
    console.error("[Fleet-Snapshot] Upload error:", error);
    return c.json({ error: "Snapshot upload failed" }, 500);
  }
}

export default app;
