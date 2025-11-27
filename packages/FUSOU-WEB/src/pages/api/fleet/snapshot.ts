import type { APIRoute } from "astro";

// Example Cloudflare Pages API handler for POST /api/fleet/snapshot
// This is a minimal, self-contained sample illustrating the flow:
// 1) validate JWT (assumed to be done via header Bearer token or external middleware)
// 2) receive payload, gzip it, compute hash and size
// 3) PUT to R2 (ASSET_PAYLOAD_BUCKET binding expected)
// 4) UPSERT metadata to Supabase (using service role key)

// WARNING: This sample omits production concerns: detailed validation, rate limiting,
// background retries, secrets management. Use as a starting point.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type CloudflareEnv = {
  ASSET_PAYLOAD_BUCKET?: R2BucketBinding;
  PUBLIC_SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string; // use secret in production
};

type R2BucketBinding = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string,
    options?: { httpMetadata?: Record<string, string> }
  ): Promise<any>;
};

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals?.runtime?.env as unknown as CloudflareEnv | undefined;
  const bucket = env?.ASSET_PAYLOAD_BUCKET;
  const supabaseUrl = env?.PUBLIC_SUPABASE_URL;
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY;

  if (!bucket || !supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // Basic auth extraction (replace with proper JWT verification in production)
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  const { owner_id, tag, payload, version: clientVersion, is_public } = body;
  if (!owner_id || !tag || !payload) {
    return new Response(
      JSON.stringify({ error: "owner_id, tag and payload are required" }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // Prepare object: stringify + gzip
  const text = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  // gzip via CompressionStream (available in Workers)
  let compressed: Uint8Array;
  try {
    const cs = new CompressionStream("gzip");
    const stream = new Response(data).body!.pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    compressed = new Uint8Array(buf);
  } catch (err) {
    // fallback: store raw JSON if CompressionStream not available
    compressed = data;
  }

  // Compute a simple content-hash (sha256)
  const hashSource = compressed.buffer as ArrayBuffer;
  const hashBuf = await crypto.subtle.digest("SHA-256", hashSource);
  const hashArray = Array.from(new Uint8Array(hashBuf));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Decide version and key
  const version = clientVersion ? Number(clientVersion) : Date.now();
  const key = `fleets/${owner_id}/${encodeURIComponent(
    tag
  )}/${version}-${hashHex}.json.gz`;

  // Put into R2
  try {
    await bucket.put(key, compressed, {
      httpMetadata: {
        contentType: "application/json",
        contentEncoding: "gzip",
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        error: "Failed to store payload in R2",
        detail: String(err),
      }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // Upsert metadata to Supabase via REST
  const meta = {
    owner_id,
    tag,
    title: body.title || null,
    r2_key: key,
    size_bytes: compressed.byteLength,
    version,
    is_public: !!is_public,
    updated_at: new Date().toISOString(),
  };

  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/fleets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates", // Use upsert behaviour depending on your PostgREST setup
      },
      body: JSON.stringify(meta),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return new Response(
        JSON.stringify({ error: "Failed to upsert metadata", detail: text }),
        {
          status: 502,
          headers: { ...CORS_HEADERS, "content-type": "application/json" },
        }
      );
    }
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: "Supabase upsert failed", detail: String(err) }),
      {
        status: 502,
        headers: { ...CORS_HEADERS, "content-type": "application/json" },
      }
    );
  }

  // Optionally: enqueue a cache-replication job here (not implemented)

  // Return success with metadata
  return new Response(
    JSON.stringify({ ok: true, owner_id, tag, version, r2_key: key }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    }
  );
};
