// Cloudflare Worker (Module) to serve snapshot payloads by share token
// Bindings required (via wrangler / Pages env):
// - ASSET_PAYLOAD_BUCKET: R2 binding
// - SUPABASE_URL
// - SUPABASE_SERVICE_KEY

export default {
  async fetch(request: Request, env: any, ctx: any) {
    try {
      const url = new URL(request.url);
      // Expect path like /s/:token
      const m = url.pathname.match(/^\/s\/([^/]+)$/);
      if (!m) return new Response("Not found", { status: 404 });
      const token = decodeURIComponent(m[1]);

      const supabaseUrl = env.SUPABASE_URL;
      const serviceKey = env.SUPABASE_SERVICE_KEY;
      if (!supabaseUrl || !serviceKey) {
        return new Response("Server not configured", { status: 500 });
      }

      // Query Supabase REST for the fleet metadata by share_token
      // Only select the fields we need (minimize data transfer)
      const q = `${supabaseUrl.replace(
        /\/$/,
        ""
      )}/rest/v1/fleets?select=owner_id,r2_key,version,hash,is_public&share_token=eq.${encodeURIComponent(
        token
      )}&limit=1`;

      const supRes = await fetch(q, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: "application/json",
        },
      });

      if (!supRes.ok) {
        return new Response("Upstream DB error", { status: 502 });
      }

      const rows = await supRes.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response("Not found", { status: 404 });
      }

      const meta = rows[0] as any;
      const r2_key = meta.r2_key;
      const ownerId = meta.owner_id;
      const version = meta.version ?? "";
      const hash = meta.hash ?? "";
      const isPublic = !!meta.is_public;

      if (!r2_key) return new Response("Not found", { status: 404 });

      // If the resource is private, require an Authorization Bearer token and verify
      if (!isPublic) {
        const authHeader = request.headers.get("Authorization") || "";
        const mAuth = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!mAuth) return new Response("Unauthorized", { status: 401 });
        const viewerJwt = mAuth[1];

        // Verify JWT signature and claims via JWKS (cached)
        const verifyResult = await verifyJwtWithJwks(viewerJwt, supabaseUrl);
        if (!verifyResult || !verifyResult.valid) {
          return new Response("Unauthorized", { status: 401 });
        }
        const viewerId = verifyResult.sub;
        if (!viewerId) return new Response("Unauthorized", { status: 401 });

        // Check ownership match
        if (String(viewerId) !== String(ownerId)) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      const etag = `W/"v${version}-${hash}"`;
      const ifNone = request.headers.get("If-None-Match");
      if (ifNone && ifNone === etag) return new Response(null, { status: 304 });

      // Try Cloudflare cache first
      const cacheKey = new Request(
        request.url + "::" + r2_key + "::" + String(version)
      );
      let cache: Cache;
      const cacheStorage = caches as CacheStorage & { default?: Cache };
      if (cacheStorage.default) {
        cache = cacheStorage.default;
      } else {
        cache = await caches.open("fleet-snapshot");
      }
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("ETag", etag);
        headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
        return new Response(cached.body, { status: cached.status, headers });
      }

      // Fetch from R2
      const obj = await env.ASSET_PAYLOAD_BUCKET.get(r2_key);
      if (!obj) return new Response("Not found in storage", { status: 404 });

      // Build response (object.body is a ReadableStream)
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Content-Encoding", "gzip");
      headers.set("ETag", etag);
      // Public caching by default; adjust for private content
      if (isPublic) {
        headers.set("Cache-Control", "public, max-age=60, s-maxage=3600");
      } else {
        headers.set("Cache-Control", "private, max-age=60, must-revalidate");
      }

      const resp = new Response(obj.body, { status: 200, headers });

      // Cache asynchronously
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));

      return resp;
    } catch (err: any) {
      return new Response(String(err?.message ?? err), { status: 500 });
    }
  },
};

// --- JWKS + JWT verification helpers (module-level cache) ---
// Keep a simple in-memory cache for JWKS and imported CryptoKeys per `kid`.
let jwksCache: { keys?: any[]; fetchedAt?: number } = {};
const KEY_CACHE: Record<string, CryptoKey> = {};

async function fetchJwks(supabaseUrl: string): Promise<any[]> {
  const now = Date.now();
  if (
    jwksCache.fetchedAt &&
    now - jwksCache.fetchedAt < 5 * 60 * 1000 &&
    jwksCache.keys
  ) {
    return jwksCache.keys;
  }
  const jwksUrl = `${supabaseUrl.replace(
    /\/$/,
    ""
  )}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error("Failed to fetch JWKS");
  const data = await res.json();
  jwksCache = { keys: data.keys || [], fetchedAt: Date.now() };
  return jwksCache.keys || [];
}

function base64urlToUint8Array(base64url: string) {
  base64url = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64url.length % 4;
  if (pad === 2) base64url += "==";
  if (pad === 3) base64url += "=";
  const binary = atob(base64url);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importJwkAsKey(jwk: any) {
  // Use RSASSA-PKCS1-v1_5 for RS256
  const alg = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as any;
  const usage: KeyUsage[] = ["verify"];
  return crypto.subtle.importKey("jwk", jwk, alg, false, usage);
}

async function getCryptoKeyForKid(kid: string, supabaseUrl: string) {
  if (KEY_CACHE[kid]) return KEY_CACHE[kid];
  const keys = await fetchJwks(supabaseUrl);
  const jwk = keys.find((k: any) => k.kid === kid);
  if (!jwk) throw new Error("No matching JWK for kid");
  const key = await importJwkAsKey(jwk);
  KEY_CACHE[kid] = key;
  return key;
}

async function verifyJwtWithJwks(token: string, supabaseUrl: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(
      new TextDecoder().decode(base64urlToUint8Array(parts[0]))
    );
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlToUint8Array(parts[1]))
    );
    const sig = base64urlToUint8Array(parts[2]);
    if (header.alg !== "RS256") return null;
    const kid = header.kid;
    if (!kid) return null;
    const key = await getCryptoKeyForKid(kid, supabaseUrl);
    const data = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      sig,
      data
    );
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
