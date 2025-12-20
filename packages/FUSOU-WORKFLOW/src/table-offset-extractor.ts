/**
 * Table Offset Extractor
 * Handles parsing and extraction of individual tables from concatenated Parquet files
 */
import { parquetMetadata } from 'hyparquet';

export interface TableOffsetMetadata {
  table_name: string;
  start_byte: number;
  byte_length: number;
  format: string;
  num_rows?: number; // Optional: row count for filtering empty tables
}

export interface ExtractedTable {
  table_name: string;
  data: ArrayBuffer;
  size: number;
}

/**
 * Parse table_offsets JSON string from D1
 * Returns array of offset metadata or null if invalid/missing
 */
export function parseTableOffsets(offsetsJson: string | null): TableOffsetMetadata[] | null {
  if (!offsetsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(offsetsJson);
    
    if (!Array.isArray(parsed)) {
      console.warn('[OffsetExtractor] table_offsets is not an array');
      return null;
    }

    // Validate each offset entry
    const validated = parsed.filter((item): item is TableOffsetMetadata => {
      return (
        typeof item === 'object' &&
        typeof item.table_name === 'string' &&
        typeof item.start_byte === 'number' &&
        typeof item.byte_length === 'number' &&
        typeof item.format === 'string'
      );
    });

    if (validated.length !== parsed.length) {
      console.warn('[OffsetExtractor] Some offset entries were invalid and filtered out');
    }

    return validated.length > 0 ? validated : null;
  } catch (error) {
    console.error('[OffsetExtractor] Failed to parse table_offsets JSON:', error);
    return null;
  }
}

/**
 * Filter out tables with zero row counts from offset metadata
 * Should be called server-side during fragment generation to exclude empty tables
 * Client-side caller should remove these tables before extraction
 */
export function filterEmptyTables(offsets: TableOffsetMetadata[]): { valid: TableOffsetMetadata[]; empty: TableOffsetMetadata[] } {
  const valid: TableOffsetMetadata[] = [];
  const empty: TableOffsetMetadata[] = [];

  for (const offset of offsets) {
    // If num_rows is explicitly provided and is 0 or negative, mark as empty
    if (typeof offset.num_rows === 'number' && offset.num_rows <= 0) {
      console.info(`[OffsetExtractor] Filtering empty table '${offset.table_name}' (numRows=${offset.num_rows})`);
      empty.push(offset);
    } else {
      valid.push(offset);
    }
  }

  return { valid, empty };
}

/**
 * Extract a specific table from concatenated file using offset metadata
 * 
 * @param bucket - R2 bucket
 * @param fragmentKey - R2 key of the concatenated file
 * @param targetTable - Name of the table to extract (e.g., "api_port")
 * @param offsets - Array of table offset metadata
 * @returns Extracted table data or null if table not found
 */
export async function extractTableFromFragment(
  bucket: R2Bucket,
  fragmentKey: string,
  targetTable: string,
  offsets: TableOffsetMetadata[]
): Promise<ExtractedTable | null> {
  const targetOffset = offsets.find(o => o.table_name === targetTable);

  if (!targetOffset) {
    console.warn(`[OffsetExtractor] Table '${targetTable}' not found in offsets for fragment ${fragmentKey}`);
    return null;
  }

  // Reject non-Parquet formats early for safety
  if (targetOffset.format.toLowerCase() !== 'parquet') {
    console.warn(`[OffsetExtractor] Table '${targetTable}' has unsupported format '${targetOffset.format}'. Expected 'parquet'.`);
    return null;
  }

  try {
    // Validate range parameters before R2 request
    if (targetOffset.start_byte < 0 || targetOffset.byte_length <= 0) {
      console.warn(`[OffsetExtractor] Invalid range: start=${targetOffset.start_byte}, length=${targetOffset.byte_length}`);
      return null;
    }

    // Use R2 Range request to read only the target table portion
    // Note: R2 will automatically reject out-of-bounds ranges, no need for HEAD request
    const r2Response = await bucket.get(fragmentKey, {
      range: {
        offset: targetOffset.start_byte,
        length: targetOffset.byte_length
      }
    });

    if (!r2Response) {
      console.error(`[OffsetExtractor] Failed to fetch fragment ${fragmentKey}`);
      return null;
    }

    const data = await r2Response.arrayBuffer();

    // Validate that the slice is a proper Parquet file by checking footer and parsing metadata with hyparquet
    const isValid = validateParquetSliceWithHyparquet(data);
    if (!isValid) {
      console.warn(`[OffsetExtractor] Slice for table '${targetTable}' failed Parquet validation (footer/metadata).`);
      return null;
    }

    return {
      table_name: targetTable,
      data,
      size: data.byteLength
    };
  } catch (error) {
    console.error(`[OffsetExtractor] Error extracting table from ${fragmentKey}:`, error);
    return null;
  }
}

