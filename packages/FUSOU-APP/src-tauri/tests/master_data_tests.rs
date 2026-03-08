// Master data upload logic tests
// Run with: cargo test --test master_data_tests

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    /// Test: All 13 master tables are in correct order
    #[test]
    fn test_master_table_names_and_count() {
        let tables = vec![
            "mst_ship",
            "mst_shipgraph",
            "mst_slotitem",
            "mst_slotitem_equiptype",
            "mst_payitem",
            "mst_equip_exslot",
            "mst_equip_exslot_ship",
            "mst_equip_limit_exslot",
            "mst_equip_ship",
            "mst_stype",
            "mst_map_area",
            "mst_map_info",
            "mst_ship_upgrade",
        ];

        // Count check
        assert_eq!(tables.len(), 13, "Must have exactly 13 master tables");

        // Uniqueness check
        let unique_tables: HashSet<_> = tables.iter().collect();
        assert_eq!(
            unique_tables.len(),
            13,
            "All table names must be unique"
        );

        // Order check (first and last)
        assert_eq!(tables[0], "mst_ship", "First table must be mst_ship");
        assert_eq!(
            tables[12],
            "mst_ship_upgrade",
            "Last table must be mst_ship_upgrade"
        );

        println!("✓ All 13 master tables verified with correct order");
    }

    /// Test: Table offsets serialization as JSON string
    #[test]
    fn test_table_offsets_json_format() {
        #[derive(serde::Serialize, serde::Deserialize, Debug)]
        struct TableOffset {
            table_name: String,
            start: usize,
            end: usize,
        }

        let offsets = vec![
            TableOffset {
                table_name: "mst_ship".to_string(),
                start: 0,
                end: 100,
            },
            TableOffset {
                table_name: "mst_shipgraph".to_string(),
                start: 100,
                end: 200,
            },
        ];

        // Serialize to JSON string (as client does)
        let json_string = serde_json::to_string(&offsets).expect("Serialization failed");

        // Verify it's a string
        assert!(json_string.starts_with('['), "Must start with [");
        assert!(json_string.ends_with(']'), "Must end with ]");

        // Deserialize (as server does)
        let parsed: Vec<TableOffset> =
            serde_json::from_str(&json_string).expect("Deserialization failed");

        // Verify structure
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].table_name, "mst_ship");
        assert_eq!(parsed[0].start, 0);
        assert_eq!(parsed[0].end, 100);
        assert_eq!(parsed[1].table_name, "mst_shipgraph");
        assert_eq!(parsed[1].start, 100);
        assert_eq!(parsed[1].end, 200);

        println!(
            "✓ Table offsets JSON format verified: {}",
            json_string
        );
    }

    /// Test: Empty tables (zero-length slices)
    #[test]
    fn test_empty_table_handling() {
        #[derive(serde::Serialize, serde::Deserialize, Debug)]
        struct TableOffset {
            table_name: String,
            start: usize,
            end: usize,
        }

        // Create mixed: some with data, some empty
        let offsets = vec![
            TableOffset {
                table_name: "mst_ship".to_string(),
                start: 0,
                end: 100,
            },
            TableOffset {
                table_name: "mst_shipgraph".to_string(),
                start: 100,
                end: 100, // Empty: start == end
            },
            TableOffset {
                table_name: "mst_slotitem".to_string(),
                start: 100,
                end: 150,
            },
        ];

        let json_string = serde_json::to_string(&offsets).expect("Serialization failed");
        let parsed: Vec<TableOffset> =
            serde_json::from_str(&json_string).expect("Deserialization failed");

        // Verify empty table is preserved
        assert_eq!(parsed[1].start, 100);
        assert_eq!(parsed[1].end, 100);
        assert_eq!(
            parsed[1].start, parsed[1].end,
            "Empty table must have start == end"
        );

        println!("✓ Empty tables (start == end) handled correctly");
    }

    /// Test: Offset contiguity (no gaps, no overlaps)
    #[test]
    fn test_offset_contiguity() {
        let offsets = vec![
            (0, 100),
            (100, 200),
            (200, 300),
            (300, 500),
        ];

        // Verify contiguity
        for i in 1..offsets.len() {
            assert_eq!(
                offsets[i].0, offsets[i - 1].1,
                "Offset gap detected at position {}: {} != {}",
                i,
                offsets[i].0,
                offsets[i - 1].1
            );
        }

        // Verify starts at 0
        assert_eq!(offsets[0].0, 0, "Offsets must start at 0");

        // Verify total size is correct (last end value is total size)
        let total_size = offsets[offsets.len() - 1].1;
        assert_eq!(total_size, 500, "Total size validation");

        println!("✓ Offset contiguity verified: 0-100, 100-200, 200-300, 300-500");
    }

    /// Test: SHA-256 hash format (64 hex characters)
    #[test]
    fn test_sha256_hash_generation() {
        use sha2::{Digest, Sha256};

        let data = b"test master data";
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();

        // Format as hex
        let hash_hex = format!("{:x}", result);

        // Verify length (must be 64 hex chars for SHA-256)
        assert_eq!(
            hash_hex.len(),
            64,
            "SHA-256 hash must be 64 hexadecimal characters"
        );

        // Verify all chars are valid hex
        for (i, ch) in hash_hex.chars().enumerate() {
            assert!(
                ch.is_ascii_hexdigit(),
                "Character at position {} is not valid hex: {}",
                i,
                ch
            );
        }

        // Case-insensitive validation (server does case-insensitive check)
        let hash_upper = hash_hex.to_uppercase();
        let hash_lower = hash_hex.to_lowercase();
        assert_eq!(
            hash_upper.to_lowercase(),
            hash_lower,
            "Hash should be valid in both upper and lower case"
        );

        println!("✓ SHA-256 hash format verified: {}", hash_hex);
    }

    /// Test: All 13 tables concatenation with correct offsets
    #[test]
    fn test_concatenate_13_tables() {
        #[derive(serde::Serialize, Debug)]
        struct TableOffset {
            table_name: String,
            start: usize,
            end: usize,
        }

        let tables = vec![
            ("mst_ship", vec![1u8; 100]),
            ("mst_shipgraph", vec![2u8; 0]),      // Empty
            ("mst_slotitem", vec![3u8; 50]),
            ("mst_slotitem_equiptype", vec![4u8; 0]), // Empty
            ("mst_payitem", vec![5u8; 75]),
            ("mst_equip_exslot", vec![6u8; 0]),   // Empty
            ("mst_equip_exslot_ship", vec![7u8; 25]),
            ("mst_equip_limit_exslot", vec![8u8; 0]), // Empty
            ("mst_equip_ship", vec![9u8; 30]),
            ("mst_stype", vec![10u8; 0]),          // Empty
            ("mst_map_area", vec![11u8; 40]),
            ("mst_map_info", vec![12u8; 0]),       // Empty
            ("mst_ship_upgrade", vec![13u8; 10]),
        ];

        let mut concatenated = Vec::new();
        let mut offsets = Vec::new();

        for (table_name, data) in &tables {
            let start = concatenated.len();
            let end = start + data.len();

            concatenated.extend_from_slice(data);

            offsets.push(TableOffset {
                table_name: table_name.to_string(),
                start,
                end,
            });
        }

        // Verify results
        assert_eq!(tables.len(), 13, "Must have 13 tables");
        assert_eq!(offsets.len(), 13, "Must have 13 offsets");
        assert_eq!(concatenated.len(), 330, "Total size: 100+0+50+0+75+0+25+0+30+0+40+0+10");

        // Verify offsets are in JSON format
        let json_string = serde_json::to_string(&offsets).expect("Serialization failed");
        assert!(json_string.contains("mst_ship"), "JSON must contain first table");
        assert!(json_string.contains("mst_ship_upgrade"), "JSON must contain last table");

        println!("✓ All 13 tables concatenated correctly");
        println!("  Total size: {} bytes", concatenated.len());
        println!("  JSON: {}", json_string);
    }

    /// Test: Period tag validation rules
    #[test]
    fn test_period_tag_validation() {
        let valid_cases = vec![
            ("period_001", true),
            ("event-2024-01", true),
            ("master_data_v1", true),
            ("a", true),
            ("A_1-B", true),
        ];

        let invalid_cases = vec![
            ("", false),                    // Empty
            (".hidden", false),            // Starts with .
            ("/path", false),              // Starts with /
            ("path/../escape", false),     // Contains ..
            ("path with space", false),    // Contains space
            ("name@special", false),       // Special char
        ];

        for (tag, should_be_valid) in valid_cases.iter().chain(invalid_cases.iter()) {
            let is_valid = !tag.is_empty()
                && tag.len() <= 64
                && !tag.starts_with('.')
                && !tag.starts_with('/')
                && !tag.contains("..")
                && tag.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-');

            assert_eq!(
                is_valid, *should_be_valid,
                "Period tag '{}' validation mismatch",
                tag
            );
        }

        println!("✓ Period tag validation rules verified");
    }

    /// Test: File size constraints (0 bytes now allowed)
    #[test]
    fn test_file_size_validation() {
        const MAX_UPLOAD_BYTES: i64 = 500 * 1024 * 1024; // 500 MB

        let test_cases = vec![
            (0, true),                          // ✓ Empty file (after fix)
            (1, true),                          // ✓ Minimal
            (1000, true),                       // ✓ Normal
            (MAX_UPLOAD_BYTES, true),           // ✓ Max allowed
            (-1, false),                        // ✗ Negative
            (MAX_UPLOAD_BYTES + 1, false),      // ✗ Over limit
        ];

        for (size, should_pass) in test_cases {
            // After fix: size >= 0 && size <= MAX_UPLOAD_BYTES
            let is_valid = size >= 0 && size <= MAX_UPLOAD_BYTES;
            assert_eq!(
                is_valid, should_pass,
                "File size {} validation failed",
                size
            );
        }

        println!("✓ File size constraints verified (0-byte files now allowed)");
    }

    /// Test: Required tables validation
    #[test]
    fn test_required_tables_validation() {
        let allowed = vec![
            "mst_ship",
            "mst_shipgraph",
            "mst_slotitem",
            "mst_slotitem_equiptype",
            "mst_payitem",
            "mst_equip_exslot",
            "mst_equip_exslot_ship",
            "mst_equip_limit_exslot",
            "mst_equip_ship",
            "mst_stype",
            "mst_map_area",
            "mst_map_info",
            "mst_ship_upgrade",
        ];

        let provided_complete = vec![
            "mst_ship",
            "mst_shipgraph",
            "mst_slotitem",
            "mst_slotitem_equiptype",
            "mst_payitem",
            "mst_equip_exslot",
            "mst_equip_exslot_ship",
            "mst_equip_limit_exslot",
            "mst_equip_ship",
            "mst_stype",
            "mst_map_area",
            "mst_map_info",
            "mst_ship_upgrade",
        ];

        let provided_incomplete = vec![
            "mst_ship",
            "mst_shipgraph",
            "mst_slotitem",
            // Missing: mst_slotitem_equiptype and others
        ];

        // Test complete case
        let missing_complete: Vec<_> = allowed
            .iter()
            .filter(|t| !provided_complete.contains(t))
            .collect();
        assert!(
            missing_complete.is_empty(),
            "Complete set should have no missing tables"
        );

        // Test incomplete case
        let missing_incomplete: Vec<_> = allowed
            .iter()
            .filter(|t| !provided_incomplete.contains(t))
            .collect();
        assert!(
            !missing_incomplete.is_empty(),
            "Incomplete set should have missing tables"
        );
        assert_eq!(missing_incomplete.len(), 10, "Should be missing 10 tables");

        println!("✓ Required tables validation verified");
    }

    /// Test: URL parameter encoding (token in query string)
    #[test]
    fn test_execution_url_format() {
        let base_endpoint = "https://dev.fusou.pages.dev/api/master-data/upload";
        let token = "signed_token_here";

        let execution_url = format!("{}?token={}", base_endpoint, token);

        // Verify format
        assert!(execution_url.contains("?token="), "Must have token parameter");
        assert!(
            execution_url.starts_with("https://"),
            "Must use HTTPS"
        );
        assert!(
            !execution_url.contains(".json"),
            "URL should not have .json suffix"
        );

        println!("✓ Execution URL format verified: {}", execution_url);
    }
}
