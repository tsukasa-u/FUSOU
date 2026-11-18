# FUSOU-managed Notary: release and ledger handover

The FUSOU developer operates one `fusou-notary` instance on one Linux host,
under a dedicated unprivileged user on a local persistent filesystem. This is
the selected model, not an approval to deploy. No automatic deployment or
active/active mode is provided. Do not run `fusou-local-test-notary` as a
service. Grant and TCP wire are both v1; the wire magic is `FUSOU-N1`.

## 1. Source release and separate artifact record

After review, use an **annotated, signed** tag `notary/vX.Y.Z`; never move,
delete/recreate or reuse a published release tag. Only an authorized operator
may run `git tag -s -u "$APPROVED_TAG_SIGNER" "$TAG" "$APPROVED_SHA"`
and publish it, outside this local exercise. In a clean, authorized release
builder, run `git verify-tag --raw "$TAG"` and compare the verified signer
fingerprint to the independently approved tag-signing policy (a valid
signature by itself is insufficient). Use `git rev-parse "$TAG^{commit}"`
and compare the full SHA to the approved source SHA and successful Hosted CI
for that same SHA. Build from that commit with the pinned lockfile:

```sh
manifest=packages/FUSOU-PROXY/proxy-https/Cargo.toml
cargo +1.98.1 build --release --locked --offline --manifest-path "$manifest" \
  --features operational-notary --bin fusou-notary
sha256sum "$CARGO_TARGET_DIR/release/fusou-notary"
```

Set `CARGO_TARGET_DIR` to an isolated build directory first. Provision the
locked dependency cache separately if necessary (`cargo +1.98.1 fetch
--locked --manifest-path "$manifest"`; no `--features` on `fetch`). Do not
enable either local-test feature. Approve the actual built digest; these
instructions do not claim independent bitwise reproducibility.

Keep the following **separate records**, authenticated by the release or
placement approver as applicable. Values in angle brackets are placeholders.

| Record | Fields to retain |
|---|---|
| Source release | `tag: notary/vX.Y.Z`; annotated tag object ID; approved tag signer fingerprint and `verify-tag` result; full commit SHA; base SDK revision `47aee45b53e06648c1b2ad3689b367b8c923fdec` and FUSOU SDK tree ID (`git rev-parse "$TAG:packages/tlsn-alpha15-sparse"`); `git rev-parse "$TAG:packages/FUSOU-PROXY/proxy-https/Cargo.lock"` and lockfile SHA-256; Rust/toolchain versions, target, builder OS/architecture, linker/build flags, exact release command; full same-SHA Hosted CI run URL and conclusion. |
| Built artifact and approved configuration | Tag and commit SHA; artifact name, exact SHA-256 and length; review/approval reference; Notary ID, environment, advertised endpoint, wire version, Notary K256 key ID/public pin, dedicated Session Authority Ed25519 key ID/SPKI, independently approved registration SHA-256 (base64url), exact public export SHA-256, approved Web PKI anchor DER SHA-256, bind address/network policy, and key custody and scope exclusivity approvals. |
| Placement and handover | Release/artifact approval reference, **installed** binary digest and length verified immediately before starting, host/instance identifier, operator, UTC stop/start timestamps, checked configuration and offline preflight result, ledger path and handover/recovery record, tested existing-state compatibility and readback result, approval to resume ingress. Do not include grants, private keys, raw ledger contents or authentication tokens in placement records. |

Use distinct keys for tag signing, K256 Notary signing and Session Authority
Ed25519 grants. A new tag neither rotates a key nor grants permission to
reuse it across Notary/environment scopes. No rotation or ledger migration
tool is provided in this candidate.

## 2. Configure and compare before binding

The [operator configuration](../../FUSOU-PROXY/proxy-https/src/operational_notary.rs)
is explicit JSON with no overrides or defaults. Example shape (invalid
placeholders, not production settings):

```json
{
  "schema_version": 1,
  "listen": "127.0.0.1:9444",
  "ledger_directory": "/var/lib/fusou-notary/ledger",
  "notary_signing_key_file": "/etc/fusou-notary-private/signing-key",
  "origin_trust_anchor_der": "/etc/fusou-notary/origin-trust-anchor.der",
  "public": {
    "endpoint": "notary.example.invalid:9444",
    "environment": "<signed Manifest environment>",
    "notary_id": "<approved Notary ID>",
    "notary_key_id": "<approved Notary signing key ID>",
    "notary_verifying_key": "<base64url of alpha.15 bincode K256 verifying key>",
    "session_authority_key_id": "<dedicated Session Authority key ID>",
    "session_authority_public_key_spki": "<base64url of Ed25519 SPKI DER>",
    "wire_version": 1
  }
}
```

Use a private `0600` config and a private `0600` key file containing exactly
32 raw K256 scalar bytes (not PEM or hex). Keep paths under trusted,
non-writable-by-others directories; keep the private key off the repo and
out of arguments and logs. Specify the approved Web PKI anchor as a single
DER certificate; do not treat it, its fingerprint or the Notary endpoint as
the Game Server identity. Record the approved bind/ingress mapping separately
from the advertised host:port. Only loopback has been exercised; a non-loopback
bind and network policy need independent approval, traffic limits and validation.

Run as the service user before first start **and every replacement/restart**:

