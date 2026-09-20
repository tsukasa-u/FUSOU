---
title: FUSOU-WEB ライセンス情報
description: Webアプリケーション「FUSOU-WEB」本体およびユーザーブラウザへ配信・実行されるオープンソースソフトウェアのライセンス・著作権表示
contributors: ["tsukasa-u"]
date: 2026-09-09
slug: license/fusou_web
tags: [license, fusou-web, astro, solidjs, cloudflare]
---

# FUSOU-WEB ライセンス情報 (Third-Party Notices)

本ドキュメントは、Webアプリケーション・公開サービス **FUSOU-WEB** 本体のライセンス、および利用者のブラウザへ配信・実行されるサードパーティ製オープンソースソフトウェア（OSS）のライセンス条文・著作権表示をまとめたものです。

---

## 1. FUSOU-WEB 本体のライセンス

FUSOU-WEB は **MIT License** のもとで提供・公開されています。

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

## 2. 配信構成とライセンス表記方針

FUSOU-WEB は **Astro**, **SolidJS**, **Cloudflare Workers** をベースに構築されています。
利用者がサービスを利用する際に配信・提供されるプログラムは以下の通りです：

1. **クライアント配信アセット**: ブラウザ上で動作する SolidJS アイランド、チャート描画、艦隊シミュレータ、ダイアグラム生成エンジン等のバンドルスクリプトおよびCSS/フォントアセット。
2. **エッジ・API ランタイム**: Cloudflare Workers 上で実行される Astro SSR エンドポイントおよび Hono API ルーター。

本サービスでクライアントに配信されるすべての依存パッケージは、**パーミッシブなライセンス（MIT, Apache-2.0, BSD, ISC 等）** または **弱コピーレフトライセンス（EPL-2.0, MPL-2.0）** で構成されており、利用者の自由な閲覧・利用を妨げる強コピーレフトライセンスは含まれていません。

---

## 3. 特記すべきライブラリと権利表記

### elkjs (Eclipse Public License 2.0 - EPL-2.0)
- **用途**: 任務ツリーや艦隊データのグラフ自動レイアウト処理
- **ライセンス**: EPL-2.0

