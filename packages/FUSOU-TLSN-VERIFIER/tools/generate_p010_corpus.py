#!/usr/bin/env python3
"""Generate independent test-only Result and authority-receipt vectors."""

import argparse
import base64
import copy
import hashlib
import json
import struct
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = PACKAGE_ROOT / "fixtures" / "p010-cross-language-corpus-v1.json"
SOURCE_CONTRACT_COMMIT = "96545076bc4e53083e4536a4159b3d2cb8dce0c3"
OPENSSL_VERSION = "OpenSSL 3.5.6 7 Apr 2026"
RFC8032_SEED = bytes.fromhex(
    "9d61b19deffd5a60ba844af492ec2cc4"
    "4449c5697b326919703bac031cae7f60"
)
RFC8032_PUBLIC_KEY = bytes.fromhex(
    "d75a980182b10ab7d54bfed3c964073a"
    "0ee172f3daa62325af021a68f707511a"
)
RFC8032_EMPTY_MESSAGE_SIGNATURE = bytes.fromhex(
    "e5564300c360ac729086e2cc806e828a"
    "84877f1eb8e5d974d873e06522490155"
    "5fb8821590a33bacc61e39701cf9b46b"
    "d25bf5f0595bbe24655141438e7a100b"
)
SPKI_PREFIX = bytes.fromhex("302a300506032b6570032100")
PKCS8_PREFIX = bytes.fromhex("302e020100300506032b657004220420")
SESSION_ID = "123e4567-e89b-42d3-a456-426614174000"
USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
NOT_BEFORE = "2025-01-01T00:00:00.000Z"
CAPTURE_TIME = "2026-10-15T00:00:00.000Z"
SESSION_CREATED_AT = "2026-10-15T00:00:00.000Z"
SESSION_EXPIRES_AT = "2026-10-15T01:00:00.000Z"
CONSUMED_AT = "2026-10-15T00:30:00.000Z"


def base64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def decode_base64url(value):
    return base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))


