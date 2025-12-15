import { Hono } from 'hono';
import type { Bindings } from '../../src/server/types';
import compactRouter from '../../src/server/routes/compact';

// Cloudflare Pages Functions entry point for /api/compact
const app = new Hono<{ Bindings: Bindings }>();

// Mount compact router
app.route('/api/compact', compactRouter);

// Handle all requests (Cloudflare Pages Functions standard format)
export const onRequest = [
  async (context: any) => {
    return app.fetch(context.request, context.env);
  },
] as any;
