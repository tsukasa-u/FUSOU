import * as avro from 'avsc';
const avroNS: any = (avro as any).default || avro;

function ensureMagic(buffer: Uint8Array) {
  if (buffer.length < 4) {
    throw new Error('Invalid Avro file: too small');
  }
  if (buffer[0] !== 0x4f || buffer[1] !== 0x62 || buffer[2] !== 0x6a || buffer[3] !== 0x01) {
    throw new Error('Invalid Avro file: missing magic bytes');
  }
}

function parseHeaderLength(buffer: Uint8Array): number {
  ensureMagic(buffer);

  // avsc expects a Node Buffer for many operations. Use Buffer when available
  // (Node test/runtime). In environments without Buffer (Cloudflare Workers),
  // fall back to passing the Uint8Array directly — the bundler/runtime
  // should provide a compatible Buffer-like object if avsc is used there.
  const nodeBuf: any = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from(buffer) : buffer;

  const metadataDecoder = avroNS.Type.forSchema({
    type: 'map',
    values: 'bytes',
  }) as any;
  const metadataResult = metadataDecoder.decode(nodeBuf, 4);
  const offset = metadataResult.offset;
  const headerEnd = offset + 16; // sync marker length
  if (headerEnd > (nodeBuf.length || buffer.length)) {
    throw new Error('Invalid Avro file: truncated sync marker');
  }
  return headerEnd;
}

function encodeAvroFile(schema: avro.Type, records: any[]): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Magic bytes
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));

  // Metadata map (variable size, avoid fixed buffers)
  const schemaJson = JSON.stringify(schema.schema());
  const schemaBytes = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from(schemaJson) : new TextEncoder().encode(schemaJson);
  const codecBytes = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from('null') : new TextEncoder().encode('null');

  const metadata: Record<string, any> = {
    'avro.schema': schemaBytes,
    'avro.codec': codecBytes,
  };

  const metadataEncoder = avroNS.Type.forSchema({
    type: 'map',
    values: 'bytes',
  }) as any;
  const metadataBuf = metadataEncoder.toBuffer
    ? metadataEncoder.toBuffer(metadata)
    : (() => {
        const tmp = new Uint8Array(16384);
        const len = metadataEncoder.encode(metadata, tmp, 0);
        return tmp.subarray(0, len);
      })();
  chunks.push(new Uint8Array(metadataBuf));

  // Sync marker
  const syncMarker = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    syncMarker[i] = Math.floor(Math.random() * 256);
  }
  chunks.push(syncMarker);

  // Data blocks (encode each record to its own buffer to avoid overflow)
  const blockRecords: Uint8Array[] = [];
  let totalBlockSize = 0;

  for (const record of records) {
    const recordBuf: any = (schema as any).toBuffer(record);
    const asUint8 = recordBuf instanceof Uint8Array ? new Uint8Array(recordBuf) : new Uint8Array(recordBuf);
    blockRecords.push(asUint8);
    totalBlockSize += asUint8.length;
  }

  const countEncoder = avroNS.Type.forSchema('long') as any;
  const countBuf = countEncoder.toBuffer
    ? countEncoder.toBuffer(records.length)
    : (() => {
        const tmp = new Uint8Array(16);
        const len = countEncoder.encode(records.length, tmp, 0);
        return tmp.subarray(0, len);
      })();
  chunks.push(new Uint8Array(countBuf));

  const sizeEncoder = avroNS.Type.forSchema('long') as any;
  const sizeBuf = sizeEncoder.toBuffer
    ? sizeEncoder.toBuffer(totalBlockSize)
    : (() => {
        const tmp = new Uint8Array(16);
        const len = sizeEncoder.encode(totalBlockSize, tmp, 0);
        return tmp.subarray(0, len);
      })();
  chunks.push(new Uint8Array(sizeBuf));

  chunks.push(...blockRecords);
  chunks.push(syncMarker);

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const finalBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return finalBuffer;
}

export function buildAvroContainer(records: any[]): Uint8Array {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('Cannot build Avro container without records');
  }
  const schema = avroNS.Type.forValue(records[0]);
  return encodeAvroFile(schema, records);
}

export function getAvroHeaderLength(buffer: Uint8Array): number {
  return parseHeaderLength(buffer);
}

/**
 * Extract Avro header length from a prefix buffer (range GET friendly).
 * Caller must supply enough bytes to cover metadata + 16-byte sync marker.
 */
export function getAvroHeaderLengthFromPrefix(prefix: Uint8Array): number {
  return parseHeaderLength(prefix);
}
