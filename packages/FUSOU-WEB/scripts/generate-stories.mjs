import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  componentStorybookDefaults,
  storybookAccessor,
  storybookAccessorPrefix,
  storybookFixtureExports,
  storybookFixtureExpressions,
} from "./storybook-component-defaults.mjs";

const componentRoot = path.resolve("src/components");
const pageRoot = path.resolve("src/pages");
const storyRoot = path.resolve("src/stories");
const storybookFn = "__FUSOU_STORYBOOK_FN__";
let createdStories = 0;
let updatedStories = 0;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "archived" && entry.name !== "stories") {
        files.push(...(await collectFiles(entryPath)));
      }
    } else {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

function getImportPath(storyPath, sourcePath) {
  let importPath = toPosix(path.relative(path.dirname(storyPath), sourcePath));
  if (!importPath.startsWith(".")) importPath = `./${importPath}`;
  if (importPath.endsWith(".tsx")) importPath = importPath.slice(0, -4);
  return importPath;
}

function pascalCase(value) {
  return (
    value
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join("") || "Component"
  );
}

function exportedComponents(source, filePath) {
  if (filePath.endsWith(".astro")) {
    return [{ name: pascalCase(path.basename(filePath, ".astro")), isDefault: true }];
  }

  const components = new Map();
  const functionPattern =
    /\bexport\s+(default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\b/g;
  for (const match of source.matchAll(functionPattern)) {
    components.set(match[2], Boolean(match[1]));
  }

  const constPattern = /\bexport\s+(default\s+)?const\s+([A-Z][A-Za-z0-9_]*)\b/g;
  for (const match of source.matchAll(constPattern)) {
    const nextExport = source.indexOf("\nexport ", match.index + match[0].length);
    const declaration = source.slice(
      match.index,
      nextExport < 0 ? source.length : nextExport,
    );
    if (/(?:=>|function\b)/.test(declaration) && /<\s*\/?\s*[A-Za-z]/.test(declaration)) {
      components.set(match[2], Boolean(match[1]));
    }
  }

  return [...components].map(([name, isDefault]) => ({ name, isDefault }));
}

function extractBracedBlock(source, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  return undefined;
}

function declaredProps(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `(?:interface\\s+${escapedName}(?:<[^>]*>)?|type\\s+${escapedName}(?:<[^>]*>)?\\s*=)\\s*\\{`,
    "m",
  ).exec(source);
  if (!declaration) return undefined;

  const openIndex = declaration.index + declaration[0].lastIndexOf("{");
  return extractBracedBlock(source, openIndex);
}

function componentProps(source, componentName) {
  if (componentName) {
    const componentSpecificProps = declaredProps(
      source,
      `${componentName}Props`,
    );
    if (componentSpecificProps) return componentSpecificProps;

    const escapedName = componentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declaration = new RegExp(
      `\\b(?:function\\s+${escapedName}(?:<[^>]*>)?\\s*\\(|${escapedName}\\s*=)`,
    ).exec(source);
    if (declaration) {
      const signature = source.slice(declaration.index, declaration.index + 1600);
      const propsMarker = /\bprops\s*:\s*/.exec(signature);
      if (propsMarker) {
        const typeStart = propsMarker.index + propsMarker[0].length;
        const typeText = signature.slice(typeStart).trimStart();
        if (typeText.startsWith("{")) {
          const openIndex =
            typeStart + signature.slice(typeStart).indexOf("{");
          const inlineProps = extractBracedBlock(signature, openIndex);
          if (inlineProps) return inlineProps;
        } else {
          const typeName = typeText.match(/^([A-Za-z_$][\w$]*)/)?.[1];
          if (typeName) {
            const namedProps = declaredProps(source, typeName);
            if (namedProps) return namedProps;
          }
        }
      }

      const componentPropsFallback = declaredProps(source, "Props");
      if (componentPropsFallback) return componentPropsFallback;
    }
  }

  return source.match(
    /(?:interface\s+\w*Props(?:<[^>\n]*>)?|type\s+\w*Props\s*=)\s*\{([\s\S]*?)^\}/m,
  )?.[1];
}

function defaultArgs(source, componentName) {
  if (source.includes("headings.filter")) {
    return {
      headings: [
        {
          slug: "getting-started",
          text: "Getting Started",
          depth: 2,
        },
      ],
    };
  }

  const propsText = componentProps(source, componentName);
  const args = {};
  if (propsText) {
    for (const line of propsText.split(/\r?\n/)) {
      const property = line.match(
        /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\?)?\s*:\s*([^;\n]+)\s*[,;]?\s*$/,
      );
      if (!property || property[2]) continue;

      const [, name, , type] = property;
      const typeAlias = /^[A-Za-z_$][\w$]*$/.test(type.trim())
        ? source.match(new RegExp(`\\btype\\s+${type.trim()}\\s*=\\s*([^;\\n]+)`))?.[1]
        : undefined;
      const accessor = type.match(/^\(\s*\)\s*=>\s*(.+)$/);
      if (accessor) {
        const returnType = accessor[1].trim();
        const literalAccessor = returnType.match(/["']([^"']+)["']/);
        if (/\bvoid\b/.test(returnType) || /^Promise</.test(returnType)) {
          args[name] = storybookFn;
        } else if (literalAccessor) {
          args[name] = storybookAccessor(literalAccessor[1]);
        } else if (/\[\]|Array</.test(returnType)) {
          args[name] = storybookAccessor([]);
        } else if (/\bboolean\b/.test(returnType)) {
          args[name] = storybookAccessor(false);
        } else if (/\bnumber\b/.test(returnType)) {
          args[name] = storybookAccessor(0);
        } else if (/\bstring\b/.test(returnType)) {
          args[name] = storybookAccessor("");
        } else if (/null|undefined/.test(returnType)) {
          args[name] = storybookAccessor(null);
        } else if (/Record<|\bobject\b|\{\s*\}/.test(returnType)) {
          args[name] = storybookAccessor({});
        } else if (/permission/i.test(name)) {
          args[name] = storybookAccessor("granted");
        } else if (/status|tab|mode|filter/i.test(name)) {
          args[name] = storybookAccessor("idle");
        } else {
          args[name] = storybookAccessor(null);
        }
        continue;
      }

      const literal = (typeAlias ?? type).match(
        /(?:^|\|)\s*["']([^"']+)["']/,
      );
      if (literal) args[name] = literal[1];
      else if (/=>/.test(type)) args[name] = storybookFn;
      else if (/Record<|\bobject\b|\{\s*\}/.test(type)) args[name] = {};
      else if (/string\s*\[\]|Array<string>/.test(type)) args[name] = ["Storybook item"];
      else if (/\[\]|Array</.test(type)) args[name] = [];
      else if (/\bnumber\b/.test(type)) args[name] = 1;
      else if (/\bboolean\b/.test(type)) args[name] = false;
      else if (/\bstring\b/.test(type)) args[name] = `Storybook ${name}`;
    }
  }

  if (/\bguide\s*:\s*TutorialGuide\b/.test(source)) {
    args.guide = {
      id: "storybook-preview",
      title: "操作説明",
      summary: "Storybook のページプレビューです。",
      steps: ["ページ上の操作を確認します。"],
    };
  }

  return args;
}

