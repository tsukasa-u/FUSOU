// Hono API for R2 signing
import { Hono } from 'hono';
import { signUrl } from '../lib/r2-sign';

const app = new Hono();

type Env = {
  R2_BUCKET?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_REGION?: string;
  R2_HOST?: string;
  R2_SIGN_EXPIRES?: string;
};

app.post('/sign', async (c) => {
  const body = await c.req.json<{ path: string; operation: 'put' | 'get' }>().catch(() => null);

  if (!body || !body.path || !body.operation) {
    return c.json({ error: 'Invalid payload: path and operation required' }, 400);
  }

  const env = (c.env || process.env) as Env;

  const bucket = env.R2_BUCKET || 'fusou';
  const accessKeyId = env.R2_ACCESS_KEY_ID || 'AKIA_TEST';
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || 'SECRET_TEST';
  const region = env.R2_REGION || 'auto';
  const host = env.R2_HOST || 'ACCOUNT_ID.r2.cloudflarestorage.com';
  const expires = Number(env.R2_SIGN_EXPIRES || '300');

  try {
    const url = signUrl({
      method: body.operation === 'put' ? 'PUT' : 'GET',
      host,
      bucket,
      path: body.path,
      accessKeyId,
      secretAccessKey,
      region,
      expires,
    });

    return c.json({ url, expires }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: `Signing failed: ${msg}` }, 500);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
