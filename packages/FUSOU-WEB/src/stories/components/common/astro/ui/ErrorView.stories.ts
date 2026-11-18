import ErrorView from "../../../../../components/common/astro/ui/ErrorView.astro";

export default {
  title: "Components/common/astro/ui/ErrorView",
  component: ErrorView,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "code": 1,
    "title": "Storybook title"
  },
};
