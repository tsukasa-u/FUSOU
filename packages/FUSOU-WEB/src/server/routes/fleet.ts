import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createClient } from "@supabase/supabase-js";
import type { Bindings, R2ObjectLite } from "../types";
import {
  createEnvContext,
  getEnv,
  extractBearer,
  resolveLinkedMemberIdHashForUser,
  validateJWT,
  resolveSupabaseConfig,
  validateDatasetTokenWithConstraints,
  timingSafeEqual,
} from "../utils";
import {
  CORS_HEADERS,
  SNAPSHOT_TOKEN_TTL_SECONDS,
  SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES,
  SNAPSHOT_KEEP_LATEST_COUNT_PER_TAG,
} from "../constants";
import { handleTwoStageUpload } from "../utils/upload";

const DATASET_ID_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ROTATION_HOPS = 5;
const MAX_CANDIDATE_DATASET_IDS = 8;
const ROTATION_QUERY_PAGE_SIZE = 128;
const MAX_ROTATION_QUERY_PAGES = 8;
const MAX_R2_LIST_PAGES = 32;
const R2_LIST_PAGE_LIMIT = 1000;

type AuthSource = "jwt" | "dataset_token";

type FleetAuthResolution = {
  ok: true;
  datasetId: string;
  actorUserId: string;
  authSource: AuthSource;
  canonicalDatasetId: string | null;
  supabaseAdmin: any | null;
};

type FleetAuthFailure = {
  ok: false;
  error: string;
  status: ContentfulStatusCode;
};

function normalizeDatasetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return DATASET_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeFleetTag(rawTag: string): string {
  return rawTag
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$|\.$/g, "");
}

function encodeFleetTagPath(rawTag: string): string {
  const normalizedTag = normalizeFleetTag(rawTag.trim());
  return encodeURIComponent(normalizedTag);
}

function isSchemaObjectMissingError(error: unknown): boolean {
  const err = error as { code?: unknown; message?: unknown } | null;
  const code = typeof err?.code === "string" ? err.code : null;
  if (code === "42P01" || code === "42703") {
    return true;
  }
  const message = typeof err?.message === "string" ? err.message : "";
  return /does not exist/i.test(message);
}

function compareSnapshotRecency(a: R2ObjectLite, b: R2ObjectLite): number {
  const at = a.uploaded ? new Date(a.uploaded).getTime() : 0;
  const bt = b.uploaded ? new Date(b.uploaded).getTime() : 0;
  if (at !== bt) return bt - at;
  return a.key.localeCompare(b.key);
}

async function listAllObjectsByPrefix(
  bucket: Bindings["FLEET_SNAPSHOT_BUCKET"],
  prefix: string,
): Promise<{ objects: R2ObjectLite[]; pagesScanned: number }> {
  const out: R2ObjectLite[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_R2_LIST_PAGES; page += 1) {
    const listed = await bucket.list({
      prefix,
      cursor,
      limit: R2_LIST_PAGE_LIMIT,
    });
    out.push(...((listed.objects ?? []) as R2ObjectLite[]));

    if (!listed.truncated) {
      return { objects: out, pagesScanned: page + 1 };
    }

    cursor = listed.cursor;
    if (!cursor) {
      return { objects: out, pagesScanned: page + 1 };
    }
  }

  throw new Error(
    `[fleet] R2 listing exceeded max pages (${MAX_R2_LIST_PAGES}) for prefix=${prefix}`,
  );
}

async function resolveCanonicalDatasetIdBestEffort(options: {
  supabaseAdmin: any | null;
  actorUserId: string;
  fallbackDatasetId?: string | null;
}): Promise<string | null> {
  const fallback = normalizeDatasetId(options.fallbackDatasetId);
  if (!options.supabaseAdmin) return fallback;

  try {
    const { data, error } = await options.supabaseAdmin
      .from("user_member_map")
      .select("member_id_hash")
      .eq("user_id", options.actorUserId)
      .maybeSingle();

    if (error) {
      console.warn(
        "[fleet] canonical dataset lookup failed; falling back to current dataset",
        {
          actor_user_id: options.actorUserId,
          error: (error as { message?: unknown }).message,
        },
      );
      return fallback;
    }

    return normalizeDatasetId(data?.member_id_hash) ?? fallback;
  } catch (err) {
    console.warn(
      "[fleet] canonical dataset lookup threw; falling back to current dataset",
      err,
    );
    return fallback;
  }
}

