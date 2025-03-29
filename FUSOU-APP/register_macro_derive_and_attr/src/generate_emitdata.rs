use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

pub fn generate_emitdata(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let mut test_implementation = Vec::new();
    match ast.data {
        syn::Data::Enum(_) => {
            let enum_name = ast.ident.clone();
            let (impl_generics, type_generics, where_clause) = &ast.generics.split_for_impl();

            test_implementation.push(quote! {
                impl #impl_generics TraitForEmitData for #enum_name #type_generics #where_clause {}
            });
        }
        _ => {
            return Err(syn::Error::new_spanned(&ast.ident, "#[derive(TraitForEmitData)] is only defined for enum, not for struct or unions, etc."));
        }
    }

    let expanded = quote! {
        #(#test_implementation)*
    };

    Ok(TokenStream::from(expanded))
}
