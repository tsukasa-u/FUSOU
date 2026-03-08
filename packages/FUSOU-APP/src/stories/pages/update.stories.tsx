import Update from "../../pages/update.tsx";

export default {
  title: "pages/update",
  component: Update,
  tags: ["autodocs"],
  render: function Render() {
    return <Update />;
  },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return (
        <Story {...context.args} />
      );
    },
  ],
};
