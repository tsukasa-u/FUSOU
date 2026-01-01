/**
 * Admin / Maintenance Routes
 * 
 * These endpoints are for administrative and one-time operations.
 * Consider adding authentication or removing after use.
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';
import { createEnvContext } from '../utils';

const adminApp = new Hono<{ Bindings: Bindings }>();

// ===== Authentication Middleware =====
adminApp.use('*', async (c, next) => {
  const env = createEnvContext(c);
  // @ts-ignore - ADMIN_TOKEN might not be in the runtime env type yet but will be available
  const adminToken = env.env?.ADMIN_TOKEN || c.env.ADMIN_TOKEN;
  
  if (!adminToken) {
    // If no token configured, disable admin routes for security
    return c.json({ error: 'Admin routes disabled (ADMIN_TOKEN not set)' }, 403);
  }
  
  const authHeader = c.req.header('X-ADMIN-TOKEN');
  if (!authHeader || authHeader !== adminToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  await next();
});

// ===== MIME Type detection helper =====
function detectMimeType(key: string): string {
  const ext = key.split('.').pop()?.toLowerCase() || '';
  
  const mimeTypes: Record<string, string> = {
    // Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'bmp': 'image/bmp',
    // Audio
    'mp3': 'audio/mpeg',
    'ogg': 'audio/ogg',
    'wav': 'audio/wav',
    'aac': 'audio/aac',
    // Video
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    // Web
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
    'wasm': 'application/wasm',
    // Fonts
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'otf': 'font/otf',
    // Other
    'txt': 'text/plain',
    'csv': 'text/csv',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'swf': 'application/x-shockwave-flash',
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
}

// ===== SHA-256 hash helper =====
async function sha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fix MIME Types on existing R2 objects
 * 
 * Query Parameters:
 *   - dryRun: 'true' (default) to preview, 'false' to apply
 *   - prefix: filter objects by prefix
 *   - limit: max objects to process per request (default: 100)
 *   - cursor: pagination cursor from previous request
 * 
 * Response includes nextCursor - use it in next request to continue from where you left off
 */
adminApp.get('/fix-mime-types', async (c) => {
  const dryRun = c.req.query('dryRun') !== 'false';
  const prefix = c.req.query('prefix') || '';
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const inputCursor = c.req.query('cursor') || undefined;
  
  // Use createEnvContext for reliable binding access (same as battle_data.ts)
  const env = createEnvContext(c);
  const bucket = env.runtime.ASSET_SYNC_BUCKET;
  
  if (!bucket) {
    return c.json({ error: 'ASSET_SYNC_BUCKET not bound' }, 500);
  }
  
  const results = {
    dryRun,
    total: 0,
    fixed: 0,
    skipped: 0,
    errors: [] as { key: string; error: string }[],
    details: [] as { key: string; from: string; to: string }[],
    nextCursor: null as string | null,
    hasMore: false,
  };
  
  let cursor: string | undefined = inputCursor;
  let processed = 0;
  
  // Single list call per request - no internal looping to avoid timeout
  const listResult = await bucket.list({ cursor, prefix, limit });
  
  for (const obj of listResult.objects) {
    results.total++;
    processed++;
    
    const expectedMime = detectMimeType(obj.key);
    
    // need to get the object to check current MIME type
    const objData = await bucket.get(obj.key);
    if (!objData) {
      results.skipped++;
      continue;
    }
    
    const currentMime = (objData as any).httpMetadata?.contentType || 'application/octet-stream';
    
    // Skip if already correct or supposed to be octet-stream
    if (currentMime === expectedMime || expectedMime === 'application/octet-stream') {
      results.skipped++;
      continue;
    }
    
    results.details.push({ key: obj.key, from: currentMime, to: expectedMime });
    
    if (!dryRun) {
      try {
        const body = await objData.arrayBuffer();
        
        // Preserve existing metadata when re-uploading
        const existingHttpMeta = (objData as any).httpMetadata || {};
        const existingCustomMeta = (objData as any).customMetadata || {};
        
        await bucket.put(obj.key, body, {
          httpMetadata: {
            ...existingHttpMeta,
            contentType: expectedMime,  // Only update contentType
          },
          customMetadata: existingCustomMeta,  // Preserve all custom metadata
        });
        
        results.fixed++;
      } catch (err) {
        results.errors.push({ key: obj.key, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      results.fixed++;
    }
  }
  
  // Return cursor for next request
  if (listResult.truncated && listResult.cursor) {
    results.nextCursor = listResult.cursor;
    results.hasMore = true;
  }
  
  return c.json(results);
});

/**
 * Backfill Asset Index: R2 → D1 Content Hash Population
 * 
 * Query Parameters:
 *   - limit: number (default: 100) - Objects to process per request
 *   - cursor: string (optional) - R2 list cursor for pagination
 *   - dry_run: boolean (default: false) - If true, compute hashes but don't update D1
 */
adminApp.get('/backfill-asset-index', async (c) => {
  // Use createEnvContext for reliable binding access (same as battle_data.ts)
  const env = createEnvContext(c);
  const bucket = env.runtime.ASSET_SYNC_BUCKET;
  const db = env.runtime.ASSET_INDEX_DB;
  
  if (!bucket || !db) {
    return c.json({ error: 'Missing R2 or D1 bindings' }, 500);
  }
  
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const dryRun = c.req.query('dry_run') === 'true';
  const cursor = c.req.query('cursor') || undefined;
  
  try {
    const listed = await bucket.list({ limit, cursor });
    const objects = listed.objects || [];
    const nextCursor = listed.truncated ? listed.cursor : null;
    
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];
    
    for (const obj of objects) {
      processed++;
      const key = obj.key;
      const size = obj.size;
      const uploadedAt = obj.uploaded?.getTime() ?? Date.now();
      
      try {
        const r2Object = await bucket.get(key);
        if (!r2Object) {
          errors.push(`R2 object not found: ${key}`);
          continue;
        }
        
        const arrayBuffer = await r2Object.arrayBuffer();
        const contentHash = await sha256(arrayBuffer);
        
        const stmt = db.prepare('SELECT content_hash FROM files WHERE key = ?');
        const existing = await stmt.bind(key).first() as { content_hash: string } | null;
        
        if (existing && existing.content_hash === contentHash) {
          skipped++;
          continue;
        }
        
        const contentType = (r2Object as any).httpMetadata?.contentType || 'application/octet-stream';
        
        if (!dryRun) {
          await db.prepare(
            `INSERT INTO files (key, size, uploaded_at, content_type, uploader_id, content_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET
               size = excluded.size,
               uploaded_at = excluded.uploaded_at,
               content_hash = excluded.content_hash`
          ).bind(
            key,
            size,
            uploadedAt,
            contentType,
            'backfill',
            contentHash,
            new Date(uploadedAt).toISOString()
          ).run();
        }
        
        updated++;
      } catch (err) {
        errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    
    return c.json({
      success: true,
      total: processed,
      updated,
      skipped,
      cursor: nextCursor,
      hasMore: !!nextCursor,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      dry_run: dryRun,
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default adminApp;
