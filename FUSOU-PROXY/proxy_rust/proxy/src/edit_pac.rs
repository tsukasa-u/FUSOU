use std::fs;
use regex::Regex;

pub fn edit_pac(path: &str, addr: &str) {
    let pac_file = fs::read_to_string(path).expect("Unable to read file");

    let re = Regex::new(r"return .PROXY 127\.0\.0\.1:[0-9]+.;\s*//\s*\[REPLACE\s+ADDR\s+WORLD:80\]").unwrap();
    let content = format!("return \"PROXY {}\"; // [REPLACE ADDR WORLD:80]", addr);
    let replaced = re.replace(&pac_file, content);
    
    std::fs::write(path, replaced.to_string()).expect("Unable to write file");
}