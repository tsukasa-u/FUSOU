import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  assertTrustGraph,
  assertTrustGraphNodeIdentities,
  deriveProductionTrustGraph,
} from "./production-evidence-contract.mjs";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

// Structural fixtures only: no real Presentation, signed Result, or service evidence.
function inputsFor(disclosureMode) {
  const presentationBytes = Buffer.from("synthetic trust graph Presentation");
  const presentationSha256 = digest(presentationBytes);
  const attestationId = Buffer.alloc(16, 1).toString("base64url");
  const result = {
    tlsn_attestation_id: attestationId,
    presentation_sha256: presentationSha256,
    disclosure_mode: disclosureMode,
    binding_value: "synthetic binding",
    verified_member_id: "123",
    notary_key_id: "synthetic-notary",
    response_transcript_sha256: digest("synthetic response"),
    revealed_request_ranges: [],
    revealed_response_ranges: disclosureMode === "sparse"
      ? [
        { start: "0", length: "4", bytes: Buffer.from("test").toString("base64url") },
        { start: "8", length: "4", bytes: Buffer.from("more").toString("base64url") },
      ]
      : [],
  };
  return {
    captureId: "synthetic-capture",
    authenticatedUserId: "synthetic-user",
    deviceId: "synthetic-device",
    devicePublicKeySha256: digest("synthetic device key"),
    deviceAuthentication: {
      request: { device_id: "synthetic-device", nonce: "synthetic nonce" },
    },
    session: {
      session_id: "synthetic-session",
      session_receipt: { signer_key_id: "synthetic-authority" },
      binding: result.binding_value,
      challenge: "synthetic challenge",
    },
    presentationBytes,
    semanticVerification: {
      verified_presentation: { tlsn_attestation_id: attestationId },
      result,
    },
    result,
    resultBytes: Buffer.from(JSON.stringify(result)),
    resultSignerKeyId: "synthetic-result-signer",
    resultRegistrySha256: digest("synthetic registry"),
    resultRegistryEnvelopeSha256: digest("synthetic envelope"),
    resultRegistryRootKeyId: "synthetic-root",
    resultRegistryRootPublicKeySpki: "synthetic public key",
    proxyProvenance: {
      declared: "production",
      cryptographic_status: "UNVERIFIED",
      authority: {
        type: "externally-pinned-production-proxy-key",
        status: "UNVERIFIED",
      },
      proxy_identity: null,
      proxy_deployment_id: null,
      proxy_binary_identity: null,
      presentation_sha256: presentationSha256,
      created_at: "2026-10-24T00:00:00.000Z",
      signer_key_id: null,
      signature: null,
      capture_context: {},
    },
  };
}

