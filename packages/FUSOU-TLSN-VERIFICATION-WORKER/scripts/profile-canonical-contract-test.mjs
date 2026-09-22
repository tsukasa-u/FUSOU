#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  COMPLETE_PROFILE_ID,
  FIXTURE_SERVER_IDENTITY,
  PROFILE_CONTRACT_INPUT_MANIFEST,
  PROFILE_CONTRACT_SPEC,
  REQUIRE_INFO_TARGET,
  SPARSE_PROFILE_ID,
  assertCanonicalProfile,
  assertProfileContractInputs,
  assertSelectedProfile,
  canonicalProfileHash,
  profileContractArtifact,
  profileContractFailureArtifact,
  profilesForServerIdentity,
} from "./profile-canonical-contract.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const artifactDirectory = resolve(process.env.TLSN_PROFILE_CONTRACT_ARTIFACT_DIR ?? resolve(packageDirectory, "artifacts"));
const canonicalArtifactPath = resolve(process.env.TLSN_PROFILE_CONTRACT_ARTIFACT_PATH ?? resolve(artifactDirectory, "tlsn-profile-canonical-contract.json"));
const failuresArtifactPath = resolve(process.env.TLSN_PROFILE_CONTRACT_FAILURES_ARTIFACT_PATH ?? resolve(artifactDirectory, "tlsn-profile-canonical-contract-failures.json"));

const profiles = profilesForServerIdentity(FIXTURE_SERVER_IDENTITY);
const failureCases = [];

function expectReject(label, callback) {
  try {
    callback();
    failureCases.push({ case: label, reason: "mutation was accepted" });
  } catch {
    return;
  }
}

function mutate(profile, changes) {
  return { ...profile, ...changes };
}

assert.deepEqual(profiles.complete.profile, {
  id: COMPLETE_PROFILE_ID,
  server_identity: FIXTURE_SERVER_IDENTITY,
  target: REQUIRE_INFO_TARGET,
});
assert.deepEqual(profiles.sparse.profile, {
  disclosure_mode: "sparse",
  id: SPARSE_PROFILE_ID,
  server_identity: FIXTURE_SERVER_IDENTITY,
  target: REQUIRE_INFO_TARGET,
  version: 2,
});
assert.equal(profiles.complete.canonical, '{"id":"fusou-require-info-v1","server_identity":"game.example.test","target":"/kcsapi/api_get_member/require_info"}');
assert.equal(profiles.sparse.canonical, '{"disclosure_mode":"sparse","id":"fusou-require-info-v2-sparse","server_identity":"game.example.test","target":"/kcsapi/api_get_member/require_info","version":2}');
assert.equal(profiles.complete.sha256, "J-wctsF_XXLyRZ-2Ap1VTeHdsXluWXWEY6pJ2lohCJk");
assert.equal(profiles.sparse.sha256, "6wu8nk0fn6OCQp7Rbpk3yJ0-dyPXAy2uO8aU1vvvcBA");
const reorderedComplete = canonicalProfileHash({
  target: REQUIRE_INFO_TARGET,
  server_identity: FIXTURE_SERVER_IDENTITY,
  id: COMPLETE_PROFILE_ID,
}, "complete");
assert.equal(reorderedComplete.canonical, profiles.complete.canonical);
assert.equal(reorderedComplete.sha256, profiles.complete.sha256);
assert.equal(Buffer.from(profiles.complete.canonical, "utf8").toString("utf8"), profiles.complete.canonical);
assert.notEqual(profiles.complete.sha256, profiles.sparse.sha256);
assert.equal(PROFILE_CONTRACT_SPEC.canonicalization, "canonicalJson");
assert.equal(PROFILE_CONTRACT_SPEC.encoding, "UTF-8");
assert.equal(PROFILE_CONTRACT_SPEC.hash_algorithm, "SHA-256");
assert.equal(PROFILE_CONTRACT_SPEC.response_mode_semantics.hash_inclusion, false);
assert.deepEqual(PROFILE_CONTRACT_INPUT_MANIFEST.production_inputs, {
  server_identity: "TLSN_CANDIDATE_SERVER_IDENTITY",
  complete_profile_hash: "TLSN_CANDIDATE_PROFILE_SHA256",
  sparse_profile_hash: "TLSN_CANDIDATE_SPARSE_PROFILE_SHA256",
  disclosure_mode: "request-time profile selection: full or sparse",
  response_mode: "request-time delivery selection: async or sync",
});

