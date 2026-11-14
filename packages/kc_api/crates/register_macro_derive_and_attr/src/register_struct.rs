use std::collections::HashSet;
use std::hash::RandomState;

use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

use darling::ast::NestedMeta;
use darling::FromMeta;

use std::sync::{LazyLock, Mutex};

// Is it better to use onecell::sync::Lazy or std::sync::Lazy?
pub static STRUCT_NAMES: LazyLock<Mutex<HashSet<String, RandomState>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, FromMeta)]
struct MacroArgs4RegisterStruct {
    #[darling(default)]
    name: Option<String>,
    #[allow(dead_code)]
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

            STRUCT_NAMES.lock().unwrap().insert(name.to_owned());
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
