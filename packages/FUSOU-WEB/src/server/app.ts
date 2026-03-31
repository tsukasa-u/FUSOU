import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { CORS_HEADERS } from './constants';
import { createEnvContext, getEnv } from './utils';

import authApp from './routes/auth';
import assetsApp from './routes/assets';
import fleetApp from './routes/fleet';
import kcApp from './routes/kc';
import compactApp from './routes/compact';
import battleDataApp from './routes/battle_data';
import userApp from './routes/user';
import adminApp from './routes/admin';
import dataLoaderApp from './routes/data_loader';
import masterDataApp from './routes/master_data';
import apiKeysApp from './routes/api_keys';
import memberLookupApp from './routes/member-lookup';
import anonymousSyncApp from './routes/anonymous-sync';
import shortenerApp from './routes/shortener';

const app = new Hono<{ Bindings: Bindings }>();
const SAFE_CORS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseAllowedHosts(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (entry.includes('://')) {
        try {
          return new URL(entry).hostname.toLowerCase();
        } catch {
          return '';
        }
      }
      return entry.replace(/^\*\./, '');
    })
    .filter((entry) => entry.length > 0);
}

function isAllowedHost(hostname: string, allowedHosts: Set<string>): boolean {
  const normalized = hostname.toLowerCase();
  if (allowedHosts.has(normalized)) return true;
  for (const allowed of allowedHosts) {
    if (normalized.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function resolveCanonicalOrigin(c: { env: Bindings; req: { url: string } }): string | null {
  const env = createEnvContext(c);
  const configured = getEnv(env, 'PUBLIC_SITE_URL')?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      return null;
    }
  }

  return null;
}

function resolveAllowedHosts(c: { env: Bindings; req: { url: string } }): Set<string> {
  const env = createEnvContext(c);
  const allowed = new Set<string>();

  const canonicalOrigin = resolveCanonicalOrigin(c);
  if (canonicalOrigin) {
    try {
      allowed.add(new URL(canonicalOrigin).hostname.toLowerCase());
    } catch {
      // Ignore invalid canonical origin.
    }
  }

  for (const host of parseAllowedHosts(getEnv(env, 'PUBLIC_SITE_ALLOWED_HOSTS'))) {
    allowed.add(host);
  }

  return allowed;
}

function resolveCorsOrigin(c: { env: Bindings; req: { method: string; header: (name: string) => string | undefined; url: string } }): string {
  const reqMethod = (c.req.header('Access-Control-Request-Method') || c.req.method || '').toUpperCase();

  if (SAFE_CORS_METHODS.has(reqMethod)) {
    return '*';
  }

  const requestOrigin = c.req.header('Origin');
  if (requestOrigin) {
    try {
      const parsed = new URL(requestOrigin);
      if (isAllowedHost(parsed.hostname, resolveAllowedHosts(c))) {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed Origin and continue with fail-closed behavior.
    }
  }

  // For state-mutating requests, fail closed to canonical origin.
  return resolveCanonicalOrigin(c) || '';
}

function appendVaryOriginHeader(headers: Headers): void {
  const current = headers.get('Vary');
  if (!current) {
    headers.set('Vary', 'Origin');
    return;
  }

  const tokens = current
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (!tokens.includes('origin')) {
    headers.set('Vary', `${current}, Origin`);
  }
}

// Global logger
app.use('*', logger((msg) => {
  console.log(`[Hono API] ${msg}`);
}));

// Global CORS (preflight)
app.options('*', (c) => {
  const headers = new Headers(CORS_HEADERS);
  const origin = resolveCorsOrigin(c);
  headers.set('Access-Control-Allow-Origin', origin);
  if (origin !== '*') appendVaryOriginHeader(headers);
  return new Response(null, { status: 204, headers });
});

// Global CORS (actual responses)
app.use('*', async (c, next) => {
  await next();
  const targetOrigin = resolveCorsOrigin(c);

  // Enforce non-wildcard origin for mutating requests even when route returned default headers.
  if (!SAFE_CORS_METHODS.has(c.req.method.toUpperCase())) {
    c.res.headers.set('Access-Control-Allow-Origin', targetOrigin);
    if (targetOrigin !== '*') appendVaryOriginHeader(c.res.headers);
  }

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    // Avoid overriding explicitly-set headers
    if (k === 'Access-Control-Allow-Origin') {
      if (!c.res.headers.has(k)) c.res.headers.set(k, targetOrigin);
      continue;
    }
    if (!c.res.headers.has(k)) c.res.headers.set(k, v);
  }
});

// Global error handler
app.onError((err, c) => {
  console.error('[Hono API] Error occurred:', {
    message: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });
  return c.json({ error: true, message: 'Internal server error' }, 500);
});

// Mount sub apps
app.route('/auth', authApp);
app.route('/asset-sync', assetsApp); // assetsApp declares /upload, /keys, etc.
app.route('/fleet', fleetApp);  // fleetApp declares /snapshot, etc.
app.route('/kc-period', kcApp);     // kcApp declares /latest, etc.
app.route('/compaction', compactApp); // compactApp declares /compact, /compact/trigger, /compact/status
app.route('/battle-data', battleDataApp); // battleDataApp declares /upload, /health
app.route('/user', userApp); // userApp declares /member-map/upsert, /member-map
app.route('/admin', adminApp); // adminApp declares /fix-mime-types, /backfill-asset-index
app.route('/data-loader', dataLoaderApp); // dataLoaderApp declares /data/:dataset, /verify, /download/:dataset
app.route('/master-data', masterDataApp); // masterDataApp declares /upload (Stage 1), /download-master (Stage 2+3)
app.route('/api-keys', apiKeysApp); // apiKeysApp declares /, /:id, /devices, /devices/:id
app.route('/member-lookup', memberLookupApp); // memberLookupApp declares /check-hash, /verify-ownership
app.route('/auth', anonymousSyncApp); // anonymousSyncApp declares /anonymous-sync
app.route('/shorten', shortenerApp); // shortener app declares POST /

// Catch-all 404
app.all('*', (c) => {
  return c.json({ error: true, message: 'Not found', path: c.req.path }, 404);
});

export default app;
export type AppType = typeof app.route;
