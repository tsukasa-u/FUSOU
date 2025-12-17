/**
 * Table Offset Extractor
 * Handles parsing and extraction of individual tables from concatenated Parquet files
 */

export interface TableOffsetMetadata {
  table_name: string;
  start_byte: number;
  byte_length: number;
  format: string;
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

  try {
    // Use R2 Range request to read only the target table portion
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

    console.log(`[OffsetExtractor] Extracted table '${targetTable}' from ${fragmentKey}: ${data.byteLength} bytes`);

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
