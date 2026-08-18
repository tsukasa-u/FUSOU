import { describe, expect, it } from "vitest";
import { parseGraphData } from "./schemaGraphTypes";

describe("schema graph runtime parser", () => {
  it("accepts a generated React Flow graph", () => {
    const graph = parseGraphData({
      nodes: [
        {
          id: "db:mst_ship",
          position: { x: 0, y: 0 },
          type: "schemaTable",
          data: {
            tableName: "mst_ship",
            recordName: "MstShip",
            fields: [{ name: "id", type: "i32", isKey: true }],
          },
        },
      ],
      edges: [],
    });

    const nodeData = graph.nodes[0]?.data;
    expect(nodeData && "tableName" in nodeData ? nodeData.tableName : undefined).toBe(
      "mst_ship",
    );
  });

  it("rejects malformed generated graph data", () => {
    expect(() => parseGraphData({ nodes: [{ id: "broken" }], edges: [] })).toThrow();
  });
});