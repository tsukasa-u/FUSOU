
#[macro_export]
macro_rules! my_macro {
    ($x:expr) => {
        println!("The value is: {}", $x);
    };
}