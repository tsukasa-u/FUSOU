use proc_macro2::Span;
use quote::{format_ident, quote};
use syn::{
    parse_quote, Attribute, Data, DeriveInput, Expr, ExprLit, Fields, GenericParam, Ident,
    Lifetime, LifetimeParam, Lit, Meta, Type, WhereClause,
};

type Predicates = syn::punctuated::Punctuated<syn::WherePredicate, syn::token::Comma>;

struct FieldInfo {
    ident: Ident,
    ty: Type,
    rename: String,
    is_extra: bool,
}

pub fn expand(input: DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let struct_ident = input.ident;
    let generics = input.generics;
    let data = match input.data {
        Data::Struct(data) => data,
        _ => {
            return Err(syn::Error::new_spanned(
                struct_ident,
                "QueryWithExtra は構造体のみ対応",
            ))
        }
    };

    let fields = match data.fields {
        Fields::Named(fields) => fields.named,
        _ => {
            return Err(syn::Error::new_spanned(
                struct_ident,
                "QueryWithExtra は名前付きフィールドをもつ構造体のみ対応",
            ))
        }
    };

    let mut infos = Vec::<FieldInfo>::new();
    let mut extra_field: Option<FieldInfo> = None;

    for field in fields {
        let ident = field.ident.expect("named field");
        let mut rename = ident.to_string();
        let mut is_extra = false;

        for attr in field
            .attrs
            .iter()
            .filter(|a| a.path().is_ident("qs") || a.path().is_ident("serde"))
        {
            let is_qs_attr = attr.path().is_ident("qs");
            parse_qs_attr(attr, is_qs_attr, &mut rename, &mut is_extra)?;
        }

        let info = FieldInfo {
            ident: ident.clone(),
            ty: field.ty.clone(),
            rename,
            is_extra,
        };

        if info.is_extra {
            if extra_field.is_some() {
                return Err(syn::Error::new_spanned(
                    ident,
                    "qs(extra) は 1 フィールドのみ指定できます",
                ));
            }
            extra_field = Some(info);
        } else {
            infos.push(info);
        }
    }

    let extra = extra_field.ok_or_else(|| {
        syn::Error::new_spanned(
            &struct_ident,
            "qs(extra) が付いたフィールドが見つかりません",
        )
    })?;

    let (impl_generics, ty_generics, _) = generics.split_for_impl();
    let mut serialize_where: WhereClause =
        generics.where_clause.clone().unwrap_or_else(empty_where);

    for info in &infos {
        let ty = &info.ty;
        serialize_where
            .predicates
            .push(parse_quote!(#ty: ::serde::de::DeserializeOwned + ::serde::ser::Serialize));
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

    let match_arms = infos.iter().zip(&field_vars).map(|(info, var)| {
        let key = &info.rename;
        let ty = &info.ty;
        quote! {
            #key => {
                if (#var).is_some() {
                    return ::core::result::Result::Err(::serde::de::Error::duplicate_field(#key));
                }
                let raw: ::serde_json::Value = map.next_value()?;
                let value: #ty = match ::serde_json::from_value::<#ty>(raw.clone()) {
                    ::core::result::Result::Ok(v) => v,
                    ::core::result::Result::Err(_) => {
                        if let ::serde_json::Value::String(ref s) = raw {
                            ::serde_json::from_str::<#ty>(s).map_err(|err| {
                                ::serde::de::Error::custom(format!(
                                    "failed to decode field `{}`: {}",
                                    #key, err
                                ))
                            })?
                        } else {
                            return ::core::result::Result::Err(::serde::de::Error::custom(
                                format!("failed to decode field `{}`: {:?}", #key, raw)
                            ));
                        }
                    }
                };
                #var = ::core::option::Option::Some(value);
            }
        }
    });

    let known_field_inits = infos.iter().zip(&field_vars).map(|(info, var)| {
        let key = &info.rename;
        let ident = &info.ident;
        quote! {
            #ident: #var.ok_or_else(|| ::serde::de::Error::missing_field(#key))?
        }
    });

    let extra_ident = &extra.ident;
    let serialize_known_fields = infos.iter().map(|info| {
        let key = &info.rename;
        let ident = &info.ident;
        quote! {
            map.serialize_entry(#key, &self.#ident)?;
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
                            match key.as_str() {
                                #(#match_arms,)*
                                other => {
                                    let value: ::serde_json::Value = map.next_value()?;
                                    #extra_ident.insert(other.to_string(), value);
                                }
                            }
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

fn parse_qs_attr(
    attr: &Attribute,
    is_qs_attr: bool,
    rename: &mut String,
    is_extra: &mut bool,
) -> syn::Result<()> {
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
                        "rename = ... には文字列リテラルを指定してください",
                    ));
                };
                *rename = lit_str.value();
            }
            Meta::Path(path) if path.is_ident("extra") => {
                *is_extra = true;
            }
            _ => {
                if is_qs_attr {
                    return Err(syn::Error::new_spanned(
                        meta,
                        "qs では rename=\"...\" と extra のみ指定できます",
                    ));
                }
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
