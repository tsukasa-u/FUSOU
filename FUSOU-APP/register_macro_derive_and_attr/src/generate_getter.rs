
use std::any::{Any, TypeId};
use std::collections::HashSet;
use std::hash::RandomState;
use std::sync::{LazyLock, Mutex};

use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

static METHOD_NAME: LazyLock<Mutex<HashSet<TypeId, RandomState>>> = LazyLock::new(|| {
    Mutex::new(HashSet::new())
});

pub fn generate_getter(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    
    let mut get_fields = Vec::new();
    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            let is_defined = METHOD_NAME.lock().unwrap().contains(&struct_data.clone().type_id());
            if is_defined {
                for field in &struct_data.fields {
                    let ident = field.ident.as_ref().unwrap();
                    let ty = &field.ty;
                    let method_name: proc_macro2::TokenStream = format!("get_{}", ident.to_string()).parse().unwrap();
    
                    get_fields.push(quote! {
                        pub fn #method_name(&self) -> #ty {
                            self.#ident.clone()
                        }
                    });
                }
            }
        },
        _ => {
            return Err(syn::Error::new_spanned(&ast.ident, "#[generate_getter] is only defined for structs, not for enums or unions, etc."));
        }
    }
    let struct_name = &ast.ident;
    let (impl_generics, _, where_clause) = &ast.generics.split_for_impl();

    let expanded = quote! {
        impl #impl_generics #struct_name #where_clause {
            #(#get_fields)*
        }
    };

    Ok(TokenStream::from(expanded))
}