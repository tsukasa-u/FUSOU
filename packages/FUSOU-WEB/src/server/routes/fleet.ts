import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createClient } from "@supabase/supabase-js";
import type { Bindings } from "../types";
import {
  createEnvContext,
  getEnv,
  extractBearer,
  validateJWT,
  resolveSupabaseConfig,
  validateDatasetToken,
} from "../utils";
import {
  CORS_HEADERS,
  SNAPSHOT_TOKEN_TTL_SECONDS,
  SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES,
  SNAPSHOT_KEEP_LATEST_COUNT_PER_TAG,
} from "../constants";
import { handleTwoStageUpload } from "../utils/upload";

/**
 * 認証情報から dataset_id (member_id_hash) を解決する。
 * 優先順位:
 *   1. Authorization: Bearer <supabase_jwt> → user_member_map 参照
 *   2. X-Dataset-Token → JWT ペイロードの dataset_id
 *
 * @returns { datasetId: string } on success, or { error: string, status: number } on failure
 */
async function resolveDatasetId(
  c: any,
): Promise<
  | { ok: true; datasetId: string }
  | { ok: false; error: string; status: ContentfulStatusCode }
> {
  const env = createEnvContext(c);

  // 1. Bearer JWT → user_member_map
  const authHeader = c.req.header("Authorization");
  const accessToken = extractBearer(authHeader);
  if (accessToken) {
    const user = await validateJWT(accessToken);
    if (!user?.id) {
      console.warn("[fleet] JWT validation failed for provided access token");
      return {
        ok: false,
        error: "Invalid or expired access token",
        status: 401,
      };
    }

    console.log(
      `[fleet] Resolving dataset_id for user: id=${user.id}, email=${user.email ?? "n/a"}`,
    );

    const envCtx = createEnvContext(c);
    const { url, serviceRoleKey } = resolveSupabaseConfig(envCtx);
    if (!url || !serviceRoleKey) {
      console.error(
        "[fleet] Supabase configuration missing for user_member_map lookup",
      );
      return { ok: false, error: "Server misconfiguration", status: 500 };
    }

    // Match the exact createClient pattern used by user.ts (no extra auth options)
    const supabaseAdmin = createClient(url, serviceRoleKey);

    try {
      const { data: mapping, error } = await supabaseAdmin
        .from("user_member_map")
        .select("member_id_hash, user_id, created_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("[fleet] user_member_map lookup error:", {
          user_id: user.id,
          error: error.message,
          code: error.code,
          details: error.details,
        });
        return { ok: false, error: "Failed to resolve dataset", status: 500 };
      }

      console.log("[fleet] user_member_map lookup result:", {
        user_id: user.id,
        found: !!mapping,
        member_id_hash: mapping?.member_id_hash
          ? `${mapping.member_id_hash.slice(0, 8)}...`
          : null,
      });

      if (!mapping?.member_id_hash) {
        return {
          ok: false,
          error:
            "No game account linked to this FUSOU account. Please link your game account via FUSOU-APP first.",
          status: 403,
        };
      }

      return { ok: true, datasetId: mapping.member_id_hash };
    } catch (err) {
      console.error("[fleet] Unexpected error in user_member_map query:", err);
      return { ok: false, error: "Failed to resolve dataset", status: 500 };
    }
  }

  // 2. X-Dataset-Token → dataset_id from JWT payload
  const datasetTokenHeader = c.req.header("X-Dataset-Token");
  if (datasetTokenHeader) {
    const secret = getEnv(env, "DATASET_TOKEN_SECRET");
    if (!secret) {
      console.error("[fleet] DATASET_TOKEN_SECRET not configured");
      return { ok: false, error: "Server misconfiguration", status: 500 };
    }
    const validated = await validateDatasetToken(datasetTokenHeader, secret);
    if (!validated) {
      return {
        ok: false,
        error: "Invalid or expired dataset_token",
        status: 401,
      };
    }
    console.log(
      `[fleet] dataset_id resolved from X-Dataset-Token: ${validated.dataset_id.slice(0, 8)}...`,
    );
    return { ok: true, datasetId: validated.dataset_id };
  }

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
    tokenTTL: SNAPSHOT_TOKEN_TTL_SECONDS,
    preparationValidator: async (body, _userId) => {
      // Validate dataset_token if provided
      const datasetTokenHeader = c.req.header("X-Dataset-Token");
      const datasetTokenBody =
        typeof body?.dataset_token === "string"
          ? body.dataset_token.trim()
          : "";
      const datasetToken = datasetTokenHeader || datasetTokenBody;

      if (datasetToken) {
        const datasetTokenSecret = getEnv(env, "DATASET_TOKEN_SECRET");
        if (!datasetTokenSecret) {
          console.error("[fleet-snapshot] DATASET_TOKEN_SECRET not configured");
          return c.json({ error: "Server configuration error" }, 500);
        }

        const validatedToken = await validateDatasetToken(
          datasetToken,
          datasetTokenSecret,
        );
        if (!validatedToken) {
          console.warn("[fleet-snapshot] Invalid or expired dataset_token");
          return c.json({ error: "Invalid or expired dataset_token" }, 401);
        }

        // Verify dataset_id matches token
        const requestedDatasetId =
          typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
        if (requestedDatasetId !== validatedToken.dataset_id) {
          console.warn(`[fleet-snapshot] dataset_id mismatch detected`);
          return c.json({ error: "dataset_id does not match token" }, 403);
        }

        console.log(`[fleet-snapshot] dataset_token validated successfully`);
      }

      const rawTag = typeof body?.tag === "string" ? body.tag.trim() : "";
      const datasetId =
        typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      const contentHash =
        typeof body?.content_hash === "string" ? body.content_hash.trim() : "";

      if (!rawTag) {
        return c.json({ error: "tag is required" }, 400);
      }

      if (!datasetId) {
        return c.json({ error: "dataset_id is required" }, 400);
      }

      // Sanitize tag to a URL-safe slug (lowercase, hyphens)
      const tag = rawTag
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9.-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$|\.$/g, "");

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
    executionProcessor: async (tokenPayload, data, user) => {
      const tag = tokenPayload.tag;
      const datasetId =
        typeof tokenPayload?.dataset_id === "string"
          ? tokenPayload.dataset_id.trim()
          : "";
      const ownerId = user?.id;

      if (!tag) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      if (!datasetId) {
        return c.json(
          { error: "Invalid token payload (missing dataset_id)" },
          400,
        );
      }

      if (!ownerId) {
        return c.json({ error: "User authentication required" }, 401);
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
      const safeTag = encodeURIComponent(tag.toLowerCase().trim());
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
        const listed = await bucket.list({ prefix });
        const objects = listed.objects || [];
        // Sort by uploaded time descending (newest first)
        const sorted = objects.sort((a: any, b: any) => {
          const at = a.uploaded ? new Date(a.uploaded).getTime() : 0;
          const bt = b.uploaded ? new Date(b.uploaded).getTime() : 0;
          return bt - at;
        });
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

        for (const key of keysToDelete) {
          await bucket.delete?.(key);
        }
      } catch (err) {
        console.warn("snapshot cleanup failed", err);
      }

      return {
        response: { ok: true, tag, dataset_id: datasetId, r2_key: fileName },
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

  const resolved = await resolveDatasetId(c);
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  const datasetId = resolved.datasetId;

  // Sanitize tag same way as upload
  const safeTag = encodeURIComponent(tag.toLowerCase().trim());
  const prefix = `fleets/${datasetId}/${safeTag}/`;

  try {
    const listed = await bucket.list({ prefix });
    const objects = listed.objects || [];

    if (objects.length === 0) {
      return c.json({ error: "No snapshots found for this tag" }, 404);
    }

    // Sort by uploaded time descending to get the latest
    const sorted = objects.sort((a: any, b: any) => {
      const at = a.uploaded ? new Date(a.uploaded).getTime() : 0;
      const bt = b.uploaded ? new Date(b.uploaded).getTime() : 0;
      return bt - at;
    });

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
      dataset_id: datasetId,
      r2_key: latestKey,
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
  const datasetId = resolved.datasetId;

  const prefix = `fleets/${datasetId}/`;

  try {
    const listed = await bucket.list({ prefix });
    const objects = listed.objects || [];

    // Group by tag (second path segment after dataset_id)
    const tagMap = new Map<
      string,
      { key: string; uploaded: Date; size: number }
    >();
    for (const obj of objects) {
      const parts = obj.key.replace(prefix, "").split("/");
      const tagName = decodeURIComponent(parts[0] || "");
      if (!tagName) continue;

      const existing = tagMap.get(tagName);
      const objTime = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
      const existingTime = existing?.uploaded
        ? new Date(existing.uploaded).getTime()
        : 0;

      if (!existing || objTime > existingTime) {
        tagMap.set(tagName, {
          key: obj.key,
          uploaded: obj.uploaded,
          size: obj.size,
        });
      }
    }

    const tags = Array.from(tagMap.entries()).map(([name, info]) => ({
      tag: name,
      r2_key: info.key,
      uploaded: info.uploaded,
      size: info.size,
    }));

    return c.json({
      ok: true,
      dataset_id: datasetId,
      count: tags.length,
      tags,
    });
  } catch (err) {
    console.error("[fleet-snapshot] list error:", err);
    return c.json({ error: "Failed to list fleet snapshots" }, 500);
  }
});

export default app;
