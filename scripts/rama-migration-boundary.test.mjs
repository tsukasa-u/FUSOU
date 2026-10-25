import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { verifyHandshakeOnlyArtifact } from "./proxy-handshake-artifact.mjs";

const root = "../packages/FUSOU-PROXY/proxy-https/";
const read = (file) => readFileSync(new URL(`${root}${file}`, import.meta.url), "utf8");
test("Rama production code depends on the neutral downstream TLS provider, not the fork CA API", () => {
  const source = read("src/proxy_server_https/rama_experimental.rs");
  assert.match(source, /use super::downstream_tls::DownstreamTlsConfigProvider;/);
  assert.doesNotMatch(source, /^use hudsucker::certificate_authority|CA: CertificateAuthority|\.gen_server_config/m);
  assert.match(source, /ca\.server_config\(&authority\)\.await/);
});
test("compatibility adapter delegates unchanged issuance and remains experimental", () => {
  const source = read("src/proxy_server_https/downstream_tls.rs");
  assert.match(source, /CertificateAuthority::gen_server_config\(self, authority\)/);
  assert.match(source, /provider_can_be_used_without_a_hudsucker_ca/);
  const parent = read("src/proxy_server_https.rs");
  assert.match(parent, /#\[cfg\(feature = "rama-experimental"\)\]\npub mod downstream_tls;/);
  const manifest = read("Cargo.toml");
  assert.match(manifest, /hudsucker = \{ path = "\.\.\/hudsucker-fork" \}/);
  assert.doesNotMatch(manifest.match(/^default = .*$/m)[0], /rama/);
});
test("Rama source retains SNI-before-upstream, verified-upstream-before-capture ordering", () => {
  const source = read("src/proxy_server_https/rama_experimental.rs");
  const tunnel = source.slice(source.indexOf("async fn run_tunnel<"), source.indexOf("async fn connect_verified_upstream("));
  const sni = tunnel.indexOf("expected_sni: authority.host()");
  const handshake = tunnel.indexOf("tls_acceptor.serve(");
  const upstream = tunnel.indexOf("connect_verified_upstream(&config).await");
  const capture = tunnel.indexOf("capture_hook.start_session(");
  assert.ok(sni >= 0 && handshake > sni && upstream > handshake && capture > upstream);
  assert.match(tunnel.slice(upstream, capture), /return Ok\(\(\)\);/);
  assert.match(source, /failed_shared_tlsn_forwarder_never_falls_back_to_rama_upstream/);
  assert.match(source, /outer_task_abort_closes_websocket_and_reports_unclean/);
});
test("each backend artifact must match its own observed HTTP bytes without imposing cross-backend serialization", () => {
  for (const header of ["Upgrade", "upgrade"]) {
    const request = Buffer.from(`GET /socket HTTP/1.1\r\nHost: game.example.test\r\n${header}: websocket\r\n\r\n`);
    const response = Buffer.from(`HTTP/1.1 101 Switching Protocols\r\n${header}: websocket\r\n\r\n`);
    const checked = verifyHandshakeOnlyArtifact({ request, response, clientRequest: request, clientResponse: response });
    assert.equal(checked.websocket_frames_included, false);
    assert.equal(checked.tlsn_status, "NOT_CHECKED");
  }
});
test("frame bytes, incomplete handshake, wrong status and substituted client bytes reject", () => {
  const request = Buffer.from("GET /socket HTTP/1.1\r\nHost: game.example.test\r\n\r\n");
  const response = Buffer.from("HTTP/1.1 101 Switching Protocols\r\n\r\n");
  const framed = Buffer.concat([response, Buffer.from([0x81, 0])]);
  const incomplete = request.subarray(0, request.length - 1);
  const failure = Buffer.from("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  for (const change of [
    { response: framed, clientResponse: framed },
    { request: incomplete, clientRequest: incomplete },
    { response: failure, clientResponse: failure },
    { clientResponse: Buffer.from("HTTP/1.1 101 Different\r\n\r\n") },
  ]) {
    assert.throws(() => verifyHandshakeOnlyArtifact({ request, response, clientRequest: request, clientResponse: response, ...change }));
  }
});
