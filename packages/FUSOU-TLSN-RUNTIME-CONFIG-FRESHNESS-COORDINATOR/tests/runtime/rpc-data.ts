// Test transport only: preserve DTO bytes without exporting RPC capabilities to Node.
export const RUNTIME_RPC_PATH = "/_test/coordinator/rpc";
export const MAX_RUNTIME_RPC_REQUEST_BYTES = 8 * 1024 * 1024;

export function encodeRuntimeRpcValue(value: unknown): unknown {
  if (value === undefined) return ["undefined"];
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return ["value", value];
  }
  if (typeof value === "number" && Number.isFinite(value)) return ["value", value];
  if (value instanceof Uint8Array) return ["bytes", encodeBytes(value)];
  if (value instanceof ArrayBuffer) {
    return ["buffer", encodeBytes(new Uint8Array(value))];
  }
  if (Array.isArray(value)) return ["array", value.map(encodeRuntimeRpcValue)];
  if (value !== null && typeof value === "object") {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Runtime RPC result must contain only data values");
    }
    return ["object", Object.entries(value).map(([key, entry]) =>
      [key, encodeRuntimeRpcValue(entry)]
    )];
  }
  throw new TypeError("Runtime RPC transport cannot export a capability");
}

export function decodeRuntimeRpcValue(encoded: unknown): unknown {
  if (!Array.isArray(encoded)) throw new TypeError("Invalid runtime RPC encoding");
  const [tag, value] = encoded;
  if (tag === "undefined" && encoded.length === 1) return undefined;
  if (encoded.length !== 2) throw new TypeError("Invalid runtime RPC tuple");
  if (tag === "value" && (value === null || typeof value === "string" ||
    typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)))) {
    return value;
  }
  if ((tag === "bytes" || tag === "buffer") && typeof value === "string") {
    const bytes = decodeBytes(value);
    return tag === "bytes" ? bytes : bytes.buffer;
  }
  if (tag === "array" && Array.isArray(value)) return value.map(decodeRuntimeRpcValue);
  if (tag === "object" && Array.isArray(value)) {
    const keys = new Set<string>();
    const entries: [string, unknown][] = value.map((entry: unknown) => {
      if (!Array.isArray(entry) || entry.length !== 2 ||
        typeof entry[0] !== "string" || keys.has(entry[0])) {
        throw new TypeError("Invalid runtime RPC object entry");
      }
      keys.add(entry[0]);
      return [entry[0], decodeRuntimeRpcValue(entry[1])];
    });
    return Object.fromEntries(entries);
  }
  throw new TypeError("Invalid runtime RPC value");
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  if (btoa(binary) !== value) throw new TypeError("Noncanonical runtime RPC bytes");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
