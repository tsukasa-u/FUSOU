/**
 * Avro OCF Merger - Combines multiple Avro OCF files into a single valid OCF
 * 
 * OCF Format:
 * [Magic(4)] [Metadata] [SyncMarker(16)] [DataBlocks...] [SyncMarker(16)]
 * 
 * Each DataBlock:
 * [BlockCount(long)] [BlockData(bytes)] [SyncMarker(16)]
 * 
 * Merging Strategy:
 * 1. Parse first OCF completely (magic, metadata, sync marker)
 * 2. Extract all data blocks from all OCFs (skip magic/metadata/final sync)
 * 3. Concatenate blocks with a new final sync marker
 */

interface OCFHeader {
  magicEnd: number;      // End offset of magic bytes (4)
  metadataEnd: number;   // End offset of metadata
  syncMarker: Uint8Array; // 16-byte sync marker
}

/**
 * Parse OCF header: magic, metadata, and sync marker
 * Returns: { magicEnd, metadataEnd, syncMarker }
 * Throws on invalid input
 */
function parseOCFHeader(data: Uint8Array): OCFHeader {
  if (data.byteLength < 24) {
    throw new Error('OCF too small for header');
  }

  // Magic: "Obj\x01"
  if (data[0] !== 0x4F || data[1] !== 0x62 || data[2] !== 0x6A || data[3] !== 0x01) {
    throw new Error('Invalid Avro magic bytes');
  }

  const magicEnd = 4;

  // Metadata: array of [key(string), value(bytes)]* + empty map terminator
  // String format: [long length][UTF-8 data]
  // Bytes format: [long length][data]
  // Map terminator: long 0 (indicates end of map)
  let pos = magicEnd;

  while (pos < data.byteLength) {
    // Try to read next varint (map key length or terminator)
    const { value: keyLen, bytesRead } = readVarInt(data, pos);
    pos += bytesRead;

    if (keyLen === 0) {
      // Map terminator reached
      break;
    }

    // Skip key (UTF-8 string)
    if (pos + keyLen > data.byteLength) {
      throw new Error(`Malformed metadata: key length ${keyLen} exceeds available bytes from pos ${pos} (buffer size ${data.byteLength})`);
    }
    pos += keyLen;

    // Read value length
    const { value: valueLen, bytesRead: valueBytesRead } = readVarInt(data, pos);
    pos += valueBytesRead;

    // Skip value (bytes)
    if (pos + valueLen > data.byteLength) {
      throw new Error(`Malformed metadata: value length ${valueLen} exceeds available bytes from pos ${pos} (buffer size ${data.byteLength})`);
    }
    pos += valueLen;
  }

  const metadataEnd = pos;

  // Validate sync marker is present and accessible
  if (metadataEnd + 16 > data.byteLength) {
    throw new Error(`OCF sync marker missing: metadata ends at ${metadataEnd}, need 16 more bytes, have ${data.byteLength}`);
  }

  const syncMarker = new Uint8Array(data.slice(metadataEnd, metadataEnd + 16));
  if (syncMarker.byteLength !== 16) {
    throw new Error('Internal error: sync marker not exactly 16 bytes');
  }

  return { magicEnd, metadataEnd, syncMarker };
}

/**
 * Read varint (Avro long encoding)
 * Returns { value: number, bytesRead: number }
 * Throws if varint is malformed (incomplete or exceeds safe length)
 */
function readVarInt(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (offset >= data.byteLength) {
    throw new Error('Cannot read varint: offset exceeds buffer');
  }

  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  const maxBytes = 10; // Varint max 10 bytes (64-bit)

  while (offset + bytesRead < data.byteLength && bytesRead < maxBytes) {
    const byte = data[offset + bytesRead];
    bytesRead++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      // Successfully decoded
      return { value: value >> 1, bytesRead };
    }
    shift += 7;
  }

  // If we get here, varint is incomplete or exceeds max length
  throw new Error(`Malformed varint: incomplete at offset ${offset} (read ${bytesRead}/${maxBytes} bytes)`);
}

/**
 * Extract data blocks from OCF (everything after metadata + sync marker)
 * Returns: Uint8Array containing all data blocks
 * This includes: [BlockCount][BlockData][SyncMarker] repeated
 * 
 * Validates:
 * - Sync marker is present and matches expected marker
 * - Data section is properly aligned
 */
