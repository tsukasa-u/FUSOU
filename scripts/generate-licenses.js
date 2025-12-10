#!/usr/bin/env node

/**
 * Rust と JavaScript/TypeScript のライセンス情報を結合して
 * docs/contents/licenses/THIRD_PARTY_NOTICES.md を生成する統合スクリプト
 * Astro フロントマター形式で出力
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 中間生成物は Astro content 監視対象外の隠しディレクトリに退避
const TEMP_DIR = path.join(__dirname, "..", ".license-tmp");
const OUTPUT_DIR = path.join(__dirname, "..", "docs", "contents", "licenses");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "THIRD_PARTY_NOTICES.md");
const RUST_TEMP = path.join(TEMP_DIR, "rust-licenses.md");
const JS_TEMP = path.join(TEMP_DIR, "js-licenses.md");

async function main() {
  try {
    console.log("Generating license notices...\n");

    // 1. 出力ディレクトリ & 一時ディレクトリを作成
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`✓ Created directory: ${OUTPUT_DIR}`);
    }
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
      console.log(`✓ Created temp directory: ${TEMP_DIR}`);
    }

    // 2. Rust ライセンス情報を生成
    console.log("Generating Rust licenses...");
    generateRustLicenses(RUST_TEMP);
    console.log(`✓ Generated Rust licenses: ${RUST_TEMP}`);

    // 3. JS/TS ライセンス情報を生成
    console.log("Generating JavaScript/TypeScript licenses...");
    generateJSLicenses(JS_TEMP);
    console.log(`✓ Generated JS/TS licenses: ${JS_TEMP}`);

    // 4. 両方を結合して最終ファイルを生成
    console.log("Combining license notices...");
    const frontmatter = generateFrontmatter();
    const rustContent = fs.readFileSync(RUST_TEMP, "utf8");
    const jsContent = fs.readFileSync(JS_TEMP, "utf8");

    const finalContent = `${frontmatter}\n\n${rustContent}\n\n${jsContent}`;
    fs.writeFileSync(OUTPUT_FILE, finalContent, "utf8");
    console.log(`✓ Generated final license file: ${OUTPUT_FILE}`);

    // 5. 一時ファイルを削除
    fs.unlinkSync(RUST_TEMP);
    fs.unlinkSync(JS_TEMP);
    // TEMP_DIR が空なら削除（監視対象外なので安全）
    try {
      const remaining = fs.readdirSync(TEMP_DIR);
      if (remaining.length === 0) {
        fs.rmdirSync(TEMP_DIR);
      }
    } catch (_) {
      // 片付け失敗は致命的でないので無視
    }
    console.log("✓ Cleaned up temporary files");

    console.log("\n✓ License generation completed successfully!");
  } catch (err) {
    console.error("✗ Error generating licenses:", err.message);
    process.exit(1);
  }
}

function generateFrontmatter() {
  const date = new Date().toISOString().split("T")[0];
  return `---
title: Third Party Notices
description: License information for Rust and JavaScript/TypeScript dependencies used in FUSOU
contributors: ["github-copilot"]
date: ${date}
slug: licenses/third-party-notices
tags: [licenses, notices]
---

# Third Party Notices

This document contains notices and information for third-party software required by various open source licenses.

**Generated:** ${date}

## Overview

This software incorporates open source components from both Rust (via Cargo) and JavaScript/TypeScript (via npm/pnpm) ecosystems. Below is information about each dependency, including license information and source repository links.`;
}

function generateRustLicenses(outputPath) {
  try {
    // cargo-about が installed されていることを確認
    execSync("cargo about --version", { stdio: "pipe" });

    // about.hbs テンプレートのパスを取得
    const templatePath = path.join(__dirname, "..", "about.hbs");

    if (!fs.existsSync(templatePath)) {
      console.warn("⚠ about.hbs not found, skipping Rust licenses");
      fs.writeFileSync(
        outputPath,
        "## Rust Dependencies\n\nRust license information is not available.",
        "utf8"
      );
      return;
    }

    // cargo about を実行し、出力ファイルに直接書き込む
    const repoRoot = path.join(__dirname, "..");
    const manifestPath = path.join(
      repoRoot,
      "packages",
      "FUSOU-APP",
      "src-tauri",
      "Cargo.toml"
    );
    const configPath = path.join(repoRoot, ".cargo", "about.toml");
    const tempRustFile = path.join(TEMP_DIR, "temp-rust.md");
    try {
      execSync(
        `cargo about generate --manifest-path "${manifestPath}" --config "${configPath}" "${templatePath}" -o "${tempRustFile}"`,
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      // Check if output file exists and has content
      if (!fs.existsSync(tempRustFile)) {
        throw new Error("cargo-about did not generate output file");
      }

      const output = fs.readFileSync(tempRustFile, "utf8");

      // If output is too short, it likely only contains the header
      if (output.length < 200) {
        throw new Error(
          "cargo-about output is suspiciously short - likely error occurred"
        );
      }

      fs.writeFileSync(outputPath, output, "utf8");
      fs.unlinkSync(tempRustFile);
    } catch (cargoErr) {
      // Fallback: Generate from cargo metadata
      console.log(
        "  (cargo-about encountered error, using cargo metadata fallback...)"
      );
      try {
        execSync(
          `cargo metadata --manifest-path "${manifestPath}" --format-version 1 > "${path.join(
            TEMP_DIR,
            "metadata.json"
          )}"`,
          { cwd: repoRoot, shell: true }
        );
        const metadataJson = fs.readFileSync(
          path.join(TEMP_DIR, "metadata.json"),
          "utf8"
        );
        const metadata = JSON.parse(metadataJson);

        const licenses = new Map();

        // Collect all unique licenses from packages
        metadata.packages.forEach((pkg) => {
          if (pkg.name && pkg.version && pkg.license) {
            const key = pkg.license;
            if (!licenses.has(key)) {
              licenses.set(key, []);
            }
            licenses.get(key).push(`${pkg.name} ${pkg.version}`);
          }
        });

        // Generate markdown
        let markdown = "## Rust Dependencies\n\n";
        markdown += "This project uses the following Rust packages:\n\n";

        if (licenses.size === 0) {
          markdown += "No license information found in Cargo metadata.\n";
        } else {
          const licenseTitles = {
            MIT: "MIT License",
            "Apache-2.0": "Apache License 2.0",
            "MIT OR Apache-2.0": "MIT OR Apache-2.0",
            ISC: "ISC License",
            "BSD-2-Clause": "BSD 2-Clause License",
            "BSD-3-Clause": "BSD 3-Clause License",
          };

          const sortedLicenses = Array.from(licenses.entries()).sort((a, b) =>
            a[0].localeCompare(b[0])
          );

          for (const [license, crates] of sortedLicenses) {
            const title = licenseTitles[license] || license;
            markdown += `### ${title}\n\n`;
            markdown += crates
              .sort()
              .map((c) => `- ${c}`)
              .join("\n");
            markdown += "\n\n";
          }
        }

        fs.writeFileSync(outputPath, markdown, "utf8");
      } catch (metadataErr) {
        console.log(`  (metadata extraction failed: ${metadataErr.message})`);
        fs.writeFileSync(
          outputPath,
          "## Rust Dependencies\n\nRust license information is temporarily unavailable.",
          "utf8"
        );
      }
    }
  } catch (err) {
    console.warn("⚠ Warning: Failed to generate Rust licenses:", err.message);
    fs.writeFileSync(
      outputPath,
      "## Rust Dependencies\n\nRust license generation was skipped. cargo-about is not installed or about.hbs is not found.",
      "utf8"
    );
  }
}

function generateJSLicenses(outputPath) {
  try {
    const genScript = path.join(__dirname, "gen-license-md.js");
    let allMarkdown = "## JavaScript/TypeScript Dependencies\n\n";
    allMarkdown +=
      "This software uses the following JavaScript and TypeScript packages:\n\n";

    // FUSOU-WEB のライセンス情報を収集
    try {
      console.log("  Collecting FUSOU-WEB JS/TS licenses...");
      const webDir = path.join(__dirname, "..", "packages", "FUSOU-WEB");
      const webJsonOutput = execSync(
        "pnpm exec license-checker-rseidelsohn --json",
        {
          cwd: webDir,
          encoding: "utf8",
        }
      );

      const webMarkdown = execSync(`node "${genScript}"`, {
        input: webJsonOutput,
        encoding: "utf8",
      });
      allMarkdown += "### FUSOU-WEB\n\n" + webMarkdown + "\n";
    } catch (err) {
      console.log(
        "  (FUSOU-WEB: License information unavailable - " +
          err.message.split("\n")[0] +
          ")"
      );
      allMarkdown += "### FUSOU-WEB\n\nLicense information unavailable.\n\n";
    }

    // FUSOU-APP のライセンス情報を収集
    try {
      console.log("  Collecting FUSOU-APP JS/TS licenses...");
      const appDir = path.join(__dirname, "..", "packages", "FUSOU-APP");
      const appJsonOutput = execSync(
        "pnpm exec license-checker-rseidelsohn --json",
        {
          cwd: appDir,
          encoding: "utf8",
        }
      );

      const appMarkdown = execSync(`node "${genScript}"`, {
        input: appJsonOutput,
        encoding: "utf8",
      });
      allMarkdown += "### FUSOU-APP\n\n" + appMarkdown + "\n";
    } catch (err) {
      console.log(
        "  (FUSOU-APP: License information unavailable - " +
          err.message.split("\n")[0] +
          ")"
      );
      allMarkdown += "### FUSOU-APP\n\nLicense information unavailable.\n\n";
    }

    fs.writeFileSync(outputPath, allMarkdown, "utf8");
  } catch (err) {
    console.warn(
      "⚠ Warning: Failed to generate JavaScript/TypeScript licenses:",
      err.message
    );
    fs.writeFileSync(
      outputPath,
      "## JavaScript/TypeScript Dependencies\n\nJavaScript/TypeScript license generation was skipped.",
      "utf8"
    );
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
