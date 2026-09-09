import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const isCheckMode = process.argv.includes("--check");

const docsLicenseDir = path.join(repoRoot, "docs/contents/license");
if (!fs.existsSync(docsLicenseDir)) {
  fs.mkdirSync(docsLicenseDir, { recursive: true });
}

console.log("[license-generator] Gathering FUSOU-APP npm production dependencies...");
const appNpmRaw = execSync("pnpm licenses ls --prod --filter fusou-app --json", {
  cwd: repoRoot,
  maxBuffer: 50 * 1024 * 1024,
}).toString();
const appNpmData = JSON.parse(appNpmRaw);
const appNpmList = [];
for (const [lic, pkgs] of Object.entries(appNpmData)) {
  for (const p of pkgs) {
    let finalLic = lic;
    if (p.name === "khroma") finalLic = "MIT";
    appNpmList.push({ name: p.name, versions: p.versions.join(", "), license: finalLic });
  }
}
appNpmList.sort((a, b) => a.name.localeCompare(b.name));

console.log("[license-generator] Gathering FUSOU-APP Rust crate dependencies...");
const tauriManifest = path.join(repoRoot, "packages/FUSOU-APP/src-tauri/Cargo.toml");
const cargoMetaRaw = execSync(`cargo metadata --format-version 1 --manifest-path "${tauriManifest}"`, {
  maxBuffer: 50 * 1024 * 1024,
}).toString();
const cargoMeta = JSON.parse(cargoMetaRaw);

const rootPkg = cargoMeta.packages.find((p) => p.name === "app");
const resolveNodes = new Map(cargoMeta.resolve.nodes.map((n) => [n.id, n]));
const visitedPkgIds = new Set();
function visit(pkgId) {
  if (visitedPkgIds.has(pkgId)) return;
  visitedPkgIds.add(pkgId);
  const node = resolveNodes.get(pkgId);
  if (!node) return;
  for (const dep of node.deps) {
    const hasNonDev = dep.dep_kinds.some((k) => k.kind === null || k.kind === "build");
    if (hasNonDev) visit(dep.pkg);
  }
}
visit(rootPkg.id);

const pkgsMap = new Map(cargoMeta.packages.map((p) => [p.id, p]));
const appRustDeps = [];
for (const id of visitedPkgIds) {
  const p = pkgsMap.get(id);
  if (p && p.name !== "app") {
    let lic = p.license;
    if (!lic && p.license_file) lic = `Custom (${p.license_file})`;
    else if (!lic) lic = "Unknown";
    appRustDeps.push({
      name: p.name,
      version: p.version,
      license: lic,
      repository: p.repository || "",
    });
  }
}
appRustDeps.sort((a, b) => a.name.localeCompare(b.name));

console.log(`[license-generator] FUSOU-APP: ${appNpmList.length} npm packages, ${appRustDeps.length} Rust crates.`);

console.log("[license-generator] Gathering FUSOU-WEB npm production dependencies...");
const webNpmRaw = execSync("pnpm licenses ls --prod --filter fusou-web --json", {
  cwd: repoRoot,
  maxBuffer: 50 * 1024 * 1024,
}).toString();
const webNpmData = JSON.parse(webNpmRaw);
const webNpmList = [];
for (const [lic, pkgs] of Object.entries(webNpmData)) {
  for (const p of pkgs) {
    let finalLic = lic;
    if (p.name === "khroma") finalLic = "MIT";
    webNpmList.push({ name: p.name, versions: p.versions.join(", "), license: finalLic });
  }
}
webNpmList.sort((a, b) => a.name.localeCompare(b.name));
console.log(`[license-generator] FUSOU-WEB: ${webNpmList.length} npm packages.`);

const fusouMitText = `MIT License

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
SOFTWARE.`;