function extractDataBlocks(ocfData: Uint8Array, header: OCFHeader): Uint8Array {
  const dataStart = header.metadataEnd + 16; // Skip sync marker
  const dataEnd = ocfData.byteLength;

  // Validate sync marker at metadata boundary
  if (header.metadataEnd + 16 > ocfData.byteLength) {
    throw new Error(`OCF too small: metadata_end=${header.metadataEnd}, need 16B sync marker, have ${ocfData.byteLength}B total`);
  }

  // Verify sync marker matches (all OCFs being merged should have same metadata/marker)
  const actualMarker = ocfData.slice(header.metadataEnd, header.metadataEnd + 16);
  const markersMatch = actualMarker.every((byte, i) => byte === header.syncMarker[i]);
  if (!markersMatch) {
    throw new Error('OCF sync marker mismatch: cannot merge files with different schemas');
  }

  if (dataEnd <= dataStart) {
    // Empty OCF (no data blocks)
    return new Uint8Array(0);
  }

  return new Uint8Array(ocfData.slice(dataStart, dataEnd));
}

/**
 * Merge multiple Avro OCF files into single valid OCF
 * - Uses header (magic, metadata, sync marker) from first OCF
 * - Concatenates data blocks from all OCFs
 * - Appends final sync marker
 * 
 * @param ocfDataArray - Array of OCF file contents
 * @returns Merged OCF as Uint8Array
 */
export function mergeAvroOCF(ocfDataArray: Uint8Array[]): Uint8Array {
  if (ocfDataArray.length === 0) {
    throw new Error('Cannot merge empty OCF array');
  }

  // Parse first OCF to get header
  const firstOCF = ocfDataArray[0];
  const header = parseOCFHeader(firstOCF);

  // Collect all data blocks
  const dataBlocksList: Uint8Array[] = [];

  for (const ocfData of ocfDataArray) {
    const blocks = extractDataBlocks(ocfData, header);
    if (blocks.byteLength > 0) {
      dataBlocksList.push(blocks);
    }
  }

  // Calculate final size with overflow check
  const headerSize = header.metadataEnd + 16; // magic + metadata + sync marker
  const dataSize = dataBlocksList.reduce((sum, b) => {
    // Detect integer overflow during summation
    if (sum > Number.MAX_SAFE_INTEGER - b.byteLength) {
      throw new Error(`OCF merge size exceeds safe integer limit: ${sum} + ${b.byteLength}`);
    }
    return sum + b.byteLength;
  }, 0);
  const finalSyncSize = 16; // Final sync marker
  const totalSize = headerSize + dataSize + finalSyncSize;
  
  if (totalSize > Number.MAX_SAFE_INTEGER || totalSize < 0) {
    throw new Error(`OCF merge total size invalid: ${totalSize}`);
  }

  // Combine
  const merged = new Uint8Array(totalSize);
  let offset = 0;

  // Copy header from first OCF
  const headerSlice = firstOCF.slice(0, headerSize);
  if (headerSlice.byteLength !== headerSize) {
    throw new Error(`Internal error: header slice size mismatch (expected ${headerSize}, got ${headerSlice.byteLength})`);
  }
  merged.set(headerSlice, offset);
  offset += headerSize;

  // Copy all data blocks
  for (const blocks of dataBlocksList) {
    merged.set(blocks, offset);
    offset += blocks.byteLength;
  }

  // Append final sync marker (same as header's sync marker)
  merged.set(header.syncMarker, offset);
  offset += 16;

  console.log(`[Merger] Merged ${ocfDataArray.length} OCF files: ${headerSize}B header + ${dataSize}B data + 16B final sync = ${totalSize}B`);

  return merged;
}

/**
 * Merge multiple Avro OCF Buffers (for convenience with ArrayBuffer)
 */
export function mergeAvroOCFBuffers(bufferArray: ArrayBuffer[]): ArrayBuffer {
  const uint8Array = mergeAvroOCF(bufferArray.map(b => new Uint8Array(b)));
  // Handle both ArrayBuffer and SharedArrayBuffer
  const buffer = uint8Array.buffer;
  if (buffer instanceof SharedArrayBuffer) {
    // Convert SharedArrayBuffer to ArrayBuffer
    const ab = new ArrayBuffer(uint8Array.byteLength);
    new Uint8Array(ab).set(uint8Array);
    return ab;
  }
  return buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength);
}
