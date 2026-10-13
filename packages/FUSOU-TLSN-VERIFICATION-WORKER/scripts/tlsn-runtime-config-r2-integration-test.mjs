#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { test } from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { inspectRuntimeConfigR2IntegrationConfiguration } from "./tlsn-runtime-config-r2-integration-config.mjs";

const integrationConfiguration = inspectRuntimeConfigR2IntegrationConfiguration();
const INTEGRATION_PREFIX = "tlsn/runtime-config-integration";
const TEST_RELEASE_SCOPE = "FUSOU-R2-INTEGRATION-TEST-ONLY-v1";
const REQUEST_TIMEOUT_MS = 15_000;

function sha256Base64Url(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function isConditionalFailure(error) {
  return [409, 412].includes(error?.$metadata?.httpStatusCode) ||
    ["ConditionalRequestConflict", "PreconditionFailed"].includes(
      error?.Code ?? error?.code ?? error?.name,
    );
}

function isNotFound(error) {
  const code = error?.Code ?? error?.code ?? error?.name;
  return code !== "NoSuchBucket" && (
    error?.$metadata?.httpStatusCode === 404 ||
    ["NoSuchKey", "NotFound", "NoSuchObject"].includes(code)
  );
}

function makeTestRelease({
  privateKey,
  runId,
  sequence,
  artifactKey,
  artifactSha256,
}) {
  const payload = {
    scope: TEST_RELEASE_SCOPE,
    run_id: runId,
    sequence,
    artifact_key: artifactKey,
    artifact_sha256: artifactSha256,
  };
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign(null, payloadBytes, privateKey).toString("base64url");
  return Buffer.from(JSON.stringify({
    payload,
    signature_base64url: signature,
  }), "utf8");
}

function verifyTestRelease(raw, {
  publicKey,
  runId,
  artifactKey,
  artifactBytes,
}) {
  let envelope;
  try {
    envelope = JSON.parse(raw.toString("utf8"));
  } catch (cause) {
    throw new Error("test pointer is not valid JSON", { cause });
  }
  const payload = envelope?.payload;
  const expectedFields = [
    "artifact_key",
    "artifact_sha256",
    "run_id",
    "scope",
    "sequence",
  ];
  if (
    !payload ||
    Object.keys(payload).sort().join(",") !== expectedFields.join(",") ||
    !envelope ||
    Object.keys(envelope).sort().join(",") !== "payload,signature_base64url" ||
    typeof envelope.signature_base64url !== "string" ||
    payload.scope !== TEST_RELEASE_SCOPE ||
    payload.run_id !== runId ||
    payload.artifact_key !== artifactKey
  ) {
    throw new Error("test pointer has an invalid test-only release shape");
  }
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = Buffer.from(envelope.signature_base64url, "base64url");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(payload.artifact_sha256) ||
    signature.byteLength !== 64 ||
    !verify(null, payloadBytes, publicKey, signature)
  ) {
    throw new Error("test pointer signature verification failed");
  }
  if (payload.artifact_sha256 !== sha256Base64Url(artifactBytes)) {
    throw new Error("test pointer artifact digest does not match the readback bytes");
  }
  return payload;
}

function responseBytes(body) {
  if (!body || typeof body.transformToByteArray !== "function") {
    throw new Error("R2 integration GET returned no readable body");
  }
  return body.transformToByteArray().then((bytes) => Buffer.from(bytes));
}

