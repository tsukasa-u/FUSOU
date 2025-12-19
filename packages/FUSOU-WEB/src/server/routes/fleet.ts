import { Hono } from "hono";
import type { Bindings } from "../types";
import { createEnvContext, getEnv } from "../utils";
import {
  CORS_HEADERS,
  SNAPSHOT_TOKEN_TTL_SECONDS,
  SNAPSHOT_EMPTY_PAYLOAD_THRESHOLD_BYTES,
  SNAPSHOT_KEEP_LATEST_COUNT_PER_TAG,
} from "../constants";
import { handleTwoStageUpload } from "../utils/upload";

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
      const rawTag = typeof body?.tag === "string" ? body.tag.trim() : "";
      const datasetId = typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";

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
      const datasetId = typeof tokenPayload?.dataset_id === "string" ? tokenPayload.dataset_id.trim() : "";
      const ownerId = user?.id;

      if (!tag) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      if (!datasetId) {
        return c.json({ error: "Invalid token payload (missing dataset_id)" }, 400);
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
      const hashBuf = await crypto.subtle.digest("SHA-256", compressed.slice(0));
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
        const prefix = `fleets/${ownerId}/${safeTag}/`;
        const listed = await bucket.list({ prefix });
        const objects = listed.objects || [];
        // Sort by uploaded time descending (newest first)
        const sorted = objects.sort((a: any, b: any) => {
          const at = a.uploaded ? new Date(a.uploaded).getTime() : 0;
          const bt = b.uploaded ? new Date(b.uploaded).getTime() : 0;
          return bt - at;
        });
        const toKeep = new Set(
          sorted.slice(0, Math.max(SNAPSHOT_KEEP_LATEST_COUNT_PER_TAG, 1)).map((o: any) => o.key),
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

export default app;
