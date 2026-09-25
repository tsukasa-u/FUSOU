#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  FUSOU_TESTDATA_COMMIT_SHA,
  FUSOU_TESTDATA_REPOSITORY,
  FUSOU_TESTDATA_SOURCE_PATH,
  FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID,
  loadFusouTestdataSource,
} from "./canary-testdata-source.mjs";

const packageDirectory = resolve(new URL("..", import.meta.url).pathname);
const repositoryDirectory = resolve(packageDirectory, "../..");
const workflowPath = resolve(repositoryDirectory, ".github/workflows/tlsn-verification-worker-security.yml");

function installNetworkGuards() {
  const deny = (label) => {
    throw new Error(`[testdata-contract] forbidden ${label} call`);
  };
  globalThis.fetch = () => deny("fetch");
  const require = createRequire(import.meta.url);
  const http = require("node:http");
  const https = require("node:https");
  const net = require("node:net");
  const tls = require("node:tls");
  const dns = require("node:dns");
  for (const module of [http, https]) {
    module.request = () => deny(module === http ? "http.request" : "https.request");
    module.get = () => deny(module === http ? "http.get" : "https.get");
  }
  for (const name of ["connect", "createConnection"]) net[name] = () => deny(`net.${name}`);
  tls.connect = () => deny("tls.connect");
  for (const name of ["lookup", "resolve", "resolve4", "resolve6", "reverse"]) {
    dns[name] = () => deny(`dns.${name}`);
  }
}

function decodeBody(fixture) {
  const body = Buffer.from(fixture.input.body_base64url, "base64url");
  assert.equal(body.toString("base64url"), fixture.input.body_base64url);
  assert.equal(body.toString("utf8").startsWith("svdata="), true);
  const response = JSON.parse(body.subarray("svdata=".length).toString("utf8"));
  assert.equal(response.api_result, 1);
  assert.equal(response.api_data.api_basic.api_member_id, FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID);
  return body;
}

async function run() {
  installNetworkGuards();
  const workflow = await readFile(workflowPath, "utf8");
  assert.match(workflow, new RegExp(`FUSOU_TESTDATA_REPOSITORY:\\s*${FUSOU_TESTDATA_REPOSITORY.replace("/", "\\/")}`));
  assert.match(workflow, new RegExp(`FUSOU_TESTDATA_COMMIT_SHA:\\s*${FUSOU_TESTDATA_COMMIT_SHA}`));
  assert.match(workflow, /repository:\s*\$\{\{\s*env\.FUSOU_TESTDATA_REPOSITORY\s*\}\}/);
  assert.match(workflow, /ref:\s*\$\{\{\s*env\.FUSOU_TESTDATA_COMMIT_SHA\s*\}\}/);
  assert.doesNotMatch(workflow, /ref:\s*main/);
  assert.match(workflow, /path:\s*testdata\/FUSOU-TESTDATA/);

  const first = await loadFusouTestdataSource();
  const second = await loadFusouTestdataSource();
  assert.deepEqual(first, second, "FUSOU-TESTDATA fixture generation must be deterministic");

  assert.equal(first.artifact, "fusou-testdata-synthetic-require-info-input");
  assert.equal(first.synthetic_fixture, true);
  assert.equal(first.evidence_status, "NOT_REAL_EVIDENCE");
  assert.deepEqual(first.source, {
    repository: FUSOU_TESTDATA_REPOSITORY,
    commit_sha: FUSOU_TESTDATA_COMMIT_SHA,
    path: FUSOU_TESTDATA_SOURCE_PATH,
    semantics: "KCSAPI JSON body only; HTTP status, headers, TLS framing, and TLSNotary session are absent",
    source_body_sha256: first.source.source_body_sha256,
  });
  assert.equal(first.transform.operation, "canonical-json-with-fixed-synthetic-member-id");
  assert.equal(first.transform.masked_member_id_replaced, FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID);
  const body = decodeBody(first);
  assert.equal(first.input.body_bytes, body.length);
  assert.equal(first.input.member_id, FUSOU_TESTDATA_SYNTHETIC_MEMBER_ID);
  assert.match(first.input.body_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.network_access.source_control_fetch, "ALLOWED");
  for (const status of Object.values(first.network_access).slice(1)) assert.equal(status, "NOT_USED");
  assert.equal(Object.hasOwn(first, "trusted_by"), false);
  assert.equal(JSON.stringify(first).includes("REAL TLSN"), false);
  assert.equal(JSON.stringify(first).includes("live authenticated TLSNotary evidence"), false);

  const outputDirectory = await mkdtemp(joinTempPrefix());
  try {
    const outputPath = resolve(outputDirectory, "synthetic-fixture.json");
    await writeFile(outputPath, `${JSON.stringify(first, null, 2)}\n`);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), first);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    status: "PASS",
    source: first.source,
    synthetic_fixture: true,
    evidence_status: first.evidence_status,
    network_access: first.network_access,
    real_game_server: "NOT_RUN",
    real_notary_session: "NOT_RUN",
    real_tlsn_evidence: "NOT_GENERATED",
  }, null, 2));
}

function joinTempPrefix() {
  return `${tmpdir()}/tlsn-canary-testdata-contract-`;
}

await run();