async function resolveFleetDatasetCandidates(options: {
  supabaseAdmin: any | null;
  actorUserId: string;
  currentDatasetId: string;
  canonicalDatasetId: string | null;
}): Promise<{
  datasetIds: string[];
  hopCount: number;
  resolvedFromHistorical: 0 | 1;
}> {
  const seed: string[] = [];
  const currentNormalized = normalizeDatasetId(options.currentDatasetId);
  if (currentNormalized) seed.push(currentNormalized);
  const canonicalNormalized = normalizeDatasetId(options.canonicalDatasetId);
  if (canonicalNormalized) seed.push(canonicalNormalized);

  const visited = new Set(seed);
  const seedSetSize = visited.size;
  if (!options.supabaseAdmin || visited.size === 0) {
    return {
      datasetIds: Array.from(visited).slice(0, MAX_CANDIDATE_DATASET_IDS),
      hopCount: 0,
      resolvedFromHistorical: 0,
    };
  }

  let frontier = Array.from(visited);
  let hopCount = 0;

  for (
    let hop = 0;
    hop < MAX_ROTATION_HOPS &&
    frontier.length > 0 &&
    visited.size < MAX_CANDIDATE_DATASET_IDS;
    hop += 1
  ) {
    const inValues = frontier.join(",");
    const rows: Array<{ pid_from?: string | null; pid_to?: string | null }> =
      [];
    let queryFailed = false;

    for (let page = 0; page < MAX_ROTATION_QUERY_PAGES; page += 1) {
      const from = page * ROTATION_QUERY_PAGE_SIZE;
      const to = from + ROTATION_QUERY_PAGE_SIZE - 1;

      const { data, error } = await options.supabaseAdmin
        .from("member_id_hash_rotations")
        .select("pid_from,pid_to")
        .eq("canonical_user_id", options.actorUserId)
        .or(`pid_to.in.(${inValues}),pid_from.in.(${inValues})`)
        .range(from, to);

      if (error) {
        if (isSchemaObjectMissingError(error)) {
          console.warn(
            "[fleet] member_id_hash_rotations unavailable; using seed dataset IDs only",
          );
        } else {
          console.warn(
            "[fleet] member_id_hash_rotations query failed; using seed dataset IDs only",
            {
              actor_user_id: options.actorUserId,
              error: (error as { message?: unknown }).message,
            },
          );
        }
        queryFailed = true;
        break;
      }

      const pageRows = Array.isArray(data)
        ? (data as Array<{ pid_from?: string | null; pid_to?: string | null }>)
        : [];
      rows.push(...pageRows);

      if (pageRows.length < ROTATION_QUERY_PAGE_SIZE) {
        break;
      }
    }

    if (queryFailed) {
      break;
    }

    const nextFrontier: string[] = [];

    for (const row of rows) {
      const candidates = [row.pid_from, row.pid_to];
      for (const candidate of candidates) {
        const normalized = normalizeDatasetId(candidate);
        if (!normalized || visited.has(normalized)) continue;

        visited.add(normalized);
        nextFrontier.push(normalized);

        if (visited.size >= MAX_CANDIDATE_DATASET_IDS) {
          break;
        }
      }

      if (visited.size >= MAX_CANDIDATE_DATASET_IDS) {
        break;
      }
    }

    if (nextFrontier.length === 0) {
      break;
    }

    frontier = nextFrontier;
    hopCount = hop + 1;
  }

  const datasetIds = Array.from(visited).slice(0, MAX_CANDIDATE_DATASET_IDS);
  return {
    datasetIds,
    hopCount,
    resolvedFromHistorical: datasetIds.length > seedSetSize ? 1 : 0,
  };
}

