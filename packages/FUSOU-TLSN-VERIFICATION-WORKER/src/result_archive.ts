export function encodeResultArchiveSha256(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes).then((digest) => {
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  });
}

export async function assertResultArchiveBytes(
  resultBytes: Uint8Array,
  archivedBytes: Uint8Array,
  expectedSha256: string,
): Promise<void> {
  if (archivedBytes.byteLength !== resultBytes.byteLength) {
    throw new Error("archived result length mismatch");
  }
  if (await encodeResultArchiveSha256(archivedBytes) !== expectedSha256) {
    throw new Error("archived result digest mismatch");
  }
}

export async function persistAndVerifyResultArchive(
  bucket: Pick<R2Bucket, "put" | "get" | "delete">,
  objectKey: string,
  resultBytes: Uint8Array,
  expectedSha256: string,
  context?: ArchiveContext,
): Promise<void> {
  await persistArchive(bucket, objectKey, resultBytes, expectedSha256, "result", context);
}

export async function assertPresentationArchiveBytes(
  presentationBytes: Uint8Array,
  archivedBytes: Uint8Array,
  expectedSha256: string,
): Promise<void> {
  if (archivedBytes.byteLength !== presentationBytes.byteLength) {
    throw new Error("archived Presentation length mismatch");
  }
  if (await encodeResultArchiveSha256(archivedBytes) !== expectedSha256) {
    throw new Error("archived Presentation digest mismatch");
  }
}

export async function persistAndVerifyPresentationArchive(
  bucket: Pick<R2Bucket, "put" | "get" | "delete">,
  objectKey: string,
  presentationBytes: Uint8Array,
  expectedSha256: string,
  context?: ArchiveContext,
): Promise<void> {
  await persistArchive(bucket, objectKey, presentationBytes, expectedSha256, "presentation", context);
}
import { archiveCustomMetadata, assertArchiveGeneration, type ArchiveContext } from "./archive-readback.mjs";

async function persistArchive(
  bucket: Pick<R2Bucket, "put" | "get" | "delete">, objectKey: string, bytes: Uint8Array, digest: string,
  role: "presentation" | "result", context?: ArchiveContext,
): Promise<void> {
  const label = role === "result" ? "Result" : "Presentation";
  const customMetadata = context ? archiveCustomMetadata(role, context) : undefined;
  let written: R2Object | null | undefined;
  let observedVersion: string | undefined;
  try {
    written = await bucket.put(objectKey, bytes, { httpMetadata: { contentType: role === "result" ? "application/json" : "application/octet-stream" },
      ...(customMetadata ? { customMetadata } : {}) });
    const object = await bucket.get(objectKey);
    if (!object) throw new Error(`missing archived ${label}`);
    observedVersion = object.version;
    if (context) assertArchiveGeneration(written, object, role, context);
    const readback = new Uint8Array(await object.arrayBuffer());
    await (role === "result" ? assertResultArchiveBytes : assertPresentationArchiveBytes)(bytes, readback, digest);
  } catch (cause) {
    if (context && (!written?.version || observedVersion && written.version !== observedVersion)) {
      throw new Error(`authoritative ${label} archive verification failed; changed generation requires cleanup reconciliation`, { cause });
    }
    try { await bucket.delete(objectKey); }
    catch (cleanup) { throw new AggregateError([cause, cleanup], `authoritative ${label} archive verification failed`); }
    throw new Error(`authoritative ${label} archive verification failed`, { cause });
  }
}