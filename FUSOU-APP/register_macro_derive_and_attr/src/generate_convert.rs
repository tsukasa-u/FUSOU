use darling::FromDeriveInput;
use proc_macro::TokenStream;
use quote::{quote, ToTokens};
use syn::DeriveInput;

#[derive(Debug, FromDeriveInput)]
#[darling(attributes(convert_output))]
pub struct MacroArgs4GenerateConvert {
    output: syn::Ident,
}

pub fn generate_convert(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    // panic!("{:?}", ast.attrs);

    let args = MacroArgs4GenerateConvert::from_derive_input(&ast).unwrap();

    let mut test_implementation = Vec::new();
    match ast.data {
        syn::Data::Struct(_) => {
            let struct_name = ast.ident.clone();
            let (impl_generics, type_generics, where_clause) = &ast.generics.split_for_impl();

            let output_token = args.output.to_token_stream();

            test_implementation.push(quote! {
                impl #impl_generics TraitForConvert for #struct_name #type_generics #where_clause {
                    type Output = #output_token;
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
