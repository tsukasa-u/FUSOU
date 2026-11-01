import { parseOcfHeader } from "./avro.js";

export interface MergeResult {
  merged: Uint8Array;
  boundaries: Array<{ sourceIndex: number; startByte: number; length: number }>;
  headerSize: number;
}

export interface MergeAvroOptions {
  /**
   * When true (default for null-codec OCFs), consolidates multiple uncompressed
   * Avro data blocks within each source slice into a single data block, stripping
   * redundant intermediate block framing and 16-byte sync markers.
   */
  reblock?: boolean;
}

export * from "./avro.js";

interface OCFHeader {
  metadataEnd: number;
  syncMarker: Uint8Array;
  codec: string;
}

const TEXT_DECODER = new TextDecoder();

function readZigzagVarInt(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (offset >= data.byteLength) {
    throw new Error("Cannot read varint: offset exceeds buffer");
  }

  let raw = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset + bytesRead < data.byteLength && bytesRead < 10) {
    const byte = data[offset + bytesRead];
    if (byte === undefined) {
      throw new Error("Cannot read varint: byte is missing");
    }
    bytesRead += 1;
    raw |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      const decoded = raw % 2n === 0n ? raw / 2n : -(raw + 1n) / 2n;
      const value = Number(decoded);
      if (!Number.isSafeInteger(value)) {
        throw new Error("Varint exceeds safe integer range");
      }
      return { value, bytesRead };
    }
    shift += 7n;
  }

  throw new Error("Malformed varint");
}

