export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const DEFAULT_MAX_MANIFEST_BYTES = 2 * 1024 * 1024 * 1024;
export const ABSOLUTE_MAX_MANIFEST_BYTES = 64 * 1024 * 1024 * 1024;
export const MAX_MANIFEST_FILES = 100_000;
export const DEFAULT_MAX_QUERY_RECORDS = 20_000;
export const ABSOLUTE_MAX_QUERY_RECORDS = 1_000_000;
export const MAX_DECODE_CONCURRENCY = 2;

export type LocalAvroLoadLimits = {
	maxManifestBytes: number;
	maxQueryRecords: number;
};

export const DEFAULT_LOCAL_AVRO_LOAD_LIMITS: LocalAvroLoadLimits = {
	maxManifestBytes: DEFAULT_MAX_MANIFEST_BYTES,
	maxQueryRecords: DEFAULT_MAX_QUERY_RECORDS,
};

export function normalizeLocalAvroLoadLimits(
	value: Partial<LocalAvroLoadLimits> | null | undefined,
): LocalAvroLoadLimits {
	const maxManifestBytes = Number(value?.maxManifestBytes);
	const maxQueryRecords = Number(value?.maxQueryRecords);
	return {
		maxManifestBytes:
			Number.isSafeInteger(maxManifestBytes) && maxManifestBytes > 0
				? Math.min(maxManifestBytes, ABSOLUTE_MAX_MANIFEST_BYTES)
				: DEFAULT_MAX_MANIFEST_BYTES,
		maxQueryRecords:
			Number.isSafeInteger(maxQueryRecords) && maxQueryRecords > 0
				? Math.min(maxQueryRecords, ABSOLUTE_MAX_QUERY_RECORDS)
				: DEFAULT_MAX_QUERY_RECORDS,
	};
}