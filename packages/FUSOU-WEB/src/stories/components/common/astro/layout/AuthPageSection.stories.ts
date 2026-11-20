import AuthPageSection from "../../../../../components/common/astro/layout/AuthPageSection.astro";

export default {
  title: "Components/common/astro/layout/AuthPageSection",
  component: AuthPageSection,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "title": "Storybook title",
    "description": "Storybook description"
  },
};
