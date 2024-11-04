use std::{collections::HashMap,  fs::{self, File}, io::Write, path, process::Command};
use dot_writer::{Attributes, Color, DotWriter, Node, Shape, Style};

pub fn check_struct_dependency(target_path: String) {

    let re_struct = regex::Regex::new(r#"(pub)? struct [A-Za-z0-9]+ \{[^\}]*\}"#).unwrap();
    let re_struct_name = regex::Regex::new(r#"(pub)? struct ([A-Za-z0-9]+) \{[^\}]*\}"#).unwrap();
    let re_struct_field = regex::Regex::new(r#"\#\[serde\(rename = \"([A-Za-z0-9_]+)\"\)\]\s*(pub)? [a-z_0-9]+\s?:\s?([A-Za-z0-9<>,\s]+)\n"#).unwrap();
    let re_use = regex::Regex::new(r#"^use (([A-Za-z0-9_]+::)*([A-Za-z0-9_]+));"#).unwrap();
    // let re_parse_type = regex::Regex::new(r#"([A-Za-z]+<)*([A-Za-z0-9]+)>*"#).unwrap();
    let re_parse_type = regex::Regex::new(r#"([A-Za-z]+<([A-Za-z]+,\s*)?)*([A-Za-z0-9]+)>*"#).unwrap();
    
    // let path = env::current_dir().unwrap();
    // println!("starting dir: {}", path.display());
    
    let target = path::PathBuf::from(target_path);
    let folders = target.read_dir().expect( "read_dir call failed");
    let mut books = HashMap::<(String, String), HashMap<String, HashMap::<String, (String, String, String)>>>::new();
    for dir_entry in folders {

        if dir_entry.is_ok() {
            let dir_entry_path = dir_entry.unwrap().path();
            
            if dir_entry_path.clone().is_dir() {
                let files = dir_entry_path.read_dir().expect( "read_dir call failed");
                for entry in  files {
                    if let Ok(file_entry) = entry {
                        let file_path = file_entry.path();
    
                        let file_path_str = file_path.to_string_lossy().to_string();
    
                        if file_path_str.ends_with(".rs") {
                            if !file_path_str.ends_with("mod.rs") {

                                let mut bookm = HashMap::<String, HashMap<String, (String, String, String)>>::new();
    
                                let content = fs::read_to_string(file_path.clone()).expect("failed to read file");
                                let captured = re_struct.captures_iter(&content);
    
                                #[cfg(target_os = "windows")]
                                let api_name_splited: Vec<String> = file_path_str.split("\\").map(|s| { s.replace(".rs", "") }).collect();
                                #[cfg(target_os = "linux")]
                                let api_name_splited: Vec<String> = file_path_str.split("/").map(|s| { s.replace(".rs", "") }).collect();

                                let api_name_1 = api_name_splited[api_name_splited.len()-2].clone();
                                let api_name_2 = api_name_splited[api_name_splited.len()-1].clone();
                                
                                let use_captured = re_use.captures_iter(&content);
                                let mut use_book = HashMap::<String, String>::new();
                                for use_cap in use_captured {
                                    let use_name = use_cap.get(1).unwrap().as_str();
                                    let use_name_last = use_cap.get(3).unwrap().as_str();
                                    use_book.insert(use_name_last.to_string(), use_name.to_string());
                                }
                                

                                for cap in captured {
                                    let mut book = HashMap::<String, (String, String, String)>::new();

                                    let field_captured = re_struct_field.captures_iter(cap.get(0).unwrap().as_str());
                                    for field_cap in field_captured {
                                        // println!("{:?}", field_cap);
                                        // let field_name = field_cap.get(1).unwrap().as_str();
                                        // println!("{:?}", field_cap);
                                        let field_type = field_cap.get(3).unwrap().as_str();
                                        let field_rename = field_cap.get(1).unwrap().as_str();

                                        let use_name_full = use_book.keys().filter(|x| x.find(field_type).is_some()).map(|x| {
                                            use_book.get(x)
                                        });
                                        
                                        let field_type_location = if use_name_full.clone().count() > 0 && use_name_full.clone().count() < 2 {
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
                                        //  field_cap.get(0).unwrap().as_str();
                                        
                                        let type_captured = re_parse_type.captures(field_type);
                                        let type_name = if let Some(type_cap) = type_captured {
                                            type_cap.get(type_cap.len()-1).unwrap().as_str().to_string()
                                        } else {
                                            field_type.to_string()
                                        };

                                        book.insert(field_rename.to_string(), (field_type_location, field_type.to_string(), type_name));
                                    }

    
                                    let struct_name_captrued = re_struct_name.captures(cap.get(0).unwrap().as_str());
                                    if let Some(struct_name) = struct_name_captrued {
                                        // println!("{:?}", struct_name.get(2).unwrap().as_str());
                                        if let Some(struct_name_unwrap) = struct_name.get(2) {
                                            bookm.insert( struct_name_unwrap.as_str().to_string(), book);
                                        }
                                    }
                                }
                                books.insert((api_name_1.clone(), api_name_2.clone()), bookm);
                            }
                        }
                    }
                }
            }
        }
    }

    // for ((api_name_1, api_name_2, struct_name), fields) in books.clone().iter() {
    //     for (field_name, (_field_type_location, field_type, type_name)) in fields.iter() {

    //         if books.get(&(api_name_1.clone(), api_name_2.clone(), type_name.clone())).is_some() {
    //             books.get_mut(&(api_name_1.clone(), api_name_2.clone(), struct_name.clone())).unwrap().get_mut(field_name).unwrap().0 = "self".to_string();
    //         }
    //     }
    // }
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

            let mut struct_node_list = HashMap::new();

            for (struct_name, fields) in fieldm.iter() {
                
                // let node_struct_name = cluster.node_named(struct_name).id();
                let node_struct_name_id = {
                    let mut node_struct_name = cluster.node_named(&format!("{}__{}__{}", api_name_1, api_name_2, struct_name));
                    // node_struct_name.set_label(struct_name);
                    let struct_label = fields.iter().fold("".to_string(), |acc, (field_name, (_field_type_location, field_type, _type_name))| {
                        // format!("{} | {} <{}> {} | {} {}", acc, "{", field_name, field_name, field_type.replace("<", r"\<").replace(">", r"\>"), "}")
                        format!("{} | {} {} | <{}> {} {}", acc, "{", field_name, field_name, field_type.replace("<", r"\<").replace(">", r"\>"), "}")
                    });
                    node_struct_name.set_label(&format!("{} {}", struct_name, struct_label));
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
                        cluster.edge(node_struct_name_id.clone().port(field_name), node_field_type_id);
                    }
                }
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

    #[cfg(target_os = "windows")]
    Command::new("./tests/export_svg.bat")
        .output()
        .expect("failed to execute process");
    #[cfg(target_os = "linux")]
    Command::new("./tests/export_svg.sh")
        .output()
        .expect("failed to execute process");

}