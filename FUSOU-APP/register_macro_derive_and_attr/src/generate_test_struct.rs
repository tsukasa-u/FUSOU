use std::{collections::HashSet, hash::RandomState};

use proc_macro::TokenStream;
use quote::quote;
use syn::{DeriveInput, Ident};

extern crate regex;
use regex::Regex;
use sqids::Sqids;

use darling::FromDeriveInput;

use std::sync::{LazyLock, Mutex};

use crate::parse_type_path;

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
static STRUCT_ID: LazyLock<Mutex<HashSet<String, RandomState>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, FromDeriveInput)]
#[darling(attributes(struct_test_case))]
pub struct MacroArgs4GenerateTestStruct {
    #[darling(default)]
    type_value: Option<()>,
    field_extra: Option<()>,
    integration: Option<()>,
}

// pub fn generate_test_struct(attr: TokenStream, ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
pub fn generate_test_struct(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let args = MacroArgs4GenerateTestStruct::from_derive_input(ast).unwrap();

    let ast_str = format!("{:?}", ast.clone());

    let struct_name = &ast.ident;

    let mut test_implementation = Vec::new();
    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            // Is this the way to check the implementation for this struct is already defined?
            // Is it true way to resolve the implementation confliction for this struct?
            let re_span = Regex::new(r"span: #\d+").unwrap();
            let re_bytes = Regex::new(r"bytes:(\d+\.\.\d+)").unwrap();
            let re_space = Regex::new(r"\s+").unwrap();

            let repalce_span = re_span.replace_all(&ast_str, "span: #_").to_string();
            let repalce_bytes = re_bytes
                .replace_all(&repalce_span, "bytes: (_.._)")
                .to_string();
            let repalce_space = re_space.replace_all(&repalce_bytes, "").to_string();

            let ast_bytes = repalce_space.as_bytes();
            let len_ast_bytes = ast_bytes.len();
            let struct_data_vec_u64 = ast_bytes
                .iter()
                .enumerate()
                .filter(|(i, _)| i % 8 == 0)
                .map(|(i, _)| {
                    let mut bytes = [0u8; 8];
                    let i_8 = i * 8;
                    if i_8 + 8 > len_ast_bytes {
                        // ignore this case because the implementation  of this procedure is like pain in the neck
                        // bytes.copy_from_slice(&ast_bytes[i_8..len_ast_bytes]);
                    } else {
                        bytes.copy_from_slice(&ast_bytes[i_8..i_8 + 8]);
                    }
                    
                    u64::from_ne_bytes(bytes)
                })
                .collect::<Vec<u64>>();
            let struct_data_u64_slice = struct_data_vec_u64.as_slice();

            let sqids = Sqids::default();
            let id = sqids.encode(struct_data_u64_slice).unwrap();

            if !STRUCT_ID.lock().unwrap().contains(&id) {
                STRUCT_ID.lock().unwrap().insert(id.to_owned());
            } else {
                return Ok(TokenStream::from(quote! {}));
                // return Err(syn::Error::new_spanned(&ast.ident, "The struct is already defined."));
            }

            if args.field_extra.is_some() {
                test_implementation.push(quote! {
                    fn test_extra(&self, log_map: &mut register_trait::LogMapType) {
                        let extra_field = self.extra.clone();
                        // assert!(extra_field.is_empty(), "\x1b[38;5;{}m extra field is not empty: {:?}\x1b[m ", 8, extra_field);
                        if !extra_field.is_empty() {
                            println!("\x1b[38;5;{}m extra field is not empty: {:?}\x1b[m ", 8, extra_field);
                            let key = ("field_extra".to_string(), stringify!(#struct_name).to_string(), "extra".to_string());
                            if !log_map.contains_key(&key) {
                                log_map.insert(key.clone(), Vec::new());
                            }
                            let mut log_vec = log_map.get_mut(&key).unwrap();
                            log_vec.push(format!("{:?}", format!("extra field is not empty: {:?}", extra_field)));
                        }
                    }
                });
            };

            if args.type_value.is_some() {
                let mut assertions = Vec::new();
                for field in &struct_data.fields {
                    let ident = field.ident.as_ref().unwrap();
                    let ty = &field.ty;

                    if ident.clone() != "extra" {
                        let result_type_str = parse_type_path::parse(ty.to_owned());
                        match result_type_str {
                            Ok(type_str) => {
                                assertions.push(
                                    parse_type_path::expand_children_from_self(
                                        type_str,
                                        0,
                                        Ident::new(&format!("{}", ident.clone()), proc_macro2::Span::call_site()),
                                        &|x: &proc_macro2::Ident| {
                                            return quote! {
                                                if #x.is_value() {
                                                    // assert!(!#x.is_null(), "{} in {} is null", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(!#x.is_boolean(), "{} in {} is a boolean", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(!#x.is_number(), "{} in {} is a number", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(!#x.is_string(), "{} in {} is a string", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(!#x.is_array(), "{} in {} is an array", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(!#x.is_object(), "{} in {} is an object", stringify!(#ident), stringify!(#struct_name));
                                                    // assert!(false, "unknown type: {:?}", #x);

                                                    let key = ("type_value".to_string(), stringify!(#struct_name).to_string(), stringify!(#ident).to_string());
                                                    if !log_map.contains_key(&key) {
                                                        log_map.insert(key.clone(), Vec::new());
                                                    }

                                                    let mut log_vec = log_map.get_mut(&key).unwrap();
                                                    if #x.is_null() {
                                                        log_vec.push("null".to_string());
                                                    } else if #x.is_boolean() {
                                                        log_vec.push("boolean".to_string());
                                                    } else if #x.is_number() {
                                                        log_vec.push(format!("number:{:?}", #x));
                                                    } else if #x.is_string() {
                                                        log_vec.push("string".to_string());
                                                    } else if #x.is_array() {
                                                        log_vec.push(format!("array:{:?}", #x));
                                                    } else if #x.is_object() {
                                                        log_vec.push(format!("object:{:?}", #x));
                                                    } else {
                                                        log_vec.push(format!("unknown:{:?}", #x));
                                                    }
                                                    log_vec.sort();
                                                    log_vec.dedup();
                                                }
                                            };
                                        }
                                    )
                                );
                            }
                            Err(err) => {
                                return Err(err);
                            }
                        }
                    }
                }
                test_implementation.push(quote! {
                    fn test_type_value(&self, log_map: &mut register_trait::LogMapType) {
                        #(#assertions)*
                    }
                });
            };

            if args.integration.is_some() {
                let mut assertions = Vec::new();
                for field in &struct_data.fields {
                    let ident = field.ident.as_ref().unwrap();
                    let ty = &field.ty;

                    if ident.clone() != "extra" {
                        let result_type_str = parse_type_path::parse(ty.to_owned());
                        match result_type_str {
                            Ok(type_str) => {
                                assertions.push(parse_type_path::expand_children_from_self(
                                    type_str,
                                    0,
                                    Ident::new(
                                        &format!("{}", ident.clone()),
                                        proc_macro2::Span::call_site(),
                                    ),
                                    &|x: &proc_macro2::Ident| {
                                        return quote! {
                                            if !#x.is_value() {
                                                #x.test_extra(log_map);
                                                #x.test_type_value(log_map);
                                                #x.test_integration(log_map);
                                            }
                                        };
                                    },
                                ));
                            }
                            Err(err) => {
                                return Err(err);
                            }
                        }
                    }
                }

                test_implementation.push(quote! {
                    fn test_integration(&self, log_map: &mut register_trait::LogMapType) {
                        #(#assertions)*
                    }
                });
            };
        }
        _ => {
            return Err(syn::Error::new_spanned(&ast.ident, "#[generate_test_struct] is only defined for structs, not for enums or unions, etc."));
        }
    }

    let (impl_generics, ty_generics, where_clause) = ast.generics.split_for_impl();

    let expanded = quote! {
        impl #impl_generics TraitForTest for #struct_name #ty_generics #where_clause {
            #(#test_implementation)*
        }
    };

    Ok(TokenStream::from(expanded))
}
