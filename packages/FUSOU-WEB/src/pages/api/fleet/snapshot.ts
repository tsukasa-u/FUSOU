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

// --- JWKS + JWT verification helpers (module-level cache) ---
// Keep a simple in-memory cache for JWKS and imported CryptoKeys per `kid`.
let jwksCache: { keys?: any[]; fetchedAt?: number } = {};
const KEY_CACHE: Record<string, CryptoKey> = {};

async function fetchJwks(supabaseUrl: string) {
  const now = Date.now();
  if (jwksCache.fetchedAt && now - jwksCache.fetchedAt < 5 * 60 * 1000 && jwksCache.keys) {
    return jwksCache.keys;
  }
  const jwksUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error('Failed to fetch JWKS');
  const data = await res.json();
  jwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

function base64urlToUint8Array(base64url: string) {
  base64url = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64url.length % 4;
  if (pad === 2) base64url += '==';
  if (pad === 3) base64url += '=';
  const binary = atob(base64url);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importJwkAsKey(jwk: any) {
  // Use RSASSA-PKCS1-v1_5 for RS256
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as any;
  const usage: KeyUsage[] = ['verify'];
  return crypto.subtle.importKey('jwk', jwk, alg, false, usage);
}

async function getCryptoKeyForKid(kid: string, supabaseUrl: string) {
  if (KEY_CACHE[kid]) return KEY_CACHE[kid];
  const keys = await fetchJwks(supabaseUrl);
  const jwk = keys.find((k: any) => k.kid === kid);
  if (!jwk) throw new Error('No matching JWK for kid');
  const key = await importJwkAsKey(jwk);
  KEY_CACHE[kid] = key;
  return key;
}

async function verifyJwtWithJwks(token: string, supabaseUrl: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(base64urlToUint8Array(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(base64urlToUint8Array(parts[1])));
    const sig = base64urlToUint8Array(parts[2]);
    if (header.alg !== 'RS256') return null;
    const kid = header.kid;
    if (!kid) return null;
    const key = await getCryptoKeyForKid(kid, supabaseUrl);
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
    if (!valid) return { valid: false };
    // check exp / nbf
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && now >= payload.exp) return { valid: false };
    if (payload.nbf && now < payload.nbf) return { valid: false };
    return { valid: true, sub: payload.sub, payload };
  } catch (e) {
    return { valid: false };
  }
}

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
  const maxPayloadBytes = Number(env?.MAX_SNAPSHOT_BYTES ?? 2500000); // default ~2.5MB
  const supabaseKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = env?.PUBLIC_SUPABASE_URL;

  if (!bucket || !supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // Authorization: require Bearer JWT and verify signature + claims via Supabase JWKS
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing Authorization" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  // Verify JWT using JWKS
  try {
    const verified = await verifyJwtWithJwks(token, supabaseUrl!);
    if (!verified || !verified.valid) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
    }
    // attach claims if needed
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Failed to verify token', detail: String(err) }), { status: 401, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
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

  // gzip via CompressionStream (available in Pages/Workers). Fallback to raw bytes.
  let compressed: Uint8Array;
  try {
    const cs = new CompressionStream("gzip");
    const stream = new Response(data).body!.pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    compressed = new Uint8Array(buf);
  } catch (err) {
    compressed = data;
  }

  // Enforce maximum payload size after compression
  if (compressed.byteLength > maxPayloadBytes) {
    return new Response(JSON.stringify({ error: 'Payload too large', size: compressed.byteLength }), { status: 413, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } });
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

  // Avoid duplicate work: check if Supabase has the same r2_key already for this owner+tag
  try {
    await bucket.put(key, compressed, { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" } });
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
