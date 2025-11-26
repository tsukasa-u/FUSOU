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
      if (!m) return new Response('Not found', { status: 404 });
      const token = decodeURIComponent(m[1]);

      const supabaseUrl = env.SUPABASE_URL;
      const serviceKey = env.SUPABASE_SERVICE_KEY;
      if (!supabaseUrl || !serviceKey) {
        return new Response('Server not configured', { status: 500 });
      }

      // Query Supabase REST for the fleet metadata by share_token
      const q = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/fleets?select=r2_key,version,hash,is_public&share_token=eq.${encodeURIComponent(
        token
      )}&limit=1`;

      const supRes = await fetch(q, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json'
        }
      });

      if (!supRes.ok) {
        return new Response('Upstream DB error', { status: 502 });
      }

      const rows = await supRes.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return new Response('Not found', { status: 404 });
      }

      const meta = rows[0] as any;
      const r2_key = meta.r2_key;
      const version = meta.version ?? '';
      const hash = meta.hash ?? '';
      const isPublic = !!meta.is_public;

      if (!r2_key) return new Response('Not found', { status: 404 });

      const etag = `W/"v${version}-${hash}"`;
      const ifNone = request.headers.get('If-None-Match');
      if (ifNone && ifNone === etag) return new Response(null, { status: 304 });

      // Try Cloudflare cache first
      const cacheKey = new Request(request.url + '::' + r2_key + '::' + String(version));
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set('ETag', etag);
        headers.set('Cache-Control', 'public, max-age=60, s-maxage=3600');
        return new Response(cached.body, { status: cached.status, headers });
      }

      // Fetch from R2
      const obj = await env.ASSET_PAYLOAD_BUCKET.get(r2_key);
      if (!obj) return new Response('Not found in storage', { status: 404 });

      // Build response (object.body is a ReadableStream)
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      headers.set('Content-Encoding', 'gzip');
      headers.set('ETag', etag);
      // Public caching by default; adjust for private content
      if (isPublic) {
        headers.set('Cache-Control', 'public, max-age=60, s-maxage=3600');
      } else {
        headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
      }

      const resp = new Response(obj.body, { status: 200, headers });

      // Cache asynchronously
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));

      return resp;
    } catch (err: any) {
      return new Response(String(err?.message ?? err), { status: 500 });
    }
  }
};
