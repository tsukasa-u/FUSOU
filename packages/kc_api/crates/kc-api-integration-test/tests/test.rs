#![cfg(test)]

mod check_database_field_size;

#[test]
fn test_database_number_size() {
    check_database_field_size::check_database_field_size();
}
