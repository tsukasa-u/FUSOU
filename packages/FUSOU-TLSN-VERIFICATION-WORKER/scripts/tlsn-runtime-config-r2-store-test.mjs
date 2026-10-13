#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  createCloudflareR2RuntimeConfigObjectStore,
  createR2RuntimeConfigObjectStore,
  RuntimeConfigArtifactConflictError,
  RuntimeConfigArtifactIntegrityError,
  RuntimeConfigPointerConflictError,
  RuntimeConfigPointerOutcomeUnknownError,
  RuntimeConfigR2ConfigurationError,
  RUNTIME_CONFIG_R2_ENV,
} from "./tlsn-runtime-config-r2-store.mjs";

const MANIFEST_KEY = "tlsn/runtime-config/v2/manifest.json";
const R2_ENV = {
  [RUNTIME_CONFIG_R2_ENV.accountId]: "0123456789abcdef0123456789abcdef",
  [RUNTIME_CONFIG_R2_ENV.bucket]: "tlsn-runtime-config-test",
  [RUNTIME_CONFIG_R2_ENV.accessKeyId]: "test-access-key",
  [RUNTIME_CONFIG_R2_ENV.secretAccessKey]: "test-secret-access-key",
};

function s3Error(name, status, code = name) {
  const error = new Error(name);
  error.name = name;
  error.Code = code;
  error.$metadata = { httpStatusCode: status };
  return error;
}

class FakeS3Client {
  constructor() {
    this.objects = new Map();
    this.requests = [];
    this.nextETag = 1;
    this.failNextPut = null;
  }

  async send(command) {
    this.requests.push(command);
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key);
      if (!object) throw s3Error("NoSuchKey", 404);
      return { Body: Buffer.from(object.body), ETag: object.etag };
    }
    assert(command instanceof PutObjectCommand);
    if (this.failNextPut?.afterCommit === false) {
      const { error } = this.failNextPut;
      this.failNextPut = null;
      throw error;
    }
    const existing = this.objects.get(command.input.Key);
    if (
      command.input.IfNoneMatch === "*" && existing ||
      command.input.IfMatch !== undefined &&
        (!existing || command.input.IfMatch !== existing.etag)
    ) {
      throw s3Error("PreconditionFailed", 412);
    }
    const etag = `"r2-test-${this.nextETag++}"`;
    this.objects.set(command.input.Key, {
      body: Buffer.from(command.input.Body),
      etag,
    });
    if (this.failNextPut) {
      const { error } = this.failNextPut;
      this.failNextPut = null;
      throw error;
    }
    return { ETag: etag };
  }
}

function manifestObject(body) {
  return {
    key: MANIFEST_KEY,
    content_type: "application/json",
    cache_control: "no-store",
    body: Buffer.from(body),
  };
}

function immutableObject(body) {
  const bytes = Buffer.from(body);
  const digest = createHash("sha256").update(bytes).digest("base64url");
  return {
    key: `tlsn/runtime-config/v2/artifacts/worker-reference/${digest}`,
    content_type: "application/octet-stream",
    cache_control: "public, max-age=31536000, immutable",
    body: bytes,
  };
}

test("R2 environment validation reports missing configuration without exposing values", () => {
  assert.throws(
    () => createCloudflareR2RuntimeConfigObjectStore({ env: {} }),
    (error) => {
      assert(error instanceof RuntimeConfigR2ConfigurationError);
      for (const name of Object.values(RUNTIME_CONFIG_R2_ENV)) {
        assert(error.message.includes(name));
      }
      assert(!error.message.includes(R2_ENV[RUNTIME_CONFIG_R2_ENV.secretAccessKey]));
      return true;
    },
  );
  assert.throws(
    () => createCloudflareR2RuntimeConfigObjectStore({
      env: { ...R2_ENV, [RUNTIME_CONFIG_R2_ENV.accountId]: "not-an-account-id" },
    }),
    /32 hexadecimal characters/,
  );
  assert.throws(
    () => createCloudflareR2RuntimeConfigObjectStore({
      env: { ...R2_ENV, [RUNTIME_CONFIG_R2_ENV.bucket]: "bad/bucket" },
    }),
    /3-63 lowercase letters/,
  );

  const store = createCloudflareR2RuntimeConfigObjectStore({
    env: R2_ENV,
    client: new FakeS3Client(),
  });
  assert.equal(typeof store.compareAndSwapManifest, "function");
});

test("immutable artifacts use content-addressed create-only writes and exact readback", async () => {
  const client = new FakeS3Client();
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });
  const artifact = immutableObject("approved Worker reference bytes");

  assert.equal((await store.putImmutable(artifact)).state, "CREATED");
  const firstPut = client.requests.find((request) => request instanceof PutObjectCommand);
  assert.equal(firstPut.input.IfNoneMatch, "*");
  assert.equal(firstPut.input.IfMatch, undefined);
  assert.deepEqual(await store.getObject(artifact.key), artifact.body);

  assert.equal((await store.putImmutable(artifact)).state, "ALREADY_PRESENT");
  assert.equal(
    client.requests.filter((request) => request instanceof PutObjectCommand).length,
    2,
  );

  const wrongDigest = { ...artifact, body: Buffer.from("different content") };
  await assert.rejects(
    () => store.putImmutable(wrongDigest),
    RuntimeConfigArtifactIntegrityError,
  );
});

