import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";

export type SynergyPayloadValidationIssue =
  | "decode"
  | "invalid_json"
  | "root_not_object"
  | "hash_mismatch";

const brotliDecompressAsync = promisify(brotliDecompress);

export class SynergyPayloadValidationError extends Error {
  constructor(
    readonly issue: SynergyPayloadValidationIssue,
    message: string,
    readonly detail?: string,
    readonly expectedSha256?: string,
    readonly actualSha256?: string,
  ) {
    super(message);
    this.name = "SynergyPayloadValidationError";
  }
}

async function decompressBytes(
  body: Uint8Array,
  format: "gzip" | "br",
): Promise<Uint8Array> {
  if (format === "br") {
    const out = await brotliDecompressAsync(body);
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  }

  const ds = new DecompressionStream(format as CompressionFormat);
  const ab = new Uint8Array(body).buffer;
  const stream = new Blob([ab]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

export async function decodeSynergyPayload(
  body: Uint8Array,
): Promise<Uint8Array> {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    return await decompressBytes(body, "gzip");
  }

  // Fast-path: plain JSON payload.
  try {
    JSON.parse(new TextDecoder().decode(body));
    return body;
  } catch {
    // Not plain JSON; try Brotli fallback next.
  }

  // Some Brotli payloads can coincidentally start with JSON-like bytes.
  // Always attempt Brotli fallback when plain JSON parse failed.
  if (body.length > 0) {
    try {
      return await decompressBytes(body, "br");
    } catch {
      // not brotli; fall through as-is
    }
  }

  return body;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateSynergyPayload(
  body: Uint8Array,
  expectedSha256?: string,
): Promise<{
  decoded: Uint8Array;
  parsed: Record<string, unknown>;
  actualSha256: string;
}> {
  let decoded: Uint8Array;
  try {
    decoded = await decodeSynergyPayload(body);
  } catch (error) {
    throw new SynergyPayloadValidationError(
      "decode",
      "failed to decode synergy payload",
      String(error),
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decoded));
  } catch (error) {
    throw new SynergyPayloadValidationError(
      "invalid_json",
      "synergy payload is not valid JSON",
      String(error),
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SynergyPayloadValidationError(
      "root_not_object",
      "synergy payload root must be a JSON object",
    );
  }

  const actualSha256 = (await sha256Hex(decoded)).toLowerCase();
  if (expectedSha256 && actualSha256 !== expectedSha256.toLowerCase()) {
    throw new SynergyPayloadValidationError(
      "hash_mismatch",
      "synergy payload hash mismatch",
      undefined,
      expectedSha256.toLowerCase(),
      actualSha256,
    );
  }

  return {
    decoded,
    parsed: parsed as Record<string, unknown>,
    actualSha256,
  };
}
