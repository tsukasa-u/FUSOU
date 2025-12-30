/**
 * Admin / Maintenance Routes
 * 
 * These endpoints are for administrative and one-time operations.
 * Consider adding authentication or removing after use.
 */

import { Hono } from 'hono';
import type { Bindings } from '../types';

const adminApp = new Hono<{ Bindings: Bindings }>();

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
 *   - limit: max objects to process (default: 1000)
 */
adminApp.get('/fix-mime-types', async (c) => {
  const dryRun = c.req.query('dryRun') !== 'false';
  const prefix = c.req.query('prefix') || '';
  const limit = parseInt(c.req.query('limit') || '1000', 10);
  
  const bucket = c.env.ASSET_SYNC_BUCKET;
  if (!bucket) {
    return c.json({ error: 'ASSET_SYNC_BUCKET not bound' }, 500);
  }
  
  const results = {
    dryRun,
    total: 0,
    fixed: 0,
    skipped: 0,
    errors: [] as { key: string; error: string }[],
    details: [] as { key: string; from: string; to: string }[]
  };
  
  let cursor: string | undefined = undefined;
  let processed = 0;
  
  do {
    // Note: 'include' option may not be available in all R2 type definitions
    const listResult = await bucket.list({ cursor, prefix } as any);
    
    for (const obj of listResult.objects) {
      if (processed >= limit) break;
      
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
          
          await bucket.put(obj.key, body, {
            httpMetadata: { contentType: expectedMime },
          });
          
          results.fixed++;
        } catch (err) {
          results.errors.push({ key: obj.key, error: err instanceof Error ? err.message : String(err) });
        }
      } else {
        results.fixed++;
      }
    }
    
    cursor = listResult.truncated ? listResult.cursor : undefined;
  } while (cursor && processed < limit);
  
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
  const bucket = c.env.ASSET_SYNC_BUCKET;
  const db = c.env.ASSET_INDEX_DB;
  
  if (!bucket || !db) {
    return c.json({ error: 'Missing R2 or D1 bindings' }, 500);
  }
  
  // TypeScript needs explicit non-null assertion after check
  const database = db as D1Database;
  
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
        
        const stmt = database.prepare('SELECT content_hash FROM files WHERE key = ?');
        const existing = await stmt.bind(key).first() as { content_hash: string } | null;
        
        if (existing && existing.content_hash === contentHash) {
          skipped++;
          continue;
        }
        
        const contentType = (r2Object as any).httpMetadata?.contentType || 'application/octet-stream';
        
        if (!dryRun) {
          await database.prepare(
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
