import assert from "node:assert/strict";
import test from "node:test";
import { mergeAvroOCFWithBoundaries } from "../dist/index.js";
import { parseOcfHeader } from "../dist/avro.js";

function encodeLong(value) {
  let encoded = value >= 0 ? value * 2 : -value * 2 - 1;
  const bytes = [];
  while (encoded > 0x7f) {
    bytes.push((encoded & 0x7f) | 0x80);
    encoded = Math.floor(encoded / 128);
  }
  bytes.push(encoded);
  return Uint8Array.from(bytes);
}

function encodeBytes(value) {
  const bytes = new TextEncoder().encode(value);
  return Uint8Array.from([...encodeLong(bytes.length), ...bytes]);
}

function createOcf(schema, marker, codec = "null") {
  const metadata = [
    ["avro.schema", JSON.stringify(schema)],
    ["avro.codec", codec],
  ];
  const header = [
    0x4f,
    0x62,
    0x6a,
    0x01,
    ...encodeLong(metadata.length),
    ...metadata.flatMap(([key, value]) => [
      ...encodeBytes(key),
      ...encodeBytes(value),
    ]),
    ...encodeLong(0),
    ...marker,
  ];
  return Uint8Array.from(header);
}

test("mergeAvroOCFWithBoundaries merges headers with compatible schemas", () => {
  const schema = { type: "record", name: "Test", fields: [] };
  const first = createOcf(schema, Array(16).fill(1));
  const second = createOcf(schema, Array(16).fill(2));

  const result = mergeAvroOCFWithBoundaries([first, second]);

  assert.equal(result.headerSize, parseOcfHeader(first).bodyOffset);
  assert.deepEqual(result.boundaries, [
    { sourceIndex: 0, startByte: result.headerSize, length: 0 },
    { sourceIndex: 1, startByte: result.headerSize, length: 0 },
  ]);
  assert.deepEqual(result.merged, first);
});

test("mergeAvroOCFWithBoundaries rejects incompatible schemas", () => {
  const first = createOcf(
    { type: "record", name: "First", fields: [] },
    Array(16).fill(1),
  );
  const second = createOcf(
    { type: "record", name: "Second", fields: [] },
    Array(16).fill(2),
  );

  assert.throws(
    () => mergeAvroOCFWithBoundaries([first, second]),
    /incompatible Avro schemas/,
  );
});
