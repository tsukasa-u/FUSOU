use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs::File, hash::RandomState, io::Write, path};

use register_trait::add_field;

use register_trait::REGISTER_STRUCT;

#[add_field(struct_name)]
#[derive(Default, Debug, Clone, Serialize, Deserialize)]
struct TestConfig {}

pub fn check_struct_defined(target_path: String) {
    let files = register_trait::test::get_cached_test_data_files(&target_path);
    let mut books = HashSet::<String>::new();
    for file_path in files {
        let file_name = match file_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let file_path_splited: Vec<&str> = file_name.split("@").collect();
        let mut iter = file_path_splited.iter();
        if iter.next().map(|s| s.ends_with("S")).unwrap_or(false) {
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

    let cfg: TestConfig = confy::load(REGISTER_STRUCT, None).unwrap();

    let cfg_hash_set: HashSet<String, RandomState> = cfg.struct_name;

    let diff = books.difference(&cfg_hash_set);
    let diff_not_in_data = cfg_hash_set.difference(&books);

    let content = diff.clone().collect::<HashSet<&String, RandomState>>();

    let mut file = File::create("./tests/struct_defined.log").unwrap();
    file.write_all(
        format!(
            "unregistered struct ({}/{})\n",
            diff.clone().count(),
            books.clone().len()
        )
        .as_bytes(),
    )
    .expect("write failed");
    file.write_all(format!("{content:#?}\n").as_bytes())
        .expect("write failed");

    file.write_all("\n".as_bytes()).expect("write failed");
    file.write_all(
        format!(
            "registered struct ({}/{})\n",
            cfg_hash_set.clone().len(),
            books.clone().len()
        )
        .as_bytes(),
    )
    .expect("write failed");
    file.write_all(format!("{cfg_hash_set:#?}\n").as_bytes())
        .expect("write failed");

    file.write_all("\n".as_bytes()).expect("write failed");
    file.write_all(
        format!(
            "struct not in test data ({}/{})\n",
            diff_not_in_data.clone().count(),
            cfg_hash_set.clone().len()
        )
        .as_bytes(),
    )
    .expect("write failed");
    file.write_all(format!("{diff_not_in_data:#?}\n").as_bytes())
        .expect("write failed");

    file.write_all("\n".as_bytes()).expect("write failed");
    file.write_all(format!("all struct ({})\n", cfg_hash_set.clone().len()).as_bytes())
        .expect("write failed");
    file.write_all(format!("{cfg_hash_set:#?}\n").as_bytes())
        .expect("write failed");

    if diff.clone().count() > 0 {
        panic!("\x1b[38;5;{}m There are some not implemented struct for test response data ({}/{}) {:#?}\x1b[m", 8, diff.clone().count(), books.len(), content);
    }
}
