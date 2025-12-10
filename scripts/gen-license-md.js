#!/usr/bin/env node

/**
 * license-checker-rseidelsohn の出力をMarkdown形式に変換
 * 使用方法: license-checker-rseidelsohn --json | node gen-license-md.js
 */

const fs = require("fs");

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data);
    });

    process.stdin.on("error", reject);
  });
}

async function main() {
  try {
    const input = await readStdin();
    const licenses = JSON.parse(input);

    // licenses は { "package@version": { licenses, repository, ... }, ... } 形式
    const markdown = generateMarkdown(licenses);
    console.log(markdown);
  } catch (err) {
    console.error("Error processing licenses:", err.message);
    process.exit(1);
  }
}

function generateMarkdown(licenses) {
  let md = "# JavaScript/TypeScript Dependencies\n\n";
  md +=
    "This software uses the following JavaScript and TypeScript packages:\n\n";

  const entries = Object.entries(licenses)
    .map(([pkg, info]) => ({ pkg, ...info }))
    .sort((a, b) => a.pkg.localeCompare(b.pkg));

  for (const entry of entries) {
    const [name, version] = entry.pkg.split("@").filter(Boolean);
    const actualName =
      entry.pkg.includes("@") && !entry.pkg.startsWith("@")
        ? entry.pkg.split("@")[0]
        : name;
    const actualVersion =
      entry.pkg.includes("@") && !entry.pkg.startsWith("@")
        ? entry.pkg.split("@")[1]
        : version;

    md += `## ${actualName} ${actualVersion || "unknown"}\n\n`;

    if (entry.licenses) {
      md += `* **License:** ${entry.licenses}\n`;
    }

    if (entry.repository) {
      md += `* **Repository:** [${entry.repository}](${entry.repository})\n`;
    }

    if (entry.url) {
      md += `* **URL:** [${entry.url}](${entry.url})\n`;
    }

    md += "\n<details>\n<summary>Show License Text</summary>\n\n";

    if (entry.licenseText) {
      md += "```\n";
      md += entry.licenseText;
      md += "\n```\n";
    } else {
      md += "License text not available.\n";
    }

    md += "\n</details>\n\n---\n\n";
  }

  return md;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
