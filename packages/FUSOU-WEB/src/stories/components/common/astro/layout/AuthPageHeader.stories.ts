import AuthPageHeader from "../../../../../components/common/astro/layout/AuthPageHeader.astro";

export default {
  title: "Components/common/astro/layout/AuthPageHeader",
  component: AuthPageHeader,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "title": "Storybook title",
    "description": "Storybook description"
  },
};
