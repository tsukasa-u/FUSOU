#[cfg(feature = "graphviz")]
use dot_writer::{Attributes, Color, DotWriter, Node, NodeId, PortId, Scope, Shape, Style};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{self, PathBuf}, /*process::Command*/
};
#[cfg(feature = "cytoscape")]
use uuid::Uuid;

pub fn check_database_dependency() {
    let sub_target_path = "./src/database".to_string();

    let re_struct = regex::Regex::new(r#"\n(pub\s+)?struct [A-Za-z0-9]+ \{[^\}]*\}"#).unwrap();
    let re_struct_name =
        regex::Regex::new(r#"\n(pub\s+)?struct ([A-Za-z0-9]+) \{[^\}]*\}"#).unwrap();
    let re_struct_field = regex::Regex::new(
        r#"\s*(pub)? ([a-z_0-9]+)\s?:\s?([A-Za-z0-9<>,\s]+),\s*(\/\/[^\r\n]*)?\r?\n"#,
    )
    .unwrap();
    let re_use =
        regex::Regex::new(r#"(//\s+)?use\s+(([A-Za-z0-9_]+::)*([A-Za-z0-9_]+));"#).unwrap();
    let re_parse_type =
        regex::Regex::new(r#"([A-Za-z]+<([A-Za-z]+,\s*)?)*([A-Za-z0-9]+)>*"#).unwrap();

    let re_check_comma =
        regex::Regex::new(r#"(pub)? [a-z_0-9]+\s?:\s?[A-Za-z0-9<>,\s]*[A-Za-z0-9<>]\r?\n\s*}"#)
            .unwrap();

    let mut file_path_list: Vec<PathBuf> = Vec::new();
    let mut books: ApiFieldTypeInfo = ApiFieldTypeInfo::new();

    let sub_target = path::PathBuf::from(sub_target_path);
    let sub_folders = sub_target.read_dir().expect("read_dir call failed");
    for entry in sub_folders.flatten() {
        let file_path = entry.path();
        file_path_list.push(file_path);
    }

    for file_path in file_path_list {
        let file_path_str = file_path.to_string_lossy().to_string();

        if file_path_str.ends_with(".rs")
            && !(file_path_str.ends_with("mod.rs")
                || file_path_str.ends_with("encode.rs")
                || file_path_str.ends_with("table.rs"))
        {
            let mut bookm: StructFieldTypeInfo = StructFieldTypeInfo::new();

            let content = fs::read_to_string(file_path.clone()).expect("failed to read file");

            let use_captured = re_use.captures_iter(&content);
            let mut use_book: UseInfo = UseInfo::new();
            for use_cap in use_captured {
                if use_cap.get(1).is_none() {
                    let use_name = use_cap.get(2).unwrap().as_str();
                    let use_name_last = use_cap.get(use_cap.len() - 1).unwrap().as_str();
                    use_book.insert(use_name_last.to_string(), use_name.to_string());
                }
            }

            #[cfg(target_os = "windows")]
            let api_name_splited: Vec<String> = file_path_str
                .replace("\\", "/")
                .split("/")
                .map(|s| s.replace(".rs", ""))
                .collect();
            #[cfg(target_os = "linux")]
            let api_name_splited: Vec<String> = file_path_str
                .split("/")
                .map(|s| s.replace(".rs", ""))
                .collect();

            let api_name_1 = api_name_splited[api_name_splited.len() - 2].clone();
            let api_name_2 = api_name_splited[api_name_splited.len() - 1].clone();

            let captured = re_struct.captures_iter(&content);
            for cap in captured {
                let mut book: FieldTypeInfo = FieldTypeInfo::new();

                let field_captured = re_struct_field.captures_iter(cap.get(0).unwrap().as_str());
                for field_cap in field_captured {
                    let field_type = field_cap.get(3).unwrap().as_str();
                    let field_name = field_cap.get(2).unwrap().as_str();

                    let type_captured = re_parse_type.captures(field_type);
                    let type_name = if let Some(type_cap) = type_captured {
                        type_cap
                            .get(type_cap.len() - 1)
                            .unwrap()
                            .as_str()
                            .to_string()
                    } else {
                        field_type.to_string()
                    };
                    let use_name_full = use_book
                        .keys()
                        .filter(|x| type_name.eq(x.to_owned()))
                        .map(|x| use_book.get(x));

                    let field_type_location = if use_name_full.clone().count() == 1 {
                        match use_name_full.last().unwrap() {
                            Some(name_last) => name_last.to_owned(),
                            None => "_".to_string(),
                        }
                    } else {
                        "_".to_string()
                    };

                    book.insert(
                        field_name.to_string(),
                        (field_type_location, field_type.to_string(), type_name),
                    );
                }

                let struct_name_captrued = re_struct_name.captures(cap.get(0).unwrap().as_str());
                if let Some(struct_name) = struct_name_captrued {
                    if let Some(struct_name_unwrap) = struct_name.get(2) {
                        bookm.insert(struct_name_unwrap.as_str().to_string(), book);

                        let check_comma_captured =
                            re_check_comma.captures_iter(cap.get(0).unwrap().as_str());
                        for check_comma_cap in check_comma_captured {
                            println!("\x1b[38;5;{}m add comma at the end of this line({}) in {} ({}/{}.rs) \x1b[m ", 11, check_comma_cap.get(0).unwrap().as_str().replace("\n}", "").replace("\r", ""), struct_name_unwrap.as_str(), api_name_1, api_name_2);
                        }
                    }
                }
            }
            books.insert((api_name_1.clone(), api_name_2.clone()), bookm);
        }
    }

    for ((api_name_1, api_name_2), fieldm) in books.clone().iter() {
        for (struct_name, field) in fieldm.iter() {
            for (field_name, (_field_type_location, _field_type, type_name)) in field.iter() {
                if fieldm.get(&type_name.clone().replace("Id", "")).is_some() {
                    books
                        .get_mut(&(api_name_1.clone(), api_name_2.clone()))
                        .unwrap()
                        .get_mut(struct_name)
                        .unwrap()
                        .get_mut(field_name)
                        .unwrap()
                        .0 = "self".to_string();
                }
            }
        }
    }

    let mut file = File::create("./tests/database_dependency.log").unwrap();
    file.write_all(format!("{:#?}", books).as_bytes())
        .expect("write failed");

    let books_vec: ApiFieldTypeInfoVec = create_api_field_type_info_vec_sorted(&books);
    let books_vec_clone = books_vec.clone();

    #[cfg(feature = "graphviz")]
    {
        let mut struct_node_list: HashMap<String, NodeId> = HashMap::new();
        let mut edge_list: Vec<(PortId, (String, String))> = Vec::new();
        let mut output_bytes: Vec<u8> = Vec::new();
        {
            let mut writer: DotWriter = create_writer(&mut output_bytes);
            let mut deps_graph: Scope = create_deps_graph(&mut writer);

            for ((api_name_1, api_name_2), fieldm) in books_vec_clone {
                let mut cluster: Scope<'_, '_> = deps_graph.cluster();
                set_cluster(&mut cluster, api_name_1, api_name_2);

                for (struct_name, fields) in fieldm.iter() {
                    let node_struct_name_id = {
                        let mut node_struct_name = cluster
                            .node_named(format!("{}__{}__{}", api_name_1, api_name_2, struct_name));
                        set_node_struct_name(&mut node_struct_name, struct_name, fields);
                        node_struct_name.id()
                    };
                    struct_node_list.insert(
                        format!("{}__{}__{}", api_name_1, api_name_2, struct_name),
                        node_struct_name_id.clone(),
                    );

                    for (field_name, (field_type_location, _field_type, type_name)) in fields.iter()
                    {
                        match field_type_location.to_string().as_str() {
                            "self" => {
                                let node_field_type_id = get_self_node_field_type_id(
                                    &mut cluster,
                                    &struct_node_list,
                                    api_name_1,
                                    api_name_2,
                                    type_name,
                                );
                                set_cluster_edge(
                                    &mut cluster,
                                    &node_struct_name_id,
                                    &node_field_type_id,
                                    field_name,
                                    type_name,
                                );
                            }
                            s if s.starts_with("crate") && s.ends_with("Id") => {
                                let key = get_crate_node_key_remove_id(field_type_location);
                                edge_list.push((
                                    node_struct_name_id.clone().port(field_name),
                                    (key, type_name.to_owned()),
                                ));
                            }
                            _ => {}
                        }
                    }
                }
            }
            for (from, to) in edge_list {
                if let Some(to_node) = struct_node_list.get(&to.0) {
                    deps_graph
                        .edge(
                            from.position(dot_writer::PortPosition::East),
                            to_node
                                .clone()
                                .port(&to.1)
                                .position(dot_writer::PortPosition::West),
                        )
                        .attributes();
                }
            }
        }

        std::fs::create_dir_all("./tests/database_dependency_dot").expect("create dir failed");
        std::fs::create_dir_all("./tests/database_dependency_svg").expect("create dir failed");
        let mut file = File::create("./tests/database_dependency_dot/all.dot").unwrap();
        file.write_all(output_bytes.as_slice())
            .expect("write failed");
    }

    #[cfg(feature = "cytoscape")]
    {
        // id label
        let mut mod_list: Vec<(String, String)> = Vec::new();
        // id label parent value
        let mut table_list: Vec<(String, String, String, String)> = Vec::new();
        // id label parent value
        let mut field_list: Vec<(String, String, String, String)> = Vec::new();
        // id source target
        let mut edge_list: Vec<(String, String, String)> = Vec::new();
        for ((api_name_1, api_name_2), fieldm) in books_vec_clone {
            let mod_name_id = format!("{}__{}", api_name_1, api_name_2);
            let mod_name = api_name_2.to_string();
            mod_list.push((mod_name_id.clone(), mod_name));

            for (struct_name, fields) in fieldm.iter() {
                let node_struct_name_id =
                    format!("{}__{}__{}", api_name_1, api_name_2, struct_name);
                table_list.push((
                    node_struct_name_id.clone(),
                    struct_name.clone(),
                    mod_name_id.clone(),
                    format!("{}", fields.iter().len()),
                ));
                let node_struct_name_field_id =
                    format!("{}__{}__{}__name", api_name_1, api_name_2, struct_name);
                field_list.push((
                    node_struct_name_field_id,
                    struct_name.clone(),
                    node_struct_name_id.clone(),
                    "".to_string(),
                ));

                for (field_name, (field_type_location, _field_type, type_name)) in fields.iter() {
                    let field_name_id = format!(
                        "{}__{}__{}__{}",
                        api_name_1, api_name_2, struct_name, field_name
                    );
                    field_list.push((
                        field_name_id.clone(),
                        field_name.clone(),
                        node_struct_name_id.clone(),
                        _field_type.clone(),
                    ));

                    match field_type_location.to_string().as_str() {
                        "self" => {
                            let edge_id = Uuid::new_v4().to_string();
                            let key = type_name.replace("Id", "");
                            let type_name_id =
                                format!("{}__{}__{}__name", api_name_1, api_name_2, key);
                            if field_name_id.replace("uuid", "name").ne(&type_name_id) {
                                edge_list.push((edge_id, field_name_id.clone(), type_name_id));
                            }
                        }
                        s if s.starts_with("crate") && s.ends_with("Id") => {
                            let edge_id = Uuid::new_v4().to_string();
                            let key = get_crate_node_key_remove_id(field_type_location);
                            let type_name_id = format!("{}__name", key);
                            edge_list.push((edge_id, field_name_id.clone(), type_name_id));
                        }
                        _ => {}
                    }
                }
            }
        }

        let mut element_json_list: Vec<ElementRootJson> = Vec::new();
        for (id, label) in mod_list.iter() {
            let element = ElementRootJson {
                data: ElementDataJson {
                    id: id.to_string(),
                    label: Some(label.to_string()),
                    value: None,
                    parent: None,
                    source: None,
                    target: None,
                    identifier: "mod".to_string(),
                },
            };
            element_json_list.push(element);
        }
        for (id, label, parent, value) in table_list.iter() {
            let element = ElementRootJson {
                data: ElementDataJson {
                    id: id.to_string(),
                    label: Some(label.to_string()),
                    value: Some(value.to_string()),
                    parent: Some(parent.to_string()),
                    source: None,
                    target: None,
                    identifier: "table".to_string(),
                },
            };
            element_json_list.push(element);
        }
        for (id, label, parent, value) in field_list.iter() {
            let element = ElementRootJson {
                data: ElementDataJson {
                    id: id.to_string(),
                    label: Some(label.to_string()),
                    value: Some(value.to_string()),
                    parent: Some(parent.to_string()),
                    source: None,
                    target: None,
                    identifier: "field".to_string(),
                },
            };
            element_json_list.push(element);
        }
        for (id, source, target) in edge_list.iter() {
            let element = ElementRootJson {
                data: ElementDataJson {
                    id: id.to_string(),
                    label: None,
                    value: None,
                    parent: None,
                    source: Some(source.to_string()),
                    target: Some(target.to_string()),
                    identifier: "edge".to_string(),
                },
            };
            element_json_list.push(element);
        }

        std::fs::create_dir_all("./tests/database_dependency_json").expect("create dir failed");
        let mut file = File::create("./tests/database_dependency_json/all.json").unwrap();

        let output_bytes: String = serde_json::to_string(&element_json_list).unwrap();
        let removed_output_bytes = output_bytes
            .replace(",\"label\":null", "")
            .replace(",\"value\":null", "")
            .replace(",\"parent\":null", "")
            .replace(",\"source\":null", "")
            .replace(",\"target\":null", "");
        file.write_all(removed_output_bytes.as_bytes())
            .expect("write failed");
    }
}

#[cfg(feature = "graphviz")]
fn create_writer(output_bytes: &mut Vec<u8>) -> DotWriter<'_> {
    let writer: DotWriter<'_> = DotWriter::from(output_bytes);
    writer
}

#[cfg(feature = "graphviz")]
fn create_deps_graph<'w>(writer: &'w mut DotWriter<'w>) -> Scope<'w, 'w> {
    let mut deps_graph: Scope = writer.digraph();
    deps_graph.set_rank_direction(dot_writer::RankDirection::LeftRight);
    deps_graph
}

fn create_api_field_type_info_vec_sorted(books: &ApiFieldTypeInfo) -> ApiFieldTypeInfoVec {
    let mut books_vec: ApiFieldTypeInfoVec = books.iter().collect::<Vec<_>>();
    books_vec
        .sort_by(|a, b| format!("{}__{}", a.0 .0, a.0 .1).cmp(&format!("{}__{}", b.0 .0, b.0 .1)));
    books_vec
}

#[cfg(feature = "graphviz")]
fn set_cluster(cluster: &mut Scope, api_name_1: &str, api_name_2: &str) {
    cluster.set_label(&format!("{} / {}", api_name_1, api_name_2));
    cluster
        .node_attributes()
        .set_style(Style::Filled)
        .set_color(Color::White)
        .set_style(Style::Solid)
        .set_color(Color::Gray20);
}

#[cfg(feature = "graphviz")]
fn get_struct_label(fields: &FieldTypeInfo) -> String {
    fields.iter().fold(
        "".to_string(),
        |acc, (field_name, (_field_type_location, field_type, _type_name))| {
            format!(
                "{} | {} {} | <{}> {} {}",
                acc,
                "{",
                field_name,
                field_name,
                field_type.replace("<", r"\<").replace(">", r"\>"),
                "}"
            )
        },
    )
}

#[cfg(feature = "graphviz")]
fn set_node_struct_name(node_struct_name: &mut Node, struct_name: &str, fields: &FieldTypeInfo) {
    let struct_label: String = get_struct_label(fields);
    node_struct_name.set_label(&format!(
        "<{}> {} {}",
        struct_name, struct_name, struct_label
    ));
    node_struct_name.set_shape(Shape::Record);
}

#[cfg(feature = "graphviz")]
fn set_cluster_edge(
    cluster: &mut Scope,
    start_node_id: &NodeId,
    end_node_id: &NodeId,
    field_name: &str,
    type_name: &str,
) {
    cluster.edge(
        start_node_id
            .clone()
            .port(field_name)
            .position(dot_writer::PortPosition::East),
        end_node_id
            .port(type_name)
            .position(dot_writer::PortPosition::West),
    );
}

#[cfg(feature = "graphviz")]
fn get_self_node_field_type_id(
    cluster: &mut Scope,
    struct_node_list: &HashMap<String, NodeId>,
    api_name_1: &String,
    api_name_2: &String,
    type_name: &String,
) -> NodeId {
    let key: String = format!(
        "{}__{}__{}",
        api_name_1,
        api_name_2,
        type_name.replace("Id", "")
    );
    if struct_node_list.contains_key(&key) {
        struct_node_list.get(&key).unwrap().clone()
    } else {
        let node_field_type = cluster.node_named(&key);
        node_field_type.id()
    }
}

fn get_crate_node_key_remove_id(field_type_location: &String) -> String {
    let field_type_location_parse = field_type_location.split("::").collect::<Vec<&str>>();

    let key = format!(
        "{}__{}__{}",
        field_type_location_parse[field_type_location_parse.len() - 3],
        field_type_location_parse[field_type_location_parse.len() - 2],
        field_type_location_parse[field_type_location_parse.len() - 1].replace("Id", "")
    );
    key
}

type UseInfo = HashMap<String, String>;
type ApiNamePair = (String, String);
type FieldTypeInfo = HashMap<String, (String, String, String)>;
type StructFieldTypeInfo = HashMap<String, FieldTypeInfo>;
type ApiFieldTypeInfo = HashMap<ApiNamePair, StructFieldTypeInfo>;
type ApiFieldTypeInfoVec<'a> = Vec<(&'a ApiNamePair, &'a StructFieldTypeInfo)>;

#[cfg(feature = "cytoscape")]
#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct ElementRootJson {
    data: ElementDataJson,
}

#[cfg(feature = "cytoscape")]
#[derive(serde::Serialize, serde::Deserialize, Debug)]
struct ElementDataJson {
    id: String,
    parent: Option<String>,
    label: Option<String>,
    value: Option<String>,
    source: Option<String>,
    target: Option<String>,
    identifier: String,
}
