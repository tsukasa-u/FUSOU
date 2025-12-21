import * as avro from 'avsc';

const avroNS: any = (avro as any).default || avro;

// Build a simple Avro OCF (Object Container File) from schema and records.
export function buildAvroContainerFromRecords(records: any[]): Uint8Array {
  if (!Array.isArray(records) || records.length === 0) throw new Error('No records');
  const type = avroNS.Type.forValue(records[0]);
  // Use avsc toBuffer for each record and construct an OCF-like container.
  const chunks: Uint8Array[] = [];
  // magic
  chunks.push(new Uint8Array([0x4f, 0x62, 0x6a, 0x01]));
  // metadata map
  const schemaJson = JSON.stringify(type.schema());
  const schemaBuf = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from(schemaJson) : new TextEncoder().encode(schemaJson);
  const codecBuf = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from('null') : new TextEncoder().encode('null');
  const metadataObj: Record<string, any> = { 'avro.schema': schemaBuf, 'avro.codec': codecBuf };
  const metadataType = avroNS.Type.forSchema({ type: 'map', values: 'bytes' });
  const metaBuf = metadataType.toBuffer ? metadataType.toBuffer(metadataObj) : (() => { const tmp = new Uint8Array(16384); const len = metadataType.encode(metadataObj, tmp, 0); return tmp.subarray(0, len); })();
  chunks.push(new Uint8Array(metaBuf));
  // sync marker
  const sync = new Uint8Array(16);
  for (let i = 0; i < 16; i++) sync[i] = Math.floor(Math.random() * 256);
  chunks.push(sync);

  // For simplicity produce a single block with count and size and raw records
  const recordsBufs: Uint8Array[] = [];
  let total = 0;
  for (const r of records) {
    const rb = (type as any).toBuffer(r);
    const uba = new Uint8Array(rb);
    recordsBufs.push(uba);
    total += uba.length;
  }
  const longType = avroNS.Type.forSchema('long');
  const countBuf = longType.toBuffer ? longType.toBuffer(records.length) : (() => { const tmp = new Uint8Array(16); const len = longType.encode(records.length, tmp, 0); return tmp.subarray(0, len); })();
  const sizeBuf = longType.toBuffer ? longType.toBuffer(total) : (() => { const tmp = new Uint8Array(16); const len = longType.encode(total, tmp, 0); return tmp.subarray(0, len); })();
  chunks.push(new Uint8Array(countBuf));
  chunks.push(new Uint8Array(sizeBuf));
  for (const b of recordsBufs) chunks.push(b);
  chunks.push(sync);

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Parse Avro OCF header length from a prefix buffer (Node Buffer or Uint8Array)
export function getAvroHeaderLengthFromPrefix(prefix: Uint8Array): number {
  if (!prefix || prefix.length < 4) throw new Error('prefix too small');
  // ensure magic
  if (prefix[0] !== 0x4f || prefix[1] !== 0x62 || prefix[2] !== 0x6a || prefix[3] !== 0x01) throw new Error('invalid magic');
  const nodeBuf: any = typeof (globalThis as any).Buffer !== 'undefined' ? (globalThis as any).Buffer.from(prefix) : prefix;
  const metaType = avroNS.Type.forSchema({ type: 'map', values: 'bytes' });
  const res = metaType.decode(nodeBuf, 4);
  const offset = res.offset;
  const headerEnd = offset + 16; // sync
  if (headerEnd > nodeBuf.length) throw new Error('prefix too small for header');
  return headerEnd;
}
