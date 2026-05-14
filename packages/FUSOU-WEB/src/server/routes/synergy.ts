import { Hono } from "hono";
import type {
  SynergyManifest,
  SynergyManifestRequest,
  SynergyManifestResponse,
} from "../types/synergy";
import {
  validateSHA256,
  validateGeneratorVersion,
  getSynergyManifestR2Keys,
} from "../types/synergy";
import type { Bindings } from "../types";
import { createEnvContext, verifyAdminToken } from "../utils";
import {
  isValidPeriodTagDate,
  validateCachedPeriodTag,
} from "../utils/period-tags";

const app = new Hono<{ Bindings: Bindings }>();

async function decompressBytes(
  body: Uint8Array,
  format: "gzip" | "br",
): Promise<Uint8Array> {
  const ds = new DecompressionStream(format as CompressionFormat);
  const ab = new Uint8Array(body).buffer;
  const stream = new Blob([ab]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

async function decodeSynergyPayload(body: Uint8Array): Promise<Uint8Array> {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    return await decompressBytes(body, "gzip");
  }
  // Brotli stream magic heuristic (RFC7932): first byte is often 0x8b/0x8f/0x93 etc.
  // We avoid strict magic and try decode only when payload is not plain JSON.
  if (body.length > 0 && body[0] !== 0x7b && body[0] !== 0x5b) {
    try {
      return await decompressBytes(body, "br");
    } catch {
      // not brotli; fall through as-is
    }
  }
  return body;
}

const EMPTY_SYNERGY_DATA = {
  effect_rules: [],
  cross_rules: [],
  _meta: {
    api_start2_batch_hash: "unknown",
    table_version: "unknown",
    generator_version: "unknown",
    generated_at: "1970-01-01T00:00:00.000Z",
  },
};

/**
 * GET /synergy-manifest
 * (Mounted at /master-data → full path: /api/master-data/synergy-manifest)
 *
 * Retrieve latest synergy manifest for a given period_tag
 */
app.get("/synergy-manifest", async (c) => {
  const periodTag = c.req.query("period_tag");

  if (!periodTag) {
    return c.json({ error: "period_tag query parameter is required" }, 400);
  }

  if (!isValidPeriodTagDate(periodTag)) {
    return c.json(
      { error: "Invalid period_tag format (expected YYYY-MM-DD)" },
      400,
    );
  }

  const db = c.env.MASTER_DATA_INDEX_DB;

  try {
    const stmt = db.prepare(`
      SELECT 
        id, period_tag, period_revision, content_hash, sp_effect_sha256,
        api_start2_batch_hash, generator_version, upload_status, completed_at
      FROM synergy_manifest
      WHERE period_tag = ? AND upload_status = 'completed'
      ORDER BY period_revision DESC
      LIMIT 1
    `);

    const result = (await stmt
      .bind(periodTag)
      .first()) as SynergyManifest | null;

    if (!result) {
      return c.json(
        {
          error: `No completed synergy manifest found for period_tag: ${periodTag}`,
        },
        404,
      );
    }

    const r2Keys = getSynergyManifestR2Keys(
      result.period_tag,
      result.period_revision,
      result.content_hash,
    );

    const response: SynergyManifestResponse = {
      period_tag: result.period_tag,
      period_revision: result.period_revision,
      sp_effect_sha256: result.sp_effect_sha256,
      api_start2_batch_hash: result.api_start2_batch_hash,
      generator_version: result.generator_version,
      r2_keys: r2Keys,
      upload_status: result.upload_status as any,
      completed_at: result.completed_at,
    };

    return c.json(response, 200);
  } catch (error) {
    console.error("Error fetching synergy manifest:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /synergy-data
 * (Mounted at /master-data → full path: /api/master-data/synergy-data)
 *
 * Returns sp_effect_item JSON from R2 for the requested period_tag.
 * If period_tag is omitted, returns the latest completed manifest across all periods.
 */
app.get("/synergy-data", async (c) => {
  const periodTagQuery = c.req.query("period_tag");
  if (periodTagQuery && !isValidPeriodTagDate(periodTagQuery)) {
    return c.json(
      { error: "Invalid period_tag format (expected YYYY-MM-DD)" },
      400,
    );
  }

  const envCtx = createEnvContext({ env: c.env });
  const db = c.env.MASTER_DATA_INDEX_DB;
  const bucket = c.env.MASTER_DATA_BUCKET;

  try {
    let effectivePeriodTag = periodTagQuery;
    if (!effectivePeriodTag) {
      const latestMasterData = (await db
        .prepare(
          `SELECT period_tag
           FROM master_data_index
           WHERE upload_status = 'completed'
           ORDER BY completed_at DESC, period_revision DESC
           LIMIT 1`,
        )
        .first()) as { period_tag: string } | null;

      if (latestMasterData?.period_tag) {
        effectivePeriodTag = latestMasterData.period_tag;
      }
    }
    // Fallback to synergy_manifest if needed
    if (!effectivePeriodTag) {
      const latestSynergy = (await db
        .prepare(
          `SELECT period_tag FROM synergy_manifest WHERE upload_status = 'completed' ORDER BY completed_at DESC, period_revision DESC LIMIT 1`,
        )
        .first()) as { period_tag: string } | null;
      if (latestSynergy?.period_tag) {
        effectivePeriodTag = latestSynergy.period_tag;
      } else {
        if (envCtx.isDev && !periodTagQuery) {
          return c.json(EMPTY_SYNERGY_DATA, 200, {
            "Cache-Control": "public, max-age=300",
            "X-FUSOU-Synergy-Source": "dev-fallback",
            "X-FUSOU-Synergy-Period-Tag": "local-dev",
            "X-FUSOU-Synergy-Period-Revision": "0",
            "X-FUSOU-Synergy-Completed-At": "unknown",
          });
        }
        return c.json({ error: "No completed synergy_manifest found" }, 404);
      }
    }

    let sql = `
      SELECT period_tag, period_revision, content_hash, completed_at
      FROM synergy_manifest
      WHERE upload_status = 'completed'
    `;
    const params: unknown[] = [];

    if (effectivePeriodTag) {
      sql += " AND period_tag = ?";
      params.push(effectivePeriodTag);
    }

    sql += " ORDER BY completed_at DESC, period_revision DESC LIMIT 1";

    let manifest = (await db
      .prepare(sql)
      .bind(...params)
      .first()) as {
      period_tag: string;
      period_revision: number;
      content_hash: string;
      completed_at?: number | null;
    } | null;

    if (!manifest && !periodTagQuery) {
      manifest = (await db
        .prepare(
          `SELECT period_tag, period_revision, content_hash, completed_at
           FROM synergy_manifest
           WHERE upload_status = 'completed'
           ORDER BY completed_at DESC, period_revision DESC
           LIMIT 1`,
        )
        .first()) as {
        period_tag: string;
        period_revision: number;
        content_hash: string;
        completed_at?: number | null;
      } | null;
    }

    if (!manifest) {
      if (envCtx.isDev && !periodTagQuery) {
        return c.json(EMPTY_SYNERGY_DATA, 200, {
          "Cache-Control": "public, max-age=300",
          "X-FUSOU-Synergy-Source": "dev-fallback",
          "X-FUSOU-Synergy-Period-Tag": "local-dev",
          "X-FUSOU-Synergy-Period-Revision": "0",
          "X-FUSOU-Synergy-Completed-At": "unknown",
        });
      }
      return c.json(
        {
          error: periodTagQuery
            ? `No completed synergy manifest found for period_tag: ${periodTagQuery}`
            : `No completed synergy manifest found for period_tag: ${effectivePeriodTag}`,
        },
        404,
      );
    }

    let r2Keys = getSynergyManifestR2Keys(
      manifest.period_tag,
      manifest.period_revision,
      manifest.content_hash,
    );
    let object = await bucket.get(r2Keys.sp_effect_json);

    // When period is not specified, avoid sticking to a manifest row whose object is missing.
    // Pick the latest completed manifest that actually exists in R2.
    if (!object && !periodTagQuery) {
      const candidates = (await db
        .prepare(
          `SELECT period_tag, period_revision, content_hash, completed_at
           FROM synergy_manifest
           WHERE upload_status = 'completed'
           ORDER BY completed_at DESC, period_revision DESC
           LIMIT 20`,
        )
        .all()) as {
        results?: Array<{
          period_tag: string;
          period_revision: number;
          content_hash: string;
          completed_at?: number | null;
        }>;
      };

      for (const candidate of candidates.results ?? []) {
        const candidateKeys = getSynergyManifestR2Keys(
          candidate.period_tag,
          candidate.period_revision,
          candidate.content_hash,
        );
        const candidateObject = await bucket.get(candidateKeys.sp_effect_json);
        if (!candidateObject) continue;
        manifest = candidate;
        r2Keys = candidateKeys;
        object = candidateObject;
        break;
      }
    }

    // Conditional request support: return 304 when client already has this content hash.
    const etag = `"${manifest.content_hash}"`;
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch) {
      const tags = ifNoneMatch
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (tags.includes("*") || tags.includes(etag)) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": "public, max-age=300",
          },
        });
      }
    }

    if (!object) {
      // Fallback: return empty synergy data for local dev
      return c.json(EMPTY_SYNERGY_DATA, 200, {
        ETag: etag,
        "Cache-Control": "public, max-age=300",
        "X-FUSOU-Synergy-Source": "dev-fallback",
        "X-FUSOU-Synergy-Period-Tag": manifest.period_tag,
        "X-FUSOU-Synergy-Period-Revision": manifest.period_revision.toString(),
        "X-FUSOU-Synergy-Completed-At":
          manifest.completed_at?.toString() || "unknown",
      });
    }

    const raw = new Uint8Array(await object.arrayBuffer());
    const decoded = await decodeSynergyPayload(raw);

    const jsonText = new TextDecoder().decode(decoded);

    return new Response(jsonText, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        ETag: etag,
        "X-FUSOU-Synergy-Source": "manifest-r2",
        "X-FUSOU-Synergy-Period-Tag": manifest.period_tag,
        "X-FUSOU-Synergy-Period-Revision": manifest.period_revision.toString(),
        "X-FUSOU-Synergy-Completed-At":
          manifest.completed_at?.toString() || "unknown",
      },
    });
  } catch (error) {
    const msg = String(error);
    if (envCtx.isDev && msg.includes("no such table: synergy_manifest")) {
      return c.json(EMPTY_SYNERGY_DATA, 200, {
        "Cache-Control": "public, max-age=300",
        "X-FUSOU-Synergy-Source": "dev-fallback",
        "X-FUSOU-Synergy-Period-Tag": "local-dev",
        "X-FUSOU-Synergy-Period-Revision": "0",
        "X-FUSOU-Synergy-Completed-At": "unknown",
      });
    }
    console.error("Error fetching synergy data:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /synergy-manifest
 * (Mounted at /master-data → full path: /api/master-data/synergy-manifest)
 *
 * Create new synergy manifest entry (allocate period_revision).
 * Security: requires X-ADMIN-TOKEN header.
 * User will upload files to R2 at returned r2_keys, then call /complete endpoint.
 */
app.post("/synergy-manifest", async (c) => {
  const adminCheck = verifyAdminToken(
    createEnvContext({ env: c.env }),
    c.req.header("X-ADMIN-TOKEN"),
  );
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.error }, adminCheck.status as 401 | 403);
  }

  let body: SynergyManifestRequest;
  try {
    const parsed = await c.req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }
    body = parsed as SynergyManifestRequest;
  } catch {
    return c.json({ error: "Invalid JSON request body" }, 400);
  }

  // Validation
  const periodTagValidation = await validateCachedPeriodTag(
    c,
    body.period_tag,
    {
      cacheKV: c.env.DATA_LOADER_CACHE_KV,
    },
  );
  if (!periodTagValidation.ok) {
    return c.json(
      { error: periodTagValidation.error },
      periodTagValidation.status,
    );
  }

  if (!body.sp_effect_sha256 || !validateSHA256(body.sp_effect_sha256)) {
    return c.json(
      { error: "Invalid sp_effect_sha256 (expected 64-char SHA256 hex)" },
      400,
    );
  }

  if (
    !body.api_start2_batch_hash ||
    !validateSHA256(body.api_start2_batch_hash)
  ) {
    return c.json(
      { error: "Invalid api_start2_batch_hash (expected 64-char SHA256 hex)" },
      400,
    );
  }

  if (
    !body.generator_version ||
    !validateGeneratorVersion(body.generator_version)
  ) {
    return c.json(
      { error: "Invalid generator_version (expected format: vX.Y.Z)" },
      400,
    );
  }

  if (!body.generated_at) {
    return c.json({ error: "generated_at is required (ISO8601 format)" }, 400);
  }

  const generatedAtMs = new Date(body.generated_at).getTime();
  if (Number.isNaN(generatedAtMs)) {
    return c.json(
      { error: "Invalid generated_at (must be a valid ISO8601 date string)" },
      400,
    );
  }
  const generatedAtEpoch = Math.floor(generatedAtMs / 1000);

  const db = c.env.MASTER_DATA_INDEX_DB;

  try {
    // Check if same content_hash already exists for this period_tag.
    // Exclude 'failed' manifests so a re-upload of the same content after a previous
    // failure can create a fresh manifest entry rather than hitting a stale 409.
    const existingStmt = db.prepare(`
      SELECT id, period_revision FROM synergy_manifest
      WHERE period_tag = ? AND sp_effect_sha256 = ?
        AND upload_status != 'failed'
      LIMIT 1
    `);

    const existing = (await existingStmt
      .bind(body.period_tag, body.sp_effect_sha256)
      .first()) as {
      id: number;
      period_revision: number;
    } | null;

    if (existing && existing.id) {
      return c.json(
        {
          error:
            "Duplicate: same sp_effect_sha256 already exists for this period_tag",
          existing_period_revision: existing.period_revision,
        },
        409,
      );
    }

    // Allocate next period_revision
    const revisionStmt = db.prepare(`
      SELECT COALESCE(MAX(period_revision), 0) + 1 as next_revision
      FROM synergy_manifest
      WHERE period_tag = ?
    `);

    const revisionResult = (await revisionStmt
      .bind(body.period_tag)
      .first()) as {
      next_revision: number;
    };
    const nextRevision = revisionResult.next_revision;

    // Generate content_hash (same as sp_effect_sha256 for now; can be extended)
    const contentHash = body.sp_effect_sha256;

    // Insert into D1
    const insertStmt = db.prepare(`
      INSERT INTO synergy_manifest (
        period_tag, period_revision, content_hash, sp_effect_sha256,
        api_start2_batch_hash, generator_version, generated_at, upload_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      RETURNING id, period_tag, period_revision, content_hash
    `);

    const inserted = (await insertStmt
      .bind(
        body.period_tag,
        nextRevision,
        contentHash,
        body.sp_effect_sha256,
        body.api_start2_batch_hash,
        body.generator_version,
        generatedAtEpoch,
      )
      .first()) as {
      id: number;
      period_tag: string;
      period_revision: number;
      content_hash: string;
    } | null;

    if (!inserted || !inserted.id) {
      return c.json({ error: "Failed to allocate period_revision" }, 500);
    }

    const r2Keys = getSynergyManifestR2Keys(
      inserted.period_tag,
      inserted.period_revision,
      inserted.content_hash,
    );

    return c.json(
      {
        id: inserted.id,
        period_tag: inserted.period_tag,
        period_revision: inserted.period_revision,
        r2_keys: r2Keys,
        upload_status: "pending",
        message:
          "Manifest created. Upload files to R2 at r2_keys, then call /complete endpoint.",
      },
      201,
    );
  } catch (error) {
    // D1 UNIQUE constraint on (period_tag, period_revision) fires when two concurrent requests
    // race to allocate the same revision number. Return 409 so the caller can retry.
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json(
        {
          error:
            "Concurrent conflict: period_revision already allocated. Please retry.",
        },
        409,
      );
    }
    console.error("Error creating synergy manifest:", error);
    return c.json(
      { error: "Internal server error", details: String(error) },
      500,
    );
  }
});

