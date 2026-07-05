# Hardware Attestation: Design, Security Guarantees, and Limitations

> This document describes the TPM-based hardware attestation system in FUSOU.
> It explains what the system guarantees, how it works end-to-end, and where its limits are.

---

## 1. What the System Guarantees

When an upload receives `trust_tag: "hw_verified"`, the following properties have been
cryptographically verified:

| Property | Guarantee | Mechanism |
|---|---|---|
| **Data integrity** | The submitted data is exactly the data that was present when the TPM quote was generated | SHA-256 content_hash bound into TPM qualifying_data |
| **Per-submission binding** | Each upload is tied to a unique, one-time proof | Nonce = `upload:{timestamp_ms}:{content_hash}` |
| **Replay prevention** | The same proof cannot be reused | KV-based nonce consumption (10-minute TTL) |
| **Hardware origin** | A real, manufacturer-certified TPM was involved | EK cert chain verifies against manufacturer root CA |
| **Temporal freshness** | The proof was generated within the last 10 minutes | Nonce timestamp validation + TTL |

### What `trust_tag: "hw_verified"` does NOT guarantee

| Property | Status | Reason |
|---|---|---|
| **Unmodified app binary** | ❌ Not guaranteed | TPM PCRs (0,2,4,7) measure firmware/boot, not user-space processes |
| **In-memory state integrity** | ❌ Not guaranteed | Runtime memory tampering is not measured |
| **AK-EK cryptographic binding** | ⚠️ Not yet proven | ActivateCredential (Phase 2) not yet implemented |

> **Honest assessment for FUSOU's use case (game statistics):**
> The system prevents casual and automated fake data submissions, and substantially raises
> the bar for more sophisticated attacks. It does not prevent a determined attacker with
> a real hardware TPM from submitting fabricated game data via a modified FUSOU app.

---

## 2. End-to-End Data Integrity Chain

The following diagram shows how data flows from game capture to server storage with
integrity proofs at each step.

```
Game Network Traffic (KanColle API)
         │
         ▼
   FUSOU Proxy (MITM)
         │  intercepts game API responses
         ▼
   FUSOU App (Rust/Tauri)
         │  parses and records battle data
         ▼
   battle_data (bytes)
         │
         ├──► SHA-256 ──────────────────────► content_hash (hex)
         │                                            │
         │    nonce = "upload:{ts_ms}:{content_hash}" │
         │                                            │
         ├──► TPM2_Quote(                             │
         │       qualifying_data = SHA256(nonce),     │
         │       pcr_selection = {0,2,4,7},           │
         │       key = AK at handle 0x810xxxxx        │
         │    )                                       │
         │    ──► attestation_data (TPMS_ATTEST)      │
         │    ──► attestation_signature               │
         │                                            │
         ▼                                            ▼
   Upload Request (HTTP POST):
     - battle_data  (binary payload)
     - content_hash (SHA-256 of battle_data)          ← same value
     - attestation_nonce = nonce
     - attestation_report = {
         attestation_level: "tpm",
         attestation_data: base64(TPMS_ATTEST),
         attestation_signature: base64(RSA-SSA sig),
         public_key: base64(AK SPKI DER),
         certificate_chain: [AK cert DER, Privacy CA cert DER],
         fingerprint: { cpu, os, ... },
       }
         │
         ▼
   Server verification (upload.ts + attestation-verifier.ts):
     1. SHA256(received battle_data) == content_hash          ✓ data not tampered
     2. nonce contains correct content_hash                   ✓ nonce bound to this data
     3. nonce timestamp within 10 minutes                     ✓ fresh
     4. nonce not seen before (KV replay guard)               ✓ not replayed
     5. TPM.extraData == SHA256(nonce)                        ✓ quote bound to nonce
     6. TPM quote structure valid (magic, type)               ✓
     7. AK cert leaf has TPM AIK EKU (2.23.133.8.3)          ✓
     8. AK cert chain verifies: leaf → Privacy CA             ✓
     9. Privacy CA SHA-256 in trusted roots                   ✓
    10. AK cert public_key == report.public_key               ✓ AK owns the quote
    11. TPM quote signature valid under AK public_key         ✓
         │
         ▼
   trust_tag: "hw_verified"
```

---

## 3. TPM Hardware Attestation Architecture

### 3.1 Key Types

| Key | Type | Purpose | Certification |
|---|---|---|---|
| **EK (Endorsement Key)** | RSA 2048, decrypt-only | TPM identity, hardware-bound, unique per device | Manufacturer-issued EK certificate |
| **AK (Attestation Key)** | RSA 2048, restricted sign | Signs TPM quotes | Privacy CA-issued AK certificate |

