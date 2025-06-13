use core::panic;
use std::fs;
use std::ops::Deref;
use std::path;

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::ItemFn;

use darling::ast::NestedMeta;
use darling::FromMeta;

#[derive(Debug, FromMeta)]
pub struct MacroArgs4ExpandStructSelector {
    #[darling(default)]
    path: path::PathBuf,
}

pub fn expand_struct_selector(
    attr: TokenStream,
    ast: &mut ItemFn,
) -> Result<TokenStream, syn::Error> {
    let attr_args = match NestedMeta::parse_meta_list(attr.into()) {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };
    // let _input = syn::parse_macro_input!(item as ItemFn);

    let args = match MacroArgs4ExpandStructSelector::from_list(&attr_args) {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };

    let name_in = ast.sig.inputs.iter().any(|fn_arg| {
        if let syn::FnArg::Typed(pat_type) = fn_arg {
            if !pat_type.attrs.is_empty() {
                return false;
            }

            if let syn::Pat::Ident(pat_ident) = pat_type.pat.deref() {
                // I don't feel like to use '==' because '==' let me feel like I compare the reference of the string.
                if !(pat_ident.ident.to_string().eq("name")
                    && pat_ident.attrs.is_empty()
                    && pat_ident.by_ref.is_none()
                    && pat_ident.mutability.is_none()
                    && pat_ident.subpat.is_none())
                {
                    return false;
                }
            } else {
                return false;
            }

            // if let syn::token::Colon(colon) = pat_type.colon_token {} else {
            //     return false;
            // }

            if let syn::Type::Path(type_path) = pat_type.ty.deref() {
                if !(type_path.qself.is_none()
                    && type_path.path.leading_colon.is_none()
                    && type_path.path.segments.len() == 1)
                {
                    return false;
                }
                if !type_path.path.segments[0].ident.to_string().eq("String") {
                    return false;
                }
                if let syn::PathArguments::None = type_path.path.segments[0].arguments {
                    return true;
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
        return false;
    });

    if !name_in {
        return Err(syn::Error::new_spanned(
            ast.sig.inputs.clone(),
            "The function should have the reservedargument named 'name: String'",
        ));
    }

    let mut resutlt_out = false;
    if let syn::ReturnType::Type(_, box_type) = &ast.sig.output {
        if let syn::Type::Path(path) = box_type.deref() {
            if path.qself.is_none()
                && path.path.leading_colon.is_none()
                && path.path.segments.len() == 1
                && path.path.segments[0].ident.to_string().eq("Result")
            {
                resutlt_out = true;
            }
        }
    }

    if !resutlt_out {
        return Err(syn::Error::new_spanned(
            ast.sig.output.clone(),
            "The function should return Result<_, Box<dyn std::error::Error>>",
        ));
    }

    let mut body = Vec::new();
    for s in &ast.block.stmts {
        body.push(quote! { #s});
    }

    let mut file_list: Vec<((String, String), (String, String))> = Vec::new();
    if !args.path.exists() {
        return Err(syn::Error::new_spanned(
            ast.sig.output.clone(),
            "The path is not exist",
        ));
    }
    let paths = fs::read_dir(args.path);
    if paths.is_err() {
        return Err(syn::Error::new_spanned(
            ast.sig.output.clone(),
            "The path is not exist",
        ));
    }
    let paths = paths.unwrap();

    let Ok(re) = regex::Regex::new(
        r#"#\[(register_macro_derive_and_attr::)?register_struct\(name\s*=\s*\\?\"(?<arg1>[a-zA-Z0-9_]+)/(?<arg2>[a-zA-Z0-9_]+)\\?\"\)\]"#,
    ) else {
        panic!("can not create regex");
    };

    for file_path in paths.flatten().map(|entry| entry.path()) {
        let metadata = fs::metadata(file_path.clone()).expect(&format!(
            "can not get metadata of the file({})",
            file_path.display()
        ));
        let file_type = metadata.file_type();
        if file_type.is_dir() {
            let file_dir = fs::read_dir(file_path.clone());
            if file_dir.is_err() {
                continue;
            }
            let file_dir = file_dir.unwrap();
            for entry in file_dir {
                if entry.is_err() {
                    continue;
                }
                let entry = entry.unwrap().path();
                if entry.to_str().unwrap().ends_with(".rs")
                    && !entry.to_str().unwrap().ends_with("mod.rs")
                {
                    // let lit = syn::LitStr::new(&format!("kcsapi/{}/{}", file_path.display(), entry.display()), Span::call_site());
                    let file_name = (
                        file_path.file_stem().unwrap().to_string_lossy().to_string(),
                        entry.file_stem().unwrap().to_string_lossy().to_string(),
                    );
                    let Ok(file_content) = fs::read_to_string(entry.clone()) else {
                        panic!(
                            "can not read the file({})",
                            entry.to_string_lossy().to_string()
                        );
                    };

                    if re.is_match(&file_content) {
                        let caps = re.captures(&file_content).unwrap();
                        let Some(s1) = caps.name("arg1") else {
                            panic!(
                                "can not find the arg(1) in register_struct macro in the file({})",
                                entry.to_string_lossy().to_string()
                            );
                        };
                        let Some(s2) = caps.name("arg2") else {
                            panic!(
                                "can not find the arg(2) in register_struct macro in the file({})",
                                entry.to_string_lossy().to_string()
                            );
                        };
                        let struct_name = (s1.as_str().to_string(), s2.as_str().to_string());
                        file_list.push((struct_name, file_name));
                    } else {
                        panic!(
                            "can not find register_struct macro in the file({})",
                            entry.to_string_lossy().to_string()
                        );
                    }
                }
            }
        }
    }

    let mut match_list = Vec::new();
    for (s1, s2) in &file_list {
        let lit = syn::LitStr::new(&format!("/kcsapi/{}/{}", s1.0, s1.1), Span::call_site());
        // let use_ident = syn::Ident::new(&format!("kcapi_main::{}::{}::Root;",s1 ,s2), Span::call_site());
        let ident_s2_0 = syn::Ident::new(&s2.0, Span::call_site());
        let ident_s2_1 = syn::Ident::new(&s2.1, Span::call_site());
        match_list.push(quote! {
            #lit => {
                use kc_api::kcapi_main::#ident_s2_0::#ident_s2_1 as kcsapi_lib;
                #(#body)*
            },
        });
    }

    // what should I do to use name in function arguments?
    let match_wrap = quote! {
        match name.as_str() {
            #(#match_list)*
            _ => {}
        }
    };

    let return_wrap = quote! {
        return Err(Box::new(std::io::Error::new(std::io::ErrorKind::Other, "The name is not match any word")));
    };

    ast.block.stmts.clear();
    ast.block.stmts.push(syn::parse_quote! {
        #match_wrap
    });
    ast.block.stmts.push(syn::parse_quote! {
        #return_wrap
    });

    let expanded = quote! {
        #ast
    };

    Ok(TokenStream::from(expanded))
}