// Build fusou_app.md
const appMd = `---
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

\`\`\`text
${fusouMitText}
\`\`\`

---

## 2. 配布構成とライセンス表記方針

FUSOU-APP は **Tauri v2** を採用したデスクトップアプリケーションです。ユーザー環境に配布されるバイナリには以下が含まれます：

1. **Rust ネイティブバックエンド**: プロキシ通信の傍受・復号、艦これAPIレスポンスのパース、ローカルSQLite/DuckDBへの保存、暗号化処理、OSネイティブ通知、自動更新機能などを担当します（計 ${appRustDeps.length} クレート）。
2. **Webview フロントエンド**: SolidJS で構築されたUIコンポーネントであり、Tauri の WebView2（Windows）上で実行されます（計 ${appNpmList.length} パッケージ）。

配布されるプログラムは、すべての依存関係において **パーミッシブなライセンス（MIT, Apache-2.0, BSD, ISC, Zlib 等）** または **ファイル単位の弱コピーレフトライセンス（MPL-2.0）** を採用しており、GPL/AGPL 等の強コピーレフトライセンスの混入はありません。

---

## 3. 特記すべきライブラリと告知事項

### Mozilla Public License 2.0 (MPL-2.0)
FUSOU-APP のバックエンドでは、CSSパーサー等の補助機能として以下のクレートを利用しています：
- \`cssparser\`, \`cssparser-macros\`, \`selectors\` (Mozilla / Servo プロジェクト)
- \`dtoa-short\`, \`option-ext\`

> [!NOTE]
> **MPL-2.0（弱コピーレフト）に関する告知**  
> これらのクレートは Mozilla Public License 2.0 (MPL-2.0) のもとで許諾されています。FUSOU-APP はこれらのクレートのソースコード自体を一切改変せずにライブラリとして静的リンク・利用しており、MPL-2.0 Section 3.3（Larger Work）の条項に完全に適合しています。各クレートのオリジナルソースコードは [https://github.com/servo/rust-cssparser](https://github.com/servo/rust-cssparser) 等のリポジトリより入手可能です。

### r-efi (トリプルライセンス)
- \`r-efi\`: \`MIT OR Apache-2.0 OR LGPL-2.1-or-later\`

> [!NOTE]
> **適用ライセンスの選択**  
> \`r-efi\` はトリプルライセンスで提供されています。FUSOU-APP では MIT License を選択して適用しています。

---

## 4. フロントエンド依存ライブラリ一覧 (${appNpmList.length} パッケージ)

配布バイナリのUI（WebView）に同梱される npm 本番依存パッケージです：

| パッケージ名 | バージョン | ライセンス |
| :--- | :--- | :--- |
${appNpmList.map((p) => `| \`${p.name}\` | \`${p.versions}\` | ${p.license} |`).join("\n")}

---

## 5. バックエンド Rust クレート一覧 (${appRustDeps.length} クレート)

FUSOU-APP のネイティブバイナリにコンパイル・静的リンクされるクレートの一覧です。

<details>
<summary><strong>Rust クレート全一覧を展開する (クリックして表示)</strong></summary>

| クレート名 | バージョン | ライセンス | リポジトリ |
| :--- | :--- | :--- | :--- |
${appRustDeps.map((c) => `| \`${c.name}\` | \`${c.version}\` | ${c.license} | ${c.repository ? `[リンク](${c.repository})` : "-"} |`).join("\n")}

</details>

---

## 6. 各ライセンスの全文 (License Texts)

<details>
<summary><strong>MIT License</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>Apache License, Version 2.0</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>Mozilla Public License Version 2.0 (MPL-2.0)</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>BSD 2-Clause & BSD 3-Clause License</strong></summary>

\`\`\`text
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
\`\`\`

</details>
`;

const directDeps = [
  { name: "solid-js", category: "UI Framework", license: "MIT" },
  { name: "astro", category: "Web Framework", license: "MIT" },
  { name: "@astrojs/cloudflare", category: "SSR Runtime Adapter", license: "MIT" },
  { name: "elkjs", category: "Graph Layout Engine", license: "EPL-2.0" },
  { name: "rehype-mermaid", category: "Diagram Rendering", license: "MIT" },
  { name: "chart.js", category: "Chart Visualization", license: "MIT" },
  { name: "solid-chartjs", category: "Solid Chart Integration", license: "MIT" },
  { name: "@supabase/supabase-js", category: "Database Client", license: "MIT" },
  { name: "hono", category: "Server API Router", license: "MIT" },
  { name: "zod", category: "Schema Validation", license: "MIT" },
  { name: "apache-arrow", category: "Columnar Data Processing", license: "Apache-2.0" },
  { name: "katex", category: "Math Formatting", license: "MIT" },
  { name: "virtua", category: "Virtual List Scrolling", license: "MIT" },
  { name: "daisyui", category: "UI Component System", license: "MIT" },
  { name: "tailwindcss", category: "CSS Utility Framework", license: "MIT" },
  { name: "@fortawesome/fontawesome-free", category: "Icon Assets", license: "CC-BY-4.0 / OFL-1.1 / MIT" },
];

