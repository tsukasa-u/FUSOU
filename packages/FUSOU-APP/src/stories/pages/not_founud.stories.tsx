import { AuthProvider } from "../../utility/provider.tsx";
import NotFound from "../../pages/not_found.tsx";

export default {
  title: "pages/not_found",
  component: NotFound,
  tags: ["autodocs"],
  render: function Render() {
    return <NotFound />;
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