for (const [label, changes] of [
  ["complete unknown field", { unexpected: true }],
  ["complete missing field", { target: undefined }],
  ["complete changed target", { target: "/kcsapi/api_get_member/require_member" }],
  ["complete changed server_identity", { server_identity: "other.example.test" }],
  ["complete changed id", { id: "other-profile" }],
]) {
  const mutated = mutate(profiles.complete.profile, changes);
  if (changes.target === undefined) delete mutated.target;
  expectReject(label, () => assertCanonicalProfile(mutated, "complete"));
}

for (const [label, changes] of [
  ["sparse missing disclosure_mode", { disclosure_mode: undefined }],
  ["sparse wrong version", { version: 3 }],
  ["sparse changed target", { target: "/kcsapi/api_get_member/require_member" }],
  ["sparse changed server_identity", { server_identity: "other.example.test" }],
  ["sparse changed id", { id: "other-sparse-profile" }],
]) {
  const mutated = mutate(profiles.sparse.profile, changes);
  if (changes.disclosure_mode === undefined) delete mutated.disclosure_mode;
  expectReject(label, () => assertCanonicalProfile(mutated, "sparse"));
}

expectReject("complete hash mismatch", () => assertProfileContractInputs({
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: profiles.sparse.sha256,
  sparseProfileSha256: profiles.sparse.sha256,
}));
expectReject("sparse hash mismatch", () => assertProfileContractInputs({
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: profiles.complete.sha256,
  sparseProfileSha256: profiles.complete.sha256,
}));
expectReject("cross-profile complete hash in sparse field", () => assertProfileContractInputs({
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: profiles.complete.sha256,
  sparseProfileSha256: profiles.complete.sha256,
}));
expectReject("cross-profile sparse hash in complete field", () => assertProfileContractInputs({
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: profiles.sparse.sha256,
  sparseProfileSha256: profiles.sparse.sha256,
}));
expectReject("complete hash with base64 padding", () => assertProfileContractInputs({
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: `${profiles.complete.sha256}=`,
  sparseProfileSha256: profiles.sparse.sha256,
}));
const changedIdentityProfiles = profilesForServerIdentity("other.example.test");
assert.notEqual(changedIdentityProfiles.complete.sha256, profiles.complete.sha256);
assert.notEqual(changedIdentityProfiles.sparse.sha256, profiles.sparse.sha256);
expectReject("selected profile wrong identity", () => assertSelectedProfile({
  serverIdentity: "other.example.test",
  profileSha256: profiles.complete.sha256,
  sparseProfileSha256: profiles.sparse.sha256,
  disclosureMode: "sparse",
}));

const validInputs = {
  serverIdentity: FIXTURE_SERVER_IDENTITY,
  profileSha256: profiles.complete.sha256,
  sparseProfileSha256: profiles.sparse.sha256,
};
const asyncArtifact = profileContractArtifact({ ...validInputs, responseModeCapabilities: ["async"] });
const syncArtifact = profileContractArtifact({ ...validInputs, responseModeCapabilities: ["sync"] });
assert.equal(asyncArtifact.complete.canonical_json_sha256, syncArtifact.complete.canonical_json_sha256);
assert.equal(asyncArtifact.sparse.canonical_json_sha256, syncArtifact.sparse.canonical_json_sha256);
assert.equal(asyncArtifact.response_mode.hash_inclusion, false);
assert.deepEqual(assertSelectedProfile({ ...validInputs, disclosureMode: "full" }).profile, profiles.complete.profile);
assert.deepEqual(assertSelectedProfile({ ...validInputs, disclosureMode: "sparse" }).profile, profiles.sparse.profile);

await mkdir(artifactDirectory, { recursive: true });
await writeFile(canonicalArtifactPath, `${JSON.stringify(profileContractArtifact({
  ...validInputs,
  disclosureMode: "full|sparse",
  responseModeCapabilities: ["async", "sync"],
}), null, 2)}\n`, "utf8");
await writeFile(failuresArtifactPath, `${JSON.stringify(profileContractFailureArtifact(failureCases), null, 2)}\n`, "utf8");

assert.equal(failureCases.length, 0, JSON.stringify(failureCases));
console.log(`[tlsn-profile-contract] canonical source, hashes, mutations, provenance inputs, and response-mode independence PASS; artifacts: ${canonicalArtifactPath}, ${failuresArtifactPath}`);
