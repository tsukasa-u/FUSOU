import fs from "fs";
import path from "path";

const COMPONENT_DIRS = [
  "src/components",
  "src/pages"
];

const STORIES_DIR = "src/stories";

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else {
      if (file.endsWith(".tsx")) {
        results.push(file);
      }
    }
  });
  return results;
}

const allTsxFiles = COMPONENT_DIRS.flatMap(dir => walk(dir));

for (const file of allTsxFiles) {
  // Ignore ui stories that are co-located
  if (file.includes("/stories/")) continue;
  if (file.includes("/archived/")) continue;
  
  const content = fs.readFileSync(file, "utf8");
  
  const exportConstMatches = [...content.matchAll(/export\s+const\s+([A-Z][a-zA-Z0-9_]*)\s*=/g)].map(m => m[1]);
  const exportFuncMatches = [...content.matchAll(/export\s+(?:default\s+)?function\s+([A-Z][a-zA-Z0-9_]*)/g)].map(m => m[1]);
  
  const componentNames = [...exportConstMatches, ...exportFuncMatches];
  
  if (componentNames.length === 0) continue;
  
  const mainComponent = componentNames[0];

  const relativePath = file.substring(file.indexOf("src/") + 4).replace(".tsx", "");
  
  const category = relativePath.startsWith("pages/") ? "Pages" : "Components";
  const storyTitle = `${category}/${mainComponent}`;

  const metaPackage = "storybook-solidjs";
  
  let storyDir = path.join(STORIES_DIR, path.dirname(relativePath.replace("components/", "")));
  if (relativePath.startsWith("pages/")) {
    storyDir = path.join(STORIES_DIR, path.dirname(relativePath));
  }
  
  const storyFile = path.join(storyDir, `${path.basename(relativePath)}.stories.tsx`);
  
  if (!fs.existsSync(storyDir)) {
    fs.mkdirSync(storyDir, { recursive: true });
  }

  if (fs.existsSync(storyFile)) {
    continue; // skip existing
  }

  const depth = storyDir.split(path.sep).length - 1;
  const relativeToSrc = "../".repeat(depth);
  const componentImportPath = `${relativeToSrc}${relativePath}`;

  const storyContent = `import type { Meta, StoryObj } from "${metaPackage}";
import ${mainComponent} from "${componentImportPath}";

const meta = {
  title: "${storyTitle}",
  component: ${mainComponent},
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof ${mainComponent}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};
`;

  fs.writeFileSync(storyFile, storyContent);
  console.log(`Generated story for ${mainComponent} at ${storyFile}`);
}
