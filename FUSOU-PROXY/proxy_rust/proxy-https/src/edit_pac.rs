use std::fs;
use regex::Regex;

// possibly the process of editing the pac file drive the compiler to rebuild the project, that means the project re build twice in frontend. It induce the late of display window and rendering.

pub fn edit_pac(path: &str, addr: &str, host: Option<&str>) {
    let pac_file = include_str!("../proxy_auto.pac").to_string();
    // let pac_file = fs::read_to_string(path).expect("Unable to read file");

    let re = Regex::new(r"return .PROXY 127\.0\.0\.1:[0-9]+.;\s*//\s*\[REPLACE\s+ADDR\]").unwrap();
    let content = format!("return \"PROXY {}\"; // [REPLACE ADDR]", addr);
    let replaced = re.replace(&pac_file, content).to_string();
    
    if let Some(host) = host {
        let re = Regex::new(r#"if \(shExpMatch\(host, ".*"\)( \|\|\r?\n\s*shExpMatch\(host, ".*"\))*\) \{ // \[REPLACE HOST\]"#).unwrap();
        let content = format!(r#"if (shExpMatch(host, "{}")) {{ // [REPLACE HOST]"#, host);
        let replaced = re.replace(&replaced, content).to_string();
        
        std::fs::write(path, replaced).expect("Unable to write file");
    } else {
        std::fs::write(path, replaced).expect("Unable to write file");
    }
}