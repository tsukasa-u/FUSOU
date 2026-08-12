import { MASTER_DATA_TABLES, PUBLIC_RECORD_TABLES } from "../contracts";

export type LocalAvroStorageKind = "master_data" | "transaction_data";

export type ParsedLocalAvroPath = {
  relativePath: string;
  periodTag: string;
  storageKind: LocalAvroStorageKind;
  table: string;
  mapAreaId?: number;
  mapInfoNo?: number;
  fileTimestamp?: number;
  fileUuid?: string;
};

export type LocalAvroFileEntry = ParsedLocalAvroPath & {
  id: string;
  tableVersion: string | null;
  size: number;
  lastModified: number;
};

export type LocalAvroPathErrorCode =
  | "INVALID_DIRECTORY_LAYOUT"
  | "UNKNOWN_TABLE";

export class LocalAvroPathError extends Error {
  constructor(
    readonly code: LocalAvroPathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocalAvroPathError";
  }
}

const PERIOD_TAG_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAP_FOLDER_PATTERN = /^(-?\d+)-(-?\d+)$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRelativePath(relativePath: string): string[] {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO path is outside the supported directory layout",
    );
  }

  return normalized.split("/");
}

function parsePeriodTag(value: string): string {
  if (!PERIOD_TAG_PATTERN.test(value)) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO path contains an invalid period tag",
    );
  }
  return value;
}

function parseTable(value: string, storageKind: LocalAvroStorageKind): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO path contains an invalid table name",
    );
  }

  const known =
    storageKind === "master_data"
      ? MASTER_DATA_TABLES.has(value)
      : PUBLIC_RECORD_TABLES.has(value);
  if (!known) {
    throw new LocalAvroPathError(
      "UNKNOWN_TABLE",
      "AVRO path contains an unsupported table",
    );
  }
  return value;
}

export function parseLocalAvroPath(relativePath: string): ParsedLocalAvroPath {
  const parts = normalizeRelativePath(relativePath);
  const layoutStart = parts[0] === "fusou" ? 1 : 0;
  const layout = parts.slice(layoutStart);

  if (layout.length < 3 || !parts[layoutStart]) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO path does not match the APP layout",
    );
  }

  const periodTag = parsePeriodTag(layout[0]);
  const storageKind = layout[1];

  if (storageKind === "master_data") {
    if (layout.length !== 3 || !layout[2].endsWith(".avro")) {
      throw new LocalAvroPathError(
        "INVALID_DIRECTORY_LAYOUT",
        "AVRO master path does not match the APP layout",
      );
    }

    return {
      relativePath: parts.join("/"),
      periodTag,
      storageKind,
      table: parseTable(layout[2].slice(0, -5), storageKind),
    };
  }

  if (storageKind !== "transaction_data" || layout.length !== 5) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO transaction path does not match the APP layout",
    );
  }

  const mapMatch = MAP_FOLDER_PATTERN.exec(layout[2]);
  const fileMatch = /^(\d+)_([^/]+)\.avro$/.exec(layout[4]);
  if (!mapMatch || !fileMatch || !UUID_PATTERN.test(fileMatch[2])) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO transaction path contains an invalid map or filename",
    );
  }

  const fileTimestamp = Number(fileMatch[1]);
  const mapAreaId = Number(mapMatch[1]);
  const mapInfoNo = Number(mapMatch[2]);
  if (
    !Number.isSafeInteger(fileTimestamp) ||
    !Number.isSafeInteger(mapAreaId) ||
    !Number.isSafeInteger(mapInfoNo)
  ) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO transaction path contains an unsafe numeric identifier",
    );
  }

  return {
    relativePath: parts.join("/"),
    periodTag,
    storageKind,
    mapAreaId,
    mapInfoNo,
    fileTimestamp,
    fileUuid: fileMatch[2].toLowerCase(),
    table: parseTable(layout[3], storageKind),
  };
}

export function createLocalAvroFileEntry(
  parsedPath: ParsedLocalAvroPath,
  metadata: { size: number; lastModified: number },
): LocalAvroFileEntry {
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO file size is invalid",
    );
  }
  if (!Number.isFinite(metadata.lastModified) || metadata.lastModified < 0) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO file modification time is invalid",
    );
  }

  return {
    ...parsedPath,
    id: `${parsedPath.relativePath}\0${metadata.size}\0${metadata.lastModified}`,
    tableVersion: null,
    size: metadata.size,
    lastModified: metadata.lastModified,
  };
}