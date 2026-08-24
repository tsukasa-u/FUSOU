/**
 * Supabase REST API helpers
 *
 * Shared low-level utilities for making Supabase REST requests
 * and resolving public_id linkages.
 */

import type { Bindings } from "../types";
import { createEnvContext, resolveSupabaseConfig } from "../utils";
import { PublicIdSchema } from "../schemas/public-id";
import { z } from "zod";

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

// ─── Public ID Resolution ───────────────────────────────────────────────────

const PublicIdRowsSchema = z
  .object({ public_id: PublicIdSchema.optional() })
  .passthrough()
  .array();

/**
 * Resolve all public_ids linked to a given user_id.
 *
 * Uses Supabase REST API directly (service_role key) so it works
 * in contexts where a full Supabase JS client is not available.
 */
export async function resolvePublicIdsForUser(
  config: SupabaseRestConfig,
  userId: string,
): Promise<string[]> {
  const userIdQuery = encodeURIComponent(userId);

  for (const table of ["web_user_member_map", "user_member_map"]) {
    const link = await supabaseRestRequest(config, table, {
      query: `?user_id=eq.${userIdQuery}&select=public_id,updated_at&order=updated_at.desc`,
    });
    const parsedLink = PublicIdRowsSchema.safeParse(link);
    if (!parsedLink.success) {
      console.warn("[supabase-rest] invalid public id response", {
        userId,
        table,
        error: parsedLink.error,
      });
      continue;
    }

    const publicIds = parsedLink.data.flatMap((row) =>
      row.public_id ? [row.public_id.trim().toLowerCase()] : [],
    );
    if (publicIds.length > 0) {
      return publicIds;
    }
  }

  return [];
}

export async function resolvePublicIdForUser(
  config: SupabaseRestConfig,
  userId: string,
): Promise<string | null> {
  const publicIds = await resolvePublicIdsForUser(config, userId);
  return publicIds[0] ?? null;
}
