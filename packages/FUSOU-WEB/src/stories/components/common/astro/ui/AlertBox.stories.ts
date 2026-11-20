import AlertBox from "../../../../../components/common/astro/ui/AlertBox.astro";

export default {
  title: "Components/common/astro/ui/AlertBox",
  component: AlertBox,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "type": "info",
    "title": "Storybook title"
  },
};
