#[cfg(feature = "graphviz")]
use dot_writer::{Attributes, Color, DotWriter, Node, NodeId, PortId, Scope, Shape, Style};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Write,
    path::{self, PathBuf},
};
#[cfg(feature = "cytoscape")]
use uuid::Uuid;

use quote::ToTokens;
use syn::{self, UseTree};

// ---- syn-based helper functions ----

type UseInfo = HashMap<String, String>;

fn collect_use_tree(prefix: &str, tree: &UseTree, result: &mut UseInfo) {
    match tree {
        UseTree::Path(use_path) => {
            let new_prefix = if prefix.is_empty() {
                use_path.ident.to_string()
            } else {
                format!("{}::{}", prefix, use_path.ident)
            };
            collect_use_tree(&new_prefix, &use_path.tree, result);
        }
        UseTree::Name(use_name) => {
            let full_path = if prefix.is_empty() {
                use_name.ident.to_string()
            } else {
                format!("{}::{}", prefix, use_name.ident)
            };
            result.insert(use_name.ident.to_string(), full_path);
        }
        UseTree::Rename(use_rename) => {
            let full_path = if prefix.is_empty() {
                use_rename.ident.to_string()
            } else {
                format!("{}::{}", prefix, use_rename.ident)
            };
            result.insert(use_rename.rename.to_string(), full_path);
        }
        UseTree::Glob(_) => {}
        UseTree::Group(use_group) => {
            for item in &use_group.items {
                collect_use_tree(prefix, item, result);
            }
        }
    }
}

fn extract_use_info(file: &syn::File) -> UseInfo {
    let mut use_book = UseInfo::new();
    for item in &file.items {
        if let syn::Item::Use(item_use) = item {
            collect_use_tree("", &item_use.tree, &mut use_book);
        }
    }
    use_book
}

fn type_to_string(ty: &syn::Type) -> String {
    let raw = ty.to_token_stream().to_string();
    raw.replace(' ', "").replace(',', ", ")
}

fn extract_innermost_type_name(ty: &syn::Type) -> String {
    match ty {
        syn::Type::Path(type_path) => {
            if let Some(last_seg) = type_path.path.segments.last() {
                match &last_seg.arguments {
                    syn::PathArguments::AngleBracketed(args) => {
                        let last_type_arg = args.args.iter().rev().find_map(|arg| {
                            if let syn::GenericArgument::Type(t) = arg {
                                Some(t)
                            } else {
                                None
                            }
                        });
                        match last_type_arg {
                            Some(inner_ty) => extract_innermost_type_name(inner_ty),
                            None => last_seg.ident.to_string(),
                        }
                    }
                    _ => last_seg.ident.to_string(),
                }
            } else {
                ty.to_token_stream().to_string()
            }
        }
        _ => ty.to_token_stream().to_string(),
    }
}

// ---- Main function ----

pub fn check_database_dependency_syn() {
    let sub_target_path = "./src/models/".to_string();

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

        if file_path_str.ends_with(".rs") && !(file_path_str.ends_with("mod.rs")) {
            let mut bookm: StructFieldTypeInfo = StructFieldTypeInfo::new();

            let content = fs::read_to_string(file_path.clone()).expect("failed to read file");
            let syntax_tree = syn::parse_file(&content).expect("failed to parse file");

            let use_book = extract_use_info(&syntax_tree);

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

            for item in &syntax_tree.items {
                if let syn::Item::Struct(item_struct) = item {
                    let struct_name = item_struct.ident.to_string();
                    let mut book: FieldTypeInfo = FieldTypeInfo::new();

                    if let syn::Fields::Named(fields_named) = &item_struct.fields {
                        for field in &fields_named.named {
                            let field_name = field.ident.as_ref().unwrap().to_string();
                            let field_type = type_to_string(&field.ty);
                            let type_name = extract_innermost_type_name(&field.ty);

                            let field_type_location = use_book
                                .get(&type_name)
                                .cloned()
                                .unwrap_or_else(|| "_".to_string());

                            book.insert(
                                field_name,
                                (field_type_location, field_type, type_name),
                            );
                        }
                    }
                    bookm.insert(struct_name, book);
                }
            }
            books.insert((api_name_1.clone(), api_name_2.clone()), bookm);
        }
    }

    // ---- Post-parsing resolution (identical to legacy) ----

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
    file.write_all(format!("{books:#?}").as_bytes())
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
                            .node_named(format!("{api_name_1}__{api_name_2}__{struct_name}"));
                        set_node_struct_name(&mut node_struct_name, struct_name, fields);
                        node_struct_name.id()
                    };
                    struct_node_list.insert(
                        format!("{api_name_1}__{api_name_2}__{struct_name}"),
                        node_struct_name_id.clone(),
                    );

                    for (field_name, (field_type_location, _field_type, type_name)) in fields.iter()
                    {
                        match field_type_location.to_string().as_str() {
                            "self" => {
                                if field_name.eq("uuid") {
                                    continue;
                                }
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
                                if s.eq("crate::models::env_info::EnvInfoId") {
                                    continue;
                                }
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
                    let type_name = match to.1.as_str() {
                        t if t.ends_with("Id") => t.replace("Id", ""),
                        _ => to.1.clone(),
                    };
                    deps_graph
                        .edge(
                            from.position(dot_writer::PortPosition::East),
                            to_node
                                .clone()
                                .port(&type_name)
                                .position(dot_writer::PortPosition::West),
                        )
                        .attributes();
                }
            }
        }

        std::fs::create_dir_all("../../tests/database_dependency_dot").expect("create dir failed");
        std::fs::create_dir_all("../../tests/database_dependency_svg").expect("create dir failed");
        let mut file = File::create("../../tests/database_dependency_dot/all.dot").unwrap();
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

        std::fs::create_dir_all("../../tests/database_dependency_json").expect("create dir failed");
        let mut file = File::create("../../tests/database_dependency_json/all.json").unwrap();

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

// ---- Helper functions (identical to legacy) ----

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
    cluster.set_label(&format!("{api_name_1} / {api_name_2}"));
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
    node_struct_name.set_label(&format!("<{struct_name}> {struct_name} {struct_label}"));
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
        match type_name {
            t if t.ends_with("Id") => t.replace("Id", ""),
            _ => type_name.clone(),
        }
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
        match field_type_location_parse[field_type_location_parse.len() - 1] {
            t if t.ends_with("Id") => t.replace("Id", ""),
            _ => field_type_location_parse[field_type_location_parse.len() - 1].to_string(),
        }
    );
    key
}

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
