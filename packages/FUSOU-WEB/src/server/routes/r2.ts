import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { getRuntimeEnv, getEnvValue } from "../utils";
import { handleTwoStageUpload } from "../utils/upload";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * R2 server-side upload routes
 * Handles uploads to Cloudflare R2 via server-side bucket.put with JWT authentication
 * Uses common two-stage upload handler with hash verification
 */

// OPTIONS (CORS)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// POST /upload - 2-stage upload with JWT authentication
app.post("/upload", async (c) => {
  const runtimeEnv = getRuntimeEnv(c);
  const bucket = runtimeEnv.R2_BUCKET_BINDING;
  const signingSecret = getEnvValue("R2_SIGNING_SECRET", runtimeEnv);

  if (!bucket || !signingSecret) {
    return c.json({ error: "Server misconfiguration" }, 500);
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    preparationValidator: async (body, userId) => {
      let path = typeof body?.path === "string" ? body.path.trim() : "";
      const isBinary = Boolean(body?.binary);
      const contentHash = typeof body?.content_hash === "string" ? body.content_hash.trim() : "";

      if (!path) {
        return c.json({ error: "path is required" }, 400);
      }

      if (!contentHash) {
        return c.json({ error: "content_hash (SHA-256) is required" }, 400);
      }

      // Normalize path to user-scoped storage
      const relative = path.replace(/^\/+/, "");
      const normalizedPath = `databases/${userId}/${relative}`;

      return {
        tokenPayload: {
          path: normalizedPath,
          binary: isBinary,
          content_hash: contentHash,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      const tokenPath = tokenPayload.path;

      if (!tokenPath) {
        return c.json({ error: "Invalid token payload" }, 400);
      }

      // Upload to R2
      await bucket.put(tokenPath, data, {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "no-cache",
        },
        customMetadata: {
          uploaded_by: user.id,
        },
      });

      return {
        response: { ok: true, path: tokenPath, size: data.length },
      };
    },
  });
});

// GET /health - health check for R2 signing service
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

export default app;
