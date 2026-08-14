import assert from "node:assert/strict";
import app from "../dist/index.js";

const values = new Map();
const env = {
  ALLOWED_ORIGINS: "https://fusou.dev",
  BASE_URL: "https://s.fusou.dev",
  URL_KV: {
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value) {
      values.set(key, value);
    },
  },
};

const shortenResponse = await app.fetch(
  new Request("https://s.fusou.dev/api/shorten", {
    method: "POST",
    headers: {
      Origin: "https://fusou.dev",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: "https://fusou.dev/simulator?fleet=abc",
      snapshotPayload: { snapshotShips: { "1": { name: "ship" } } },
    }),
  }),
  env,
);

assert.equal(shortenResponse.status, 200);
const shortened = await shortenResponse.json();
assert.match(shortened.key, /^[0-9a-f]{16}$/);
assert.equal(shortened.shortUrl, `https://s.fusou.dev/${shortened.key}`);

const snapshotResponse = await app.fetch(
  new Request(`https://s.fusou.dev/internal/snapshot/${shortened.key}`),
  env,
);
assert.equal(snapshotResponse.status, 200);
assert.deepEqual(await snapshotResponse.json(), {
  originalUrl: "https://fusou.dev/simulator?fleet=abc",
  snapshotPayload: { snapshotShips: { "1": { name: "ship" } } },
});

values.set("abcdefabcdefabcd", "https://fusou.dev/simulator?legacy=1");
const legacyResponse = await app.fetch(
  new Request("https://s.fusou.dev/internal/snapshot/abcdefabcdefabcd"),
  env,
);
assert.equal(legacyResponse.status, 200);
assert.deepEqual(await legacyResponse.json(), {
  originalUrl: "https://fusou.dev/simulator?legacy=1",
  snapshotPayload: null,
});

const missingResponse = await app.fetch(
  new Request("https://s.fusou.dev/internal/snapshot/0123456789abcdef"),
  env,
);
assert.equal(missingResponse.status, 404);

console.log("[index-smoke] URL shortener KV and validation paths OK");