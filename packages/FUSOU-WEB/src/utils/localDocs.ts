import type { MarkdownInstance } from "astro";

export interface LocalDocMetadata {
  slug: string;
  category: "formulas" | "operations" | "implementation-plans" | "architecture" | "other";
  categoryLabel: string;
  categoryOrder: number;
  categoryIcon: string;
  title: string;
  description: string;
  url: string;
  fileName: string;
  tags?: string[] | undefined;
  Content: any;
  headings: Array<{ slug: string; text: string; depth: number }>;
  entryLike: {
    id: string;
    slug: string;
    body: string;
    data: {
      title: string;
      description?: string | undefined;
      tags?: string[] | undefined;
      date?: Date | undefined;
      contributors?: string[] | undefined;
    };
  };
}

const CATEGORY_MAP: Record<
  string,
  { label: string; order: number; icon: string; description: string }
> = {
  formulas: {
    label: "Formulas & Verification",
    order: 1,
    icon: "science",
    description: "艦これ検証式・確定検証仕様書（Verified Models）・計算フローDAG・シミュレータ分離ロードマップ",
  },
  operations: {
    label: "Operations & Runbooks",
    order: 2,
    icon: "settings",
    description: "Hot/Cold 運用手順書、Compaction、デプロイ、チェックリスト等の運用ドキュメント",
  },
  "implementation-plans": {
    label: "Implementation Plans",
    order: 3,
    icon: "assignment",
    description: "機能実装・マイグレーション・セキュリティ移行に関する詳細設計計画書",
  },
  architecture: {
    label: "System Architecture",
    order: 4,
    icon: "account_tree",
    description: "全体システム構成、データフロー、フィージビリティスタディ等の設計書",
  },
};

/**
 * ローカル開発環境（dev）であるかを判定
 */
export function isLocalDev(): boolean {
  return (
    import.meta.env.DEV ||
    process.env["NODE_ENV"] === "development" ||
    process.env["ENABLE_LOCAL_DOCS"] === "true"
  );
}

/**
 * 指定された slug がローカル限定ドキュメントであるかを判定
 */
export function isLocalOnlyDoc(slug: string): boolean {
  const normalized = (slug || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^docs\//, "");

  return (
    normalized.startsWith("formulas/") ||
    normalized === "formulas" ||
    normalized.startsWith("operations/") ||
    normalized === "operations" ||
    normalized.startsWith("implementation-plans/") ||
    normalized === "implementation-plans" ||
    normalized.startsWith("architecture/") ||
    normalized === "architecture"
  );
}

// Vite の glob インポートですべてのローカル用 Markdown を読み込み
const rawLocalGlob = import.meta.glob<MarkdownInstance<Record<string, unknown>>>(
  [
    "@all-docs/formulas/**/*.md",
    "@all-docs/operations/**/*.md",
    "@all-docs/implementation-plans/**/*.md",
    "@all-docs/architecture/**/*.md",
  ],
  { eager: true }
);

function formatSegment(segment: string): string {
  return segment
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * タイトルから先頭の絵文字や余分な装飾記号を除去
 */
function cleanTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s🔴⚠️🚨💡📝📌🛠️🛡️📊📑✨🔍\-:]+/gu, "")
    .trim();
}

