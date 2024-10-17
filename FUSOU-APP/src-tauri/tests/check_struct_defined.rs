use std::{collections::HashSet, hash::RandomState, path};
use confy;
use serde::{Deserialize, Serialize};

use register_macro_derive_and_attr::add_field;

use register_trait::REGISTER_STRUCT;

#[add_field(struct_name)]
#[derive(Default, Debug, Clone, Serialize, Deserialize)]
struct TestConfig {}

pub fn check_struct_defined(target_path: String) {
    
    let target = path::PathBuf::from(target_path);
    let files = target.read_dir().expect( "read_dir call failed");
    let mut books = HashSet::<String>::new();
    for dir_entry in files {
        let file_path = dir_entry.unwrap().path();
        let file_path_splited:Vec<&str> = file_path.to_str().unwrap().split("@").collect();
        let mut iter = file_path_splited.iter();
        if iter.next().unwrap().ends_with("S") {
            let mut book = Vec::<String>::new();
            loop {
                let element = iter.next();
                match element {
                    None => break,
                    Some(&i) => {
                        if i.ends_with(".json") {
                            book.push(i.replace(".json", ""));
                            break;
                        } else {
                            book.push(i.to_string());
                        }
                    }
                }
            }
            
            let s: String = book.join("/");
            books.insert(s);
        }
    }
    
    // let cfg: TestConfig = confy::load_path(path::PathBuf::from("./tests/struct_names")).unwrap();
    let cfg: TestConfig = confy::load(REGISTER_STRUCT, None).unwrap();

    let cfg_hash_set: HashSet<String, RandomState> = cfg.struct_name;

    let diff = books.difference(&cfg_hash_set);
    if diff.clone().count() > 0 {
        panic!("\x1b[38;5;{}m There are some not implemented struct for test response data ({}/{}) {:#?}\x1b[m", 8, diff.clone().count(), books.len(), diff.collect::<HashSet<&String, RandomState>>());
    }
}