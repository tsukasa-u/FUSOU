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
): Promise<void> {
  try {
    await bucket.put(objectKey, resultBytes, {
      httpMetadata: { contentType: "application/json" },
    });
    const archivedObject = await bucket.get(objectKey);
    if (!archivedObject) throw new Error("missing archived result");
    await assertResultArchiveBytes(resultBytes, new Uint8Array(await archivedObject.arrayBuffer()), expectedSha256);
  } catch {
    await bucket.delete(objectKey).catch(() => undefined);
    throw new Error("authoritative Result archive verification failed");
  }
}