import type { APIRoute } from "astro";
import { readJsonBody, handleJsonReadError, CORS_HEADERS } from "../_utils/http";

type CloudflareEnv = {
  ASSET_PAYLOAD_BUCKET?: any;
};

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

// Debug endpoint for operational testing.
// Returns R2 listing and diagnostic information so the FUSOU-APP UI can show it.
// No authentication (debug use only) — protect via your network when used.
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals?.runtime?.env as unknown as CloudflareEnv | undefined;
  const bucket = env?.ASSET_PAYLOAD_BUCKET;

  const logs: string[] = [];

  if (!bucket) {
    logs.push("Missing R2 binding: ASSET_PAYLOAD_BUCKET");
    return new Response(JSON.stringify({ ok: false, logs }), {
      status: 500,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await readJsonBody(request, 16 * 1024);
  } catch (err) {
    return handleJsonReadError(err);
  }

  const owner_id = typeof body?.owner_id === "string" ? body.owner_id : null;
  const tag = typeof body?.tag === "string" ? body.tag : null;
  if (!owner_id || !tag) {
    logs.push("Missing owner_id or tag in request body");
    return new Response(JSON.stringify({ ok: false, logs, error: "owner_id and tag are required" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "content-type": "application/json" },
    });
  }

  logs.push(`Listing objects for prefix fleets/${owner_id}/${encodeURIComponent(tag)}/`);

  const prefix = `fleets/${owner_id}/${encodeURIComponent(tag)}/`;
  let cursor: string | undefined = undefined;
  const items: Array<{ key: string; size?: number; uploaded?: string }> = [];
  const errors: string[] = [];

  while (true) {
    const res = await bucket.list({ prefix, cursor, limit: 100 }).catch((e: any) => {
      const msg = `R2 list failed: ${String(e)}`;
      errors.push(msg);
      logs.push(msg);
      return null;
    });
    if (!res) break;

    const objs = (res as any).objects ?? (res as any);
    if (!objs || !Array.isArray(objs)) break;

    for (const o of objs) {
      const k = o?.key ?? o?.name;
      if (!k) continue;
      items.push({ key: k, size: o?.size, uploaded: o?.uploaded });
    }

    const truncated = Boolean((res as any).truncated);
    if (!truncated) break;
    cursor = (res as any).cursor;
    if (!cursor) break;
  }

  logs.push(`Found ${items.length} objects`);

  // Determine newest by parsing filename: <version>-<hash>.json.gz
  let keepKey: string | null = null;
  const parsed = items.map((it) => {
    const name = it.key.split("/").pop() || "";
    const m = name.match(/^(\d+)-([0-9a-fA-F]+)\.json\.gz$/);
    return { key: it.key, version: m ? Number(m[1]) : null };
  });

  const withVersion = parsed.filter((p) => p.version !== null) as Array<{ key: string; version: number }>;
  if (withVersion.length > 0) {
    withVersion.sort((a, b) => b.version - a.version);
    keepKey = withVersion[0].key;
    logs.push(`Selected keepKey by version: ${keepKey}`);
  } else if (items.length > 0) {
    keepKey = items.map((i) => i.key).sort().pop() || null;
    logs.push(`No versioned keys found; selected keepKey by lexicographic max: ${keepKey}`);
  } else {
    logs.push("No objects found under prefix");
  }

  const candidates = items.map((i) => i.key).filter((k) => k !== keepKey);

  return new Response(
    JSON.stringify({ ok: true, owner_id, tag, all: items, keepKey, candidates, logs, errors }),
    { status: 200, headers: { ...CORS_HEADERS, "content-type": "application/json" } },
  );
};
