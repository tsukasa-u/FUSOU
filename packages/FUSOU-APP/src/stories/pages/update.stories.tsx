import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, For, onCleanup } from "solid-js";
import Updater, {
  UpdaterView,
  type UpdatePreviewState,
} from "../../pages/update.tsx";

const meta: Meta<typeof Updater> = {
  title: "pages/update",
  component: Updater,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof Updater>;

const SAMPLE_RELEASE = {
  version: "0.7.0",
  date: "2026-11-11",
  body: [
    "Highlights in FUSOU v0.7.0:",
    "- Unified status alerts and FadeToast styling across FUSOU-APP and FUSOU-WEB",
    "- Redesigned Settings and Updater pages with clearer grouping and error visibility",
    "- Refined button outline borders across Light and Dark themes",
  ].join("\n"),
};

type PresetKey =
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "installed"
  | "error"
  | "browserPreview";

const PRESETS: Record<PresetKey, { label: string; state: UpdatePreviewState }> =
  {
    checking: {
      label: "Checking",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: true,
        hasChecked: false,
      },
    },
    upToDate: {
      label: "Up to Date",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: false,
        hasChecked: true,
        updateAvailable: false,
      },
    },
    available: {
      label: "Update Available",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: false,
        hasChecked: true,
        updateAvailable: true,
        updateInfo: SAMPLE_RELEASE,
      },
    },
    downloading: {
      label: "Downloading (64%)",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: false,
        hasChecked: true,
        updateAvailable: true,
        updateInfo: SAMPLE_RELEASE,
        updating: true,
        downloaded: 22_400_000,
        contentLength: 35_000_000,
      },
    },
    installed: {
      label: "Installed",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: false,
        hasChecked: true,
        updateAvailable: true,
        updateInfo: SAMPLE_RELEASE,
        installed: true,
      },
    },
    error: {
      label: "Check Error",
      state: {
        isDesktop: true,
        currentVersion: "0.6.1",
        checking: false,
        hasChecked: true,
        updateAvailable: false,
        updateError: "Failed to retrieve update information.",
      },
    },
    browserPreview: {
      label: "Browser Preview",
      state: {
        isDesktop: false,
        currentVersion: null,
        checking: false,
        hasChecked: true,
        updateAvailable: false,
      },
    },
  };

export const WithDecorator: Story = {
  render: () => <Updater />,
};

export const InteractiveTransitions: Story = {
  render: () => {
    const [activePreset, setActivePreset] =
      createSignal<PresetKey>("available");
    const [progressBytes, setProgressBytes] = createSignal(22_400_000);
    let timer: ReturnType<typeof setInterval> | undefined;

    const clearTimer = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    onCleanup(clearTimer);

    const simulateCheck = () => {
      clearTimer();
      setActivePreset("checking");
      timer = setTimeout(() => {
        setActivePreset("available");
        timer = undefined;
      }, 900) as unknown as ReturnType<typeof setInterval>;
    };

    const simulateDownload = () => {
      clearTimer();
      setProgressBytes(0);
      setActivePreset("downloading");
      const total = 35_000_000;
      timer = setInterval(() => {
        setProgressBytes((prev) => {
          const next = Math.min(total, prev + 7_000_000);
          if (next >= total) {
            clearTimer();
            setActivePreset("installed");
          }
          return next;
        });
      }, 350);
    };

    const currentPreview = (): UpdatePreviewState => {
      const key = activePreset();
      const base = PRESETS[key].state;
      return {
        ...base,
        downloaded: key === "downloading" ? progressBytes() : base.downloaded,
        onCheckForUpdates: simulateCheck,
        onUpdateAutomatically: simulateDownload,
        onRelaunch: simulateCheck,
      };
    };

    return (
      <div class="min-h-screen bg-base-100">
        <div class="border-b border-base-300 bg-base-200/40 px-4 py-2.5 flex flex-wrap items-center justify-center gap-1.5">
          <span class="text-xs font-medium text-base-content/65 mr-1">
            Preview State:
          </span>
          <For
            each={Object.entries(PRESETS) as [PresetKey, { label: string }][]}
          >
            {([key, { label }]) => (
              <button
                type="button"
                class={`btn btn-xs ${
                  activePreset() === key
                    ? "btn-primary enabled:border-primary-content"
                    : "btn-outline"
                }`}
                onClick={() => {
                  clearTimer();
                  if (key === "downloading") {
                    setProgressBytes(22_400_000);
                  }
                  setActivePreset(key);
                }}
              >
                {label}
              </button>
            )}
          </For>
        </div>

        <UpdaterView preview={currentPreview()} />
      </div>
    );
  },
};

export const Checking: Story = {
  render: () => <UpdaterView preview={PRESETS.checking.state} />,
};

export const UpToDate: Story = {
  render: () => <UpdaterView preview={PRESETS.upToDate.state} />,
};

export const UpdateAvailable: Story = {
  render: () => <UpdaterView preview={PRESETS.available.state} />,
};

export const DownloadingProgress: Story = {
  render: () => <UpdaterView preview={PRESETS.downloading.state} />,
};

export const UpdateInstalled: Story = {
  render: () => <UpdaterView preview={PRESETS.installed.state} />,
};

export const CheckError: Story = {
  render: () => <UpdaterView preview={PRESETS.error.state} />,
};
