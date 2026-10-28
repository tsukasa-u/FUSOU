import { constants } from "node:fs";
import { constants as bufferConstants } from "node:buffer";
import { open } from "node:fs/promises";

const fail = (code) => { throw Object.assign(new Error(code), { code }); };

export function assertReleaseFileLimits({ maxBytes, minBytes = 1 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > bufferConstants.MAX_LENGTH ||
    !Number.isSafeInteger(minBytes) || minBytes < 0 || minBytes > maxBytes) fail("RELEASE_FILE_LIMIT_INVALID");
}

// The same open handle bounds reads; this is not a guarantee about a later path-based execution.
export async function readBoundedFileHandle(file, limits) {
  assertReleaseFileLimits(limits);
  const { maxBytes, minBytes = 1 } = limits;
  const before = await file.stat({ bigint: true });
  if (!before.isFile()) fail("RELEASE_FILE_NOT_REGULAR");
  if (before.size > BigInt(maxBytes)) fail("RELEASE_FILE_TOO_LARGE");
  if (before.size < BigInt(minBytes)) fail("RELEASE_FILE_EMPTY_OR_SHORT");
  const initialSize = Number(before.size), raw = Buffer.alloc(initialSize), extra = Buffer.alloc(1);
  let total = 0;
  while (true) {
    const chunk = total === initialSize ? extra : raw.subarray(total, Math.min(total + 64 * 1024, initialSize));
    const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > chunk.length) fail("RELEASE_FILE_READ_INVALID");
    total += bytesRead;
    if (total > maxBytes) fail("RELEASE_FILE_TOO_LARGE");
    if (total > initialSize) fail("RELEASE_FILE_CHANGED");
    if (!bytesRead) break;
  }
  const after = await file.stat({ bigint: true });
  if (!after.isFile() || total !== initialSize ||
    ["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].some((key) => before[key] !== after[key])) {
    fail("RELEASE_FILE_CHANGED");
  }
  return raw;
}

export async function readBoundedRegularFile(path, limits) {
  assertReleaseFileLimits(limits);
  if (!Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_NONBLOCK)) {
    fail("RELEASE_FILE_OPEN_UNSUPPORTED");
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    return await readBoundedFileHandle(file, limits);
  } finally {
    await file.close();
  }
}

export async function readRegularFile(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error("release input/output must be a regular file");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
