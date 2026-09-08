import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { consumeReceiptSigningBytes, sessionReceiptSigningBytes } from "./device-evidence.mjs";
import {
  createSignedProductionEvidenceManifest,
  resultSigningBytes,
} from "./production-evidence.mjs";

function privateKeyFromPkcs8(value, label) {
  const key = createPrivateKey({
    key: Buffer.from(value, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${label} must be Ed25519`);
  return key;
}

function publicKeySpki(privateKey) {
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64url");
}

class RoleSigner {
  constructor({ keyId, privateKeyPkcs8, publicKeySpki: expectedPublicKeySpki, role }) {
    if (typeof keyId !== "string" || keyId.length === 0) throw new Error(`${role} key ID is required`);
    this.keyId = keyId;
    this.role = role;
    this.privateKey = privateKeyFromPkcs8(privateKeyPkcs8, `${role} private key`);
    if (expectedPublicKeySpki && publicKeySpki(this.privateKey) !== expectedPublicKeySpki) {
      throw new Error(`${role} key pair does not match`);
    }
  }

  signProtocolBytes(bytes) {
    return sign(null, bytes, this.privateKey).toString("base64url");
  }
}

export class SessionAuthority extends RoleSigner {
  constructor(options) {
    super({ ...options, role: "Session Authority" });
  }

  signSessionReceipt(receipt) {
    if (receipt?.type !== "attestation-session-issued" || receipt.signer_key_id !== this.keyId) {
      throw new Error("Session Authority received a non-session receipt or foreign signer identity");
    }
    return {
      ...receipt,
      signature: this.signProtocolBytes(sessionReceiptSigningBytes(receipt)),
    };
  }
}

export class BindingAuthority extends RoleSigner {
  constructor(options) {
    super({ ...options, role: "Binding Authority" });
  }

  signConsumeReceipt(receipt) {
    if (receipt?.type !== "attestation-binding-consumed" || receipt.signer_key_id !== this.keyId) {
      throw new Error("Binding Authority received a non-consume receipt or foreign signer identity");
    }
    return {
      ...receipt,
      signature: this.signProtocolBytes(consumeReceiptSigningBytes(receipt)),
    };
  }
}

export class ResultSigner extends RoleSigner {
  constructor(options) {
    super({ ...options, role: "Result Signer" });
  }

  signResult(result) {
    if (!result || result.signature !== undefined) throw new Error("Result Signer requires an unsigned Result");
    return {
      ...result,
      signature: this.signProtocolBytes(resultSigningBytes(result)),
    };
  }
}

export class EvidenceSigner extends RoleSigner {
  constructor(options) {
    super({ ...options, role: "Production Evidence Signer" });
  }

  signManifest(manifest) {
    return createSignedProductionEvidenceManifest({
      manifest,
      signerKeyId: this.keyId,
      signerPublicKeySpki: publicKeySpki(this.privateKey),
      signingPrivateKeyPkcs8: Buffer.from(this.privateKey.export({ format: "der", type: "pkcs8" })).toString("base64url"),
    });
  }
}

export class RemoteAttestationSigner extends RoleSigner {
  constructor(options) {
    super({ ...options, role: "Remote Attestation Signer" });
  }

  signAttestationPayload(payloadBytes) {
    if (!Buffer.isBuffer(payloadBytes) && !(payloadBytes instanceof Uint8Array)) {
      throw new Error("Remote Attestation Signer requires canonical payload bytes");
    }
    return {
      signer_key_id: this.keyId,
      signature: this.signProtocolBytes(payloadBytes),
    };
  }
}
