import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext } from "../utils";
import {
  formatPeriodTagAsTokyoRfc3339,
  getLatestAllowedPeriodTagWithSource,
} from "../utils/period-tags";

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// GET /latest
app.get("/latest", async (c) => {
  const now = Date.now();
  const envCtx = createEnvContext(c);
  const kv = envCtx.runtime.DATA_LOADER_CACHE_KV;

  try {
    const latest = await getLatestAllowedPeriodTagWithSource(c, {
      cacheKV: kv,
    });

    const payload = {
      tag: latest.tag ? formatPeriodTagAsTokyoRfc3339(latest.tag) : null,
      fetchedAt: new Date(now).toISOString(),
      cached: latest.cached,
    };

    return c.json(payload);
  } catch (error) {
    console.error("[kc-period] Exception during fetch:", error);
    return c.json({ error: "Failed to fetch period" }, 502);
  }
});

export default app;