test(
  "explicitly opted-in disposable R2 bucket enforces create-only writes, conditional pointer CAS, and readback",
  { skip: integrationConfiguration.state === "READY"
    ? false
    : `${integrationConfiguration.state}: ${integrationConfiguration.reason}` },
  async (t) => {
    const { accountId, bucket, accessKeyId, secretAccessKey, endpoint } =
      integrationConfiguration.config;
    const runId = randomUUID();
    const runPrefix = `${INTEGRATION_PREFIX}/${runId}`;
    const artifactBytes = Buffer.from(`disposable R2 integration artifact ${runId}`, "utf8");
    const artifactDigest = sha256Base64Url(artifactBytes);
    const artifactKey = `${runPrefix}/artifacts/${artifactDigest}`;
    const keys = (...parts) => `${runPrefix}/${parts.join("/")}`;
    const keyPair = generateKeyPairSync("ed25519");
    const createdArtifactKeys = new Map();
    const pointerKeys = new Set();
    const lastWrittenPointerETags = new Map();
    const client = new S3Client({
      endpoint,
      region: "auto",
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId, secretAccessKey },
    });

    async function send(command, selectedClient = client) {
      return selectedClient.send(command, {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    }

    async function getObject(key) {
      try {
        const response = await send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (
          typeof response.ETag !== "string" ||
          response.ETag.length === 0 ||
          response.ETag.trim() !== response.ETag
        ) {
          throw new Error("R2 integration GET returned an invalid ETag");
        }
        return Object.freeze({
          body: await responseBytes(response.Body),
          etag: response.ETag,
        });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    }

    async function conditionalPut(key, body, condition, selectedClient = client) {
      const conditionNames = Object.keys(condition ?? {});
      if (
        conditionNames.length !== 1 ||
        conditionNames[0] !== "IfMatch" && conditionNames[0] !== "IfNoneMatch" ||
        conditionNames[0] === "IfMatch" &&
          (typeof condition.IfMatch !== "string" || !condition.IfMatch) ||
        conditionNames[0] === "IfNoneMatch" && condition.IfNoneMatch !== "*"
      ) {
        throw new Error("R2 integration writes require exactly one explicit conditional header");
      }
      try {
        const response = await send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: "application/octet-stream",
          ...condition,
        }), selectedClient);
        if (
          typeof response.ETag !== "string" ||
          response.ETag.length === 0 ||
          response.ETag.trim() !== response.ETag
        ) {
          throw new Error("R2 integration conditional write returned an invalid ETag");
        }
        if (pointerKeys.has(key) && typeof response.ETag === "string") {
          lastWrittenPointerETags.set(key, response.ETag);
        }
        return Object.freeze({ state: "CREATED", etag: response.ETag });
      } catch (error) {
        if (isConditionalFailure(error)) {
          return Object.freeze({ state: "CONDITIONAL_CONFLICT" });
        }
        throw error;
      }
    }

    function newPointerKey(name) {
      const key = keys("pointers", `${name}.json`);
      pointerKeys.add(key);
      return key;
    }

    function signedRelease(sequence, digest = artifactDigest) {
      return makeTestRelease({
        privateKey: keyPair.privateKey,
        runId,
        sequence,
        artifactKey,
        artifactSha256: digest,
      });
    }

    function verifyReleaseBytes(bytes) {
      return verifyTestRelease(bytes, {
        publicKey: keyPair.publicKey,
        runId,
        artifactKey,
        artifactBytes,
      });
    }

    function withWriteFailure(key, timing) {
      let fired = false;
      return {
        async send(command, options) {
          if (
            !fired &&
            command instanceof PutObjectCommand &&
            command.input.Key === key &&
            timing === "before-send"
          ) {
            fired = true;
            throw Object.assign(new Error("simulated timeout before request submission"), {
              code: "ETIMEDOUT",
            });
          }
          const output = await client.send(command, options);
          if (
            !fired &&
            command instanceof PutObjectCommand &&
            command.input.Key === key &&
            timing === "after-commit"
          ) {
            fired = true;
            throw Object.assign(new Error("simulated lost response after R2 accepted the write"), {
              code: "ECONNRESET",
            });
          }
          return output;
        },
      };
    }

    t.after(async () => {
      try {
        for (const [key, expectedBytes] of createdArtifactKeys) {
          const current = await getObject(key);
          if (!current) continue;
          if (!current.body.equals(expectedBytes)) {
            t.diagnostic(`artifact retained because exact readback differs: ${key}`);
            continue;
          }
          await send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
          assert.equal(await getObject(key), null, `artifact cleanup readback failed: ${key}`);
        }
        for (const key of pointerKeys) {
          const current = await getObject(key);
          if (!current) continue;
          const writtenETag = lastWrittenPointerETags.get(key);
          if (!writtenETag || current.etag !== writtenETag) {
            t.diagnostic(`mutable pointer retained because its last written ETag is unavailable or changed: ${key}`);
            continue;
          }
          t.diagnostic(
            `mutable pointer retained under the disposable run prefix: R2's published S3 compatibility table does not document conditional DeleteObject If-Match (${key})`,
          );
        }
      } finally {
        client.destroy();
      }
    });

    assert.equal(
      endpoint,
      `https://${accountId}.r2.cloudflarestorage.com`,
      "endpoint must be derived only from the validated account ID",
    );

    const artifactCreate = await conditionalPut(
      artifactKey,
      artifactBytes,
      { IfNoneMatch: "*" },
    );
    assert.equal(artifactCreate.state, "CREATED");
    createdArtifactKeys.set(artifactKey, artifactBytes);
    const artifactReadback = await getObject(artifactKey);
    assert(artifactReadback);
    assert.deepEqual(artifactReadback.body, artifactBytes);
    assert.equal(sha256Base64Url(artifactReadback.body), artifactDigest);

    const repeatedCreate = await conditionalPut(
      artifactKey,
      artifactBytes,
      { IfNoneMatch: "*" },
    );
    assert.equal(repeatedCreate.state, "CONDITIONAL_CONFLICT");
    assert.deepEqual((await getObject(artifactKey)).body, artifactBytes);

    const changedBytes = Buffer.from(`${artifactBytes.toString("utf8")}-changed`, "utf8");
    const changedCreate = await conditionalPut(
      artifactKey,
      changedBytes,
      { IfNoneMatch: "*" },
    );
    assert.equal(changedCreate.state, "CONDITIONAL_CONFLICT");
    assert.notDeepEqual((await getObject(artifactKey)).body, changedBytes);

    const racePointer = newPointerKey("first-create-race");
    const firstCreateBodies = [
      signedRelease("first-create-left"),
      signedRelease("first-create-right"),
    ];
    const firstCreateOutcomes = await Promise.all(firstCreateBodies.map((body) =>
      conditionalPut(racePointer, body, { IfNoneMatch: "*" })));
    assert.equal(firstCreateOutcomes.filter(({ state }) => state === "CREATED").length, 1);
    assert.equal(
      firstCreateOutcomes.filter(({ state }) => state === "CONDITIONAL_CONFLICT").length,
      1,
    );
    let currentPointer = await getObject(racePointer);
    assert(currentPointer);
    let currentRelease = verifyReleaseBytes(currentPointer.body);
    assert(firstCreateBodies.some((body) => body.equals(currentPointer.body)));

    const oldETag = currentPointer.etag;
    const correctUpdate = signedRelease("etag-update");
    const correctUpdateResult = await conditionalPut(
      racePointer,
      correctUpdate,
      { IfMatch: oldETag },
    );
    assert.equal(correctUpdateResult.state, "CREATED");
    currentPointer = await getObject(racePointer);
    assert(currentPointer);
    assert.deepEqual(currentPointer.body, correctUpdate);
    currentRelease = verifyReleaseBytes(currentPointer.body);
    assert.equal(currentRelease.sequence, "etag-update");

    const staleUpdate = await conditionalPut(
      racePointer,
      signedRelease("stale-etag"),
      { IfMatch: oldETag },
    );
    assert.equal(staleUpdate.state, "CONDITIONAL_CONFLICT");
    assert.deepEqual((await getObject(racePointer)).body, correctUpdate);

    const sharedETag = currentPointer.etag;
    const competingBodies = [
      signedRelease("same-etag-left"),
      signedRelease("same-etag-right"),
    ];
    const competingOutcomes = await Promise.all(competingBodies.map((body) =>
      conditionalPut(racePointer, body, { IfMatch: sharedETag })));
    assert.equal(competingOutcomes.filter(({ state }) => state === "CREATED").length, 1);
    assert.equal(
      competingOutcomes.filter(({ state }) => state === "CONDITIONAL_CONFLICT").length,
      1,
    );
    currentPointer = await getObject(racePointer);
    assert(currentPointer);
    currentRelease = verifyReleaseBytes(currentPointer.body);
    assert(["same-etag-left", "same-etag-right"].includes(currentRelease.sequence));

    const timeoutPointer = newPointerKey("timeout-reconciliation");
    const beforeTimeoutRelease = signedRelease("before-timeout");
    const beforeTimeoutResult = await conditionalPut(
      timeoutPointer,
      beforeTimeoutRelease,
      { IfNoneMatch: "*" },
    );
    assert.equal(beforeTimeoutResult.state, "CREATED");

    const noSendClient = withWriteFailure(timeoutPointer, "before-send");
    await assert.rejects(
      () => conditionalPut(
        timeoutPointer,
        signedRelease("not-submitted"),
        { IfMatch: beforeTimeoutResult.etag },
        noSendClient,
      ),
      /simulated timeout before request submission/,
    );
    const unchangedReadback = await getObject(timeoutPointer);
    assert(unchangedReadback);
    assert.deepEqual(unchangedReadback.body, beforeTimeoutRelease);
    assert.equal(verifyReleaseBytes(unchangedReadback.body).sequence, "before-timeout");

    const afterCommitRelease = signedRelease("committed-response-lost");
    const lostAckClient = withWriteFailure(timeoutPointer, "after-commit");
    await assert.rejects(
      () => conditionalPut(
        timeoutPointer,
        afterCommitRelease,
        { IfMatch: unchangedReadback.etag },
        lostAckClient,
      ),
      /simulated lost response after R2 accepted the write/,
    );
    const reconciledReadback = await getObject(timeoutPointer);
    assert(reconciledReadback);
    assert.deepEqual(reconciledReadback.body, afterCommitRelease);
    assert.equal(
      verifyReleaseBytes(reconciledReadback.body).sequence,
      "committed-response-lost",
    );

    const competingTimeoutPointer = newPointerKey("timeout-competing-release");
    const originalRelease = signedRelease("original-release");
    const originalWrite = await conditionalPut(
      competingTimeoutPointer,
      originalRelease,
      { IfNoneMatch: "*" },
    );
    assert.equal(originalWrite.state, "CREATED");
    const observedBeforeTimeout = await getObject(competingTimeoutPointer);
    assert(observedBeforeTimeout);
    const competitorRelease = signedRelease("different-valid-release");
    const competitorLostAckClient = withWriteFailure(
      competingTimeoutPointer,
      "after-commit",
    );
    await assert.rejects(
      () => conditionalPut(
        competingTimeoutPointer,
        competitorRelease,
        { IfMatch: observedBeforeTimeout.etag },
        competitorLostAckClient,
      ),
      /simulated lost response after R2 accepted the write/,
    );
    let competingReadback = await getObject(competingTimeoutPointer);
    assert(competingReadback);
    assert.deepEqual(competingReadback.body, competitorRelease);
    assert.equal(
      verifyReleaseBytes(competingReadback.body).sequence,
      "different-valid-release",
    );
    const staleAfterTimeout = await conditionalPut(
      competingTimeoutPointer,
      signedRelease("stale-timeout-writer"),
      { IfMatch: observedBeforeTimeout.etag },
    );
    assert.equal(staleAfterTimeout.state, "CONDITIONAL_CONFLICT");
    competingReadback = await getObject(competingTimeoutPointer);
    assert(competingReadback);
    assert.deepEqual(competingReadback.body, competitorRelease);
    assert.equal(
      verifyReleaseBytes(competingReadback.body).sequence,
      "different-valid-release",
    );

    const invalidSignaturePointer = newPointerKey("invalid-signature-readback");
    const validBeforeMutation = signedRelease("valid-before-signature-mutation");
    const initialInvalidTarget = await conditionalPut(
      invalidSignaturePointer,
      validBeforeMutation,
      { IfNoneMatch: "*" },
    );
    assert.equal(initialInvalidTarget.state, "CREATED");
    const invalidEnvelope = JSON.parse(validBeforeMutation.toString("utf8"));
    invalidEnvelope.signature_base64url = Buffer.alloc(64).toString("base64url");
    const mutatedSignature = Buffer.from(JSON.stringify(invalidEnvelope), "utf8");
    const signatureMutation = await conditionalPut(
      invalidSignaturePointer,
      mutatedSignature,
      { IfMatch: initialInvalidTarget.etag },
    );
    assert.equal(signatureMutation.state, "CREATED");
    await assert.rejects(
      async () => verifyReleaseBytes((await getObject(invalidSignaturePointer)).body),
      /signature verification failed/,
    );

    const invalidDigestPointer = newPointerKey("invalid-digest-readback");
    const wrongArtifactDigest = artifactDigest.startsWith("A")
      ? `B${artifactDigest.slice(1)}`
      : `A${artifactDigest.slice(1)}`;
    const wrongDigestRelease = signedRelease(
      "valid-signature-wrong-digest",
      wrongArtifactDigest,
    );
    const invalidDigestWrite = await conditionalPut(
      invalidDigestPointer,
      wrongDigestRelease,
      { IfNoneMatch: "*" },
    );
    assert.equal(invalidDigestWrite.state, "CREATED");
    await assert.rejects(
      async () => verifyReleaseBytes((await getObject(invalidDigestPointer)).body),
      /artifact digest does not match/,
    );
  },
);
