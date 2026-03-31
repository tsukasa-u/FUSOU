#!/usr/bin/env node

/**
 * docs/contents/licenses/THIRD_PARTY_NOTICES.md を生成するスクリプト。
 * FOSSA CLI（fossa report attribution）を使って Rust・JS/TS 両方のライセンスを取得します。
 *
 * 前提条件:
 *   - FOSSA CLI がインストールされていること: https://github.com/fossas/fossa-cli
 *   - FOSSA_API_KEY 環境変数が設定されていること
 *
 * CI では .github/workflows/license_scanning.yml が自動実行します。
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const OUTPUT_DIR = path.join(__dirname, "..", "docs", "contents", "licenses");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "THIRD_PARTY_NOTICES.md");

function main() {
  if (!process.env.FOSSA_API_KEY) {
    console.error("✗ FOSSA_API_KEY 環境変数が設定されていません。");
    console.error(
      "  https://app.fossa.com/account/settings/integrations/api_tokens でAPIキーを取得してください。",
    );
    process.exit(1);
  }

  console.log("Generating license notices via FOSSA...\n");

  const date = new Date().toISOString().split("T")[0];
  const frontmatter = `---
title: Third Party Notices
description: License information for dependencies used in FUSOU
contributors: ["fossa-bot"]
date: ${date}
slug: licenses/third-party-notices
tags: [licenses, notices]
---

`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const attribution = execSync("fossa report attribution --format markdown", {
    encoding: "utf8",
  });

  fs.writeFileSync(OUTPUT_FILE, frontmatter + attribution, "utf8");
  console.log(`✓ Generated ${OUTPUT_FILE}`);
}

main();
