import { AlertMessage } from "../../../../components/common/solid/AlertMessage";

export default {
  parameters: { renderer: "solid" },
  title: "Components/common/solid/AlertMessage",
  component: AlertMessage,
  tags: ["autodocs"],
};

export const Default = {
  args: {
    "type": "info"
  },
};