/**
 * 認証情報から dataset_id (member_id_hash) を解決する。
 * 優先順位:
 *   1. Authorization: Bearer <supabase_jwt> → JWT metadata / legacy canonical user_member_map
 *   2. X-Dataset-Token → JWT ペイロードの dataset_id
 *
 * @returns { datasetId: string } on success, or { error: string, status: number } on failure
 */
async function resolveDatasetId(
  c: any,
): Promise<FleetAuthResolution | FleetAuthFailure> {
  const env = createEnvContext(c);

  const tryResolveFromDatasetToken = async (): Promise<
    FleetAuthResolution | FleetAuthFailure | null
  > => {
    const datasetTokenHeader = c.req.header("X-Dataset-Token");
    if (!datasetTokenHeader) return null;

    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetTokenHeader,
      secret: getEnv(env, "DATASET_TOKEN_SECRET"),
    });
    if (!tokenValidation.ok || !tokenValidation.token) {
      return {
        ok: false,
        error: tokenValidation.error ?? "Invalid or expired dataset_token",
        status: tokenValidation.status ?? 401,
      };
    }

    const actorUserId = tokenValidation.token.user_id;
    let supabaseAdmin: any | null = null;
    const envCtx = createEnvContext(c);
    const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
    if (url && serviceRoleKey) {
      supabaseAdmin = createClient(url, serviceRoleKey);
    }

    const canonicalDatasetId = await resolveCanonicalDatasetIdBestEffort({
      supabaseAdmin,
      actorUserId,
      fallbackDatasetId: tokenValidation.token.dataset_id,
    });

    console.log(
      `[fleet] dataset_id resolved from X-Dataset-Token: ${tokenValidation.token.dataset_id.slice(0, 8)}...`,
    );

    return {
      ok: true,
      datasetId: tokenValidation.token.dataset_id,
      actorUserId,
      authSource: "dataset_token",
      canonicalDatasetId,
      supabaseAdmin,
    };
  };

  // 1. Bearer JWT → JWT metadata / legacy canonical owner map (anonymous-only mode)
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (accessToken) {
    const user = await validateJWT(accessToken);
    if (!user?.id) {
      console.warn("[fleet] JWT validation failed for provided access token");
      const tokenFallback = await tryResolveFromDatasetToken();
      if (tokenFallback) return tokenFallback;
      return {
        ok: false,
        error: "Invalid or expired access token",
        status: 401,
      };
    }

    const envCtx = createEnvContext(c);
    const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
    if (!url || !serviceRoleKey) {
      const tokenFallback = await tryResolveFromDatasetToken();
      if (tokenFallback?.ok) return tokenFallback;
      console.error(
        "[fleet] Supabase configuration missing for user_member_map lookup",
      );
      return { ok: false, error: "Server misconfiguration", status: 500 };
    }

    const supabaseAdmin = createClient(url, serviceRoleKey);

    try {
      const resolvedMember = await resolveLinkedMemberIdHashForUser({
        supabaseAdmin,
        userId: user.id,
        jwtPayload: user.payload,
      });

      console.log("[fleet] dataset resolution result:", {
        user_id: user.id,
        source: resolvedMember.source,
        member_id_hash: resolvedMember.memberIdHash
          ? `${resolvedMember.memberIdHash.slice(0, 8)}...`
          : null,
      });

      if (!resolvedMember.memberIdHash) {
        const tokenFallback = await tryResolveFromDatasetToken();
        if (tokenFallback?.ok) return tokenFallback;
        return {
          ok: false,
          error:
            "No game account linked to this FUSOU account. Please link your game account via FUSOU-APP first.",
          status: 403,
        };
      }

      const canonicalDatasetId = await resolveCanonicalDatasetIdBestEffort({
        supabaseAdmin,
        actorUserId: user.id,
        fallbackDatasetId: resolvedMember.memberIdHash,
      });

      return {
        ok: true,
        datasetId: resolvedMember.memberIdHash,
        actorUserId: user.id,
        authSource: "jwt",
        canonicalDatasetId,
        supabaseAdmin,
      };
    } catch (err) {
      console.error("[fleet] Unexpected error while resolving dataset:", err);
      const tokenFallback = await tryResolveFromDatasetToken();
      if (tokenFallback?.ok) return tokenFallback;
      return { ok: false, error: "Failed to resolve dataset", status: 500 };
    }
  }

  // 2. X-Dataset-Token → dataset_id from JWT payload
  const tokenFallback = await tryResolveFromDatasetToken();
  if (tokenFallback) return tokenFallback;

  return {
    ok: false,
    error: "Authentication required. Please sign in first.",
    status: 401,
  };
}

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// POST /snapshot
app.post("/snapshot", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.FLEET_SNAPSHOT_BUCKET;
  const signingSecret = getEnv(env, "FLEET_SNAPSHOT_SIGNING_SECRET");

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    requireDatasetToken: true,
    tokenTTL: SNAPSHOT_TOKEN_TTL_SECONDS,
    preparationValidator: async (body, _user, authContext) => {
      const rawTag = typeof body?.tag === "string" ? body.tag.trim() : "";
      const datasetIdFromToken =
        authContext.datasetToken?.dataset_id?.trim() ?? "";
      const requestedDatasetId =
        typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      if (requestedDatasetId && requestedDatasetId !== datasetIdFromToken) {
        console.warn(`[fleet-snapshot] dataset_id mismatch detected`);
        return c.json({ error: "dataset_id does not match token" }, 403);
      }

      const datasetId = datasetIdFromToken || requestedDatasetId;
      const contentHash =
        typeof body?.content_hash === "string" ? body.content_hash.trim() : "";

      if (!rawTag) {
        return c.json({ error: "tag is required" }, 400);
      }

      if (!datasetId) {
        return c.json({ error: "dataset_id could not be resolved" }, 401);
      }

      // Sanitize tag to a URL-safe slug (lowercase, hyphens)
      const tag = normalizeFleetTag(rawTag);

      if (!tag) {
        return c.json({ error: "tag becomes empty after sanitization" }, 400);
      }

      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }

      return {
        tokenPayload: {
          tag,
          dataset_id: datasetId,
          content_hash: contentHash,
        },
        fields: { tag, dataset_id: datasetId },
      };
    },
    executionProcessor: async (tokenPayload, data, _user) => {
      const tag = tokenPayload.tag;
      const datasetId =
        typeof tokenPayload?.dataset_id === "string"
          ? tokenPayload.dataset_id.trim()
          : "";

      if (!tag) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      if (!datasetId) {
        return c.json(
          { error: "Invalid token payload (missing dataset_id)" },
          400,
        );
      }

      // Verify content_hash of the uploaded data against the hash committed in Stage 1.
      // This ensures data integrity across the two-stage upload and matches the pattern
      // used by remodel_data.ts, ship_growth.ts and master_data.ts.
      const expectedHash = String(
        tokenPayload.content_hash ?? "",
      ).toLowerCase();
      if (!expectedHash) {
        return c.json(
          { error: "Invalid token payload (missing content_hash)" },
          400,
        );
      }
      const actualHashBuf = await crypto.subtle.digest(
        "SHA-256",
        data as unknown as BufferSource,
      );
      const actualHash = Array.from(new Uint8Array(actualHashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toLowerCase();
      if (!timingSafeEqual(actualHash, expectedHash)) {
        console.warn(
          `[fleet-snapshot] Content hash mismatch: expected=${expectedHash}, actual=${actualHash}`,
        );
        return c.json(
          { error: "Content hash mismatch - data may be corrupted" },
          400,
        );
      }

      // Treat very small payloads as empty and skip upload
      if (data && data.byteLength <= SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES) {
        return {
          response: {
            ok: true,
            skipped: true,
            reason: `payload <=${SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES}B treated as empty; upload skipped`,
            tag,
          },
        };
      }

      // Parse and validate payload from data
      let payload: any;
      try {
        const text = new TextDecoder().decode(data);
        payload = JSON.parse(text);
      } catch {
        return c.json({ error: "Invalid JSON payload" }, 400);
      }

      const isEmptyObject =
        payload !== null &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        Object.keys(payload).length === 0;
      const isEmptyArray = Array.isArray(payload) && payload.length === 0;

      if (isEmptyObject || isEmptyArray) {
        return c.json({ error: "Empty payload is not allowed" }, 400);
      }

      // Compress JSON payload
      const text = JSON.stringify(payload);
      const encoder = new TextEncoder();
      const jsonData = encoder.encode(text);

      let compressed: Uint8Array;
      try {
        const cs = new CompressionStream("gzip");
        const stream = new Response(jsonData).body!.pipeThrough(cs);
        const buf = await new Response(stream).arrayBuffer();
        compressed = new Uint8Array(buf);
      } catch {
        return c.json({ error: "Compression failed" }, 500);
      }

      // Generate filename with hash
      const hashBuf = await crypto.subtle.digest(
        "SHA-256",
        compressed.slice(0),
      );
      const hashHex = Array.from(new Uint8Array(hashBuf as ArrayBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Normalize tag to a safe slug and ensure uniqueness by appending content hash prefix
      const safeTag = encodeFleetTagPath(tag);
      const hashPrefix = hashHex.slice(0, 8);
      const version = Date.now();
      // Store under dataset_id (hashed member_id), aligning with battle-data convention
      const fileName = `fleets/${datasetId}/${safeTag}/${version}-${hashPrefix}-${hashHex}.json.gz`;

      // Upload to R2
      await bucket.put(fileName, compressed, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "no-cache",
        },
      });

      // Keep only the latest N snapshots for this tag: delete older versions
      try {
        const prefix = `fleets/${datasetId}/${safeTag}/`;
        const listed = await listAllObjectsByPrefix(bucket, prefix);
        const objects = listed.objects || [];
        // Sort by uploaded time descending (newest first)
        const sorted = objects.sort(compareSnapshotRecency);
        const toKeep = new Set(
          sorted
            .slice(0, Math.max(SNAPSHOT_KEEP_LATEST_COUNT_PER_TAG, 1))
            .map((o: any) => o.key),
        );
        // Ensure the just-uploaded file is always kept
        toKeep.add(fileName);
        const keysToDelete = sorted
          .map((o: any) => o.key)
          .filter((key: string) => !toKeep.has(key));

        if (typeof bucket.delete !== "function") {
          console.warn(
            "[fleet] bucket.delete unavailable — skipping old snapshot cleanup",
          );
        } else {
          for (const key of keysToDelete) {
            await bucket.delete(key);
          }
        }
      } catch (err) {
        console.warn("snapshot cleanup failed", err);
      }

      return {
        response: { ok: true, tag },
      };
    },
  });
});

