import { Hono } from "hono";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext } from "../utils";
import {
  formatPeriodTagAsTokyoRfc3339,
  getLatestAllowedPeriodTagWithSource,
  listAllowedPeriodTags,
} from "../utils/period-tags";

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// GET /latest - 最新のメンテナンス・アップデート ピリオドタグを取得
app.get("/latest", async (c) => {
  const now = Date.now();
  const envCtx = createEnvContext(c);
  const kv = envCtx.runtime["DATA_LOADER_CACHE_KV"];

  try {
    const latest = await getLatestAllowedPeriodTagWithSource(c, {
      cacheKV: kv,
    });

    const payload = {
      tag: latest.tag ? formatPeriodTagAsTokyoRfc3339(latest.tag) : null,
      period_tag: latest.tag ?? null, // YYYY-MM-DD
      fetchedAt: new Date(now).toISOString(),
      cached: latest.cached,
    };

    return c.json(payload);
  } catch (error) {
    console.error("[kc-period] Exception during fetch:", error);
    return c.json({ error: "Failed to fetch period" }, 502);
  }
});

// GET /tags (または /list) - 過去の仕様変更・メンテナンスごとの全ピリオドタグ一覧を取得
app.get("/tags", async (c) => {
  const envCtx = createEnvContext(c);
  const kv = envCtx.runtime["DATA_LOADER_CACHE_KV"];

  try {
    const tags = await listAllowedPeriodTags(c, {
      cacheKV: kv,
      limit: 100,
    });

    return c.json({
      success: true,
      period_tags: tags,
      latest: tags[0] ?? null,
    });
  } catch (error) {
    console.error("[kc-period] Exception during tags list fetch:", error);
    return c.json({ error: "Failed to fetch period tags" }, 502);
  }
});

app.get("/list", async (c) => {
  return c.redirect("/api/kc-period/tags");
});

export default app;
