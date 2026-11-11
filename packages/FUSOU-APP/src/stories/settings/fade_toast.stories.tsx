import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FadeToast, showFadeToast } from "../../components/settings/fade_toast";

const meta: Meta<typeof FadeToast> = {
  title: "Components/Settings/FadeToast",
  component: FadeToast,
  tags: ["autodocs"],
  args: {
    toast_id: "demo_toast_container",
  },
};

export default meta;
type Story = StoryObj<typeof FadeToast>;

export const Interactive: Story = {
  render: (args) => (
    <div class="p-8 space-y-4 min-h-[240px] bg-base-100">
      <div>
        <h3 class="text-sm font-semibold mb-1">FadeToast Component</h3>
        <p class="text-xs text-base-content/60 mb-3">
          Click a button below to preview auto-dismissing notifications styled
          to match FUSOU-WEB alerts.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline border-info/50 text-info"
          onClick={() => {
            showFadeToast(
              args.toast_id,
              "Session health check completed.",
              "info",
            );
          }}
        >
          Show Info Toast
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline border-success/50 text-success"
          onClick={() => {
            showFadeToast(
              args.toast_id,
              "Settings saved successfully.",
              "success",
            );
          }}
        >
          Show Success Toast
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline border-warning/50 text-warning"
          onClick={() => {
            showFadeToast(
              args.toast_id,
              "Master data updated with warnings.",
              "warning",
            );
          }}
        >
          Show Warning Toast
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline border-error/50 text-error"
          onClick={() => {
            showFadeToast(
              args.toast_id,
              "Failed to synchronize snapshot.",
              "error",
            );
          }}
        >
          Show Error Toast
        </button>
      </div>

      <FadeToast toast_id={args.toast_id} />
    </div>
  ),
};
