
export type SynergyPayloadValidationIssue =
  | "decode"
  | "invalid_json"
  | "root_not_object"
  | "hash_mismatch";

type SupportedCompressionFormat =
  | "gzip"
  | "deflate"
  | "deflate-raw"
  | "br";

async function decompressWithStream(
  body: Uint8Array,
  format: SupportedCompressionFormat,
): Promise<Uint8Array> {
  const DS = (
    globalThis as unknown as {
      DecompressionStream?: new (
        format: SupportedCompressionFormat,
      ) => DecompressionStream;
    }
  ).DecompressionStream;

  if (!DS) {
    throw new Error("DecompressionStream is not available in this runtime");
  }

  const ds = new DS(format);
  const backing = body.buffer;
  const bytes =
    body.byteOffset === 0 && body.byteLength === backing.byteLength
      ? (backing as ArrayBuffer)
      : (backing.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength,
        ) as ArrayBuffer);
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

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
  if (format === "gzip") {
    return await decompressWithStream(body, "gzip");
  }

  try {
    return await decompressWithStream(body, "br");
  } catch (streamErr) {
    // Fallback for Node-based environments where DecompressionStream("br") may
    // be unavailable: try node:zlib dynamically.
    try {
      const { promisify } = await import("node:util");
      const { brotliDecompress } = await import("node:zlib");
      const brotliDecompressAsync = promisify(brotliDecompress);
      const out = await brotliDecompressAsync(body);
      return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
    } catch {
      throw streamErr;
    }
  }
}

function firstNonWhitespaceByte(body: Uint8Array): number {
  let i = 0;
  // Skip UTF-8 BOM if present
  if (
    body.length >= 3 &&
    body[0] === 0xef &&
    body[1] === 0xbb &&
    body[2] === 0xbf
  ) {
    i = 3;
  }
  while (i < body.length) {
    const b = body[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i++;
      continue;
    }
    return b ?? -1;
  }
  return -1;
}

function looksLikeJsonPrefix(body: Uint8Array): boolean {
  const b = firstNonWhitespaceByte(body);
  return (
    b === 0x7b || // '{'
    b === 0x5b || // '['
    b === 0x22 || // '"'
    b === 0x2d || // '-'
    (b >= 0x30 && b <= 0x39) || // '0'-'9'
    b === 0x74 || // 't'
    b === 0x66 || // 'f'
    b === 0x6e // 'n'
  );
}

export async function decodeSynergyPayload(
  body: Uint8Array,
): Promise<Uint8Array> {
  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    return await decompressBytes(body, "gzip");
  }

  // Fast-path: plain JSON payload (only attempt decode when leading byte can start JSON).
  if (looksLikeJsonPrefix(body)) {
    try {
      JSON.parse(new TextDecoder().decode(body));
      return body;
    } catch {
      // Not plain JSON (or a Brotli payload that coincidentally starts with a JSON token);
      // fall through to Brotli decompression.
    }
  }

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

/**
 * Lightweight decode + SHA-256 verification for serving already-validated
 * completed payloads without allocating a full V8 JSON object tree on every GET.
 */
export async function decodeAndVerifySynergyPayload(
  body: Uint8Array,
  expectedSha256?: string,
): Promise<{
  decoded: Uint8Array;
  actualSha256: string;
}> {
  const normalizedExpected = expectedSha256?.toLowerCase();
  let decoded: Uint8Array;

  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    try {
      decoded = await decompressBytes(body, "gzip");
    } catch (error) {
      throw new SynergyPayloadValidationError(
        "decode",
        "failed to decode gzip synergy payload",
        String(error),
      );
    }
  } else if (firstNonWhitespaceByte(body) === 0x7b) {
    // Likely plain JSON object; verify hash directly without JSON.parse.
    const rawHash = (await sha256Hex(body)).toLowerCase();
    if (!normalizedExpected || rawHash === normalizedExpected) {
      return { decoded: body, actualSha256: rawHash };
    }
    // Hash mismatch: could be a Brotli stream coincidentally starting with '{'.
    try {
      decoded = await decompressBytes(body, "br");
    } catch {
      throw new SynergyPayloadValidationError(
        "hash_mismatch",
        "synergy payload hash mismatch",
        undefined,
        normalizedExpected,
        rawHash,
      );
    }
  } else if (body.length > 0) {
    try {
      decoded = await decompressBytes(body, "br");
    } catch (error) {
      throw new SynergyPayloadValidationError(
        "decode",
        "failed to decode synergy payload",
        String(error),
      );
    }
  } else {
    throw new SynergyPayloadValidationError(
      "invalid_json",
      "synergy payload is empty",
    );
  }

  if (firstNonWhitespaceByte(decoded) !== 0x7b) {
    throw new SynergyPayloadValidationError(
      "root_not_object",
      "synergy payload root must be a JSON object",
    );
  }

  const actualSha256 = (await sha256Hex(decoded)).toLowerCase();
  if (normalizedExpected && actualSha256 !== normalizedExpected) {
    throw new SynergyPayloadValidationError(
      "hash_mismatch",
      "synergy payload hash mismatch",
      undefined,
      normalizedExpected,
      actualSha256,
    );
  }

  return { decoded, actualSha256 };
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
  let parsed: unknown;
  let hasParsed = false;

  if (body.length >= 2 && body[0] === 0x1f && body[1] === 0x8b) {
    try {
      decoded = await decompressBytes(body, "gzip");
    } catch (error) {
      throw new SynergyPayloadValidationError(
        "decode",
        "failed to decode synergy payload",
        String(error),
      );
    }
  } else if (looksLikeJsonPrefix(body)) {
    // Parse ONCE on plain-JSON fast path (eliminates duplicate JSON.parse).
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
      decoded = body;
      hasParsed = true;
    } catch {
      // Fall back to Brotli if payload coincidentally began with a JSON token.
      try {
        decoded = await decompressBytes(body, "br");
      } catch {
        decoded = body;
      }
    }
  } else if (body.length > 0) {
    try {
      decoded = await decompressBytes(body, "br");
    } catch {
      decoded = body;
    }
  } else {
    decoded = body;
  }

  if (!hasParsed) {
    try {
      parsed = JSON.parse(new TextDecoder().decode(decoded));
    } catch (error) {
      throw new SynergyPayloadValidationError(
        "invalid_json",
        "synergy payload is not valid JSON",
        String(error),
      );
    }
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
