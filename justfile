clean_fusou_app:
    cd ./packages/FUSOU-APP/src-tauri/ && cargo clean

clean_configs:
    cd ./packages/configs/ && cargo clean

clean_proxy_https:
    cd ./packages/FUSOU-PROXY/proxy-https/ && cargo clean

clean_macros:
    cd ./packages/rust_macro/register_macro_derive_and_attr && cargo clean

clean_trait:
    cd ./packages/rust_macro/register_trait && cargo clean

clean_kc_api:
    cd ./packages/kc_api/ && cargo clean

clean_workspace:
    just clean_fusou_app
    just clean_configs
    just clean_proxy_https
    just clean_kc_api
    just clean_macros
    just clean_trait
