// Synthetic official-schema JSON and process doubles, not gh output or a signed bundle.
import { createHash } from "node:crypto";
import { NATIVE_GH_MEDIA_TYPE, NATIVE_SLSA_PREDICATE } from "./release-native-attestation.mjs";

export const nativeFixtureHex = (raw) => createHash("sha256").update(raw).digest("hex");
export function nativeGhFixture(binary = Buffer.from("synthetic native bytes, never executed")) {
  const certificate = {
    subjectAlternativeName: "https://github.com/tsukasa-u/FUSOU/.github/workflows/tlsn-native-build.yml@refs/heads/main",
    issuer: "https://token.actions.githubusercontent.com",
    buildSignerURI: "https://github.com/tsukasa-u/FUSOU/.github/workflows/tlsn-native-build.yml@refs/heads/main",
    buildSignerDigest: "b".repeat(40),
    buildConfigURI: "https://github.com/tsukasa-u/FUSOU/.github/workflows/tlsn-release-eligibility.yml@refs/heads/main",
    buildConfigDigest: "c".repeat(40), sourceRepositoryURI: "https://github.com/tsukasa-u/FUSOU",
    sourceRepositoryIdentifier: "7", sourceRepositoryOwnerURI: "https://github.com/tsukasa-u",
    sourceRepositoryOwnerIdentifier: "11", sourceRepositoryDigest: "a".repeat(40),
    sourceRepositoryRef: "refs/heads/main", runnerEnvironment: "github-hosted",
    runInvocationURI: "https://github.com/tsukasa-u/FUSOU/actions/runs/30/attempts/2",
  };
  const expected = { approval: "APPROVED", repository: "tsukasa-u/FUSOU",
    signer_workflow: "tsukasa-u/FUSOU/.github/workflows/tlsn-native-build.yml",
    predicate_type: NATIVE_SLSA_PREDICATE, certificate,
    timestamps: { authorities: [{ type: "tlog", uri: "https://rekor.sigstore.dev" }],
      not_before_ms: Date.parse("2026-10-28T10:00:00Z"), not_after_ms: Date.parse("2026-10-28T12:00:00Z") } };
  const entry = { attestation: { bundle: { synthetic: true } }, verificationResult: {
    mediaType: NATIVE_GH_MEDIA_TYPE, statement: { _type: "https://in-toto.io/Statement/v1",
      subject: [{ name: "synthetic.bin", digest: { sha256: nativeFixtureHex(binary) } }],
      predicateType: NATIVE_SLSA_PREDICATE, predicate: { synthetic: true, toolchain: "NOT_OBSERVED" } },
    signature: { certificate: { certificateIssuer: "synthetic X.509 issuer, not the OIDC issuer",
      ...structuredClone(certificate) } },
    verifiedTimestamps: [{ type: "tlog", uri: "https://rekor.sigstore.dev", timestamp: "2026-10-28T11:00:00Z" }] } };
  const executable = Buffer.from("synthetic gh executable bytes, never executed");
  const verifier = { path: "/mock/gh", sha256: nativeFixtureHex(executable) };
  const execution = { host: "github.com", config_root: "/mock/isolated", config_source: "EMPTY_ISOLATED",
    credential_source: "NONE" };
  // Test admission budgets, not approved limits for real release artifacts.
  const fileLimits = { verifier_executable: 4096, native_artifact: 4096, build_metadata: 16 * 1024 };
  const artifactPath = "/mock/native", files = new Map([[verifier.path, executable], [artifactPath, binary]]);
  const calls = [], encode = () => Buffer.from(JSON.stringify([entry], null, 2));
  const options = { mockReadFile: async (path) => {
    if (!files.has(path)) throw Object.assign(new Error("synthetic missing file"), { code: "ENOENT" });
    return Buffer.from(files.get(path));
  }, mockRunner: async (path, argv, settings) => {
    calls.push({ path, argv: [...argv], settings });
    return { code: 0, stdout: argv[0] === "--version" ? Buffer.from("gh version 2.102.0 (synthetic)\n") : encode(),
      stderr: Buffer.from("synthetic credential canary; never expose this text") };
  } };
  return { binary, expected, entry, verifier, execution, fileLimits, artifactPath, files, options, calls, encode };
}
