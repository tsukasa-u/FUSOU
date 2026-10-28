import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, mock, test } from "node:test";
import { NATIVE_CERTIFICATE_FIELDS, assertNativeGhVersion, nativeGhVerifyCommand,
  NATIVE_GH_IDENTITY_BLOCKER, parseNativeGhVerification, inspectNativeGhArtifact } from "./release-native-attestation.mjs";
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

test("no path topology or caller-declared OS can enable real execution before identity is guaranteed", async () => {
  for (const [platform, path] of [["linux", "/mock/gh"], ["darwin", "/mock/parent-link/gh"],
    ["win32", "/mock/final-link"], ["linux", "/mock/temporarily-replaced/gh"]]) {
    const t = nativeGhFixture();
    Object.assign(t.verifier, { path, platform, execution_identity: "VERIFIED" });
    let reads = 0;
    await assert.rejects(inspectNativeGhArtifact(t, { mockReadFile: async () => { reads++; return t.binary; } }),
      (error) => error.code === NATIVE_GH_IDENTITY_BLOCKER);
    assert.equal(reads, 0); assert.equal(t.calls.length, 0);
  }
  await assert.rejects(inspectNativeGhArtifact(nativeGhFixture()), (error) => error.code === NATIVE_GH_IDENTITY_BLOCKER);
});
test("transient mock substitutions restored before rehash do not establish executable identity", async () => {
  const t = nativeGhFixture(), runner = t.options.mockRunner;
  t.options.mockRunner = async (...args) => {
    const saved = t.files.get(t.verifier.path);
    t.files.set(t.verifier.path, Buffer.from("temporary replacement or retargeted parent/link"));
    const capture = await runner(...args);
    t.files.set(t.verifier.path, saved);
    return capture;
  };
  const result = await inspect(t);
  assert.equal(result.executable_identity, "UNVERIFIED");
  assert.equal(result.execution_identity_blocker, NATIVE_GH_IDENTITY_BLOCKER);
  assert.equal(result.signature_verification, "UNVERIFIED"); assert.equal(result.authenticated, false);
  t.files.set(t.verifier.path, Buffer.from("replacement after inspection"));
  assert.equal(result.authenticated, false); assert.equal(result.publication_authorized, false);
  await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_EXECUTABLE_MISMATCH");
});
test("a verifier path change after version inspection stops before attestation lookup", async () => {
  const t = nativeGhFixture(), runner = t.options.mockRunner;
  t.options.mockRunner = async (...args) => {
    const capture = await runner(...args); t.verifier.path = "/mock/new-parent/gh"; return capture;
  };
  await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_INPUT_CHANGED");
  assert.equal(t.calls.length, 1);
});
test("mock process settings use an explicit credentialless allowlist, not the parent environment", async () => {
  const parent = process.env;
  process.env = { GH_HOST: "attacker.invalid", GH_CONFIG_DIR: "/hostile/gh", XDG_CONFIG_HOME: "/hostile/xdg",
    HOME: "/hostile/home", GH_TOKEN: "synthetic token canary", GITHUB_TOKEN: "synthetic github token",
    GH_ENTERPRISE_TOKEN: "synthetic enterprise token", GH_DEBUG: "api", PATH: "/hostile/bin",
    HTTPS_PROXY: "https://hostile.invalid", SSL_CERT_FILE: "/hostile/ca", LD_PRELOAD: "/hostile/library",
    NODE_OPTIONS: "--trace-warnings", GH_REPO: "attacker/other" };
  try {
    const t = nativeGhFixture(), result = await inspect(t);
    for (const { path, settings } of t.calls) {
      assert.equal(path, "/mock/gh"); assert.equal(settings.cwd, "/mock/isolated");
      assert.deepEqual(settings.env, { GH_HOST: "github.com", GH_CONFIG_DIR: "/mock/isolated/gh",
        HOME: "/mock/isolated/home", XDG_CONFIG_HOME: "/mock/isolated/xdg",
        GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1",
        LANG: "C", LC_ALL: "C" });
      assert(Object.isFrozen(settings)); assert(Object.isFrozen(settings.env));
    }
    assert(!JSON.stringify(result).includes("synthetic token"));
    assert(!JSON.stringify(result).includes("credential canary"));
  } finally { process.env = parent; }
});
for (const [label, change, code] of [
  ["missing contract", () => undefined, "NATIVE_GH_ENVIRONMENT_CONTRACT_MISSING"],
  ["foreign host", (e) => ({ ...e, host: "attacker.invalid" }), "NATIVE_GH_HOST_UNSUPPORTED"],
  ["ambient config", (e) => ({ ...e, config_source: "PARENT" }), "NATIVE_GH_CONFIG_CONTRACT_INVALID"],
  ["missing directory", (e) => ({ ...e, config_root: undefined }), "NATIVE_GH_CONFIG_CONTRACT_INVALID"],
  ["relative directory", (e) => ({ ...e, config_root: "relative" }), "NATIVE_GH_CONFIG_CONTRACT_INVALID"],
  ["root directory", (e) => ({ ...e, config_root: "/" }), "NATIVE_GH_CONFIG_CONTRACT_INVALID"],
  ["directory traversal", (e) => ({ ...e, config_root: "/mock/../hostile" }), "NATIVE_GH_CONFIG_CONTRACT_INVALID"],
  ["credential required but not registered", (e) => ({ ...e, credential_source: "GH_TOKEN" }), "NATIVE_GH_CREDENTIAL_PROVIDER_NOT_REGISTERED"],
  ["missing credential mode", (e) => ({ ...e, credential_source: undefined }), "NATIVE_GH_CREDENTIAL_PROVIDER_NOT_REGISTERED"],
  ["secret injection", (e) => ({ ...e, GH_TOKEN: "secret canary" }), "NATIVE_GH_ENVIRONMENT_CONTRACT_MISSING"],
]) {
  test(`environment rejects ${label} before reading files or invoking a runner`, async () => {
    const t = nativeGhFixture(); t.execution = change(t.execution);
    t.options.mockReadFile = async () => { assert.fail("environment must be checked first"); };
    await assert.rejects(inspect(t), (error) => error.code === code && !error.message.includes("secret canary"));
    assert.equal(t.calls.length, 0);
  });
}
for (const field of ["host", "config_root", "credential_source"]) {
  test(`changing ${field} after version capture cannot change the next process context`, async () => {
    const t = nativeGhFixture(), runner = t.options.mockRunner;
    t.options.mockRunner = async (...args) => {
      const capture = await runner(...args); t.execution[field] = "changed"; return capture;
    };
    await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_INPUT_CHANGED");
    assert.equal(t.calls.length, 1);
  });
}
test("file budgets are explicit and cannot be missing, invalid, expanded or taken from file declarations", async () => {
  for (const limits of [undefined, {}, { verifier_executable: 4096 }, { verifier_executable: 4096,
    native_artifact: 4096, build_metadata: 16 * 1024, extra: 1 }]) {
    const t = nativeGhFixture(); t.fileLimits = limits;
    await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_FILE_LIMITS_MISSING");
    assert.equal(t.calls.length, 0);
  }
  for (const value of [0, -1, 1.5, Infinity, "4096", undefined]) {
    const t = nativeGhFixture(); t.fileLimits.native_artifact = value;
    await assert.rejects(inspect(t), (error) => error.code === "RELEASE_FILE_LIMIT_INVALID");
    assert.equal(t.calls.length, 0);
  }
  const t = nativeGhFixture(); t.fileLimits.build_metadata = 1024 * 1024 + 1;
  await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_METADATA_LIMIT_INVALID");
});
for (const role of ["verifier_executable", "native_artifact", "build_metadata"]) {
  test(`${role} byte budgets enforce below, equal, above and empty boundaries even for a mock reader`, async () => {
    for (const extra of [0, 1]) {
      const t = nativeGhFixture();
      if (role === "build_metadata") t.artifactRole = role;
      const raw = t.files.get(role === "verifier_executable" ? t.verifier.path : t.artifactPath);
      t.fileLimits[role] = raw.length + extra;
      const result = await inspect(t);
      assert.equal(result.authenticated, false); assert.equal(result.publication_authorized, false);
    }
    const t = nativeGhFixture(), path = role === "verifier_executable" ? t.verifier.path : t.artifactPath;
    if (role === "build_metadata") t.artifactRole = role;
    t.fileLimits[role] = t.files.get(path).length - 1;
    await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_FILE_TOO_LARGE");
    assert.equal(t.calls.length, 0);
    t.files.set(path, Buffer.alloc(0));
    await assert.rejects(inspect(t), (error) => error.code === "NATIVE_GH_FILE_EMPTY_OR_INVALID");
  });
}
test("mock file reads receive immutable bounds and later growth or budget mutation rejects the whole inspection", async () => {
  for (const change of ["file growth", "budget"]) {
    const t = nativeGhFixture(), read = t.options.mockReadFile, runner = t.options.mockRunner;
    t.options.mockReadFile = async (path, bounds) => {
      assert(Object.isFrozen(bounds)); assert.equal(bounds.minBytes, 1);
      assert.equal(bounds.maxBytes, path === t.verifier.path ? t.fileLimits.verifier_executable : t.fileLimits.native_artifact);
      return read(path);
    };
    t.options.mockRunner = async (...args) => {
      const capture = await runner(...args);
      if (args[1][0] !== "--version") {
        if (change === "file growth") t.files.set(t.artifactPath, Buffer.alloc(t.fileLimits.native_artifact + 1));
        else t.fileLimits.native_artifact++;
      }
      return capture;
    };
    await assert.rejects(inspect(t), (error) =>
      error.code === (change === "file growth" ? "NATIVE_GH_FILE_TOO_LARGE" : "NATIVE_GH_INPUT_CHANGED"));
  }
});
test("mock process integration bounds actual data-file reads without ever executing those files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fusou-native-data-"));
  try {
    const t = nativeGhFixture(), executable = t.files.get(t.verifier.path);
    t.verifier.path = join(directory, "gh.data"); t.artifactPath = join(directory, "artifact.data");
    await writeFile(t.verifier.path, executable); await writeFile(t.artifactPath, t.binary);
    t.options = { mockRunner: t.options.mockRunner };
    t.fileLimits.verifier_executable = executable.length; t.fileLimits.native_artifact = t.binary.length;
    const result = await inspect(t);
    assert.equal(result.authenticated, false); assert.equal(result.signature_verification, "UNVERIFIED");
    t.calls.length = 0; t.fileLimits.native_artifact--;
    await assert.rejects(inspect(t), (error) => error.code === "RELEASE_FILE_TOO_LARGE");
    assert.equal(t.calls.length, 0);
  } finally { await rm(directory, { recursive: true }); }
});
