import RightMenu from "../../../../../components/features/docs/astro/RightMenu.astro";

export default {
  title: "Components/features/docs/astro/RightMenu",
  component: RightMenu,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "headings": [
      {
        "slug": "getting-started",
        "text": "Getting Started",
        "depth": 2
      }
    ]
  },
};