const webMd = `---
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

\`\`\`text
${fusouMitText}
\`\`\`

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
> \`elkjs\` は Eclipse Foundation の Eclipse Public License 2.0 のもとで提供されています。FUSOU-WEB は \`elkjs\` のライブラリソースコードを変更することなくそのままバンドル・呼び出し利用しています。ソースコードは [https://github.com/kieler/elkjs](https://github.com/kieler/elkjs) から入手可能です。

### Font Awesome Free
- **用途**: UIアイコンアセット (\`@fortawesome/fontawesome-free\`)

> [!NOTE]
> **アセット別ライセンス区分**  
> \`@fortawesome/fontawesome-free\` は構成要素ごとに異なるライセンスが適用されています：
> - **Icons**: [CC BY 4.0 License](https://creativecommons.org/licenses/by/4.0/)
> - **Fonts**: [SIL OFL 1.1 License](http://scripts.sil.org/OFL)
> - **Code**: [MIT License](https://opensource.org/licenses/MIT)

### khroma (MIT)
- **用途**: Mermaid のカラー計算補助ライブラリ

> [!NOTE]
> **ライセンス補足**  
> \`khroma\` は \`package.json\` 上のライセンス表記が未定義となっていますが、同梱のライセンスファイルに基づき MIT License（Fabio Spampinato, Andrew Maney）が適用されます。

---

## 4. 主要ライブラリ一覧

| ライブラリ名 | 分類・役割 | ライセンス |
| :--- | :--- | :--- |
${directDeps.map((d) => `| \`${d.name}\` | ${d.category} | ${d.license} |`).join("\n")}

---

## 5. 全本番依存パッケージ一覧 (${webNpmList.length} パッケージ)

FUSOU-WEB の本番環境（クライアント配信バンドルおよびエッジワーカー）に含まれるすべての依存パッケージ一覧です。

<details>
<summary><strong>全 ${webNpmList.length} パッケージの一覧を展開する (クリックして表示)</strong></summary>

| パッケージ名 | バージョン | ライセンス |
| :--- | :--- | :--- |
${webNpmList.map((p) => `| \`${p.name}\` | \`${p.versions}\` | ${p.license} |`).join("\n")}

</details>

---

## 6. 各ライセンスの全文 (License Texts)

<details>
<summary><strong>MIT License</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>Apache License, Version 2.0</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>Eclipse Public License 2.0 (EPL-2.0)</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>SIL Open Font License 1.1 (OFL-1.1)</strong></summary>

\`\`\`text
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
\`\`\`

</details>

<details>
<summary><strong>Creative Commons Attribution 4.0 International (CC BY 4.0)</strong></summary>

\`\`\`text
You are free to:
- Share — copy and redistribute the material in any medium or format for any purpose, even commercially.
- Adapt — remix, transform, and build upon the material for any purpose, even commercially.

Under the following terms:
- Attribution — You must give appropriate credit, provide a link to the license, and indicate if changes were made. You may do so in any reasonable manner, but not in any way that suggests the licensor endorses you or your use.

(For complete deed and legal code, visit https://creativecommons.org/licenses/by/4.0/)
\`\`\`

</details>

<details>
<summary><strong>BSD 2-Clause & BSD 3-Clause License</strong></summary>

\`\`\`text
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
\`\`\`

</details>
`;

const appPath = path.join(docsLicenseDir, "fusou_app.md");
const webPath = path.join(docsLicenseDir, "fusou_web.md");

if (isCheckMode) {
  let isDiff = false;
  if (!fs.existsSync(appPath) || fs.readFileSync(appPath, "utf8") !== appMd) {
    console.error("[license-generator] ERROR: docs/contents/license/fusou_app.md is out of date!");
    isDiff = true;
  }
  if (!fs.existsSync(webPath) || fs.readFileSync(webPath, "utf8") !== webMd) {
    console.error("[license-generator] ERROR: docs/contents/license/fusou_web.md is out of date!");
    isDiff = true;
  }
  if (isDiff) {
    console.error("[license-generator] Run 'pnpm run license:generate' to update license docs.");
    process.exit(1);
  }
  console.log("[license-generator] All license docs are up to date.");
} else {
  fs.writeFileSync(appPath, appMd, "utf8");
  console.log(`[license-generator] Wrote: ${appPath}`);
  fs.writeFileSync(webPath, webMd, "utf8");
  console.log(`[license-generator] Wrote: ${webPath}`);
  console.log("[license-generator] Successfully updated license docs!");
}
