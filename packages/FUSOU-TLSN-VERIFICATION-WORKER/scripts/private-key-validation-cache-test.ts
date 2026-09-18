import assert from "node:assert/strict";
import { PrivateKeyValidationCache } from "../src/private_key_validation_cache.ts";

const keyA = Uint8Array.from([1, 2, 3, 4]);
const keyB = Uint8Array.from([5, 6, 7, 8]);
const publicKeyA = "public-key-a";
const publicKeyB = "public-key-b";

{
  let calls = 0;
  const cache = new PrivateKeyValidationCache(4, async () => {
    calls += 1;
    return true;
  });
  const first = await cache.validate(keyA, publicKeyA, "test:session");
  const second = await cache.validate(keyA, publicKeyA, "test:session");
  assert.equal(first.valid, true);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(calls, 1);
}

{
  let calls = 0;
  let release!: (valid: boolean) => void;
  let started!: () => void;
  const validationStarted = new Promise<void>((resolve) => { started = resolve; });
  const cache = new PrivateKeyValidationCache(4, async () => {
    calls += 1;
    started();
    return new Promise<boolean>((resolve) => { release = resolve; });
  });
  const firstPromise = cache.validate(keyA, publicKeyA, "test:session");
  const secondPromise = cache.validate(keyA, publicKeyA, "test:session");
  await validationStarted;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release(true);
  const [, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(second.valid, true);
  assert.equal(second.concurrentDeduplication, true);
}

{
  let calls = 0;
  const cache = new PrivateKeyValidationCache(4, async () => {
    calls += 1;
    return calls > 1;
  });
  const first = await cache.validate(keyA, publicKeyA, "test:session");
  const second = await cache.validate(keyA, publicKeyA, "test:session");
  assert.equal(first.valid, false);
  assert.equal(second.valid, true);
  assert.equal(second.cacheHit, false);
  assert.equal(calls, 2);
}

{
  let calls = 0;
  const cache = new PrivateKeyValidationCache(4, async () => {
    calls += 1;
    if (calls === 1) throw new Error("transient validation failure");
    return true;
  });
  await assert.rejects(cache.validate(keyA, publicKeyA, "test:session"), /transient validation failure/);
  const recovered = await cache.validate(keyA, publicKeyA, "test:session");
  assert.equal(recovered.valid, true);
  assert.equal(recovered.cacheHit, false);
  assert.equal(calls, 2);
}

{
  let calls = 0;
  const cache = new PrivateKeyValidationCache(2, async () => {
    calls += 1;
    return true;
  });
  await cache.validate(keyA, publicKeyA, "test:session");
  await cache.validate(keyB, publicKeyA, "test:session");
  await cache.validate(keyA, publicKeyB, "test:session");
  assert.equal(cache.size, 2);
  await cache.validate(keyA, publicKeyA, "test:session");
  assert.equal(calls, 4);
  const cacheState = cache as unknown as {
    successfulEntries: Map<string, unknown>;
    inFlightEntries: Map<string, unknown>;
  };
  const rawKey = Buffer.from(keyA).toString("base64url");
  const identities = [
    ...cacheState.successfulEntries.keys(),
    ...cacheState.inFlightEntries.keys(),
  ];
  assert.equal(identities.some((identity) => identity.includes(rawKey)), false);
  assert.equal(identities.every((identity) => identity.length === "test:session:".length + 64 + 1 + 64), true);
}

{
  let calls = 0;
  const cache = new PrivateKeyValidationCache(4, async () => {
    calls += 1;
    return true;
  });
  await cache.validate(keyA, publicKeyA, "test:session");
  await cache.validate(keyA, publicKeyA, "production:canary");
  assert.equal(calls, 2);
}

console.log("private key validation cache tests passed");