import { RuntimeConfigPointerConflictError } from "./tlsn-runtime-config-r2-store.mjs";

const TEST_ONLY_STORES = new WeakSet();

export function createTestOnlyRuntimeConfigObjectStore({
  corruptArtifactReadback = false,
  corruptManifestReadback = false,
  raceManifestPointer = false,
} = {}) {
  const objects = new Map();
  const events = [];
  let manifestETag = null;
  let manifestBody = null;
  let corruptArtifact = corruptArtifactReadback;
  let corruptManifest = corruptManifestReadback;

  const store = Object.freeze({
    test_only: true,
    objects,
    events,
    get manifestETag() {
      return manifestETag;
    },
    get manifestBody() {
      return manifestBody;
    },

    async getManifestState() {
      events.push("read-manifest-state");
      if (manifestBody === null) return null;
      const body = Buffer.from(manifestBody);
      if (corruptManifest) {
        corruptManifest = false;
        body[0] ^= 1;
      }
      return { body, etag: manifestETag };
    },

    async putImmutable(object) {
      events.push(`put:${object.key}`);
      const existing = objects.get(object.key);
      if (existing && !existing.equals(object.body)) {
        throw new Error("content-addressed object already contains different bytes");
      }
      objects.set(object.key, Buffer.from(object.body));
    },

    async getObject(key) {
      events.push(`read:${key}`);
      const body = key === "tlsn/runtime-config/v2/manifest.json"
        ? manifestBody
        : objects.get(key);
      if (!body) return null;
      const readback = Buffer.from(body);
      if (corruptArtifact && key !== "tlsn/runtime-config/v2/manifest.json") {
        corruptArtifact = false;
        readback[0] ^= 1;
      }
      return readback;
    },

    async compareAndSwapManifest(expectedETag, object) {
      events.push("manifest-cas");
      if (raceManifestPointer) {
        manifestETag = "concurrent-update";
        manifestBody = Buffer.from("concurrent manifest");
        throw new RuntimeConfigPointerConflictError(
          "Runtime Config manifest pointer changed during conditional publication",
        );
      }
      if (manifestETag !== expectedETag) {
        throw new RuntimeConfigPointerConflictError(
          "Runtime Config manifest pointer changed during conditional publication",
        );
      }
      manifestETag = `etag-${events.length}`;
      manifestBody = Buffer.from(object.body);
      return manifestETag;
    },
  });

  TEST_ONLY_STORES.add(store);
  return store;
}

export function isTestOnlyRuntimeConfigObjectStore(value) {
  return TEST_ONLY_STORES.has(value);
}
