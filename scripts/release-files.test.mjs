import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readBoundedFileHandle, readBoundedRegularFile, readRegularFile } from "./release-files.mjs";
import { nativeResourceFixtureBudget } from "./release-native-attestation-fixture.mjs";
import { withNativeInspectionBudget } from "./release-native-resources.mjs";

function handle(raw, { size = raw.length, after = {}, regular = true } = {}) {
  let stats = 0, reads = 0;
  const stat = { size: BigInt(size), dev: 1n, ino: 2n, mode: 0o100600n, nlink: 1n, mtimeNs: 10n,
    ctimeNs: 11n, isFile: () => regular };
  return {
    get reads() { return reads; },
    async stat() { return { ...stat, ...(stats++ ? after : {}) }; },
    async read(buffer, offset, length, position) {
      reads++;
      const bytesRead = Math.min(length, Math.max(0, raw.length - position));
      raw.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
  };
}
const code = (expected) => (error) => error.code === expected;

test("bounded regular-file reads preserve legacy callers and enforce exact size boundaries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fusou-bounded-file-"));
  try {
    const path = join(directory, "input.bin"), raw = Buffer.from("abcd");
    await writeFile(path, raw);
    assert.deepEqual(await readRegularFile(path), raw);
    for (const maxBytes of [4, 5]) assert.deepEqual(await readBoundedRegularFile(path, { maxBytes }), raw);
    await assert.rejects(readBoundedRegularFile(path, { maxBytes: 3 }), code("RELEASE_FILE_TOO_LARGE"));
    await writeFile(path, Buffer.alloc(0));
    await assert.rejects(readBoundedRegularFile(path, { maxBytes: 4 }), code("RELEASE_FILE_EMPTY_OR_SHORT"));
    assert.deepEqual(await readBoundedRegularFile(path, { maxBytes: 4, minBytes: 0 }), Buffer.alloc(0));
    await assert.rejects(readBoundedRegularFile(join(directory, "missing"), { maxBytes: 4 }), code("ENOENT"));
    await assert.rejects(readBoundedRegularFile(directory, { maxBytes: 4 }), code("RELEASE_FILE_NOT_REGULAR"));
    await symlink(path, join(directory, "input-link"));
    await assert.rejects(readBoundedRegularFile(join(directory, "input-link"), { maxBytes: 4 }), code("ELOOP"));
  } finally { await rm(directory, { recursive: true }); }
});
test("invalid or absent byte limits refuse before opening even a nonexistent path", async () => {
  for (const limits of [undefined, {}, { maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 },
    { maxBytes: Infinity }, { maxBytes: "4" }, { maxBytes: 4, minBytes: 5 }, { maxBytes: 4, minBytes: -1 }]) {
    await assert.rejects(readBoundedRegularFile("/not-opened", limits), code("RELEASE_FILE_LIMIT_INVALID"));
  }
});
test("oversized or nonregular handle metadata is rejected before any content is read", async () => {
  for (const [options, expected] of [[{ size: 5 }, "RELEASE_FILE_TOO_LARGE"],
    [{ size: Number.MAX_SAFE_INTEGER }, "RELEASE_FILE_TOO_LARGE"],
    [{ regular: false }, "RELEASE_FILE_NOT_REGULAR"]]) {
    const file = handle(Buffer.from("abcd"), options);
    await assert.rejects(readBoundedFileHandle(file, { maxBytes: 4 }), code(expected));
    assert.equal(file.reads, 0);
  }
});
test("short reads are accumulated across bounded chunks without requiring a single read", async () => {
  const raw = Buffer.alloc(64 * 1024 + 3, 42), file = handle(raw), read = file.read.bind(file);
  file.read = (buffer, offset, length, position) => read(buffer, offset, Math.min(7, length), position);
  assert.deepEqual(await readBoundedFileHandle(file, { maxBytes: raw.length }), raw);
  assert(file.reads > 2);
});
test("growth and truncation during reads cannot produce a partial successful buffer", async () => {
  await assert.rejects(readBoundedFileHandle(handle(Buffer.from("abcde"), { size: 4 }), { maxBytes: 4 }),
    code("RELEASE_FILE_TOO_LARGE"));
  await assert.rejects(readBoundedFileHandle(handle(Buffer.from("abcde"), { size: 4 }), { maxBytes: 8 }),
    code("RELEASE_FILE_CHANGED"));
  await assert.rejects(readBoundedFileHandle(handle(Buffer.from("abc"), { size: 4 }), { maxBytes: 4 }),
    code("RELEASE_FILE_CHANGED"));
});
test("post-read size, type and inode metadata changes reject instead of authenticating the bytes", async () => {
  for (const after of [{ size: 3n }, { size: 5n }, { dev: 3n }, { ino: 3n }, { nlink: 2n },
    { mode: 0o100644n }, { mtimeNs: 12n }, { ctimeNs: 12n }, { isFile: () => false }]) {
    await assert.rejects(readBoundedFileHandle(handle(Buffer.from("abcd"), { after }), { maxBytes: 4 }),
      code("RELEASE_FILE_CHANGED"));
  }
});
test("stat/read failures and impossible read counts surface explicitly", async () => {
  const failure = Object.assign(new Error("synthetic read failure"), { code: "EIO" });
  for (const method of ["stat", "read"]) {
    const file = handle(Buffer.from("abcd")); file[method] = async () => { throw failure; };
    await assert.rejects(readBoundedFileHandle(file, { maxBytes: 4 }), (error) => error === failure);
  }
  for (const bytesRead of [-1, 1.5, 6, undefined]) {
    const file = handle(Buffer.from("abcd")); file.read = async () => ({ bytesRead });
    await assert.rejects(readBoundedFileHandle(file, { maxBytes: 4 }), code("RELEASE_FILE_READ_INVALID"));
  }
});
test("bounded reads reserve bytes before allocation and honor cancellation after stat or read", async () => {
  const file = handle(Buffer.from("abcd"));
  await assert.rejects(readBoundedFileHandle(file, { maxBytes: 4 }, { reserveBytes: (amount) => {
    assert.equal(amount, 5);
    throw Object.assign(new Error("budget"), { code: "BUDGET" });
  } }), code("BUDGET"));
  assert.equal(file.reads, 0);
  for (const method of ["stat", "read"]) {
    const controller = new AbortController(), input = handle(Buffer.from("abcd")), original = input[method].bind(input);
    input[method] = async (...args) => { const result = await original(...args); controller.abort(); return result; };
    await assert.rejects(readBoundedFileHandle(input, { maxBytes: 4 }, { signal: controller.signal }), code("RELEASE_FILE_ABORTED"));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readBoundedRegularFile("/not-opened", { maxBytes: 4 }, { signal: controller.signal }),
    code("RELEASE_FILE_ABORTED"));
});
test("multiple individually bounded files charge their combined allocation and probe bytes", async () => {
  for (const max_bytes of [8, 9, 10]) {
    const first = handle(Buffer.from("abcd")), second = handle(Buffer.from("efg"));
    const operation = withNativeInspectionBudget(nativeResourceFixtureBudget({ max_bytes }), undefined, async (scope) => {
      const options = { signal: scope.signal, reserveBytes: scope.charge };
      await readBoundedFileHandle(first, { maxBytes: 4 }, options);
      return readBoundedFileHandle(second, { maxBytes: 4 }, options);
    });
    if (max_bytes === 8) {
      await assert.rejects(operation, code("NATIVE_RESOURCE_BYTES_EXCEEDED")); assert.equal(second.reads, 0);
    } else assert.deepEqual(await operation, Buffer.from("efg"));
  }
});
