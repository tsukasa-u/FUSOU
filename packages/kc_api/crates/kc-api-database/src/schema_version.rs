#[cfg(all(schema_since = "0.4.0", schema_until = "0.5.0"))]
pub const DATABASE_TABLE_VERSION: &str = "0.4.0";

#[cfg(all(schema_since = "0.5.0", schema_until = "0.5.1"))]
pub const DATABASE_TABLE_VERSION: &str = "0.5.0";

#[cfg(schema_since = "0.5.1")]
pub const DATABASE_TABLE_VERSION: &str = "0.5.1";

#[cfg(not(any(
    all(schema_since = "0.4.0", schema_until = "0.5.0"),
    all(schema_since = "0.5.0", schema_until = "0.5.1"),
    schema_since = "0.5.1",
)))]
compile_error!(
    "At least one schema version must be selected via schema_since/schema_until cfgs."
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_database_table_version_format() {
        // Validate DATABASE_TABLE_VERSION follows Semantic Versioning (MAJOR.MINOR.PATCH)
        let parts: Vec<&str> = DATABASE_TABLE_VERSION.split('.').collect();
        assert_eq!(
            parts.len(),
            3,
            "DATABASE_TABLE_VERSION must be MAJOR.MINOR.PATCH format (e.g., '0.5.1')"
        );

        // Validate MAJOR version
        assert!(
            parts[0].parse::<u32>().is_ok(),
            "MAJOR version must be a number, got '{}'",
            parts[0]
        );

        // Validate MINOR version
        assert!(
            parts[1].parse::<u32>().is_ok(),
            "MINOR version must be a number, got '{}'",
            parts[1]
        );

        // Validate PATCH version
        assert!(
            parts[2].parse::<u32>().is_ok(),
            "PATCH version must be a number, got '{}'",
            parts[2]
        );
    }

    #[test]
    fn test_major_bump_required_for_breaking_schema_changes() {
        // If the crate is compiled with the 'breaking_schema' feature,
        // enforce a MAJOR version bump (>= 1) for DATABASE_TABLE_VERSION.
        // This guards against forgetting to bump to 1.0+ on incompatible schema changes.
        #[cfg(feature = "breaking_schema")]
        {
            let parts: Vec<&str> = DATABASE_TABLE_VERSION.split('.').collect();
            assert!(
                parts.len() >= 1,
                "DATABASE_TABLE_VERSION must have MAJOR.MINOR.PATCH format"
            );
            let major: u32 = parts[0]
                .parse()
                .expect("MAJOR version must be a number for DATABASE_TABLE_VERSION");
            assert!(
                major >= 1,
                "Breaking schema changes require MAJOR bump: set DATABASE_TABLE_VERSION to '1.0' or higher"
            );
        }
    }
}