```sh
umask 077
"$NOTARY_BIN" export-public "$NOTARY_CONFIG" > "$SNAPSHOT_DIR/notary-operator-public-config.json"
node packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/notary-operational-preflight.mjs \
  "$SNAPSHOT_DIR" "$APPROVAL_DIR" "$APPROVED_NOTARY_REGISTRATION_SHA256"
```

Follow the [Evidence runbook](./production-evidence-operator-runbook.md#headerless-notary-selection-and-offline-configuration-check)
for independently approved pins and exact signed snapshot inputs. Do not
compute the expected registration digest from the received registration.
`export-public` checks the actual private file derives the configured public
key, validates the configuration and trust anchor, and returns canonical
public bytes with no network or ledger I/O. Stop on any nonzero exit; check
the installed artifact, export, local configuration and trust-anchor bytes
against the approval record and keep those inputs unchanged until start.
The daemon itself checks local key/config and ledger continuity; it does not
verify the independent registration, Manifest or artifact approval. The manual
operator gate is mandatory, including after changing either the binary or
configuration. The public check does not attest a live process.

## 3. First start, updates, stop and recovery

1. **One-time genesis only:** independently confirm the scope/key has never
   admitted grants and no ledger exists. Prepare a dedicated empty `0700`
   ledger directory owned by the service user. With ingress closed and after
   the offline checks, run `"$NOTARY_BIN" init "$NOTARY_CONFIG"`. Never put
   `init` in a supervisor restart hook. A partial init leaves files and
   fails closed; investigate with ingress closed instead of retrying against
   a new directory.
2. **Existing state:** run `"$NOTARY_BIN" serve "$NOTARY_CONFIG"` in the
   foreground under the supervisor. It locks `instance.lock` for the process
   lifetime and opens the existing `ledger.lock` and `ledger.json` before
   binding. It rejects missing/corrupt state or incompatible settings/schema.
   The binding covers the exact canonical public settings and the SHA-256 of
   the DER anchor. Do not replace the live ledger directory or lock files.
   Open ingress only after confirming the approved deployment mapping and
   supervisor state. Raw TCP admission success is not a trusted health check.
3. **Update:** close ingress, stop new captures and let authorized in-flight
   operations drain before signaling `SIGTERM`; wait for process exit. Do not
   restart interrupted captures. Record the handover and take an
   access-controlled consistent backup of the stopped ledger. Verify the
   next signed tag, binary digest and public configuration. Before allowing
   a new release to use the current ledger, validate both read and write
   compatibility on a protected copy with ingress closed, preserving
   `Finalized` exact bytes, all consumed grants and `Unknown`. Switch only the
   binary and reopen the same live ledger, never a copy used for testing.
4. **Binary rollback:** independently verify the old binary digest and show
   that it understands state written by the new version and the same
   approved configuration. Stop the new process before reopening the
   **latest** ledger with the old binary. If that compatibility is not
   established, stay down; do not restore an old ledger to make it boot.
5. **Ledger recovery:** keep ingress closed after missing, damaged or
   ambiguous storage. Recover only with independent evidence that no
   consumed or possibly consumed grant can be reused. A stale but valid
   snapshot is not detected by this standalone ledger; if the recovery
   would lose admissions, signing claims, finalized bytes or Unknown
   records, keep the service stopped and escalate to release/security and
   the Session Authority owner. No automatic recovery or key rotation is
   authorized by this runbook.

Same-binary restart with the same ledger and settings is a different test
from upgrading or rolling back between released versions. There is no
previous operational release artifact to certify for cross-version use.

## 4. Local reproduction and trust boundary

Use only a temporary isolated target directory and the synthetic fixtures in
[the operational interop test](../../FUSOU-PROXY/proxy-https/tests/local_notary_interop/operational.rs).
Build the normal artifact as above, record its digest, and then run:

```bash
set -euo pipefail
binary="$CARGO_TARGET_DIR/release/fusou-notary"
sha256sum "$binary" > "$CARGO_TARGET_DIR/fusou-notary.sha256"
export FUSOU_OPERATIONAL_NOTARY_BIN="$binary"
features=local-test-notary-fault-injection,operational-notary
test_name=operational::normal_binary_complete_and_restarts_using_the_same_ledger
listing="$(cargo +1.98.1 test --locked --offline --manifest-path "$manifest" \
  --features "$features" --test local_notary_interop -- --list)"
grep -Fxq "$test_name: test" <<< "$listing"
cargo +1.98.1 test --locked --offline --manifest-path "$manifest" \
  --features "$features" --test local_notary_interop "$test_name" -- --exact --test-threads=1
sha256sum --check "$CARGO_TARGET_DIR/fusou-notary.sha256"
node --test packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/notary-operational-preflight.test.mjs
```

The features on the test harness are not features of the supplied release
artifact. This invokes no APP Cargo, service, external Notary or Game Server.
It does not exercise Worker Result or archive issuance.

Trust the developer-operated Notary to protect its signing key, execute the
approved binary/settings, and preserve the ledger. An independent verifier
uses the externally pinned Notary and Authority public keys, Web PKI trust
anchor and approved Inventory/Target Approval to validate the signatures,
observed DNS identity, grant/acceptance and authenticated transcript in the
Presentation. The wider Evidence verification independently checks the
signed Result and binding to exact archived bytes with the remaining required
inputs. Neither the tag nor those signatures prove operational key custody,
live process identity, intact ledger history or the absence of off-register
key reuse. Stage A/B/C and Production acceptance remain **BLOCKED**.
