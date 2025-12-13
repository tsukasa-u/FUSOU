import { Hono } from "hono";
import type { Bindings } from "../types";
import { getEnvValue, getRuntimeEnv } from "../utils";
import {
  CORS_HEADERS,
  SNAPSHOT_TOKEN_TTL_SECONDS,
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
  const runtimeEnv = getRuntimeEnv(c);
  const bucket = runtimeEnv.ASSET_PAYLOAD_BUCKET;
  const signingSecret = getEnvValue("FLEET_SNAPSHOT_SIGNING_SECRET", runtimeEnv);

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    tokenTTL: SNAPSHOT_TOKEN_TTL_SECONDS,
    preparationValidator: async (body, _userId) => {
      const tag = typeof body?.tag === "string" ? body.tag.trim() : "";
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";

      if (!tag) {
        return c.json({ error: "tag is required" }, 400);
      }

      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }

      return {
        tokenPayload: {
          tag,
          content_hash: contentHash,
        },
        fields: { tag },
      };
    },
    executionProcessor: async (tokenPayload, data, _userId) => {
      const tag = tokenPayload.tag;

      if (!tag) {
        return c.json({ error: "Invalid token payload" }, 400);
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

      const version = Date.now();
      const ownerId = "user-" + Date.now();
      const fileName = `fleets/${ownerId}/${encodeURIComponent(
        tag,
      )}/${version}-${hashHex}.json.gz`;

      // Upload to R2
      await bucket.put(fileName, compressed, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "no-cache",
        },
      });

      return {
        response: { ok: true, tag, r2_key: fileName },
      };
    },
  });
});

export default app;