// GET /snapshot/:tag - Retrieve fleet snapshot from R2
app.get("/snapshot/:tag", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.FLEET_SNAPSHOT_BUCKET;

  if (!bucket) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const tag = c.req.param("tag");
  if (!tag) {
    return c.json({ error: "tag is required" }, 400);
  }

  const normalizedTag = normalizeFleetTag(tag);
  if (!normalizedTag) {
    return c.json({ error: "tag becomes empty after sanitization" }, 400);
  }

  const resolved = await resolveDatasetId(c);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);

  const candidates = await resolveFleetDatasetCandidates({
    supabaseAdmin: resolved.supabaseAdmin,
    actorUserId: resolved.actorUserId,
    currentDatasetId: resolved.datasetId,
    canonicalDatasetId: resolved.canonicalDatasetId,
  });

  console.log("[fleet] event=fleet_rotation_candidates_resolved", {
    request_path: "/snapshot/:tag",
    auth_source: resolved.authSource,
    seed_count: new Set(
      [resolved.datasetId, resolved.canonicalDatasetId].filter(
        (value): value is string => Boolean(normalizeDatasetId(value)),
      ),
    ).size,
    candidate_count: candidates.datasetIds.length,
    hop_count: candidates.hopCount,
    resolved_from_historical: candidates.resolvedFromHistorical,
  });

  const safeTag = encodeFleetTagPath(normalizedTag);

  try {
    const allObjects: R2ObjectLite[] = [];
    let totalPages = 0;

    for (const datasetId of candidates.datasetIds) {
      const prefix = `fleets/${datasetId}/${safeTag}/`;
      const listed = await listAllObjectsByPrefix(bucket, prefix);
      totalPages += listed.pagesScanned;
      allObjects.push(...listed.objects);
    }

    console.log("[fleet] event=fleet_rotation_fallback_hit", {
      request_path: "/snapshot/:tag",
      candidate_count: candidates.datasetIds.length,
      r2_pages_scanned: totalPages,
      resolved_from_historical: candidates.resolvedFromHistorical,
    });

    if (allObjects.length === 0) {
      return c.json({ error: "No snapshots found for this tag" }, 404);
    }

    // Sort by uploaded time descending to get the latest
    const sorted = allObjects.sort(compareSnapshotRecency);

    const latestKey = sorted[0].key;
    const object = await bucket.get(latestKey);

    if (!object) {
      return c.json({ error: "Failed to retrieve snapshot" }, 500);
    }

    // Decompress gzip
    const compressed = await object.arrayBuffer();
    let jsonText: string;
    try {
      const ds = new DecompressionStream("gzip");
      const stream = new Response(compressed).body!.pipeThrough(ds);
      jsonText = await new Response(stream).text();
    } catch {
      // Not gzip, try as plain text
      jsonText = new TextDecoder().decode(compressed);
    }

    const data = JSON.parse(jsonText);
    return c.json({
      ok: true,
      tag,
      snapshot: data,
    });
  } catch (err) {
    console.error("[fleet-snapshot] GET error:", err);
    return c.json({ error: "Failed to retrieve fleet snapshot" }, 500);
  }
});

