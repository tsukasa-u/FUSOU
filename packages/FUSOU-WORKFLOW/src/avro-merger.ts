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
    // Try to read next varint (map block count - can be positive, negative, or zero)
    const { value: blockCount, bytesRead } = readZigzagVarInt(data, pos);
    pos += bytesRead;

    if (blockCount === 0) {
      // Map terminator reached
      break;
    }

    // For negative block counts, absolute value is count and next value is byte size (skip)
    const entryCount = Math.abs(blockCount);
    if (blockCount < 0) {
      // Read and skip the byte size
      const { bytesRead: skipBytes } = readZigzagVarInt(data, pos);
      pos += skipBytes;
    }

    // Read key-value pairs
    for (let i = 0; i < entryCount && pos < data.byteLength; i++) {
      // Read key length
      const { value: keyLen, bytesRead: keyLenBytes } = readZigzagVarInt(data, pos);
      pos += keyLenBytes;

      if (keyLen < 0 || keyLen > data.byteLength - pos) {
        throw new Error(`Malformed metadata: invalid key length ${keyLen} at pos ${pos} (buffer size ${data.byteLength})`);
      }

      // Skip key (UTF-8 string)
      pos += keyLen;

      // Read value length
      const { value: valueLen, bytesRead: valueLenBytes } = readZigzagVarInt(data, pos);
      pos += valueLenBytes;

      if (valueLen < 0 || valueLen > data.byteLength - pos) {
        throw new Error(`Malformed metadata: invalid value length ${valueLen} at pos ${pos} (buffer size ${data.byteLength})`);
      }

      // Skip value (bytes)
      pos += valueLen;
    }
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
 * Read Avro long (zigzag + varint encoding)
 * Returns { value: number, bytesRead: number }
 * Throws if varint is malformed (incomplete or exceeds safe length)
 * 
 * Zigzag decoding: (n >>> 1) ^ -(n & 1)
 * This correctly handles negative values
 */
function readZigzagVarInt(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  if (offset >= data.byteLength) {
    throw new Error('Cannot read varint: offset exceeds buffer');
  }

  let raw = 0;
  let shift = 0;
  let bytesRead = 0;
  const maxBytes = 10; // Varint max 10 bytes (64-bit)

  while (offset + bytesRead < data.byteLength && bytesRead < maxBytes) {
    const byte = data[offset + bytesRead];
    bytesRead++;
    raw |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      // Successfully decoded - apply zigzag decoding
      // (n >>> 1) ^ -(n & 1) correctly decodes zigzag for signed integers
      const value = (raw >>> 1) ^ -(raw & 1);
      return { value, bytesRead };
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
 * For files with different sync markers (same schema, different upload sessions):
 * - Extracts data blocks using the file's own sync marker
 * - Returns raw data blocks (caller must handle sync marker rewriting if needed)
 */
function extractDataBlocksRaw(ocfData: Uint8Array, header: OCFHeader): Uint8Array {
  const dataStart = header.metadataEnd + 16; // Skip sync marker after metadata
  const dataEnd = ocfData.byteLength;

  // Validate sync marker is present
  if (header.metadataEnd + 16 > ocfData.byteLength) {
    throw new Error(`OCF too small: metadata_end=${header.metadataEnd}, need 16B sync marker, have ${ocfData.byteLength}B total`);
  }

  if (dataEnd <= dataStart) {
    // Empty OCF (no data blocks)
    return new Uint8Array(0);
  }

  return new Uint8Array(ocfData.slice(dataStart, dataEnd));
}

/**
 * Rewrite sync markers embedded in data blocks
 * Each data block ends with a 16-byte sync marker. This function replaces
 * the original sync marker with a new unified sync marker.
 * 
 * @param dataBlocks - Raw data blocks from OCF
 * @param originalMarker - The sync marker used in the source file
 * @param newMarker - The unified sync marker to use
 * @returns Data blocks with sync markers replaced
 */
function rewriteSyncMarkers(dataBlocks: Uint8Array, originalMarker: Uint8Array, newMarker: Uint8Array): Uint8Array {
  if (dataBlocks.byteLength === 0) {
    return dataBlocks;
  }

  // If markers are the same, no rewrite needed
  const markersMatch = originalMarker.every((byte, i) => byte === newMarker[i]);
  if (markersMatch) {
    return dataBlocks;
  }

  // Create a copy to avoid modifying the original
  const result = new Uint8Array(dataBlocks);
  
  // Find and replace all occurrEnd of sync marker patterns in data blocks
  // Data blocks format: [varint count][varint size][compressed data][16-byte sync marker]...
  // We scan for the original marker and replace with new marker
  let pos = 0;
  let replacements = 0;
  
  while (pos <= result.byteLength - 16) {
    // Check if we found the original marker at this position
    let isMatch = true;
    for (let i = 0; i < 16 && isMatch; i++) {
      if (result[pos + i] !== originalMarker[i]) {
        isMatch = false;
      }
    }
    
    if (isMatch) {
      // Replace with new marker
      for (let i = 0; i < 16; i++) {
        result[pos + i] = newMarker[i];
      }
      replacements++;
      pos += 16; // Skip past the marker we just replaced
    } else {
      pos++;
    }
  }

  if (replacements > 0) {
    console.log(`[Merger] Rewrote ${replacements} sync markers in data blocks`);
  }

  return result;
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

  // Parse first OCF to get the unified header (will use its sync marker for all)
  const firstOCF = ocfDataArray[0];
  const unifiedHeader = parseOCFHeader(firstOCF);

  // Collect all data blocks, rewriting sync markers as needed
  const dataBlocksList: Uint8Array[] = [];

  for (const ocfData of ocfDataArray) {
    // Parse this file's header to get its own sync marker
    const fileHeader = parseOCFHeader(ocfData);
    
    // Extract raw data blocks from this file
    const rawBlocks = extractDataBlocksRaw(ocfData, fileHeader);
    if (rawBlocks.byteLength > 0) {
      // Rewrite sync markers in data blocks to match the unified header's marker
      const rewrittenBlocks = rewriteSyncMarkers(rawBlocks, fileHeader.syncMarker, unifiedHeader.syncMarker);
      dataBlocksList.push(rewrittenBlocks);
    }
  }

  // Calculate final size with overflow check
  const headerSize = unifiedHeader.metadataEnd + 16; // magic + metadata + sync marker
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

  // Append final sync marker (same as unified header's sync marker)
  merged.set(unifiedHeader.syncMarker, offset);
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
