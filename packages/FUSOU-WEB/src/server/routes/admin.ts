import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { extractBearer, timingSafeEqual } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS（CORS）
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

// POST /admin/sync-r2-to-d1
app.post('/admin/sync-r2-to-d1', async (c) => {
  const adminSecret = c.env.ADMIN_API_SECRET || import.meta.env.ADMIN_API_SECRET;
  if (!adminSecret) {
    return c.json({ error: 'Admin API not configured' }, 503);
  }

  const authHeader = c.req.header('Authorization');
  const providedSecret = extractBearer(authHeader);

  if (!providedSecret || !timingSafeEqual(providedSecret, adminSecret)) {
    return c.json({ error: 'Unauthorized: Invalid admin secret' }, 401);
  }

  const bucket = c.env.ASSET_SYNC_BUCKET;
  const db = c.env.ASSET_INDEX_DB;

  if (!bucket || !db) {
    return c.json({ error: 'ASSET_SYNC_BUCKET or ASSET_INDEX_DB not configured' }, 503);
  }

  const startTime = Date.now();

  try {
    let resumeFromKey: string | undefined;
    try {
      const body = await c.req.json();
      resumeFromKey = (body as any).resumeFromKey;
    } catch {
      // No body
    }

    const result: any = {
      scanned: 0,
      existing: 0,
      inserted: 0,
      failed: 0,
      errors: [],
      duration: 0,
      completed: false,
    };

    let cursor: string | undefined;
    let truncated = true;

    while (truncated) {
      const listResult = await bucket.list({ limit: 1000, cursor });
      const batchR2Objects = listResult.objects;

      if (batchR2Objects.length === 0) break;

      result.scanned += batchR2Objects.length;
      const batchKeys = batchR2Objects.map((o) => o.key);

      // Check existing keys in D1
      const existingKeysInBatch = new Set<string>();
      const CHUNK_SIZE = 50;

      for (let i = 0; i < batchKeys.length; i += CHUNK_SIZE) {
        const chunkKeys = batchKeys.slice(i, i + CHUNK_SIZE);
        const chunkPlaceholders = chunkKeys.map(() => '?').join(',');

        try {
          const stmt = db
            .prepare(`SELECT key FROM files WHERE key IN (${chunkPlaceholders})`)
            .bind(...chunkKeys);
          const res = await stmt.all?.();

          if (res?.results) {
            for (const r of res.results) {
              const k = (r as any).key;
              if (typeof k === 'string') existingKeysInBatch.add(k);
            }
          }
        } catch (err) {
          console.error('Failed to check existence', err);
        }
      }

      // Find missing objects
      const missingObjects = batchR2Objects.filter((obj) => !existingKeysInBatch.has(obj.key));

      // Insert missing
      for (const obj of missingObjects) {
        if (resumeFromKey && obj.key < resumeFromKey) continue;

        const uploadedAt = obj.uploaded ? new Date(obj.uploaded).getTime() : Date.now();
        const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
        const customMetadata = obj.customMetadata || {};

        try {
          const stmt = db.prepare(
            'INSERT INTO files (key, size, uploaded_at, content_type, uploader_id, finder_tag, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
          );
          await stmt
            .bind(
              obj.key,
              obj.size,
              uploadedAt,
              contentType,
              customMetadata.uploaded_by || null,
              customMetadata.finder_tag || null,
              JSON.stringify({
                file_name: customMetadata.file_name || null,
                declared_size: customMetadata.declared_size || null,
                synced_from_r2: true,
                synced_at: Date.now(),
              })
            )
            .run();
          result.inserted++;
        } catch (e) {
          result.failed++;
          result.errors.push({ key: obj.key, error: String(e) });
        }
      }

      truncated = listResult.truncated ?? false;
      cursor = listResult.cursor;

      if (Date.now() - startTime > 20000) {
        result.resumeCursor = cursor;
        result.completed = false;
        break;
      }
    }

    if (!result.resumeCursor) {
      result.completed = true;
    }

    result.duration = Date.now() - startTime;
    return c.json(result);
  } catch (e) {
    console.error('Sync operation failed', e);
    return c.json({ error: `Sync failed: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
});

export default app;
