// R2 SigV4 Signing utilities
import { createHmac, createHash, type BinaryLike } from 'crypto';
import { URLSearchParams } from "node:url";

function hmac(key: BinaryLike, data: string) {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string | Uint8Array) {
  return createHash('sha256').update(data).digest('hex');
}

export function signUrl({
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

  const kDate = hmac(Uint8Array.from(Buffer.from('AWS4' + secretAccessKey, 'utf8')), dateStamp);
  const kRegion = hmac(Uint8Array.from(kDate), region);
  const kService = hmac(Uint8Array.from(kRegion), service);
  const kSigning = hmac(Uint8Array.from(kService), 'aws4_request');
  const signature = createHmac('sha256', Uint8Array.from(kSigning))
    .update(stringToSign)
    .digest('hex');

  const signedQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  const url = `https://${host}${canonicalUri}?${signedQuery}`;
  return url;
}
