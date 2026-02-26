/**
 * Formulas API route — serves formula analysis results.
 *
 * GET  /list        → list all formula results (index)
 * GET  /:id         → get a single formula artifact
 * POST /upload      → upload a new formula artifact (requires API key)
 */

import { Hono } from "hono";
import type { Bindings } from "../types";
import { createEnvContext, getEnv } from "../utils";
import {
  createFormulaStore,
  type FormulaArtifact,
} from "../stores/formula-store";

const app = new Hono<{ Bindings: Bindings }>();

/**
 * GET /list — return all formula index entries.
 */
app.get("/list", async (c) => {
  const env = createEnvContext(c);
  const store = createFormulaStore(env);

  try {
    const entries = await store.list();
    return c.json({ ok: true, data: entries });
  } catch (err) {
    console.error("[formulas/list] Error:", err);
    return c.json({ ok: false, error: "Failed to list formulas" }, 500);
  }
});

/**
 * GET /:id — return a single formula artifact by id.
 */
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id || id === "list" || id === "upload") {
    return c.json({ ok: false, error: "Invalid id" }, 400);
  }

  const env = createEnvContext(c);
  const store = createFormulaStore(env);

  try {
    const artifact = await store.get(id);
    if (!artifact) {
      return c.json({ ok: false, error: "Formula not found" }, 404);
    }
    return c.json({ ok: true, data: artifact });
  } catch (err) {
    console.error(`[formulas/${id}] Error:`, err);
    return c.json({ ok: false, error: "Failed to retrieve formula" }, 500);
  }
});

/**
 * POST /upload — upload a new formula artifact.
 * Requires X-API-KEY header matching ADMIN_TOKEN.
 */
app.post("/upload", async (c) => {
  const env = createEnvContext(c);
  const adminToken = getEnv(env, "ADMIN_TOKEN");

  // Auth check
  const apiKey = c.req.header("X-API-KEY");
  if (!adminToken || apiKey !== adminToken) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const body = await c.req.json<FormulaArtifact>();

    if (!body.id || !body.target) {
      return c.json(
        { ok: false, error: "Missing required fields: id, target" },
        400,
      );
    }

    const store = createFormulaStore(env);
    await store.put(body);

    return c.json({ ok: true, id: body.id, message: "Uploaded successfully" });
  } catch (err) {
    console.error("[formulas/upload] Error:", err);
    return c.json({ ok: false, error: "Upload failed" }, 500);
  }
});

export default app;