### 3.2 Privacy CA Flow (AK Certificate Issuance)

The Privacy CA bridges the gap between the manufacturer-certified EK and the signing AK:

```
Client                          Privacy CA (FUSOU server)           Manufacturer PKI
  │                                      │                                 │
  │ 1. Read EK cert from NV or           │                                 │
  │    fetch via tpm2_getekcertificate   │                                 │
  │    (AMD: http://ftpm.amd.com/...)    │                                 │
  │                                      │                                 │
  │ 2. POST /api/attestation/ak-cert     │                                 │
  │    { ek_cert_chain, ak_pub_key }     │                                 │
  │ ───────────────────────────────────► │                                 │
  │                                      │ 3. Verify EK chain against      │
  │                                      │    Supabase trusted roots       │
  │                                      │    (AMD root, Intel, Infineon,  │
  │                                      │    Nuvoton, ST, GlobalSign+ST)  │
  │                                      │ ───────────────────────────────►│
  │                                      │    confirmed manufacturer TPM   │
  │                                      │ ◄───────────────────────────────│
  │                                      │                                 │
  │                                      │ 4. Issue AK cert:               │
  │                                      │    Subject: FUSOU-AK-{ek_serial}│
  │                                      │    pubkey: client AK public key │
  │                                      │    EKU: 2.23.133.8.3 (TPM AIK) │
  │                                      │    Signed by: Privacy CA        │
  │                                      │    Validity: 7 days             │
  │                                      │                                 │
  │ 5. Receive [AK cert, Privacy CA cert]│                                 │
  │ ◄───────────────────────────────────│                                 │
  │                                      │                                 │
  │ 6. Cache to ROAMING_DIR/            │                                 │
  │    attestation/ak_cert_chain.json    │                                 │
```

**Result:** AK cert chain = [AK cert, Privacy CA cert]

The AK cert Subject contains the EK certificate serial number (`CN=FUSOU-AK-{ek_serial}`)
to establish an audit trail linking each AK cert to the specific manufacturer TPM that
was verified.

### 3.3 Trusted Root Infrastructure

Supabase `attestation_trusted_roots` table contains:

| Manufacturer | Count | Notes |
|---|---|---|
| Nuvoton | 7 | NUVO_1110, NUVO_1111, NTC1, NUVO_2110, and others |
| Intel | 1 | INTEL_RT.pem |
| STMicroelectronics | 1 | ST ECC |
| GlobalSign + ST | 1 | GS_TPM_RT.pem |
| Infineon | 2 | RSA and ECC roots |
| **AMD (fTPM)** | 1 | ftpm.amd.com root (added this session) |
| **FUSOU Privacy CA** | 1 | Issues AK certs after EK chain verification |

**Active trusted roots: 14** (12 Keylime manufacturer roots + AMD root + Privacy CA)

---

## 4. Known Security Limitations

### 4.1 AK-EK Co-residency: IMPLEMENTED via ActivateCredential

The Privacy CA uses the `TPM2_MakeCredential` + `TPM2_ActivateCredential` protocol to
cryptographically prove that the AK signing key and the EK reside in the **same physical TPM**.

**How it prevents the attack:**
- Server MakeCredential encrypts the challenge so only the TPM with the matching EK can decrypt it
- The decryption also requires the correct AK name (hash of AK public area)
- A software AK or an AK on a different TPM cannot pass this check
- `TPM2_ActivateCredential` fails → Privacy CA rejects the request → no AK cert issued

### 4.2 App Binary Integrity: Honest Limitation

**What the TPM quote does NOT prove:**
The TPM PCRs included in the quote (0, 2, 4, 7) measure:
- PCR[0]: BIOS/UEFI firmware
- PCR[2]: Option ROMs
- PCR[4]: Boot loader
- PCR[7]: Secure Boot policy

They do **NOT** measure FUSOU App's binary. A modified FUSOU app running on unmodified
hardware will produce the same PCR values as the genuine app.

**What this means in practice:**
An attacker with a real manufacturer TPM could, in theory, run a modified FUSOU app and
still receive `hw_verified` for fabricated game data. The TPM quote proves hardware is
present and the data hash was bound at quote-time, but it does NOT prove the source of
the data was legitimate game traffic.

**Mitigations within current architecture:**
1. **Game-level validation** (server-side): Validate game API structures, session flow,
   impossibility checks (ship level ≤ 175, valid fleet compositions, etc.)
