#![cfg(test)]

mod check_database_dependency;

#[test]
fn test_database_dependency() {
    check_database_dependency::check_database_dependency();
}
