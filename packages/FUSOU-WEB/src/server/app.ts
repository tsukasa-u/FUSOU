import { Hono } from "hono";
import { logger } from "hono/logger";
import type { Bindings } from "./types";
import { CORS_HEADERS } from "./constants";

import authApp from "./routes/auth";
import assetsApp from "./routes/assets";
import fleetApp from "./routes/fleet";
import kcApp from "./routes/kc";
import compactApp from "./routes/compact";
import battleDataApp from "./routes/battle_data";
import userApp from "./routes/user";
import analyticsApp from "./routes/analytics";
import adminApp from "./routes/admin";
import dataLoaderApp from "./routes/data_loader";
import masterDataApp from "./routes/master_data";
import apiKeysApp from "./routes/api_keys";
import memberLookupApp from "./routes/member-lookup";
import anonymousSyncApp from "./routes/anonymous-sync";
import formulasApp from "./routes/formulas";

const app = new Hono<{ Bindings: Bindings }>();

// Global logger
app.use(
  "*",
  logger((msg) => {
    console.log(`[Hono API] ${msg}`);
  }),
);

// Global CORS (preflight)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

// Global CORS (actual responses)
app.use("*", async (c, next) => {
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    // Avoid overriding explicitly-set headers
    if (!c.res.headers.has(k)) c.res.headers.set(k, v);
  }
});

// Global error handler
app.onError((err, c) => {
  console.error("[Hono API] Error occurred:", {
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: true, message: "Internal server error" }, 500);
});

// Mount sub apps
app.route("/auth", authApp);
app.route("/asset-sync", assetsApp); // assetsApp declares /upload, /keys, etc.
app.route("/fleet", fleetApp); // fleetApp declares /snapshot, etc.
app.route("/kc-period", kcApp); // kcApp declares /latest, etc.
app.route("/compaction", compactApp); // compactApp declares /compact, /compact/trigger, /compact/status
app.route("/battle-data", battleDataApp); // battleDataApp declares /upload, /health
app.route("/user", userApp); // userApp declares /member-map/upsert, /member-map
app.route("/analytics", analyticsApp); // analytics app declares /compaction-metrics
app.route("/admin", adminApp); // adminApp declares /fix-mime-types, /backfill-asset-index
app.route("/data-loader", dataLoaderApp); // dataLoaderApp declares /data/:dataset, /verify, /download/:dataset
app.route("/master-data", masterDataApp); // masterDataApp declares /upload (Stage 1), /download-master (Stage 2+3)
app.route("/api-keys", apiKeysApp); // apiKeysApp declares /, /:id, /devices, /devices/:id
app.route("/member-lookup", memberLookupApp); // memberLookupApp declares /check-hash, /verify-ownership
app.route("/auth", anonymousSyncApp); // anonymousSyncApp declares /anonymous-sync
app.route("/formulas", formulasApp); // formulasApp declares /list, /:id, /upload

// Catch-all 404
app.all("*", (c) => {
  return c.json({ error: true, message: "Not found", path: c.req.path }, 404);
});

export default app;
export type AppType = typeof app.route;