for (const mode of ["complete", "sparse"]) {
  test(`${mode}: matching Presentation bindings preserve graph identities and topology`, () => {
    const inputs = inputsFor(mode);
    const graph = deriveProductionTrustGraph(inputs);
    assert.equal(assertTrustGraph(graph), graph);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    assert.equal(nodes.get("presentation").identity.presentation_sha256, digest(inputs.presentationBytes));
    assert.equal(nodes.get("result").identity.result_sha256, digest(inputs.resultBytes));
    assert.equal(nodes.get("session").identity.binding_sha256, nodes.get("presentation").identity.binding_sha256);
    assert.equal(nodes.get("binding").identity.binding_sha256, nodes.get("presentation").identity.binding_sha256);
    assert.equal(nodes.get("production-proxy").identity.cryptographic_status, "UNVERIFIED");
    assert.equal(nodes.get("remote-attestation").identity.status, "UNVERIFIED");
    const edge = graph.edges.find(({ id }) => id === "session-binding-authenticates-presentation");
    assert.equal(edge.binding_fields.includes("revealed_request_ranges"), mode === "sparse");
  });

  test(`${mode}: graph rejects a Session and Result with different bindings`, () => {
    const changedSession = inputsFor(mode);
    changedSession.session.binding = "another session binding";
    assert.throws(() => deriveProductionTrustGraph(changedSession), /Session and Result bindings/);

    const changedResult = inputsFor(mode);
    changedResult.result.binding_value = "another Result binding";
    changedResult.resultBytes = Buffer.from(JSON.stringify(changedResult.result));
    assert.throws(() => deriveProductionTrustGraph(changedResult), /Session and Result bindings/);

    for (const binding of [null, "", 1, []]) {
      const malformed = inputsFor(mode);
      malformed.session.binding = binding;
      malformed.result.binding_value = binding;
      malformed.resultBytes = Buffer.from(JSON.stringify(malformed.result));
      assert.throws(() => deriveProductionTrustGraph(malformed), /Session and Result bindings/);
    }
  });

  test(`${mode}: graph rejects authentication for a different device`, () => {
    const inputs = inputsFor(mode);
    inputs.deviceAuthentication.request.device_id = "another-device";
    assert.throws(() => deriveProductionTrustGraph(inputs), /device authentication.*device identity/);
    delete inputs.deviceAuthentication.request;
    assert.throws(() => deriveProductionTrustGraph(inputs), /device authentication.*device identity/);
    inputs.deviceId = 1;
    inputs.deviceAuthentication.request = { device_id: 1 };
    assert.throws(() => deriveProductionTrustGraph(inputs), /device authentication.*device identity/);
  });

  test(`${mode}: Uint8Array and byte-offset views preserve the Buffer graph`, () => {
    const inputs = inputsFor(mode);
    const expected = deriveProductionTrustGraph(inputs);
    const bytes = new Uint8Array(inputs.presentationBytes);
    assert.deepEqual(deriveProductionTrustGraph({ ...inputs, presentationBytes: bytes }), expected);
    const storage = new Uint8Array(bytes.length + 8).fill(255);
    storage.set(bytes, 4);
    assert.deepEqual(
      deriveProductionTrustGraph({ ...inputs, presentationBytes: storage.subarray(4, 4 + bytes.length) }),
      expected,
    );
  });

  for (const encoding of ["utf8", "base64url"]) {
    test(`${mode}: ${encoding} string is rejected even with matching declared hashes`, () => {
      const inputs = inputsFor(mode);
      inputs.presentationBytes = inputs.presentationBytes.toString(encoding);
      const hash = digest(inputs.presentationBytes);
      inputs.semanticVerification.result.presentation_sha256 = hash;
      inputs.proxyProvenance.presentation_sha256 = hash;
      assert.throws(() => deriveProductionTrustGraph(inputs), {
        name: "TypeError",
        message: /Presentation bytes must be a Buffer or Uint8Array/,
      });
    });
  }

  test(`${mode}: other Presentation input types are rejected at the byte boundary`, () => {
    for (const value of [
      null,
      undefined,
      [],
      { 0: 1, length: 1 },
      new String("synthetic Presentation"),
      new ArrayBuffer(4),
      new DataView(new ArrayBuffer(4)),
      new Uint16Array([1, 2]),
      Object.create(Uint8Array.prototype),
      42,
    ]) {
      const inputs = inputsFor(mode);
      inputs.presentationBytes = value;
      assert.throws(() => deriveProductionTrustGraph(inputs), {
        name: "TypeError",
        message: /Presentation bytes must be a Buffer or Uint8Array/,
      });
    }
  });

  test(`${mode}: changed raw Presentation bytes are rejected`, () => {
    const inputs = inputsFor(mode);
    inputs.presentationBytes[0] ^= 1;
    assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
  });

  test(`${mode}: Result Presentation hash must match the exact raw bytes`, () => {
    for (const value of [
      undefined,
      null,
      "",
      digest("wrong Presentation"),
      `${digest("synthetic trust graph Presentation")}=`,
      42,
    ]) {
      const inputs = inputsFor(mode);
      inputs.semanticVerification.result.presentation_sha256 = value;
      assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
    }
  });

  test(`${mode}: proxy provenance cannot refer to another Presentation`, () => {
    const inputs = inputsFor(mode);
    inputs.proxyProvenance.presentation_sha256 = digest("another Presentation");
    assert.throws(() => deriveProductionTrustGraph(inputs), /proxy provenance Presentation hash/);
  });

  test(`${mode}: matching declarations cannot replace the raw Presentation binding`, () => {
    const inputs = inputsFor(mode);
    const wrongDigest = digest("another Presentation");
    inputs.semanticVerification.result.presentation_sha256 = wrongDigest;
    inputs.proxyProvenance.presentation_sha256 = wrongDigest;
    assert.throws(() => deriveProductionTrustGraph(inputs), /Result Presentation hash/);
  });

  test(`${mode}: existing Attestation ID binding still rejects a different ID`, () => {
    const inputs = inputsFor(mode);
    inputs.semanticVerification.result.tlsn_attestation_id = Buffer.alloc(16, 2).toString("base64url");
    assert.throws(() => deriveProductionTrustGraph(inputs), /Attestation IDs do not match/);
  });

  test(`${mode}: raw Result, parsed Result, and semantic Result cannot be mixed`, () => {
    for (const mutate of [
      (inputs) => { inputs.result = { ...inputs.result, verified_member_id: "456" }; },
      (inputs) => {
        inputs.semanticVerification.result = { ...inputs.result, notary_key_id: "another-notary" };
      },
      (inputs) => {
        inputs.resultBytes = Buffer.from(JSON.stringify({ ...inputs.result, verified_member_id: "456" }));
      },
      (inputs) => {
        inputs.result = { ...inputs.result, signature: "synthetic changed signature" };
        inputs.resultBytes = Buffer.from(JSON.stringify(inputs.result));
      },
    ]) {
      const inputs = inputsFor(mode);
      mutate(inputs);
      assert.throws(() => deriveProductionTrustGraph(inputs), /Result bytes.*parsed and semantic Result/);
    }
  });

  test(`${mode}: Result bytes must be binary UTF-8 JSON containing a Result object`, () => {
    for (const bytes of [
      "not binary",
      new DataView(new ArrayBuffer(4)),
      Buffer.from("not JSON"),
      Buffer.from("{} trailing bytes"),
      Buffer.from("null"),
      Buffer.from("[]"),
      Buffer.from([0xff]),
    ]) {
      const inputs = inputsFor(mode);
      inputs.resultBytes = bytes;
      assert.throws(() => deriveProductionTrustGraph(inputs), /Result bytes/);
    }
  });

  test(`${mode}: Result byte binding preserves whitespace, key order, and byte views`, () => {
    const inputs = inputsFor(mode);
    const reordered = Object.fromEntries(Object.entries(inputs.result).reverse());
    const bytes = Buffer.from(`\n ${JSON.stringify(reordered, null, 2)} \n`);
    const storage = new Uint8Array(bytes.length + 8).fill(255);
    storage.set(bytes, 4);
    inputs.resultBytes = storage.subarray(4, 4 + bytes.length);
    inputs.result = JSON.parse(bytes.toString());
    const graph = deriveProductionTrustGraph(inputs);
    assert.equal(
      graph.nodes.find(({ id }) => id === "result").identity.result_sha256,
      digest(bytes),
    );
    assert.deepEqual(Array.from(inputs.resultBytes), Array.from(bytes));
  });

  test(`${mode}: Result bytes reject duplicate fields even when JSON.parse selects the expected value`, () => {
    for (const field of ["binding_value", "presentation_sha256", "tlsn_attestation_id", "signature"]) {
      for (const sameValue of [false, true]) {
        for (const escapedKey of [false, true]) {
          const inputs = inputsFor(mode);
          inputs.result.signature = "synthetic signature";
          const value = JSON.stringify(inputs.result[field]);
          const key = JSON.stringify(field);
          const alias = escapedKey ? `"\\u${field.charCodeAt(0).toString(16).padStart(4, "0")}${field.slice(1)}"` : key;
          const raw = JSON.stringify(inputs.result).replace(
            `${key}:${value}`,
            `${alias}:${sameValue ? value : '"unexpected"'},${key}:${value}`,
          );
          assert.deepEqual(JSON.parse(raw), inputs.result);
          inputs.resultBytes = Buffer.from(raw);
          assert.throws(() => deriveProductionTrustGraph(inputs), /Result bytes.*duplicate JSON object key/);
        }
      }
    }
  });

  test(`${mode}: Result bytes reject duplicate nested range fields`, () => {
    for (const field of ["start", "length", "bytes"]) {
      for (const sameValue of [false, true]) {
        const inputs = inputsFor(mode);
        const range = { start: "0", length: "4", bytes: Buffer.from("test").toString("base64url") };
        inputs.result.revealed_response_ranges = [range];
        const key = JSON.stringify(field);
        const alias = `"\\u${field.charCodeAt(0).toString(16).padStart(4, "0")}${field.slice(1)}"`;
        const value = JSON.stringify(range[field]);
        const raw = JSON.stringify(inputs.result).replace(
          `${key}:${value}`, `${alias}:${sameValue ? value : '"unexpected"'},${key}:${value}`,
        );
        assert.deepEqual(JSON.parse(raw), inputs.result);
        inputs.resultBytes = Buffer.from(raw);
        assert.throws(() => deriveProductionTrustGraph(inputs), /Result bytes.*duplicate JSON object key/);
      }
    }
  });

  test(`${mode}: duplicate detection preserves escaped strings and independent object key scopes`, () => {
    const inputs = inputsFor(mode);
    inputs.result.revealed_response_ranges = [
      { start: "0", length: "4", bytes: 'text: "{[\\",\\"start\\":0' },
      { bytes: "second", length: "4", start: "8" },
    ];
    const raw = JSON.stringify(inputs.result, null, 2).replace(
      '"binding_value"', '"\\u0062inding_value"',
    );
    inputs.resultBytes = Buffer.from(raw);
    const graph = deriveProductionTrustGraph(inputs);
    assert.equal(graph.nodes.find(({ id }) => id === "result").identity.result_sha256, digest(inputs.resultBytes));
    assert.equal(graph.nodes.find(({ id }) => id === "production-proxy").identity.cryptographic_status, "UNVERIFIED");
  });

  test(`${mode}: separately parsed graph identities match by value`, () => {
    const graph = deriveProductionTrustGraph(inputsFor(mode));
    const expected = JSON.parse(JSON.stringify(
      Object.fromEntries(graph.nodes.map(({ id, identity }) => [id, identity])),
    ));
    const reloaded = JSON.parse(JSON.stringify(graph));
    assert.equal(assertTrustGraphNodeIdentities(reloaded, expected), reloaded);
  });

  test(`${mode}: graph identity checking still rejects scalar mismatches`, () => {
    const graph = deriveProductionTrustGraph(inputsFor(mode));
    for (const [nodeId, field, value] of [
      ["authenticated-user", "user_id", "another-user"],
      ["result", "result_sha256", digest("another Result")],
      ["member-id", "verified_member_id", "456"],
      ["device", "device_id", 42],
    ]) {
      assert.throws(
        () => assertTrustGraphNodeIdentities(graph, { [nodeId]: { [field]: value } }),
        new RegExp(`trust graph ${nodeId} identity mismatch: ${field}`),
      );
    }
    assert.throws(
      () => assertTrustGraphNodeIdentities(graph, { "missing-node": { id: "missing" } }),
      /identity node is missing/,
    );
  });

  test(`${mode}: graph identity checking still validates topology first`, () => {
    const graph = deriveProductionTrustGraph(inputsFor(mode));
    graph.edges[0].source = "result";
    assert.throws(
      () => assertTrustGraphNodeIdentities(graph, {}),
      /trust graph edge protocol mismatch/,
    );
  });
}

