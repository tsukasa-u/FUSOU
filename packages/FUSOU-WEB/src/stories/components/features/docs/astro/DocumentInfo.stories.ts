import DocumentInfo from "../../../../../components/features/docs/astro/DocumentInfo.astro";

export default {
  title: "Components/features/docs/astro/DocumentInfo",
  component: DocumentInfo,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "lastUpdated": "2025-01-15T00:00:00.000Z",
    "contributors": [
      {
        "data": {
          "github_username": "storybook"
        }
      }
    ]
  },
};
