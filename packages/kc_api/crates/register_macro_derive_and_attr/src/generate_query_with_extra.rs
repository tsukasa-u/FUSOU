use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::{
    parse_quote, Attribute, Data, DeriveInput, Expr, ExprLit, Fields, GenericArgument,
    GenericParam, Ident, Lifetime, LifetimeParam, Lit, Meta, PathArguments, Type, TypePath,
    WhereClause,
};

type Predicates = syn::punctuated::Punctuated<syn::WherePredicate, syn::token::Comma>;

struct FieldInfo {
    ident: Ident,
    ty: Type,
    rename: String,
    is_extra: bool,
    vec_like: Option<VecLikeInfo>,
    map_like: Option<MapLikeInfo>,
}

struct VecLikeInfo {
    inner: Type,
    wraps_option: bool,
}

struct MapLikeInfo {
    key: Type,
    value: Type,
    wraps_option: bool,
}

pub fn expand(input: DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let struct_ident = input.ident;
    let generics = input.generics;
    let data = match input.data {
        Data::Struct(data) => data,
        _ => {
            return Err(syn::Error::new_spanned(
                struct_ident,
                "QueryWithExtra only supports structs",
            ))
        }
    };

    let fields = match data.fields {
        Fields::Named(fields) => fields.named,
        _ => {
            return Err(syn::Error::new_spanned(
                struct_ident,
                "QueryWithExtra only supports structs with named fields",
            ))
        }
    };

    let mut infos = Vec::<FieldInfo>::new();
    let mut extra_field: Option<FieldInfo> = None;

    for field in fields {
        let ident = field.ident.expect("named field");
        let mut rename = ident.to_string();
        let mut is_extra = false;

        for attr in field.attrs.iter().filter(|a| a.path().is_ident("qs")) {
            parse_qs_attr(attr, &mut rename, &mut is_extra)?;
        }

        let info = FieldInfo {
            ident: ident.clone(),
            ty: field.ty.clone(),
            rename,
            is_extra,
            vec_like: extract_vec_like(&field.ty),
            map_like: extract_map_like(&field.ty),
        };

        if info.is_extra {
            if extra_field.is_some() {
                return Err(syn::Error::new_spanned(
                    ident,
                    "qs(extra) can be specified on only one field",
                ));
            }
            extra_field = Some(info);
        } else {
            infos.push(info);
        }
    }

    let extra = extra_field
        .ok_or_else(|| syn::Error::new_spanned(&struct_ident, "qs(extra) field not found"))?;

    let (impl_generics, ty_generics, _) = generics.split_for_impl();
    let mut serialize_where: WhereClause =
        generics.where_clause.clone().unwrap_or_else(empty_where);

    for info in &infos {
        let ty = &info.ty;
        serialize_where
            .predicates
            .push(parse_quote!(#ty: ::serde::de::DeserializeOwned + ::serde::ser::Serialize + ::core::default::Default));
        if let ::core::option::Option::Some(vec_like) = &info.vec_like {
            let inner = &vec_like.inner;
            serialize_where
                .predicates
                .push(parse_quote!(#inner: ::core::str::FromStr));
            serialize_where
                .predicates
                .push(parse_quote!(<#inner as ::core::str::FromStr>::Err: ::core::fmt::Display));
            serialize_where
                .predicates
                .push(parse_quote!(#inner: ::core::fmt::Display));
        }
        if let ::core::option::Option::Some(map_like) = &info.map_like {
            let key = &map_like.key;
            serialize_where
                .predicates
                .push(parse_quote!(#key: ::core::fmt::Display));
            serialize_where
                .predicates
                .push(parse_quote!(#key: ::core::str::FromStr));
            serialize_where
                .predicates
                .push(parse_quote!(<#key as ::core::str::FromStr>::Err: ::core::fmt::Display));
        }
    }
    let extra_ty = &extra.ty;
    serialize_where
        .predicates
        .push(parse_quote!(#extra_ty: ::core::default::Default));

    let mut de_generics = generics.clone();
    de_generics.params.insert(
        0,
        GenericParam::Lifetime(LifetimeParam::new(Lifetime::new("'de", Span::call_site()))),
    );
    let (de_impl_generics, de_ty_generics, _) = de_generics.split_for_impl();
    let deserialize_where = serialize_where.clone();

    let field_vars: Vec<Ident> = infos
        .iter()
        .map(|info| format_ident!("__field_{}", info.ident))
        .collect();

    let create_field_slots = infos.iter().zip(&field_vars).map(|(info, var)| {
        let ty = &info.ty;
        quote! { let mut #var: ::core::option::Option<#ty> = ::core::option::Option::None; }
    });

    let field_handlers = infos.iter().zip(&field_vars).map(|(info, var)| {
        let key = &info.rename;
        let ty = &info.ty;
        let string_fallback = if let ::core::option::Option::Some(map_like) = &info.map_like {
            let key_ty = &map_like.key;
            let value_ty = &map_like.value;
            let wrap_result = if map_like.wraps_option {
                quote! {
                    if parsed_map.is_empty() {
                        ::core::default::Default::default()
                    } else {
                        ::core::option::Option::Some(parsed_map)
                    }
                }
            } else {
                quote! { parsed_map }
            };
            quote! {
                if s.trim().is_empty() {
                    ::core::default::Default::default()
                } else {
                    let mut parsed_map: ::std::collections::HashMap<#key_ty, #value_ty> = ::std::collections::HashMap::new();
                    for pair in s.split('&') {
                        if pair.is_empty() {
                            continue;
                        }
                        let mut kv = pair.splitn(2, '=');
                        let entry_key_raw = kv.next().unwrap_or("");
                        let entry_value_raw = kv.next().unwrap_or("");

                        let key_fragment_opt = if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "[")) {
                            stripped.strip_suffix(']')
                        } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "%5B")) {
                            stripped.strip_suffix("%5D")
                        } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "%5b")) {
                            stripped.strip_suffix("%5d")
                        } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix('[') {
                            stripped.strip_suffix(']')
                        } else {
                            None
                        };

                        let Some(inner_key) = key_fragment_opt else {
                            continue;
                        };

                        if inner_key.is_empty() {
                            return ::core::result::Result::Err(::serde::de::Error::custom(
                                format!("failed to decode map key `{}`: empty key", #key)
                            ));
                        }

                        let parsed_key: #key_ty = inner_key.parse().map_err(|err| {
                            ::serde::de::Error::custom(format!(
                                "failed to decode map key `{}`: {}",
                                #key, err
                            ))
                        })?;

                        let parsed_value: #value_ty = if entry_value_raw.is_empty() {
                            ::core::default::Default::default()
                        } else {
                            match ::serde_json::from_str::<#value_ty>(entry_value_raw) {
                                ::core::result::Result::Ok(val) => val,
                                ::core::result::Result::Err(_) => {
                                    let escaped = entry_value_raw
                                        .replace('\\', "\\\\")
                                        .replace('"', "\\\"");
                                    let json_literal = ::std::format!("\"{}\"", escaped);
                                    ::serde_json::from_str::<#value_ty>(&json_literal).map_err(|err| {
                                        ::serde::de::Error::custom(format!(
                                            "failed to decode map value `{}`: {}",
                                            #key, err
                                        ))
                                    })?
                                }
                            }
                        };

                        parsed_map.insert(parsed_key, parsed_value);
                    }

                    #wrap_result
                }
            }
        } else if let ::core::option::Option::Some(vec_like) = &info.vec_like {
            let inner = &vec_like.inner;
            let wrap_vec = if vec_like.wraps_option {
                quote! { ::core::option::Option::Some(parsed_vec) }
            } else {
                quote! { parsed_vec }
            };
            quote! {
                if s.is_empty() {
                    ::core::default::Default::default()
                } else {
                    match ::serde_json::from_str::<#ty>(s) {
                        ::core::result::Result::Ok(v) => v,
                        ::core::result::Result::Err(_) => {
                            let parsed_vec = s
                                .split(',')
                                .map(|part| part.trim())
                                .filter(|part| !part.is_empty())
                                .map(|part| part.parse::<#inner>().map_err(|err| {
                                    ::serde::de::Error::custom(format!(
                                        "failed to decode field `{}`: {}",
                                        #key, err
                                    ))
                                }))
                                .collect::<::core::result::Result<::std::vec::Vec<#inner>, _>>()?;
                            #wrap_vec
                        }
                    }
                }
            }
        } else {
            quote! {
                if s.is_empty() {
                    ::core::default::Default::default()
                } else {
                    ::serde_json::from_str::<#ty>(s).map_err(|err| {
                        ::serde::de::Error::custom(format!(
                            "failed to decode field `{}`: {}",
                            #key, err
                        ))
                    })?
                }
            }
        };
        let map_like_branch = if let ::core::option::Option::Some(map_like) = &info.map_like {
            let key_ty = &map_like.key;
            let value_ty = &map_like.value;
            let map_insert = if map_like.wraps_option {
                quote! {
                    let container = #var.get_or_insert_with(::core::default::Default::default);
                    let entry = container.get_or_insert_with(::core::default::Default::default);
                    entry.insert(parsed_key, parsed_value);
                }
            } else {
                quote! {
                    let entry = #var.get_or_insert_with(::core::default::Default::default);
                    entry.insert(parsed_key, parsed_value);
                }
            };
            quote! {
                let is_plain_bracket = key.starts_with(concat!(#key, "[")) && key.ends_with(']');
                let is_encoded_upper = key.starts_with(concat!(#key, "%5B")) && key.ends_with("%5D");
                let is_encoded_lower = key.starts_with(concat!(#key, "%5b")) && key.ends_with("%5d");
                if is_plain_bracket || is_encoded_upper || is_encoded_lower {
                    let inner_key_slice = if is_plain_bracket {
                        &key[#key.len() + 1 .. key.len() - 1]
                    } else {
                        &key[#key.len() + 3 .. key.len() - 3]
                    };
                    if inner_key_slice.is_empty() {
                        return ::core::result::Result::Err(::serde::de::Error::custom(
                            format!("failed to decode map key for `{}`: empty key", #key)
                        ));
                    }
                    let parsed_key: #key_ty = inner_key_slice.parse().map_err(|err| {
                        ::serde::de::Error::custom(format!(
                            "failed to decode map key for `{}`: {}",
                            #key, err
                        ))
                    })?;
                    let raw: ::serde_json::Value = map.next_value()?;
                    let parsed_value: #value_ty = match ::serde_json::from_value::<#value_ty>(raw.clone()) {
                        ::core::result::Result::Ok(v) => v,
                        ::core::result::Result::Err(_) => {
                            if let ::serde_json::Value::String(ref s) = raw {
                                ::serde_json::from_str::<#value_ty>(s).map_err(|err| {
                                    ::serde::de::Error::custom(format!(
                                        "failed to decode map value for `{}`: {}",
                                        #key, err
                                    ))
                                })?
                            } else {
                                return ::core::result::Result::Err(::serde::de::Error::custom(
                                    format!("failed to decode map value for `{}`: {:?}", #key, raw)
                                ));
                            }
                        }
                    };
                    #map_insert
                    continue;
                }
            }
        } else {
            quote! {}
        };
        let array_fallback = if let ::core::option::Option::Some(map_like) = &info.map_like {
            let key_ty = &map_like.key;
            let value_ty = &map_like.value;
            let wrap_result = if map_like.wraps_option {
                quote! { ::core::option::Option::Some(parsed_map) }
            } else {
                quote! { parsed_map }
            };
            quote! {
                let mut parsed_map: ::std::collections::HashMap<#key_ty, #value_ty> = ::std::collections::HashMap::new();
                for item in arr {
                    match item {
                        ::serde_json::Value::Object(obj) => {
                            for (entry_key, entry_value) in obj {
                                let parsed_key: #key_ty = entry_key.parse().map_err(|err| {
                                    ::serde::de::Error::custom(format!(
                                        "failed to decode map key `{}`: {}",
                                        #key, err
                                    ))
                                })?;
                                let parsed_value: #value_ty = match ::serde_json::from_value::<#value_ty>(entry_value.clone()) {
                                    ::core::result::Result::Ok(val) => val,
                                    ::core::result::Result::Err(_) => {
                                        if let ::serde_json::Value::String(ref s) = entry_value {
                                            ::serde_json::from_str::<#value_ty>(s).map_err(|err| {
                                                ::serde::de::Error::custom(format!(
                                                    "failed to decode map value `{}`: {}",
                                                    #key, err
                                                ))
                                            })?
                                        } else {
                                            return ::core::result::Result::Err(::serde::de::Error::custom(
                                                format!("failed to decode map value `{}`: {:?}", #key, entry_value)
                                            ));
                                        }
                                    }
                                };
                                parsed_map.insert(parsed_key, parsed_value);
                            }
                        }
                        ::serde_json::Value::Array(inner) => {
                            if inner.len() != 2 {
                                return ::core::result::Result::Err(::serde::de::Error::custom(
                                    format!("failed to decode field `{}`: expected key/value pair array", #key)
                                ));
                            }
                            let key_fragment = match &inner[0] {
                                ::serde_json::Value::String(s) => s.clone(),
                                other => ::serde_json::to_string(other).map_err(|err| {
                                    ::serde::de::Error::custom(format!(
                                        "failed to decode map key `{}`: {}",
                                        #key, err
                                    ))
                                })?,
                            };
                            let parsed_key: #key_ty = key_fragment.parse().map_err(|err| {
                                ::serde::de::Error::custom(format!(
                                    "failed to decode map key `{}`: {}",
                                    #key, err
                                ))
                            })?;
                            let parsed_value: #value_ty = match ::serde_json::from_value::<#value_ty>(inner[1].clone()) {
                                ::core::result::Result::Ok(val) => val,
                                ::core::result::Result::Err(_) => {
                                    if let ::serde_json::Value::String(ref s) = inner[1] {
                                        ::serde_json::from_str::<#value_ty>(s).map_err(|err| {
                                            ::serde::de::Error::custom(format!(
                                                "failed to decode map value `{}`: {}",
                                                #key, err
                                            ))
                                        })?
                                    } else {
                                        return ::core::result::Result::Err(::serde::de::Error::custom(
                                            format!("failed to decode map value `{}`: {:?}", #key, inner[1])
                                        ));
                                    }
                                }
                            };
                            parsed_map.insert(parsed_key, parsed_value);
                        }
                        ::serde_json::Value::String(item_str) => {
                            for pair in item_str.split('&') {
                                if pair.is_empty() {
                                    continue;
                                }
                                let mut kv = pair.splitn(2, '=');
                                let entry_key_raw = kv.next().unwrap_or("");
                                let entry_value_raw = kv.next().unwrap_or("");

                                let key_fragment_opt = if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "[")) {
                                    stripped.strip_suffix(']')
                                } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "%5B")) {
                                    stripped.strip_suffix("%5D")
                                } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix(concat!(#key, "%5b")) {
                                    stripped.strip_suffix("%5d")
                                } else if let ::core::option::Option::Some(stripped) = entry_key_raw.strip_prefix('[') {
                                    stripped.strip_suffix(']')
                                } else {
                                    None
                                };

                                let Some(inner_key) = key_fragment_opt else {
                                    continue;
                                };

                                if inner_key.is_empty() {
                                    return ::core::result::Result::Err(::serde::de::Error::custom(
                                        format!("failed to decode map key `{}`: empty key", #key)
                                    ));
                                }

                                let parsed_key: #key_ty = inner_key.parse().map_err(|err| {
                                    ::serde::de::Error::custom(format!(
                                        "failed to decode map key `{}`: {}",
                                        #key, err
                                    ))
                                })?;

                                let parsed_value: #value_ty = if entry_value_raw.is_empty() {
                                    ::core::default::Default::default()
                                } else {
                                    match ::serde_json::from_str::<#value_ty>(entry_value_raw) {
                                        ::core::result::Result::Ok(val) => val,
                                        ::core::result::Result::Err(_) => {
                                            let escaped = entry_value_raw
                                                .replace('\\', "\\\\")
                                                .replace('"', "\\\"");
                                            let json_literal = ::std::format!("\"{}\"", escaped);
                                            ::serde_json::from_str::<#value_ty>(&json_literal).map_err(|err| {
                                                ::serde::de::Error::custom(format!(
                                                    "failed to decode map value `{}`: {}",
                                                    #key, err
                                                ))
                                            })?
                                        }
                                    }
                                };

                                parsed_map.insert(parsed_key, parsed_value);
                            }
                        }
                        other => {
                            return ::core::result::Result::Err(::serde::de::Error::custom(
                                format!("failed to decode field `{}`: {:?}", #key, other)
                            ));
                        }
                    }
                }
                #wrap_result
            }
        } else if info.vec_like.is_some() {
            quote! {
                let normalized = arr
                    .iter()
                    .map(|item| match item {
                        ::serde_json::Value::String(inner) => {
                            ::serde_json::from_str::<::serde_json::Value>(inner)
                                .unwrap_or_else(|_| ::serde_json::Value::String(inner.clone()))
                        }
                        other => other.clone(),
                    })
                    .collect::<::std::vec::Vec<_>>();

                ::serde_json::from_value::<#ty>(::serde_json::Value::Array(normalized)).map_err(|err| {
                    ::serde::de::Error::custom(format!(
                        "failed to decode field `{}`: {}",
                        #key, err
                    ))
                })?
            }
        } else {
            quote! {
                return ::core::result::Result::Err(::serde::de::Error::custom(
                    format!("failed to decode field `{}`: {:?}", #key, arr)
                ));
            }
        };
        quote! {
            if key == #key {
                if (#var).is_some() {
                    return ::core::result::Result::Err(::serde::de::Error::duplicate_field(#key));
                }
                let raw: ::serde_json::Value = map.next_value()?;
                let value: #ty = match ::serde_json::from_value::<#ty>(raw.clone()) {
                    ::core::result::Result::Ok(v) => v,
                    ::core::result::Result::Err(_) => {
                        if let ::serde_json::Value::String(ref s) = raw {
                            #string_fallback
                        } else if let ::serde_json::Value::Array(ref arr) = raw {
                            #array_fallback
                        } else {
                            return ::core::result::Result::Err(::serde::de::Error::custom(
                                format!("failed to decode field `{}`: {:?}", #key, raw)
                            ));
                        }
                    }
                };
                #var = ::core::option::Option::Some(value);
                continue;
            }
            #map_like_branch
        }
    });

    let known_field_inits = infos.iter().zip(&field_vars).map(|(info, var)| {
        let ident = &info.ident;
        quote! {
            #ident: #var.unwrap_or_default()
        }
    });

    let extra_ident = &extra.ident;
    let serialize_known_fields = infos.iter().map(|info| {
        let key = &info.rename;
        let ident = &info.ident;
        if let ::core::option::Option::Some(map_like) = &info.map_like {
            if map_like.wraps_option {
                quote! {
                    if let ::core::option::Option::Some(entries) = &self.#ident {
                        for (entry_key, entry_value) in entries {
                            let serialized_key = ::std::format!("{}[{}]", #key, ::std::format!("{}", entry_key));
                            map.serialize_entry(&serialized_key, entry_value)?;
                        }
                    }
                }
            } else {
                quote! {
                    for (entry_key, entry_value) in &self.#ident {
                        let serialized_key = ::std::format!("{}[{}]", #key, ::std::format!("{}", entry_key));
                        map.serialize_entry(&serialized_key, entry_value)?;
                    }
                }
            }
        } else if let ::core::option::Option::Some(vec_like) = &info.vec_like {
            if vec_like.wraps_option {
                quote! {
                    if let ::core::option::Option::Some(vec) = &self.#ident {
                        let serialized = vec
                            .iter()
                            .map(|item| ::std::format!("{}", item))
                            .collect::<::std::vec::Vec<_>>()
                            .join(",");
                        map.serialize_entry(#key, &serialized)?;
                    }
                }
            } else {
                quote! {
                    let serialized = self.#ident
                        .iter()
                        .map(|item| ::std::format!("{}", item))
                        .collect::<::std::vec::Vec<_>>()
                        .join(",");
                    map.serialize_entry(#key, &serialized)?;
                }
            }
        } else {
            quote! {
                map.serialize_entry(#key, &self.#ident)?;
            }
        }
    });

    let generated = quote! {
    impl #de_impl_generics ::serde::Deserialize<'de> for #struct_ident #ty_generics #deserialize_where {
            fn deserialize<D>(deserializer: D) -> ::core::result::Result<Self, D::Error>
            where
                D: ::serde::Deserializer<'de>,
            {
                struct VisitorImpl #de_impl_generics (
                    ::core::marker::PhantomData<&'de ()>,
                    ::core::marker::PhantomData<#struct_ident #ty_generics>,
                ) #deserialize_where;

                impl #de_impl_generics ::serde::de::Visitor<'de> for VisitorImpl #de_ty_generics #deserialize_where {
                    type Value = #struct_ident #ty_generics;

                    fn expecting(&self, f: &mut ::core::fmt::Formatter) -> ::core::fmt::Result {
                        f.write_str(concat!("struct ", stringify!(#struct_ident)))
                    }

                    fn visit_map<M>(self, mut map: M) -> ::core::result::Result<Self::Value, M::Error>
                    where
                        M: ::serde::de::MapAccess<'de>,
                    {
                        #(#create_field_slots)*
                        let mut #extra_ident: #extra_ty = ::core::default::Default::default();

                        while let ::core::option::Option::Some(key) = map.next_key::<::std::string::String>()? {
                            #(#field_handlers)*
                            let value: ::serde_json::Value = map.next_value()?;
                            #extra_ident.insert(key, value);
                        }

                        ::core::result::Result::Ok(Self::Value {
                            #(#known_field_inits,)*
                            #extra_ident
                        })
                    }
                }

                deserializer.deserialize_map(VisitorImpl(
                    ::core::marker::PhantomData,
                    ::core::marker::PhantomData,
                ))
            }
        }

        impl #impl_generics ::serde::Serialize for #struct_ident #ty_generics #serialize_where {
            fn serialize<S>(&self, serializer: S) -> ::core::result::Result<S::Ok, S::Error>
            where
                S: ::serde::Serializer,
            {
                use ::serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(::core::option::Option::None)?;
                #(#serialize_known_fields)*
                for (key, value) in &self.#extra_ident {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
        }
    };

    Ok(generated)
}

fn parse_qs_attr(attr: &Attribute, rename: &mut String, is_extra: &mut bool) -> syn::Result<()> {
    let metas = attr.parse_args_with(
        syn::punctuated::Punctuated::<Meta, syn::token::Comma>::parse_terminated,
    )?;

    for meta in metas {
        match meta {
            Meta::NameValue(nv) if nv.path.is_ident("rename") => {
                let Expr::Lit(ExprLit {
                    lit: Lit::Str(lit_str),
                    ..
                }) = &nv.value
                else {
                    return Err(syn::Error::new_spanned(
                        &nv.value,
                        "rename = ... requires a string literal",
                    ));
                };
                *rename = lit_str.value();
            }
            Meta::Path(path) if path.is_ident("extra") => {
                *is_extra = true;
            }
            _ => {
                return Err(syn::Error::new_spanned(
                    meta,
                    "qs attributes only support rename=\"...\" and extra",
                ));
            }
        }
    }

    Ok(())
}

fn empty_where() -> WhereClause {
    WhereClause {
        where_token: Default::default(),
        predicates: Predicates::new(),
    }
}

fn extract_vec_inner_ty(ty: &Type) -> Option<Type> {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };

    let segment = path.segments.last()?;
    if segment.ident != "Vec" {
        return None;
    }

    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };

    let Some(GenericArgument::Type(inner_ty)) = args.args.first() else {
        return None;
    };

    Some(inner_ty.clone())
}