function formatArgs(args) {
  let formatted = JSON.stringify(args, null, 2)
    .replace(/"__FUSOU_STORYBOOK_FN__"/g, "fn()")
    .replace(
      /"__FUSOU_STORYBOOK_ACCESSOR__(?:\\.|[^"\\])*"/g,
      (encoded) => {
        const marker = JSON.parse(encoded);
        return `() => (${marker.slice(storybookAccessorPrefix.length)})`;
      },
    );

  for (const [marker, expression] of Object.entries(storybookFixtureExpressions)) {
    formatted = formatted.replaceAll(JSON.stringify(marker), expression);
  }

  return formatted.replace(/\n/g, "\n  ");
}

function containsValue(value, target) {
  if (value === target) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsValue(item, target));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsValue(item, target));
  }
  return false;
}

function hasStorybookFn(args) {
  return containsValue(args, storybookFn);
}

async function writeStory(
  storyPath,
  content,
  renderer,
  args = {},
  replacePagePreview = false,
  replaceArgs = false,
  fixtureImport,
) {
  try {
    await access(storyPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;

    await mkdir(path.dirname(storyPath), { recursive: true });
    await writeFile(storyPath, content, "utf8");
    createdStories += 1;
    return;
  }

  const existing = await readFile(storyPath, "utf8");
  if (replacePagePreview && existing.includes("PagePreview")) {
    await writeFile(storyPath, content, "utf8");
    updatedStories += 1;
    return;
  }

  let updated = existing;

  if (
    renderer &&
    !new RegExp(`\\brenderer\\s*:\\s*["']${renderer}["']`).test(updated)
  ) {
    if (/\bparameters\s*:/.test(updated)) {
      throw new Error(
        `Add parameters.renderer = "${renderer}" to the existing story: ${storyPath}`,
      );
    }

    updated = updated.replace(
      /(export default\s*\{\s*\r?\n)/,
      `$1  parameters: { renderer: ${JSON.stringify(renderer)} },\n`,
    );
    if (updated === existing) {
      throw new Error(`Could not add renderer metadata to the existing story: ${storyPath}`);
    }
  }

  if (/\brender\s*:/.test(updated)) {
    if (updated === existing) return;
    await writeFile(storyPath, updated, "utf8");
    updatedStories += 1;
    return;
  }

  const existingArgs = updated.match(/\bargs\s*:\s*\{/);
  if (existingArgs && replaceArgs) {
    const openIndex = updated.indexOf("{", existingArgs.index);
    const block = extractBracedBlock(updated, openIndex);
    if (block !== undefined) {
      updated =
        updated.slice(0, openIndex) +
        formatArgs(args) +
        updated.slice(openIndex + block.length + 2);
    }
  } else {
    const simpleArgs = updated.match(/(\bargs\s*:\s*)\{([^{}]*)\}/);
    if (
      simpleArgs &&
      (simpleArgs[2].trim() === "" ||
        /["']Storybook [^"']*["']/.test(simpleArgs[2])) &&
      (Object.keys(args).length > 0 || simpleArgs[2].trim() !== "")
    ) {
      updated = updated.replace(
        simpleArgs[0],
        `${simpleArgs[1]}${formatArgs(args)}`,
      );
    }
  }

  if (hasStorybookFn(args) && !/from\s*["']storybook\/test["']/.test(updated)) {
    updated = `import { fn } from "storybook/test";\n${updated}`;
  }

  if (fixtureImport && !updated.includes(fixtureImport)) {
    const fixtureImportParts = fixtureImport.match(
      /^import \{ ([^}]+) \} from ("[^"]+");$/,
    );
    if (fixtureImportParts) {
      const requiredNames = fixtureImportParts[1]
        .split(",")
        .map((name) => name.trim());
      const modulePath = JSON.parse(fixtureImportParts[2]);
      const existingFixtureImport = updated.match(
        new RegExp(
          `import\\s*\\{([^}]*)\\}\\s*from\\s*${JSON.stringify(modulePath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
      );
      if (existingFixtureImport) {
        const existingNames = existingFixtureImport[1]
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
        const missingNames = requiredNames.filter(
          (name) => !existingNames.includes(name),
        );
        if (missingNames.length > 0) {
          updated = updated.replace(
            existingFixtureImport[0],
            `import { ${[...existingNames, ...missingNames].join(", ")} } from ${JSON.stringify(modulePath)};`,
          );
        }
      } else {
        updated = `${fixtureImport}\n${updated}`;
      }
    } else {
      updated = `${fixtureImport}\n${updated}`;
    }
  }

  if (updated === existing) return;
  await writeFile(storyPath, updated, "utf8");
  updatedStories += 1;
}

function componentRenderer(sourcePath) {
  if (!sourcePath.endsWith(".tsx")) return undefined;

  const segments = toPosix(path.relative(componentRoot, sourcePath)).split("/");
  const renderers = ["react", "solid"].filter((renderer) =>
    segments.includes(renderer),
  );
  if (renderers.length !== 1) {
    throw new Error(
      `Expected a .tsx component under a react/ or solid/ directory: ${sourcePath}`,
    );
  }

  return renderers[0];
}

async function generateComponentStories() {
  const files = await collectFiles(componentRoot);
  for (const sourcePath of files) {
    if (
      !/\.(?:astro|tsx)$/.test(sourcePath) ||
      /\.(?:test|spec)\.tsx$/.test(sourcePath)
    ) {
      continue;
    }

    const source = await readFile(sourcePath, "utf8");
    const components = exportedComponents(source, sourcePath);
    const renderer = componentRenderer(sourcePath);
    const relativeSourcePath = path.relative(componentRoot, sourcePath);
    const storyDirectory = path.join(
      storyRoot,
      "components",
      path.dirname(relativeSourcePath),
    );
    const fileBase = path.basename(sourcePath, path.extname(sourcePath));

    for (const { name, isDefault } of components) {
      const suffix = components.length > 1 ? `-${name}` : "";
      const storyExtension = sourcePath.endsWith(".tsx") ? ".stories.tsx" : ".stories.ts";
      const storyPath = path.join(storyDirectory, `${fileBase}${suffix}${storyExtension}`);
      const importPath = getImportPath(storyPath, sourcePath);
      const importStatement = isDefault
        ? `import ${name} from ${JSON.stringify(importPath)};`
        : `import { ${name} } from ${JSON.stringify(importPath)};`;
      const titlePath = toPosix(
        path.join(path.dirname(relativeSourcePath), fileBase, ...(components.length > 1 ? [name] : [])),
      ).replace(/^\.\//, "");
      const storyArgs = {
        ...defaultArgs(source, name),
        ...(componentStorybookDefaults[name] ?? {}),
      };
      const args = formatArgs(storyArgs);
      const fixtureNames = [...new Set(Object.entries(storybookFixtureExports)
        .filter(([marker]) => containsValue(storyArgs, marker))
        .map(([, exportName]) => exportName))];
      const fixtureImport =
        fixtureNames.length > 0
          ? `import { ${fixtureNames.join(", ")} } from ${JSON.stringify(
              getImportPath(
                storyPath,
                path.join(storyRoot, "storybook-fixtures.tsx"),
              ),
            )};`
          : undefined;
      const storyImports = [
        importStatement,
        ...(fixtureImport ? [fixtureImport] : []),
        ...(hasStorybookFn(storyArgs) ? ['import { fn } from "storybook/test";'] : []),
      ].join("\n");

      await writeStory(
        storyPath,
        `${storyImports}

export default {
  title: ${JSON.stringify(`Components/${titlePath}`)},
  component: ${name},
${renderer ? `  parameters: { renderer: ${JSON.stringify(renderer)} },\n` : ""}  tags: ["autodocs"],
};

export const Default = {
  args: ${args},
};
`,
        renderer,
        storyArgs,
        false,
        true,
        fixtureImport,
      );
    }
  }
}

function isRedirectOnlyPage(source) {
  const [, frontmatter, body] =
    source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/) ?? [];
  if (frontmatter === undefined) return false;

  const astroRedirect =
    body.trim() === "" && /\bAstro\.redirect\s*\(/.test(frontmatter);
  const browserRedirect =
    /<meta\s+http-equiv\s*=\s*["']?refresh\b/i.test(body) &&
    /\bwindow\.location\.href\s*=/.test(body);

  return astroRedirect || browserRedirect;
}

async function generatePageStories() {
  const files = await collectFiles(pageRoot);
  let skippedRedirectRoutes = 0;
  for (const sourcePath of files.filter((file) => file.endsWith(".astro"))) {
    const relativePath = path.relative(pageRoot, sourcePath);
    const source = await readFile(sourcePath, "utf8");
    if (isRedirectOnlyPage(source)) {
      skippedRedirectRoutes += 1;
      continue;
    }

    const relativeWithoutExtension = toPosix(relativePath).replace(/\.astro$/, "");
    const titlePath =
      relativeWithoutExtension === "index"
        ? "Home"
        : relativeWithoutExtension
            .replace(/\/index$/, "")
            .split("/")
            .map((part) => part.replace(/\[[^\]]+\]/g, "Dynamic"))
            .join("/");
    const storyPath = path.join(
      storyRoot,
      "pages",
      path.dirname(relativePath),
      `${path.basename(sourcePath, ".astro")}.stories.ts`,
    );
    const importPath = getImportPath(storyPath, sourcePath);
    const storyArgs = defaultArgs(source);
    const storybookArgs = {
      "dashboard.astro": { storybook: true },
      "dashboard/api-keys.astro": { storybook: true },
      "docs/[...slug].astro": { slug: "start/what_is_fusou" },
      "docs/local.astro": { storybook: true },
      "simulator/fleets.astro": { storybook: true },
      "simulator/index.astro": { storybook: true },
    }[toPosix(relativePath)];
    if (storybookArgs) {
      Object.assign(storyArgs, storybookArgs);
    }
    const args = formatArgs(storyArgs);

    await writeStory(
      storyPath,
      `import Page from ${JSON.stringify(importPath)};

export default {
  title: ${JSON.stringify(`Pages/${titlePath}`)},
  component: Page,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
};

export const Default = {
  args: ${args},
};
`,
      undefined,
      storyArgs,
      true,
    );
  }

  if (skippedRedirectRoutes > 0) {
    console.info(`Skipped ${skippedRedirectRoutes} redirect-only page routes.`);
  }
}

await generateComponentStories();
await generatePageStories();
console.log(`Created ${createdStories} and updated ${updatedStories} Storybook stories.`);
