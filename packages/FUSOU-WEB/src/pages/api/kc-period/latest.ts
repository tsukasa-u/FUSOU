import type { APIRoute } from "astro";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type",
};
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

interface CloudflareEnv {
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

type SupabasePeriodRow = {
  tag: string | null;
};

type PeriodPayload = {
  tag: string | null;
  fetchedAt: string;
  cacheExpiresAt: string;
};

type CachedEntry = {
  payload: PeriodPayload;
  expiresAt: number;
};

let cachedPeriod: CachedEntry | null = null;

export const prerender = false;

export const OPTIONS: APIRoute = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: APIRoute = async ({ locals }) => {
  const env = extractEnv(locals.runtime?.env);
  const now = Date.now();

  if (cachedPeriod && cachedPeriod.expiresAt > now) {
    return jsonResponse(cachedPeriod.payload, true);
  }

  const supabaseUrl = normalizeSupabaseUrl(import.meta.env.PUBLIC_SUPABASE_URL || "");
  if (!supabaseUrl) {
    return errorResponse("PUBLIC_SUPABASE_URL is not configured", 500);
  }

  const apiKey =
    env?.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey) {
    return errorResponse("Supabase API key is not available", 503);
  }

  const queryUrl =
    `${supabaseUrl}/rest/v1/kc_period_tag?select=tag&order=tag.desc.nullslast&limit=1`;

  const response = await fetch(queryUrl, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const message = (await response.text()).trim();
    console.error(
      `Failed to fetch kc_period_tag from Supabase: ${response.status} ${message}`,
    );
    return errorResponse("Unable to fetch kc_period_tag", 502);
  }

  let rows: SupabasePeriodRow[];
  try {
    rows = (await response.json()) as SupabasePeriodRow[];
  } catch (error) {
    console.error("Failed to parse Supabase kc_period_tag response", error);
    return errorResponse("Supabase response was not valid JSON", 502);
  }

  const latestTag = Array.isArray(rows) && rows.length > 0 ? rows[0].tag ?? null : null;
  const payload = buildPayload(latestTag, now);
  cachedPeriod = {
    payload,
    expiresAt: now + CACHE_TTL_MS,
  };

  return jsonResponse(payload, false);
};

function buildPayload(tag: string | null, now: number): PeriodPayload {
  return {
    tag,
    fetchedAt: new Date(now).toISOString(),
    cacheExpiresAt: new Date(now + CACHE_TTL_MS).toISOString(),
  };
}

function extractEnv(value: unknown): CloudflareEnv | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as CloudflareEnv;
}

function normalizeSupabaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/$/, "");
}

function jsonResponse(payload: PeriodPayload, cached: boolean): Response {
  return new Response(
    JSON.stringify({ ...payload, cached }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": `public, max-age=${CACHE_TTL_MS / 1000}`,
        ...CORS_HEADERS,
      },
    },
  );
}

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
    },
  });
}
