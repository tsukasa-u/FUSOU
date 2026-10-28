import { vi } from "vitest";

export function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let version = 0;
  const get = vi.fn(async (key: string) => {
    const stored = objects.get(key);
    if (!stored) return null;
    return {
      key, size: stored.bytes.byteLength, etag: stored.etag,
      version: stored.etag, uploaded: new Date(), httpEtag: `"${stored.etag}"`,
      storageClass: "Standard", checksums: { toJSON: () => ({}) }, customMetadata: {}, httpMetadata: {},
      writeHttpMetadata: () => {},
      body: new ReadableStream<Uint8Array>(), bodyUsed: false,
      arrayBuffer: async () => Uint8Array.from(stored.bytes).buffer,
      text: async () => new TextDecoder().decode(stored.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(stored.bytes)),
      blob: async () => new Blob([Uint8Array.from(stored.bytes)]),
    };
  });
  const put = vi.fn(async (key: string, value: string | Uint8Array, options?: R2PutOptions) => {
    const previous = objects.get(key);
    const condition = options?.onlyIf;
    if (condition && !(condition instanceof Headers)) {
      if (condition.etagMatches && condition.etagMatches !== previous?.etag) return null;
      if (condition.etagDoesNotMatch === "*" && previous) return null;
    }
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
    const object = { bytes, etag: String(++version) };
    objects.set(key, object);
    return get(key);
  });
  const bucket = {
    get, put, head: get,
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
    list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    createMultipartUpload: async () => { throw new Error("Unused multipart fixture"); },
    resumeMultipartUpload: () => { throw new Error("Unused multipart fixture"); },
  } as R2Bucket;
  return { bucket, objects, get, put };
}
