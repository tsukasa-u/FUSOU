// Structural data and mock capture only; not valid signed evidence or a native provider.
import { sha256 } from "./release-bytes.mjs";
import { jsonBytes } from "./release-checks.mjs";
import { OFFLINE_BUNDLE_ARTIFACTS, OFFLINE_FILE_FLAGS, OFFLINE_SCALAR_FLAGS, inspectOfflineFdFrame } from "./release-offline-fd.mjs";
import { nativeResourceFixtureBudget } from "./release-native-attestation-fixture.mjs";

export const fdResourceFixtureBudget = (changes = {}) =>
  nativeResourceFixtureBudget({ max_reads: 512, timeout_ms: 5000, ...changes });
export const fdFixtureLimits = Object.freeze({ max_frame_bytes: 131072, max_entries: 64, max_entry_bytes: 65536,
  max_json_bytes: 65536, max_json_nodes: 2048, max_json_depth: 16, max_string_bytes: 4096, max_read_calls: 64 });
export function offlineFdFixture() {
  const context = { repository: "tsukasa-u/FUSOU", source_sha: "a".repeat(40),
    workflow_sha: "b".repeat(40), run_id: 101, run_attempt: 1 };
  const inputs = new Map(), artifacts = {};
  for (const role of OFFLINE_BUNDLE_ARTIFACTS) {
    const raw = role === "presentation" ? Buffer.from("synthetic Presentation; never cryptographically verified") :
      role === "trust_root" ? Buffer.from([0x30, 0x01, 0]) :
      role === "session" ? jsonBytes({ session_id: "fd-session", binding: "synthetic binding" }) :
      jsonBytes({ fixture_role: role });
    inputs.set(`bundle_artifact_${role}`, raw);
    artifacts[role] = { path: `artifacts/${role}.bin`, artifact_sha256: sha256(raw), byte_length: raw.length };
  }
  inputs.set("bundle", jsonBytes({ artifacts, capture_id: "fd-capture",
    security_identity: { git_commit_sha: context.source_sha } }));
  for (const role of Object.keys(OFFLINE_FILE_FLAGS).filter((name) => name !== "bundle")) inputs.set(role, jsonBytes({}));
  for (const [external, artifact] of [["trusted_notary_registry", "notary_registry"],
    ["session_authority_registry", "session_authority_registry"], ["binding_authority_registry", "binding_authority_registry"],
    ["trust_anchor_der", "trust_root"]]) inputs.set(external, Buffer.from(inputs.get(`bundle_artifact_${artifact}`)));
  inputs.set("verifier_executable", Buffer.from("synthetic verifier; never executed"));
  const policy = { executable_sha256: sha256(inputs.get("verifier_executable")), executable_version: "synthetic-fd-v1",
    input_sha256: Object.fromEntries([...inputs].map(([name, raw]) => [name, sha256(raw)])),
    options: Object.fromEntries(OFFLINE_SCALAR_FLAGS.map((name) => [name, `fixture-${name}`])),
    expected_derived: { server_identity: "game.example.test" },
    fd_abi: { schema_version: 1, limits: { ...fdFixtureLimits },
      verifier_build_sha256: sha256(Buffer.from("synthetic build metadata")),
      runtime_profile_sha256: sha256(Buffer.from("synthetic runtime profile; not approved")) } };
  policy.options["server-identity"] = "game.example.test";
  const report = { status: "VERIFIED", verification: "FUSOU_TLSN_EVIDENCE_BUNDLE",
    trust: Object.fromEntries(["evidence_root", "result_registry", "result_signature", "result_evidence_binding",
      "tlsn_presentation", "notary", "artifact_manifest"].map((name) => [name, "VERIFIED"])), derived: policy.expected_derived };
  const executor = async (request) => {
    const parsed = inspectOfflineFdFrame(request.frame, { limits: policy.fd_abi.limits, resourceBudget: fdResourceFixtureBudget() });
    return { argv: request.argv, stdout: jsonBytes({ ...report, input_binding: parsed.binding }), stderr: Buffer.alloc(0),
      exit_code: 0, executable_sha256: policy.executable_sha256, executable_version: policy.executable_version,
      executable_before: inputs.get("verifier_executable"), executable_after: inputs.get("verifier_executable") };
  };
  return { context, inputs, policy, report, executor,
    archiveInputs: new Map(["presentation", "result"].map((role) => [`readback_${role}`, Buffer.from(inputs.get(`bundle_artifact_${role}`))])),
    archivePolicy: { capture_id: "fd-capture", session_id: "fd-session", objects: {
      result: { binding_id: sha256(Buffer.from("synthetic binding")) } } } };
}
export function refreshFdFixture(fixture) {
  const manifest = JSON.parse(fixture.inputs.get("bundle"));
  for (const [role, descriptor] of Object.entries(manifest.artifacts)) {
    const raw = fixture.inputs.get(`bundle_artifact_${role}`);
    descriptor.artifact_sha256 = sha256(raw); descriptor.byte_length = raw.length;
  }
  fixture.inputs.set("bundle", jsonBytes(manifest));
  fixture.policy.input_sha256 = Object.fromEntries([...fixture.inputs].map(([name, raw]) => [name, sha256(raw)]));
}
