extern crate proc_macro;

use proc_macro::TokenStream;
use syn::{DeriveInput, ItemFn};

mod add_field;
mod generate_getter;
mod generate_convert;
mod generate_test_root;
mod generate_test_struct;
mod register_struct;
mod expand_struct_selector;

mod parse_type_path;

#[proc_macro_attribute]
pub fn expand_struct_selector(attr: TokenStream, item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as ItemFn);
    let result = expand_struct_selector::expand_struct_selector(attr, &mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}

#[proc_macro_attribute]
pub fn register_struct(attr: TokenStream, item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = register_struct::register_struct(attr, &mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}

#[proc_macro_attribute]
pub fn add_field(attr: TokenStream, item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = add_field::add_field(attr, &mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}


#[proc_macro_derive(Getter)]
pub fn generate_getter(item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = generate_getter::generate_getter(&mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}

#[proc_macro_derive(TraitForTest, attributes(struct_test_case))]
pub fn generate_test_struct(item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = generate_test_struct::generate_test_struct(&mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}

#[proc_macro_derive(TraitForRoot)]
pub fn generate_test_root(item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = generate_test_root::generate_test_root(&mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}

#[proc_macro_derive(TraitForConvert)]
pub fn generate_test_convert(item: TokenStream) -> TokenStream {

    let mut ast = syn::parse_macro_input!(item as DeriveInput);
    let result = generate_convert::generate_test_convert(&mut ast);
    match result {
        Ok(generated) => generated,
        Err(err) => err.to_compile_error().into(),
    }

}