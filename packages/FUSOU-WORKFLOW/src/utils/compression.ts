/**
 * Compression Utilities for Avro Data
 * 
 * Supported Codecs:
 * - deflate: zlib compression (standard, good compression ratio)
 * - snappy: Fast compression (lower ratio, higher speed)
 * 
 * Requirements:
 * - wrangler.toml: compatibility_flags = ["nodejs_compat"]
 * - Node.js zlib module available in Workers runtime
 */

import { deflate, inflate } from 'node:zlib';
import { promisify } from 'node:util';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

/**
 * Compress data using deflate (zlib)
 * Returns null if compression fails or increases size
 */
export async function compressDeflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const compressed = await deflateAsync(data);
    
    // Only return compressed if it's actually smaller
    if (compressed.byteLength < data.byteLength) {
      return new Uint8Array(compressed);
    }
    
    return null;  // Compression didn't help
  } catch (err) {
    console.error('Deflate compression failed:', err);
    return null;
  }
}

/**
 * Decompress deflate data
 */
export async function decompressDeflate(data: Uint8Array): Promise<Uint8Array> {
  try {
    const decompressed = await inflateAsync(data);
    return new Uint8Array(decompressed);
  } catch (err) {
    console.error('Deflate decompression failed:', err);
    throw new Error('Failed to decompress deflate data');
  }
}

/**
 * Synchronous compression (for small data, use with caution)
 * Note: Blocks event loop, only use for < 1MB data
 */
export function compressDeflateSync(data: Uint8Array): Uint8Array | null {
  try {
    // Import sync version
    const { deflateSync } = require('node:zlib');
    const compressed = deflateSync(data);
    
    if (compressed.byteLength < data.byteLength) {
      return new Uint8Array(compressed);
    }
    
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
  if (!codec || codec === 'null') {
    return data;  // No compression
  }
  
  switch (codec) {
    case 'deflate':
      return await decompressDeflate(data);
    
    case 'snappy':
      // TODO: Implement snappy decompression when needed
      throw new Error('Snappy decompression not yet implemented');
    
    default:
      throw new Error(`Unsupported compression codec: ${codec}`);
  }
}

/**
 * Streaming compression for large files
 * (Advanced: for files > 100MB, use TransformStream)
 */
export class DeflateStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor() {
    const { createDeflate } = require('node:zlib');
    const deflateStream = createDeflate();
    
    super({
      start(controller) {
        deflateStream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        
        deflateStream.on('end', () => {
          controller.terminate();
        });
        
        deflateStream.on('error', (err: Error) => {
          controller.error(err);
        });
      },
      
      transform(chunk) {
        deflateStream.write(chunk);
      },
      
      flush() {
        deflateStream.end();
      }
    });
  }
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
