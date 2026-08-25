export type LocalDirectoryPermissionState =
  | "granted"
  | "prompt"
  | "denied"
  | "unsupported";

type PermissionHandle = {
  queryPermission?: (descriptor?: { mode?: "read" }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: "read" }) => Promise<PermissionState>;
};

function toPermissionState(value: PermissionState | undefined): LocalDirectoryPermissionState {
  if (value === "granted" || value === "prompt" || value === "denied") return value;
  return "unsupported";
}

export async function queryLocalDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<LocalDirectoryPermissionState> {
  const permissionHandle = handle as unknown as PermissionHandle;
  if (!permissionHandle.queryPermission) return "unsupported";
  try {
    return toPermissionState(await permissionHandle.queryPermission({ mode: "read" }));
  } catch {
    return "denied";
  }
}

export async function requestLocalDirectoryPermission(
  handle: FileSystemDirectoryHandle,
): Promise<LocalDirectoryPermissionState> {
  const permissionHandle = handle as unknown as PermissionHandle;
  if (!permissionHandle.requestPermission) return "unsupported";
  try {
    return toPermissionState(await permissionHandle.requestPermission({ mode: "read" }));
  } catch {
    return "denied";
  }
}

export async function requireLocalDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  options: { request?: boolean } = {},
): Promise<LocalDirectoryPermissionState> {
  const current = await queryLocalDirectoryPermission(handle);
  if (current !== "prompt" || !options.request) return current;
  return requestLocalDirectoryPermission(handle);
}