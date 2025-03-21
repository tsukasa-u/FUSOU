use proc_macro::TokenStream;
use quote::quote;
use syn::{parse::Parser, DeriveInput};

use darling::ast::NestedMeta;
use darling::FromMeta;

#[derive(Debug, FromMeta)]
struct MacroArgs4AddField {
    #[darling(default)]
    struct_name: Option<()>,
    extra: Option<()>,
}

pub fn add_field(attr: TokenStream, ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let attr_args = match NestedMeta::parse_meta_list(attr.into()) {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };
    // let _input = syn::parse_macro_input!(item as ItemFn);

    let args = match MacroArgs4AddField::from_list(&attr_args) {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };

    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            let tokens_name = match args.struct_name {
                Some(_) => quote! {
                    pub struct_name: HashSet<String, RandomState>
                },
                None => quote! {},
            };

            let tokens_extra = match args.extra {
                Some(_) => quote! {
                    #[serde(flatten, rename = "extra")]
                    pub extra: HashMap<String, serde_json::Value>
                },
                None => quote! {},
            };

            match &mut struct_data.fields {
                syn::Fields::Named(fields) => {
                    if args.struct_name.is_some() {
                        fields
                            .named
                            .push(syn::Field::parse_named.parse2(tokens_name).unwrap());
                    };
                    if args.extra.is_some() {
                        fields
                            .named
                            .push(syn::Field::parse_named.parse2(tokens_extra).unwrap());
                    };
                }
                syn::Fields::Unnamed(_) => todo!(),
                syn::Fields::Unit => todo!(),
            }
        }
        _ => {
            return Err(syn::Error::new_spanned(
                &ast.ident,
                "#[add_field(...)] is only defined for structs, not for enums or unions, etc.",
            ));
        }
    }

    let expanded = quote! {
        #ast
    };

    Ok(TokenStream::from(expanded))
}
