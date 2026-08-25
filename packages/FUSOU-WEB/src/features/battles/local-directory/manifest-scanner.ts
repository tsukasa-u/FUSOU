import { PUBLIC_RECORD_TABLES } from "../contracts";
import { parseOcfHeader } from "@/features/avro/ocf-header";
import {
  createLocalAvroFileEntry,
  LocalAvroPathError,
  parseLocalAvroPath,
} from "./manifest";
import {
  MAX_FILE_BYTES,
  MAX_MANIFEST_FILES,
  normalizeLocalAvroLoadLimits,
  type LocalAvroLoadLimits,
} from "./limits";
import type { LocalManifestEntry, SerializableManifest } from "../local-worker/protocol";

export type ManifestDiagnostic = {
  code: "IGNORED_FILE" | "INVALID_DIRECTORY_LAYOUT" | "UNKNOWN_TABLE";
  kind: "file" | "path";
};

export type ManifestScanErrorCode =
  | "FILE_LIMIT_EXCEEDED"
  | "FILE_TOO_LARGE"
  | "MANIFEST_SIZE_EXCEEDED"
  | "PERMISSION_DENIED";

export class ManifestScanError extends Error {
  constructor(
    readonly code: ManifestScanErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ManifestScanError";
  }
}

export type ManifestScanResult = {
  manifest: SerializableManifest;
  diagnostics: ManifestDiagnostic[];
  fileCount: number;
  totalBytes: number;
};

export type ManifestScanProgress = {
  phase: "file-discovery" | "manifest-validation";
  completed: number;
  total?: number;
};

export type ManifestScanOptions = {
  onProgress?: (progress: ManifestScanProgress) => void;
  limits?: Partial<LocalAvroLoadLimits>;
};

type DirectoryEntry = FileSystemDirectoryHandle | FileSystemFileHandle;
const MAX_HEADER_BYTES = 64 * 1024;

function isDirectoryHandle(entry: DirectoryEntry): entry is FileSystemDirectoryHandle {
  return entry.kind === "directory";
}

function isFileHandle(entry: DirectoryEntry): entry is FileSystemFileHandle {
  return entry.kind === "file";
}

function canonicalPath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createFingerprint(entries: LocalManifestEntry[]): string {
  return hashString(
    entries
      .map((entry) => `${entry.id}\0${entry.table}\0${entry.periodTag}`)
      .sort()
      .join("\0"),
  );
}

function shouldScanRoot(handle: FileSystemDirectoryHandle): boolean {
  return handle.name === "fusou";
}

async function readEmbeddedTableVersion(file: File): Promise<string | null> {
  const headerBytes = new Uint8Array(
    await file.slice(0, MAX_HEADER_BYTES).arrayBuffer(),
  );
  if (
    headerBytes.length < 4 ||
    headerBytes[0] !== 0x4f ||
    headerBytes[1] !== 0x62 ||
    headerBytes[2] !== 0x6a ||
    headerBytes[3] !== 0x01
  ) {
    return null;
  }
  try {
    const metadata = parseOcfHeader(headerBytes).metadata;
    for (const key of ["table_version", "table.version", "fusou.table_version"]) {
      const value = metadata[key]?.trim();
      if (value) return value;
    }
  } catch {
    // Full schema and codec validation remains in the worker before decoding.
  }
  return null;
}

async function parseEntry(
  relativePath: string,
  file: File,
  handle?: FileSystemFileHandle,
): Promise<LocalManifestEntry | null> {
  if (!relativePath.endsWith(".avro")) return null;
  const parsed = parseLocalAvroPath(relativePath);
  if (
    parsed.storageKind === "transaction_data" &&
    !PUBLIC_RECORD_TABLES.has(parsed.table)
  ) {
    return null;
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ManifestScanError(
      "FILE_TOO_LARGE",
      "AVRO file size exceeds the local reader limit",
    );
  }
  return {
    ...createLocalAvroFileEntry(parsed, {
      size: file.size,
      lastModified: file.lastModified,
      tableVersion: await readEmbeddedTableVersion(file),
    }),
    ...(handle ? { handle } : { file }),
  };
}