/**
 * POST /synergy-manifest/complete/:periodTag/:periodRevision
 * (Mounted at /master-data → full path: /api/master-data/synergy-manifest/complete/:periodTag/:periodRevision)
 *
 * Mark manifest as completed after files uploaded to R2.
 * Security: requires X-ADMIN-TOKEN header.
 * Verifies that the sp_effect_item.json actually exists in R2 before marking completed.
 */
app.post("/synergy-manifest/complete/:periodTag/:periodRevision", async (c) => {
  const adminCheck = verifyAdminToken(
    createEnvContext({ env: c.env }),
    c.req.header("X-ADMIN-TOKEN"),
  );
  if (!adminCheck.ok) {
    return c.json({ error: adminCheck.error }, adminCheck.status as 401 | 403);
  }

  const periodTag = c.req.param("periodTag");
  const periodRevisionStr = c.req.param("periodRevision");

  if (!periodTag || !isValidPeriodTagDate(periodTag)) {
    return c.json({ error: "Invalid period_tag" }, 400);
  }

  const periodRevision = parseInt(periodRevisionStr, 10);
  if (isNaN(periodRevision) || periodRevision <= 0) {
    return c.json(
      { error: "Invalid period_revision (must be positive integer)" },
      400,
    );
  }

  const db = c.env.MASTER_DATA_INDEX_DB;
  const bucket = c.env.MASTER_DATA_BUCKET;

  try {
    // First, look up the pending manifest to get content_hash for R2 verification
    const lookupStmt = db.prepare(`
      SELECT id, content_hash FROM synergy_manifest
      WHERE period_tag = ? AND period_revision = ? AND upload_status = 'pending'
    `);

    const pending = (await lookupStmt
      .bind(periodTag, periodRevision)
      .first()) as {
      id?: number;
      content_hash?: string;
    } | null;

    if (!pending || !pending.id || !pending.content_hash) {
      return c.json(
        {
          error: `No pending manifest found for period_tag=${periodTag}, period_revision=${periodRevision}`,
        },
        404,
      );
    }

    // Verify sp_effect_item.json exists in R2 before marking completed
    const r2Keys = getSynergyManifestR2Keys(
      periodTag,
      periodRevision,
      pending.content_hash,
    );
    const r2Head = await bucket.head(r2Keys.sp_effect_json);

    if (!r2Head) {
      // File not found in R2 — mark as failed
      const failStmt = db.prepare(`
        UPDATE synergy_manifest
        SET upload_status = 'failed'
        WHERE id = ?
      `);
      await failStmt.bind(pending.id).run();

      return c.json(
        {
          error: "sp_effect_item.json not found in R2",
          expected_r2_key: r2Keys.sp_effect_json,
          upload_status: "failed",
        },
        422,
      );
    }

    // R2 object confirmed — mark as completed
    const updateStmt = db.prepare(`
      UPDATE synergy_manifest
      SET upload_status = 'completed', completed_at = CAST(strftime('%s', 'now') AS INTEGER)
      WHERE id = ? AND upload_status = 'pending'
      RETURNING id, period_tag, period_revision, upload_status, completed_at
    `);

    const updated = (await updateStmt.bind(pending.id).first()) as {
      id?: number;
      period_tag?: string;
      period_revision?: number;
      upload_status?: string;
      completed_at?: number;
    } | null;

    if (!updated || !updated.id) {
      return c.json(
        {
          error:
            "Failed to mark manifest as completed (concurrent modification?)",
        },
        409,
      );
    }

    // Mark any previous revisions as 'superseded'
    const supersedStmt = db.prepare(`
      UPDATE synergy_manifest
      SET upload_status = 'superseded'
      WHERE period_tag = ? AND period_revision < ? AND upload_status = 'completed'
    `);

    await supersedStmt.bind(periodTag, periodRevision).run();

    return c.json(
      {
        period_tag: updated.period_tag,
        period_revision: updated.period_revision,
        upload_status: updated.upload_status,
        completed_at: updated.completed_at,
        message: "Manifest marked as completed",
      },
      200,
    );
  } catch (error) {
    console.error("Error completing synergy manifest:", error);
    return c.json(
      { error: "Internal server error", details: String(error) },
      500,
    );
  }
});

