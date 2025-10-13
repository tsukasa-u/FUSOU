import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const docsCollection = defineCollection({
  // type: "content",
  loader: glob({ pattern: "**/*.md", base: "../../docs/contents" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    date: z.date(),
    contributors: z.array(z.string()),
  }),
});

const authorsCollection = defineCollection({
  type: "data",
  schema: z.object({
    github_username: z.string(),
    github_avatar: z.string().url().optional(),
    github_url: z.string().url().optional(),
  }),
});

export const collections = {
  docs: docsCollection,
  authors: authorsCollection,
};
