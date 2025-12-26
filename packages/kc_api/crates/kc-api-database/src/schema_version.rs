/// Database table version: KanColle game data structure version
/// 
/// This version tracks changes to the game data schema (PortTable, EnvInfo, etc.)
/// Updates when KanColle game mechanics introduce new data fields or structures.
/// 
/// Format: MAJOR.MINOR (Semantic Versioning)
/// - MAJOR: Breaking changes (existing field removed)
/// - MINOR: Compatible changes (new field added)
pub const DATABASE_TABLE_VERSION: &str = "0.4";

/// Schema version constants for battle data storage
/// 
/// These versions control the R2 storage path structure and should be
/// synchronized with the client application's Avro schema generation.
/// 
/// Usage in client code:
/// ```rust
/// let version = kc_api_database::SCHEMA_VERSION;
/// ```

#[cfg(feature = "schema_v1")]
pub const SCHEMA_VERSION: &str = "v1";

#[cfg(feature = "schema_v2")]
pub const SCHEMA_VERSION: &str = "v2";

#[cfg(not(any(feature = "schema_v1", feature = "schema_v2")))]
compile_error!("Must enable either 'schema_v1' or 'schema_v2' feature");

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
    fn test_schema_version_defined() {
        // Ensure SCHEMA_VERSION is properly defined (feature gate enforces this)
        let schema_v = SCHEMA_VERSION;
        assert!(!schema_v.is_empty(), "SCHEMA_VERSION must not be empty");
        assert!(
            schema_v.starts_with('v'),
            "SCHEMA_VERSION must start with 'v', got '{}'",
            schema_v
        );
    }

    #[test]
    fn test_version_independence() {
        // Verify that DATABASE_TABLE_VERSION and SCHEMA_VERSION are independent
        // (both can be modified without affecting the other)
        assert_ne!(
            DATABASE_TABLE_VERSION, SCHEMA_VERSION,
            "DATABASE_TABLE_VERSION and SCHEMA_VERSION should be independent formats"
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
            assert!(parts.len() >= 1, "DATABASE_TABLE_VERSION must have MAJOR.MINOR format");
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
