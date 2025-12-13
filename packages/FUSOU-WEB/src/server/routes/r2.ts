import { Hono } from 'hono';
import type { Bindings } from '../types';
import { CORS_HEADERS } from '../constants';
import { getRuntimeEnv } from '../utils';

const app = new Hono<{ Bindings: Bindings }>();

/**
 * R2 signing service routes
 * Generates pre-signed URLs for secure uploads/downloads to Cloudflare R2
 * Uses AWS SigV4 algorithm for S3-compatible signing
 * Endpoints:
 *   POST /sign - generate presigned URL with SigV4 signature
 *   GET /health - health check
 */

// OPTIONS (CORS)
app.options('*', (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }));

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const keyObj = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', keyObj, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(hash));
}

async function signUrl({
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
}): Promise<string> {
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
  const payloadHash = await sha256Hex('');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n'
  );

  const stringToSign = [algorithm, amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');

  const keyObj = await crypto.subtle.importKey('raw', kSigning as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', keyObj, new TextEncoder().encode(stringToSign));
  const signatureHex = bytesToHex(new Uint8Array(signature));

  const signedQuery = `${canonicalQuery}&X-Amz-Signature=${signatureHex}`;
  const url = `https://${host}${canonicalUri}?${signedQuery}`;
  return url;
}

// POST /sign - generate SigV4-signed presigned URL for R2 upload/download
app.post('/sign', async (c) => {
  try {
    const body = await c.req.json<{ path: string; operation: 'put' | 'get' }>().catch(() => null);

    if (!body || !body.path || !body.operation) {
      return c.json({ error: 'Invalid payload: path and operation required' }, 400);
    }

    const env = getRuntimeEnv(c);
    const bucket = env.R2_BUCKET || 'fusou';
    const accessKeyId = env.R2_ACCESS_KEY_ID || 'AKIA_TEST';
    const secretAccessKey = env.R2_SECRET_ACCESS_KEY || 'SECRET_TEST';
    const region = env.R2_REGION || 'auto';
    const host = env.R2_HOST || 'ACCOUNT_ID.r2.cloudflarestorage.com';
    const expires = Number(env.R2_SIGN_EXPIRES || '300');

    const url = await signUrl({
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

// GET /health - health check for R2 signing service
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

export default app;
