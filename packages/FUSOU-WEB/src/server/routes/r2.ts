import { Hono } from 'hono';
import crypto from 'crypto';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';

const app = new Hono<{ Bindings: Bindings }>();

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

function hmac(key: Buffer, data: string) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Buffer) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function signUrl({
  method,
  host,
  bucket,
  path,
  accessKeyId,
  secretAccessKey,
  region,
  expires,
}: {
  method: 'GET' | 'PUT';
  host: string;
  bucket: string;
  path: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  expires: number;
}) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalUri = `/${bucket}/${path.replace(/^\//, '')}`;
  const canonicalQuery = new URLSearchParams({
    'X-Amz-Algorithm': algorithm,
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  }).toString();

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = sha256Hex('');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n'
  );

  const stringToSign = [algorithm, amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(Buffer.from('AWS4' + secretAccessKey, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const signedQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  const url = `https://${host}${canonicalUri}?${signedQuery}`;
  return url;
}

// POST /sign - generate presigned URL for R2
app.post('/sign', async (c) => {
  try {
    const body = await c.req.json<{ path: string; operation: 'put' | 'get' }>().catch(() => null);

    if (!body || !body.path || !body.operation) {
      return c.json({ error: 'Invalid payload: path and operation required' }, 400);
    }

    const bindings = c.env || {};
    const bucket = bindings.R2_BUCKET || 'fusou';
    const accessKeyId = bindings.R2_ACCESS_KEY_ID || 'AKIA_TEST';
    const secretAccessKey = bindings.R2_SECRET_ACCESS_KEY || 'SECRET_TEST';
    const region = bindings.R2_REGION || 'auto';
    const host = bindings.R2_HOST || 'ACCOUNT_ID.r2.cloudflarestorage.com';
    const expires = Number(bindings.R2_SIGN_EXPIRES || '300');

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

// GET /health - health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
