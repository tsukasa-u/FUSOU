export {
  AvroOcfError,
  decodeAvroDataBlocksWithContext,
  decodeAvroOcfToJson,
  decodeAvroOcfToJsonAsync,
  parseDeflateAvroBlock,
  parseDeflateAvroBlockWithContext,
  parseNullAvroBlock,
  parseNullAvroBlockWithContext,
  prepareAvroDecoderContext,
} from "@fusou/compaction-core";

export type {
  AvroJsonRecord,
  AvroJsonValue,
  AvroOcfErrorCode,
  PreparedAvroDecoderContext,
} from "@fusou/compaction-core";