import { AuthProvider } from "../../utility/provider.tsx";
import App from "../../pages/app.tsx";

export default {
  title: "pages/app",
  component: App,
  tags: ["autodocs"],
  render: function Render() {
    return <App />;
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
