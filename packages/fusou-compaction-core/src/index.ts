export interface MergeResult {
  merged: Uint8Array;
  boundaries: Array<{ sourceIndex: number; startByte: number; length: number }>;
  headerSize: number;
}

interface OCFHeader {
  metadataEnd: number;
  syncMarker: Uint8Array;
}

function readZigzagVarInt(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (offset >= data.byteLength) {
    throw new Error("Cannot read varint: offset exceeds buffer");
  }

  let raw = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < data.byteLength && bytesRead < 10) {
    const byte = data[offset + bytesRead];
    bytesRead += 1;
    raw |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      const value = (raw >>> 1) ^ -(raw & 1);
      return { value, bytesRead };
    }
    shift += 7;
  }

  throw new Error("Malformed varint");
}

function parseOCFHeader(data: Uint8Array): OCFHeader {
  if (data.byteLength < 24) throw new Error("OCF too small");
  if (data[0] !== 0x4f || data[1] !== 0x62 || data[2] !== 0x6a || data[3] !== 0x01) {
    throw new Error("Invalid Avro magic bytes");
  }

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
      pos += keyLen;

      const { value: valueLen, bytesRead: valueLenBytes } = readZigzagVarInt(data, pos);
      pos += valueLenBytes;
      if (valueLen < 0 || valueLen > data.byteLength - pos) {
        throw new Error("Malformed metadata value");
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
      if (out[syncPos + i] !== originalMarker[i]) {
        throw new Error("Unexpected sync marker at OCF block boundary");
      }
    }

    for (let i = 0; i < 16; i += 1) {
      out[syncPos + i] = newMarker[i];
    }

    pos = syncPos + 16;
  }

  return out;
}

export function mergeAvroOCFWithBoundaries(ocfDataArray: Uint8Array[]): MergeResult {
  if (ocfDataArray.length === 0) throw new Error("Cannot merge empty OCF array");

  const first = ocfDataArray[0];
  const unifiedHeader = parseOCFHeader(first);
  const headerSize = unifiedHeader.metadataEnd + 16;

  const dataBlocksList: Uint8Array[] = [];
  const boundaries: Array<{ sourceIndex: number; startByte: number; length: number }> = [];

  for (let i = 0; i < ocfDataArray.length; i += 1) {
    const source = ocfDataArray[i];
    const sourceHeader = parseOCFHeader(source);
    const rawBlocks = extractDataBlocksRaw(source, sourceHeader);
    const rewritten = rewriteSyncMarkers(rawBlocks, sourceHeader.syncMarker, unifiedHeader.syncMarker);
    const prior = dataBlocksList.reduce((sum, b) => sum + b.byteLength, 0);
    boundaries.push({ sourceIndex: i, startByte: headerSize + prior, length: rewritten.byteLength });
    dataBlocksList.push(rewritten);
  }

  const dataSize = dataBlocksList.reduce((sum, b) => sum + b.byteLength, 0);
  const merged = new Uint8Array(headerSize + dataSize);
  merged.set(first.slice(0, headerSize), 0);
  let offset = headerSize;
  for (const block of dataBlocksList) {
    merged.set(block, offset);
    offset += block.byteLength;
  }

  return { merged, boundaries, headerSize };
}

export function mergeAvroOCF(ocfDataArray: Uint8Array[]): Uint8Array {
  return mergeAvroOCFWithBoundaries(ocfDataArray).merged;
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