/**
 * Extract ALL tables from a fragment in one bulk operation (optimized for port_table)
 * Fetches the entire fragment once and slices tables in memory
 * Returns array of extracted tables
 */
export async function extractAllTablesFromFragmentBulk(
  bucket: R2Bucket,
  fragmentKey: string,
  offsets: TableOffsetMetadata[]
): Promise<ExtractedTable[]> {
  try {
    // Single R2 GET request for entire fragment
    const fullData = await bucket.get(fragmentKey);
    if (!fullData) {
      console.error(`[OffsetExtractor] Failed to fetch fragment ${fragmentKey}`);
      return [];
    }

    const buffer = await fullData.arrayBuffer();
    const results: ExtractedTable[] = [];

    // Extract each table from the in-memory buffer
    for (const offset of offsets) {
      if (offset.format.toLowerCase() !== 'parquet') {
        continue;
      }

      // Validate range
      if (offset.start_byte < 0 || offset.byte_length <= 0) {
        console.warn(`[OffsetExtractor] Invalid range for ${offset.table_name}: start=${offset.start_byte}, length=${offset.byte_length}`);
        continue;
      }

      const endByte = offset.start_byte + offset.byte_length;
      if (endByte > buffer.byteLength) {
        console.warn(`[OffsetExtractor] Range exceeds buffer size for ${offset.table_name}: end=${endByte}, size=${buffer.byteLength}`);
        continue;
      }

      // Slice table data from buffer
      const tableData = buffer.slice(offset.start_byte, endByte);

      // Validate Parquet structure
      const isValid = validateParquetSliceWithHyparquet(tableData);
      if (!isValid) {
        console.warn(`[OffsetExtractor] Slice for table '${offset.table_name}' failed Parquet validation`);
        continue;
      }

      results.push({
        table_name: offset.table_name,
        data: tableData,
        size: tableData.byteLength
      });
    }

    return results;
  } catch (error) {
    console.error(`[OffsetExtractor] Error in bulk extraction from ${fragmentKey}:`, error);
    return [];
  }
}

/**
 * Extract a table from concatenated fragment (wrapper with validation)
 * Returns null for legacy fragments without offsets (full file should be used instead)
 */
export async function extractTableSafe(
  bucket: R2Bucket,
  fragmentKey: string,
  targetTable: string,
  offsetsJson: string | null
): Promise<ExtractedTable | null> {
  const offsets = parseTableOffsets(offsetsJson);

  if (!offsets) {
    // Legacy fragment without offset metadata
    console.info(`[OffsetExtractor] Fragment ${fragmentKey} has no offset metadata (legacy)`);
    return null;
  }

  return extractTableFromFragment(bucket, fragmentKey, targetTable, offsets);
}

/**
 * List all tables available in a fragment based on offset metadata
 */
export function listTablesInFragment(offsetsJson: string | null): string[] {
  const offsets = parseTableOffsets(offsetsJson);
  
  if (!offsets) {
    return [];
  }

  return offsets.map(o => o.table_name);
}

/**
 * Validate offset metadata for correctness
 * Checks for overlapping ranges, gaps, etc.
 */
