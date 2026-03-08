clean_fusou_app:
    cd ./packages/FUSOU-APP/src-tauri/ && cargo clean

clean_configs:
    cd ./packages/configs/ && cargo clean

clean_proxy_https:
    cd ./packages/FUSOU-PROXY/proxy-https/ && cargo clean

clean_kc_api:
    cd ./packages/kc_api/ && cargo clean

clean_auth:
    cd ./packages/fusou-auth/ && cargo clean

clean_avro_wasm:
    cd ./packages/avro-wasm/ && cargo clean

clean_fusou-upload:
    cd ./packages/fusou-upload/ && cargo clean

clean_workspace:
    just clean_fusou_app
    just clean_configs
    just clean_proxy_https
    just clean_kc_api
    just clean_auth
    just clean_avro_wasm
    just clean_fusou-upload