/**
 * GET /synergy-manifest/validate
 * (Mounted at /master-data → full path: /api/master-data/synergy-manifest/validate)
 *
 * Pre-backfill validation: checks synergy data readiness for a period_tag.
 * Cross-references api_start2_batch_hash against master_data_index.content_hash.
 */
app.get("/synergy-manifest/validate", async (c) => {
  const periodTag = c.req.query("period_tag");

  if (!periodTag || !isValidPeriodTagDate(periodTag)) {
    return c.json(
      { error: "Invalid or missing period_tag (expected YYYY-MM-DD)" },
      400,
    );
  }

  const db = c.env.MASTER_DATA_INDEX_DB;

  try {
    // 1. Query latest completed synergy manifest
    const manifest = (await db
      .prepare(
        `SELECT period_tag, period_revision, sp_effect_sha256, api_start2_batch_hash,
                generator_version, completed_at
         FROM synergy_manifest
         WHERE period_tag = ? AND upload_status = 'completed'
         ORDER BY period_revision DESC
         LIMIT 1`,
      )
      .bind(periodTag)
      .first()) as {
      period_tag: string;
      period_revision: number;
      sp_effect_sha256: string;
      api_start2_batch_hash: string;
      generator_version: string;
      completed_at: number;
    } | null;

    if (!manifest) {
      return c.json(
        {
          ready: false,
          reason: "no_synergy_manifest",
          message: `No completed synergy manifest for period_tag: ${periodTag}`,
        },
        200,
      );
    }

    // 2. Query latest completed master_data_index to compare batch hash
    const masterData = (await db
      .prepare(
        `SELECT content_hash, period_revision
         FROM master_data_index
         WHERE period_tag = ? AND upload_status = 'completed'
         ORDER BY period_revision DESC
         LIMIT 1`,
      )
      .bind(periodTag)
      .first()) as { content_hash: string; period_revision: number } | null;

    const hashMatch = masterData
      ? masterData.content_hash === manifest.api_start2_batch_hash
      : null;

    return c.json(
      {
        ready: true,
        period_tag: manifest.period_tag,
        synergy: {
          period_revision: manifest.period_revision,
          sp_effect_sha256: manifest.sp_effect_sha256,
          api_start2_batch_hash: manifest.api_start2_batch_hash,
          generator_version: manifest.generator_version,
          completed_at: manifest.completed_at,
        },
        master_data: masterData
          ? {
              content_hash: masterData.content_hash,
              period_revision: masterData.period_revision,
            }
          : null,
        hash_match: hashMatch,
        warning:
          hashMatch === false
            ? "api_start2_batch_hash mismatch: synergy data may be stale"
            : hashMatch === null
              ? "No completed master_data found for this period_tag"
              : undefined,
      },
      200,
    );
  } catch (error) {
    console.error("Error validating synergy manifest:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default app;
