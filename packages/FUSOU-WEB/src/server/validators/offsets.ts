export interface TableOffsetMetadata {
  table_name: string;
  start_byte: number;
  byte_length: number;
  format: string;
}

export function validateOffsetMetadata(
  offsets: TableOffsetMetadata[],
  totalFileSize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!Array.isArray(offsets) || offsets.length === 0) {
    errors.push('No offset entries found');
    return { valid: false, errors };
  }

  for (let i = 0; i < offsets.length; i++) {
    const current = offsets[i];

    if (typeof current.start_byte !== 'number' || typeof current.byte_length !== 'number') {
      errors.push(`Table '${current.table_name}' has non-numeric offsets`);
      continue;
    }

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
    errors,
  };
}