function parseLocalDoc(
  filePath: string,
  instance: MarkdownInstance<Record<string, unknown>>
): LocalDocMetadata {
  let slug = filePath
    .replace(/^.*?[/\\]docs[/\\]/, "")
    .replace(/^[/\\]?@all-docs[/\\]/, "")
    .replace(/\\/g, "/")
    .replace(/\.md$/, "");

  const segments = slug.split("/").filter(Boolean);
  const catKey = segments[0] || "other";
  const catConfig = CATEGORY_MAP[catKey] ?? {
    label: formatSegment(catKey),
    order: 99,
    icon: "article",
    description: "",
  };

  const rawContent = instance.rawContent ? instance.rawContent() : "";
  const frontmatter = instance.frontmatter || {};
  const fileName = segments.at(-1) || slug;

  // 1. タイトルを見出しから正確に抽出
  let title = (frontmatter["title"] as string | undefined)?.trim();
  if (!title) {
    // frontmatter 以降の本文から H1 見出し（# Title）を検索
    let body = rawContent;
    if (rawContent.startsWith("---")) {
      const parts = rawContent.split("---", 2);
      if (parts.length >= 3) {
        body = parts[2] ?? "";
      }
    }
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match && h1Match[1]) {
      const sanitized = cleanTitle(h1Match[1]);
      title = sanitized || h1Match[1].trim();
    } else {
      title = formatSegment(fileName);
    }
  }

  // 2. 説明文を本文のクリーンテキストから正確に抽出
  let description = (frontmatter["description"] as string | undefined)?.trim();
  if (!description) {
    // コードブロック、HTMLタグ、Markdownリンク、見出し、YAMLヘッダー、コメントを除去
    const cleanContent = rawContent
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^#+.*$/gm, "")
      .replace(/^---[\s\S]*?---/g, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    const lines = cleanContent.split("\n");
    for (const line of lines) {
      let trimmed = line.trim();
      // 引用記号 > やリスト記号 - * は除去して中身を見る
      trimmed = trimmed.replace(/^[>\-*|\s\d.]+/g, "").trim();

      // コード行やメタデータ行を除外し、文章段落を探す
      if (
        trimmed.length >= 15 &&
        !trimmed.startsWith("const ") &&
        !trimmed.startsWith("let ") &&
        !trimmed.startsWith("var ") &&
        !trimmed.startsWith("import ") &&
        !trimmed.startsWith("export ") &&
        !trimmed.startsWith("function ") &&
        !trimmed.startsWith("class ") &&
        !trimmed.startsWith("interface ") &&
        !trimmed.startsWith("type ") &&
        !trimmed.startsWith("SELECT ") &&
        !trimmed.startsWith("UPDATE ") &&
        !trimmed.startsWith("INSERT ") &&
        !trimmed.startsWith("DELETE ") &&
        !trimmed.startsWith("curl ") &&
        !trimmed.startsWith("pnpm ") &&
        !trimmed.startsWith("npm ") &&
        !trimmed.startsWith("git ")
      ) {
        description = trimmed.slice(0, 160);
        break;
      }
    }
  }

  const tags = Array.isArray(frontmatter["tags"])
    ? (frontmatter["tags"] as string[])
    : undefined;

  const headings = instance.getHeadings
    ? instance.getHeadings().map((h) => ({
        slug: h.slug,
        text: h.text,
        depth: h.depth,
      }))
    : [];

  return {
    slug,
    category: (catKey as any) || "other",
    categoryLabel: catConfig.label,
    categoryOrder: catConfig.order,
    categoryIcon: catConfig.icon,
    title,
    description: description || "",
    url: `/docs/${slug}`,
    fileName: `${fileName}.md`,
    ...(tags ? { tags } : {}),
    Content: instance.Content,
    headings,
    entryLike: {
      id: slug,
      slug,
      body: rawContent,
      data: {
        title,
        ...(description ? { description } : {}),
        ...(tags ? { tags } : {}),
        date: new Date(),
        contributors: Array.isArray(frontmatter["contributors"])
          ? (frontmatter["contributors"] as string[])
          : [],
      },
    },
  };
}

let cachedDocs: Map<string, LocalDocMetadata> | null = null;

function getDocsMap(): Map<string, LocalDocMetadata> {
  if (!cachedDocs) {
    cachedDocs = new Map();
    for (const [path, mod] of Object.entries(rawLocalGlob)) {
      const doc = parseLocalDoc(path, mod);
      cachedDocs.set(doc.slug, doc);
    }
  }
  return cachedDocs;
}

/**
 * スラッグに合致するローカル限定ドキュメントを取得
 */
export function getLocalDocBySlug(slug: string): LocalDocMetadata | undefined {
  const normalized = (slug || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^docs\//, "")
    .replace(/\.md$/, "");

  const map = getDocsMap();
  return map.get(normalized);
}

/**
 * すべてのローカル限定ドキュメントのリストを取得
 */
export function getAllLocalDocs(): LocalDocMetadata[] {
  const map = getDocsMap();
  return Array.from(map.values()).sort((a, b) => {
    if (a.categoryOrder !== b.categoryOrder) {
      return a.categoryOrder - b.categoryOrder;
    }
    return a.title.localeCompare(b.title);
  });
}