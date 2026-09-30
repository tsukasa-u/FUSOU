import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { canaryVerifierExecutionKeyPairMatches } from "../src/verifier_identity.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const { publicKey: otherPublicKey } = generateKeyPairSync("ed25519");
const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const otherPublicKeySpki = otherPublicKey.export({ format: "der", type: "spki" }).toString("base64url");

assert.equal(await canaryVerifierExecutionKeyPairMatches(privateKeyPkcs8, publicKeySpki), true);
assert.equal(await canaryVerifierExecutionKeyPairMatches(privateKeyPkcs8, otherPublicKeySpki), false);
assert.equal(await canaryVerifierExecutionKeyPairMatches(undefined, publicKeySpki), false);
assert.equal(await canaryVerifierExecutionKeyPairMatches("invalid", publicKeySpki), false);

console.log("[tlsn-canary-verifier-health] matching keypair required for healthy Canary identity PASS");