// Keep each schema transition isolated in its own module.
mod v0_5_0_to_0_5_1;
mod v0_to_0_5_0;

use std::io;

#[derive(Debug, PartialEq, Eq, Clone)]
pub(super) enum ConfigVersion {
    LegacyV0,
    Crate(semver::Version),
}

impl ConfigVersion {
    pub(super) fn label(&self) -> String {
        match self {
            Self::LegacyV0 => "v0".to_string(),
            Self::Crate(version) => version.to_string(),
        }
    }
}

pub(super) fn read_config_version(
    document: &toml_edit::DocumentMut,
) -> Result<ConfigVersion, Box<dyn std::error::Error>> {
    let Some(version) = document.get("version") else {
        return Ok(ConfigVersion::LegacyV0);
    };
    let version = version
        .as_value()
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Config schema version must be a string",
            )
        })?;
    match version {
        "v0" => Ok(ConfigVersion::LegacyV0),
        _ => Ok(ConfigVersion::Crate(semver::Version::parse(version)?)),
    }
}

type MigrationResult = Result<(), Box<dyn std::error::Error>>;
type MigrationFn = fn(&mut toml_edit::DocumentMut, &mut Vec<&'static str>) -> MigrationResult;

struct Migration {
    from: Option<&'static str>,
    to: &'static str,
    apply: MigrationFn,
}

impl Migration {
    fn matches_source(&self, version: &ConfigVersion) -> bool {
        match (self.from, version) {
            (None, ConfigVersion::LegacyV0) => true,
            (Some(expected), ConfigVersion::Crate(actual)) => actual.to_string() == expected,
            _ => false,
        }
    }
}

// Register one step per schema transition, ending at the configs crate version.
const MIGRATIONS: &[Migration] = &[
    Migration {
        from: None,
        to: "0.5.0",
        apply: v0_to_0_5_0::migrate,
    },
    Migration {
        from: Some("0.5.0"),
        to: "0.5.1",
        apply: v0_5_0_to_0_5_1::migrate,
    },
];

pub(super) fn migrate_config(
    document: &mut toml_edit::DocumentMut,
    source_version: &ConfigVersion,
    current_version: &semver::Version,
) -> Result<Vec<&'static str>, Box<dyn std::error::Error>> {
    migrate_config_with_steps(document, source_version, current_version, MIGRATIONS)
}

fn migrate_config_with_steps(
    document: &mut toml_edit::DocumentMut,
    source_version: &ConfigVersion,
    current_version: &semver::Version,
    migrations: &[Migration],
) -> Result<Vec<&'static str>, Box<dyn std::error::Error>> {
    let mut version = source_version.clone();
    let mut changes = Vec::new();

    while version != ConfigVersion::Crate(current_version.clone()) {
        if let ConfigVersion::Crate(version) = &version {
            if version > current_version {
                return Err(Box::new(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Config version {version} is newer than configs crate version {current_version}"
                    ),
                )));
            }
        }

        let migration = migrations
            .iter()
            .find(|migration| migration.matches_source(&version))
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "No config migration registered from {} to {current_version}",
                        version.label()
                    ),
                )
            })?;
        let target_version = semver::Version::parse(migration.to)?;

        if let ConfigVersion::Crate(version) = &version {
            if target_version <= *version {
                return Err(Box::new(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Config migration from {version} must target a newer version, not {target_version}"
                    ),
                )));
            }
        }
        if target_version > *current_version {
            return Err(Box::new(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Config migration target {target_version} is newer than configs crate version {current_version}"
                ),
            )));
        }

        (migration.apply)(document, &mut changes)?;
        version = ConfigVersion::Crate(target_version);
    }

    Ok(changes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record_legacy_migration(
        _document: &mut toml_edit::DocumentMut,
        changes: &mut Vec<&'static str>,
    ) -> MigrationResult {
        changes.push("v0->0.5.0");
        Ok(())
    }

    fn record_next_migration(
        _document: &mut toml_edit::DocumentMut,
        changes: &mut Vec<&'static str>,
    ) -> MigrationResult {
        changes.push("0.5.0->0.6.0");
        Ok(())
    }

    #[test]
    fn migration_chain_applies_each_transition_in_order() {
        let test_migrations = [
            Migration {
                from: None,
                to: "0.5.0",
                apply: record_legacy_migration,
            },
            Migration {
                from: Some("0.5.0"),
                to: "0.6.0",
                apply: record_next_migration,
            },
        ];
        let mut document = "".parse::<toml_edit::DocumentMut>().unwrap();
        let changes = migrate_config_with_steps(
            &mut document,
            &ConfigVersion::LegacyV0,
            &semver::Version::new(0, 6, 0),
            &test_migrations,
        )
        .unwrap();

        assert_eq!(changes, ["v0->0.5.0", "0.5.0->0.6.0"]);
    }

    #[test]
    fn latest_migration_target_matches_configs_crate_version() {
        let current_version = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        let latest_target = MIGRATIONS
            .iter()
            .map(|migration| semver::Version::parse(migration.to).unwrap())
            .max()
            .unwrap();

        assert_eq!(latest_target, current_version);
    }
}
