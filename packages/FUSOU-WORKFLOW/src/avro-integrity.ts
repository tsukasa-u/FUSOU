import { parseOcfHeader } from "@fusou/compaction-core";

export function inspectAvroFrames(bytes: Uint8Array): { recordCount: number; codec: string } {
  const header = parseOcfHeader(bytes);
  let offset = header.bodyOffset;
  const readLong = () => {
    let raw = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated Avro block framing");
      raw |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) {
        const value = Number(raw & 1n ? -(raw + 1n) / 2n : raw / 2n);
        if (!Number.isSafeInteger(value)) throw new Error("Unsafe Avro block size/count");
        return value;
      }
    }
    throw new Error("Invalid Avro block varint");
  };
  let recordCount = 0;
  while (offset < bytes.byteLength) {
    const count = readLong();
    const size = readLong();
    if (count <= 0 || size < 0 || size > bytes.byteLength - offset - 16) {
      throw new Error("Invalid Avro block size/count");
    }
    offset += size;
    for (let i = 0; i < 16; i++) {
      if (bytes[offset + i] !== header.syncMarker[i]) throw new Error("Avro sync marker mismatch");
    }
    offset += 16;
    recordCount += count;
    if (!Number.isSafeInteger(recordCount)) throw new Error("Unsafe Avro record count");
  }
  return { recordCount, codec: header.codec ?? "null" };
}
