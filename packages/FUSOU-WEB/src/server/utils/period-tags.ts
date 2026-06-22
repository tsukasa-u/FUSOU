import type { Bindings, D1Database } from "../types";

type SupabaseRestConfigLike = {
  url: string;
  key: string;
};

const PERIOD_TAG_CACHE_LIST_KEY = "data_loader:period_tags:list";
const PERIOD_TAG_CACHE_LIST_TTL = 300;
const PERIOD_TAG_FETCH_LIMIT = 200;

export function isValidPeriodTagDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function toTokyoPeriodTag(rawTag: string | null | undefined): string | null {
  if (!rawTag) return null;
  const parsedDate = new Date(rawTag);
  if (!Number.isFinite(parsedDate.getTime())) return null;
  return parsedDate.toLocaleDateString("sv-SE", {
    timeZone: "Asia/Tokyo",
  });
}

async function fetchAllowedPeriodTagsFromSupabase(
  c: { env: Bindings },
  config?: SupabaseRestConfigLike,
): Promise<string[]> {
  const resolved = await resolveSupabaseRestConfig(c, config);
  const { url, key } = resolved;
  if (!url || !key) {
    throw new Error("Supabase configuration missing");
  }

  const nowIso = new Date(Date.now() - 5000).toISOString();
  const response = await fetch(
    `${url}/rest/v1/kc_period_tag?select=tag&tag=lte.${nowIso}&order=tag.desc.nullslast&limit=${PERIOD_TAG_FETCH_LIMIT}`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch period tags: ${response.status}`);
  }

  const rows = (await response.json()) as Array<{ tag: string | null }>;
  return rows
    .map((row) => toTokyoPeriodTag(row.tag))
    .filter((tag): tag is string => Boolean(tag));
}

async function readCachedPeriodTags(
  cacheKV: KVNamespace,
  limit: number,
): Promise<string[] | null> {
  try {
    const cached = await cacheKV.get(PERIOD_TAG_CACHE_LIST_KEY, "json");
    if (
      cached &&
      typeof cached === "object" &&
      Array.isArray((cached as { tags?: unknown[] }).tags)
    ) {
      const tags = ((cached as { tags: unknown[] }).tags ?? [])
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => isValidPeriodTagDate(value));
      if (tags.length > 0) {
        return tags.slice(0, limit);
      }
    }
  } catch (error) {
    console.warn("[period-tags] cache read failed:", error);
  }
  return null;
}

async function checkPeriodTagExistsInSupabase(
  c: { env: Bindings },
  periodTag: string,
  config?: SupabaseRestConfigLike,
): Promise<boolean> {
  const resolved = await resolveSupabaseRestConfig(c, config);
  const { url, key } = resolved;
  if (!url || !key) {
    throw new Error("Supabase configuration missing");
  }

  const nowIso = new Date(Date.now() - 5000).toISOString();
  const periodStartUtc = new Date(`${periodTag}T00:00:00+09:00`);
  const periodEndUtc = new Date(periodStartUtc.getTime() + 24 * 60 * 60 * 1000);
  if (!Number.isFinite(periodStartUtc.getTime())) {
    return false;
  }

  const andExpr = encodeURIComponent(
    `(tag.gte.${periodStartUtc.toISOString()},tag.lt.${periodEndUtc.toISOString()},tag.lte.${nowIso})`,
  );

  const response = await fetch(
    `${url}/rest/v1/kc_period_tag?select=tag&and=${andExpr}&order=tag.desc.nullslast&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to verify period tag: ${response.status}`);
  }

  const rows = (await response.json()) as Array<{ tag: string | null }>;
  return Array.isArray(rows) && rows.length > 0;
}

export function formatPeriodTagAsTokyoRfc3339(periodTag: string): string {
  return `${periodTag}T00:00:00+09:00`;
}

export async function listAllowedPeriodTags(
  c: { env: Bindings },
  options?: {
    cacheKV?: KVNamespace;
    limit?: number;
    supabaseConfig?: SupabaseRestConfigLike;
  },
): Promise<string[]> {
  const limit = Math.max(1, options?.limit ?? 200);
  const cacheKV = options?.cacheKV;

  if (cacheKV) {
    const cached = await readCachedPeriodTags(cacheKV, limit);
    if (cached && cached.length > 0) {
      return cached;
    }
  }

  const tags = await fetchAllowedPeriodTagsFromSupabase(
    c,
    options?.supabaseConfig,
  );

  if (cacheKV && tags.length > 0) {
    try {
      await cacheKV.put(
        PERIOD_TAG_CACHE_LIST_KEY,
        JSON.stringify({
          tags,
          updated_at: Date.now(),
        }),
        { expirationTtl: PERIOD_TAG_CACHE_LIST_TTL },
      );
    } catch (error) {
      console.warn("[period-tags] cache write failed:", error);
    }
  }

  return tags.slice(0, limit);
}

export async function getLatestAllowedPeriodTag(
  c: { env: Bindings },
  options?: { cacheKV?: KVNamespace; supabaseConfig?: SupabaseRestConfigLike },
): Promise<string | null> {
  const tags = await listAllowedPeriodTags(c, {
    cacheKV: options?.cacheKV,
    limit: 1,
    supabaseConfig: options?.supabaseConfig,
  });
  return tags[0] ?? null;
}

export async function getLatestAllowedPeriodTagWithSource(
  c: { env: Bindings },
  options?: { cacheKV?: KVNamespace; supabaseConfig?: SupabaseRestConfigLike },
): Promise<{ tag: string | null; cached: boolean }> {
  const cacheKV = options?.cacheKV;
  if (cacheKV) {
    const cached = await readCachedPeriodTags(cacheKV, 1);
    if (cached && cached.length > 0) {
      return { tag: cached[0], cached: true };
    }
  }

  const tag = await getLatestAllowedPeriodTag(c, options);
  return { tag, cached: false };
}

export async function getAllowedPeriodTagSet(
  c: { env: Bindings },
  cacheKV?: KVNamespace,
  supabaseConfig?: SupabaseRestConfigLike,
): Promise<Set<string>> {
  return new Set(
    await listAllowedPeriodTags(c, {
      cacheKV,
      limit: 200,
      supabaseConfig,
    }),
  );
}

export async function validateCachedPeriodTag(
  c: { env: Bindings },
  periodTag: string,
  options?: {
    fieldName?: string;
    cacheKV?: KVNamespace;
    supabaseConfig?: SupabaseRestConfigLike;
  },
): Promise<{ ok: true } | { ok: false; status: 400 | 503; error: string }> {
  const fieldName = options?.fieldName ?? "period_tag";

  if (!periodTag) {
    return { ok: false, status: 400, error: `${fieldName} is required` };
  }
  if (!isValidPeriodTagDate(periodTag)) {
    return {
      ok: false,
      status: 400,
      error: `${fieldName} must be a valid YYYY-MM-DD date`,
    };
  }

  try {
    const cachedAllowedSet = await getAllowedPeriodTagSet(
      c,
      options?.cacheKV,
      options?.supabaseConfig,
    );
    if (cachedAllowedSet.has(periodTag)) {
      return { ok: true };
    }
  } catch (error) {
    console.warn(
      "[period-tags] allow-list fetch failed; trying direct verify:",
      error,
    );
  }

  try {
    const exists = await checkPeriodTagExistsInSupabase(
      c,
      periodTag,
      options?.supabaseConfig,
    );
    if (exists) {
      return { ok: true };
    }
    return {
      ok: false,
      status: 400,
      error: `${fieldName} is not in the allowed period-tag cache`,
    };
  } catch (error) {
    console.error("[period-tags] authoritative validation failed:", error);
    return {
      ok: false,
      status: 503,
      error: `Failed to validate ${fieldName} against authoritative cache`,
    };
  }
}

async function resolveSupabaseRestConfig(
  c: { env: Bindings },
  explicit?: SupabaseRestConfigLike,
): Promise<SupabaseRestConfigLike> {
  if (explicit?.url && explicit?.key) {
    return explicit;
  }

  const { getSupabaseRestConfig } = await import("./supabase-rest");
  return getSupabaseRestConfig(c);
}

export async function getLatestMasterPeriodTag(
  db: D1Database,
  kv?: KVNamespace,
): Promise<{ period_tag: string; table_version: string } | null> {
  const cacheKey = "master-data-index:v1:latest-with-version";
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, "json");
      if (cached) return cached as { period_tag: string; table_version: string };
    } catch (e) {
      console.warn("[period-tags] failed to read from kv for latest master period", e);
    }
  }

  const latestMasterData = (await db
    .prepare(
      `SELECT period_tag, table_version FROM master_data_index WHERE upload_status = 'completed' ORDER BY completed_at DESC, period_revision DESC LIMIT 1`,
    )
    .first()) as { period_tag: string; table_version: string } | null;

  if (latestMasterData?.period_tag) {
    if (kv) {
      try {
        await kv.put(cacheKey, JSON.stringify(latestMasterData), { expirationTtl: 300 });
      } catch (e) {
        console.warn("[period-tags] failed to write to kv for latest master period", e);
      }
    }
    return latestMasterData;
  }
  return null;
}