2. **Cross-user correlation**: Detect suspicious submission patterns across users
3. **Data source verification**: The FUSOU Proxy captures raw game traffic; statistical
   anomaly detection can identify fabricated data

**Mitigation requiring user-side configuration (out of scope now):**
Linux IMA with PCR[10] would measure the app binary. Sealing the AK to expected PCR[10]
values would prevent a modified app from accessing the AK. This requires per-user
configuration and is not practical for the general user base.

### 4.3 Privacy CA Key Protection

The Privacy CA private key (`ATTESTATION_PRIVACY_CA_PRIVATE_KEY_JWK`) is stored in
Cloudflare Workers secrets. If this key is compromised:
- Attacker can issue AK certs for any public key
- All subsequent `hw_verified` uploads would be forgeable without real hardware

**Mitigation:** Rotate the Privacy CA key if compromise is suspected. All cached AK certs
expire in 7 days and would need to be re-issued using the new key. The Privacy CA SHA-256
in Supabase trusted roots must be updated to the new cert's hash.

---

## 5. Operational Reference

### 5.1 Checking Attestation Status

```bash
# Check trusted roots
pnpm run manage-attestation-trusted-roots-supabase -- status

# Verify endpoint is live and config is signed
curl -s https://fusou.dev/api/attestation/config | jq .
curl -sI https://fusou.dev/api/attestation/config | grep x-fusou-config-signature

# Request an AK cert (requires real EK cert chain)
curl -X POST https://fusou.dev/api/attestation/ak-cert \
  -H "Content-Type: application/json" \
  -d '{"ek_cert_chain_b64":[...], "ak_pub_b64":"..."}'
```

### 5.2 Trust Tag Reference

| trust_tag | Meaning | Condition |
|---|---|---|
| `hw_verified` | Hardware TPM + data integrity proven | Valid AK cert chain → trusted root, valid TPM quote |
| `sw_verified` | Software fingerprint verified | Software fingerprint valid, no hardware attestation |
| `suspicious` | Hardware claimed but verification failed | TPM claim present but chain/quote invalid |
| `unverified` | No verifiable attestation | Missing or structurally invalid report |

### 5.3 Privacy CA Key Rotation

```bash
# 1. Generate new Privacy CA keypair
node packages/FUSOU-WEB/scripts/manage-attestation-privacy-ca.mjs generate

# 2. Register new private key in Workers
cd packages/FUSOU-WEB && npx wrangler secret put ATTESTATION_PRIVACY_CA_PRIVATE_KEY_JWK

# 3. Update PRIVACY_CA_CERT_DER_B64 constant in attestation_ak_cert.ts

# 4. Update Supabase trusted roots: deactivate old, add new
pnpm run manage-attestation-trusted-roots-supabase -- apply-file --file @new_ca.json --confirm

# 5. Deploy
pnpm run deploy

# 6. Users must re-obtain AK certs (max 7 day disruption)
```

### 5.4 Adding New Manufacturer Roots

If a new TPM manufacturer's root CA needs to be trusted:

```bash
# 1. Get manufacturer root cert DER SHA-256
sha256sum manufacturer_root.der

# 2. Add to Supabase
cat > /tmp/new_root.json << 'EOF'
[{"platform":"tpm","root_sha256":"<sha256>","manufacturer":"<name>","description":"...","source":"<url>","status":"active"}]
EOF
pnpm run manage-attestation-trusted-roots-supabase -- apply-file --file @/tmp/new_root.json --confirm
```

---

## 6. File Reference

| File | Role |
|---|---|
| `packages/FUSOU-WEB/src/server/routes/attestation_ak_cert.ts` | Privacy CA endpoint: verifies EK chain, issues AK certs |
| `packages/FUSOU-WEB/src/server/utils/attestation-verifier.ts` | Server-side TPM quote + cert chain verification |
| `packages/FUSOU-WEB/src/server/utils/upload.ts` | Per-upload nonce binding and attestation flow |
| `packages/FUSOU-APP/src-tauri/src/attestation/mod.rs` | Client: collects TPM quotes, resolves cert chain |
| `packages/FUSOU-APP/src-tauri/src/attestation/ak_cert_sync.rs` | Client: fetches EK cert, requests + caches AK cert |
| `packages/FUSOU-APP/src-tauri/src/attestation/config_sync.rs` | Client: syncs attestation config from server |
| `packages/FUSOU-APP/src-tauri/src/attestation/tpm_linux.rs` | Client: Linux TPM2 quote generation via tss-esapi |
| `packages/fusou-upload/src/uploader.rs` | Client: attaches nonce-bound attestation to uploads |