test("immutable write timeout is reconciled once and never retried", async () => {
  const client = new FakeS3Client();
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });
  const artifact = immutableObject("artifact bytes");
  client.failNextPut = {
    afterCommit: true,
    error: Object.assign(new Error("timed out after commit"), { code: "ETIMEDOUT" }),
  };

  assert.equal((await store.putImmutable(artifact)).state, "ALREADY_PRESENT");
  assert.equal(
    client.requests.filter((request) => request instanceof PutObjectCommand).length,
    1,
  );
});

test("a rejected immutable create with no readable object is reported as a conflict", async () => {
  const client = new FakeS3Client();
  const send = client.send.bind(client);
  client.send = async (command) => {
    if (command instanceof PutObjectCommand) {
      throw s3Error("PreconditionFailed", 412);
    }
    return send(command);
  };
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });

  await assert.rejects(
    () => store.putImmutable(immutableObject("artifact bytes")),
    RuntimeConfigArtifactConflictError,
  );
});

test("manifest pointer uses create-if-absent then ETag conditional updates", async () => {
  const client = new FakeS3Client();
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });
  assert.equal(await store.getManifestState(), null);
  const initialETag = await store.compareAndSwapManifest(null, manifestObject("signed one"));
  const firstPointer = await store.getManifestState();
  assert.equal(firstPointer.etag, initialETag);
  assert.deepEqual(firstPointer.body, Buffer.from("signed one"));

  const firstPut = client.requests.find((request) => request instanceof PutObjectCommand);
  assert.equal(firstPut.input.IfNoneMatch, "*");
  assert.equal(firstPut.input.IfMatch, undefined);

  const secondETag = await store.compareAndSwapManifest(
    initialETag,
    manifestObject("signed two"),
  );
  const secondPut = client.requests
    .filter((request) => request instanceof PutObjectCommand)
    .at(-1);
  assert.equal(secondPut.input.IfMatch, initialETag);
  assert.equal(secondPut.input.IfNoneMatch, undefined);
  assert.equal((await store.getManifestState()).etag, secondETag);

  await assert.rejects(
    () => store.compareAndSwapManifest(initialETag, manifestObject("stale writer")),
    RuntimeConfigPointerConflictError,
  );
});

test("AWS SDK serializes R2 conditional writes to path-style PutObject requests", async () => {
  const requests = [];
  const client = new S3Client({
    endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    region: "auto",
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret" },
    requestHandler: {
      async handle(request) {
        requests.push(request);
        return {
          response: {
            statusCode: 200,
            headers: { etag: '"sdk-test-etag"' },
            body: Buffer.alloc(0),
          },
        };
      },
    },
  });
  try {
    const store = createR2RuntimeConfigObjectStore({
      bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
      client,
    });
    await store.compareAndSwapManifest(null, manifestObject("first envelope"));
    await store.compareAndSwapManifest('"previous-etag"', manifestObject("next envelope"));
  } finally {
    client.destroy();
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "PUT");
  assert.equal(
    requests[0].hostname,
    "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  );
  assert.equal(
    requests[0].path,
    "/tlsn-runtime-config-test/tlsn/runtime-config/v2/manifest.json",
  );
  assert.equal(requests[0].headers["if-none-match"], "*");
  assert.equal(requests[0].headers["if-match"], undefined);
  assert.equal(requests[1].headers["if-match"], '"previous-etag"');
  assert.equal(requests[1].headers["if-none-match"], undefined);
});

test("simultaneous writers with the same ETag produce one winner and one explicit conflict", async () => {
  const client = new FakeS3Client();
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });
  const initialETag = await store.compareAndSwapManifest(null, manifestObject("initial"));
  const outcomes = await Promise.allSettled([
    store.compareAndSwapManifest(initialETag, manifestObject("release A")),
    store.compareAndSwapManifest(initialETag, manifestObject("release B")),
  ]);

  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = outcomes.find(({ status }) => status === "rejected");
  assert(rejected.reason instanceof RuntimeConfigPointerConflictError);
});

test("pointer timeout after commit reconciles by body and ETag; timeout before commit stays unknown", async () => {
  const committedClient = new FakeS3Client();
  const committedStore = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client: committedClient,
  });
  committedClient.failNextPut = {
    afterCommit: true,
    error: Object.assign(new Error("connection reset after commit"), { code: "ECONNRESET" }),
  };
  const committedETag = await committedStore.compareAndSwapManifest(
    null,
    manifestObject("signed pointer"),
  );
  assert.equal((await committedStore.getManifestState()).etag, committedETag);
  assert.equal(
    committedClient.requests.filter((request) => request instanceof PutObjectCommand).length,
    1,
  );

  const unknownClient = new FakeS3Client();
  const unknownStore = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client: unknownClient,
  });
  unknownClient.failNextPut = {
    afterCommit: false,
    error: Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
  };
  await assert.rejects(
    () => unknownStore.compareAndSwapManifest(null, manifestObject("uncertain pointer")),
    RuntimeConfigPointerOutcomeUnknownError,
  );
  assert.equal(await unknownStore.getManifestState(), null);
  assert.equal(
    unknownClient.requests.filter((request) => request instanceof PutObjectCommand).length,
    1,
  );
});

test("manifest pointer object metadata and namespace are fixed", async () => {
  const client = new FakeS3Client();
  const store = createR2RuntimeConfigObjectStore({
    bucket: R2_ENV[RUNTIME_CONFIG_R2_ENV.bucket],
    client,
  });
  await assert.rejects(
    () => store.compareAndSwapManifest(null, {
      ...manifestObject("manifest"),
      cache_control: "public",
    }),
    RuntimeConfigR2ConfigurationError,
  );
  await assert.rejects(
    () => store.getObject("unrelated/object"),
    RuntimeConfigR2ConfigurationError,
  );
  assert.equal(client.requests.length, 0);
});
