use proc_macro::TokenStream;
use quote::quote;
use syn::{parse::Parser, DeriveInput};

use darling::ast::NestedMeta;
use darling::FromMeta;

#[derive(Debug, FromMeta)]
struct MacroArgs4AddField {
    #[darling(default)]
    struct_name: Option<()>,
    extra_with_flatten: Option<()>,
    extra_for_qs: Option<()>,
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

    if args.struct_name.is_none()
        && args.extra_with_flatten.is_none()
        && args.extra_for_qs.is_none()
    {
        return Err(syn::Error::new_spanned(
            &ast.ident,
            "#[add_field(...)] requires at least one of struct_name, extra_with_flatten, or extra_for_qs to be specified.",
        ));
    }

    if args.extra_with_flatten.is_some() && args.extra_for_qs.is_some() {
        return Err(syn::Error::new_spanned(
            &ast.ident,
            "#[add_field(...)] cannot specify both extra_with_flatten and extra_for_qs at the same time.",
        ));
    }

    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            let tokens_name = match args.struct_name {
                Some(_) => quote! {
                    pub struct_name: HashSet<String, RandomState>
                },
                None => quote! {},
            };

            let tokens_extra_with_flatten = match args.extra_with_flatten {
                Some(_) => quote! {
                    #[serde(flatten)]
                    extra: std::collections::HashMap<String, serde_json::Value>
                },
                None => quote! {},
            };
            let tokens_extra_for_qs = match args.extra_for_qs {
                Some(_) => quote! {
                    #[qs(extra)]
                    extra: std::collections::HashMap<String, serde_json::Value>
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
                    if args.extra_with_flatten.is_some() {
                        fields.named.push(
                            syn::Field::parse_named
                                .parse2(tokens_extra_with_flatten)
                                .unwrap(),
                        );
                    };
                    if args.extra_for_qs.is_some() {
                        fields
                            .named
                            .push(syn::Field::parse_named.parse2(tokens_extra_for_qs).unwrap());
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
