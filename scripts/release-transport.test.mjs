import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { consumerFixture, recordBytes } from "./release-consumer-fixture.mjs";
import { acquireReleaseTransport, encodeReleaseTransport, decodeReleaseTransport, readTransportZip,
  downloadGithubArtifact, packProducerTransport } from "./release-transport.mjs";

test("real ZIP is read to stdout only; extra/corrupt entries reject and symlink targets are never followed", async () => {
  const root = await mkdtemp(join(tmpdir(), "fusou-release-zip-test-"));
  try {
    const raw = encodeReleaseTransport(new Map([["release-report.json", recordBytes({ status: "synthetic" })]]));
    await writeFile(join(root, "release-transport.json"), raw);
    execFileSync("zip", ["-q", "one.zip", "release-transport.json"], { cwd: root });
    const zip = await readFile(join(root, "one.zip"));
    assert.deepEqual(await readTransportZip(zip), decodeReleaseTransport(raw));
    await writeFile(join(root, "unexpected.bin"), "not executable");
    execFileSync("zip", ["-q", "extra.zip", "release-transport.json", "unexpected.bin"], { cwd: root });
    await assert.rejects(readTransportZip(await readFile(join(root, "extra.zip"))), /exactly one/);
    await rm(join(root, "release-transport.json"));
    await symlink("unexpected.bin", join(root, "release-transport.json"));
    execFileSync("zip", ["-qy", "link.zip", "release-transport.json"], { cwd: root });
    await assert.rejects(readTransportZip(await readFile(join(root, "link.zip"))));
    await assert.rejects(readTransportZip(zip.subarray(0, zip.length - 22)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("transport rejects paths, noncanonical base64/JSON, duplicate keys and missing report", () => {
  for (const name of ["../escape", "/absolute", "dir/file", "__proto__"]) {
    assert.throws(() => encodeReleaseTransport(new Map([[name, Buffer.from("x")]])));
  }
  const raw = encodeReleaseTransport(new Map([["release-report.json", Buffer.from("{}")]]));
  for (const value of [Buffer.from(`${raw}\n`), Buffer.from(raw.toString().replace('"schema_version":1', '"schema_version":0,"schema_version":1')),
    Buffer.from(raw.toString().replace("e30", "e30=")),
    encodeReleaseTransport(new Map([["other.bin", Buffer.from("x")]]))]) {
    assert.throws(() => decodeReleaseTransport(value));
  }
});
test("API identity binds identical bytes to their actual run, not to a manifest assertion", async () => {
  for (const mutate of [
    (f) => { f.metadata().workflow_run.id = 31; },
    (f) => { f.metadata().name = "fusou-release-30-2"; },
    (f) => { f.metadata().workflow_run.head_sha = "c".repeat(40); },
    (f) => { f.metadata().workflow_run.repository_id = 8; },
    (f) => { f.metadata().expired = true; },
    (f) => { f.metadata().digest = `sha256:${"0".repeat(64)}`; },
    (f) => { f.github.rest.actions.listWorkflowRunArtifacts = async () => ({ data: { total_count: 0, artifacts: [] } }); },
    (f) => { f.github.rest.actions.listWorkflowRunArtifacts = async () => ({ data: { total_count: 2, artifacts: [f.metadata(), f.metadata()] } }); },
    (f) => { f.github.rest.actions.getArtifact = async () => ({ data: { ...f.metadata(), id: 51 } }); },
  ]) {
    const f = consumerFixture(); mutate(f);
    await assert.rejects(acquireReleaseTransport({ github: f.github, run: f.run,
      downloadArchive: f.options.downloadArchive, ...f.dependencies.transport }));
  }
});
test("nullable API digest explicitly blocks rather than guessing; acquired data is checked again", async () => {
  const f = consumerFixture(); f.metadata().digest = null;
  await assert.rejects(acquireReleaseTransport({ github: f.github, run: f.run,
    downloadArchive: f.options.downloadArchive, ...f.dependencies.transport }), /ARTIFACT_API_DIGEST_UNAVAILABLE/);
  const g = consumerFixture();
  await assert.rejects(acquireReleaseTransport({ github: g.github, run: g.run,
    downloadArchive: g.options.downloadArchive, readArchive: async (archive) => {
      const files = decodeReleaseTransport(archive); archive[0] ^= 1; return files;
    } }), /changed during readback/);
});
test("changed bytes after artifact selection cannot reuse the API archive digest", async () => {
  const f = consumerFixture();
  await assert.rejects(acquireReleaseTransport({ github: f.github, run: f.run,
    downloadArchive: async () => {
      const raw = Buffer.from(await f.options.downloadArchive()); raw[raw.length - 1] ^= 1; return raw;
    }, ...f.dependencies.transport }), /archive digest mismatch/);
});
test("GitHub token is sent only to the API; storage redirects, HTTP and failed responses reject", async () => {
  const calls = [];
  const raw = await downloadGithubArtifact({ artifactId: 50, token: "synthetic-read-token", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://storage.example/file" } }) :
      new Response("synthetic zip bytes");
  } });
  assert.equal(raw.toString(), "synthetic zip bytes");
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-read-token");
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, "error");
  for (const response of [new Response(null, { status: 410 }),
    new Response(null, { status: 302, headers: { location: "http://storage.example/file" } }),
    new Response(null, { status: 302, headers: { location: "https://user:pass@storage.example/file" } })]) {
    await assert.rejects(downloadGithubArtifact({ artifactId: 50, token: "synthetic", fetchImpl: async () => response }));
  }
});
test("producer packages only explicit filenames and preserves blocked reports without invoking output readers", async () => {
  let reads = 0;
  const raw = await packProducerTransport({ build: { status: "BLOCKED_EXTERNAL_INPUTS" } }, async () => { reads++; });
  assert.equal(decodeReleaseTransport(raw).size, 1); assert.equal(reads, 0);
  const f = consumerFixture();
  const actual = await packProducerTransport(f.report, async (name) => f.files.get(name));
  assert.equal(decodeReleaseTransport(actual).size, 7);
  f.report.build.artifacts[0].file = "../protected";
  await assert.rejects(packProducerTransport(f.report, async () => { throw new Error("must not read"); }), /filename/);
});
