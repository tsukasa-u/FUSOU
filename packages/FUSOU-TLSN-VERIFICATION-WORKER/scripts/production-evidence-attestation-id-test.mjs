#!/usr/bin/env node

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertCanonicalTlsnAttestationId,
  assertTlsnAttestationIdBinding,
} from "./production-evidence-contract.mjs";
import {
  initSync,
  inspect_alpha15_presentation,
} from "../src/wasm/fusou_tlsn_verifier.js";

const vector = JSON.parse(readFileSync(
  new URL("../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-attestation-id-vector.json", import.meta.url),
  "utf8",
));
const presentation = readFileSync(fileURLToPath(new URL(
  "../../FUSOU-TLSN-VERIFIER/fixtures/tlsn-alpha15-upstream-presentation.bin",
  import.meta.url,
)));
const notaryKey = Buffer.from(
  vector.source.serialized_notary_verifying_key_base64url,
  "base64url",
);
initSync({
  module: readFileSync(new URL("../src/wasm/fusou_tlsn_verifier_bg.wasm", import.meta.url)),
});

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
}

test("shared alpha.15 vector identifies the exact upstream Presentation bytes", () => {
  assert.equal(presentation.length, vector.source.presentation_bytes);
  assert.equal(
    createHash("sha256").update(presentation).digest("hex"),
    vector.source.presentation_sha256_hex,
  );
  assert.equal(
    createHash("sha256").update(presentation).digest("base64url"),
    vector.source.presentation_sha256_base64url,
  );
  assert.equal(gitBlobSha1(presentation), vector.source.git_blob_sha1);
});

test("Node accepts the Rust-verified Attestation ID only in canonical 16-byte form", () => {
  const id = vector.expected.attestation_id_base64url;
  const bytes = assertCanonicalTlsnAttestationId(id);

  assert.equal(bytes.length, vector.contract.uid_bytes);
  assert.equal(bytes.toString("hex"), vector.expected.attestation_id_hex);
  assert.equal(
    vector.verification.upstream_observed_attestation_id_hex,
    vector.expected.attestation_id_hex,
  );
  assert.equal(assertTlsnAttestationIdBinding(id, id), id);
});

test("Node rejects malformed or mismatched Attestation IDs", () => {
  const id = vector.expected.attestation_id_base64url;
  const changedId = Buffer.from(assertCanonicalTlsnAttestationId(id));
  changedId[0] ^= 1;
  const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalCharacterIndex = base64urlAlphabet.indexOf(id.at(-1));
  const nonCanonicalId = `${id.slice(0, -1)}${base64urlAlphabet[finalCharacterIndex + 1]}`;

  for (const malformed of [
    `${id}=`,
    id.slice(0, -1),
    `${id.slice(0, -1)}*`,
    nonCanonicalId,
  ]) {
    assert.throws(() => assertCanonicalTlsnAttestationId(malformed));
    assert.throws(() => assertTlsnAttestationIdBinding(malformed, id));
  }
  assert.throws(() => assertTlsnAttestationIdBinding(id, changedId.toString("base64url")));
});

test("Node consumes the verified Attestation ID from the packaged Rust/WASM verifier", () => {
  const serializedKey = vector.source.serialized_notary_verifying_key_base64url;
  assert.equal(notaryKey.toString("base64url"), serializedKey);
  const verified = JSON.parse(
    inspect_alpha15_presentation(new Uint8Array(presentation), notaryKey),
  );

  assert.equal(verified.server_identity, vector.expected.server_identity);
  assert.equal(verified.tlsn_attestation_id, vector.expected.attestation_id_base64url);
  assert.equal(
    assertTlsnAttestationIdBinding(
      verified.tlsn_attestation_id,
      vector.expected.attestation_id_base64url,
    ),
    vector.expected.attestation_id_base64url,
  );
});

test("Rust/WASM rejects Presentation-byte and trusted-Notary-key mutation", () => {
  const changedPresentation = Buffer.from(presentation);
  changedPresentation[0] ^= 1;
  assert.throws(() => inspect_alpha15_presentation(changedPresentation, notaryKey));

  const changedNotaryKey = Buffer.from(notaryKey);
  changedNotaryKey[0] ^= 1;
  assert.throws(() => inspect_alpha15_presentation(presentation, changedNotaryKey));
});
