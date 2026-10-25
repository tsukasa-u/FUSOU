import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
