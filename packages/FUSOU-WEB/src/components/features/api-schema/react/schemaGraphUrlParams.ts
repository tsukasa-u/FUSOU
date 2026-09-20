import type { GraphMode } from "./schemaGraphTypes";

export interface GraphSelection {
  mode: GraphMode;
  selectedMajor: string;
  dbVersion: string;
  endpointVersion: string;
  selectedGroup: string;
  selectedEndpoint: string;
}

export interface SelectionMetadata {
  allDbVersions: string[];
  majorVersions: Record<string, { versions: string[]; latest: string }>;
  defaultMajor: string;
  defaultDbVersion: string;
  endpointGroups: Record<string, { endpoints: { name: string }[] }>;
  allFeatures: string[];
  activeFeatures: string[];
  defaultEndpointVersion?: string;
}

/**
 * Extract chronological date value for an epoch feature.
 * - "epoch_YYYYMMDD": returns YYYYMMDD as an integer (e.g. 20250627)
 * - "genesis": returns 0 (earliest / baseline)
 * - unknown strings: returns -1
 */
export function getEpochDate(feature: string): number {
  if (feature === "genesis") {
    return 0;
  }
  const match = feature.match(/^epoch_(\d{8})/);
  if (match && match[1] !== undefined) {
    return parseInt(match[1], 10);
  }
  return -1;
}

/**
 * Sorts epoch feature strings in chronological order (earliest to latest).
 * Genesis (0) -> older epochs -> newer epochs.
 */
export function sortEpochFeatures(features: string[]): string[] {
  return [...features].sort((a, b) => {
    const dateA = getEpochDate(a);
    const dateB = getEpochDate(b);
    if (dateA !== dateB) {
      return dateA - dateB;
    }
    return a.localeCompare(b);
  });
}

/**
 * Returns the latest epoch feature (the one with the newest epoch date).
 */
export function getLatestEpochFeature(features: string[]): string {
  if (features.length === 0) return "";
  const sorted = sortEpochFeatures(features);
  return sorted[sorted.length - 1] ?? "";
}

export function findMajorForVersion(
  version: string,
  majorVersions: Record<string, { versions: string[] }>,
): string | null {
  for (const [major, info] of Object.entries(majorVersions)) {
    if (info.versions.includes(version)) {
      return major;
    }
  }
  return null;
}

export function parseSelectionFromUrl(
  search: string,
  meta: SelectionMetadata,
  initialMode: GraphMode = "database",
): GraphSelection {
  const params = new URLSearchParams(search);
  const paramMode = params.get("mode");
  const paramGroup = params.get("group");
  const paramEndpoint = params.get("endpoint");
  const paramVersion = params.get("version");

  // Determine mode
  let mode: GraphMode = initialMode;
  if (paramMode === "database" || paramMode === "endpoints") {
    mode = paramMode;
  } else if (paramGroup || paramEndpoint) {
    mode = "endpoints";
  } else if (paramVersion && meta.allDbVersions.includes(paramVersion)) {
    mode = "database";
  }

  // Database version resolution
  let dbVersion = meta.defaultDbVersion;
  let selectedMajor = meta.defaultMajor;
  if (paramVersion && meta.allDbVersions.includes(paramVersion)) {
    dbVersion = paramVersion;
    const foundMajor = findMajorForVersion(paramVersion, meta.majorVersions);
    if (foundMajor) selectedMajor = foundMajor;
  }

  // Endpoint group and endpoint resolution
  let selectedGroup = "";
  let selectedEndpoint = "";
  if (paramGroup && meta.endpointGroups[paramGroup]) {
    selectedGroup = paramGroup;
    const epList = meta.endpointGroups[paramGroup].endpoints.map((e) => e.name);
    if (paramEndpoint && epList.includes(paramEndpoint)) {
      selectedEndpoint = paramEndpoint;
    } else if (epList.length > 0) {
      selectedEndpoint = epList[0] ?? "";
    }
  }

  // Endpoint version resolution (default to latest epoch date)
  const defaultEndpointVersion =
    meta.defaultEndpointVersion ??
    getLatestEpochFeature(meta.allFeatures);
  let endpointVersion = defaultEndpointVersion;
  if (paramVersion && meta.allFeatures.includes(paramVersion)) {
    endpointVersion = paramVersion;
  }

  return {
    mode,
    selectedMajor,
    dbVersion,
    endpointVersion,
    selectedGroup,
    selectedEndpoint,
  };
}

export function buildSearchString(
  selection: GraphSelection,
  currentSearch: string = "",
): string {
  const params = new URLSearchParams(currentSearch);

  params.set("mode", selection.mode);

  if (selection.mode === "database") {
    if (selection.dbVersion) {
      params.set("version", selection.dbVersion);
    } else {
      params.delete("version");
    }
    params.delete("group");
    params.delete("endpoint");
  } else {
    if (selection.selectedGroup) {
      params.set("group", selection.selectedGroup);
    } else {
      params.delete("group");
    }
    if (selection.selectedEndpoint) {
      params.set("endpoint", selection.selectedEndpoint);
    } else {
      params.delete("endpoint");
    }
    if (selection.endpointVersion) {
      params.set("version", selection.endpointVersion);
    } else {
      params.delete("version");
    }
  }

  return params.toString();
}
