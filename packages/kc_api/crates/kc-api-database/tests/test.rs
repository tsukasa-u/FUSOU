#![cfg(test)]

mod check_database_dependency;
mod check_database_dependency_syn;

#[test]
fn test_database_dependency() {
    check_database_dependency::check_database_dependency();
}

#[test]
fn test_database_dependency_syn() {
    check_database_dependency_syn::check_database_dependency_syn();
}
