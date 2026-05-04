/**
 * Supabase REST API helpers
 *
 * Shared low-level utilities for making Supabase REST requests
 * and resolving member_id_hash linkages.
 */

import type { Bindings } from "../types";
import { createEnvContext, resolveSupabaseConfig } from "../utils";

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
 * Make a typed request to the Supabase REST API (PostgREST).
 */
export async function supabaseRestRequest<T = unknown[]>(
  config: SupabaseRestConfig,
  table: string,
  options: {
    method?: string;
    query?: string;
    body?: object | null;
    headers?: Record<string, string>;
  } = {},
): Promise<T | null> {
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
      headers.Prefer || (method === "POST" ? "return=representation" : "")
    ).includes("return=representation")
  ) {
    return response.json() as Promise<T>;
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

  const link = await supabaseRestRequest<{ member_id_hash?: string }[]>(
    config,
    "user_member_map",
    {
      query: `?user_id=eq.${userIdQuery}&select=member_id_hash&limit=1`,
    },
  );

  if (Array.isArray(link) && link[0]?.member_id_hash) {
    return link[0].member_id_hash;
  }

  return null;
}
