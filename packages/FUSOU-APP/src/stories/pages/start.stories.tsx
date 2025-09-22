import { AuthProvider } from "../../utility/provider.tsx";
import Start from "../../pages/start.tsx";

export default {
  title: "pages/start",
  component: Start,
  tags: ["autodocs"],
  render: function Render() {
    return <Start />;
  },
};

export const WithDecorator = {
  args: {},
  decorators: [
    (Story: any, context: any) => {
      return (
        <AuthProvider>
          <Story {...context.args} />
        </AuthProvider>
      );
    },
  ],
};
