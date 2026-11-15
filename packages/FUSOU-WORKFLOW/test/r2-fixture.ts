import { vi } from "vitest";

export function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>();
  let version = 0;
  const get = vi.fn(async (key: string, options?: R2GetOptions) => {
    const stored = objects.get(key);
    if (!stored) return null;
    let slice = stored.bytes;
    const range = options?.range;
    if (range && !(range instanceof Headers)) {
      if ("suffix" in range && typeof range.suffix === "number") {
        slice = stored.bytes.subarray(Math.max(0, stored.bytes.byteLength - range.suffix));
      } else {
        const start = "offset" in range && typeof range.offset === "number" ? range.offset : 0;
        const end =
          "length" in range && typeof range.length === "number"
            ? Math.min(stored.bytes.byteLength, start + range.length)
            : stored.bytes.byteLength;
        slice = stored.bytes.subarray(start, end);
      }
    }
    const copy = Uint8Array.from(slice);
    return {
      key, size: stored.bytes.byteLength, etag: stored.etag,
      version: stored.etag, uploaded: new Date(), httpEtag: `"${stored.etag}"`,
      storageClass: "Standard", checksums: { toJSON: () => ({}) }, customMetadata: {}, httpMetadata: {},
      writeHttpMetadata: () => {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          if (copy.byteLength > 0) controller.enqueue(copy);
          controller.close();
        },
      }),
      bodyUsed: false,
      arrayBuffer: async () => copy.buffer,
      text: async () => new TextDecoder().decode(copy),
      json: async () => JSON.parse(new TextDecoder().decode(copy)),
      blob: async () => new Blob([copy]),
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
