use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

pub fn generate_number_size_checker(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let struct_name = &ast.ident;
    let mut filed_check_number = Vec::new();
    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            for field in &struct_data.fields {
                let ident = field.ident.as_ref().unwrap();

                filed_check_number.push(quote! {

                    let key = (register_trait::util::type_of(&self).to_string(), stringify!(#ident).to_string(), register_trait::util::type_of(&self.#ident).to_string());
                    
                    self.#ident.check_number(log_map, Some(key));
                });
            }
        }
        _ => {
            return Err(syn::Error::new_spanned(
                &ast.ident,
                "#[NumberSizeChecker] is only defined for structs, not for enums or unions, etc.",
            ));
        }
    }
    let (impl_generics, ty_generics, where_clause) = ast.generics.split_for_impl();

    let expanded = quote! {
        #[cfg(test)]
        impl #impl_generics NumberSizeChecker for #struct_name #ty_generics #where_clause {
            
            #[cfg(test)]
            fn check_number(&self, log_map: &mut register_trait::LogMapNumberSize, key: Option<(String, String, String)>) {
                #(#filed_check_number)*
            }
        }
    };

    Ok(TokenStream::from(expanded))
}
