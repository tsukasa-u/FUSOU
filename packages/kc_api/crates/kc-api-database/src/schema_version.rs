#[cfg(feature = "schema_v0_4")]
pub const DATABASE_TABLE_VERSION: &str = "0.4";

#[cfg(feature = "schema_v0_5")]
pub const DATABASE_TABLE_VERSION: &str = "0.5";

#[cfg(feature = "schema_v0_6")]
pub const DATABASE_TABLE_VERSION: &str = "0.6";

#[cfg(not(any(
    feature = "schema_v0_4",
    feature = "schema_v0_5",
    feature = "schema_v0_6"
)))]
compile_error!(
    "At least one schema version feature must be enabled (schema_v0_4, schema_v0_5, or schema_v0_6). \
     Add e.g. `--features schema_v0_4` or use default features."
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_database_table_version_format() {
        // Validate DATABASE_TABLE_VERSION follows Semantic Versioning (MAJOR.MINOR)
        let parts: Vec<&str> = DATABASE_TABLE_VERSION.split('.').collect();
        assert_eq!(
            parts.len(),
            2,
            "DATABASE_TABLE_VERSION must be MAJOR.MINOR format (e.g., '0.4')"
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
                "DATABASE_TABLE_VERSION must have MAJOR.MINOR format"
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
