use std::ops::Deref;
use std::fs;
use std::path;

use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::ItemFn;

use darling::FromMeta;
use darling::ast::NestedMeta;

#[derive(Debug, FromMeta)]
pub struct MacroArgs4ExpandStructSelector {
    #[darling(default)]
    path: path::PathBuf,
}

pub fn expand_struct_selector(attr: TokenStream, ast: &mut ItemFn) -> Result<TokenStream, syn::Error> {
    
    let attr_args = match NestedMeta::parse_meta_list(attr.into()) {
        Ok(v) => v,
        Err(e) => { return Err(e); }
    };
    // let _input = syn::parse_macro_input!(item as ItemFn);

    let args = match MacroArgs4ExpandStructSelector::from_list(&attr_args) {
        Ok(v) => v,
        Err(e) => { return Err(e.into()); }
    };
    
    let mut body = Vec::new();

    // let arg_checker = Vec::new();
    for s in &ast.sig.inputs {
        if let syn::FnArg::Typed(pat) = s {
            let pat = pat.pat.deref();
            println!("{:?}", pat);
        }
    }
    
    for s in &ast.block.stmts {
        body.push(quote! { #s});
    }
    

    let mut file_list = Vec::new();
    let paths = fs::read_dir(args.path).unwrap();
    for path in paths {
        let file_path = path.unwrap().path();
        let metadata = fs::metadata(file_path.clone()).unwrap();
        let file_type = metadata.file_type();
        if file_type.is_dir() {
            for entry in fs::read_dir(file_path.clone()).unwrap() {
                let entry = entry.unwrap().path();
                if entry.to_str().unwrap().ends_with(".rs") {
                    if !entry.to_str().unwrap().ends_with("mod.rs") {
                        // let lit = syn::LitStr::new(&format!("kcsapi/{}/{}", file_path.display(), entry.display()), Span::call_site());
                        let file_name = (file_path.file_stem().unwrap().to_string_lossy().to_string(), entry.file_stem().unwrap().to_string_lossy().to_string());
                        let Ok(file_content) = fs::read_to_string(entry.clone()) else {
                            panic!("can not read the file({})", entry.to_string_lossy().to_string());
                        };

                        let Ok(re) = regex::Regex::new(r#"#\[(register_macro_derive_and_attr::)?register_struct\(name\s*=\s*\\?\"(?<arg1>[a-zA-Z0-9_]+)/(?<arg2>[a-zA-Z0-9_]+)\\?\"\)\]"#) else {
                            panic!("can not create regex");
                        };

                        if re.is_match(&file_content) {
                            let caps = re.captures(&file_content).unwrap();
                            let Some(s1) = caps.name("arg1") else {
                                panic!("can not find the arg(1) in register_struct macro in the file({})", entry.to_string_lossy().to_string());
                            };
                            let Some(s2) = caps.name("arg2") else {
                                panic!("can not find the arg(2) in register_struct macro in the file({})", entry.to_string_lossy().to_string());
                            };
                            let struct_name = (s1.as_str().to_string(), s2.as_str().to_string());
                            file_list.push((struct_name, file_name));
                        } else {
                            panic!("can not find register_struct macro in the file({})", entry.to_string_lossy().to_string());
                        }
                    }
                }
            }
        }
    }

    let mut match_list = Vec::new();
    for (s1, s2) in &file_list {
        let lit = syn::LitStr::new(&format!("kcsapi/{}/{}", s1.0, s1.1), Span::call_site());
        // let use_ident = syn::Ident::new(&format!("kcapi::{}::{}::Root;",s1 ,s2), Span::call_site());
        let ident_s2_0 = syn::Ident::new(&s2.0, Span::call_site());
        let ident_s2_1 = syn::Ident::new(&s2.1, Span::call_site());
        match_list.push(quote! {
            #lit => {
                use crate::kcapi::#ident_s2_0::#ident_s2_1 as kcsapi_lib;
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
    
    ast.block.stmts.clear();
    ast.block.stmts.push(syn::parse_quote! {
        #match_wrap
    });

    let expanded = quote! {
        #ast
    };

    Ok(TokenStream::from(expanded))
}