async function scanDirectory(
  directory: FileSystemDirectoryHandle,
  prefix: string,
  entries: LocalManifestEntry[],
  diagnostics: ManifestDiagnostic[],
  options: ManifestScanOptions,
  sizeState: { totalBytes: number },
): Promise<void> {
  const limits = normalizeLocalAvroLoadLimits(options.limits);
  const iterableDirectory = directory as unknown as {
    entries: () => AsyncIterableIterator<[string, DirectoryEntry]>;
  };
  for await (const [name, child] of iterableDirectory.entries()) {
    if (entries.length >= MAX_MANIFEST_FILES) {
      throw new ManifestScanError(
        "FILE_LIMIT_EXCEEDED",
        "local AVRO manifest exceeds the file limit",
      );
    }
    const path = canonicalPath(prefix, name);
    if (isDirectoryHandle(child)) {
      await scanDirectory(child, path, entries, diagnostics, options, sizeState);
      continue;
    }
    if (!isFileHandle(child) || !name.endsWith(".avro")) continue;
    options.onProgress?.({
      phase: "file-discovery",
      completed: entries.length,
    });
    try {
      const file = await child.getFile();
      const entry = await parseEntry(path, file, child);
      if (entry) {
        sizeState.totalBytes += entry.size;
        if (sizeState.totalBytes > limits.maxManifestBytes) {
          throw new ManifestScanError(
            "MANIFEST_SIZE_EXCEEDED",
            "local AVRO manifest exceeds the aggregate size limit",
          );
        }
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof ManifestScanError) throw error;
      if (error instanceof LocalAvroPathError) {
        diagnostics.push({ code: error.code === "UNKNOWN_TABLE" ? "UNKNOWN_TABLE" : "INVALID_DIRECTORY_LAYOUT", kind: "path" });
      } else {
        throw new ManifestScanError(
          "PERMISSION_DENIED",
          "ローカル AVRO への読み取り権限が失われました。",
        );
      }
    }
  }
}

export async function scanLocalDirectoryHandle(
  root: FileSystemDirectoryHandle,
  options: ManifestScanOptions = {},
): Promise<ManifestScanResult> {
  const entries: LocalManifestEntry[] = [];
  const diagnostics: ManifestDiagnostic[] = [];
  const sizeState = { totalBytes: 0 };
  await scanDirectory(
    root,
    shouldScanRoot(root) ? "fusou" : "",
    entries,
    diagnostics,
    options,
    sizeState,
  );
  return buildManifestResult(entries, diagnostics, options);
}

export async function scanLocalFileList(
  files: Iterable<File>,
  options: ManifestScanOptions = {},
): Promise<ManifestScanResult> {
  const entries: LocalManifestEntry[] = [];
  const diagnostics: ManifestDiagnostic[] = [];
  const limits = normalizeLocalAvroLoadLimits(options.limits);
  let totalBytes = 0;
  for (const file of files) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!relativePath || !relativePath.endsWith(".avro")) continue;
    options.onProgress?.({
      phase: "file-discovery",
      completed: entries.length,
    });
    try {
      const entry = await parseEntry(relativePath, file);
      if (entry) {
        totalBytes += entry.size;
        if (totalBytes > limits.maxManifestBytes) {
          throw new ManifestScanError(
            "MANIFEST_SIZE_EXCEEDED",
            "local AVRO manifest exceeds the aggregate size limit",
          );
        }
        entries.push(entry);
      }
    } catch (error) {
      if (error instanceof ManifestScanError) throw error;
      if (error instanceof LocalAvroPathError) {
        diagnostics.push({ code: error.code === "UNKNOWN_TABLE" ? "UNKNOWN_TABLE" : "INVALID_DIRECTORY_LAYOUT", kind: "path" });
      } else {
        diagnostics.push({ code: "IGNORED_FILE", kind: "file" });
      }
    }
    if (entries.length > MAX_MANIFEST_FILES) {
      throw new ManifestScanError(
        "FILE_LIMIT_EXCEEDED",
        "local AVRO manifest exceeds the file limit",
      );
    }
  }
  return buildManifestResult(entries, diagnostics, options);
}

function buildManifestResult(
  entries: LocalManifestEntry[],
  diagnostics: ManifestDiagnostic[],
  options: ManifestScanOptions,
): ManifestScanResult {
  options.onProgress?.({
    phase: "manifest-validation",
    completed: entries.length,
    total: entries.length,
  });
  if (!entries.some((entry) => entry.table === "battle")) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "local AVRO directory does not contain a battle table",
    );
  }
  const totalBytes = entries.reduce((total, entry) => total + entry.size, 0);
  return {
    manifest: {
      entries,
      fingerprint: createFingerprint(entries),
      limits: normalizeLocalAvroLoadLimits(options.limits),
    },
    diagnostics,
    fileCount: entries.length,
    totalBytes,
  };
}