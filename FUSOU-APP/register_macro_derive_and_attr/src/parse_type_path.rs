use proc_macro2::Span;
use quote::quote;
use syn::{AngleBracketedGenericArguments, ParenthesizedGenericArguments};

pub fn parse(ty: syn::Type) -> Result<String, syn::Error> {
    match ty {
        syn::Type::Path(type_path) => match psrse_type_path(type_path) {
            Ok(s) => Ok(s),
            Err(err) => Err(err),
        },
        _ => Err(syn::Error::new_spanned(ty, "Only type path is supported")),
    }
}

pub fn psrse_type_path(ty: syn::TypePath) -> Result<String, syn::Error> {
    if ty.qself.is_some() {
        return Err(syn::Error::new_spanned(ty, "Self type is not supported"));
    }

    if ty.path.leading_colon.is_some() {
        return Err(syn::Error::new_spanned(
            ty,
            "Absolute path is not supported",
        ));
    }

    let mut type_indent: String = String::from("");
    match ty.path.segments.len() {
        0 => {
            return Err(syn::Error::new_spanned(ty, "Empty path is not supported"));
        }
        _ => {
            for (i, path_segment) in ty.path.segments.iter().enumerate() {
                if i > 0 {
                    type_indent.push(',');
                }

                let ident = &path_segment.ident;
                let args = &path_segment.arguments;
                match args {
                    syn::PathArguments::None => {
                        type_indent.push_str(&format!("{}", ident));
                    }
                    syn::PathArguments::AngleBracketed(AngleBracketedGenericArguments {
                        colon2_token,
                        args,
                        ..
                    }) => {
                        if let Some(path_seq) = colon2_token {
                            return Err(syn::Error::new_spanned(
                                path_seq,
                                "Colon2 is not supported",
                            ));
                        }

                        type_indent.push_str(&format!("{}<", ident));

                        match args.len() {
                            0 => {
                                return Err(syn::Error::new_spanned(
                                    args,
                                    "Empty arguments is not supported",
                                ));
                            }
                            _ => {
                                for (j, arg) in args.iter().enumerate() {
                                    if j > 0 {
                                        type_indent.push(',');
                                    }
                                    match arg.to_owned() {
                                        syn::GenericArgument::Lifetime(lifetime) => {
                                            return Err(syn::Error::new_spanned(
                                                lifetime,
                                                "Lifetime is not supported",
                                            ));
                                        }
                                        syn::GenericArgument::Type(_ty) => match parse(_ty) {
                                            Ok(s) => {
                                                type_indent.push_str(&s);
                                            }
                                            Err(err) => {
                                                return Err(err);
                                            }
                                        },
                                        syn::GenericArgument::Const(constant) => {
                                            return Err(syn::Error::new_spanned(
                                                constant,
                                                "Const is not supported",
                                            ));
                                        }
                                        syn::GenericArgument::AssocType(assoc_type) => {
                                            return Err(syn::Error::new_spanned(
                                                assoc_type,
                                                "AssocType is not supported",
                                            ));
                                        }
                                        syn::GenericArgument::AssocConst(assoc_const) => {
                                            return Err(syn::Error::new_spanned(
                                                assoc_const,
                                                "AssocConst is not supported",
                                            ));
                                        }
                                        syn::GenericArgument::Constraint(constraint) => {
                                            return Err(syn::Error::new_spanned(
                                                constraint,
                                                "Constraint is not supported",
                                            ));
                                        }
                                        _ => {
                                            return Err(syn::Error::new_spanned(
                                                arg,
                                                "Unknown argument",
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                        type_indent.push('>');
                    }
                    syn::PathArguments::Parenthesized(ParenthesizedGenericArguments { .. }) => {
                        return Err(syn::Error::new_spanned(
                            args,
                            "Parenthesized is not supported",
                        ));
                    }
                }
            }
        }
    }

    Ok(type_indent)
    // Err(syn::Error::new(Span::call_site(), "not reachabled"))
}

pub fn expand_children(
    str: String,
    num: i32,
    x: proc_macro2::Ident,
    closure: &dyn Fn(&syn::Ident) -> proc_macro2::TokenStream,
) -> proc_macro2::TokenStream {
    let re_vec = regex::Regex::new(r"^\s*Vec<\s*(.*)\s*>\s*$").unwrap();
    let re_option = regex::Regex::new(r"^\s*Option<\s*(.*)\s*>\s*$").unwrap();
    let re_hashmap = regex::Regex::new(r"^\s*HashMap<\s*(.*)\s*,\s*(.*)\s*>\s*$").unwrap();

    if re_vec.is_match(&str) {
        let cap = re_vec.captures(&str).unwrap();
        let ty = cap.get(1).unwrap().as_str();
        let iter_num = proc_macro2::Ident::new(&format!("i{}", num), Span::call_site());
        let res = expand_children(ty.to_owned(), num + 1, iter_num.clone(), closure);
        let for_token = quote! {
            for #iter_num in #x {
                #res
            }
        };
        return for_token;
    } else if re_option.is_match(&str) {
        let cap = re_option.captures(&str).unwrap();
        let ty = cap.get(1).unwrap().as_str();
        let iter_num = proc_macro2::Ident::new(&format!("i{}", num), Span::call_site());
        let res = expand_children(ty.to_owned(), num + 1, iter_num.clone(), closure);
        let option_token = quote! {
            match #x {
                Some(#iter_num) => {
                    #res
                },
                None => ()
            }
        };
        return option_token;
    } else if re_hashmap.is_match(&str) {
        let cap = re_hashmap.captures(&str).unwrap();
        let _ty1 = cap.get(1).unwrap().as_str();
        let ty2 = cap.get(2).unwrap().as_str();
        let iter_num = proc_macro2::Ident::new(&format!("i{}", num), Span::call_site());
        let res = expand_children(ty2.to_owned(), num + 1, iter_num.clone(), closure);
        let hashmap_token = quote! {
            for (_, #iter_num) in #x {
                #res
            }
        };
        return hashmap_token;
    } else {
        return closure(&x);
    }
}

pub fn expand_children_from_self(
    str: String,
    num: i32,
    x: proc_macro2::Ident,
    closure: &dyn Fn(&syn::Ident) -> proc_macro2::TokenStream,
) -> proc_macro2::TokenStream {
    let ident_num = proc_macro2::Ident::new(&format!("i{}", num), Span::call_site());
    let res = expand_children(str, num, ident_num.clone(), closure);
    let repalce_token = quote! {
        let #ident_num = &self.#x;
        {
            #res
        }
    };
    return repalce_token;
}
