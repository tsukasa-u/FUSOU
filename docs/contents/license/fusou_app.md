---
title: FUSOU-APP ライセンス情報
description: デスクトップアプリケーション「FUSOU-APP」本体のライセンスおよび配布バイナリに同梱・静的リンクされるオープンソースソフトウェアのライセンス・著作権表示
contributors: ["tsukasa-u"]
date: 2026-09-09
slug: license/fusou_app
tags: [license, fusou-app, tauri, rust]
---

# FUSOU-APP ライセンス情報 (Third-Party Notices)

本ドキュメントは、デスクトップアプリケーション **FUSOU-APP** 本体のライセンス、および配布バイナリ（Windows等向けインストーラー/実行ファイル）に含まれるサードパーティ製オープンソースソフトウェア（OSS）のライセンス条文・著作権表示をまとめたものです。

---

## 1. FUSOU-APP 本体のライセンス

FUSOU-APP は **MIT License** のもとで提供されています。

```text
MIT License

Copyright (c) 2024 Oguri Hideyuki

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. 配布構成とライセンス表記方針

FUSOU-APP は **Tauri v2** を採用したデスクトップアプリケーションです。ユーザー環境に配布されるバイナリには以下が含まれます：

1. **Rust ネイティブバックエンド**: プロキシ通信の傍受・復号、艦これAPIレスポンスのパース、ローカルSQLite/DuckDBへの保存、暗号化処理、OSネイティブ通知、自動更新機能などを担当します（計 970 クレート）。
2. **Webview フロントエンド**: SolidJS で構築されたUIコンポーネントであり、Tauri の WebView2（Windows）上で実行されます（計 18 パッケージ）。

配布されるプログラムは、すべての依存関係において **パーミッシブなライセンス（MIT, Apache-2.0, BSD, ISC, Zlib 等）** または **ファイル単位の弱コピーレフトライセンス（MPL-2.0）** を採用しており、GPL/AGPL 等の強コピーレフトライセンスの混入はありません。

---

## 3. 特記すべきライブラリと告知事項

### Mozilla Public License 2.0 (MPL-2.0)
FUSOU-APP のバックエンドでは、CSSパーサー等の補助機能として以下のクレートを利用しています：
- `cssparser`, `cssparser-macros`, `selectors` (Mozilla / Servo プロジェクト)
- `dtoa-short`, `option-ext`

> [!NOTE]
> **MPL-2.0（弱コピーレフト）に関する告知**  
> これらのクレートは Mozilla Public License 2.0 (MPL-2.0) のもとで許諾されています。FUSOU-APP はこれらのクレートのソースコード自体を一切改変せずにライブラリとして静的リンク・利用しており、MPL-2.0 Section 3.3（Larger Work）の条項に完全に適合しています。各クレートのオリジナルソースコードは [https://github.com/servo/rust-cssparser](https://github.com/servo/rust-cssparser) 等のリポジトリより入手可能です。

### r-efi (トリプルライセンス)
- `r-efi`: `MIT OR Apache-2.0 OR LGPL-2.1-or-later`

> [!NOTE]
> **適用ライセンスの選択**  
> `r-efi` はトリプルライセンスで提供されています。FUSOU-APP では MIT License を選択して適用しています。

---

## 4. フロントエンド依存ライブラリ一覧 (18 パッケージ)

配布バイナリのUI（WebView）に同梱される npm 本番依存パッケージです：

| パッケージ名 | バージョン | ライセンス |
| :--- | :--- | :--- |
| `@solid-primitives/cookies` | `0.0.1` | MIT |
| `@solidjs/router` | `0.15.4` | MIT |
| `@tauri-apps/api` | `2.9.0` | Apache-2.0 OR MIT |
| `@tauri-apps/plugin-autostart` | `2.5.1` | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-deep-link` | `2.4.5` | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-notification` | `2.3.3` | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-process` | `2.3.1` | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-shell` | `2.3.3` | MIT OR Apache-2.0 |
| `@tauri-apps/plugin-updater` | `2.9.0` | MIT OR Apache-2.0 |
| `csstype` | `3.2.3` | MIT |
| `dotenv` | `16.6.1` | BSD-2-Clause |
| `react` | `19.2.0` | MIT |
| `react-dom` | `19.2.0` | MIT |
| `scheduler` | `0.27.0` | MIT |
| `seroval` | `1.5.1` | MIT |
| `seroval-plugins` | `1.3.3` | MIT |
| `solid-js` | `1.9.10` | MIT |
| `virtua` | `0.41.5` | MIT |

---

## 5. バックエンド Rust クレート一覧 (970 クレート)

FUSOU-APP のネイティブバイナリにコンパイル・静的リンクされるクレートの一覧です。

<details>
<summary><strong>Rust クレート全一覧を展開する (クリックして表示)</strong></summary>

| クレート名 | バージョン | ライセンス | リポジトリ |
| :--- | :--- | :--- | :--- |
| `adler2` | `2.0.1` | 0BSD OR MIT OR Apache-2.0 | [リンク](https://github.com/oyvindln/adler2) |
| `ahash` | `0.8.12` | MIT OR Apache-2.0 | [リンク](https://github.com/tkaitchuck/ahash) |
| `ahash` | `0.7.8` | MIT OR Apache-2.0 | [リンク](https://github.com/tkaitchuck/ahash) |
| `aho-corasick` | `1.1.4` | Unlicense OR MIT | [リンク](https://github.com/BurntSushi/aho-corasick) |
| `alloc-no-stdlib` | `2.0.4` | BSD-3-Clause | [リンク](https://github.com/dropbox/rust-alloc-no-stdlib) |
| `alloc-stdlib` | `0.2.2` | BSD-3-Clause | [リンク](https://github.com/dropbox/rust-alloc-no-stdlib) |
| `allocator-api2` | `0.2.21` | MIT OR Apache-2.0 | [リンク](https://github.com/zakarumych/allocator-api2) |
| `ambient-authority` | `0.0.2` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/ambient-authority) |
| `android_log-sys` | `0.3.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-mobile/android_log-sys-rs) |
| `android_logger` | `0.15.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-mobile/android_logger-rs) |
| `android_system_properties` | `0.1.5` | MIT/Apache-2.0 | [リンク](https://github.com/nical/android_system_properties) |
| `android-tzdata` | `0.1.1` | MIT OR Apache-2.0 | [リンク](https://github.com/RumovZ/android-tzdata) |
| `anstream` | `1.0.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `anstyle` | `1.0.14` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `anstyle-parse` | `1.0.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `anstyle-query` | `1.1.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `anstyle-wincon` | `3.0.11` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `anyhow` | `1.0.102` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/anyhow) |
| `apache-avro` | `0.19.0` | Apache-2.0 | [リンク](https://github.com/apache/avro-rs) |
| `apache-avro-derive` | `0.19.0` | Apache-2.0 | [リンク](https://github.com/apache/avro-rs) |
| `arbitrary` | `1.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-fuzz/arbitrary/) |
| `arc-swap` | `1.9.1` | MIT OR Apache-2.0 | [リンク](https://github.com/vorner/arc-swap) |
| `arrayref` | `0.3.9` | BSD-2-Clause | [リンク](https://github.com/droundy/arrayref) |
| `arrayvec` | `0.7.6` | MIT OR Apache-2.0 | [リンク](https://github.com/bluss/arrayvec) |
| `arrow` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-arith` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-array` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-buffer` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-cast` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-csv` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-data` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-ipc` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-json` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-ord` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-row` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-schema` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-select` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `arrow-string` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `asn1-rs` | `0.6.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rusticata/asn1-rs.git) |
| `asn1-rs-derive` | `0.5.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rusticata/asn1-rs.git) |
| `asn1-rs-impl` | `0.2.0` | MIT/Apache-2.0 | [リンク](https://github.com/rusticata/asn1-rs.git) |
| `async-broadcast` | `0.7.2` | MIT OR Apache-2.0 | [リンク](https://github.com/smol-rs/async-broadcast) |
| `async-channel` | `2.5.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-channel) |
| `async-compression` | `0.4.19` | MIT OR Apache-2.0 | [リンク](https://github.com/Nullus157/async-compression) |
| `async-executor` | `1.14.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-executor) |
| `async-io` | `2.6.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-io) |
| `async-lock` | `3.4.2` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-lock) |
| `async-process` | `2.5.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-process) |
| `async-recursion` | `1.1.1` | MIT OR Apache-2.0 | [リンク](https://github.com/dcchut/async-recursion) |
| `async-signal` | `0.2.14` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-signal) |
| `async-task` | `4.7.1` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/async-task) |
| `async-trait` | `0.1.89` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/async-trait) |
| `atk` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `atk-sys` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `atoi` | `2.0.0` | MIT | [リンク](https://github.com/pacman82/atoi-rs) |
| `atomic-waker` | `1.1.2` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/atomic-waker) |
| `auto-launch` | `0.5.0` | MIT | [リンク](https://github.com/zzzgydi/auto-launch.git) |
| `autocfg` | `1.5.1` | Apache-2.0 OR MIT | [リンク](https://github.com/cuviper/autocfg) |
| `aws-config` | `1.8.18` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-credential-types` | `1.2.14` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-lc-rs` | `1.17.0` | ISC AND (Apache-2.0 OR ISC) | [リンク](https://github.com/aws/aws-lc-rs) |
| `aws-lc-sys` | `0.41.0` | ISC AND (Apache-2.0 OR ISC) AND Apache-2.0 AND MIT AND BSD-3-Clause AND (Apache-2.0 OR ISC OR MIT) AND (Apache-2.0 OR ISC OR MIT-0) | [リンク](https://github.com/aws/aws-lc-rs) |
| `aws-runtime` | `1.7.4` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-sdk-s3` | `1.135.0` | Apache-2.0 | [リンク](https://github.com/awslabs/aws-sdk-rust) |
| `aws-sdk-sso` | `1.101.0` | Apache-2.0 | [リンク](https://github.com/awslabs/aws-sdk-rust) |
| `aws-sdk-ssooidc` | `1.103.0` | Apache-2.0 | [リンク](https://github.com/awslabs/aws-sdk-rust) |
| `aws-sdk-sts` | `1.106.0` | Apache-2.0 | [リンク](https://github.com/awslabs/aws-sdk-rust) |
| `aws-sigv4` | `1.4.5` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-async` | `1.2.14` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-checksums` | `0.64.8` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-eventstream` | `0.60.20` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-http` | `0.63.6` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-http-client` | `1.1.13` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-json` | `0.62.7` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-observability` | `0.2.6` | Apache-2.0 | [リンク](https://github.com/awslabs/smithy-rs) |
| `aws-smithy-query` | `0.60.15` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-runtime` | `1.11.3` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-runtime-api` | `1.12.3` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-runtime-api-macros` | `1.0.0` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-schema` | `0.1.0` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-types` | `1.4.9` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-smithy-xml` | `0.60.15` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `aws-types` | `1.3.16` | Apache-2.0 | [リンク](https://github.com/smithy-lang/smithy-rs) |
| `base16ct` | `0.2.0` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/base16ct) |
| `base64` | `0.22.1` | MIT OR Apache-2.0 | [リンク](https://github.com/marshallpierce/rust-base64) |
| `base64` | `0.21.7` | MIT OR Apache-2.0 | [リンク](https://github.com/marshallpierce/rust-base64) |
| `base64-simd` | `0.8.0` | MIT | [リンク](https://github.com/Nugine/simd) |
| `base64ct` | `1.8.3` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats) |
| `bigdecimal` | `0.4.10` | MIT/Apache-2.0 | [リンク](https://github.com/akubera/bigdecimal-rs) |
| `bit-set` | `0.8.0` | Apache-2.0 OR MIT | [リンク](https://github.com/contain-rs/bit-set) |
| `bit-vec` | `0.8.0` | Apache-2.0 OR MIT | [リンク](https://github.com/contain-rs/bit-vec) |
| `bitflags` | `2.13.0` | MIT OR Apache-2.0 | [リンク](https://github.com/bitflags/bitflags) |
| `bitflags` | `1.3.2` | MIT/Apache-2.0 | [リンク](https://github.com/bitflags/bitflags) |
| `bitvec` | `1.0.1` | MIT | [リンク](https://github.com/bitvecto-rs/bitvec) |
| `blake2` | `0.10.6` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `blake3` | `1.8.5` | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | [リンク](https://github.com/BLAKE3-team/BLAKE3) |
| `block-buffer` | `0.10.4` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/utils) |
| `block-buffer` | `0.12.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/utils) |
| `block2` | `0.6.2` | MIT | [リンク](https://github.com/madsmtm/objc2) |
| `blocking` | `1.6.2` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/blocking) |
| `bon` | `3.9.1` | MIT OR Apache-2.0 | [リンク](https://github.com/elastio/bon) |
| `bon-macros` | `3.9.1` | MIT OR Apache-2.0 | [リンク](https://github.com/elastio/bon) |
| `borsh` | `1.6.1` | MIT OR Apache-2.0 | [リンク](https://github.com/near/borsh-rs) |
| `borsh-derive` | `1.6.1` | Apache-2.0 | [リンク](https://github.com/near/borsh-rs) |
| `brotli` | `7.0.0` | BSD-3-Clause AND MIT | [リンク](https://github.com/dropbox/rust-brotli) |
| `brotli` | `3.5.0` | BSD-3-Clause OR MIT | [リンク](https://github.com/dropbox/rust-brotli) |
| `brotli` | `8.0.3` | BSD-3-Clause AND MIT | [リンク](https://github.com/dropbox/rust-brotli) |
| `brotli-decompressor` | `4.0.3` | BSD-3-Clause/MIT | [リンク](https://github.com/dropbox/rust-brotli-decompressor) |
| `brotli-decompressor` | `2.5.1` | BSD-3-Clause/MIT | [リンク](https://github.com/dropbox/rust-brotli-decompressor) |
| `brotli-decompressor` | `5.0.1` | BSD-3-Clause/MIT | [リンク](https://github.com/dropbox/rust-brotli-decompressor) |
| `bs58` | `0.5.1` | MIT/Apache-2.0 | [リンク](https://github.com/Nullus157/bs58-rs) |
| `bstr` | `1.12.1` | MIT OR Apache-2.0 | [リンク](https://github.com/BurntSushi/bstr) |
| `bumpalo` | `3.20.3` | MIT OR Apache-2.0 | [リンク](https://github.com/fitzgen/bumpalo) |
| `byte-unit` | `5.2.0` | MIT | [リンク](https://github.com/magiclen/byte-unit) |
| `bytecheck` | `0.6.12` | MIT | [リンク](https://github.com/djkoloski/bytecheck) |
| `bytecheck_derive` | `0.6.12` | MIT | [リンク](https://github.com/djkoloski/bytecheck) |
| `bytemuck` | `1.25.0` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/Lokathor/bytemuck) |
| `byteorder` | `1.5.0` | Unlicense OR MIT | [リンク](https://github.com/BurntSushi/byteorder) |
| `bytes` | `1.11.1` | MIT | [リンク](https://github.com/tokio-rs/bytes) |
| `bytes-utils` | `0.1.4` | Apache-2.0/MIT | [リンク](https://github.com/vorner/bytes-utils) |
| `bzip2` | `0.5.2` | MIT OR Apache-2.0 | [リンク](https://github.com/trifectatechfoundation/bzip2-rs) |
| `bzip2` | `0.4.4` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/bzip2-rs) |
| `bzip2-sys` | `0.1.13+1.0.8` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/bzip2-rs) |
| `cairo-rs` | `0.18.5` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `cairo-sys-rs` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `camino` | `1.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/camino-rs/camino) |
| `cap-primitives` | `3.4.5` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/cap-std) |
| `cap-std` | `3.4.5` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/cap-std) |
| `cargo_metadata` | `0.19.2` | MIT | [リンク](https://github.com/oli-obk/cargo_metadata) |
| `cargo_toml` | `0.22.3` | Apache-2.0 OR MIT | [リンク](https://gitlab.com/lib.rs/cargo_toml) |
| `cargo-platform` | `0.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cargo) |
| `cc` | `1.2.63` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cc-rs) |
| `cesu8` | `1.1.0` | Apache-2.0/MIT | [リンク](https://github.com/emk/cesu8-rs) |
| `cfb` | `0.7.3` | MIT | [リンク](https://github.com/mdsteele/rust-cfb) |
| `cfg_aliases` | `0.2.1` | MIT | [リンク](https://github.com/katharostech/cfg_aliases) |
| `cfg-expr` | `0.15.8` | MIT OR Apache-2.0 | [リンク](https://github.com/EmbarkStudios/cfg-expr) |
| `cfg-if` | `1.0.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cfg-if) |
| `chrono` | `0.4.39` | MIT OR Apache-2.0 | [リンク](https://github.com/chronotope/chrono) |
| `chrono-tz` | `0.10.4` | MIT OR Apache-2.0 | [リンク](https://github.com/chronotope/chrono-tz) |
| `clap` | `4.6.1` | MIT OR Apache-2.0 | [リンク](https://github.com/clap-rs/clap) |
| `clap_builder` | `4.6.0` | MIT OR Apache-2.0 | [リンク](https://github.com/clap-rs/clap) |
| `clap_derive` | `4.6.1` | MIT OR Apache-2.0 | [リンク](https://github.com/clap-rs/clap) |
| `clap_lex` | `1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/clap-rs/clap) |
| `cmake` | `0.1.58` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cmake-rs) |
| `cmov` | `0.5.4` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/utils) |
| `colorchoice` | `1.0.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/anstyle.git) |
| `combine` | `4.6.7` | MIT | [リンク](https://github.com/Marwes/combine) |
| `comfy-table` | `7.2.2` | MIT | [リンク](https://github.com/nukesor/comfy-table) |
| `concurrent-queue` | `2.5.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/concurrent-queue) |
| `configs` | `0.4.0` | MIT OR Apache-2.0 | - |
| `confy` | `0.6.1` | MIT/X11 OR Apache-2.0 | [リンク](https://github.com/rust-cli/confy) |
| `const-oid` | `0.9.6` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/const-oid) |
| `const-oid` | `0.10.2` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats) |
| `const-random` | `0.1.18` | MIT OR Apache-2.0 | [リンク](https://github.com/tkaitchuck/constrandom) |
| `const-random-macro` | `0.1.16` | MIT OR Apache-2.0 | [リンク](https://github.com/tkaitchuck/constrandom) |
| `constant_time_eq` | `0.4.2` | CC0-1.0 OR MIT-0 OR Apache-2.0 | [リンク](https://github.com/cesarb/constant_time_eq) |
| `cookie` | `0.18.1` | MIT OR Apache-2.0 | [リンク](https://github.com/SergioBenitez/cookie-rs) |
| `core-foundation` | `0.10.1` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/core-foundation-rs) |
| `core-foundation` | `0.9.4` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/core-foundation-rs) |
| `core-foundation-sys` | `0.8.7` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/core-foundation-rs) |
| `core-graphics` | `0.25.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/core-foundation-rs) |
| `core-graphics-types` | `0.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/core-foundation-rs) |
| `cpufeatures` | `0.2.17` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/utils) |
| `cpufeatures` | `0.3.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/utils) |
| `crc-fast` | `1.10.0` | MIT OR Apache-2.0 | [リンク](https://github.com/awesomized/crc-fast-rust) |
| `crc32fast` | `1.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/srijs/rust-crc32fast) |
| `croner` | `2.2.0` | MIT | [リンク](https://github.com/hexagon/croner-rust) |
| `crossbeam-channel` | `0.5.15` | MIT OR Apache-2.0 | [リンク](https://github.com/crossbeam-rs/crossbeam) |
| `crossbeam-epoch` | `0.9.18` | MIT OR Apache-2.0 | [リンク](https://github.com/crossbeam-rs/crossbeam) |
| `crossbeam-utils` | `0.8.21` | MIT OR Apache-2.0 | [リンク](https://github.com/crossbeam-rs/crossbeam) |
| `crunchy` | `0.2.4` | MIT | [リンク](https://github.com/eira-fransham/crunchy) |
| `crypto-bigint` | `0.5.5` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/crypto-bigint) |
| `crypto-common` | `0.1.7` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/traits) |
| `crypto-common` | `0.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/traits) |
| `cssparser` | `0.36.0` | MPL-2.0 | [リンク](https://github.com/servo/rust-cssparser) |
| `cssparser-macros` | `0.6.1` | MPL-2.0 | [リンク](https://github.com/servo/rust-cssparser) |
| `csv` | `1.4.0` | Unlicense/MIT | [リンク](https://github.com/BurntSushi/rust-csv) |
| `csv-core` | `0.1.13` | Unlicense/MIT | [リンク](https://github.com/BurntSushi/rust-csv) |
| `ctor` | `0.8.0` | Apache-2.0 OR MIT | [リンク](https://github.com/mmastrac/rust-ctor) |
| `ctor-proc-macro` | `0.0.7` | Apache-2.0 OR MIT | [リンク](https://github.com/mmastrac/rust-ctor) |
| `ctutils` | `0.4.2` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/utils) |
| `curve25519-dalek` | `4.1.3` | BSD-3-Clause | [リンク](https://github.com/dalek-cryptography/curve25519-dalek/tree/main/curve25519-dalek) |
| `curve25519-dalek-derive` | `0.1.1` | MIT/Apache-2.0 | [リンク](https://github.com/dalek-cryptography/curve25519-dalek) |
| `darling` | `0.20.11` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `darling` | `0.23.0` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `darling_core` | `0.20.11` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `darling_core` | `0.23.0` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `darling_macro` | `0.20.11` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `darling_macro` | `0.23.0` | MIT | [リンク](https://github.com/TedDriggs/darling) |
| `dashmap` | `5.5.3` | MIT | [リンク](https://github.com/xacrimon/dashmap) |
| `dashmap` | `6.2.1` | MIT | [リンク](https://github.com/xacrimon/dashmap) |
| `data-encoding` | `2.11.0` | MIT | [リンク](https://github.com/ia0/data-encoding) |
| `datafusion` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-catalog` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-common` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-common-runtime` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-execution` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-expr` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-expr-common` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-functions` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-functions-aggregate` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-functions-aggregate-common` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-functions-nested` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-functions-window` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-optimizer` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-physical-expr` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-physical-expr-common` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-physical-optimizer` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-physical-plan` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `datafusion-sql` | `42.2.0` | Apache-2.0 | [リンク](https://github.com/apache/datafusion) |
| `dbus` | `0.9.11` | Apache-2.0/MIT | [リンク](https://github.com/diwic/dbus-rs) |
| `der` | `0.7.10` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/der) |
| `der-parser` | `9.0.0` | MIT/Apache-2.0 | [リンク](https://github.com/rusticata/der-parser.git) |
| `deranged` | `0.5.8` | MIT OR Apache-2.0 | [リンク](https://github.com/jhpratt/deranged) |
| `derive_arbitrary` | `1.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-fuzz/arbitrary) |
| `derive_builder` | `0.20.2` | MIT OR Apache-2.0 | [リンク](https://github.com/colin-kiegel/rust-derive-builder) |
| `derive_builder_core` | `0.20.2` | MIT OR Apache-2.0 | [リンク](https://github.com/colin-kiegel/rust-derive-builder) |
| `derive_builder_macro` | `0.20.2` | MIT OR Apache-2.0 | [リンク](https://github.com/colin-kiegel/rust-derive-builder) |
| `derive_more` | `2.1.1` | MIT | [リンク](https://github.com/JelteF/derive_more) |
| `derive_more-impl` | `2.1.1` | MIT | [リンク](https://github.com/JelteF/derive_more) |
| `digest` | `0.10.7` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/traits) |
| `digest` | `0.11.3` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/traits) |
| `directories` | `5.0.1` | MIT OR Apache-2.0 | [リンク](https://github.com/soc/directories-rs) |
| `dirs` | `5.0.1` | MIT OR Apache-2.0 | [リンク](https://github.com/soc/dirs-rs) |
| `dirs` | `6.0.0` | MIT OR Apache-2.0 | [リンク](https://github.com/soc/dirs-rs) |
| `dirs` | `4.0.0` | MIT OR Apache-2.0 | [リンク](https://github.com/soc/dirs-rs) |
| `dirs-sys` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/dirs-dev/dirs-sys-rs) |
| `dirs-sys` | `0.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/dirs-dev/dirs-sys-rs) |
| `dirs-sys` | `0.3.7` | MIT OR Apache-2.0 | [リンク](https://github.com/dirs-dev/dirs-sys-rs) |
| `discord-rich-presence` | `1.1.0` | MIT | [リンク](https://github.com/vionya/discord-rich-presence) |
| `dispatch2` | `0.3.1` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `displaydoc` | `0.2.6` | MIT OR Apache-2.0 | [リンク](https://github.com/yaahc/displaydoc) |
| `dlopen2` | `0.8.2` | MIT | [リンク](https://github.com/OpenByteDev/dlopen2) |
| `dlopen2_derive` | `0.4.3` | MIT | [リンク](https://github.com/OpenByteDev/dlopen2) |
| `dlv-list` | `0.5.2` | MIT OR Apache-2.0 | [リンク](https://github.com/sgodwincs/dlv-list-rs) |
| `doc-comment` | `0.3.4` | MIT | [リンク](https://github.com/GuillaumeGomez/doc-comment) |
| `dom_query` | `0.27.0` | MIT | [リンク](https://github.com/niklak/dom_query) |
| `dpi` | `0.1.2` | Apache-2.0 AND MIT | [リンク](https://github.com/rust-windowing/winit) |
| `dtoa` | `1.0.11` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/dtoa) |
| `dtoa-short` | `0.3.5` | MPL-2.0 | [リンク](https://github.com/upsuper/dtoa-short) |
| `dtor` | `0.3.0` | Apache-2.0 OR MIT | [リンク](https://github.com/mmastrac/rust-ctor) |
| `dtor-proc-macro` | `0.0.6` | Apache-2.0 OR MIT | [リンク](https://github.com/mmastrac/rust-ctor) |
| `dunce` | `1.0.5` | CC0-1.0 OR MIT-0 OR Apache-2.0 | [リンク](https://gitlab.com/kornelski/dunce) |
| `dyn-clone` | `1.0.20` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/dyn-clone) |
| `ecdsa` | `0.16.9` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/signatures/tree/master/ecdsa) |
| `ed25519` | `2.2.3` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/signatures/tree/master/ed25519) |
| `ed25519-dalek` | `2.2.0` | BSD-3-Clause | [リンク](https://github.com/dalek-cryptography/curve25519-dalek/tree/main/ed25519-dalek) |
| `either` | `1.16.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rayon-rs/either) |
| `elliptic-curve` | `0.13.8` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/traits/tree/master/elliptic-curve) |
| `embed_plist` | `1.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/nvzqz/embed-plist-rs) |
| `embed-resource` | `3.0.9` | MIT | [リンク](https://github.com/nabijaczleweli/rust-embed-resource) |
| `encoding_rs` | `0.8.35` | (Apache-2.0 OR MIT) AND BSD-3-Clause | [リンク](https://github.com/hsivonen/encoding_rs) |
| `endi` | `1.1.1` | MIT | [リンク](https://github.com/zeenix/endi) |
| `enumflags2` | `0.7.12` | MIT OR Apache-2.0 | [リンク](https://github.com/meithecatte/enumflags2) |
| `enumflags2_derive` | `0.7.12` | MIT OR Apache-2.0 | [リンク](https://github.com/meithecatte/enumflags2) |
| `env_filter` | `0.1.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-cli/env_logger) |
| `equivalent` | `1.0.2` | Apache-2.0 OR MIT | [リンク](https://github.com/indexmap-rs/equivalent) |
| `erased-serde` | `0.4.10` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/erased-serde) |
| `errno` | `0.3.14` | MIT OR Apache-2.0 | [リンク](https://github.com/lambda-fairy/rust-errno) |
| `event-listener` | `5.4.1` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/event-listener) |
| `event-listener-strategy` | `0.5.4` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/event-listener-strategy) |
| `fastrand` | `2.4.1` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/fastrand) |
| `fdeflate` | `0.3.7` | MIT OR Apache-2.0 | [リンク](https://github.com/image-rs/fdeflate) |
| `fern` | `0.7.1` | MIT | [リンク](https://github.com/daboross/fern) |
| `ff` | `0.13.1` | MIT/Apache-2.0 | [リンク](https://github.com/zkcrypto/ff) |
| `fiat-crypto` | `0.2.9` | MIT OR Apache-2.0 OR BSD-1-Clause | [リンク](https://github.com/mit-plv/fiat-crypto) |
| `field-offset` | `0.3.6` | MIT OR Apache-2.0 | [リンク](https://github.com/Diggsey/rust-field-offset) |
| `filetime` | `0.2.29` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/filetime) |
| `find-msvc-tools` | `0.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cc-rs) |
| `fixedbitset` | `0.4.2` | MIT/Apache-2.0 | [リンク](https://github.com/petgraph/fixedbitset) |
| `flatbuffers` | `24.12.23` | Apache-2.0 | [リンク](https://github.com/google/flatbuffers) |
| `flate2` | `1.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/flate2-rs) |
| `fnv` | `1.0.7` | Apache-2.0 / MIT | [リンク](https://github.com/servo/rust-fnv) |
| `foldhash` | `0.1.5` | Zlib | [リンク](https://github.com/orlp/foldhash) |
| `foldhash` | `0.2.0` | Zlib | [リンク](https://github.com/orlp/foldhash) |
| `foreign-types` | `0.3.2` | MIT/Apache-2.0 | [リンク](https://github.com/sfackler/foreign-types) |
| `foreign-types` | `0.5.0` | MIT/Apache-2.0 | [リンク](https://github.com/sfackler/foreign-types) |
| `foreign-types-macros` | `0.2.3` | MIT/Apache-2.0 | [リンク](https://github.com/sfackler/foreign-types) |
| `foreign-types-shared` | `0.1.1` | MIT/Apache-2.0 | [リンク](https://github.com/sfackler/foreign-types) |
| `foreign-types-shared` | `0.3.1` | MIT/Apache-2.0 | [リンク](https://github.com/sfackler/foreign-types) |
| `form_urlencoded` | `1.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/rust-url) |
| `fs_extra` | `1.3.0` | MIT | [リンク](https://github.com/webdesus/fs_extra) |
| `fs-set-times` | `0.20.3` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/fs-set-times) |
| `funty` | `2.0.0` | MIT | [リンク](https://github.com/myrrlyn/funty) |
| `fusou-auth` | `0.3.0` | MIT OR Apache-2.0 | - |
| `fusou-storage` | `0.1.0` | MIT OR Apache-2.0 | - |
| `fusou-upload` | `0.1.0` | MIT OR Apache-2.0 | - |
| `futures` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-channel` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-core` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-executor` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-io` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-lite` | `2.6.1` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/futures-lite) |
| `futures-macro` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-sink` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-task` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `futures-util` | `0.3.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/futures-rs) |
| `gdk` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gdk-pixbuf` | `0.18.5` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `gdk-pixbuf-sys` | `0.18.0` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `gdk-sys` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gdkwayland-sys` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gdkx11` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gdkx11-sys` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `generator` | `0.8.9` | MIT/Apache-2.0 | [リンク](https://github.com/Xudong-Huang/generator-rs.git) |
| `generic-array` | `0.14.7` | MIT | [リンク](https://github.com/fizyk20/generic-array.git) |
| `gethostname` | `1.1.0` | Apache-2.0 | [リンク](https://codeberg.org/swsnr/gethostname.rs.git) |
| `getrandom` | `0.3.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/getrandom) |
| `getrandom` | `0.2.17` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/getrandom) |
| `getrandom` | `0.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/getrandom) |
| `gio` | `0.18.4` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `gio-sys` | `0.18.1` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `glib` | `0.18.5` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `glib-macros` | `0.18.5` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `glib-sys` | `0.18.1` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `glob` | `0.3.3` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/glob) |
| `global-hotkey` | `0.8.0` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/global-hotkey) |
| `gobject-sys` | `0.18.0` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `group` | `0.13.0` | MIT/Apache-2.0 | [リンク](https://github.com/zkcrypto/group) |
| `gtk` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gtk-sys` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `gtk3-macros` | `0.18.2` | MIT | [リンク](https://github.com/gtk-rs/gtk3-rs) |
| `h2` | `0.3.27` | MIT | [リンク](https://github.com/hyperium/h2) |
| `h2` | `0.4.14` | MIT | [リンク](https://github.com/hyperium/h2) |
| `half` | `2.7.1` | MIT OR Apache-2.0 | [リンク](https://github.com/VoidStarKat/half-rs) |
| `hashbrown` | `0.17.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/hashbrown) |
| `hashbrown` | `0.15.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/hashbrown) |
| `hashbrown` | `0.16.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/hashbrown) |
| `hashbrown` | `0.14.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/hashbrown) |
| `hashbrown` | `0.12.3` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/hashbrown) |
| `headers` | `0.3.9` | MIT | [リンク](https://github.com/hyperium/headers) |
| `headers-core` | `0.2.0` | MIT | [リンク](https://github.com/hyperium/headers) |
| `heck` | `0.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/withoutboats/heck) |
| `heck` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/withoutboats/heck) |
| `hermit-abi` | `0.5.2` | MIT OR Apache-2.0 | [リンク](https://github.com/hermit-os/hermit-rs) |
| `hex` | `0.4.3` | MIT OR Apache-2.0 | [リンク](https://github.com/KokaKiwi/rust-hex) |
| `hmac` | `0.13.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/MACs) |
| `hmac` | `0.12.1` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/MACs) |
| `home` | `0.5.12` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/cargo) |
| `html5ever` | `0.38.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/html5ever) |
| `http` | `0.2.12` | MIT OR Apache-2.0 | [リンク](https://github.com/hyperium/http) |
| `http` | `1.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/hyperium/http) |
| `http-body` | `0.4.6` | MIT | [リンク](https://github.com/hyperium/http-body) |
| `http-body` | `1.0.1` | MIT | [リンク](https://github.com/hyperium/http-body) |
| `http-body-util` | `0.1.3` | MIT | [リンク](https://github.com/hyperium/http-body) |
| `httparse` | `1.10.1` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/httparse) |
| `httpdate` | `1.0.3` | MIT OR Apache-2.0 | [リンク](https://github.com/pyfisch/httpdate) |
| `hudsucker` | `0.23.0` | MIT OR Apache-2.0 | [リンク](https://github.com/omjadas/hudsucker) |
| `humantime` | `2.3.0` | MIT OR Apache-2.0 | [リンク](https://github.com/chronotope/humantime) |
| `hybrid-array` | `0.4.12` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hybrid-array) |
| `hyper` | `0.14.32` | MIT | [リンク](https://github.com/hyperium/hyper) |
| `hyper` | `1.10.1` | MIT | [リンク](https://github.com/hyperium/hyper) |
| `hyper-rustls` | `0.24.2` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/hyper-rustls) |
| `hyper-rustls` | `0.27.9` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/hyper-rustls) |
| `hyper-tls` | `0.5.0` | MIT/Apache-2.0 | [リンク](https://github.com/hyperium/hyper-tls) |
| `hyper-tungstenite` | `0.15.0` | BSD-2-Clause | [リンク](https://github.com/de-vri-es/hyper-tungstenite-rs) |
| `hyper-util` | `0.1.20` | MIT | [リンク](https://github.com/hyperium/hyper-util) |
| `iana-time-zone` | `0.1.65` | MIT OR Apache-2.0 | [リンク](https://github.com/strawlab/iana-time-zone) |
| `iana-time-zone-haiku` | `0.1.2` | MIT OR Apache-2.0 | [リンク](https://github.com/strawlab/iana-time-zone) |
| `ico` | `0.5.0` | MIT | [リンク](https://github.com/mdsteele/rust-ico) |
| `icu_collections` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_locale_core` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_normalizer` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_normalizer_data` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_properties` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_properties_data` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `icu_provider` | `2.2.0` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `id-arena` | `2.3.0` | MIT/Apache-2.0 | [リンク](https://github.com/fitzgen/id-arena) |
| `ident_case` | `1.0.1` | MIT/Apache-2.0 | [リンク](https://github.com/TedDriggs/ident_case) |
| `idna` | `1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/rust-url/) |
| `idna_adapter` | `1.2.2` | Apache-2.0 OR MIT | [リンク](https://github.com/hsivonen/idna_adapter) |
| `indexmap` | `2.14.0` | Apache-2.0 OR MIT | [リンク](https://github.com/indexmap-rs/indexmap) |
| `indexmap` | `1.9.3` | Apache-2.0 OR MIT | [リンク](https://github.com/bluss/indexmap) |
| `infer` | `0.19.0` | MIT | [リンク](https://github.com/bojand/infer) |
| `instant` | `0.1.13` | BSD-3-Clause | [リンク](https://github.com/sebcrozet/instant) |
| `integer-encoding` | `3.0.4` | MIT | [リンク](https://github.com/dermesser/integer-encoding-rs) |
| `io-extras` | `0.18.4` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/io-extras) |
| `io-lifetimes` | `2.0.4` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/io-lifetimes) |
| `ipnet` | `2.12.0` | MIT OR Apache-2.0 | [リンク](https://github.com/krisprice/ipnet) |
| `is_terminal_polyfill` | `1.70.2` | MIT OR Apache-2.0 | [リンク](https://github.com/polyfill-rs/is_terminal_polyfill) |
| `is-docker` | `0.2.0` | MIT | [リンク](https://github.com/TheLarkInn/is-docker) |
| `is-wsl` | `0.4.0` | MIT | [リンク](https://github.com/TheLarkInn/is-wsl) |
| `itertools` | `0.13.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-itertools/itertools) |
| `itertools` | `0.10.5` | MIT/Apache-2.0 | [リンク](https://github.com/rust-itertools/itertools) |
| `itoa` | `1.0.18` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/itoa) |
| `javascriptcore-rs` | `1.1.2` | MIT | [リンク](https://github.com/tauri-apps/javascriptcore-rs) |
| `javascriptcore-rs-sys` | `1.1.1` | MIT | [リンク](https://github.com/tauri-apps/javascriptcore-rs) |
| `jni` | `0.21.1` | MIT/Apache-2.0 | [リンク](https://github.com/jni-rs/jni-rs) |
| `jni` | `0.22.4` | MIT OR Apache-2.0 | [リンク](https://github.com/jni-rs/jni-rs) |
| `jni-macros` | `0.22.4` | MIT OR Apache-2.0 | [リンク](https://github.com/jni-rs/jni-rs) |
| `jni-sys` | `0.3.1` | MIT OR Apache-2.0 | [リンク](https://github.com/jni-rs/jni-sys) |
| `jni-sys` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/jni-rs/jni-sys) |
| `jni-sys-macros` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/jni-rs/jni-sys) |
| `jobserver` | `0.1.34` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/jobserver-rs) |
| `js-sys` | `0.3.99` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/js-sys) |
| `json-patch` | `3.0.1` | MIT/Apache-2.0 | [リンク](https://github.com/idubrov/json-patch) |
| `jsonptr` | `0.6.3` | MIT OR Apache-2.0 | [リンク](https://github.com/chanced/jsonptr) |
| `kc-api` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-build-config` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-database` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-dto` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-interface` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-interface-adapter` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-api-parser` | `0.4.0` | MIT OR Apache-2.0 | - |
| `kc-fleet-snapshot` | `0.4.0` | MIT OR Apache-2.0 | - |
| `keyboard-types` | `0.7.0` | MIT OR Apache-2.0 | [リンク](https://github.com/pyfisch/keyboard-types) |
| `lazy_static` | `1.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang-nursery/lazy-static.rs) |
| `leb128fmt` | `0.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/bluk/leb128fmt) |
| `lexical-core` | `1.0.6` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `lexical-parse-float` | `1.0.6` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `lexical-parse-integer` | `1.0.6` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `lexical-util` | `1.0.7` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `lexical-write-float` | `1.0.6` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `lexical-write-integer` | `1.0.6` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/rust-lexical) |
| `libappindicator` | `0.9.0` | Apache-2.0 OR MIT | - |
| `libappindicator-sys` | `0.9.0` | Apache-2.0 OR MIT | - |
| `libc` | `0.2.186` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/libc) |
| `libdbus-sys` | `0.2.7` | Apache-2.0/MIT | [リンク](https://github.com/diwic/dbus-rs) |
| `libloading` | `0.7.4` | ISC | [リンク](https://github.com/nagisa/rust_libloading/) |
| `libm` | `0.2.16` | MIT | [リンク](https://github.com/rust-lang/compiler-builtins) |
| `libredox` | `0.1.17` | MIT | [リンク](https://gitlab.redox-os.org/redox-os/libredox.git) |
| `linux-raw-sys` | `0.12.1` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/linux-raw-sys) |
| `linux-raw-sys` | `0.4.15` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/linux-raw-sys) |
| `litemap` | `0.8.2` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `lock_api` | `0.4.14` | MIT OR Apache-2.0 | [リンク](https://github.com/Amanieu/parking_lot) |
| `log` | `0.4.32` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/log) |
| `loom` | `0.7.2` | MIT | [リンク](https://github.com/tokio-rs/loom) |
| `lru` | `0.16.4` | MIT | [リンク](https://github.com/jeromefroe/lru-rs.git) |
| `lru-slab` | `0.1.2` | MIT OR Apache-2.0 OR Zlib | [リンク](https://github.com/Ralith/lru-slab) |
| `lz4_flex` | `0.11.6` | MIT | [リンク](https://github.com/pseitz/lz4_flex) |
| `lzma-sys` | `0.1.20` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/xz2-rs) |
| `mac-notification-sys` | `0.6.13` | MIT/Apache-2.0 | [リンク](https://github.com/h4llow3En/mac-notification-sys) |
| `markup5ever` | `0.38.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/html5ever) |
| `matchers` | `0.2.0` | MIT | [リンク](https://github.com/hawkw/matchers) |
| `maybe-owned` | `0.3.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rustonaut/maybe-owned) |
| `md-5` | `0.11.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `md-5` | `0.10.6` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `memchr` | `2.8.1` | Unlicense OR MIT | [リンク](https://github.com/BurntSushi/memchr) |
| `memoffset` | `0.9.1` | MIT | [リンク](https://github.com/Gilnaa/memoffset) |
| `mime` | `0.3.17` | MIT OR Apache-2.0 | [リンク](https://github.com/hyperium/mime) |
| `mime_guess` | `2.0.5` | MIT | [リンク](https://github.com/abonander/mime_guess) |
| `minimal-lexical` | `0.2.1` | MIT/Apache-2.0 | [リンク](https://github.com/Alexhuszagh/minimal-lexical) |
| `minisign-verify` | `0.2.5` | MIT | [リンク](https://github.com/jedisct1/rust-minisign-verify) |
| `miniz_oxide` | `0.8.9` | MIT OR Zlib OR Apache-2.0 | [リンク](https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide) |
| `mio` | `1.2.1` | MIT | [リンク](https://github.com/tokio-rs/mio) |
| `moka` | `0.12.15` | (MIT OR Apache-2.0) AND Apache-2.0 | [リンク](https://github.com/moka-rs/moka) |
| `muda` | `0.19.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/muda) |
| `multer` | `2.1.0` | MIT | [リンク](https://github.com/rousan/multer-rs) |
| `multimap` | `0.8.3` | MIT/Apache-2.0 | [リンク](https://github.com/havarnov/multimap) |
| `native-tls` | `0.2.18` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-native-tls/rust-native-tls) |
| `ndk` | `0.9.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-mobile/ndk) |
| `ndk-context` | `0.1.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-windowing/android-ndk-rs) |
| `ndk-sys` | `0.6.0+11769913` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-mobile/ndk) |
| `new_debug_unreachable` | `1.0.6` | MIT | [リンク](https://github.com/mbrubeck/rust-debug-unreachable) |
| `nom` | `7.1.3` | MIT | [リンク](https://github.com/Geal/nom) |
| `notify-rust` | `4.17.0` | MIT/Apache-2.0 | [リンク](https://github.com/hoodie/notify-rust) |
| `nu-ansi-term` | `0.50.3` | MIT | [リンク](https://github.com/nushell/nu-ansi-term) |
| `num` | `0.4.3` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num) |
| `num_cpus` | `1.17.0` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/num_cpus) |
| `num_enum` | `0.7.6` | BSD-3-Clause OR MIT OR Apache-2.0 | [リンク](https://github.com/illicitonion/num_enum) |
| `num_enum_derive` | `0.7.6` | BSD-3-Clause OR MIT OR Apache-2.0 | [リンク](https://github.com/illicitonion/num_enum) |
| `num_threads` | `0.1.7` | MIT OR Apache-2.0 | [リンク](https://github.com/jhpratt/num_threads) |
| `num-bigint` | `0.4.6` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-bigint) |
| `num-complex` | `0.4.6` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-complex) |
| `num-conv` | `0.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/jhpratt/num-conv) |
| `num-derive` | `0.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-derive) |
| `num-integer` | `0.1.46` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-integer) |
| `num-iter` | `0.1.45` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-iter) |
| `num-rational` | `0.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-rational) |
| `num-traits` | `0.2.19` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-num/num-traits) |
| `objc2` | `0.6.4` | MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-app-kit` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-cloud-kit` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-data` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-foundation` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-graphics` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-image` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-location` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-core-text` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-encode` | `4.1.0` | MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-exception-helper` | `0.1.1` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-foundation` | `0.3.2` | MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-io-surface` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-osa-kit` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-quartz-core` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-ui-kit` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-user-notifications` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `objc2-web-kit` | `0.3.2` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/madsmtm/objc2) |
| `object_store` | `0.11.2` | MIT/Apache-2.0 | [リンク](https://github.com/apache/arrow-rs/tree/main/object_store) |
| `object_store` | `0.10.2` | MIT/Apache-2.0 | [リンク](https://github.com/apache/arrow-rs/tree/master/object_store) |
| `oid-registry` | `0.7.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rusticata/oid-registry.git) |
| `once_cell` | `1.21.4` | MIT OR Apache-2.0 | [リンク](https://github.com/matklad/once_cell) |
| `once_cell_polyfill` | `1.70.2` | MIT OR Apache-2.0 | [リンク](https://github.com/polyfill-rs/once_cell_polyfill) |
| `open` | `5.3.5` | MIT | [リンク](https://github.com/Byron/open-rs) |
| `openssl` | `0.10.80` | Apache-2.0 | [リンク](https://github.com/rust-openssl/rust-openssl) |
| `openssl-macros` | `0.1.1` | MIT/Apache-2.0 | - |
| `openssl-probe` | `0.2.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/openssl-probe) |
| `openssl-sys` | `0.9.116` | MIT | [リンク](https://github.com/rust-openssl/rust-openssl) |
| `option-ext` | `0.2.0` | MPL-2.0 | [リンク](https://github.com/soc/option-ext.git) |
| `ordered-float` | `2.10.1` | MIT | [リンク](https://github.com/reem/rust-ordered-float) |
| `ordered-multimap` | `0.7.3` | MIT | [リンク](https://github.com/sgodwincs/ordered-multimap-rs) |
| `ordered-stream` | `0.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/danieldg/ordered-stream) |
| `os_pipe` | `1.2.3` | MIT | [リンク](https://github.com/oconnor663/os_pipe.rs) |
| `osakit` | `0.3.1` | MIT OR Apache-2.0 | [リンク](https://github.com/mdevils/rust-osakit) |
| `outref` | `0.5.2` | MIT | [リンク](https://github.com/Nugine/outref) |
| `p256` | `0.13.2` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/elliptic-curves/tree/master/p256) |
| `pango` | `0.18.3` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `pango-sys` | `0.18.0` | MIT | [リンク](https://github.com/gtk-rs/gtk-rs-core) |
| `parking` | `2.2.1` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/parking) |
| `parking_lot` | `0.12.5` | MIT OR Apache-2.0 | [リンク](https://github.com/Amanieu/parking_lot) |
| `parking_lot_core` | `0.9.12` | MIT OR Apache-2.0 | [リンク](https://github.com/Amanieu/parking_lot) |
| `parquet` | `53.4.1` | Apache-2.0 | [リンク](https://github.com/apache/arrow-rs) |
| `paste` | `1.0.15` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/paste) |
| `pathdiff` | `0.2.3` | MIT/Apache-2.0 | [リンク](https://github.com/Manishearth/pathdiff) |
| `pem` | `3.0.6` | MIT | [リンク](https://github.com/jcreekmore/pem-rs.git) |
| `pem-rfc7468` | `0.7.0` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/pem-rfc7468) |
| `percent-encoding` | `2.3.2` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/rust-url/) |
| `petgraph` | `0.6.5` | MIT OR Apache-2.0 | [リンク](https://github.com/petgraph/petgraph) |
| `phf` | `0.12.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf` | `0.13.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf_codegen` | `0.13.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf_generator` | `0.13.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf_macros` | `0.13.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf_shared` | `0.12.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `phf_shared` | `0.13.1` | MIT | [リンク](https://github.com/rust-phf/rust-phf) |
| `pin-project` | `1.1.13` | Apache-2.0 OR MIT | [リンク](https://github.com/taiki-e/pin-project) |
| `pin-project-internal` | `1.1.13` | Apache-2.0 OR MIT | [リンク](https://github.com/taiki-e/pin-project) |
| `pin-project-lite` | `0.2.17` | Apache-2.0 OR MIT | [リンク](https://github.com/taiki-e/pin-project-lite) |
| `pin-utils` | `0.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang-nursery/pin-utils) |
| `piper` | `0.2.5` | MIT OR Apache-2.0 | [リンク](https://github.com/smol-rs/piper) |
| `pkcs8` | `0.10.2` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/pkcs8) |
| `pkg-config` | `0.3.33` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/pkg-config-rs) |
| `plist` | `1.9.0` | MIT | [リンク](https://github.com/ebarnard/rust-plist/) |
| `png` | `0.18.1` | MIT OR Apache-2.0 | [リンク](https://github.com/image-rs/image-png) |
| `png` | `0.17.16` | MIT OR Apache-2.0 | [リンク](https://github.com/image-rs/image-png) |
| `polling` | `3.11.0` | Apache-2.0 OR MIT | [リンク](https://github.com/smol-rs/polling) |
| `portable-atomic` | `1.13.1` | Apache-2.0 OR MIT | [リンク](https://github.com/taiki-e/portable-atomic) |
| `potential_utf` | `0.1.5` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `powerfmt` | `0.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/jhpratt/powerfmt) |
| `ppv-lite86` | `0.2.21` | MIT OR Apache-2.0 | [リンク](https://github.com/cryptocorrosion/cryptocorrosion) |
| `precomputed-hash` | `0.1.1` | MIT | [リンク](https://github.com/emilio/precomputed-hash) |
| `prettyplease` | `0.2.37` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/prettyplease) |
| `prettyplease` | `0.1.25` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/prettyplease) |
| `primeorder` | `0.13.6` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/elliptic-curves/tree/master/primeorder) |
| `proc-macro-crate` | `2.0.0` | MIT OR Apache-2.0 | [リンク](https://github.com/bkchr/proc-macro-crate) |
| `proc-macro-crate` | `1.3.1` | MIT OR Apache-2.0 | [リンク](https://github.com/bkchr/proc-macro-crate) |
| `proc-macro-crate` | `3.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/bkchr/proc-macro-crate) |
| `proc-macro-error` | `1.0.4` | MIT OR Apache-2.0 | [リンク](https://gitlab.com/CreepySkeleton/proc-macro-error) |
| `proc-macro-error-attr` | `1.0.4` | MIT OR Apache-2.0 | [リンク](https://gitlab.com/CreepySkeleton/proc-macro-error) |
| `proc-macro2` | `1.0.106` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/proc-macro2) |
| `prost` | `0.11.9` | Apache-2.0 | [リンク](https://github.com/tokio-rs/prost) |
| `prost-build` | `0.11.9` | Apache-2.0 | [リンク](https://github.com/tokio-rs/prost) |
| `prost-derive` | `0.11.9` | Apache-2.0 | [リンク](https://github.com/tokio-rs/prost) |
| `prost-types` | `0.11.9` | Apache-2.0 | [リンク](https://github.com/tokio-rs/prost) |
| `protoc-bin-vendored` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-linux-aarch_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-linux-ppcle_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-linux-s390_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-linux-x86_32` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-linux-x86_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-macos-aarch_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-macos-x86_64` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `protoc-bin-vendored-win32` | `3.2.0` | MIT | [リンク](https://github.com/stepancheg/rust-protoc-bin-vendored/) |
| `proxy-https` | `0.1.1` | MIT OR Apache-2.0 | - |
| `ptr_meta` | `0.1.4` | MIT | [リンク](https://github.com/djkoloski/ptr_meta) |
| `ptr_meta_derive` | `0.1.4` | MIT | [リンク](https://github.com/djkoloski/ptr_meta) |
| `quad-rand` | `0.2.3` | MIT | [リンク](https://github.com/not-fl3/quad-rand) |
| `quick-xml` | `0.36.2` | MIT | [リンク](https://github.com/tafia/quick-xml) |
| `quick-xml` | `0.39.4` | MIT | [リンク](https://github.com/tafia/quick-xml) |
| `quick-xml` | `0.37.5` | MIT | [リンク](https://github.com/tafia/quick-xml) |
| `quinn` | `0.11.9` | MIT OR Apache-2.0 | [リンク](https://github.com/quinn-rs/quinn) |
| `quinn-proto` | `0.11.14` | MIT OR Apache-2.0 | [リンク](https://github.com/quinn-rs/quinn) |
| `quinn-udp` | `0.5.14` | MIT OR Apache-2.0 | [リンク](https://github.com/quinn-rs/quinn) |
| `quote` | `1.0.45` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/quote) |
| `r-efi` | `5.3.0` | MIT OR Apache-2.0 OR LGPL-2.1-or-later | [リンク](https://github.com/r-efi/r-efi) |
| `r-efi` | `6.0.0` | MIT OR Apache-2.0 OR LGPL-2.1-or-later | [リンク](https://github.com/r-efi/r-efi) |
| `radium` | `0.7.0` | MIT | [リンク](https://github.com/bitvecto-rs/radium) |
| `rand` | `0.8.6` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `rand` | `0.9.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `rand_chacha` | `0.3.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `rand_chacha` | `0.9.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `rand_core` | `0.6.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `rand_core` | `0.9.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-random/rand) |
| `raw-window-handle` | `0.6.2` | MIT OR Apache-2.0 OR Zlib | [リンク](https://github.com/rust-windowing/raw-window-handle) |
| `rcgen` | `0.13.2` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/rcgen) |
| `redox_syscall` | `0.5.18` | MIT | [リンク](https://gitlab.redox-os.org/redox-os/syscall) |
| `redox_users` | `0.4.6` | MIT | [リンク](https://gitlab.redox-os.org/redox-os/users) |
| `redox_users` | `0.5.2` | MIT | [リンク](https://gitlab.redox-os.org/redox-os/users) |
| `ref-cast` | `1.0.25` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/ref-cast) |
| `ref-cast-impl` | `1.0.25` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/ref-cast) |
| `regex` | `1.12.3` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/regex) |
| `regex-automata` | `0.4.14` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/regex) |
| `regex-lite` | `0.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/regex) |
| `regex-syntax` | `0.8.10` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/regex) |
| `register_macro_derive_and_attr` | `0.4.0` | MIT OR Apache-2.0 | - |
| `register_trait` | `0.4.0` | MIT OR Apache-2.0 | - |
| `rend` | `0.4.2` | MIT | [リンク](https://github.com/djkoloski/rend) |
| `reqwest` | `0.11.27` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/reqwest) |
| `reqwest` | `0.12.28` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/reqwest) |
| `reqwest` | `0.13.4` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/reqwest) |
| `rfc6979` | `0.4.0` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/signatures/tree/master/rfc6979) |
| `rfd` | `0.16.0` | MIT | [リンク](https://github.com/PolyMeilex/rfd) |
| `ring` | `0.17.14` | Apache-2.0 AND ISC | [リンク](https://github.com/briansmith/ring) |
| `rkyv` | `0.7.46` | MIT | [リンク](https://github.com/rkyv/rkyv) |
| `rkyv_derive` | `0.7.46` | MIT | [リンク](https://github.com/rkyv/rkyv) |
| `rust_decimal` | `1.42.0` | MIT | [リンク](https://github.com/paupino/rust-decimal) |
| `rust-ini` | `0.21.3` | MIT | [リンク](https://github.com/zonyitoo/rust-ini) |
| `rustc_version` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/djc/rustc-version-rs) |
| `rustc-hash` | `2.1.2` | Apache-2.0 OR MIT | [リンク](https://github.com/rust-lang/rustc-hash) |
| `rusticata-macros` | `4.1.0` | MIT/Apache-2.0 | [リンク](https://github.com/rusticata/rusticata-macros.git) |
| `rustix` | `1.1.4` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/rustix) |
| `rustix` | `0.38.44` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/rustix) |
| `rustix-linux-procfs` | `0.1.1` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/sunfishcode/rustix-linux-procfs) |
| `rustls` | `0.21.12` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/rustls) |
| `rustls` | `0.23.40` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/rustls) |
| `rustls-native-certs` | `0.8.4` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/rustls-native-certs) |
| `rustls-pemfile` | `1.0.4` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/pemfile) |
| `rustls-pki-types` | `1.14.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/pki-types) |
| `rustls-platform-verifier` | `0.7.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/rustls-platform-verifier) |
| `rustls-platform-verifier-android` | `0.1.1` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/rustls-platform-verifier) |
| `rustls-webpki` | `0.101.7` | ISC | [リンク](https://github.com/rustls/webpki) |
| `rustls-webpki` | `0.103.13` | ISC | [リンク](https://github.com/rustls/webpki) |
| `rustversion` | `1.0.22` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/rustversion) |
| `ryu` | `1.0.23` | Apache-2.0 OR BSL-1.0 | [リンク](https://github.com/dtolnay/ryu) |
| `same-file` | `1.0.6` | Unlicense/MIT | [リンク](https://github.com/BurntSushi/same-file) |
| `schannel` | `0.1.29` | MIT | [リンク](https://github.com/steffengy/schannel-rs) |
| `schemars` | `0.8.22` | MIT | [リンク](https://github.com/GREsau/schemars) |
| `schemars` | `0.9.0` | MIT | [リンク](https://github.com/GREsau/schemars) |
| `schemars` | `1.2.1` | MIT | [リンク](https://github.com/GREsau/schemars) |
| `schemars_derive` | `0.8.22` | MIT | [リンク](https://github.com/GREsau/schemars) |
| `scoped-tls` | `1.0.1` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/scoped-tls) |
| `scopeguard` | `1.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/bluss/scopeguard) |
| `sct` | `0.7.1` | Apache-2.0 OR ISC OR MIT | [リンク](https://github.com/rustls/sct.rs) |
| `seahash` | `4.1.0` | MIT | [リンク](https://gitlab.redox-os.org/redox-os/seahash) |
| `sec1` | `0.7.3` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/sec1) |
| `security-framework` | `3.7.0` | MIT OR Apache-2.0 | [リンク](https://github.com/kornelski/rust-security-framework) |
| `security-framework-sys` | `2.17.0` | MIT OR Apache-2.0 | [リンク](https://github.com/kornelski/rust-security-framework) |
| `selectors` | `0.36.1` | MPL-2.0 | [リンク](https://github.com/servo/stylo) |
| `semver` | `1.0.28` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/semver) |
| `seq-macro` | `0.3.6` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/seq-macro) |
| `serde` | `1.0.228` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/serde) |
| `serde_bytes` | `0.11.19` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/bytes) |
| `serde_core` | `1.0.228` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/serde) |
| `serde_derive` | `1.0.228` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/serde) |
| `serde_derive_internals` | `0.29.1` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/serde) |
| `serde_json` | `1.0.150` | MIT OR Apache-2.0 | [リンク](https://github.com/serde-rs/json) |
| `serde_qs` | `0.14.0` | MIT/Apache-2.0 | [リンク](https://github.com/samscott89/serde_qs) |
| `serde_repr` | `0.1.20` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/serde-repr) |
| `serde_spanned` | `1.1.1` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `serde_spanned` | `0.6.9` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `serde_urlencoded` | `0.7.1` | MIT/Apache-2.0 | [リンク](https://github.com/nox/serde_urlencoded) |
| `serde_with` | `3.21.0` | MIT OR Apache-2.0 | [リンク](https://github.com/jonasbb/serde_with/) |
| `serde_with_macros` | `3.21.0` | MIT OR Apache-2.0 | [リンク](https://github.com/jonasbb/serde_with/) |
| `serde-untagged` | `0.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/serde-untagged) |
| `serialize-to-javascript` | `0.1.2` | MIT OR Apache-2.0 | [リンク](https://github.com/chippers/serialize-to-javascript) |
| `serialize-to-javascript-impl` | `0.1.2` | MIT OR Apache-2.0 | [リンク](https://github.com/chippers/serialize-to-javascript) |
| `servo_arc` | `0.4.3` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/stylo) |
| `sha1` | `0.10.6` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `sha1` | `0.11.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `sha2` | `0.10.9` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `sha2` | `0.11.0` | MIT OR Apache-2.0 | [リンク](https://github.com/RustCrypto/hashes) |
| `sharded-slab` | `0.1.7` | MIT | [リンク](https://github.com/hawkw/sharded-slab) |
| `shared_child` | `1.1.1` | MIT | [リンク](https://github.com/oconnor663/shared_child.rs) |
| `shlex` | `2.0.1` | MIT OR Apache-2.0 | [リンク](https://github.com/comex/rust-shlex) |
| `sigchld` | `0.2.4` | MIT | [リンク](https://github.com/oconnor663/sigchld.rs) |
| `signal-hook` | `0.3.18` | Apache-2.0/MIT | [リンク](https://github.com/vorner/signal-hook) |
| `signal-hook-registry` | `1.4.8` | MIT OR Apache-2.0 | [リンク](https://github.com/vorner/signal-hook) |
| `signature` | `2.2.0` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/traits/tree/master/signature) |
| `simd_cesu8` | `1.1.1` | Apache-2.0 OR MIT | [リンク](https://github.com/seancroach/simd_cesu8) |
| `simd-adler32` | `0.3.9` | MIT | [リンク](https://github.com/mcountryman/simd-adler32) |
| `simdutf8` | `0.1.5` | MIT OR Apache-2.0 | [リンク](https://github.com/rusticstuff/simdutf8) |
| `similar` | `2.7.0` | Apache-2.0 | [リンク](https://github.com/mitsuhiko/similar) |
| `siphasher` | `1.0.3` | MIT/Apache-2.0 | [リンク](https://github.com/jedisct1/rust-siphash) |
| `slab` | `0.4.12` | MIT | [リンク](https://github.com/tokio-rs/slab) |
| `smallvec` | `1.15.1` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/rust-smallvec) |
| `snafu` | `0.8.9` | MIT OR Apache-2.0 | [リンク](https://github.com/shepmaster/snafu) |
| `snafu` | `0.7.5` | MIT OR Apache-2.0 | [リンク](https://github.com/shepmaster/snafu) |
| `snafu-derive` | `0.8.9` | MIT OR Apache-2.0 | [リンク](https://github.com/shepmaster/snafu) |
| `snafu-derive` | `0.7.5` | MIT OR Apache-2.0 | [リンク](https://github.com/shepmaster/snafu) |
| `snap` | `1.1.1` | BSD-3-Clause | [リンク](https://github.com/BurntSushi/rust-snappy) |
| `socket2` | `0.6.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/socket2) |
| `socket2` | `0.5.10` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-lang/socket2) |
| `softbuffer` | `0.4.8` | MIT OR Apache-2.0 | [リンク](https://github.com/rust-windowing/softbuffer) |
| `soup3` | `0.5.0` | MIT | [リンク](https://gitlab.gnome.org/World/Rust/soup3-rs) |
| `soup3-sys` | `0.5.0` | MIT | [リンク](https://gitlab.gnome.org/World/Rust/soup3-rs) |
| `spin` | `0.10.0` | MIT | [リンク](https://github.com/mvdnes/spin-rs.git) |
| `spin` | `0.9.8` | MIT | [リンク](https://github.com/mvdnes/spin-rs.git) |
| `spki` | `0.7.3` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/formats/tree/master/spki) |
| `sqids` | `0.4.2` | MIT | [リンク](https://github.com/sqids/sqids-rust) |
| `sqlparser` | `0.50.0` | Apache-2.0 | [リンク](https://github.com/sqlparser-rs/sqlparser-rs) |
| `sqlparser_derive` | `0.2.2` | Apache-2.0 | [リンク](https://github.com/sqlparser-rs/sqlparser-rs) |
| `stable_deref_trait` | `1.2.1` | MIT OR Apache-2.0 | [リンク](https://github.com/storyyeller/stable_deref_trait) |
| `static_assertions` | `1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/nvzqz/static-assertions-rs) |
| `string_cache` | `0.9.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/string-cache) |
| `string_cache_codegen` | `0.6.1` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/string-cache) |
| `strsim` | `0.11.1` | MIT | [リンク](https://github.com/rapidfuzz/strsim-rs) |
| `strum` | `0.26.3` | MIT | [リンク](https://github.com/Peternator7/strum) |
| `strum` | `0.27.2` | MIT | [リンク](https://github.com/Peternator7/strum) |
| `strum_macros` | `0.26.4` | MIT | [リンク](https://github.com/Peternator7/strum) |
| `strum_macros` | `0.27.2` | MIT | [リンク](https://github.com/Peternator7/strum) |
| `subtle` | `2.6.1` | BSD-3-Clause | [リンク](https://github.com/dalek-cryptography/subtle) |
| `swift-rs` | `1.0.7` | MIT OR Apache-2.0 | [リンク](https://github.com/Brendonovich/swift-rs) |
| `symlink` | `0.1.0` | MIT/Apache-2.0 | [リンク](https://gitlab.com/chris-morgan/symlink) |
| `syn` | `2.0.117` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/syn) |
| `syn` | `1.0.109` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/syn) |
| `sync_wrapper` | `0.1.2` | Apache-2.0 | [リンク](https://github.com/Actyx/sync_wrapper) |
| `sync_wrapper` | `1.0.2` | Apache-2.0 | [リンク](https://github.com/Actyx/sync_wrapper) |
| `synstructure` | `0.13.2` | MIT | [リンク](https://github.com/mystor/synstructure) |
| `system-configuration` | `0.5.1` | MIT OR Apache-2.0 | [リンク](https://github.com/mullvad/system-configuration-rs) |
| `system-configuration-sys` | `0.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/mullvad/system-configuration-rs) |
| `system-deps` | `6.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/gdesmott/system-deps) |
| `tagptr` | `0.2.0` | MIT/Apache-2.0 | [リンク](https://github.com/oliver-giersch/tagptr.git) |
| `tao` | `0.35.3` | Apache-2.0 | [リンク](https://github.com/tauri-apps/tao) |
| `tao-macros` | `0.1.3` | MIT OR Apache-2.0 | [リンク](https://github.com/tauri-apps/tao) |
| `tap` | `1.0.1` | MIT | [リンク](https://github.com/myrrlyn/tap) |
| `tar` | `0.4.46` | MIT OR Apache-2.0 | [リンク](https://github.com/composefs/tar-rs) |
| `target-lexicon` | `0.12.16` | Apache-2.0 WITH LLVM-exception | [リンク](https://github.com/bytecodealliance/target-lexicon) |
| `tauri` | `2.11.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-build` | `2.6.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-codegen` | `2.6.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-macros` | `2.6.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-plugin` | `2.6.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-plugin-autostart` | `2.5.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-deep-link` | `2.4.9` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-dialog` | `2.7.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-fs` | `2.5.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-global-shortcut` | `2.3.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-log` | `2.8.0` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-notification` | `2.3.3` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-opener` | `2.5.4` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-process` | `2.3.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-shell` | `2.3.5` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-single-instance` | `2.4.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-updater` | `2.10.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-plugin-window-state` | `2.4.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/plugins-workspace) |
| `tauri-runtime` | `2.11.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-runtime-wry` | `2.11.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-utils` | `2.9.2` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri) |
| `tauri-winres` | `0.3.6` | MIT | [リンク](https://github.com/tauri-apps/winres) |
| `tauri-winrt-notification` | `0.7.2` | MIT OR Apache-2.0 | [リンク](https://github.com/tauri-apps/winrt-notification) |
| `tempfile` | `3.27.0` | MIT OR Apache-2.0 | [リンク](https://github.com/Stebalien/tempfile) |
| `tendril` | `0.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/html5ever) |
| `termcolor` | `1.4.1` | Unlicense OR MIT | [リンク](https://github.com/BurntSushi/termcolor) |
| `thiserror` | `1.0.69` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/thiserror) |
| `thiserror` | `2.0.18` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/thiserror) |
| `thiserror-impl` | `1.0.69` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/thiserror) |
| `thiserror-impl` | `2.0.18` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/thiserror) |
| `thread_local` | `1.1.9` | MIT OR Apache-2.0 | [リンク](https://github.com/Amanieu/thread_local-rs) |
| `thrift` | `0.17.0` | Apache-2.0 | [リンク](https://github.com/apache/thrift/tree/master/lib/rs) |
| `time` | `0.3.47` | MIT OR Apache-2.0 | [リンク](https://github.com/time-rs/time) |
| `time-core` | `0.1.8` | MIT OR Apache-2.0 | [リンク](https://github.com/time-rs/time) |
| `time-macros` | `0.2.27` | MIT OR Apache-2.0 | [リンク](https://github.com/time-rs/time) |
| `tiny-keccak` | `2.0.2` | CC0-1.0 | - |
| `tinystr` | `0.8.3` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `tinyvec` | `1.11.0` | Zlib OR Apache-2.0 OR MIT | [リンク](https://github.com/Lokathor/tinyvec) |
| `tinyvec_macros` | `0.1.1` | MIT OR Apache-2.0 OR Zlib | [リンク](https://github.com/Soveu/tinyvec_macros) |
| `tokio` | `1.52.3` | MIT | [リンク](https://github.com/tokio-rs/tokio) |
| `tokio-cron-scheduler` | `0.14.0` | MIT/Apache-2.0 | [リンク](https://github.com/mvniekerk/tokio-cron-scheduler) |
| `tokio-graceful` | `0.1.6` | MIT OR Apache-2.0 | [リンク](https://github.com/plabayo/tokio-graceful) |
| `tokio-macros` | `2.7.0` | MIT | [リンク](https://github.com/tokio-rs/tokio) |
| `tokio-native-tls` | `0.3.1` | MIT | [リンク](https://github.com/tokio-rs/tls) |
| `tokio-rustls` | `0.24.1` | MIT/Apache-2.0 | [リンク](https://github.com/rustls/tokio-rustls) |
| `tokio-rustls` | `0.26.4` | MIT OR Apache-2.0 | [リンク](https://github.com/rustls/tokio-rustls) |
| `tokio-tungstenite` | `0.24.0` | MIT | [リンク](https://github.com/snapview/tokio-tungstenite) |
| `tokio-tungstenite` | `0.21.0` | MIT | [リンク](https://github.com/snapview/tokio-tungstenite) |
| `tokio-util` | `0.7.18` | MIT | [リンク](https://github.com/tokio-rs/tokio) |
| `toml` | `0.9.12+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml` | `0.8.23` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml` | `1.1.2+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_datetime` | `0.7.5+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_datetime` | `0.6.11` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_datetime` | `1.1.1+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_edit` | `0.22.27` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_edit` | `0.20.7` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_edit` | `0.19.15` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_edit` | `0.25.12+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_parser` | `1.1.2+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_write` | `0.1.2` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `toml_writer` | `1.1.1+spec-1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/toml-rs/toml) |
| `tonic-build` | `0.9.2` | MIT | [リンク](https://github.com/hyperium/tonic) |
| `tower` | `0.5.3` | MIT | [リンク](https://github.com/tower-rs/tower) |
| `tower-http` | `0.6.11` | MIT | [リンク](https://github.com/tower-rs/tower-http) |
| `tower-layer` | `0.3.3` | MIT | [リンク](https://github.com/tower-rs/tower) |
| `tower-service` | `0.3.3` | MIT | [リンク](https://github.com/tower-rs/tower) |
| `tracing` | `0.1.44` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-appender` | `0.2.5` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-attributes` | `0.1.31` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-core` | `0.1.36` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-log` | `0.2.0` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-subscriber` | `0.3.23` | MIT | [リンク](https://github.com/tokio-rs/tracing) |
| `tracing-unwrap` | `1.0.1` | Apache-2.0/MIT | [リンク](https://github.com/abreis/tracing-unwrap) |
| `tray-icon` | `0.23.1` | MIT OR Apache-2.0 | [リンク](https://github.com/tauri-apps/tray-icon) |
| `try-lock` | `0.2.5` | MIT | [リンク](https://github.com/seanmonstar/try-lock) |
| `ts-rs` | `11.1.0` | MIT | [リンク](https://github.com/Aleph-Alpha/ts-rs) |
| `ts-rs-macros` | `11.1.0` | MIT | [リンク](https://github.com/Aleph-Alpha/ts-rs) |
| `tungstenite` | `0.24.0` | MIT OR Apache-2.0 | [リンク](https://github.com/snapview/tungstenite-rs) |
| `tungstenite` | `0.21.0` | MIT OR Apache-2.0 | [リンク](https://github.com/snapview/tungstenite-rs) |
| `twox-hash` | `2.1.2` | MIT | [リンク](https://github.com/shepmaster/twox-hash) |
| `twox-hash` | `1.6.3` | MIT | [リンク](https://github.com/shepmaster/twox-hash) |
| `typeid` | `1.0.3` | MIT OR Apache-2.0 | [リンク](https://github.com/dtolnay/typeid) |
| `typenum` | `1.20.1` | MIT OR Apache-2.0 | [リンク](https://github.com/paholg/typenum) |
| `uds_windows` | `1.2.1` | MIT | [リンク](https://github.com/haraldh/rust_uds_windows) |
| `unic-char-property` | `0.9.0` | MIT/Apache-2.0 | [リンク](https://github.com/open-i18n/rust-unic/) |
| `unic-char-range` | `0.9.0` | MIT/Apache-2.0 | [リンク](https://github.com/open-i18n/rust-unic/) |
| `unic-common` | `0.9.0` | MIT/Apache-2.0 | [リンク](https://github.com/open-i18n/rust-unic/) |
| `unic-ucd-ident` | `0.9.0` | MIT/Apache-2.0 | [リンク](https://github.com/open-i18n/rust-unic/) |
| `unic-ucd-version` | `0.9.0` | MIT/Apache-2.0 | [リンク](https://github.com/open-i18n/rust-unic/) |
| `unicase` | `2.9.0` | MIT OR Apache-2.0 | [リンク](https://github.com/seanmonstar/unicase) |
| `unicode-ident` | `1.0.24` | (MIT OR Apache-2.0) AND Unicode-3.0 | [リンク](https://github.com/dtolnay/unicode-ident) |
| `unicode-segmentation` | `1.13.3` | MIT OR Apache-2.0 | [リンク](https://github.com/unicode-rs/unicode-segmentation) |
| `unicode-width` | `0.2.2` | MIT OR Apache-2.0 | [リンク](https://github.com/unicode-rs/unicode-width) |
| `unicode-xid` | `0.2.6` | MIT OR Apache-2.0 | [リンク](https://github.com/unicode-rs/unicode-xid) |
| `untrusted` | `0.9.0` | ISC | [リンク](https://github.com/briansmith/untrusted) |
| `url` | `2.5.8` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/rust-url) |
| `urlencoding` | `2.1.3` | MIT | [リンク](https://github.com/kornelski/rust_urlencoding) |
| `urlpattern` | `0.3.0` | MIT | [リンク](https://github.com/denoland/rust-urlpattern) |
| `utf-8` | `0.7.6` | MIT OR Apache-2.0 | [リンク](https://github.com/SimonSapin/rust-utf8) |
| `utf8_iter` | `1.0.4` | Apache-2.0 OR MIT | [リンク](https://github.com/hsivonen/utf8_iter) |
| `utf8-width` | `0.1.8` | MIT | [リンク](https://github.com/magiclen/utf8-width) |
| `utf8parse` | `0.2.2` | Apache-2.0 OR MIT | [リンク](https://github.com/alacritty/vte) |
| `uuid` | `0.8.2` | Apache-2.0 OR MIT | [リンク](https://github.com/uuid-rs/uuid) |
| `uuid` | `1.23.2` | Apache-2.0 OR MIT | [リンク](https://github.com/uuid-rs/uuid) |
| `valuable` | `0.1.1` | MIT | [リンク](https://github.com/tokio-rs/valuable) |
| `value-bag` | `1.12.0` | Apache-2.0 OR MIT | [リンク](https://github.com/sval-rs/value-bag) |
| `vcpkg` | `0.2.15` | MIT/Apache-2.0 | [リンク](https://github.com/mcgoo/vcpkg-rs) |
| `version_check` | `0.9.5` | MIT/Apache-2.0 | [リンク](https://github.com/SergioBenitez/version_check) |
| `version-compare` | `0.2.1` | MIT | [リンク](https://gitlab.com/timvisee/version-compare) |
| `vsimd` | `0.8.0` | MIT | [リンク](https://github.com/Nugine/simd) |
| `vswhom` | `0.1.0` | MIT | [リンク](https://github.com/nabijaczleweli/vswhom.rs) |
| `vswhom-sys` | `0.1.3` | MIT | [リンク](https://github.com/nabijaczleweli/vswhom-sys.rs) |
| `walkdir` | `2.5.0` | Unlicense/MIT | [リンク](https://github.com/BurntSushi/walkdir) |
| `want` | `0.3.1` | MIT | [リンク](https://github.com/seanmonstar/want) |
| `warp` | `0.3.7` | MIT | [リンク](https://github.com/seanmonstar/warp) |
| `wasi` | `0.11.1+wasi-snapshot-preview1` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasi) |
| `wasip2` | `1.0.3+wasi-0.2.9` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasi-rs) |
| `wasip3` | `0.4.0+wasi-0.3.0-rc-2026-01-06` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasi-rs) |
| `wasm-bindgen` | `0.2.122` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen) |
| `wasm-bindgen-futures` | `0.4.72` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/futures) |
| `wasm-bindgen-macro` | `0.2.122` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/macro) |
| `wasm-bindgen-macro-support` | `0.2.122` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/macro-support) |
| `wasm-bindgen-shared` | `0.2.122` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/shared) |
| `wasm-encoder` | `0.244.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasm-tools/tree/main/crates/wasm-encoder) |
| `wasm-metadata` | `0.244.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasm-tools/tree/main/crates/wasm-metadata) |
| `wasm-streams` | `0.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/MattiasBuelens/wasm-streams/) |
| `wasm-streams` | `0.5.0` | MIT OR Apache-2.0 | [リンク](https://github.com/MattiasBuelens/wasm-streams/) |
| `wasmparser` | `0.244.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasm-tools/tree/main/crates/wasmparser) |
| `web_atoms` | `0.2.4` | MIT OR Apache-2.0 | [リンク](https://github.com/servo/html5ever) |
| `web-sys` | `0.3.99` | MIT OR Apache-2.0 | [リンク](https://github.com/wasm-bindgen/wasm-bindgen/tree/master/crates/web-sys) |
| `web-time` | `1.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/daxpedda/web-time) |
| `webbrowser` | `1.2.1` | MIT OR Apache-2.0 | [リンク](https://github.com/amodm/webbrowser-rs) |
| `webkit2gtk` | `2.0.2` | MIT | [リンク](https://github.com/tauri-apps/webkit2gtk-rs) |
| `webkit2gtk-sys` | `2.0.2` | MIT | [リンク](https://github.com/tauri-apps/webkit2gtk-rs) |
| `webpki-root-certs` | `1.0.7` | CDLA-Permissive-2.0 | [リンク](https://github.com/rustls/webpki-roots) |
| `webpki-roots` | `1.0.7` | CDLA-Permissive-2.0 | [リンク](https://github.com/rustls/webpki-roots) |
| `webpki-roots` | `0.26.11` | CDLA-Permissive-2.0 | [リンク](https://github.com/rustls/webpki-roots) |
| `webview2-com` | `0.38.2` | MIT | [リンク](https://github.com/wravery/webview2-rs) |
| `webview2-com-macros` | `0.8.1` | MIT | [リンク](https://github.com/wravery/webview2-rs) |
| `webview2-com-sys` | `0.38.2` | MIT | [リンク](https://github.com/wravery/webview2-rs) |
| `which` | `4.4.2` | MIT | [リンク](https://github.com/harryfei/which-rs.git) |
| `winapi` | `0.3.9` | MIT/Apache-2.0 | [リンク](https://github.com/retep998/winapi-rs) |
| `winapi-i686-pc-windows-gnu` | `0.4.0` | MIT/Apache-2.0 | [リンク](https://github.com/retep998/winapi-rs) |
| `winapi-util` | `0.1.11` | Unlicense OR MIT | [リンク](https://github.com/BurntSushi/winapi-util) |
| `winapi-x86_64-pc-windows-gnu` | `0.4.0` | MIT/Apache-2.0 | [リンク](https://github.com/retep998/winapi-rs) |
| `window-vibrancy` | `0.6.0` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/tauri-plugin-vibrancy) |
| `windows` | `0.61.3` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_gnullvm` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_gnullvm` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_gnullvm` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_gnullvm` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_msvc` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_msvc` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_msvc` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_aarch64_msvc` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnu` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnu` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnu` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnu` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnullvm` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_gnullvm` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_msvc` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_msvc` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_msvc` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_i686_msvc` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnu` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnu` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnu` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnu` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnullvm` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnullvm` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnullvm` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_gnullvm` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_msvc` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_msvc` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_msvc` | `0.53.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows_x86_64_msvc` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-collections` | `0.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-core` | `0.62.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-core` | `0.61.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-future` | `0.2.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-implement` | `0.60.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-interface` | `0.59.3` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-link` | `0.2.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-link` | `0.1.3` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-numerics` | `0.2.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-registry` | `0.5.3` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-result` | `0.4.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-result` | `0.3.4` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-strings` | `0.5.1` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-strings` | `0.4.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.61.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.59.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.48.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.52.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.60.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-sys` | `0.45.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-targets` | `0.52.6` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-targets` | `0.48.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-targets` | `0.53.5` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-targets` | `0.42.2` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-threading` | `0.1.0` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `windows-version` | `0.1.7` | MIT OR Apache-2.0 | [リンク](https://github.com/microsoft/windows-rs) |
| `winnow` | `1.0.3` | MIT | [リンク](https://github.com/winnow-rs/winnow) |
| `winnow` | `0.7.15` | MIT | [リンク](https://github.com/winnow-rs/winnow) |
| `winnow` | `0.5.40` | MIT | [リンク](https://github.com/winnow-rs/winnow) |
| `winreg` | `0.50.0` | MIT | [リンク](https://github.com/gentoo90/winreg-rs) |
| `winreg` | `0.55.0` | MIT | [リンク](https://github.com/gentoo90/winreg-rs) |
| `winreg` | `0.10.1` | MIT | [リンク](https://github.com/gentoo90/winreg-rs) |
| `winreg` | `0.52.0` | MIT | [リンク](https://github.com/gentoo90/winreg-rs) |
| `winx` | `0.36.4` | Apache-2.0 WITH LLVM-exception | [リンク](https://github.com/sunfishcode/winx) |
| `wit-bindgen` | `0.57.1` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wit-bindgen) |
| `wit-bindgen` | `0.51.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wit-bindgen) |
| `wit-bindgen-core` | `0.51.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wit-bindgen) |
| `wit-bindgen-rust` | `0.51.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wit-bindgen) |
| `wit-bindgen-rust-macro` | `0.51.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wit-bindgen) |
| `wit-component` | `0.244.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasm-tools/tree/main/crates/wit-component) |
| `wit-parser` | `0.244.0` | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | [リンク](https://github.com/bytecodealliance/wasm-tools/tree/main/crates/wit-parser) |
| `writeable` | `0.6.3` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `wry` | `0.55.1` | Apache-2.0 OR MIT | [リンク](https://github.com/tauri-apps/wry) |
| `wyz` | `0.5.1` | MIT | [リンク](https://github.com/myrrlyn/wyz) |
| `x11` | `2.21.0` | MIT | [リンク](https://github.com/AltF02/x11-rs.git) |
| `x11-dl` | `2.21.0` | MIT | [リンク](https://github.com/AltF02/x11-rs.git) |
| `x11rb` | `0.13.2` | MIT OR Apache-2.0 | [リンク](https://github.com/psychon/x11rb) |
| `x11rb-protocol` | `0.13.2` | MIT OR Apache-2.0 | [リンク](https://github.com/psychon/x11rb) |
| `x509-parser` | `0.16.0` | MIT OR Apache-2.0 | [リンク](https://github.com/rusticata/x509-parser.git) |
| `xattr` | `1.6.1` | MIT OR Apache-2.0 | [リンク](https://github.com/Stebalien/xattr) |
| `xkeysym` | `0.2.1` | MIT OR Apache-2.0 OR Zlib | [リンク](https://github.com/notgull/xkeysym) |
| `xmlparser` | `0.13.6` | MIT/Apache-2.0 | [リンク](https://github.com/RazrFalcon/xmlparser) |
| `xz2` | `0.1.7` | MIT/Apache-2.0 | [リンク](https://github.com/alexcrichton/xz2-rs) |
| `yasna` | `0.5.2` | MIT OR Apache-2.0 | [リンク](https://github.com/qnighy/yasna.rs) |
| `yoke` | `0.8.3` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `yoke-derive` | `0.8.2` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zbus` | `5.16.0` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |
| `zbus_macros` | `5.16.0` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |
| `zbus_names` | `4.3.2` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |
| `zerocopy` | `0.8.50` | BSD-2-Clause OR Apache-2.0 OR MIT | [リンク](https://github.com/google/zerocopy) |
| `zerocopy-derive` | `0.8.50` | BSD-2-Clause OR Apache-2.0 OR MIT | [リンク](https://github.com/google/zerocopy) |
| `zerofrom` | `0.1.8` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zerofrom-derive` | `0.1.7` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zeroize` | `1.8.2` | Apache-2.0 OR MIT | [リンク](https://github.com/RustCrypto/utils) |
| `zerotrie` | `0.2.4` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zerovec` | `0.11.6` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zerovec-derive` | `0.11.3` | Unicode-3.0 | [リンク](https://github.com/unicode-org/icu4x) |
| `zip` | `4.6.1` | MIT | [リンク](https://github.com/zip-rs/zip2.git) |
| `zmij` | `1.0.21` | MIT | [リンク](https://github.com/dtolnay/zmij) |
| `zstd` | `0.13.3` | MIT | [リンク](https://github.com/gyscos/zstd-rs) |
| `zstd-safe` | `7.2.1` | MIT/Apache-2.0 | [リンク](https://github.com/gyscos/zstd-rs) |
| `zstd-sys` | `2.0.13+zstd.1.5.6` | MIT/Apache-2.0 | [リンク](https://github.com/gyscos/zstd-rs) |
| `zvariant` | `5.12.0` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |
| `zvariant_derive` | `5.12.0` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |
| `zvariant_utils` | `3.4.0` | MIT | [リンク](https://github.com/z-galaxy/zbus/) |

</details>

---

## 6. 各ライセンスの全文 (License Texts)

<details>
<summary><strong>MIT License</strong></summary>

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>

<details>
<summary><strong>Apache License, Version 2.0</strong></summary>

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.
      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:
      (a) You must give any other recipients of the Work or Derivative Works
          a copy of this License; and
      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and
      (c) You must retain, in the Source form of any Derivative Works that
          You distribute, all copyright, patent, trademark, and attribution
          notices from the Source form of the Work; and
      (d) If the Work includes a "NOTICE" text file as part of its distribution,
          then any Derivative Works that You distribute must include a readable
          copy of the attribution notices contained within such NOTICE file.

   (For complete license text, visit https://www.apache.org/licenses/LICENSE-2.0)
```

</details>

<details>
<summary><strong>Mozilla Public License Version 2.0 (MPL-2.0)</strong></summary>

```text
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------
1.1. "Contributor"
    means each individual or entity that creates, contributes to the
    creation of, or owns Covered Software.
1.6. "Executable"
    means Covered Software in any form other than Source Code.
1.7. "Larger Work"
    means a work that combines Covered Software with other material, in a separate
    file or files, that is not Covered Software.
1.10. "Modifications"
    means any addition to, deletion from, or change or alteration of the
    Covered Software.
1.11. "Source Code Form"
    means the form of the work preferred for making modifications, including
    any associated documentation and source code files.

2. License Grants
-----------------
Each Contributor hereby grants You a world-wide, royalty-free, non-exclusive
license to reproduce, use, distribute, and create Modifications of the Covered
Software.

3. Responsibilities
-------------------
3.1. Availability of Source Code
Any Covered Software that You distribute must also be made available in Source
Code Form.
3.3. Larger Works
You may create and distribute a Larger Work under terms of Your choice, provided
that You also comply with the requirements of this License for the Covered Software.

(For complete license text, visit https://www.mozilla.org/en-US/MPL/2.0/)
```

</details>

<details>
<summary><strong>BSD 2-Clause & BSD 3-Clause License</strong></summary>

```text
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. (For BSD 3-Clause) Neither the name of the copyright holder nor the names
   of its contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES.
```

</details>
