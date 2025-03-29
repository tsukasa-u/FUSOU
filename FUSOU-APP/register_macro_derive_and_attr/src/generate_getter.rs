use proc_macro::TokenStream;
use quote::quote;
use syn::DeriveInput;

// static METHOD_NAME: LazyLock<Mutex<HashSet<TypeId, RandomState>>> = LazyLock::new(|| {
//     Mutex::new(HashSet::new())
// });

pub fn generate_getter(ast: &mut DeriveInput) -> Result<TokenStream, syn::Error> {
    let struct_name = &ast.ident;
    // let mut get_fields = Vec::new();
    let mut filed_check_number = Vec::new();
    // let mut filed_names = Vec::new();
    match ast.data {
        syn::Data::Struct(ref mut struct_data) => {
            // let is_defined = METHOD_NAME.lock().unwrap().contains(&struct_data.clone().type_id());
            // if is_defined {
            for field in &struct_data.fields {
                let ident = field.ident.as_ref().unwrap();
                // let ty = &field.ty.to_token_stream();
                // let method_name: proc_macro2::TokenStream = format!("get_{}", ident.to_string()).parse().unwrap();
                // filed_names.push(ident.clone());

                filed_check_number.push(quote! {
                        // println!("{}", stringify!(#ty));
                        // if self.#ident.is_number() {
                            // let key = (register_trait::util::type_of(self), stringify!(#ident).to_string(), register_trait::util::type_of(self.#ident));
                            // println!("{}", key);
                            // let value = vec![self.#ident];
                            // if log_map.contains_key(&key) {
                            //     log_map.get_mut(&key).unwrap().extend(value);
                            // } else {
                            //     log_map.insert(key, value);
                            // }
                        // }

                        let key = (register_trait::util::type_of(&self).to_string(), stringify!(#ident).to_string(), register_trait::util::type_of(&self.#ident).to_string());
                        // println!("{:?}", key);

                        self.#ident.check_number(log_map, Some(key));
                    });

                // get_fields.push(quote! {
                //     pub fn #method_name(&self) -> #ty {
                //         self.#ident.clone()
                //     }
                // });
            }
            // }
        }
        _ => {
            return Err(syn::Error::new_spanned(
                &ast.ident,
                "#[generate_getter] is only defined for structs, not for enums or unions, etc.",
            ));
        }
    }
    let (impl_generics, ty_generics, where_clause) = ast.generics.split_for_impl();

    let expanded = quote! {
        impl #impl_generics Getter for #struct_name #ty_generics #where_clause {
            // #(#get_fields)*

            // fn fn_map<F, T>(&self, f: F) where F: Fn(T) {
            //     #(f(self.#filed_names);)*
            //     #(self.#filed_names.fn_map(f);)*
            // }

            fn check_number(&self, log_map: &mut register_trait::LogMapNumberSize, key: Option<(String, String, String)>) {
                // let mut log_map = register_trait::LogMapNumberSize::new();
                // println!("not implemented");
                // println!("{:?}", vec![#(#filed_names),*]);

                #(#filed_check_number)*

                // #(
                //     println!("{:?}", self.#filed_names);
                //     if self.#filed_names.is_number() {
                //         let key = (type_of(self), stringify!(#filed_names).to_string(), type_of(self.#filed_names));
                //         let value = vec![self.#filed_names];
                //         if log_map.contains_key(&key) {
                //             log_map.get_mut(&key).unwrap().extend(value);
                //         } else {
                //             log_map.insert(key, value);
                //         }
                //     }
                // )*

                // #(
                //     let returned_log_map = self.#filed_names.check_number();
                //     println!("{:?}", returned_log_map);
                //     for (key, value) in returned_log_map {
                //         if log_map.contains_key(&key) {
                //             log_map.get_mut(&key).unwrap().extend(value);
                //         } else {
                //             log_map.insert(key, value);
                //         }
                //     }
                // )*

                // log_map
            }
        }
    };

    Ok(TokenStream::from(expanded))
}
