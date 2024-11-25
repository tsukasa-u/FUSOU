use std::{collections::HashMap, fs::{self, File}, io::Write, path::{self, PathBuf}, process::Command};
use dot_writer::{Attributes, Color, DotWriter, PortId, Shape, Style};

pub fn check_struct_dependency() {
    
    let target_path = "./src/kcapi".to_string();
    let sub_target_path = "./src/kcapi_common".to_string();

    let re_struct = regex::Regex::new(r#"\n(pub\s+)?struct [A-Za-z0-9]+ \{[^\}]*\}"#).unwrap();
    let re_struct_name = regex::Regex::new(r#"\n(pub\s+)?struct ([A-Za-z0-9]+) \{[^\}]*\}"#).unwrap();
    // let re_struct_field = regex::Regex::new(r#"\#\[serde\(rename = \"([A-Za-z0-9_]+)\"\)\]\s*(pub)? [a-z_0-9]+\s?:\s?([A-Za-z0-9<>,\s]+)(?=,\r?\n}|\r?\n\s*})"#).unwrap();
    let re_struct_field = regex::Regex::new(r#"\#\[serde\(rename = \"([A-Za-z0-9_]+)\"\)\]\s*(pub)? [a-z_0-9]+\s?:\s?([A-Za-z0-9<>,\s]+),\r?\n"#).unwrap();
    let re_use = regex::Regex::new(r#"(//\s+)?use\s+(([A-Za-z0-9_]+::)*([A-Za-z0-9_]+));"#).unwrap();
    // let re_parse_type = regex::Regex::new(r#"([A-Za-z]+<)*([A-Za-z0-9]+)>*"#).unwrap();
    let re_parse_type = regex::Regex::new(r#"([A-Za-z]+<([A-Za-z]+,\s*)?)*([A-Za-z0-9]+)>*"#).unwrap();
    
    let re_check_comma = regex::Regex::new(r#"(pub)? [a-z_0-9]+\s?:\s?[A-Za-z0-9<>,\s]*[A-Za-z0-9<>]\r?\n\s*}"#).unwrap();

    // let path = env::current_dir().unwrap();
    // println!("starting dir: {}", path.display());

    let mut file_path_list: Vec<PathBuf> = Vec::new();
    let mut books = HashMap::<(String, String), HashMap<String, HashMap::<String, (String, String, String)>>>::new();

    let sub_target = path::PathBuf::from(sub_target_path);
    let sub_folders = sub_target.read_dir().expect( "read_dir call failed");
    for entry in  sub_folders {
        if let Ok(file_entry) = entry {
            let file_path = file_entry.path();
            file_path_list.push(file_path);          
        }
    }
    
    let target = path::PathBuf::from(target_path);
    let folders = target.read_dir().expect( "read_dir call failed");

    for dir_entry in folders {
        if dir_entry.is_ok() {
            let dir_entry_path = dir_entry.unwrap().path();
            
            if dir_entry_path.clone().is_dir() {
                let files = dir_entry_path.read_dir().expect( "read_dir call failed");
                for entry in  files {
                    if let Ok(file_entry) = entry {
                        let file_path = file_entry.path();
                        file_path_list.push(file_path);                        
                    }
                }
            }
        }
    }

    for file_path in file_path_list {
        let file_path_str = file_path.to_string_lossy().to_string();

        if file_path_str.ends_with(".rs") {
            if !file_path_str.ends_with("mod.rs") {

                let mut bookm = HashMap::<String, HashMap<String, (String, String, String)>>::new();

                let content = fs::read_to_string(file_path.clone()).expect("failed to read file");
                let captured = re_struct.captures_iter(&content);

                #[cfg(target_os = "windows")]
                let api_name_splited: Vec<String> = file_path_str.replace("\\", "/").split("/").map(|s| { s.replace(".rs", "") }).collect();
                #[cfg(target_os = "linux")]
                let api_name_splited: Vec<String> = file_path_str.split("/").map(|s| { s.replace(".rs", "") }).collect();

                let api_name_1 = api_name_splited[api_name_splited.len()-2].clone();
                let api_name_2 = api_name_splited[api_name_splited.len()-1].clone();
                
                let use_captured = re_use.captures_iter(&content);
                let mut use_book = HashMap::<String, String>::new();
                for use_cap in use_captured {
                    if use_cap.get(1).is_none() {
                        let use_name = use_cap.get(2).unwrap().as_str();
                        let use_name_last = use_cap.get(use_cap.len()-1).unwrap().as_str();
                        use_book.insert(use_name_last.to_string(), use_name.to_string());
                    }
                }

                for cap in captured {

                    let mut book = HashMap::<String, (String, String, String)>::new();

                    let field_captured = re_struct_field.captures_iter(cap.get(0).unwrap().as_str());
                    for field_cap in field_captured {
                        let field_type = field_cap.get(3).unwrap().as_str();
                        let field_rename = field_cap.get(1).unwrap().as_str();
                        
                        let type_captured = re_parse_type.captures(field_type);
                        let type_name = if let Some(type_cap) = type_captured {
                            type_cap.get(type_cap.len()-1).unwrap().as_str().to_string()
                        } else {
                            field_type.to_string()
                        };
                        let use_name_full = use_book.keys().filter(|x| type_name.eq(x.to_owned())).map(|x| use_book.get(x) );
                        
                        // println!("{:?}", use_name_full.clone().collect::<Vec<_>>());
                        let field_type_location = if use_name_full.clone().count() == 1 {
                            match use_name_full.last().unwrap() {
                                Some(name_last) => {
                                    name_last.to_owned()
                                },
                                None => {
                                    "_".to_string()
                                }
                            }
                        } else {
                            "_".to_string()
                        };

                        book.insert(field_rename.to_string(), (field_type_location, field_type.to_string(), type_name));
                    }


                    let struct_name_captrued = re_struct_name.captures(cap.get(0).unwrap().as_str());
                    if let Some(struct_name) = struct_name_captrued {
                        // println!("{:?}", struct_name.get(2).unwrap().as_str());
                        if let Some(struct_name_unwrap) = struct_name.get(2) {
                            bookm.insert( struct_name_unwrap.as_str().to_string(), book);

                            let check_comma_captured = re_check_comma.captures_iter(&cap.get(0).unwrap().as_str());
                            for check_comma_cap in check_comma_captured {
                                println!("\x1b[38;5;{}m add comma at the end of this line({}) in {} ({}/{}.rs) \x1b[m ", 11, check_comma_cap.get(0).unwrap().as_str().replace("\n}", "").replace("\r", ""), struct_name_unwrap.as_str(), api_name_1, api_name_2);
                            }
                        }
                    }
                }
                books.insert((api_name_1.clone(), api_name_2.clone()), bookm);
            }
        }
    }

    for ((api_name_1, api_name_2), fieldm) in books.clone().iter() {
        for (struct_name, field) in fieldm.iter() {
            for (field_name, (_field_type_location, _field_type, type_name)) in field.iter() {
                if let Some(ret) = books.get(&(api_name_1.clone(), api_name_2.clone())) {
                    if let Some(_) = ret.get(&type_name.clone()) {
                        books.get_mut(&(api_name_1.clone(), api_name_2.clone())).unwrap().get_mut(struct_name).unwrap().get_mut(field_name).unwrap().0 = "self".to_string();
                    }
                }
            }
        }
    }

    let mut double_resitering_struct_name = HashMap::<String, i64>::new();
    for ((_api_name_1, _api_name_2), fieldm) in books.clone().iter() {
        for (struct_name, _fields) in fieldm.iter() {
            if double_resitering_struct_name.contains_key(struct_name) {
                let count = double_resitering_struct_name.get_mut(struct_name).unwrap();
                *count += 1;
            } else {
                double_resitering_struct_name.insert(struct_name.clone(), 1);
            }
        }
    }
    
    let mut file = File::create("./tests/struct_dependency.log").unwrap();
    file.write(format!("{:#?}", books).as_bytes()).expect("write failed");

    let mut struct_node_list = HashMap::new();
    let mut edge_list: Vec<(PortId, (String, String))> = Vec::new();

    let mut output_bytes = Vec::new();
    {
        let mut writer = DotWriter::from(&mut output_bytes);
        writer.set_pretty_print(false);
        let mut deps_graph = writer.digraph();
        deps_graph.set_rank_direction(dot_writer::RankDirection::LeftRight);
        let mut books_vec = books.iter().collect::<Vec<_>>();
        books_vec.sort_by(|a, b| format!("{}__{}", a.0.0, a.0.1).cmp(&format!("{}__{}", b.0.0, b.0.1)));
        for ((api_name_1, api_name_2), fieldm) in books_vec {
            let mut cluster = deps_graph.cluster();

            cluster.set_label(&format!("{} / {}", api_name_1, api_name_2));
            cluster.node_attributes()
                .set_style(Style::Filled)
                .set_color(Color::White)
                .set_style(Style::Solid)
                .set_color(Color::Gray20);

            for (struct_name, fields) in fieldm.iter() {
                
                // let node_struct_name = cluster.node_named(struct_name).id();
                let node_struct_name_id = {
                    let mut node_struct_name = cluster.node_named(&format!("{}__{}__{}", api_name_1, api_name_2, struct_name));
                    // node_struct_name.set_label(struct_name);
                    let struct_label = fields.iter().fold("".to_string(), |acc, (field_name, (_field_type_location, field_type, _type_name))| {
                        // format!("{} | {} <{}> {} | {} {}", acc, "{", field_name, field_name, field_type.replace("<", r"\<").replace(">", r"\>"), "}")
                        format!("{} | {} {} | <{}> {} {}", acc, "{", field_name, field_name, field_type.replace("<", r"\<").replace(">", r"\>"), "}")
                    });
                    node_struct_name.set_label(&format!("<{}> {} {}", struct_name, struct_name, struct_label));
                    node_struct_name.set_shape(Shape::Record);

                    if struct_name.ne("Root") && struct_name.ne("ApiData") {
                        if double_resitering_struct_name.contains_key(struct_name) {
                            let count = double_resitering_struct_name.get(struct_name).unwrap();
                            if *count > 1 {
                                node_struct_name.set_color(Color::Red);
                            }
                        }
                    }
                    
                    node_struct_name.id()
                };
                struct_node_list.insert(format!("{}__{}__{}", api_name_1, api_name_2, struct_name), node_struct_name_id.clone());
    
                for (field_name, (field_type_location, _field_type, type_name)) in fields.iter() {
                    if field_type_location == "self" {
                        // let node_field_type = cluster.node_named(field_type).id();
                        let node_field_type_id = {
                            let key = format!("{}__{}__{}", api_name_1, api_name_2, type_name);
                            if struct_node_list.contains_key(&key) {
                                struct_node_list.get(&key).unwrap().clone()
                            } else {
                                let node_field_type = cluster.node_named(&key);
                                node_field_type.id()
                            }
                        };
                        cluster.edge(node_struct_name_id.clone().port(field_name).position(dot_writer::PortPosition::East), node_field_type_id.port(type_name).position(dot_writer::PortPosition::West));
                    } else if field_type_location != "_" {
                        // println!("{:?}", field_type_location);
                        if field_type_location.starts_with("crate") {
                            // println!("{:?}", field_type_location);
                            let field_type_location_parse = field_type_location.split("::").collect::<Vec<&str>>();
                            
                            let key = format!("{}__{}__{}", field_type_location_parse[field_type_location_parse.len()-3], field_type_location_parse[field_type_location_parse.len()-2], field_type_location_parse[field_type_location_parse.len()-1]);
                                // println!("{:?}", key);
                            if struct_node_list.contains_key(&key) {
                                let node_field_type_id = struct_node_list.get(&key).unwrap().clone();
                                cluster.edge(node_struct_name_id.clone().port(field_name).position(dot_writer::PortPosition::East), node_field_type_id.port(&type_name).position(dot_writer::PortPosition::West));
                            } else {
                                edge_list.push((node_struct_name_id.clone().port(field_name), (key, type_name.to_owned())));
                            }
                        }
                    }
                }
            }
        }
        for (from, to) in edge_list {
            let to_node = struct_node_list.get(&to.0);
            if to_node.is_some() {
                deps_graph.edge(from.position(dot_writer::PortPosition::East), to_node.unwrap().clone().port(&to.1).position(dot_writer::PortPosition::West)).attributes();

            }
        }
    }

    let mut file = File::create("./tests/struct_dependency.dot").unwrap();
    file.write_all(output_bytes.as_slice()).expect("write failed");

    // Command::new("dot")
    //     .arg("-Tsvg")
    //     .arg("./tests/struct_dependency.dot")
    //     .arg(">")
    //     .arg("./tests/struct_dependency.svg")
    //     .output()
    //     .expect("failed to execute process");

    // on windows, the dot cmd in bat file is not working because of "permmision denied"
    #[cfg(target_os = "windows")]
    let output = Command::new("./tests/export_svg.bat")
        .output()
        .expect("failed to execute process");
    #[cfg(target_os = "linux")]
    let output  = Command::new("./tests/export_svg.sh")
        .output()
        .expect("failed to execute process");

    println!("{:?}", output);

}