// GET /snapshots/list - List available fleet snapshot tags
app.get("/snapshots/list", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.FLEET_SNAPSHOT_BUCKET;

  if (!bucket) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const resolved = await resolveDatasetId(c);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);

  const candidates = await resolveFleetDatasetCandidates({
    supabaseAdmin: resolved.supabaseAdmin,
    actorUserId: resolved.actorUserId,
    currentDatasetId: resolved.datasetId,
    canonicalDatasetId: resolved.canonicalDatasetId,
  });

  console.log("[fleet] event=fleet_rotation_candidates_resolved", {
    request_path: "/snapshots/list",
    auth_source: resolved.authSource,
    seed_count: new Set(
      [resolved.datasetId, resolved.canonicalDatasetId].filter(
        (value): value is string => Boolean(normalizeDatasetId(value)),
      ),
    ).size,
    candidate_count: candidates.datasetIds.length,
    hop_count: candidates.hopCount,
    resolved_from_historical: candidates.resolvedFromHistorical,
  });

  try {
    const objects: R2ObjectLite[] = [];
    let totalPages = 0;

    for (const datasetId of candidates.datasetIds) {
      const prefix = `fleets/${datasetId}/`;
      const listed = await listAllObjectsByPrefix(bucket, prefix);
      totalPages += listed.pagesScanned;
      objects.push(...listed.objects);
    }

    console.log("[fleet] event=fleet_rotation_fallback_hit", {
      request_path: "/snapshots/list",
      candidate_count: candidates.datasetIds.length,
      r2_pages_scanned: totalPages,
      resolved_from_historical: candidates.resolvedFromHistorical,
    });

    // Group by tag (second path segment after dataset_id)
    const tagMap = new Map<
      string,
      { key: string; uploaded: Date; size: number }
    >();
    for (const obj of objects) {
      const parts = obj.key.split("/");
      if (parts.length < 4 || parts[0] !== "fleets") continue;

      let decodedTag = "";
      try {
        decodedTag = decodeURIComponent(parts[2] || "");
      } catch {
        decodedTag = parts[2] || "";
      }

      const tagName = normalizeFleetTag(decodedTag);
      if (!tagName) continue;

      const existing = tagMap.get(tagName);
      const objTime = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
      const existingTime = existing?.uploaded
        ? new Date(existing.uploaded).getTime()
        : 0;

      if (
        !existing ||
        objTime > existingTime ||
        (objTime === existingTime && obj.key.localeCompare(existing.key) < 0)
      ) {
        tagMap.set(tagName, {
          key: obj.key,
          uploaded: obj.uploaded,
          size: obj.size,
        });
      }
    }

    const tags = Array.from(tagMap.entries()).map(([name, info]) => ({
      tag: name,
      uploaded: info.uploaded,
      size: info.size,
    }));

    return c.json({
      ok: true,
      count: tags.length,
      tags,
    });
  } catch (err) {
    console.error("[fleet-snapshot] list error:", err);
    return c.json({ error: "Failed to list fleet snapshots" }, 500);
  }
});

