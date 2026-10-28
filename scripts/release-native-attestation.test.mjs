import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { NATIVE_CERTIFICATE_FIELDS, assertNativeGhVersion, nativeGhVerifyCommand,
  parseNativeGhVerification, inspectNativeGhArtifact } from "./release-native-attestation.mjs";
import { nativeGhFixture, nativeFixtureHex as hex } from "./release-native-attestation-fixture.mjs";

const prohibited = [];
for (const name of ["generateKey", "sign"]) mock.method(crypto.subtle, name, () => {
  prohibited.push(name); throw new Error(`Forbidden ${name}`);
});
mock.method(globalThis, "fetch", () => { prohibited.push("fetch"); throw new Error("Forbidden network"); });
after(() => { try { assert.deepEqual(prohibited, []); } finally { mock.restoreAll(); } });
const parse = (t, raw = t.encode()) =>
  parseNativeGhVerification(raw, { expected: t.expected, artifactSha256: hex(t.binary) });
const inspect = (t) => inspectNativeGhArtifact(t, t.options);

test("official-schema synthetic JSON is structure-checked, never cryptographically authenticated", () => {
  const t = nativeGhFixture(), result = parse(t);
  assert.equal(result.schema_consistency, "VERIFIED"); assert.equal(result.authenticated, false);
  assert.equal(result.signature_verification, "UNVERIFIED");
  assert.notEqual(result.certificate.certificateIssuer, result.certificate.issuer);
  t.entry.verificationResult.verifiedIdentity = {};
  assert.equal(parse(t).authenticated, false);
});
test("official-style gh version output may include its matching release URL", async () => {
  const raw = Buffer.from("gh version 2.102.0 (2026-10-28)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n");
  assert.equal(assertNativeGhVersion(raw), "2.102.0");
  const t = nativeGhFixture(), runner = t.options.mockRunner;
  t.options.mockRunner = async (...args) => {
    const result = await runner(...args);
    if (args[1][0] === "--version") result.stdout = raw;
    return result;
  };
  assert.equal((await inspect(t)).gh_version, "2.102.0");
});
test("timestamp calendar dates must be valid, not silently normalized by Date.parse", () => {
  const t = nativeGhFixture();
  t.expected.timestamps.not_before_ms = Date.parse("2026-01-01T00:00:00Z");
  t.expected.timestamps.not_after_ms = Date.parse("2027-01-01T00:00:00Z");
  t.entry.verificationResult.verifiedTimestamps[0].timestamp = "2026-02-30T11:00:00Z";
  assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_TIMESTAMP_INVALID");
});
for (const [label, raw] of [["invalid", "{"], ["empty", ""], ["object", "{}"], ["empty array", "[]"],
  ["missing entry", "[null]"], ["missing result", '[{"attestation":{}}]'],
  ["legacy flags", '[{"verified":true,"signatureVerified":true}]']]) {
  test(`reject ${label} JSON`, () => assert.throws(() => parse(nativeGhFixture(), Buffer.from(raw))));
}
test("duplicate keys, including escaped and nested keys, are rejected with whitespace allowed", () => {
  const t = nativeGhFixture();
  for (const raw of [t.encode().toString().replace('"mediaType":', '"mediaType":"wrong","mediaType":'),
    t.encode().toString().replace('"synthetic": true', '"synthetic":false,"synth\\u0065tic":true')]) {
    assert.throws(() => parse(t, Buffer.from(raw)), (e) => e.code === "NATIVE_GH_JSON_INVALID");
  }
});
for (const field of ["statement", "signature", "verifiedTimestamps", "mediaType"]) {
  test(`required verificationResult ${field}`, () => {
    const t = nativeGhFixture(); delete t.entry.verificationResult[field]; assert.throws(() => parse(t));
  });
}
for (const field of NATIVE_CERTIFICATE_FIELDS) {
  test(`certificate ${field} must exactly match independent policy`, () => {
    const t = nativeGhFixture(); t.entry.verificationResult.signature.certificate[field] = "foreign";
    assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_CERTIFICATE_MISMATCH");
    delete t.entry.verificationResult.signature.certificate[field];
    assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_CERTIFICATE_MISSING");
  });
}
for (const mutation of ["no certificate", "wrong mediaType", "unknown schema", "wrong subject", "missing digest",
  "bad digest", "missing subject", "duplicate subject", "wrong predicate", "case-only ref", "multiple entries",
  "missing timestamps", "wrong timestamp authority", "invalid time", "out-of-window time", "duplicate timestamps"]) {
  test(`reject ${mutation}`, () => {
    const t = nativeGhFixture(), v = t.entry.verificationResult;
    if (mutation === "no certificate") delete v.signature.certificate;
    if (mutation === "wrong mediaType") v.mediaType = "foreign";
    if (mutation === "unknown schema") v.signatureVerified = true;
    if (mutation === "wrong subject") v.statement.subject[0].digest.sha256 = "0".repeat(64);
    if (mutation === "missing digest") delete v.statement.subject[0].digest.sha256;
    if (mutation === "bad digest") v.statement.subject[0].digest.sha256 = "SHA256:invalid";
    if (mutation === "missing subject") v.statement.subject = [];
    if (mutation === "duplicate subject") v.statement.subject.push(structuredClone(v.statement.subject[0]));
    if (mutation === "wrong predicate") v.statement.predicateType = "foreign";
    if (mutation === "case-only ref") v.signature.certificate.sourceRepositoryRef = "refs/heads/Main";
    if (mutation === "multiple entries") {
      assert.throws(() => parse(t, Buffer.from(JSON.stringify([t.entry, t.entry])))); return;
    }
    if (mutation === "missing timestamps") v.verifiedTimestamps = [];
    if (mutation === "wrong timestamp authority") v.verifiedTimestamps[0].uri = "foreign";
    if (mutation === "invalid time") v.verifiedTimestamps[0].timestamp = "yesterday";
    if (mutation === "out-of-window time") v.verifiedTimestamps[0].timestamp = "2020-01-01T00:00:00Z";
    if (mutation === "duplicate timestamps") v.verifiedTimestamps.push(structuredClone(v.verifiedTimestamps[0]));
    assert.throws(() => parse(t));
  });
}
for (const field of ["repository", "signer_workflow", "predicate_type", "certificate", "timestamps"]) {
  test(`missing independent ${field} blocks before any process`, async () => {
    const t = nativeGhFixture(); delete t.expected[field];
    await assert.rejects(inspect(t)); assert.equal(t.calls.length, 0);
  });
}
test("self-declared predicate claims cannot replace a rejected certificate or independent compiler policy", () => {
  const t = nativeGhFixture();
  t.entry.verificationResult.statement.predicate = { authenticated: true, toolchain: "approved",
    ...t.expected.certificate };
  assert.equal(parse(t).authenticated, false);
  t.entry.verificationResult.signature.certificate.sourceRepositoryDigest = "0".repeat(40);
  assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_CERTIFICATE_MISMATCH");
});
test("trusted flags use reusable signer, exact source-ref and argv, never an offline bundle fallback", async () => {
  const t = nativeGhFixture(), argv = nativeGhVerifyCommand(t.artifactPath, t.expected), result = await inspect(t);
  assert.deepEqual(argv, ["attestation", "verify", "/mock/native", "--repo", "tsukasa-u/FUSOU",
    "--signer-workflow", t.expected.signer_workflow, "--signer-digest", "b".repeat(40),
    "--predicate-type", t.expected.predicate_type, "--source-digest", "a".repeat(40),
    "--source-ref", "refs/heads/main", "--format", "json"]);
  assert.equal(t.calls.length, 2); assert.deepEqual(t.calls[0].argv, ["--version"]);
  assert.equal(t.calls[1].settings.shell, false); assert.equal(t.calls[1].settings.timeout, 15_000);
  assert.equal(result.authenticated, false); assert.equal(result.verification_mode, "MOCK_PROCESS");
  assert.equal(result.production_acceptance, "BLOCKED"); assert.equal(result.publication_authorized, false);
  assert(!JSON.stringify(result).includes("credential canary"));
});
for (const version of ["", "gh version 2.101.0\n", "gh version 2.99.9\n", "gh version 3.0.0\n",
  "gh version 2.102.0-dev\n", "unknown"]) {
  test(`version gate rejects ${JSON.stringify(version)}`, async () => {
    const code = version === "" || version === "unknown" ? "NATIVE_GH_VERSION_UNKNOWN" : "NATIVE_GH_VERSION_UNSUPPORTED";
    assert.throws(() => assertNativeGhVersion(Buffer.from(version)), (error) => error.code === code);
    const t = nativeGhFixture();
    t.options.mockRunner = async () => ({ code: 0, stdout: Buffer.from(version), stderr: Buffer.alloc(0) });
    await assert.rejects(inspect(t));
  });
}
for (const [code, blocker] of [["ENOENT", "NATIVE_GH_NOT_FOUND"], ["ETIMEDOUT", "NATIVE_GH_TIMEOUT"],
  [1, "NATIVE_GH_EXIT_NONZERO"], ["UNKNOWN", "NATIVE_GH_EXECUTION_FAILED"]]) {
  test(`process ${code} fails closed without exposing stderr or error credentials`, async () => {
    const t = nativeGhFixture();
    t.options.mockRunner = async () => { throw Object.assign(new Error("secret canary"), { code }); };
    await assert.rejects(inspect(t), (e) => e.code === blocker && !e.message.includes("secret canary"));
  });
}
test("nonzero capture rejects valid-looking stdout; stderr never supplies JSON", async () => {
  for (const result of [{ code: 1, stdout: Buffer.from("[]"), stderr: Buffer.alloc(0) },
    { code: 0, stdout: Buffer.from("not JSON"), stderr: nativeGhFixture().encode() },
    { stdout: nativeGhFixture().encode(), stderr: Buffer.alloc(0) },
    { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) },
    { code: 0, stdout: nativeGhFixture().encode(), stderr: "not raw bytes" },
    { code: 0, stdout: Buffer.alloc(1024 * 1024 + 1), stderr: Buffer.alloc(0) }]) {
    const t = nativeGhFixture(), original = t.options.mockRunner;
    t.options.mockRunner = async (...args) => args[1][0] === "--version" ? original(...args) : result;
    await assert.rejects(inspect(t));
  }
});
test("unapproved policy and missing/mismatched consumer gh pin refuse before any process", async () => {
  for (const mutation of ["approval", "missing pin", "wrong executable"]) {
    const t = nativeGhFixture();
    if (mutation === "approval") t.expected.approval = "PROPOSED";
    if (mutation === "missing pin") delete t.verifier.sha256;
    if (mutation === "wrong executable") t.verifier.sha256 = "0".repeat(64);
    await assert.rejects(inspect(t)); assert.equal(t.calls.length, 0);
  }
});
test("timestamp fields are mandatory and unknown signature fields are not verification flags", () => {
  for (const field of ["type", "uri", "timestamp"]) {
    const t = nativeGhFixture(); delete t.entry.verificationResult.verifiedTimestamps[0][field];
    assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_TIMESTAMP_INVALID");
  }
  const t = nativeGhFixture(); t.entry.verificationResult.signature.signatureVerified = true;
  assert.throws(() => parse(t), (e) => e.code === "NATIVE_GH_CERTIFICATE_MISSING");
});
test("missing gh and changed gh/artifact/policy cannot accept producer-supplied stdout", async () => {
  const missing = nativeGhFixture(); missing.files.delete(missing.verifier.path);
  await assert.rejects(inspect(missing), (e) => e.code === "NATIVE_GH_NOT_FOUND");
  for (const mutation of ["gh", "artifact", "policy"]) {
    const t = nativeGhFixture(), original = t.options.mockRunner;
    t.stdout = t.encode();
    t.options.mockRunner = async (...args) => {
      const result = await original(...args);
      if (args[1][0] !== "--version") {
        if (mutation === "gh") t.files.set(t.verifier.path, Buffer.from("substituted"));
        if (mutation === "artifact") t.files.set(t.artifactPath, Buffer.from("substituted"));
        if (mutation === "policy") t.expected.certificate.sourceRepositoryRef = "refs/heads/Main";
      }
      return result;
    };
    await assert.rejects(inspect(t), (e) => e.code === "NATIVE_GH_INPUT_CHANGED");
  }
});
