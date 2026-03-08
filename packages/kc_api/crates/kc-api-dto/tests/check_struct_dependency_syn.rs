#[cfg(feature = "graphviz")]
use dot_writer::{Attributes, Color, DotWriter, Node, NodeId, PortId, Scope, Shape, Style};
use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::Write,
    path::{self, PathBuf},
};
#[cfg(feature = "cytoscape")]
use uuid::Uuid;

use quote::ToTokens;
use syn::{self, Expr, ExprLit, Lit, Meta, UseTree};

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

// ---- DTO-specific helper functions ----

fn extract_serde_rename(attrs: &[syn::Attribute]) -> Option<String> {
    for attr in attrs {
        if attr.path().is_ident("serde") {
            if let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<Meta, syn::Token![,]>::parse_terminated,
            ) {
                for meta in nested {
                    if let Meta::NameValue(nv) = meta {
                        if nv.path.is_ident("rename") {
                            if let Expr::Lit(ExprLit {
                                lit: Lit::Str(s), ..
                            }) = &nv.value
                            {
                                return Some(s.value());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

fn extract_cfg_condition(attrs: &[syn::Attribute]) -> CfgCondition {
    for attr in attrs {
        if attr.path().is_ident("cfg") {
            if let Ok(meta) = attr.parse_args::<Meta>() {
                match &meta {
                    Meta::NameValue(nv) if nv.path.is_ident("feature") => {
                        if let Expr::Lit(ExprLit {
                            lit: Lit::Str(s), ..
                        }) = &nv.value
                        {
                            return Some((s.value(), true));
                        }
                    }
                    Meta::List(ml) if ml.path.is_ident("not") => {
                        if let Ok(inner) = ml.parse_args::<Meta>() {
                            if let Meta::NameValue(nv) = inner {
                                if nv.path.is_ident("feature") {
                                    if let Expr::Lit(ExprLit {
                                        lit: Lit::Str(s), ..
                                    }) = &nv.value
                                    {
                                        return Some((s.value(), false));
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    None
}

// ---- Main function ----

pub fn check_struct_dependency_syn() {
    let target_path = "./src/endpoints".to_string();
    let sub_target_path = "./src/common".to_string();

    let mut file_path_list: Vec<PathBuf> = Vec::new();
    let mut books_ext: ApiFieldTypeInfoExt = ApiFieldTypeInfoExt::new();
    let mut all_cfg_features: BTreeSet<String> = BTreeSet::new();

    let sub_target = path::PathBuf::from(sub_target_path);
    let sub_folders = sub_target.read_dir().expect("read_dir call failed");
    for entry in sub_folders.flatten() {
        let file_path = entry.path();
        file_path_list.push(file_path);
    }

    let target = path::PathBuf::from(target_path);
    let folders = target.read_dir().expect("read_dir call failed");

    for dir_entry in folders {
        if dir_entry.is_ok() {
            let dir_entry_path = dir_entry.unwrap().path();

            if dir_entry_path.clone().is_dir() {
                let files = dir_entry_path.read_dir().expect("read_dir call failed");
                for entry in files.flatten() {
                    let file_path = entry.path();
                    file_path_list.push(file_path);
                }
            }
        }
    }

    for file_path in file_path_list {
        let file_path_str = file_path.to_string_lossy().to_string();

        if file_path_str.ends_with(".rs") && !file_path_str.ends_with("mod.rs") {
            let mut bookm_ext: StructFieldTypeInfoExt = StructFieldTypeInfoExt::new();

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
                    let mut book_ext: Vec<FieldEntryExt> = Vec::new();

                    if let syn::Fields::Named(fields_named) = &item_struct.fields {
                        for field in &fields_named.named {
                            let field_rename = match extract_serde_rename(&field.attrs) {
                                Some(r) => r,
                                None => continue,
                            };

                            let field_type = type_to_string(&field.ty);
                            let type_name = extract_innermost_type_name(&field.ty);
                            let cfg_cond = extract_cfg_condition(&field.attrs);

                            if let Some((ref feat, _)) = cfg_cond {
                                all_cfg_features.insert(feat.clone());
                            }

                            let field_type_location = use_book
                                .get(&type_name)
                                .cloned()
                                .unwrap_or_else(|| "_".to_string());

                            book_ext.push((
                                field_rename,
                                field_type_location,
                                field_type,
                                type_name,
                                cfg_cond,
                            ));
                        }
                    }
                    bookm_ext.insert(struct_name, book_ext);
                }
            }
            books_ext.insert((api_name_1.clone(), api_name_2.clone()), bookm_ext);
        }
    }

    // Detect active features by resolving default features from Cargo.toml
    let active_features = resolve_default_features(&all_cfg_features);

    // Build default books from books_ext filtered for active features
    let mut books = filter_books_for_features(&books_ext, &active_features);

    for ((api_name_1, api_name_2), fieldm) in books.clone().iter() {
        for (struct_name, field) in fieldm.iter() {
            for (field_name, (_field_type_location, _field_type, type_name)) in field.iter() {
                if fieldm.get(&type_name.clone()).is_some() {
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
    file.write_all(format!("{books:#?}").as_bytes())
        .expect("write failed");

    // Output feature_variants.json metadata
    {
        use serde_json::{json, Value};

        let mut field_diffs: HashMap<String, HashMap<String, HashMap<String, Value>>> =
            HashMap::new();
        for feat in &all_cfg_features {
            let mut feat_diffs: HashMap<String, HashMap<String, Value>> = HashMap::new();
            for ((api_name_1, api_name_2), struct_fields_ext) in books_ext.iter() {
                for (struct_name, fields) in struct_fields_ext.iter() {
                    for (field_rename, _loc, field_type, _type_name, cfg_cond) in fields.iter() {
                        if let Some((f, is_positive)) = cfg_cond {
                            if f == feat {
                                let key =
                                    format!("{api_name_1}__{api_name_2}__{struct_name}");
                                let struct_entry =
                                    feat_diffs.entry(key).or_default();
                                let field_entry =
                                    struct_entry.entry(field_rename.clone()).or_insert_with(|| {
                                        json!({"with_feature": null, "without_feature": null})
                                    });
                                if let Value::Object(ref mut map) = field_entry {
                                    if *is_positive {
                                        map.insert(
                                            "with_feature".to_string(),
                                            json!(field_type),
                                        );
                                    } else {
                                        map.insert(
                                            "without_feature".to_string(),
                                            json!(field_type),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if !feat_diffs.is_empty() {
                field_diffs.insert(feat.clone(), feat_diffs);
            }
        }

        let feature_variants = json!({
            "all_features": all_cfg_features.iter().collect::<Vec<_>>(),
            "active_features": active_features.iter().collect::<Vec<_>>(),
            "field_diffs": field_diffs,
        });

        std::fs::create_dir_all("../../tests/struct_dependency_dot").expect("create dir failed");
        let mut file =
            File::create("../../tests/struct_dependency_dot/feature_variants.json").unwrap();
        file.write_all(
            serde_json::to_string_pretty(&feature_variants)
                .unwrap()
                .as_bytes(),
        )
        .expect("write failed");
    }

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
                        check_dobule_resitering_struct_name(
                            &mut node_struct_name,
                            &double_resitering_struct_name,
                            struct_name,
                        );

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
                            s if s.starts_with("crate") => {
                                let key = get_crate_node_key(field_type_location);
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

        std::fs::create_dir_all("../../tests/struct_dependency_dot").expect("create dir failed");
        std::fs::create_dir_all("../../tests/struct_dependency_svg").expect("create dir failed");
        let mut file = File::create("../../tests/struct_dependency_dot/all.dot").unwrap();
        file.write_all(output_bytes.as_slice())
            .expect("write failed");
    }

    #[cfg(feature = "cytoscape")]
    {
        // id label
        let mut mod_list: Vec<(String, String)> = Vec::new();
        // id label parent
        let mut table_list: Vec<(String, String, String)> = Vec::new();
        // id label parent value
        let mut field_list: Vec<(String, String, String, String)> = Vec::new();
        // id source target
        let mut edge_list: Vec<(String, String, String)> = Vec::new();
        for ((api_name_1, api_name_2), fieldm) in books_vec_clone {
            let mod_name_id = format!("{}__{}", api_name_1, api_name_2);
            let mod_name = format!("{} / {}", api_name_1, api_name_2);
            mod_list.push((mod_name_id.clone(), mod_name));

            for (struct_name, fields) in fieldm.iter() {
                let node_struct_name_id =
                    format!("{}__{}__{}", api_name_1, api_name_2, struct_name);
                table_list.push((
                    node_struct_name_id.clone(),
                    struct_name.clone(),
                    mod_name_id.clone(),
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
                            let type_name_id =
                                format!("{}__{}__{}__name", api_name_1, api_name_2, type_name);
                            edge_list.push((edge_id, field_name_id.clone(), type_name_id));
                        }
                        s if s.starts_with("crate") && s.ends_with("Id") => {
                            let edge_id = Uuid::new_v4().to_string();
                            let key = get_crate_node_key(field_type_location);
                            let type_name_id =
                                format!("{}__{}__{}__name", api_name_1, api_name_2, key);
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
        for (id, label, parent) in table_list.iter() {
            let element = ElementRootJson {
                data: ElementDataJson {
                    id: id.to_string(),
                    label: Some(label.to_string()),
                    value: None,
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

        std::fs::create_dir_all("../../tests/struct_dependency_json").expect("create dir failed");
        let mut file = File::create("../../tests/struct_dependency_json/all.json").unwrap();

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

    #[cfg(feature = "graphviz")]
    {
        let binding = books_vec.clone();
        let books_vec_common = binding
            .iter()
            .filter(|x| x.0 .0.ne("kcapi_common"))
            .collect::<Vec<_>>();

        for ((api_name_1, api_name_2), fieldm) in books_vec_common {
            let mut struct_node_list: HashMap<String, NodeId> = HashMap::new();
            let mut edge_list: Vec<(PortId, (String, String))> = Vec::new();
            let mut output_bytes: Vec<u8> = Vec::new();
            let mut field_type_location_parse_list = Vec::new();
            {
                let mut writer: DotWriter = create_writer(&mut output_bytes);
                let mut deps_graph: Scope = create_deps_graph(&mut writer);
                {
                    let mut cluster: Scope<'_, '_> = deps_graph.cluster();
                    set_cluster(&mut cluster, api_name_1, api_name_2);
                    for (struct_name, fields) in fieldm.iter() {
                        let node_struct_name_id = {
                            let mut node_struct_name = cluster.node_named(format!(
                                "{api_name_1}__{api_name_2}__{struct_name}"
                            ));
                            set_node_struct_name(&mut node_struct_name, struct_name, fields);

                            node_struct_name.id()
                        };
                        struct_node_list.insert(
                            format!("{api_name_1}__{api_name_2}__{struct_name}"),
                            node_struct_name_id.clone(),
                        );

                        for (field_name, (field_type_location, _field_type, type_name)) in
                            fields.iter()
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
                                s if s.starts_with("crate") => {
                                    let field_type_location_parse =
                                        field_type_location.split("::").collect::<Vec<&str>>();
                                    field_type_location_parse_list.push(field_type_location_parse);
                                    let key = get_crate_node_key(field_type_location);
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

                let mut field_type_location_parse_uniq: HashMap<String, Vec<String>> =
                    HashMap::new();
                let mut field_type_location_list = field_type_location_parse_list.clone();
                loop {
                    if field_type_location_list.is_empty() {
                        break;
                    }
                    let field_type_location_list_clone = field_type_location_list.clone();
                    field_type_location_list.clear();
                    for field_type_location_parse in &field_type_location_list_clone {
                        let api_name_1 = field_type_location_parse
                            [field_type_location_parse.len() - 3]
                            .to_string();
                        let api_name_2 = field_type_location_parse
                            [field_type_location_parse.len() - 2]
                            .to_string();
                        let struct_name = field_type_location_parse
                            [field_type_location_parse.len() - 1]
                            .to_string();

                        let key = format!("{api_name_1}__{api_name_2}");
                        if let std::collections::hash_map::Entry::Vacant(e) =
                            field_type_location_parse_uniq.entry(key.clone())
                        {
                            e.insert(vec![struct_name.clone()]);
                        } else {
                            let value = field_type_location_parse_uniq.get_mut(&key).unwrap();
                            if !value.contains(&struct_name) {
                                value.push(struct_name.clone());
                            }
                        }

                        let fields = books
                            .get(&(api_name_1.clone(), api_name_2.clone()))
                            .unwrap()
                            .get(&struct_name)
                            .unwrap();

                        for (_field_name, (field_type_location, _field_type, type_name)) in
                            fields.iter()
                        {
                            match field_type_location.to_string().as_str() {
                                "self" => {
                                    field_type_location_list.push(vec![
                                        field_type_location_parse
                                            [field_type_location_parse.len() - 3],
                                        &field_type_location_parse
                                            [field_type_location_parse.len() - 2],
                                        &type_name,
                                    ]);
                                }
                                s if s.starts_with("crate") => {
                                    field_type_location_list.push(
                                        field_type_location.split("::").collect::<Vec<&str>>(),
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }

                for (api_name, struct_vec) in field_type_location_parse_uniq.iter() {
                    let api_name_1_2 = api_name.split("__").collect::<Vec<&str>>();
                    let api_name_1 = api_name_1_2[0].to_string();
                    let api_name_2 = api_name_1_2[1].to_string();

                    let mut cluster: Scope<'_, '_> = deps_graph.cluster();
                    set_cluster(&mut cluster, &api_name_1, &api_name_2);
                    for struct_name in struct_vec {
                        let fields = books
                            .get(&(api_name_1.clone(), api_name_2.clone()))
                            .unwrap()
                            .get(struct_name)
                            .unwrap();
                        let node_struct_name_id = {
                            let mut node_struct_name = cluster.node_named(format!(
                                "{api_name_1}__{api_name_2}__{struct_name}"
                            ));
                            set_node_struct_name(&mut node_struct_name, struct_name, fields);

                            node_struct_name.id()
                        };
                        struct_node_list.insert(
                            format!("{api_name_1}__{api_name_2}__{struct_name}"),
                            node_struct_name_id.clone(),
                        );

                        for (field_name, (field_type_location, _field_type, type_name)) in
                            fields.iter()
                        {
                            match field_type_location.to_string().as_str() {
                                "self" => {
                                    let node_field_type_id = get_self_node_field_type_id(
                                        &mut cluster,
                                        &struct_node_list,
                                        &api_name_1,
                                        &api_name_2,
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
                                s if s.starts_with("crate") => {
                                    let key = get_crate_node_key(field_type_location);
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

            let mut file = File::create(format!(
                "../../tests/struct_dependency_dot/{api_name_1}@{api_name_2}.dot"
            ))
            .unwrap();
            file.write_all(output_bytes.as_slice())
                .expect("write failed");
        }
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

fn create_api_field_type_info_vec_sorted(books: &ApiFieldTypeInfo) -> ApiFieldTypeInfoVec<'_> {
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
    node_struct_name.set_label(&format!(
        "<{struct_name}> {struct_name} {struct_label}"
    ));
    node_struct_name.set_shape(Shape::Record);
}

#[cfg(feature = "graphviz")]
fn check_dobule_resitering_struct_name(
    node_struct_name: &mut Node,
    double_resitering_struct_name: &HashMap<String, i64>,
    struct_name: &str,
) {
    if struct_name.ne("Res")
        && struct_name.ne("Req")
        && struct_name.ne("ApiData")
        && double_resitering_struct_name.contains_key(struct_name)
    {
        let count = double_resitering_struct_name.get(struct_name).unwrap();
        if *count > 1 {
            node_struct_name.set_color(Color::Red);
        }
    }
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
    let key: String = format!("{api_name_1}__{api_name_2}__{type_name}");
    if struct_node_list.contains_key(&key) {
        struct_node_list.get(&key).unwrap().clone()
    } else {
        let node_field_type = cluster.node_named(&key);
        node_field_type.id()
    }
}

fn get_crate_node_key(field_type_location: &String) -> String {
    let field_type_location_parse = field_type_location.split("::").collect::<Vec<&str>>();

    let key = format!(
        "{}__{}__{}",
        field_type_location_parse[field_type_location_parse.len() - 3],
        field_type_location_parse[field_type_location_parse.len() - 2],
        field_type_location_parse[field_type_location_parse.len() - 1]
    );
    key
}

type ApiNamePair = (String, String);
type FieldTypeInfo = HashMap<String, (String, String, String)>;
type StructFieldTypeInfo = HashMap<String, FieldTypeInfo>;
type ApiFieldTypeInfo = HashMap<ApiNamePair, StructFieldTypeInfo>;
type ApiFieldTypeInfoVec<'a> = Vec<(&'a ApiNamePair, &'a StructFieldTypeInfo)>;

// Extended types for cfg-aware field tracking
type CfgCondition = Option<(String, bool)>;
// (field_rename, field_type_location, field_type, type_name, cfg_condition)
type FieldEntryExt = (String, String, String, String, CfgCondition);
type StructFieldTypeInfoExt = HashMap<String, Vec<FieldEntryExt>>;
type ApiFieldTypeInfoExt = HashMap<ApiNamePair, StructFieldTypeInfoExt>;

fn filter_books_for_features(
    books_ext: &ApiFieldTypeInfoExt,
    active_features: &BTreeSet<String>,
) -> ApiFieldTypeInfo {
    let mut result = ApiFieldTypeInfo::new();
    for (key, struct_fields_ext) in books_ext.iter() {
        let mut struct_info = StructFieldTypeInfo::new();
        for (struct_name, fields) in struct_fields_ext.iter() {
            let mut field_info = FieldTypeInfo::new();
            for (field_rename, field_type_location, field_type, type_name, cfg_cond) in
                fields.iter()
            {
                let include = match cfg_cond {
                    None => true,
                    Some((feat, true)) => active_features.contains(feat),
                    Some((feat, false)) => !active_features.contains(feat),
                };
                if include {
                    field_info.insert(
                        field_rename.clone(),
                        (
                            field_type_location.clone(),
                            field_type.clone(),
                            type_name.clone(),
                        ),
                    );
                }
            }
            struct_info.insert(struct_name.clone(), field_info);
        }
        result.insert(key.clone(), struct_info);
    }
    result
}

/// Resolve default features from Cargo.toml and intersect with discovered cfg features.
fn resolve_default_features(all_cfg_features: &BTreeSet<String>) -> BTreeSet<String> {
    let cargo_toml = fs::read_to_string("Cargo.toml").expect("failed to read Cargo.toml");

    let re_feature_line =
        regex::Regex::new(r#"^([A-Za-z0-9_]+)\s*=\s*\[([^\]]*)\]"#).unwrap();

    let mut features_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut in_features = false;

    for line in cargo_toml.lines() {
        let trimmed = line.trim();
        if trimmed == "[features]" {
            in_features = true;
            continue;
        }
        if trimmed.starts_with('[') {
            in_features = false;
            continue;
        }
        if in_features {
            if let Some(cap) = re_feature_line.captures(trimmed) {
                let feat_name = cap.get(1).unwrap().as_str().to_string();
                let deps_str = cap.get(2).unwrap().as_str();
                let deps: Vec<String> = deps_str
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').trim_matches('\'').trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                features_map.insert(feat_name, deps);
            }
        }
    }

    // Resolve default features recursively
    let mut resolved = BTreeSet::new();
    let mut queue: Vec<String> = features_map.get("default").cloned().unwrap_or_default();
    while let Some(feat) = queue.pop() {
        if resolved.insert(feat.clone()) {
            if let Some(deps) = features_map.get(&feat) {
                for dep in deps {
                    queue.push(dep.clone());
                }
            }
        }
    }

    // Return only features that appear in cfg annotations
    resolved.intersection(all_cfg_features).cloned().collect()
}

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
