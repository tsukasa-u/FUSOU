// Secure R2 signing API scaffold
// NOTE: Replace placeholders with Cloudflare bindings (R2 bucket, access keys) or proxy approach.
// This endpoint returns short-lived signed URLs for upload/download.

import type { APIRoute } from 'astro';

// Minimal SigV4 signing for R2 (S3-compatible)
import crypto from 'crypto';

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

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(Buffer.from('AWS4' + secretAccessKey, 'utf8'), dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const signedQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  const url = `https://${host}${canonicalUri}?${signedQuery}`;
  return url;
}

export const post: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { path, operation } = body as { path: string; operation: 'put' | 'get' };

    if (!path || !operation) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
    }

    const EXPIRES_SECONDS = Number(process.env.R2_SIGN_EXPIRES || '300');
    const R2_BUCKET = process.env.R2_BUCKET || 'fusou';
    const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'AKIA_TEST';
    const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'SECRET_TEST';
    const R2_REGION = process.env.R2_REGION || 'auto';
    const R2_HOST = process.env.R2_HOST || 'ACCOUNT_ID.r2.cloudflarestorage.com';

    const url = signUrl({
      method: operation === 'put' ? 'PUT' : 'GET',
      host: R2_HOST,
      bucket: R2_BUCKET,
      path,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      region: R2_REGION,
      expires: EXPIRES_SECONDS,
    });

    return new Response(JSON.stringify({ url, expires: EXPIRES_SECONDS }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Bad Request' }), { status: 400 });
  }
};
