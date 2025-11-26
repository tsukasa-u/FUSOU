fn main() {
    // Only attempt to compile protos when the `grpc` feature is enabled.
    if std::env::var("CARGO_FEATURE_GRPC").is_ok() {
        if let Ok(protoc) = protoc_bin_vendored::protoc_bin_path() {
            std::env::set_var("PROTOC", protoc);
        }

        tonic_build::configure()
            .build_server(true)
            .compile(&["proto/channel.proto"], &["proto"])
            .expect("Failed to compile proto files");
    }
}
