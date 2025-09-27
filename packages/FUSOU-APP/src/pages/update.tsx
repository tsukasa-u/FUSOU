import { createSignal, Show } from "solid-js";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { createAsync } from "@solidjs/router";

function Updater() {
  const [updateAvailable, setUpdateAvailable] = createSignal(false);
  const [updateInfo, setUpdateInfo] = createSignal<Update | null>(null);
  const [updating, setUpdating] = createSignal(false);
  const [updateError, setUpdateError] = createSignal<string | null>(null);
  const [installed, setInstalled] = createSignal(false);
  const [downloaded, setDownloaded] = createSignal(0);
  const [contentLength, setContentLength] = createSignal(0);

  // Check for updates
  const checkForUpdate = async () => {
    setUpdateError(null);
    setInstalled(false);
    setDownloaded(0);
    setContentLength(0);
    try {
      const res = await check();
      if (res) {
        setUpdateAvailable(true);
        setUpdateInfo(res);
      } else {
        setUpdateAvailable(false);
      }
    } catch (e) {
      setUpdateError("Failed to retrieve update information");
      setUpdateAvailable(false);
      console.error(e);
    }
  };

  createAsync(checkForUpdate);

  const downloadPageUrl = "https://github.com/tsukasa-u/FUSOU/releases/latest";

  const handleUpdate = async () => {
    setUpdating(true);
    setUpdateError(null);
    setDownloaded(0);
    setContentLength(0);

    const update = updateInfo();
    if (update) {
      try {
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
        setUpdateError("Failed to update");
        console.error(e);
      }
    }
    setUpdating(false);
  };

  // Redirect to download page
  const handleDownloadPage = async () => {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(downloadPageUrl);
  };

  // Progress percentage
  const progressPercent = () =>
    contentLength() > 0
      ? Math.min(100, Math.floor((downloaded() / contentLength()) * 100))
      : 0;

  return (
    <div class="min-h-screen bg-base-100 flex flex-col items-center justify-center">
      <div class="max-w-lg w-full px-4 py-8">
        <div class="bg-base-100 p-8 w-full">
          <div class="flex items-center justify-between mb-2 w-full">
            <h1 class="text-4xl">Update</h1>
            <button
              class={
                updating()
                  ? "btn btn-neutral btn-outline border-0 btn-disabled"
                  : "btn btn-neutral btn-outline border-1"
              }
              onClick={checkForUpdate}
              disabled={updating()}
            >
              Check for updates
            </button>
          </div>
          <div class="divider my-0" />
          <p class="text-center mb-6 text-base-content">
            Update page for FUSOU. Check, install, or download the latest
            version.
          </p>
          <Show when={updateAvailable()}>
            <div class="mb-6">
              <h2 class="text-lg mb-2 text-center">
                A new version is available
              </h2>
              <p class="text-center">Version: {updateInfo()?.version}</p>
              <p class="text-center">Release date: {updateInfo()?.date}</p>
              <p class="mt-4 whitespace-pre-line text-sm text-base-content text-center">
                {updateInfo()?.body}
              </p>
            </div>
            <div class="flex flex-col gap-2 mb-6 w-full items-stretch">
              <Show when={!installed()}>
                <div class="h-2" />
                <button
                  class={
                    !updating()
                      ? "btn btn-primary border-primary-content w-full shadow-none border-1"
                      : "btn btn-primary border-primary-content w-full shadow-none border-0 btn-disabled"
                  }
                  disabled={updating()}
                  onClick={handleUpdate}
                  style={{ "box-shadow": "none" }}
                >
                  {updating() ? "Updating..." : "Update Automatically"}
                </button>
                <Show when={!updating()}>
                  <p class="text-sm mt-4">
                    You can also download the latest version from the GitHub
                    releases page to update manually.
                  </p>
                  <button
                    class="btn btn-link mt-2 w-full shadow-none border-none no-underline hover:underline"
                    onClick={handleDownloadPage}
                    style={{ "box-shadow": "none" }}
                  >
                    Go to GitHub releases page
                  </button>
                </Show>
              </Show>
            </div>
            <Show when={updating()}>
              <div class="mb-4 w-full">
                <label class="block mb-1 text-primary text-center">
                  Download progress:
                </label>
                <progress
                  class="progress progress-primary w-full"
                  value={progressPercent()}
                  max={100}
                  style={{ "box-shadow": "none" }}
                />
                <div class="text-xs mt-1 text-primary text-center">
                  {downloaded()} / {contentLength()} bytes ({progressPercent()}
                  %)
                </div>
                <p class="text-sm mt-1">
                  {
                    "The app will automatically restart after installation is complete."
                  }
                </p>
              </div>
            </Show>
            <Show when={installed() && !updateError()}>
              <div
                class="alert alert-success mb-4 text-center w-full"
                style={{ "box-shadow": "none" }}
              >
                <span>Update completed. Please restart.</span>
              </div>
              <button
                class="btn btn-primary border-primary-content w-full  border-1"
                onClick={relaunch}
                style={{ "box-shadow": "none" }}
              >
                Restart
              </button>
            </Show>
            <Show when={updateError()}>
              <div
                class="alert alert-error mt-4 text-center w-full"
                style={{ "box-shadow": "none" }}
              >
                {updateError()}
              </div>
              <p>
                Please try to install manually. You can get the latest version
                from the GitHub releases page.
              </p>
              <button
                class="btn btn-link mt-2 w-full shadow-none border-none no-underline hover:underline"
                onClick={handleDownloadPage}
                style={{ "box-shadow": "none" }}
              >
                Go to GitHub releases page
              </button>
            </Show>
          </Show>
          <Show when={!updateAvailable()}>
            <div
              class="alert alert-info text-center w-full"
              style={{ "box-shadow": "none" }}
            >
              <span>You have the latest version.</span>
            </div>
          </Show>
          <Show when={updateAvailable()}>
            <div class="divider">OR</div>
          </Show>
          <div class="max-w-lg w-full flex justify-end mt-8 mx-auto">
            <a
              href="/"
              class={
                !updating()
                  ? "btn btn-secondary border-secondary-content w-full shadow-none border-1"
                  : "btn btn-secondary border-secondary-content w-full shadow-none border-0 btn-disabled"
              }
              style={{ "box-shadow": "none" }}
            >
              Back to App Page
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Updater;
