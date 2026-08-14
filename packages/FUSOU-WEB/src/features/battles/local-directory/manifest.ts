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

  const storageKind = layout[1];
  const periodValue = layout[0];
  if (!periodValue || !storageKind) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO path does not match the APP layout",
    );
  }
  const periodTag = parsePeriodTag(periodValue);

  if (storageKind === "master_data") {
    const masterFile = layout[2];
    if (layout.length !== 3 || !masterFile || !masterFile.endsWith(".avro")) {
      throw new LocalAvroPathError(
        "INVALID_DIRECTORY_LAYOUT",
        "AVRO master path does not match the APP layout",
      );
    }

    return {
      relativePath: parts.join("/"),
      periodTag,
      storageKind,
      table: parseTable(masterFile.slice(0, -5), storageKind),
    };
  }

  if (storageKind !== "transaction_data" || layout.length !== 5) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO transaction path does not match the APP layout",
    );
  }

  const mapFolder = layout[2];
  const tableName = layout[3];
  const fileName = layout[4];
  const mapMatch = mapFolder ? MAP_FOLDER_PATTERN.exec(mapFolder) : null;
  const fileMatch = fileName
    ? /^(\d+)_([^/]+)\.avro$/.exec(fileName)
    : null;
  const mapAreaValue = mapMatch?.[1];
  const mapInfoValue = mapMatch?.[2];
  const fileTimestampValue = fileMatch?.[1];
  const fileUuidValue = fileMatch?.[2];
  if (
    !mapMatch ||
    !fileMatch ||
    !tableName ||
    !mapAreaValue ||
    !mapInfoValue ||
    !fileTimestampValue ||
    !fileUuidValue ||
    !UUID_PATTERN.test(fileUuidValue)
  ) {
    throw new LocalAvroPathError(
      "INVALID_DIRECTORY_LAYOUT",
      "AVRO transaction path contains an invalid map or filename",
    );
  }

  const fileTimestamp = Number(fileTimestampValue);
  const mapAreaId = Number(mapAreaValue);
  const mapInfoNo = Number(mapInfoValue);
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
    fileUuid: fileUuidValue.toLowerCase(),
    table: parseTable(tableName, storageKind),
  };
}

export function createLocalAvroFileEntry(
  parsedPath: ParsedLocalAvroPath,
  metadata: { size: number; lastModified: number; tableVersion?: string | null },
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
    tableVersion: metadata.tableVersion ?? null,
    size: metadata.size,
    lastModified: metadata.lastModified,
  };
}