function encodeZigzagVarInt(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Cannot encode unsafe integer as varint: ${value}`);
  }
  const v = BigInt(value);
  let zigzag = v >= 0n ? v * 2n : -v * 2n - 1n;
  const bytes: number[] = [];
  while (zigzag > 0x7fn) {
    bytes.push(Number((zigzag & 0x7fn) | 0x80n));
    zigzag >>= 7n;
  }
  bytes.push(Number(zigzag & 0x7fn));
  return new Uint8Array(bytes);
}

function parseOCFHeader(data: Uint8Array): OCFHeader {
  if (data.byteLength < 24) throw new Error("OCF too small");
  if (data[0] !== 0x4f || data[1] !== 0x62 || data[2] !== 0x6a || data[3] !== 0x01) {
    throw new Error("Invalid Avro magic bytes");
  }

  let codec = "null";
  let pos = 4;
  while (pos < data.byteLength) {
    const { value: blockCount, bytesRead } = readZigzagVarInt(data, pos);
    pos += bytesRead;
    if (blockCount === 0) break;

    const entryCount = Math.abs(blockCount);
    if (blockCount < 0) {
      const { bytesRead: skipBytes } = readZigzagVarInt(data, pos);
      pos += skipBytes;
    }

    for (let i = 0; i < entryCount && pos < data.byteLength; i += 1) {
      const { value: keyLen, bytesRead: keyLenBytes } = readZigzagVarInt(data, pos);
      pos += keyLenBytes;
      if (keyLen < 0 || keyLen > data.byteLength - pos) {
        throw new Error("Malformed metadata key");
      }
      const keyStr = keyLen === 10 ? TEXT_DECODER.decode(data.subarray(pos, pos + keyLen)) : "";
      pos += keyLen;

      const { value: valueLen, bytesRead: valueLenBytes } = readZigzagVarInt(data, pos);
      pos += valueLenBytes;
      if (valueLen < 0 || valueLen > data.byteLength - pos) {
        throw new Error("Malformed metadata value");
      }
      if (keyStr === "avro.codec") {
        const rawCodec = TEXT_DECODER.decode(data.subarray(pos, pos + valueLen)).trim();
        codec = rawCodec || "null";
      }
      pos += valueLen;
    }
  }

  if (pos + 16 > data.byteLength) {
    throw new Error("Sync marker is missing");
  }

  return {
    metadataEnd: pos,
    syncMarker: new Uint8Array(data.slice(pos, pos + 16)),
    codec,
  };
}

function extractDataBlocksRaw(ocfData: Uint8Array, header: OCFHeader): Uint8Array {
  const dataStart = header.metadataEnd + 16;
  if (dataStart >= ocfData.byteLength) return new Uint8Array(0);
  return new Uint8Array(ocfData.slice(dataStart));
}

function rewriteSyncMarkers(
  dataBlocks: Uint8Array,
  originalMarker: Uint8Array,
  newMarker: Uint8Array,
): Uint8Array {
  if (dataBlocks.byteLength === 0) return dataBlocks;

  const isSame = originalMarker.every((b, i) => b === newMarker[i]);
  if (isSame) return dataBlocks;

  const out = new Uint8Array(dataBlocks);
  let pos = 0;
  while (pos < out.byteLength) {
    const { value: blockCount, bytesRead: countBytes } = readZigzagVarInt(out, pos);
    pos += countBytes;

    if (blockCount === 0) {
      break;
    }

    const { value: blockSize, bytesRead: sizeBytes } = readZigzagVarInt(out, pos);
    pos += sizeBytes;

    if (!Number.isFinite(blockSize) || blockSize < 0) {
      throw new Error("Invalid OCF block size");
    }

    const syncPos = pos + blockSize;
    if (syncPos + 16 > out.byteLength) {
      throw new Error("OCF block exceeds available bytes");
    }

    for (let i = 0; i < 16; i += 1) {
      const outputByte = out[syncPos + i];
      const originalByte = originalMarker[i];
      if (outputByte === undefined || originalByte === undefined || outputByte !== originalByte) {
        throw new Error("Unexpected sync marker at OCF block boundary");
      }
    }

    for (let i = 0; i < 16; i += 1) {
      const newByte = newMarker[i];
      if (newByte === undefined) {
        throw new Error("Replacement sync marker is incomplete");
      }
      out[syncPos + i] = newByte;
    }

    pos = syncPos + 16;
  }

  return out;
}

/**
 * Consolidates multiple uncompressed ('null' codec) Avro data blocks into a single
 * Avro data block while validating every sync marker.
 */
function consolidateNullDataBlocks(
  dataBlocks: Uint8Array,
  originalMarker: Uint8Array,
  newMarker: Uint8Array,
): Uint8Array {
  if (dataBlocks.byteLength === 0) return dataBlocks;

  const payloadSlices: Uint8Array[] = [];
  let totalCount = 0;
  let totalPayloadSize = 0;
  let pos = 0;

  while (pos < dataBlocks.byteLength) {
    const { value: blockCount, bytesRead: countBytes } = readZigzagVarInt(dataBlocks, pos);
    pos += countBytes;

    if (blockCount === 0) {
      break;
    }
    if (blockCount < 0) {
      throw new Error("Invalid OCF block record count");
    }

    const { value: blockSize, bytesRead: sizeBytes } = readZigzagVarInt(dataBlocks, pos);
    pos += sizeBytes;

    if (!Number.isFinite(blockSize) || blockSize < 0) {
      throw new Error("Invalid OCF block size");
    }

    const syncPos = pos + blockSize;
    if (syncPos + 16 > dataBlocks.byteLength) {
      throw new Error("OCF block exceeds available bytes");
    }

    for (let i = 0; i < 16; i += 1) {
      const outputByte = dataBlocks[syncPos + i];
      const originalByte = originalMarker[i];
      if (outputByte === undefined || originalByte === undefined || outputByte !== originalByte) {
        throw new Error("Unexpected sync marker at OCF block boundary");
      }
    }

    payloadSlices.push(dataBlocks.subarray(pos, syncPos));
    totalCount += blockCount;
    totalPayloadSize += blockSize;
    pos = syncPos + 16;
  }

  if (payloadSlices.length === 0 || totalCount === 0) {
    return new Uint8Array(0);
  }

  if (payloadSlices.length === 1) {
    return rewriteSyncMarkers(dataBlocks, originalMarker, newMarker);
  }

  const encodedCount = encodeZigzagVarInt(totalCount);
  const encodedSize = encodeZigzagVarInt(totalPayloadSize);
  const out = new Uint8Array(
    encodedCount.byteLength + encodedSize.byteLength + totalPayloadSize + 16,
  );
  let writeOffset = 0;
  out.set(encodedCount, writeOffset);
  writeOffset += encodedCount.byteLength;
  out.set(encodedSize, writeOffset);
  writeOffset += encodedSize.byteLength;
  for (const slice of payloadSlices) {
    out.set(slice, writeOffset);
    writeOffset += slice.byteLength;
  }
  out.set(newMarker, writeOffset);
  return out;
}

function schemaComparisonEncoding(schema: unknown): string {
  const normalize = (value: unknown, schemaPosition: boolean): unknown => {
    if (Array.isArray(value)) return value.map((item) => normalize(item, schemaPosition));
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !schemaPosition || key !== "doc")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [
          key,
          normalize(child, schemaPosition && ["type", "fields", "items", "values"].includes(key)),
        ]),
    );
  };
  return JSON.stringify(normalize(schema, true));
}

export function mergeAvroOCFWithBoundaries(
  ocfDataArray: Uint8Array[],
  options?: MergeAvroOptions,
): MergeResult {
  if (ocfDataArray.length === 0) throw new Error("Cannot merge empty OCF array");

  const first = ocfDataArray[0];
  if (first === undefined) throw new Error("Cannot merge empty OCF array");
  const unifiedHeader = parseOCFHeader(first);
  const schemaEncoding = schemaComparisonEncoding(parseOcfHeader(first).schema);
  const headerSize = unifiedHeader.metadataEnd + 16;
  const shouldReblock = (options?.reblock ?? true) && unifiedHeader.codec === "null";

  const dataBlocksList: Uint8Array[] = [];
  const boundaries: Array<{ sourceIndex: number; startByte: number; length: number }> = [];
  let runningDataBytes = 0;

  for (let i = 0; i < ocfDataArray.length; i += 1) {
    const source = ocfDataArray[i];
    if (source === undefined) throw new Error("OCF source is missing");
    const sourceHeader = parseOCFHeader(source);
    if (sourceHeader.codec !== unifiedHeader.codec) {
      throw new Error("Cannot merge incompatible Avro codecs");
    }
    if (schemaComparisonEncoding(parseOcfHeader(source).schema) !== schemaEncoding) {
      throw new Error("Cannot merge incompatible Avro schemas");
    }
    const rawBlocks = extractDataBlocksRaw(source, sourceHeader);
    const rewritten =
      shouldReblock && sourceHeader.codec === "null"
        ? consolidateNullDataBlocks(rawBlocks, sourceHeader.syncMarker, unifiedHeader.syncMarker)
        : rewriteSyncMarkers(rawBlocks, sourceHeader.syncMarker, unifiedHeader.syncMarker);
    boundaries.push({
      sourceIndex: i,
      startByte: headerSize + runningDataBytes,
      length: rewritten.byteLength,
    });
    dataBlocksList.push(rewritten);
    runningDataBytes += rewritten.byteLength;
  }

  const merged = new Uint8Array(headerSize + runningDataBytes);
  merged.set(first.subarray(0, headerSize), 0);
  let offset = headerSize;
  for (const block of dataBlocksList) {
    merged.set(block, offset);
    offset += block.byteLength;
  }

  return { merged, boundaries, headerSize };
}

export function mergeAvroOCF(
  ocfDataArray: Uint8Array[],
  options?: MergeAvroOptions,
): Uint8Array {
  const result = mergeAvroOCFWithBoundaries(ocfDataArray, options);
  if (ocfDataArray.length <= 1 || options?.reblock === false) {
    return result.merged;
  }
  const first = ocfDataArray[0];
  if (!first) return result.merged;
  const header = parseOCFHeader(first);
  if (header.codec !== "null") {
    return result.merged;
  }
  const consolidatedBody = consolidateNullDataBlocks(
    result.merged.subarray(result.headerSize),
    header.syncMarker,
    header.syncMarker,
  );
  const consolidated = new Uint8Array(result.headerSize + consolidatedBody.byteLength);
  consolidated.set(result.merged.subarray(0, result.headerSize), 0);
  consolidated.set(consolidatedBody, result.headerSize);
  return consolidated;
}

export function mergeAvroOCFBuffers(bufferArray: ArrayBuffer[]): ArrayBuffer {
  const uint8Array = mergeAvroOCF(bufferArray.map((b) => new Uint8Array(b)));
  const buffer = uint8Array.buffer;
  if (buffer instanceof SharedArrayBuffer) {
    const ab = new ArrayBuffer(uint8Array.byteLength);
    new Uint8Array(ab).set(uint8Array);
    return ab;
  }
  return buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
}
export * from "./snapshots.js";
