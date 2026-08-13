import { scanLocalDirectoryHandle, scanLocalFileList, type ManifestScanResult } from "./manifest-scanner";
import type { LocalAvroLoadLimits } from "./limits";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<FileSystemDirectoryHandle>;
};

export type LocalPickerResult =
  | { kind: "directory-handle"; handle: FileSystemDirectoryHandle; scan: ManifestScanResult }
  | { kind: "file-list"; scan: ManifestScanResult };

export function supportsLocalDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

export async function pickLocalDirectory(
  limits?: Partial<LocalAvroLoadLimits>,
): Promise<LocalPickerResult> {
  if (supportsLocalDirectoryPicker()) {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) throw new Error("Directory picker is unavailable");
    const handle = await picker({ mode: "read" });
    return {
      kind: "directory-handle",
      handle,
      scan: await scanLocalDirectoryHandle(handle, { limits }),
    };
  }

  const files = await pickLocalFileList();
  return { kind: "file-list", scan: await scanLocalFileList(files, { limits }) };
}

function pickLocalFileList(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.className = "sr-only";
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      cleanup();
      resolve(files);
    }, { once: true });
    input.addEventListener("cancel", () => {
      cleanup();
      reject(new DOMException("Directory selection cancelled", "AbortError"));
    }, { once: true });
    input.click();
  });
}