def compact_json(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def u16(value):
    return struct.pack(">H", value)


def u32(value):
    return struct.pack(">I", value)


def u64(value):
    return struct.pack(">Q", value)


def length_prefixed(value):
    return u16(len(value)) + value


def range_wire(ranges):
    output = bytearray(u32(len(ranges)))
    for item in ranges:
        raw = decode_base64url(item["bytes"])
        length = int(item["length"])
        if len(raw) != length:
            raise ValueError("range byte count must match its length field")
        output.extend(u64(int(item["start"])))
        output.extend(u64(length))
        output.extend(u64(len(raw)))
        output.extend(raw)
    return bytes(output)


def ed25519_material_and_signature(seed, message):
    if len(seed) != 32:
        raise ValueError("Ed25519 seed must be 32 bytes")
    private_der = PKCS8_PREFIX + seed
    encoded = base64.b64encode(private_der).decode("ascii")
    pem = "-----BEGIN PRIVATE KEY-----\n"
    pem += "\n".join(encoded[index : index + 64] for index in range(0, len(encoded), 64))
    pem += "\n-----END PRIVATE KEY-----\n"

    with tempfile.TemporaryDirectory(prefix="fusou-p010-vector-") as directory:
        key_path = Path(directory) / "test-only-ed25519.pem"
        message_path = Path(directory) / "message.bin"
        key_path.write_text(pem, encoding="ascii")
        message_path.write_bytes(message)
        spki = subprocess.run(
            [
                "openssl",
                "pkey",
                "-in",
                str(key_path),
                "-pubout",
                "-outform",
                "DER",
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout
        sign_result = subprocess.run(
            [
                "openssl",
                "pkeyutl",
                "-sign",
                "-rawin",
                "-inkey",
                str(key_path),
                "-in",
                str(message_path),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if sign_result.returncode != 0:
            raise RuntimeError(
                "OpenSSL Ed25519 signing failed: "
                + sign_result.stderr.decode("utf-8", errors="replace")
            )
        signature = sign_result.stdout
    if not spki.startswith(SPKI_PREFIX) or len(spki) != len(SPKI_PREFIX) + 32:
        raise ValueError("OpenSSL returned an unexpected Ed25519 SPKI")
    if len(signature) != 64:
        raise ValueError("OpenSSL returned an unexpected Ed25519 signature size")
    return spki, spki[len(SPKI_PREFIX) :], signature


def binding_value(session_id, nonce):
    encoded = (
        b"FUSOU-ATTESTATION-BINDING-V1\0"
        + length_prefixed(uuid.UUID(session_id).bytes)
        + length_prefixed(nonce)
    )
    return base64url(encoded)


def complete_result_signing_bytes(fields):
    output = bytearray(b"FUSOU-VERIFIER-RESULT-V2\0")
    output.extend(u16(fields["version"]))
    for value in (
        fields["profile_id"].encode("ascii"),
        decode_base64url(fields["profile_sha256"]),
        fields["issuer"].encode("ascii"),
        fields["proof_purpose"].encode("ascii"),
        fields["canonical_user_id"].encode("ascii"),
        fields["device_id"].encode("ascii"),
        decode_base64url(fields["device_challenge"]),
        fields["verified_member_id"].encode("ascii"),
        uuid.UUID(fields["attestation_session_id"]).bytes,
        decode_base64url(fields["binding_nonce"]),
        fields["binding_value"].encode("ascii"),
        fields["verifier_key_id"].encode("ascii"),
        fields["notary_key_id"].encode("ascii"),
        decode_base64url(fields["tlsn_attestation_id"]),
        decode_base64url(fields["presentation_sha256"]),
        fields["server_identity"].encode("ascii"),
    ):
        output.extend(length_prefixed(value))
    for name in ("origin_inventory_sha256", "target_approval_artifact_sha256"):
        value = fields[name]
        output.extend(length_prefixed(b"" if value is None else decode_base64url(value)))
    output.extend(u64(int(fields["request_transcript_size"])))
    output.extend(length_prefixed(decode_base64url(fields["request_transcript_sha256"])))
    output.extend(range_wire(fields["revealed_request_ranges"]))
    output.extend(u64(int(fields["response_transcript_size"])))
    output.extend(length_prefixed(decode_base64url(fields["response_transcript_sha256"])))
    output.extend(range_wire(fields["revealed_response_ranges"]))
    return bytes(output)


def sparse_result_signing_bytes(fields):
    output = bytearray(b"FUSOU-VERIFIER-SPARSE-RESULT-V2\0")
    output.extend(u16(fields["version"]))
    for value in (
        fields["profile_id"].encode("ascii"),
        fields["disclosure_mode"].encode("ascii"),
        decode_base64url(fields["profile_sha256"]),
        fields["issuer"].encode("ascii"),
        fields["proof_purpose"].encode("ascii"),
        fields["canonical_user_id"].encode("ascii"),
        fields["device_id"].encode("ascii"),
        decode_base64url(fields["device_challenge"]),
        fields["verified_member_id"].encode("ascii"),
        uuid.UUID(fields["attestation_session_id"]).bytes,
        decode_base64url(fields["binding_nonce"]),
        fields["binding_value"].encode("ascii"),
        fields["verifier_key_id"].encode("ascii"),
        fields["notary_key_id"].encode("ascii"),
        decode_base64url(fields["notary_key_sha256"]),
        decode_base64url(fields["tlsn_attestation_id"]),
        decode_base64url(fields["presentation_sha256"]),
        fields["server_identity"].encode("ascii"),
    ):
        output.extend(length_prefixed(value))
    for name in ("origin_inventory_sha256", "target_approval_artifact_sha256"):
        value = fields[name]
        output.extend(length_prefixed(b"" if value is None else decode_base64url(value)))
    output.extend(u64(int(fields["request_transcript_size"])))
    output.extend(range_wire(fields["revealed_request_ranges"]))
    output.extend(u64(int(fields["response_transcript_size"])))
    output.extend(range_wire(fields["revealed_response_ranges"]))
    return bytes(output)


def make_result_vector(vector_id, contract, fields, request_raw, response_raw, signer):
    signing_bytes = (
        complete_result_signing_bytes(fields)
        if contract == "complete-result-v2"
        else sparse_result_signing_bytes(fields)
    )
    spki, raw_public_key, signature = ed25519_material_and_signature(
        signer["seed"], signing_bytes
    )
    if spki != signer["spki"]:
        raise ValueError("Result signer SPKI changed during vector generation")
    signed_fields = dict(fields)
    signed_fields["signature"] = base64url(signature)
    result_json = compact_json(signed_fields)
    return {
        "vector_id": vector_id,
        "contract": contract,
        "schema_version": fields["version"],
        "test_only": True,
        "input": {
            "result_json_utf8": result_json.decode("ascii"),
            "request_transcript_base64url": (
                None if request_raw is None else base64url(request_raw)
            ),
            "response_transcript_base64url": (
                None if response_raw is None else base64url(response_raw)
            ),
        },
        "expected": {
            "canonical_json_utf8": result_json.decode("ascii"),
            "canonical_json_sha256_hex": hashlib.sha256(result_json).hexdigest(),
            "signing_bytes_hex": signing_bytes.hex(),
            "signing_bytes_sha256_hex": hashlib.sha256(signing_bytes).hexdigest(),
            "signature_hex": signature.hex(),
            "signature_base64url": base64url(signature),
            "request_ranges_wire_hex": range_wire(
                fields["revealed_request_ranges"]
            ).hex(),
            "response_ranges_wire_hex": range_wire(
                fields["revealed_response_ranges"]
            ).hex(),
            "result_signer_key_id": signer["key_id"],
            "result_signer_public_key_raw_hex": raw_public_key.hex(),
            "result_signer_public_key_spki_hex": spki.hex(),
        },
    }


def receipt_signing_bytes(domain, fields):
    output = bytearray(domain)
    output.extend(b"\x00\x01")
    for name in fields:
        output.extend(length_prefixed(fields[name].encode("ascii")))
    return bytes(output)


def make_receipt_vector(
    vector_id,
    contract,
    receipt_type,
    domain,
    signed_fields,
    signing_field_order,
    registry_scope,
    authority_role,
    seed,
    session,
    user_id,
    device_auth_nonce=None,
    presentation_raw=None,
):
    key_id = signed_fields["signer_key_id"]
    registry_placeholder = {"keys": []}
    spki, raw_public_key, _ = ed25519_material_and_signature(
        seed, b"FUSOU-P010-RECEIPT-KEY-CHECK"
    )
    registry_placeholder["keys"].append(
        {
            "key_id": key_id,
            "public_key_spki": base64url(spki),
            "status": "ACTIVE",
            "not_before": NOT_BEFORE,
            "not_after": None,
        }
    )
    registry = {
        "schema_version": 1,
        "scope": registry_scope,
        "keys": registry_placeholder["keys"],
    }
    registry_raw = compact_json(registry)
    signing_bytes = receipt_signing_bytes(domain, signed_fields)
    spki_after, raw_public_after, signature = ed25519_material_and_signature(
        seed, signing_bytes
    )
    if (spki_after, raw_public_after) != (spki, raw_public_key):
        raise ValueError("receipt authority key changed during vector generation")

    receipt = {
        "schema_version": 1,
        "type": receipt_type,
        "signature_algorithm": "Ed25519",
    }
    receipt.update(signed_fields)
    receipt["signature"] = base64url(signature)
    receipt_raw = compact_json(receipt)
    context = {
        "session_json_utf8": compact_json(session).decode("ascii"),
        "canonical_user_id": user_id,
    }
    if device_auth_nonce is not None:
        context["device_auth_nonce"] = device_auth_nonce
    if presentation_raw is not None:
        context["presentation_raw_hex"] = presentation_raw.hex()
        context["presentation_id"] = base64url(hashlib.sha256(presentation_raw).digest())

    return {
        "vector_id": vector_id,
        "contract": contract,
        "authority_role": authority_role,
        "test_only": True,
        "signer": {
            "key_id": key_id,
            "public_key_raw_hex": raw_public_key.hex(),
            "public_key_spki_hex": spki.hex(),
            "registry_scope": registry_scope,
            "registry_json_utf8": registry_raw.decode("ascii"),
            "registry_sha256_hex": hashlib.sha256(registry_raw).hexdigest(),
        },
        "input": {
            "receipt_json_utf8": receipt_raw.decode("ascii"),
            **context,
        },
        "expected": {
            "receipt_json_sha256_hex": hashlib.sha256(receipt_raw).hexdigest(),
            "session_json_sha256_hex": hashlib.sha256(
                context["session_json_utf8"].encode("ascii")
            ).hexdigest(),
            "signing_bytes_hex": signing_bytes.hex(),
            "signing_bytes_sha256_hex": hashlib.sha256(signing_bytes).hexdigest(),
            "signature_hex": signature.hex(),
            "signature_base64url": base64url(signature),
            "signing_field_order": signing_field_order,
        },
    }


def invalid_result_json_cases(vector):
    source = vector["input"]["result_json_utf8"].encode("ascii")
    fields = json.loads(source)
    contract = vector["contract"]
    version = fields["version"]
    cases = []

    def add(case_id, raw, reason):
        cases.append(
            {
                "case_id": f"{vector['vector_id']}.{case_id}",
                "vector_id": vector["vector_id"],
                "contract": contract,
                "raw_json_hex": raw.hex(),
                "expected": "reject",
                "reason": reason,
            }
        )

    version_field = f'"version":{version},'.encode("ascii")
    add("unknown-field", source.replace(version_field, version_field + b'"unknown":1,', 1),
        "unknown Result fields are rejected")
    add("duplicate-version", source.replace(version_field, version_field + version_field, 1),
        "duplicate Result fields are rejected")
    add("leading-whitespace", b" " + source, "Result JSON must be byte-canonical")
    add("trailing-byte", source + b"x", "trailing Result bytes are rejected")
    add(
        "version-decimal",
        source.replace(version_field, f'"version":{version}.0,'.encode("ascii"), 1),
        "the version token must be the exact integer literal",
    )
    missing_field = copy.deepcopy(fields)
    del missing_field["verified_member_id"]
    add("missing-field", compact_json(missing_field), "required Result fields cannot be omitted")

    reordered = dict(list(fields.items())[1:2] + list(fields.items())[:1] + list(fields.items())[2:])
    add("field-order", compact_json(reordered),
        "Result fields must remain in the defined canonical order")

    padded = copy.deepcopy(fields)
    padded["profile_sha256"] += "="
    add("padded-base64url", compact_json(padded),
        "Result base64url fields reject padding")

    escaped = source.replace(
        f'"profile_id":"{fields["profile_id"]}"'.encode("ascii"),
        (
            f'"profile_id":"{fields["profile_id"].replace("r", r"\u0072", 1)}"'
        ).encode("ascii"),
        1,
    )
    add("escaped-string", escaped, "Result strings must use the exact unescaped canonical form")

    wrong_version = copy.deepcopy(fields)
    wrong_version["version"] = 3 if version == 2 else 2
    add("wrong-result-version", compact_json(wrong_version),
        "Complete and Sparse Result versions are not interchangeable")

    uppercase_uuid = copy.deepcopy(fields)
    uppercase_uuid["canonical_user_id"] = fields["canonical_user_id"].upper()
    add("uppercase-uuid", compact_json(uppercase_uuid),
        "UUID strings must be lowercase canonical text")

    bad_length = copy.deepcopy(fields)
    bad_length["revealed_request_ranges"][0]["length"] = str(
        int(bad_length["revealed_request_ranges"][0]["length"]) + 1
    )
    add("range-length-mismatch", compact_json(bad_length),
        "range byte length must equal the declared range length")

    out_of_bounds = copy.deepcopy(fields)
    out_of_bounds["request_transcript_size"] = "3"
    add("range-out-of-bounds", compact_json(out_of_bounds),
        "range end must not exceed the transcript size")

    binding_mismatch = copy.deepcopy(fields)
    binding_mismatch["binding_nonce"] = base64url(bytes([0x43]) * 32)
    add("binding-value-mismatch", compact_json(binding_mismatch),
        "binding nonce must match the decoded binding value")

    approval_pair_mismatch = copy.deepcopy(fields)
    approval_pair_mismatch["target_approval_artifact_sha256"] = None
    add("production-digest-pair-mismatch", compact_json(approval_pair_mismatch),
        "Origin Inventory and Target Approval digests are present together")

    invalid_utf8 = source.replace(
        fields["profile_id"].encode("ascii"),
        b"\xff" + fields["profile_id"][1:].encode("ascii"),
        1,
    )
    add("invalid-utf8", invalid_utf8, "Result input must be valid UTF-8")

    if contract == "sparse-result-v3":
        overlap = copy.deepcopy(fields)
        overlap["revealed_request_ranges"][1]["start"] = str(
            int(overlap["revealed_request_ranges"][0]["start"]) + 2
        )
        add("overlapping-ranges", compact_json(overlap),
            "authenticated ranges must not overlap")
        out_of_order = copy.deepcopy(fields)
        out_of_order["revealed_request_ranges"][1]["start"] = (
            out_of_order["revealed_request_ranges"][0]["start"]
        )
        add("nonascending-ranges", compact_json(out_of_order),
            "range starts must be strictly ascending")
    return cases


def build_corpus():
    result_seed = RFC8032_SEED
    result_spki, result_public_raw, _ = ed25519_material_and_signature(
        result_seed, b"FUSOU-P010-RFC8032-key-check"
    )
    if result_public_raw != RFC8032_PUBLIC_KEY:
        raise ValueError("OpenSSL public key does not match RFC 8032 Test Vector 1")
    empty_signature = RFC8032_EMPTY_MESSAGE_SIGNATURE

    result_signer = {
        "seed": result_seed,
        "spki": result_spki,
        "key_id": "p010-result-signer-test-v1",
    }
    binding_nonce = bytes([0x42]) * 32
    bind = binding_value(SESSION_ID, binding_nonce)
    device_challenge = base64url(bytes([0x08]) * 32)
    presentation_raw = b"test-only Presentation digest input; not a TLSN Presentation"
    common = {
        "profile_sha256": base64url(bytes([0x01]) * 32),
        "issuer": "fusou-tlsn-verifier",
        "proof_purpose": "GAME_ACCOUNT_IDENTITY_V1",
        "canonical_user_id": USER_ID,
        "device_id": DEVICE_ID,
        "device_challenge": device_challenge,
        "verified_member_id": "16189463",
        "attestation_session_id": SESSION_ID,
        "binding_nonce": base64url(binding_nonce),
        "binding_value": bind,
        "verifier_key_id": result_signer["key_id"],
        "notary_key_id": "p010-notary-test-v1",
        "tlsn_attestation_id": base64url(bytes([0x11]) * 16),
        "presentation_sha256": base64url(hashlib.sha256(presentation_raw).digest()),
        "server_identity": "game.example.test",
        "origin_inventory_sha256": base64url(bytes([0x31]) * 32),
        "target_approval_artifact_sha256": base64url(bytes([0x32]) * 32),
    }

    request = b"POST"
    response = b"HTTP/1.1 200 OK\r\n\r\n"
    complete_fields = {
        "version": 2,
        "profile_id": "fusou-require-info-v1",
        **common,
        "request_transcript_size": str(len(request)),
        "request_transcript_sha256": base64url(hashlib.sha256(request).digest()),
        "response_transcript_size": str(len(response)),
        "response_transcript_sha256": base64url(hashlib.sha256(response).digest()),
        "revealed_request_ranges": [
            {"start": "0", "length": str(len(request)), "bytes": base64url(request)}
        ],
        "revealed_response_ranges": [
            {"start": "0", "length": str(len(response)), "bytes": base64url(response)}
        ],
    }
    complete_vector = make_result_vector(
        "complete-result-v2-001",
        "complete-result-v2",
        complete_fields,
        request,
        response,
        result_signer,
    )

    sparse_fields = {
        "version": 3,
        "profile_id": "fusou-require-info-v2-sparse",
        "disclosure_mode": "sparse",
        "profile_sha256": common["profile_sha256"],
        "issuer": common["issuer"],
        "proof_purpose": common["proof_purpose"],
        "canonical_user_id": common["canonical_user_id"],
        "device_id": common["device_id"],
        "device_challenge": common["device_challenge"],
        "verified_member_id": common["verified_member_id"],
        "attestation_session_id": common["attestation_session_id"],
        "binding_nonce": common["binding_nonce"],
        "binding_value": common["binding_value"],
        "verifier_key_id": common["verifier_key_id"],
        "notary_key_id": common["notary_key_id"],
        "notary_key_sha256": base64url(bytes([0x02]) * 32),
        "tlsn_attestation_id": common["tlsn_attestation_id"],
        "presentation_sha256": common["presentation_sha256"],
        "server_identity": common["server_identity"],
        "origin_inventory_sha256": common["origin_inventory_sha256"],
        "target_approval_artifact_sha256": common["target_approval_artifact_sha256"],
        "request_transcript_size": "12",
        "response_transcript_size": "20",
        "revealed_request_ranges": [
            {"start": "1", "length": "3", "bytes": base64url(b"GET")},
            {"start": "7", "length": "2", "bytes": base64url(b" /")},
        ],
        "revealed_response_ranges": [
            {"start": "0", "length": "4", "bytes": base64url(b"HTTP")},
            {"start": "12", "length": "2", "bytes": base64url(b"OK")},
        ],
    }
    sparse_vector = make_result_vector(
        "sparse-result-v3-001",
        "sparse-result-v3",
        sparse_fields,
        None,
        None,
        result_signer,
    )

    result_registry = {
        "schema_version": 1,
        "scope": "tlsn-result-signing-key-registry",
        "keys": [
            {
                "key_id": result_signer["key_id"],
                "public_key_spki": base64url(result_spki),
                "status": "ACTIVE",
                "not_before": NOT_BEFORE,
                "not_after": None,
            }
        ],
    }
    result_registry_raw = compact_json(result_registry)

    session_authority_seed = hashlib.sha256(
        b"FUSOU P0-10 session authority test-only seed v1"
    ).digest()
    binding_authority_seed = hashlib.sha256(
        b"FUSOU P0-10 binding authority test-only seed v1"
    ).digest()
    challenge_nonce = base64url(binding_nonce)
    device_auth_nonce = base64url(bytes([0x0A]) * 32)
    authority_session = {
        "session_id": SESSION_ID,
        "device_id": DEVICE_ID,
        "challenge": challenge_nonce,
        "device_challenge": device_challenge,
        "binding": bind,
        "expires_at": SESSION_EXPIRES_AT,
    }

    session_signed_fields = {
        "signer_key_id": "p010-session-authority-test-v1",
        "session_id": SESSION_ID,
        "canonical_user_id": USER_ID,
        "device_id": DEVICE_ID,
        "device_auth_nonce": device_auth_nonce,
        "nonce": challenge_nonce,
        "device_challenge": device_challenge,
        "binding_value": bind,
        "created_at": SESSION_CREATED_AT,
        "expires_at": SESSION_EXPIRES_AT,
    }
    session_receipt = make_receipt_vector(
        "session-receipt-v1-001",
        "session-receipt-v1",
        "attestation-session-issued",
        b"FUSOU-ATTESTATION-SESSION-V1\0",
        session_signed_fields,
        list(session_signed_fields),
        "tlsn-session-authority-key-registry",
        "test-only Session Authority",
        session_authority_seed,
        authority_session,
        USER_ID,
        device_auth_nonce=device_auth_nonce,
    )

    consume_signed_fields = {
        "signer_key_id": "p010-binding-authority-test-v1",
        "session_id": SESSION_ID,
        "canonical_user_id": USER_ID,
        "device_id": DEVICE_ID,
        "nonce": challenge_nonce,
        "binding_value": bind,
        "presentation_id": base64url(hashlib.sha256(presentation_raw).digest()),
        "used_at": CONSUMED_AT,
    }
    consume_receipt = make_receipt_vector(
        "consume-receipt-v1-001",
        "consume-receipt-v1",
        "attestation-binding-consumed",
        b"FUSOU-ATTESTATION-CONSUME-V1\0",
        consume_signed_fields,
        list(consume_signed_fields),
        "tlsn-binding-authority-key-registry",
        "test-only Binding Authority",
        binding_authority_seed,
        authority_session,
        USER_ID,
        presentation_raw=presentation_raw,
    )

    rejection_vectors = []
    for vector in (complete_vector, sparse_vector):
        rejection_vectors.extend(invalid_result_json_cases(vector))

    receipt_rejections = [
        {
            "case_id": "session-receipt.session-id-mismatch",
            "vector_id": session_receipt["vector_id"],
            "target": "session",
            "field": "session_id",
            "replacement": "123e4567-e89b-42d3-a456-426614174001",
            "expected": "reject",
            "reason": "receipt Session ID must equal the Session authority value",
        },
        {
            "case_id": "session-receipt.invalid-utc-created-at",
            "vector_id": session_receipt["vector_id"],
            "target": "receipt",
            "field": "created_at",
            "replacement": "2026-10-15T00:00:00Z",
            "expected": "reject",
            "reason": "authority key lookup requires the existing fixed millisecond UTC form",
        },
        {
            "case_id": "session-receipt.signed-created-at-mutation",
            "vector_id": session_receipt["vector_id"],
            "target": "receipt",
            "field": "created_at",
            "replacement": "2026-10-15T00:01:00.000Z",
            "expected": "reject",
            "reason": "created_at is part of the Session receipt signing preimage",
        },
        {
            "case_id": "consume-receipt.presentation-id-mismatch",
            "vector_id": consume_receipt["vector_id"],
            "target": "receipt",
            "field": "presentation_id",
            "replacement": base64url(hashlib.sha256(b"mutated Presentation input").digest()),
            "expected": "reject",
            "reason": "consume receipt Presentation ID must match the supplied Presentation digest",
        },
        {
            "case_id": "consume-receipt.signed-used-at-mutation",
            "vector_id": consume_receipt["vector_id"],
            "target": "receipt",
            "field": "used_at",
            "replacement": "2026-10-15T00:31:00.000Z",
            "expected": "reject",
            "reason": "used_at is part of the consume receipt signing preimage",
        },
    ]

    return {
        "corpus_version": 1,
        "corpus_id": "fusou-p0-10-cross-language-v1",
        "scope": "test-only implementation interoperability vectors; not a Production trust anchor or protocol-owner approval",
        "generator": {
            "path": "packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py",
            "python_version": "3.12.3",
            "openssl_version": OPENSSL_VERSION,
            "expected_result_encoding": "independent Python standard-library struct/JSON encoder; Ed25519 signatures produced by OpenSSL CLI",
            "source_contract_commit": SOURCE_CONTRACT_COMMIT,
            "regenerate": "/bin/python3 packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py",
            "verify_without_writing": "/bin/python3 packages/FUSOU-TLSN-VERIFIER/tools/generate_p010_corpus.py --check",
        },
        "primitive_reference": {
            "id": "rfc8032-ed25519-test-vector-1",
            "source": "https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1",
            "message_hex": "",
            "public_key_raw_hex": result_public_raw.hex(),
            "signature_hex": empty_signature.hex(),
            "role": "Ed25519 primitive test vector only; not a FUSOU authority key",
        },
        "result_signer": {
            "test_only": True,
            "role": "Result signing key used only for Complete/Sparse Result byte vectors",
            "key_id": result_signer["key_id"],
            "public_key_raw_hex": result_public_raw.hex(),
            "public_key_spki_hex": result_spki.hex(),
            "registry_json_utf8": result_registry_raw.decode("ascii"),
            "registry_sha256_hex": hashlib.sha256(result_registry_raw).hexdigest(),
            "registry_sha256_base64url": base64url(hashlib.sha256(result_registry_raw).digest()),
            "registry_root": "not included; this direct test-only registry is not a Production trust chain",
        },
        "capture_time": CAPTURE_TIME,
        "vectors": [complete_vector, sparse_vector, session_receipt, consume_receipt],
        "result_rejection_vectors": rejection_vectors,
        "receipt_rejection_cases": receipt_rejections,
        "unresolved_contracts": [
            {
                "contract": "ClaimBindingBytes",
                "status": "UNRESOLVED",
                "reason": "The older trusted-battle document has an eight-input layout while the current member-id specification has an eleven-input layout; no executable Rust/Node serializer and no owner-approved shared golden were found.",
                "required_evidence": "One approved normative field layout, encoding/version rule, and an independently generated byte/signature vector.",
            },
            {
                "contract": "TLSN alpha.15 packed sparse Presentation wire bytes",
                "status": "UNRESOLVED",
                "reason": "The FUSOU-local packed transcript/proof path is Rust-only; the Result range vectors here cover the separate Result signing representation, not a serialized sparse Presentation.",
                "required_evidence": "An approved local-fork wire contract, a valid source-identified sparse Presentation fixture, and an independent Node decoder/verifier.",
            },
            {
                "contract": "Receipt JSON field inventory and canonicalization",
                "status": "UNRESOLVED",
                "reason": "The current verifier signs defined receipt fields but does not define a canonical receipt JSON serialization or reject unknown JSON fields as a separate contract.",
                "required_evidence": "An approved envelope field-inventory/canonicalization rule before adding rejection requirements.",
            },
        ],
        "result_registry_envelope": {
            "status": "separate-test-item",
            "fixture": "packages/FUSOU-TLSN-VERIFICATION-WORKER/scripts/fixtures/tlsn-runtime-config-independent-v2-vector.json",
            "scope": "outer Result Registry root envelope only; never substitutes for Result v2/v3 inner signatures",
        },
        "positive_production_fixture": {
            "status": "NOT_AVAILABLE",
            "reason": "The checked-in alpha.15 Presentation is not a FUSOU require_info proof; existing synthetic tests are not a Production-shaped Evidence Bundle or independent raw golden.",
        },
        "vectors_count": 4,
        "result_rejection_vectors_count": len(rejection_vectors),
        "receipt_rejection_cases_count": len(receipt_rejections),
        "full_p0_10_status": "UNRESOLVED",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    arguments = parser.parse_args()
    corpus = build_corpus()
    serialized = json.dumps(corpus, indent=2, ensure_ascii=True).encode("ascii") + b"\n"
    if arguments.check:
        existing = OUTPUT_PATH.read_bytes()
        if existing != serialized:
            raise SystemExit(f"corpus differs from independent generator output: {OUTPUT_PATH}")
        print(f"verified {OUTPUT_PATH}")
        return
    OUTPUT_PATH.write_bytes(serialized)
    print(f"wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
