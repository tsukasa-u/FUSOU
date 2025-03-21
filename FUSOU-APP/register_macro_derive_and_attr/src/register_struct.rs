use std::collections::HashSet;
use std::hash::RandomState;
use std::path;

use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

use serde::{Deserialize, Serialize};

use darling::ast::NestedMeta;
use darling::FromMeta;

use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
static STRUCT_NAMES: LazyLock<Mutex<HashSet<String, RandomState>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Default, Serialize, Deserialize, Debug)]
pub struct TestConfig {
    pub struct_name: HashSet<String, RandomState>,
}

#[derive(Debug, FromMeta)]
struct MacroArgs4RegisterStruct {
    #[darling(default)]
    name: Option<String>,
    path: Option<String>,
}

pub fn register_struct(
    attr: TokenStream,
    ast: &mut DeriveInput,
) -> Result<TokenStream, syn::Error> {
    let attr_args = match NestedMeta::parse_meta_list(attr.into()) {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };
    // let _input = syn::parse_macro_input!(item as ItemFn);

    let args = match MacroArgs4RegisterStruct::from_list(&attr_args) {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };

    match ast.data {
        syn::Data::Struct(_) => {
            let struct_name = ast.ident.clone();
            let name: String = match args.name {
                Some(v) => v,
                None => struct_name.to_string(),
            };

            {
                STRUCT_NAMES.lock().unwrap().insert(name.to_owned());
            }
            {
                let cfg: TestConfig = TestConfig {
                    struct_name: STRUCT_NAMES
                        .lock()
                        .unwrap()
                        .clone()
                        .into_iter()
                        .collect::<HashSet<String, RandomState>>(),
                };

                match args.path {
                    Some(v) => {
                        confy::store_path(path::PathBuf::from(v), cfg).unwrap();
                    }
                    None => {
                        confy::store("tests-register_struct_name_env", None, cfg).unwrap();
                    }
                }
            }
        }
        _ => {
            return Err(syn::Error::new_spanned(
                &ast.ident,
                "#[register_struct] is only defined for structs, not for enums or unions, etc.",
            ));
        }
    }

    let expanded = quote! {
        #ast
    };

    Ok(TokenStream::from(expanded))
}
