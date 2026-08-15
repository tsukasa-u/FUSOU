export {
  AvroOcfError,
  OcfHeaderError,
  decodeAvroOcfToJson,
  decodeAvroOcfToJsonAsync,
  getAvroHeaderLength,
  getAvroHeaderLengthFromPrefix,
  parseAllDeflateAvroBlocks,
  parseAllNullAvroBlocks,
  parseDeflateAvroBlock,
  parseNullAvroBlock,
  parseOcfHeader,
} from "@fusou/compaction-core";

export type {
  AvroJsonRecord,
  AvroJsonValue,
  AvroOcfErrorCode,
  AvroSchema,
  OcfHeader,
} from "@fusou/compaction-core";

export {
  buildAvroContainer,
  buildHeaderWithSchema,
  buildNullBlock,
  buildOCFWithSchema,
  computeSchemaFingerprint,
  encodeRecordWithSchema,
} from "./avro-builders.js";

export type { AvroSchemaInput } from "./avro-builders.js";
