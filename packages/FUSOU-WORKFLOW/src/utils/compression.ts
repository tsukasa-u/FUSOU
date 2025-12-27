/**
 * Compression Utilities for Avro Data
 * 
 * Supported Codecs:
 * - deflate: zlib compression (standard, good compression ratio)
 * - snappy: Fast compression (lower ratio, higher speed)
 * 
 * Implementation:
 * - Uses Web Streams API (CompressionStream/DecompressionStream)
 * - Works in Cloudflare Workers without nodejs_compat
 * - No Node.js dependencies
 */

/**
 * Compress data using deflate (Web Streams API)
 * Returns null if compression fails or increases size
 */
export async function compressDeflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    // Write data
    writer.write(data);
    writer.close();

    // Read compressed chunks
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Concatenate chunks
    const compressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }

    // Only return compressed if it's actually smaller
    if (compressed.byteLength < data.byteLength) {
      return compressed;
    }

    return null;  // Compression didn't help
  } catch (err) {
    console.error('Deflate compression failed:', err);
    return null;
  }
}

/**
 * Decompress deflate data (Web Streams API)
 */
export async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  try {
    const stream = new DecompressionStream('deflate');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    // Write compressed data
    writer.write(data);
    writer.close();

    // Read decompressed chunks
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Concatenate chunks
    const decompressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      decompressed.set(chunk, offset);
      offset += chunk.length;
    }

    return decompressed;
  } catch (err) {
    console.error('Deflate decompression failed:', err);
    throw new Error('Failed to decompress deflate data');
  }
}

/**
 * Synchronous compression (for small data, use with caution)
 * Note: Blocks event loop, only use for < 1MB data
 * DEPRECATED: Use async compressDeflate instead
 */
export function compressDeflateSync(data: Uint8Array): Uint8Array | null {
  try {
    // Note: Workers environment prefers async operations
    // This function is kept for backward compatibility but should not be used
    console.warn('compressDeflateSync is deprecated, use compressDeflate instead');
    return null;
  } catch (err) {
    console.error('Sync deflate compression failed:', err);
    return null;
  }
}

/**
 * Detect compression codec from Avro file header
 * Avro format: Header contains codec name in metadata
 */
export function detectCompressionCodec(avroHeader: Uint8Array): string | null {
  try {
    // Simplified detection: look for "deflate" or "snappy" in header bytes
    const headerText = new TextDecoder().decode(avroHeader.slice(0, 512));

    if (headerText.includes('deflate')) return 'deflate';
    if (headerText.includes('snappy')) return 'snappy';

    return null;  // No compression
  } catch (err) {
    console.error('Failed to detect compression codec:', err);
    return null;
  }
}

/**
 * Estimate compression ratio (for monitoring)
 * Returns: originalSize / compressedSize (e.g., 2.5 = 2.5x compression)
 */
export function estimateCompressionRatio(
  originalSize: number,
  compressedSize: number
): number {
  if (compressedSize === 0) return 0;
  return Math.round((originalSize / compressedSize) * 100) / 100;
}

/**
 * Compression statistics for monitoring
 */
export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  savingsPercent: number;
  codec: string;
}

export function calculateCompressionStats(
  original: Uint8Array,
  compressed: Uint8Array,
  codec: string = 'deflate'
): CompressionStats {
  const ratio = estimateCompressionRatio(original.byteLength, compressed.byteLength);
  const savingsPercent = Math.round((1 - compressed.byteLength / original.byteLength) * 100);

  return {
    originalSize: original.byteLength,
    compressedSize: compressed.byteLength,
    ratio,
    savingsPercent,
    codec
  };
}

/**
 * Auto-detect and decompress (supports deflate)
 * For future extension: add snappy support
 */
export async function autoDecompress(
  data: Uint8Array,
  codec: string | null
): Promise<Uint8Array> {
  if (!codec || codec === 'null' || codec === 'none') {
    return data;  // No compression
  }

  switch (codec) {
    case 'deflate':
      return await decompressDeflate(data);

    case 'snappy':
      // Explicitly unsupported for now to avoid silent corruption.
      // Avro Snappy requires appending a 4-byte CRC32 of the uncompressed data.
      // Implementing correct framed Snappy + CRC verification will be added when needed.
      throw new Error('Snappy codec unsupported: requires Avro Snappy CRC32 handling');

    default:
      throw new Error(`Unsupported compression codec: ${codec}`);
  }
}

/**
 * Streaming compression for large files
 * (Advanced: for files > 100MB, use TransformStream)
 * Note: Currently not supported in Workers runtime
 * Use compressDeflate for now
 */
export async function createDeflateStream(): Promise<TransformStream<Uint8Array, Uint8Array>> {
  // TODO: Implement proper streaming compression when Workers supports it
  // For now, recommend using compressDeflate with chunked processing
  throw new Error('Streaming compression not yet implemented for Workers runtime');
}

/**
 * Example usage for archiver:
 * 
 * // Compress before R2 upload
 * const compressed = await compressDeflate(avroBuffer);
 * const finalBuffer = compressed ?? avroBuffer;
 * 
 * await r2.put(filePath, finalBuffer, {
 *   customMetadata: {
 *     compression: compressed ? 'deflate' : 'none',
 *     originalSize: String(avroBuffer.byteLength),
 *     compressedSize: String(finalBuffer.byteLength)
 *   }
 * });
 * 
 * // Decompress on read
 * const obj = await r2.get(filePath);
 * const compressed = await obj.arrayBuffer();
 * const codec = obj.customMetadata?.compression ?? null;
 * const decompressed = await autoDecompress(new Uint8Array(compressed), codec);
 */
