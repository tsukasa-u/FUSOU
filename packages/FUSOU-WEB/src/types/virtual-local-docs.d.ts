declare module "virtual:fusou-local-docs" {
  export const rawLocalGlob: Record<
    string,
    import("astro").MarkdownInstance<Record<string, unknown>>
  >;
}