> [!NOTE]
> **EPL-2.0（弱コピーレフト）に関する告知**  
> `elkjs` は Eclipse Foundation の Eclipse Public License 2.0 のもとで提供されています。FUSOU-WEB は `elkjs` のライブラリソースコードを変更することなくそのままバンドル・呼び出し利用しています。ソースコードは [https://github.com/kieler/elkjs](https://github.com/kieler/elkjs) から入手可能です。

### Font Awesome Free
- **用途**: UIアイコンアセット (`@fortawesome/fontawesome-free`)

> [!NOTE]
> **アセット別ライセンス区分**  
> `@fortawesome/fontawesome-free` は構成要素ごとに異なるライセンスが適用されています：
> - **Icons**: [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/)
> - **Fonts**: [SIL OFL 1.1 License](http://scripts.sil.org/OFL)
> - **Code**: [MIT License](https://opensource.org/licenses/MIT)

### khroma (MIT)
- **用途**: Mermaid のカラー計算補助ライブラリ

> [!NOTE]
> **ライセンス補足**  
> `khroma` は `package.json` 上のライセンス表記が未定義となっていますが、同梱のライセンスファイルに基づき MIT License（Fabio Spampinato, Andrew Maney）が適用されます。

---

## 4. 主要ライブラリ一覧

| ライブラリ名 | 分類・役割 | ライセンス |
| :--- | :--- | :--- |
| `solid-js` | UI Framework | MIT |
| `astro` | Web Framework | MIT |
| `@astrojs/cloudflare` | SSR Runtime Adapter | MIT |
| `elkjs` | Graph Layout Engine | EPL-2.0 |
| `rehype-mermaid` | Diagram Rendering | MIT |
| `chart.js` | Chart Visualization | MIT |
| `solid-chartjs` | Solid Chart Integration | MIT |
| `@supabase/supabase-js` | Database Client | MIT |
| `hono` | Server API Router | MIT |
| `zod` | Schema Validation | MIT |
| `apache-arrow` | Columnar Data Processing | Apache-2.0 |
| `katex` | Math Formatting | MIT |
| `virtua` | Virtual List Scrolling | MIT |
| `daisyui` | UI Component System | MIT |
| `tailwindcss` | CSS Utility Framework | MIT |
| `@fortawesome/fontawesome-free` | Icon Assets | CC-BY-4.0 / OFL-1.1 / MIT |

---

## 5. 全本番依存パッケージ一覧 (486 パッケージ)

FUSOU-WEB の本番環境（クライアント配信バンドルおよびエッジワーカー）に含まれるすべての依存パッケージ一覧です。

<details>
<summary><strong>全 486 パッケージの一覧を展開する (クリックして表示)</strong></summary>

| パッケージ名 | バージョン | ライセンス |
| :--- | :--- | :--- |
| `@antfu/install-pkg` | `1.1.0` | MIT |
| `@astrojs/cloudflare` | `14.1.4` | MIT |
| `@astrojs/compiler-binding` | `0.3.1` | MIT |
| `@astrojs/compiler-binding-win32-x64-msvc` | `0.3.1` | MIT |
| `@astrojs/compiler-rs` | `0.3.1` | MIT |
| `@astrojs/internal-helpers` | `0.10.1` | MIT |
| `@astrojs/markdown-remark` | `7.2.1` | MIT |
| `@astrojs/markdown-satteri` | `0.3.4` | MIT |
| `@astrojs/prism` | `4.0.2` | MIT |
| `@astrojs/telemetry` | `3.3.3` | MIT |
| `@astrojs/underscore-redirects` | `1.0.3` | MIT |
| `@babel/helper-string-parser` | `7.29.7` | MIT |
| `@babel/helper-validator-identifier` | `7.29.7` | MIT |
| `@babel/parser` | `7.29.7` | MIT |
| `@babel/types` | `7.29.7` | MIT |
| `@braintree/sanitize-url` | `7.1.1` | MIT |
| `@bruits/satteri-win32-x64-msvc` | `0.9.5` | MIT |
| `@capsizecss/unpack` | `4.0.1` | MIT |
| `@chevrotain/cst-dts-gen` | `11.0.3` | Apache-2.0 |
| `@chevrotain/gast` | `11.0.3` | Apache-2.0 |
| `@chevrotain/regexp-to-ast` | `11.0.3` | Apache-2.0 |
| `@chevrotain/types` | `11.0.3` | Apache-2.0 |
| `@chevrotain/utils` | `11.0.3` | Apache-2.0 |
| `@clack/core` | `1.4.3` | MIT |
| `@clack/prompts` | `1.7.0` | MIT |
| `@cloudflare/kv-asset-handler` | `0.5.0` | MIT OR Apache-2.0 |
| `@cloudflare/unenv-preset` | `2.16.1` | MIT OR Apache-2.0 |
| `@cloudflare/vite-plugin` | `1.47.0` | MIT |
| `@cloudflare/workerd-windows-64` | `1.20260722.1` | Apache-2.0 |
| `@cloudflare/workers-types` | `5.20260723.1` | MIT OR Apache-2.0 |
| `@cspotcode/source-map-support` | `0.8.1` | MIT |
| `@dagrejs/dagre` | `2.0.4` | MIT |
| `@dagrejs/graphlib` | `3.0.4` | MIT |
| `@esbuild/win32-x64` | `0.28.1` | MIT |
| `@fortawesome/fontawesome-free` | `6.7.2` | (CC-BY-4.0 AND OFL-1.1 AND MIT) |
| `@iconify/types` | `2.0.0` | MIT |
| `@iconify/utils` | `3.1.0` | MIT |
| `@img/colour` | `1.1.0` | MIT |
| `@img/sharp-win32-x64` | `0.35.2, 0.35.3` | Apache-2.0 AND LGPL-3.0-or-later |
| `@jridgewell/gen-mapping` | `0.3.13` | MIT |
| `@jridgewell/resolve-uri` | `3.1.2` | MIT |
| `@jridgewell/source-map` | `0.3.11` | MIT |
| `@jridgewell/sourcemap-codec` | `1.5.5` | MIT |
| `@jridgewell/trace-mapping` | `0.3.9, 0.3.31` | MIT |
| `@kurkle/color` | `0.3.4` | MIT |
| `@mermaid-js/parser` | `0.6.3` | MIT |
| `@nanostores/persistent` | `1.2.0` | MIT |
| `@nanostores/solid` | `1.1.1` | MIT |
| `@oslojs/encoding` | `1.1.0` | MIT |
| `@oxc-project/types` | `0.139.0` | MIT |
| `@poppinss/colors` | `4.1.6` | MIT |
| `@poppinss/dumper` | `0.6.5` | MIT |
| `@poppinss/exception` | `1.2.3` | MIT |
| `@rolldown/binding-win32-x64-msvc` | `1.1.5` | MIT |
| `@rolldown/pluginutils` | `1.0.1` | MIT |
| `@rollup/pluginutils` | `5.4.0` | MIT |
| `@rollup/rollup-win32-x64-gnu` | `4.62.2` | MIT |
| `@rollup/rollup-win32-x64-msvc` | `4.62.2` | MIT |
| `@shikijs/core` | `4.3.1` | MIT |
| `@shikijs/engine-javascript` | `4.3.1` | MIT |
| `@shikijs/engine-oniguruma` | `4.3.1` | MIT |
| `@shikijs/langs` | `4.3.1` | MIT |
| `@shikijs/primitive` | `4.3.1` | MIT |
| `@shikijs/themes` | `4.3.1` | MIT |
| `@shikijs/types` | `4.3.1` | MIT |
| `@shikijs/vscode-textmate` | `10.0.2` | MIT |
| `@sindresorhus/is` | `7.2.0` | MIT |
| `@speed-highlight/core` | `1.2.15` | CC0-1.0 |
| `@supabase/auth-js` | `2.86.0` | MIT |
| `@supabase/functions-js` | `2.86.0` | MIT |
| `@supabase/postgrest-js` | `2.86.0` | MIT |
| `@supabase/realtime-js` | `2.86.0` | MIT |
| `@supabase/storage-js` | `2.86.0` | MIT |
| `@supabase/supabase-js` | `2.86.0` | MIT |
| `@swc/helpers` | `0.5.17` | Apache-2.0 |
| `@types/command-line-args` | `5.2.3` | MIT |
| `@types/command-line-usage` | `5.0.4` | MIT |
| `@types/d3` | `7.4.3` | MIT |
| `@types/d3-array` | `3.2.2` | MIT |
| `@types/d3-axis` | `3.0.6` | MIT |
| `@types/d3-brush` | `3.0.6` | MIT |
| `@types/d3-chord` | `3.0.6` | MIT |
| `@types/d3-color` | `3.1.3` | MIT |
| `@types/d3-contour` | `3.0.6` | MIT |
| `@types/d3-delaunay` | `6.0.4` | MIT |
| `@types/d3-dispatch` | `3.0.7` | MIT |
| `@types/d3-drag` | `3.0.7` | MIT |
| `@types/d3-dsv` | `3.0.7` | MIT |
| `@types/d3-ease` | `3.0.2` | MIT |
| `@types/d3-fetch` | `3.0.7` | MIT |
| `@types/d3-force` | `3.0.10` | MIT |
| `@types/d3-format` | `3.0.4` | MIT |
| `@types/d3-geo` | `3.1.0` | MIT |
| `@types/d3-hierarchy` | `3.1.7` | MIT |
| `@types/d3-interpolate` | `3.0.4` | MIT |
| `@types/d3-path` | `3.1.1` | MIT |
| `@types/d3-polygon` | `3.0.2` | MIT |
| `@types/d3-quadtree` | `3.0.6` | MIT |
| `@types/d3-random` | `3.0.3` | MIT |
| `@types/d3-scale` | `4.0.9` | MIT |
| `@types/d3-scale-chromatic` | `3.1.0` | MIT |
| `@types/d3-selection` | `3.0.11` | MIT |
| `@types/d3-shape` | `3.1.7` | MIT |
| `@types/d3-time` | `3.0.4` | MIT |
| `@types/d3-time-format` | `4.0.3` | MIT |
| `@types/d3-timer` | `3.0.2` | MIT |
| `@types/d3-transition` | `3.0.9` | MIT |
| `@types/d3-zoom` | `3.0.8` | MIT |
| `@types/debug` | `4.1.12` | MIT |
| `@types/estree` | `1.0.9` | MIT |
| `@types/estree-jsx` | `1.0.5` | MIT |
| `@types/geojson` | `7946.0.16` | MIT |
| `@types/hast` | `3.0.4, 3.0.5` | MIT |
| `@types/katex` | `0.16.8` | MIT |
| `@types/mdast` | `4.0.4` | MIT |
| `@types/ms` | `2.1.0` | MIT |
| `@types/nlcst` | `2.0.3` | MIT |
| `@types/node` | `20.19.25, 22.20.1, 26.3.0` | MIT |
| `@types/phoenix` | `1.6.6` | MIT |
| `@types/react` | `19.2.7` | MIT |
| `@types/trusted-types` | `2.0.7` | MIT |
| `@types/unist` | `3.0.3` | MIT |
| `@types/ws` | `8.18.1` | MIT |
| `@ungap/structured-clone` | `1.3.3` | ISC |
| `@xyflow/react` | `12.10.0` | MIT |
| `@xyflow/system` | `0.0.74` | MIT |
| `acorn` | `8.17.0, 8.18.0` | MIT |
| `am-i-vibing` | `0.4.0` | MIT |
| `ansi-styles` | `4.3.0` | MIT |
| `anymatch` | `3.1.3` | ISC |
| `apache-arrow` | `20.0.0` | Apache-2.0 |
| `argparse` | `2.0.1` | Python-2.0 |
| `aria-query` | `5.3.2` | Apache-2.0 |
| `array-back` | `6.2.2` | MIT |
| `array-iterate` | `2.0.1` | MIT |
| `astro` | `7.1.3` | MIT |
| `axobject-query` | `4.1.0` | Apache-2.0 |
| `bail` | `2.0.2` | MIT |
| `blake3-wasm` | `2.1.5` | MIT |
| `boolbase` | `1.0.0` | ISC |
| `buffer-from` | `1.1.2` | MIT |
| `ccount` | `2.0.1` | MIT |
| `chalk` | `4.1.2` | MIT |
| `chalk-template` | `0.4.0` | MIT |
| `character-entities` | `2.0.2` | MIT |
| `character-entities-html4` | `2.1.0` | MIT |
| `character-entities-legacy` | `3.0.0` | MIT |
| `chart.js` | `4.5.1` | MIT |
| `chevrotain` | `11.0.3` | Apache-2.0 |
| `chevrotain-allstar` | `0.3.1` | MIT |
| `chokidar` | `5.0.0` | MIT |
| `ci-info` | `4.4.0` | MIT |
| `classcat` | `5.0.5` | MIT |
| `clsx` | `2.1.1` | MIT |
| `color-convert` | `2.0.1` | MIT |
| `color-name` | `1.1.4` | MIT |
| `comma-separated-tokens` | `2.0.3` | MIT |
| `command-line-args` | `6.0.1` | MIT |
| `command-line-usage` | `7.0.3` | MIT |
| `commander` | `2.20.3, 7.2.0, 8.3.0, 11.1.0` | MIT |
| `common-ancestor-path` | `2.0.0` | BlueOak-1.0.0 |
| `confbox` | `0.1.8` | MIT |
| `cookie` | `1.1.1, 2.0.1` | MIT |
| `cookie-es` | `1.2.3` | MIT |
| `cose-base` | `1.0.3, 2.2.0` | MIT |
| `crossws` | `0.3.5` | MIT |
| `css-select` | `5.2.2` | BSD-2-Clause |
| `css-tree` | `2.2.1, 3.2.1` | MIT |
| `css-what` | `6.2.2` | BSD-2-Clause |
| `csso` | `5.0.5` | MIT |
| `csstype` | `3.2.3` | MIT |
| `cytoscape` | `3.33.1` | MIT |
| `cytoscape-cose-bilkent` | `4.1.0` | MIT |
| `cytoscape-fcose` | `2.2.0` | MIT |
| `d3` | `7.9.0` | ISC |
| `d3-array` | `3.2.4` | ISC |
| `d3-array` | `2.12.1` | BSD-3-Clause |
| `d3-axis` | `3.0.0` | ISC |
| `d3-brush` | `3.0.0` | ISC |
| `d3-chord` | `3.0.1` | ISC |
| `d3-color` | `3.1.0` | ISC |
| `d3-contour` | `4.0.2` | ISC |
| `d3-delaunay` | `6.0.4` | ISC |
| `d3-dispatch` | `3.0.1` | ISC |
| `d3-drag` | `3.0.0` | ISC |
| `d3-dsv` | `3.0.1` | ISC |
| `d3-ease` | `3.0.1` | BSD-3-Clause |
| `d3-fetch` | `3.0.1` | ISC |
| `d3-force` | `3.0.0` | ISC |
| `d3-format` | `3.1.0` | ISC |
| `d3-geo` | `3.1.1` | ISC |
| `d3-hierarchy` | `3.1.2` | ISC |
| `d3-interpolate` | `3.0.1` | ISC |
| `d3-path` | `3.1.0` | ISC |
| `d3-path` | `1.0.9` | BSD-3-Clause |
| `d3-polygon` | `3.0.1` | ISC |
| `d3-quadtree` | `3.0.1` | ISC |
| `d3-random` | `3.0.1` | ISC |
| `d3-sankey` | `0.12.3` | BSD-3-Clause |
| `d3-scale` | `4.0.2` | ISC |
| `d3-scale-chromatic` | `3.1.0` | ISC |
| `d3-selection` | `3.0.0` | ISC |
| `d3-shape` | `3.2.0` | ISC |
| `d3-shape` | `1.3.7` | BSD-3-Clause |
| `d3-time` | `3.1.0` | ISC |
| `d3-time-format` | `4.1.0` | ISC |
| `d3-timer` | `3.0.1` | ISC |
| `d3-transition` | `3.0.1` | ISC |
| `d3-zoom` | `3.0.0` | ISC |
| `dagre-d3-es` | `7.0.13` | MIT |
| `daisyui` | `5.7.0` | MIT |
| `dayjs` | `1.11.19` | MIT |
| `debug` | `4.4.3` | MIT |
| `decode-named-character-reference` | `1.2.0, 1.3.0` | MIT |
| `defu` | `6.1.7` | MIT |
| `delaunator` | `5.0.1` | ISC |
| `dequal` | `2.0.3` | MIT |
| `destr` | `2.0.5` | MIT |
| `detect-libc` | `2.1.2` | Apache-2.0 |
| `devalue` | `5.8.2` | MIT |
| `devlop` | `1.1.0` | MIT |
| `diff` | `8.0.4` | BSD-3-Clause |
| `dom-serializer` | `2.0.0` | MIT |
| `domelementtype` | `2.3.0` | BSD-2-Clause |
| `domhandler` | `5.0.3` | BSD-2-Clause |
| `dompurify` | `3.3.3` | (MPL-2.0 OR Apache-2.0) |
| `domutils` | `3.2.2` | BSD-2-Clause |
| `dset` | `3.1.4` | MIT |
| `elkjs` | `0.11.0` | EPL-2.0 |
| `entities` | `4.5.0, 6.0.1` | BSD-2-Clause |
| `error-stack-parser-es` | `1.0.5` | MIT |
| `es-module-lexer` | `2.3.1` | MIT |
| `esbuild` | `0.28.1` | MIT |
| `escape-string-regexp` | `5.0.0` | MIT |
| `estree-walker` | `2.0.2` | MIT |
| `eventemitter3` | `5.0.4` | MIT |
| `extend` | `3.0.2` | MIT |
| `fast-string-truncated-width` | `3.0.3` | MIT |
| `fast-string-width` | `3.0.2` | MIT |
| `fast-wrap-ansi` | `0.2.2` | MIT |
| `fdir` | `6.5.0` | MIT |
| `find-replace` | `5.0.2` | MIT |
| `flatbuffers` | `25.9.23` | Apache-2.0 |
| `flattie` | `1.1.1` | MIT |
| `fontace` | `0.4.1` | MIT |
| `fontkitten` | `1.0.3` | MIT |
| `get-tsconfig` | `5.0.0-beta.4` | MIT |
| `github-slugger` | `2.0.0` | ISC |
| `h3` | `1.15.11` | MIT |
| `hachure-fill` | `0.5.2` | MIT |
| `has-flag` | `4.0.0` | MIT |
| `hast-util-from-dom` | `5.0.1` | ISC |
| `hast-util-from-html` | `2.0.3` | MIT |
| `hast-util-from-html-isomorphic` | `2.0.0` | MIT |
| `hast-util-from-parse5` | `8.0.3` | MIT |
| `hast-util-is-element` | `3.0.0` | MIT |
| `hast-util-parse-selector` | `4.0.0` | MIT |
| `hast-util-raw` | `9.1.0` | MIT |
| `hast-util-to-html` | `9.0.5` | MIT |
| `hast-util-to-parse5` | `8.0.1` | MIT |
| `hast-util-to-text` | `4.0.2` | MIT |
| `hast-util-whitespace` | `3.0.0` | MIT |
| `hastscript` | `9.0.1` | MIT |
| `hono` | `4.12.34` | MIT |
| `html-escaper` | `3.0.3` | MIT |
| `html-to-image` | `1.11.13` | MIT |
| `html-void-elements` | `3.0.0` | MIT |
| `http-cache-semantics` | `4.2.0` | BSD-2-Clause |
| `iceberg-js` | `0.8.0` | MIT |
| `iconv-lite` | `0.6.3` | MIT |
| `internmap` | `1.0.1, 2.0.3` | ISC |
| `iron-webcrypto` | `1.2.1` | MIT |
| `is-docker` | `4.0.0` | MIT |
| `is-plain-obj` | `4.1.0` | MIT |
| `jiti` | `2.7.0` | MIT |
| `jose` | `6.1.2` | MIT |
| `js-yaml` | `4.3.0` | MIT |
| `json-bignum` | `0.0.3` | MIT |
| `jsonc-parser` | `3.3.1` | MIT |
| `katex` | `0.16.44` | MIT |
| `khroma` | `2.1.0` | MIT |
| `kleur` | `4.1.5` | MIT |
| `langium` | `3.3.1` | MIT |
| `layout-base` | `1.0.2, 2.0.1` | MIT |
| `lightningcss` | `1.33.0` | MPL-2.0 |
| `lightningcss-win32-x64-msvc` | `1.33.0` | MPL-2.0 |
| `lodash-es` | `4.17.23` | MIT |
| `lodash.camelcase` | `4.3.0` | MIT |
| `longest-streak` | `3.1.0` | MIT |
| `lru-cache` | `11.5.2` | BlueOak-1.0.0 |
| `magic-string` | `0.30.21` | MIT |
| `magicast` | `0.5.3` | MIT |
| `markdown-table` | `3.0.4` | MIT |
| `marked` | `16.4.2` | MIT |
| `mdast-util-definitions` | `6.0.0` | MIT |
| `mdast-util-find-and-replace` | `3.0.2` | MIT |
| `mdast-util-from-markdown` | `2.0.2` | MIT |
| `mdast-util-gfm` | `3.1.0` | MIT |
| `mdast-util-gfm-autolink-literal` | `2.0.1` | MIT |
| `mdast-util-gfm-footnote` | `2.1.0` | MIT |
| `mdast-util-gfm-strikethrough` | `2.0.0` | MIT |
| `mdast-util-gfm-table` | `2.0.0` | MIT |
| `mdast-util-gfm-task-list-item` | `2.0.0` | MIT |
| `mdast-util-math` | `3.0.0` | MIT |
| `mdast-util-phrasing` | `4.1.0` | MIT |
| `mdast-util-to-hast` | `13.2.1` | MIT |
| `mdast-util-to-markdown` | `2.1.2` | MIT |
| `mdast-util-to-string` | `4.0.0` | MIT |
| `mdn-data` | `2.0.28, 2.27.1` | CC0-1.0 |
| `mermaid` | `11.12.2` | MIT |
| `mermaid-isomorphic` | `3.0.4` | MIT |
| `micromark` | `4.0.2` | MIT |
| `micromark-core-commonmark` | `2.0.3` | MIT |
| `micromark-extension-gfm` | `3.0.0` | MIT |
| `micromark-extension-gfm-autolink-literal` | `2.1.0` | MIT |
| `micromark-extension-gfm-footnote` | `2.1.0` | MIT |
| `micromark-extension-gfm-strikethrough` | `2.1.0` | MIT |
| `micromark-extension-gfm-table` | `2.1.1` | MIT |
| `micromark-extension-gfm-tagfilter` | `2.0.0` | MIT |
| `micromark-extension-gfm-task-list-item` | `2.1.0` | MIT |
| `micromark-extension-math` | `3.1.0` | MIT |
| `micromark-factory-destination` | `2.0.1` | MIT |
| `micromark-factory-label` | `2.0.1` | MIT |
| `micromark-factory-space` | `2.0.1` | MIT |
| `micromark-factory-title` | `2.0.1` | MIT |
| `micromark-factory-whitespace` | `2.0.1` | MIT |
| `micromark-util-character` | `2.1.1` | MIT |
| `micromark-util-chunked` | `2.0.1` | MIT |
| `micromark-util-classify-character` | `2.0.1` | MIT |
| `micromark-util-combine-extensions` | `2.0.1` | MIT |
| `micromark-util-decode-numeric-character-reference` | `2.0.2` | MIT |
| `micromark-util-decode-string` | `2.0.1` | MIT |
| `micromark-util-encode` | `2.0.1` | MIT |
| `micromark-util-html-tag-name` | `2.0.1` | MIT |
| `micromark-util-normalize-identifier` | `2.0.1` | MIT |
| `micromark-util-resolve-all` | `2.0.1` | MIT |
| `micromark-util-sanitize-uri` | `2.0.1` | MIT |
| `micromark-util-subtokenize` | `2.1.0` | MIT |
| `micromark-util-symbol` | `2.0.1` | MIT |
| `micromark-util-types` | `2.0.2` | MIT |
| `mini-svg-data-uri` | `1.4.4` | MIT |
| `miniflare` | `4.20260722.0` | MIT |
| `mlly` | `1.8.0` | MIT |
| `mrmime` | `2.0.1` | MIT |
| `ms` | `2.1.3` | MIT |
| `nanoid` | `3.3.18` | MIT |
| `nanostores` | `1.1.0` | MIT |
| `neotraverse` | `1.0.1` | MIT |
| `nlcst-to-string` | `4.0.0` | MIT |
| `node-fetch-native` | `1.6.7` | MIT |
| `node-mock-http` | `1.0.4` | MIT |
| `normalize-path` | `3.0.0` | MIT |
| `nth-check` | `2.1.1` | BSD-2-Clause |
| `obug` | `2.1.4` | MIT |
| `ofetch` | `1.5.1` | MIT |
| `ohash` | `2.0.11` | MIT |
| `oniguruma-parser` | `0.12.2` | MIT |
| `oniguruma-to-es` | `4.3.6` | MIT |
| `p-limit` | `7.3.1` | MIT |
| `p-queue` | `9.3.3` | MIT |
| `p-timeout` | `7.0.1` | MIT |
| `package-manager-detector` | `1.8.0` | MIT |
| `parse-latin` | `7.0.0` | MIT |
| `parse5` | `7.3.0` | MIT |
| `path-data-parser` | `0.1.0` | MIT |
| `path-to-regexp` | `6.3.0` | MIT |
| `pathe` | `2.0.3` | MIT |
| `piccolore` | `0.1.3` | ISC |
| `picocolors` | `1.1.1` | ISC |
| `picomatch` | `2.3.2, 4.0.4, 4.0.5` | MIT |
| `pkg-types` | `1.3.1` | MIT |
| `playwright` | `1.57.0` | Apache-2.0 |
| `playwright-core` | `1.57.0` | Apache-2.0 |
| `points-on-curve` | `0.2.0` | MIT |
| `points-on-path` | `0.2.1` | MIT |
| `postcss` | `8.5.26` | MIT |
| `prismjs` | `1.30.0` | MIT |
| `process-ancestry` | `0.1.0` | MIT |
| `property-information` | `7.1.0, 7.2.0` | MIT |
| `radix3` | `1.1.2` | MIT |
| `react` | `19.2.0` | MIT |
| `react-chartjs-2` | `5.3.1` | MIT |
| `react-dom` | `19.2.0` | MIT |
| `react-virtuoso` | `4.15.0` | MIT |
| `readdirp` | `5.0.0` | MIT |
| `regex` | `6.1.0` | MIT |
| `regex-recursion` | `6.0.2` | MIT |
| `regex-utilities` | `2.3.0` | MIT |
| `rehype-katex` | `7.0.1` | MIT |
| `rehype-mermaid` | `3.0.0` | MIT |
| `rehype-raw` | `7.0.0` | MIT |
| `rehype-stringify` | `10.0.1` | MIT |
| `remark-gfm` | `4.0.1` | MIT |
| `remark-math` | `6.0.0` | MIT |
| `remark-parse` | `11.0.0` | MIT |
| `remark-rehype` | `11.1.2` | MIT |
| `remark-smartypants` | `3.0.2` | MIT |
| `remark-stringify` | `11.0.0` | MIT |
| `resolve-pkg-maps` | `1.0.0` | MIT |
| `retext` | `9.0.0` | MIT |
| `retext-latin` | `4.0.0` | MIT |
| `retext-smartypants` | `6.2.0` | MIT |
| `retext-stringify` | `4.0.0` | MIT |
| `robust-predicates` | `3.0.2` | Unlicense |
| `rolldown` | `1.1.5` | MIT |
| `rollup` | `4.62.2` | MIT |
| `roughjs` | `4.6.6` | MIT |
| `rw` | `1.3.3` | BSD-3-Clause |
| `safer-buffer` | `2.1.2` | MIT |
| `satteri` | `0.9.5` | MIT |
| `sax` | `1.6.0` | BlueOak-1.0.0 |
| `scheduler` | `0.27.0` | MIT |
| `semver` | `7.8.5` | ISC |
| `seroval` | `1.5.1` | MIT |
| `seroval-plugins` | `1.5.6` | MIT |
| `sharp` | `0.35.2, 0.35.3` | Apache-2.0 |
| `shiki` | `4.3.1` | MIT |
| `sisteransi` | `1.0.5` | MIT |
| `smol-toml` | `1.7.0` | BSD-3-Clause |
| `solid-chartjs` | `1.3.11` | MIT |
| `solid-js` | `1.9.14` | MIT |
| `source-map` | `0.6.1` | BSD-3-Clause |
| `source-map-js` | `1.2.1` | BSD-3-Clause |
| `source-map-support` | `0.5.21` | MIT |
| `space-separated-tokens` | `2.0.2` | MIT |
| `stringify-entities` | `4.0.4` | MIT |
| `stylis` | `4.3.6` | MIT |
| `supports-color` | `7.2.0, 10.2.2` | MIT |
| `svgo` | `4.0.2` | MIT |
| `table-layout` | `4.1.1` | MIT |
| `terser` | `5.50.0` | BSD-2-Clause |
| `tiny-inflate` | `1.0.3` | MIT |
| `tinyclip` | `0.1.15` | MIT |
| `tinyexec` | `1.2.4` | MIT |
| `tinyglobby` | `0.2.17` | MIT |
| `trim-lines` | `3.0.1` | MIT |
| `trough` | `2.2.0` | MIT |
| `ts-dedent` | `2.2.0` | MIT |
| `tslib` | `2.8.1` | 0BSD |
| `typical` | `7.3.0` | MIT |
| `ufo` | `1.6.4` | MIT |
| `ultrahtml` | `1.7.0` | MIT |
| `uncrypto` | `0.1.3` | MIT |
| `undici` | `7.28.0` | MIT |
| `undici-types` | `6.21.0, 8.3.0` | MIT |
| `unenv` | `2.0.0-rc.24` | MIT |
| `unified` | `11.0.5` | MIT |
| `unifont` | `0.7.4` | MIT |
| `unist-util-find-after` | `5.0.0` | MIT |
| `unist-util-is` | `6.0.1` | MIT |
| `unist-util-modify-children` | `4.0.0` | MIT |
| `unist-util-position` | `5.0.0` | MIT |
| `unist-util-remove-position` | `5.0.0` | MIT |
| `unist-util-stringify-position` | `4.0.0` | MIT |
| `unist-util-visit` | `5.1.0` | MIT |
| `unist-util-visit-children` | `3.0.0` | MIT |
| `unist-util-visit-parents` | `6.0.2` | MIT |
| `unstorage` | `1.17.5` | MIT |
| `use-sync-external-store` | `1.6.0` | MIT |
| `uuid` | `11.1.1` | MIT |
| `vfile` | `6.0.3` | MIT |
| `vfile-location` | `5.0.3` | MIT |
| `vfile-message` | `4.0.3` | MIT |
| `virtua` | `0.41.5` | MIT |
| `vite` | `8.1.5` | MIT |
| `vitefu` | `1.1.3` | MIT |
| `vscode-jsonrpc` | `8.2.0` | MIT |
| `vscode-languageserver` | `9.0.1` | MIT |
| `vscode-languageserver-protocol` | `3.17.5` | MIT |
| `vscode-languageserver-textdocument` | `1.0.12` | MIT |
| `vscode-languageserver-types` | `3.17.5` | MIT |
| `vscode-uri` | `3.0.8` | MIT |
| `web-namespaces` | `2.0.1` | MIT |
| `wordwrapjs` | `5.1.1` | MIT |
| `workerd` | `1.20260722.1` | Apache-2.0 |
| `wrangler` | `4.114.0` | MIT OR Apache-2.0 |
| `ws` | `8.21.0, 8.21.1` | MIT |
| `xxhash-wasm` | `1.1.0` | MIT |
| `yaml` | `2.8.3` | ISC |
| `yargs-parser` | `22.0.0` | ISC |
| `yocto-queue` | `1.2.2` | MIT |
| `youch` | `4.1.0-beta.10` | MIT |
| `youch-core` | `0.3.3` | MIT |
| `zod` | `3.25.76, 4.4.3` | MIT |
| `zustand` | `4.5.7` | MIT |
| `zwitch` | `2.0.4` | MIT |

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
<summary><strong>Eclipse Public License 2.0 (EPL-2.0)</strong></summary>

```text
Eclipse Public License - v 2.0

    THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE
    PUBLIC LICENSE ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION
    OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.

1. DEFINITIONS
"Contribution" means:
  a) in the case of the initial Contributor, the initial content Distributed under this Agreement, and
  b) in the case of each subsequent Contributor:
     i) changes to the Program, and
     ii) additions to the Program;
"Program" means the Contributions Distributed in accordance with this Agreement.

2. GRANT OF RIGHTS
a) Subject to the terms of this Agreement, each Contributor hereby grants Recipient a non-exclusive,
   worldwide, royalty-free copyright license to reproduce, prepare Derivative Works of, publicly display,
   publicly perform, Distribute and sublicense the Contribution of such Contributor, if any, and such
   Derivative Works, in Source Code and other form.

3. REQUIREMENTS
When the Program is Distributed in Source Code Form:
  a) it must be made available under this Agreement; and
  b) a copy of this Agreement must be included with each copy of the Program.

(For complete license text, visit https://www.eclipse.org/legal/epl-2.0/)
```

</details>

<details>
<summary><strong>SIL Open Font License 1.1 (OFL-1.1)</strong></summary>

```text
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:
1) Neither the Font Software nor any of its individual components,
in Source or Binary forms, may be sold by itself.
2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license.

(For complete license text, visit http://scripts.sil.org/OFL)
```

</details>

<details>
<summary><strong>Creative Commons Attribution 4.0 International (CC BY 4.0)</strong></summary>

```text
You are free to:
- Share — copy and redistribute the material in any medium or format for any purpose, even commercially.
- Adapt — remix, transform, and build upon the material for any purpose, even commercially.

Under the following terms:
- Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made. You may do so in any reasonable manner, but not in any way that suggests the licensor endorses you or your use.

(For complete deed and legal code, visit https://creativecommons.org/licenses/by/4.0/)
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

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED.
```

</details>
