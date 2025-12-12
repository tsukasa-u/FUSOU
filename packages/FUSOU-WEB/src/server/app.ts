import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type { Bindings } from './types';
import { CORS_HEADERS } from './constants';

import authApp from './routes/auth';
import assetsApp from './routes/assets';
import fleetApp from './routes/fleet';
import kcApp from './routes/kc';
import adminApp from './routes/admin';

const app = new Hono<{ Bindings: Bindings }>();

// Global logger
app.use('*', logger((msg) => {
  console.log(`[Hono API] ${msg}`);
}));

// Global CORS
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

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
app.route('/admin', adminApp);  // adminApp declares /sync-r2-to-d1, etc.

// Catch-all 404
app.all('*', (c) => {
  return c.json({ error: true, message: 'Not found', path: c.req.path }, 404);
});

export default app;
export type AppType = typeof app.route;
