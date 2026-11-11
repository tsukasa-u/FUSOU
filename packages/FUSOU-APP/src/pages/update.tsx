import { createEffect, createSignal, onMount, Show } from "solid-js";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { AlertMessage } from "ui";
import { isTauri } from "../utility/tauri";

const DOWNLOAD_PAGE_URL = "https://github.com/tsukasa-u/FUSOU/releases/latest";

export interface UpdatePreviewInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface UpdatePreviewState {
  isDesktop?: boolean;
  currentVersion?: string | null;
  checking?: boolean;
  hasChecked?: boolean;
  updateAvailable?: boolean;
  updateInfo?: UpdatePreviewInfo | null;
  updating?: boolean;
  updateError?: string | null;
  installed?: boolean;
  downloaded?: number;
  contentLength?: number;
  onCheckForUpdates?: () => void;
  onUpdateAutomatically?: () => void;
  onRelaunch?: () => void;
}

export interface UpdaterProps {
  preview?: UpdatePreviewState;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdaterView(props: UpdaterProps) {
  const [currentVersion, setCurrentVersion] = createSignal<string | null>(null);
  const [checking, setChecking] = createSignal(false);
  const [hasChecked, setHasChecked] = createSignal(false);
  const [updateAvailable, setUpdateAvailable] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<
    Update | UpdatePreviewInfo | null
  >(null);
  const [updating, setUpdating] = createSignal(false);
  const [updateError, setUpdateError] = createSignal<string | null>(null);
  const [installed, setInstalled] = createSignal(false);
  const [downloaded, setDownloaded] = createSignal(0);
  const [contentLength, setContentLength] = createSignal(0);

  const isDesktopRuntime = () => props.preview?.isDesktop ?? isTauri();

  createEffect(() => {
    const preview = props.preview;
    if (!preview) return;
    setCurrentVersion(
      preview.currentVersion !== undefined ? preview.currentVersion : "0.6.1",
    );
    setChecking(preview.checking ?? false);
    setHasChecked(preview.hasChecked ?? true);
    setUpdateAvailable(preview.updateAvailable ?? false);
    setUpdateInfo(preview.updateInfo ?? null);
    setUpdating(preview.updating ?? false);
    setUpdateError(preview.updateError ?? null);
    setInstalled(preview.installed ?? false);
    setDownloaded(preview.downloaded ?? 0);
    setContentLength(preview.contentLength ?? 0);
  });

  const checkForUpdate = async () => {
    if (props.preview) {
      props.preview.onCheckForUpdates?.();
      return;
    }

    setChecking(true);
    setUpdateError(null);
    setInstalled(false);
    setDownloaded(0);
    setContentLength(0);

    if (!isTauri()) {
      setUpdateAvailable(false);
      setUpdateInfo(null);
      setHasChecked(true);
      setChecking(false);
      return;
    }

    try {
      const res = await check();
      if (res) {
        setUpdateAvailable(true);
        setUpdateInfo(res);
      } else {
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
    } catch (e) {
      setUpdateError("Failed to retrieve update information.");
      setUpdateAvailable(false);
      console.error(e);
    } finally {
      setHasChecked(true);
      setChecking(false);
    }
  };

  onMount(() => {
    if (props.preview) return;
    if (isTauri()) {
      import("@tauri-apps/api/app")
        .then(({ getVersion }) => getVersion())
        .then((version) => setCurrentVersion(version))
        .catch(() => {});
    }
    void checkForUpdate();
  });

  const handleUpdate = async () => {
    if (props.preview) {
      props.preview.onUpdateAutomatically?.();
      return;
    }

    const update = updateInfo();
    if (!update || !("downloadAndInstall" in update)) return;

    setUpdating(true);
    setUpdateError(null);
    setDownloaded(0);
    setContentLength(0);

    try {
      // eslint-disable-next-line solid/reactivity
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setContentLength(event.data.contentLength ?? 0);
            setDownloaded(0);
            break;
          case "Progress":
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case "Finished":
            setDownloaded(contentLength());
            setInstalled(true);
            break;
        }
      });
      await relaunch();
    } catch (e) {
      setUpdateError("Failed to install the update automatically.");
      console.error(e);
    } finally {
      setUpdating(false);
    }
  };

  const handleRestart = () => {
    if (props.preview?.onRelaunch) {
      props.preview.onRelaunch();
      return;
    }
    if (isTauri()) {
      void relaunch();
    }
  };

  const handleDownloadPage = async () => {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(DOWNLOAD_PAGE_URL);
      return;
    }
    window.open(DOWNLOAD_PAGE_URL, "_blank", "noopener,noreferrer");
  };

  const progressPercent = () =>
    contentLength() > 0
      ? Math.min(100, Math.floor((downloaded() / contentLength()) * 100))
      : 0;

  return (
    <div class="min-h-full bg-base-100 px-6 py-8 flex items-start justify-center">
      <div class="w-full max-w-xl space-y-5">
        {/* Page Header */}
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <h1 class="text-xl font-bold tracking-tight">
                Application Update
              </h1>
              <Show when={currentVersion()}>
                <span class="badge badge-sm badge-outline border-base-300 text-base-content/70 font-mono">
                  v{currentVersion()}
                </span>
              </Show>
            </div>
            <p class="text-sm text-base-content/65">
              Check for new releases, review changelog notes, or install
              updates.
            </p>
          </div>

          <button
            type="button"
            class="btn btn-sm btn-secondary enabled:border-secondary-content"
            onClick={checkForUpdate}
            disabled={updating() || checking()}
          >
            <Show when={checking()}>
              <span class="loading loading-spinner loading-xs" />
            </Show>
            {checking() ? "Checking..." : "Check for Updates"}
          </button>
        </div>

        {/* Main Update Card */}
        <div class="bg-base-100 rounded-box border border-base-300 p-5 space-y-4">
          <Show when={checking()}>
            <AlertMessage type="info" title="Checking for updates">
              <span class="inline-flex items-center gap-2">
                <span class="loading loading-spinner loading-xs text-info" />
                Contacting release server for the latest version...
              </span>
            </AlertMessage>
          </Show>

          <Show when={!checking() && updateError()}>
            <AlertMessage type="error" title="Update Error">
              {updateError()} Try checking again or install manually from GitHub
              Releases.
            </AlertMessage>

            <div class="flex items-center justify-end pt-1">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onClick={handleDownloadPage}
              >
                Open GitHub Releases
              </button>
            </div>
          </Show>

          <Show when={!checking() && installed() && !updateError()}>
            <AlertMessage type="success" title="Update Installed">
              Installation is complete. Restart FUSOU to apply the new version.
            </AlertMessage>

            <div class="flex items-center justify-end pt-1">
              <button
                type="button"
                class="btn btn-primary enabled:border-primary-content btn-sm"
                onClick={handleRestart}
              >
                Restart Application
              </button>
            </div>
          </Show>

          <Show when={!checking() && updateAvailable() && !installed()}>
            <AlertMessage type="info" title="New Version Available">
              FUSOU v{updateInfo()?.version} is available to download and
              install.
            </AlertMessage>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-base-200/40 rounded-lg border border-base-300 px-3.5 py-2.5 text-xs">
              <Show when={currentVersion()}>
                <div>
                  <div class="text-base-content/55">Current Version</div>
                  <div class="font-mono font-medium mt-0.5">
                    v{currentVersion()}
                  </div>
                </div>
              </Show>
              <div>
                <div class="text-base-content/55">Available Version</div>
                <div class="font-mono font-semibold text-primary-content dark:text-primary mt-0.5">
                  v{updateInfo()?.version}
                </div>
              </div>
              <div>
                <div class="text-base-content/55">Release Date</div>
                <div class="font-mono mt-0.5">
                  {updateInfo()?.date ?? "Not specified"}
                </div>
              </div>
            </div>

            <Show when={updateInfo()?.body}>
              <div class="space-y-1.5">
                <div class="text-xs font-medium text-base-content/65 uppercase tracking-wider">
                  Release Notes
                </div>
                <div class="bg-base-200/30 border border-base-300 rounded-lg p-3 max-h-52 overflow-y-auto text-sm leading-relaxed text-base-content/85 whitespace-pre-line">
                  {updateInfo()?.body}
                </div>
              </div>
            </Show>

            <Show when={updating()}>
              <div class="space-y-2 pt-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-medium text-base-content">
                    Downloading &amp; installing update...
                  </span>
                  <span class="font-mono tabular-nums text-base-content/70">
                    {formatBytes(downloaded())} / {formatBytes(contentLength())}{" "}
                    ({progressPercent()}%)
                  </span>
                </div>
                <progress
                  class="progress progress-primary w-full"
                  value={progressPercent()}
                  max={100}
                />
                <p class="text-xs text-base-content/60">
                  The application will restart automatically after installation
                  completes.
                </p>
              </div>
            </Show>

            <Show when={!updating()}>
              <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  class="btn btn-primary enabled:border-primary-content btn-sm"
                  onClick={handleUpdate}
                >
                  Update Automatically
                </button>
                <button
                  type="button"
                  class="btn btn-outline btn-sm"
                  onClick={handleDownloadPage}
                >
                  Open GitHub Releases
                </button>
              </div>
            </Show>
          </Show>

          <Show
            when={
              !checking() &&
              hasChecked() &&
              !updateAvailable() &&
              !updateError()
            }
          >
            <Show
              when={isDesktopRuntime()}
              fallback={
                <AlertMessage type="info" title="Browser Preview Mode">
                  Automatic update checks run inside the FUSOU desktop app. You
                  can browse release builds directly on GitHub.
                </AlertMessage>
              }
            >
              <AlertMessage type="success" title="You Are Up to Date">
                You are already running the latest version of FUSOU.
              </AlertMessage>
            </Show>

            <div class="flex items-center justify-end pt-1">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                onClick={handleDownloadPage}
              >
                View GitHub Releases
              </button>
            </div>
          </Show>
        </div>

        {/* Footer Navigation */}
        <div class="flex items-center justify-between">
          <a
            href="/"
            class={`btn btn-sm btn-outline gap-1.5 ${
              updating() ? "btn-disabled pointer-events-none" : ""
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="w-4 h-4"
              aria-hidden="true"
            >
              <path
                fill-rule="evenodd"
                d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z"
                clip-rule="evenodd"
              />
            </svg>
            Back to Launch Page
          </a>
        </div>
      </div>
    </div>
  );
}

function Updater() {
  return <UpdaterView />;
}

export default Updater;
