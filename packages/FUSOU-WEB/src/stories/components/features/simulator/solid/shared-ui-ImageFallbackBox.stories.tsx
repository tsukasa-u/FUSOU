import { ImageFallbackBox } from "../../../../../components/features/simulator/solid/shared-ui";

export default {
  parameters: { renderer: "solid" },
  title: "Components/features/simulator/solid/shared-ui/ImageFallbackBox",
  component: ImageFallbackBox,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 64'%3E%3Crect width='96' height='64' fill='%23cbd5e1'/%3E%3C/svg%3E",
    "alt": "Storybook alt",
    "class": "Storybook class"
  },
};
