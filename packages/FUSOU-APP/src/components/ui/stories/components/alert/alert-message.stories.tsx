import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { AlertMessage } from "../../../components/alert";

const meta: Meta = {
  title: "UI/Components/AlertMessage",
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj;

export const AllVariants: Story = {
  render: () => (
    <div class="flex flex-col gap-3 p-4 max-w-xl">
      <AlertMessage type="info" title="Update Check">
        Checking for the latest FUSOU application release.
      </AlertMessage>
      <AlertMessage type="success" title="Sync Complete">
        Snapshot synchronization finished cleanly.
      </AlertMessage>
      <AlertMessage type="warning" title="Session Expire Notice">
        Local Supabase credentials are missing or nearing expiration.
      </AlertMessage>
      <AlertMessage
        type="error"
        title="Connection Error"
        details={
          <div class="font-mono space-y-1">
            <div>endpoint: https://github.com/tsukasa-u/FUSOU/releases</div>
            <div>reason: request timed out after 10000ms</div>
          </div>
        }
      >
        Something went wrong while contacting the update server.
      </AlertMessage>
    </div>
  ),
};
