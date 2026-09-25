const SYNTHETIC_K256_PUBLIC_KEY = Buffer.from(
  "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
  "hex",
);
const SYNTHETIC_NOTARY_KEY = Buffer.alloc(42);
SYNTHETIC_NOTARY_KEY[0] = 1;
SYNTHETIC_NOTARY_KEY.writeBigUInt64LE(33n, 1);
SYNTHETIC_K256_PUBLIC_KEY.copy(SYNTHETIC_NOTARY_KEY, 9);

function base64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export const CANARY_FIXTURE_ONLY_MANIFEST = Object.freeze({
  benchmark: "tlsn-canary-fixture-only-v1",
  schemaVersion: 1,
  generator: "tracked_synthetic_fixture",
  cargoProfile: "none",
  offline: true,
  source: {
    path: "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/canary-fixture-only-data.mjs",
    fixtureSemantics: "synthetic metadata only; no TLSNotary Presentation or HTTP transcript",
    httpTranscriptSize: "NOT_ESTABLISHED",
  },
  cases: [{
    caseLabel: "p50",
    fixtureFile: "embedded-synthetic-canary-fixture",
    sourceEpoch: "repository",
    sourceFileName: "canary-fixture-only-data.mjs",
  }],
});

const CANARY_FIXTURE_ONLY_DATA = Object.freeze({
  sparse_presentation_base64: base64url("synthetic sparse Presentation placeholder"),
  root_certificate_base64: base64url("synthetic root certificate placeholder"),
  notary_key_base64: SYNTHETIC_NOTARY_KEY.toString("base64url"),
});

export function loadCanaryFixtureOnlyFixture(caseLabel = "p50") {
  const entry = CANARY_FIXTURE_ONLY_MANIFEST.cases.find((candidate) => candidate.caseLabel === caseLabel);
  if (!entry) throw new Error(`unknown synthetic fixture case: ${caseLabel}`);
  return {
    manifest: CANARY_FIXTURE_ONLY_MANIFEST,
    entry,
    fixture: CANARY_FIXTURE_ONLY_DATA,
  };
}
