// Common logic for resolving table data from encoded tables

use kc_api::database::table::{GetDataTableEncode, GetDataTableEnum, PortTableEncode, PortTableEnum};

/// Iterator over all get_data tables with their names and byte contents.
///
/// Iteration order follows `GetDataTableEnum`'s declaration (`Ord`) order.
pub struct GetDataTableIterator<'a> {
    table: &'a GetDataTableEncode,
    variants: std::slice::Iter<'static, GetDataTableEnum>,
}

impl<'a> GetDataTableIterator<'a> {
    pub fn new(table: &'a GetDataTableEncode) -> Self {
        Self {
            table,
            variants: GetDataTableEnum::variants().iter(),
        }
    }
}

impl<'a> Iterator for GetDataTableIterator<'a> {
    type Item = (&'static str, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        for variant in self.variants.by_ref().copied() {
            if let Some(bytes) = self.table.get(variant) {
                return Some((variant.table_name(), bytes));
            }
        }
        None
    }
}

/// Iterator over all port tables with their names and byte contents.
///
/// Iteration order follows `PortTableEnum`'s declaration (`Ord`) order.
pub struct PortTableIterator<'a> {
    table: &'a PortTableEncode,
    variants: std::slice::Iter<'static, PortTableEnum>,
}

impl<'a> PortTableIterator<'a> {
    pub fn new(table: &'a PortTableEncode) -> Self {
        Self {
            table,
            variants: PortTableEnum::variants().iter(),
        }
    }
}

impl<'a> Iterator for PortTableIterator<'a> {
    type Item = (&'static str, &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        for variant in self.variants.by_ref().copied() {
            if let Some(bytes) = self.table.get(variant) {
                return Some((variant.table_name(), bytes));
            }
        }
        None
    }
}

/// Get an iterator over all get_data tables
pub fn get_all_get_data_tables(table: &GetDataTableEncode) -> GetDataTableIterator<'_> {
    GetDataTableIterator::new(table)
}

/// Get an iterator over all port tables
pub fn get_all_port_tables(table: &PortTableEncode) -> PortTableIterator<'_> {
    PortTableIterator::new(table)
}

/// Resolve byte content for a specific get_data table by name
pub fn resolve_get_data_bytes<'a>(
    table: &'a GetDataTableEncode,
    table_name: &str,
) -> Option<&'a [u8]> {
    let variant = table_name.parse::<GetDataTableEnum>().ok()?;
    table.get(variant)
}

/// Resolve byte content for a specific port table by name
pub fn resolve_port_table_bytes<'a>(
    table: &'a PortTableEncode,
    table_name: &str,
) -> Option<&'a [u8]> {
    let variant = table_name.parse::<PortTableEnum>().ok()?;
    table.get(variant)
}
