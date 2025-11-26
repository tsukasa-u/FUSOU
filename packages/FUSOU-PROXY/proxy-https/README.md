# proxy-https channel transport

This crate now supports two interchangeable transports for `BidirectionalChannel<StatusInfo>`:

- **In-process `tokio::mpsc` (default)** – identical to the existing behaviour, no configuration required.
- **gRPC/`tonic` transport** (enable with `--features grpc`) – messages are serialized via protobufs so the proxy components can run as separate microservices.

## Feature flags

| Feature | Description |
| --- | --- |
| _default_ | Uses the legacy `tokio::mpsc` implementation. |
| `grpc` | Compiles the tonic-based transport, gRPC server helpers, and the `channel_service` binary. |

## Running the channel microservice

```bash
cargo run -p proxy-https --features grpc --bin channel_service
```

Environment variables:

- `FUSOU_CHANNEL_BIND` (default `0.0.0.0:50061`) – socket address for the server.
- `FUSOU_CHANNEL_BUFFER` (default 128) – per-direction broadcast buffer size.
- `FUSOU_CHANNEL_ENDPOINT` (default `http://127.0.0.1:50061`) – client-side URI used by the gRPC transport.

Start the server (in its own process or container) and then run any other crates with `--features grpc` to have the `BidirectionalChannel` connect over gRPC instead of in-process queues.

## Development tips

- Regenerate protobufs automatically via `build.rs` when the `grpc` feature is enabled.
- Validate both transports:
  - `cargo check -p proxy-https`
  - `cargo check -p proxy-https --features grpc`
- To observe traffic, run the server binary with `RUST_LOG=info` and add a `tracing_subscriber` initialization in your application entrypoints.
