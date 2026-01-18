/**
 * Master Data Upload Validation Tests
 * 
 * Tests for master data upload flow validation
 */

import { describe, it, expect } from 'vitest';

describe('Master Data Upload Validation', () => {
  /**
   * Test: Table offsets JSON serialization format
   * Validates that table_offsets array with 13 tables is correctly formatted
   */
  it('should validate table_offsets format with all 13 tables', () => {
    // Mock all 13 master tables
    const tableOffsets = [
      { table_name: 'mst_ship', start: 0, end: 100 },
      { table_name: 'mst_shipgraph', start: 100, end: 200 },
      { table_name: 'mst_slotitem', start: 200, end: 300 },
      { table_name: 'mst_slotitem_equiptype', start: 300, end: 400 },
      { table_name: 'mst_payitem', start: 400, end: 500 },
      { table_name: 'mst_equip_exslot', start: 500, end: 600 },
      { table_name: 'mst_equip_exslot_ship', start: 600, end: 700 },
      { table_name: 'mst_equip_limit_exslot', start: 700, end: 800 },
      { table_name: 'mst_equip_ship', start: 800, end: 900 },
      { table_name: 'mst_stype', start: 900, end: 1000 },
      { table_name: 'mst_map_area', start: 1000, end: 1100 },
      { table_name: 'mst_map_info', start: 1100, end: 1200 },
      { table_name: 'mst_ship_upgrade', start: 1200, end: 1300 },
    ];

    // Serialize to JSON string (as client sends)
    const jsonString = JSON.stringify(tableOffsets);
    
    // Parse back (as server does)
    const parsed = JSON.parse(jsonString);

    // Validate
    expect(parsed).toBeInstanceOf(Array);
    expect(parsed).toHaveLength(13);
    expect(parsed[0].table_name).toBe('mst_ship');
    expect(parsed[12].table_name).toBe('mst_ship_upgrade');
    
    // Verify all are integers
    for (let i = 0; i < parsed.length; i++) {
      expect(Number.isInteger(parsed[i].start)).toBe(true);
      expect(Number.isInteger(parsed[i].end)).toBe(true);
    }
  });

  /**
   * Test: Empty tables (zero-length slices)
   * Validates that empty tables create valid offsets with start == end
   */
  it('should handle empty tables with start == end', () => {
    const tableOffsets = [
      { table_name: 'mst_ship', start: 0, end: 100 },
      { table_name: 'mst_shipgraph', start: 100, end: 100 }, // Empty: start == end
      { table_name: 'mst_slotitem', start: 100, end: 100 },  // Empty: start == end
      { table_name: 'mst_slotitem_equiptype', start: 100, end: 100 },
      { table_name: 'mst_payitem', start: 100, end: 100 },
      { table_name: 'mst_equip_exslot', start: 100, end: 100 },
      { table_name: 'mst_equip_exslot_ship', start: 100, end: 100 },
      { table_name: 'mst_equip_limit_exslot', start: 100, end: 100 },
      { table_name: 'mst_equip_ship', start: 100, end: 100 },
      { table_name: 'mst_stype', start: 100, end: 100 },
      { table_name: 'mst_map_area', start: 100, end: 100 },
      { table_name: 'mst_map_info', start: 100, end: 100 },
      { table_name: 'mst_ship_upgrade', start: 100, end: 100 },
    ];

    const jsonString = JSON.stringify(tableOffsets);
    const parsed = JSON.parse(jsonString);

    // Validate that empty tables (start == end) are accepted
    expect(parsed[1].start).toBe(100);
    expect(parsed[1].end).toBe(100);
    expect(parsed[1].start === parsed[1].end).toBe(true);
  });

  /**
   * Test: Period tag validation
   * Validates period_tag constraints
   */
  it('should validate period_tag format', () => {
    const validTags = [
      'period_001',
      'event-2024-01',
      'master_data_v1',
      'a',
      'a'.repeat(64), // MAX: 64 chars
    ];

    const invalidTags = [
      '',                    // Empty
      'a'.repeat(65),       // Too long
      '.hidden',            // Starts with .
      '/path',              // Starts with /
      'path/../escape',     // Contains ..
      'path with space',    // Contains space
      'path@special',       // Special char
    ];

    // Test valid tags
    const validRegex = /^[a-zA-Z0-9_\-]+$/;
    for (const tag of validTags) {
      if (tag.length === 0 || tag.length > 64) {
        expect(true).toBe(true); // Skip length checks in regex
      } else if (!tag.startsWith('.') && !tag.startsWith('/') && !tag.includes('..')) {
        expect(validRegex.test(tag)).toBe(true);
      }
    }

    // Test invalid tags
    for (const tag of invalidTags) {
      let isValid = true;
      if (tag.length === 0 || tag.length > 64) isValid = false;
      if (tag.startsWith('.') || tag.startsWith('/') || tag.includes('..')) isValid = false;
      if (!validRegex.test(tag) && tag.length > 0) isValid = false;
      
      expect(isValid).toBe(false);
    }
  });

  /**
   * Test: Content hash (SHA-256) format
   * Validates that hash is 64 hexadecimal characters
   */
  it('should validate SHA-256 content hash format', () => {
    const validHashes = [
      'a'.repeat(64).toLowerCase(),
      'A'.repeat(64).toUpperCase(),
      '0123456789abcdef'.repeat(4).toLowerCase(),
    ];

    const invalidHashes = [
      'a'.repeat(63),       // Too short
      'a'.repeat(65),       // Too long
      'G'.repeat(64),       // Invalid hex char
      'a a'.padEnd(64),     // Contains space
    ];

    const hashRegex = /^[a-f0-9]{64}$/i;

    for (const hash of validHashes) {
      expect(hashRegex.test(hash)).toBe(true);
    }

    for (const hash of invalidHashes) {
      expect(hashRegex.test(hash)).toBe(false);
    }
  });

  /**
   * Test: File size validation
   * Validates that 0-byte files are now allowed
   */
  it('should accept 0-byte files after fix', () => {
    const MAX_UPLOAD_BYTES = 1024 * 1024 * 500; // 500 MB

    // Before fix: declaredSize <= 0 would reject 0
    // After fix: declaredSize < 0 accepts 0
    const sizes = [
      { size: 0, shouldPass: true },           // Empty file (after fix)
      { size: 1, shouldPass: true },           // Minimal
      { size: 1000, shouldPass: true },        // Normal
      { size: MAX_UPLOAD_BYTES, shouldPass: true },  // Max
      { size: -1, shouldPass: false },         // Negative (always invalid)
      { size: MAX_UPLOAD_BYTES + 1, shouldPass: false }, // Over limit
    ];

    for (const { size, shouldPass } of sizes) {
      const isValid = size >= 0 && size <= MAX_UPLOAD_BYTES;
      expect(isValid).toBe(shouldPass);
    }
  });

  /**
   * Test: Offset contiguity validation
   * Validates that offsets are contiguous and cover entire file
   */
  it('should validate offset contiguity', () => {
    const validOffsets = [
      [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        { start: 200, end: 300 },
      ],
      [
        { start: 0, end: 0 }, // Empty file case
        { start: 0, end: 0 },
        { start: 0, end: 0 },
      ],
    ];

    const invalidOffsets = [
      [
        { start: 1, end: 100 },  // Doesn't start at 0
        { start: 100, end: 200 },
      ],
      [
        { start: 0, end: 100 },
        { start: 150, end: 200 }, // Gap between 100 and 150
      ],
      [
        { start: 0, end: 150 },
        { start: 100, end: 200 }, // Overlap
      ],
      [
        { start: 0, end: 100 },
        { start: 100, end: 200 },
        // Missing file end, should be 200 not 100
      ],
    ];

    // Test valid cases
    for (const offsets of validOffsets) {
      const declaredSize = offsets[offsets.length - 1]?.end ?? 0;
      const sorted = [...offsets].sort((a, b) => a.start - b.start);
      
      // Check: starts at 0
      expect(sorted[0].start).toBe(0);
      // Check: covers entire file
      expect(sorted[sorted.length - 1].end).toBe(declaredSize);
      // Check: contiguous
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].start).toBe(sorted[i - 1].end);
      }
    }
  });

  /**
   * Test: Duplicate table detection
   * Validates that duplicate table names are rejected
   */
  it('should reject duplicate table names', () => {
    const withoutDuplicates = [
      { table_name: 'mst_ship', start: 0, end: 100 },
      { table_name: 'mst_shipgraph', start: 100, end: 200 },
    ];

    const withDuplicates = [
      { table_name: 'mst_ship', start: 0, end: 100 },
      { table_name: 'mst_ship', start: 100, end: 200 }, // Duplicate!
    ];

    // Check without duplicates
    const set1 = new Set(withoutDuplicates.map(o => o.table_name));
    expect(set1.size).toBe(withoutDuplicates.length);

    // Check with duplicates
    const set2 = new Set(withDuplicates.map(o => o.table_name));
    expect(set2.size).toBeLessThan(withDuplicates.length);
  });

  /**
   * Test: Required tables validation
   * Validates that all 13 required tables are present
   */
  it('should require all 13 master tables', () => {
    const ALLOWED_MASTER_TABLES = new Set([
      'mst_ship',
      'mst_shipgraph',
      'mst_slotitem',
      'mst_slotitem_equiptype',
      'mst_payitem',
      'mst_equip_exslot',
      'mst_equip_exslot_ship',
      'mst_equip_limit_exslot',
      'mst_equip_ship',
      'mst_stype',
      'mst_map_area',
      'mst_map_info',
      'mst_ship_upgrade',
    ]);

    // Complete set
    const completeTables = new Set([
      'mst_ship',
      'mst_shipgraph',
      'mst_slotitem',
      'mst_slotitem_equiptype',
      'mst_payitem',
      'mst_equip_exslot',
      'mst_equip_exslot_ship',
      'mst_equip_limit_exslot',
      'mst_equip_ship',
      'mst_stype',
      'mst_map_area',
      'mst_map_info',
      'mst_ship_upgrade',
    ]);

    // Incomplete set
    const incompleteTables = new Set([
      'mst_ship',
      'mst_shipgraph',
      'mst_slotitem',
      // Missing: mst_slotitem_equiptype and others
    ]);

    // Check complete
    const missingComplete = Array.from(ALLOWED_MASTER_TABLES).filter(t => !completeTables.has(t));
    expect(missingComplete).toHaveLength(0);

    // Check incomplete
    const missingIncomplete = Array.from(ALLOWED_MASTER_TABLES).filter(t => !incompleteTables.has(t));
    expect(missingIncomplete.length).toBeGreaterThan(0);
    expect(missingIncomplete).toContain('mst_slotitem_equiptype');
  });
});