fn extract_vec_like(ty: &Type) -> Option<VecLikeInfo> {
    if let ::core::option::Option::Some(inner) = extract_vec_inner_ty(ty) {
        return ::core::option::Option::Some(VecLikeInfo {
            inner,
            wraps_option: false,
        });
    }

    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };

    let segment = path.segments.last()?;
    if segment.ident != "Option" {
        return None;
    }

    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };

    let Some(GenericArgument::Type(inner_ty)) = args.args.first() else {
        return None;
    };

    extract_vec_inner_ty(inner_ty).map(|inner| VecLikeInfo {
        inner,
        wraps_option: true,
    })
}

fn extract_map_like(ty: &Type) -> Option<MapLikeInfo> {
    if let ::core::option::Option::Some((key, value)) = extract_map_key_value(ty) {
        return ::core::option::Option::Some(MapLikeInfo {
            key,
            value,
            wraps_option: false,
        });
    }

    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };

    let segment = path.segments.last()?;
    if segment.ident != "Option" {
        return None;
    }

    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };

    let Some(GenericArgument::Type(inner_ty)) = args.args.first() else {
        return None;
    };

    extract_map_key_value(inner_ty).map(|(key, value)| MapLikeInfo {
        key,
        value,
        wraps_option: true,
    })
}

fn extract_map_key_value(ty: &Type) -> Option<(Type, Type)> {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };

    let segment = path.segments.last()?;
    if segment.ident != "HashMap" {
        return None;
    }

    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return None;
    };

    let mut iter = args.args.iter();
    let key_ty = match iter.next()? {
        GenericArgument::Type(ty) => ty.clone(),
        _ => return None,
    };
    let value_ty = match iter.next()? {
        GenericArgument::Type(ty) => ty.clone(),
        _ => return None,
    };

    Some((key_ty, value_ty))
}