test("sparse: range object key order does not change identity values", () => {
  const inputs = inputsFor("sparse");
  const graph = deriveProductionTrustGraph(inputs);
  const expectedRanges = inputs.semanticVerification.result.revealed_response_ranges.map(
    ({ start, length, bytes }) => ({ bytes, length, start }),
  );
  assert.equal(assertTrustGraphNodeIdentities(graph, {
    "member-id": { revealed_response_ranges: expectedRanges },
  }), graph);
});

test("sparse: range content, types, order, and fields must match exactly", () => {
  const inputs = inputsFor("sparse");
  const graph = deriveProductionTrustGraph(inputs);
  const ranges = inputs.semanticVerification.result.revealed_response_ranges;
  const changedRange = (fields) => [{ ...ranges[0], ...fields }, { ...ranges[1] }];
  for (const changed of [
    changedRange({ start: "1" }),
    changedRange({ length: "5" }),
    changedRange({ bytes: Buffer.from("fake").toString("base64url") }),
    changedRange({ start: 0 }),
    changedRange({ unexpected: true }),
    [...ranges].reverse(),
    ranges.slice(1),
    [...ranges, { start: "16", length: "4", bytes: Buffer.from("last").toString("base64url") }],
    [{ start: ranges[0].start, length: ranges[0].length }, { ...ranges[1] }],
    JSON.stringify(ranges),
    null,
  ]) {
    assert.throws(
      () => assertTrustGraphNodeIdentities(graph, {
        "member-id": { revealed_response_ranges: changed },
      }),
      /trust graph member-id identity mismatch: revealed_response_ranges/,
    );
  }
});
