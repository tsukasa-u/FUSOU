type CanonicalJsonValue =
  | null
  | string
  | number
  | boolean
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function normalizeKeyMaterial(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY is empty");
  }

  if (trimmed.includes("-----BEGIN")) {
    return trimmed;
  }

  const normalizedB64 = normalizeBase64(trimmed);
  if (!normalizedB64) {
    throw new Error(
      "ATTESTATION_CONFIG_SIGNING_PRIVATE_KEY must be PEM or base64 PKCS8 DER",
    );
  }

  const lines = normalizedB64.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

function normalizeBase64(raw: string): string | null {
  try {
    const binary = atob(raw);
    let out = "";
    for (let i = 0; i < binary.length; i += 1) {
      out += String.fromCharCode(binary.charCodeAt(i));
    }
    return btoa(out);
  } catch {
    return null;
  }
}

function canonicalizeValue(value: CanonicalJsonValue): string {
  if (value === null) return "null";

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Attestation config contains non-finite number");
    }
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeValue).join(",")}]`;
  }

  const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalizeValue(value[key]!)}`)
    .join(",")}}`;
}

export function canonicalizeAttestationConfig(value: CanonicalJsonValue): string {
  return canonicalizeValue(value);
}

export function signAttestationConfig(
  canonicalConfigJson: string,
  privateKeyMaterial: string,
): Promise<string> {
  return (async () => {
    const privateKeyPem = normalizeKeyMaterial(privateKeyMaterial);
    const pkcs8Der = decodePem(privateKeyPem);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8Der,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      new TextEncoder().encode(canonicalConfigJson),
    );
    return arrayBufferToBase64(signature);
  })();
}

function decodePem(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