export function validateOffsetMetadata(
  offsets: TableOffsetMetadata[],
  totalFileSize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (offsets.length === 0) {
    errors.push('No offset entries found');
    return { valid: false, errors };
  }

  // Check for overlapping ranges
  for (let i = 0; i < offsets.length; i++) {
    const current = offsets[i];

    // Check bounds
    if (current.start_byte < 0) {
      errors.push(`Table '${current.table_name}' has negative start_byte: ${current.start_byte}`);
    }

    if (current.byte_length <= 0) {
      errors.push(`Table '${current.table_name}' has invalid byte_length: ${current.byte_length}`);
    }

    const endByte = current.start_byte + current.byte_length;
    if (endByte > totalFileSize) {
      errors.push(`Table '${current.table_name}' exceeds file size: end=${endByte}, fileSize=${totalFileSize}`);
    }

    // Check for overlaps with other ranges
    for (let j = i + 1; j < offsets.length; j++) {
      const other = offsets[j];
      const otherEnd = other.start_byte + other.byte_length;

      const overlap = !(endByte <= other.start_byte || current.start_byte >= otherEnd);
      if (overlap) {
        errors.push(`Table '${current.table_name}' overlaps with '${other.table_name}'`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate that the provided ArrayBuffer represents a valid Parquet file slice:
 * - Checks last 4 bytes for 'PAR1' magic
 * - Reads footer size (little-endian uint32) and ensures bounds
 * - Reconstructs minimal buffer [footer][size][PAR1] and parses via hyparquet
 * 
 * NOTE: Tables with numRows=0 are valid Parquet files but have no data.
 * They are skipped at the server-side filtering stage (filterEmptyTables).
 * This function will return true for empty Parquet files as they are structurally valid.
 */
function validateParquetSliceWithHyparquet(buffer: ArrayBuffer): boolean {
  try {
    const view = new Uint8Array(buffer);
    if (view.length < 8) {
      console.warn('[OffsetExtractor] Slice too small to contain Parquet trailer (size + magic)');
      return false;
    }

    // Check header magic at start as well
    if (view.length >= 4) {
      const headerMagic = String.fromCharCode(view[0], view[1], view[2], view[3]);
      if (headerMagic !== 'PAR1') {
        console.warn(`[OffsetExtractor] Invalid header magic at slice start: '${headerMagic}'`);
        return false;
      }
    }

    // Read magic 'PAR1'
    const magic = String.fromCharCode(view[view.length - 4], view[view.length - 3], view[view.length - 2], view[view.length - 1]);
    if (magic !== 'PAR1') {
      console.warn(`[OffsetExtractor] Invalid magic at slice end: '${magic}'`);
      return false;
    }

    // Read footer size (little-endian uint32) from the 4 bytes before magic
    const sizeBytes = view.slice(view.length - 8, view.length - 4);
    const footerSize = (sizeBytes[0]) | (sizeBytes[1] << 8) | (sizeBytes[2] << 16) | (sizeBytes[3] << 24);
    if (footerSize <= 0) {
      console.warn(`[OffsetExtractor] Invalid footer size: ${footerSize}`);
      return false;
    }

    const footerStart = view.length - 8 - footerSize;
    if (footerStart < 0) {
      console.warn(`[OffsetExtractor] Footer start is negative: ${footerStart}`);
      return false;
    }

    const footer = view.slice(footerStart, footerStart + footerSize);

    // Build synthetic buffer: [footer][size(4B LE)][PAR1]
    const synthetic = new Uint8Array(footer.length + 8);
    synthetic.set(footer, 0);
    synthetic[footer.length + 0] = (footerSize & 0xFF);
    synthetic[footer.length + 1] = ((footerSize >> 8) & 0xFF);
    synthetic[footer.length + 2] = ((footerSize >> 16) & 0xFF);
    synthetic[footer.length + 3] = ((footerSize >> 24) & 0xFF);
    synthetic[footer.length + 4] = 'P'.charCodeAt(0);
    synthetic[footer.length + 5] = 'A'.charCodeAt(0);
    synthetic[footer.length + 6] = 'R'.charCodeAt(0);
    synthetic[footer.length + 7] = '1'.charCodeAt(0);

    // Parse with hyparquet; if it throws, validation fails
    const md = parquetMetadata(synthetic.buffer);
    
    // CHANGE: Allow zero row groups (empty tables are valid Parquet files)
    // These should have been filtered out at server-side, but if they slip through,
    // we still accept them as structurally valid
    const rgCount = Array.isArray(md.row_groups) ? md.row_groups.length : 0;
    
    // No need to log for empty tables - they are valid Parquet files
    return true; // Accept even if rgCount === 0 (empty table)
  } catch (err) {
    console.warn('[OffsetExtractor] hyparquet metadata parse failed for slice:', err);
    return false;
  }
}