// DELETE /snapshot/:tag - Delete all fleet snapshots for a tag
app.delete("/snapshot/:tag", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.FLEET_SNAPSHOT_BUCKET;

  if (!bucket || typeof bucket.delete !== "function") {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  const tag = c.req.param("tag");
  if (!tag) {
    return c.json({ error: "tag is required" }, 400);
  }

  const normalizedTag = normalizeFleetTag(tag);
  if (!normalizedTag) {
    return c.json({ error: "tag becomes empty after sanitization" }, 400);
  }

  const resolved = await resolveDatasetId(c);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);

  const candidates = await resolveFleetDatasetCandidates({
    supabaseAdmin: resolved.supabaseAdmin,
    actorUserId: resolved.actorUserId,
    currentDatasetId: resolved.datasetId,
    canonicalDatasetId: resolved.canonicalDatasetId,
  });

  console.log("[fleet] event=fleet_rotation_candidates_resolved", {
    request_path: "/snapshot/:tag:delete",
    auth_source: resolved.authSource,
    seed_count: new Set(
      [resolved.datasetId, resolved.canonicalDatasetId].filter(
        (value): value is string => Boolean(normalizeDatasetId(value)),
      ),
    ).size,
    candidate_count: candidates.datasetIds.length,
    hop_count: candidates.hopCount,
    resolved_from_historical: candidates.resolvedFromHistorical,
  });

  const safeTag = encodeFleetTagPath(normalizedTag);

  try {
    const objects: R2ObjectLite[] = [];
    let totalPages = 0;

    for (const datasetId of candidates.datasetIds) {
      const prefix = `fleets/${datasetId}/${safeTag}/`;
      const listed = await listAllObjectsByPrefix(bucket, prefix);
      totalPages += listed.pagesScanned;
      objects.push(...listed.objects);
    }

    console.log("[fleet] event=fleet_rotation_fallback_hit", {
      request_path: "/snapshot/:tag:delete",
      candidate_count: candidates.datasetIds.length,
      r2_pages_scanned: totalPages,
      resolved_from_historical: candidates.resolvedFromHistorical,
    });

    if (objects.length === 0) {
      return c.json({ ok: true, deleted: 0, tag });
    }

    for (const obj of objects) {
      await bucket.delete(obj.key);
    }

    return c.json({
      ok: true,
      deleted: objects.length,
      tag,
    });
  } catch (err) {
    console.error("[fleet-snapshot] delete error:", err);
    return c.json({ error: "Failed to delete fleet snapshot" }, 500);
  }
});

export default app;
