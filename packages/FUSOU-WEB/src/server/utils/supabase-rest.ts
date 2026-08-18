/**
 * Supabase REST API helpers
 *
 * Shared low-level utilities for making Supabase REST requests
 * and resolving member_id_hash linkages.
 */

import type { Bindings } from "../types";
import { createEnvContext, resolveSupabaseConfig } from "../utils";
import { MemberIdHashRowsSchema } from "../schemas/member-lookup";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SupabaseRestConfig = {
  url: string;
  key: string;
};

// ─── Config Helper ──────────────────────────────────────────────────────────

/**
 * Build a Supabase REST config from a Hono-style context.
 */
export function getSupabaseRestConfig(c: {
  env: Bindings;
}): SupabaseRestConfig {
  const envCtx = createEnvContext(c);
  const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
  return { url: url || "", key: serviceRoleKey || "" };
}

// ─── Generic REST Request ───────────────────────────────────────────────────

/**
 * Make a raw request to the Supabase REST API (PostgREST).
 *
 * Callers must validate table-specific responses with their Zod schema.
 */
export async function supabaseRestRequest(
  config: SupabaseRestConfig,
  table: string,
  options: {
    method?: string;
    query?: string;
    body?: object | null;
    headers?: Record<string, string>;
  } = {},
): Promise<unknown | null> {
  const { method = "GET", query = "", body = null, headers = {} } = options;
  const { url, key } = config;

  if (!url || !key) {
    throw new Error("Supabase configuration missing");
  }

  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=minimal",
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supabase error: ${response.status} - ${error}`);
  }

  if (
    method === "GET" ||
    (
      headers["Prefer"] || (method === "POST" ? "return=representation" : "")
    ).includes("return=representation")
  ) {
    const payload: unknown = await response.json();
    return payload;
  }

  return null;
}

// ─── Member ID Hash Resolution ──────────────────────────────────────────────

/**
 * Resolve the member_id_hash linked to a given user_id.
 *
 * Uses Supabase REST API directly (service_role key) so it works
 * in contexts where a full Supabase JS client is not available.
 */
export async function resolveMemberIdHashForUser(
  config: SupabaseRestConfig,
  userId: string,
): Promise<string | null> {
  const userIdQuery = encodeURIComponent(userId);

  const link = await supabaseRestRequest(config, "user_member_map", {
    query: `?user_id=eq.${userIdQuery}&select=member_id_hash&limit=1`,
  });
  const parsedLink = MemberIdHashRowsSchema.safeParse(link);
  if (!parsedLink.success) {
    console.warn("[supabase-rest] invalid member id hash response", {
      userId,
      error: parsedLink.error,
    });
    return null;
  }

  if (parsedLink.data[0]?.member_id_hash) {
    return parsedLink.data[0].member_id_hash;
  }

  return null;
}
