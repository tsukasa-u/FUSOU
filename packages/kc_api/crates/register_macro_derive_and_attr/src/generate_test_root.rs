use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

pub fn generate_test_root(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let mut test_implementation = Vec::new();
    match ast.data {
        syn::Data::Struct(_) => {
            let struct_name = ast.ident.clone();
            let (impl_generics, type_generics, where_clause) = &ast.generics.split_for_impl();

            let struct_name_str = struct_name.clone().to_string();
            let serde_from_str = match struct_name_str.as_str() {
                "Res" => {
                    quote! {
                        let data_removed_bom: String = data.replace("\u{feff}", "");
                        let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
                        let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();
                        let root_wrap: Result<#struct_name, serde_json::Error> = serde_json::from_str(data_removed_metadata.as_str());
                    }
                }
                "Req" => {
                    quote! {
                        let data_removed_bom: String = data.replace("\u{feff}", "");
                        // let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
                        let data_removed_svdata: String = data_removed_bom;
                        let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();
                        let data_replaced = data_removed_metadata.replace("%5B", "[").replace("%5D", "]").replace("%2C", ",").replace("%3A", ":");
                        // let data_replaced = data_removed_metadata;
                        let root_wrap: Result<#struct_name, serde_qs::Error> = serde_qs::from_str(data_replaced.as_str());
                    }
                }
                _ => return Err(syn::Error::new_spanned(
                    &ast.ident,
                    "#[generate_test_root] is only defined for structs(Res, Req), not for others.",
                )),
            };

            test_implementation.push(quote! {
                #[cfg(test)]
                impl #impl_generics TraitForRoot for #struct_name #type_generics #where_clause {

                    // fn test_deserialize<I, T>(iter_file_path: I) where I: Iterator<Item = std::path::PathBuf>, T: TraitForRoot {
                    fn test_deserialize<I>(iter_file_path: I) -> register_trait::LogMapType where I: Iterator<Item = std::path::PathBuf> {

                        let mut log_map: register_trait::LogMapType = std::collections::HashMap::new();
                        let re_metadata = regex::Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();

                        for file_path in iter_file_path {
                            let data_wrap = std::fs::read_to_string(file_path.clone());
                            match data_wrap {
                                Ok(data) => {
                                    // let data_removed_bom: String = data.replace("\u{feff}", "");
                                    // let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
                                    // let root_wrap: Result<#struct_name, serde_json::Error> = serde_json::from_str(data_removed_svdata.as_str());
                                    #serde_from_str
                                    match root_wrap {
                                        Ok(root) => {
                                            root.test_extra(&mut log_map);
                                            root.test_type_value(&mut log_map);
                                            root.test_integration(&mut log_map);
                                        },
                                        Err(e) => {
                                            // panic!("\x1b[38;5;{}m Failed to parse JSON({:?}): {}\r\n{:#?}\x1b[m ", 8, file_path, e, data_removed_svdata);
                                            println!("\x1b[38;5;{}m Failed to parse JSON({:?}): {}\x1b[m ", 8, file_path, e);
                                            let key = ("deserialize_json".to_string(), stringify!(#struct_name).to_string(), "_".to_string());
                                            if !log_map.contains_key(&key) {
                                                log_map.insert(key.clone(), Vec::new());
                                            }
                                            let mut log_vec = log_map.get_mut(&key).unwrap();
                                            log_vec.push(format!("Failed to parse JSON({:?}): {}\r\n{:#?}", file_path, e, data_removed_svdata));
                                        }
                                    };
                                },
                                Err(e) => {
                                    // panic!("\x1b[38;5;{}m Failed to read file ({:?}): {}\x1b[m ", 8, file_path, e);
                                    println!("\x1b[38;5;{}m Failed to read file ({:?}): {}\x1b[m ", 8, file_path, e);
                                    let key = ("deserialize_json".to_string(), stringify!(#struct_name).to_string(), "_".to_string());
                                    if !log_map.contains_key(&key) {
                                        log_map.insert(key.clone(), Vec::new());
                                    }
                                    let mut log_vec = log_map.get_mut(&key).unwrap();
                                    log_vec.push(format!("Failed to read file ({:?}): {}", file_path, e));
                                }
                            };
                        }
                        log_map
                    }

                    // fn check_number_size<I>(iter_file_path: I) -> register_trait::LogMapNumberSize where I: Iterator<Item = std::path::PathBuf> {

                    //     let mut log_map: register_trait::LogMapNumberSize = std::collections::HashMap::new();
                    //     let re_metadata = regex::Regex::new(r"---\r?\n.*\r?\n.*\r?\n.*\r?\n.*\s*---\r?\n").unwrap();
                        
                    //     for file_path in iter_file_path {
                    //         let data_wrap = std::fs::read_to_string(file_path.clone());
                    //         match data_wrap {
                    //             Ok(data) => {
                    //                 let data_removed_bom: String = data.replace("\u{feff}", "");
                    //                 let data_removed_svdata: String = data_removed_bom.replace("svdata=", "");
                    //                 let data_removed_metadata: String = re_metadata.replace(&data_removed_svdata, "").to_string();

                    //                 let root_wrap: Result<#struct_name, serde_json::Error> = serde_json::from_str(data_removed_metadata.as_str());
                    //                 match root_wrap {
                    //                     Ok(root) => {
                    //                         root.check_number(&mut log_map, None);
                    //                     },
                    //                     Err(_e) => {}
                    //                 };
                    //             },
                    //             Err(_e) => {}
                    //         };
                    //     }
                    //     log_map
                    // }
                }
            });
        }
        _ => {
            return Err(syn::Error::new_spanned(
                &ast.ident,
                "#[generate_test_root] is only defined for structs, not for enums or unions, etc.",
            ));
        }
    }

    let expanded = quote! {
        #(#test_implementation)*
    };

    Ok(TokenStream::from(expanded))
}
