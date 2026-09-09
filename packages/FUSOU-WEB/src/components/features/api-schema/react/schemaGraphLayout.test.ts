import { describe, expect, it } from "vitest";
import {
  applyDagreLayout,
  applyElkLayout,
  orderEdgesBySourceFields,
} from "./schemaGraphLayout";
import type { GraphEdge, GraphNode } from "./schemaGraphTypes";

describe("schema graph layout and edge ordering", () => {
  const mockNodes: GraphNode[] = [
    {
      id: "parentTable",
      position: { x: 0, y: 0 },
      type: "schemaTableNode",
      data: {
        tableName: "parent_table",
        recordName: "ParentTable",
        fields: [
          { name: "alpha_id", type: "uuid", isFk: true },
          { name: "beta_id", type: "uuid", isFk: true },
          { name: "gamma_id", type: "uuid", isFk: true },
          { name: "delta_id", type: "uuid", isFk: true },
        ],
      },
    },
    {
      id: "tableAlpha",
      position: { x: 0, y: 0 },
      type: "schemaTableNode",
      data: {
        tableName: "table_alpha",
        recordName: "TableAlpha",
        fields: [{ name: "id", type: "uuid", isKey: true }],
      },
    },
    {
      id: "tableBeta",
      position: { x: 0, y: 0 },
      type: "schemaTableNode",
      data: {
        tableName: "table_beta",
        recordName: "TableBeta",
        fields: [{ name: "id", type: "uuid", isKey: true }],
      },
    },
    {
      id: "tableGamma",
      position: { x: 0, y: 0 },
      type: "schemaTableNode",
      data: {
        tableName: "table_gamma",
        recordName: "TableGamma",
        fields: [{ name: "id", type: "uuid", isKey: true }],
      },
    },
    {
      id: "tableDelta",
      position: { x: 0, y: 0 },
      type: "schemaTableNode",
      data: {
        tableName: "table_delta",
        recordName: "TableDelta",
        fields: [{ name: "id", type: "uuid", isKey: true }],
      },
    },
  ];

  const mockEdges: GraphEdge[] = [
    {
      id: "e-parentTable-alpha_id-tableAlpha",
      source: "parentTable",
      sourceHandle: "parentTable-alpha_id",
      target: "tableAlpha",
      targetHandle: "tableAlpha-uuid",
    },
    {
      id: "e-parentTable-beta_id-tableBeta",
      source: "parentTable",
      sourceHandle: "parentTable-beta_id",
      target: "tableBeta",
      targetHandle: "tableBeta-uuid",
    },
    {
      id: "e-parentTable-gamma_id-tableGamma",
      source: "parentTable",
      sourceHandle: "parentTable-gamma_id",
      target: "tableGamma",
      targetHandle: "tableGamma-uuid",
    },
    {
      id: "e-parentTable-delta_id-tableDelta",
      source: "parentTable",
      sourceHandle: "parentTable-delta_id",
      target: "tableDelta",
      targetHandle: "tableDelta-uuid",
    },
  ];

  it("orderEdgesBySourceFields sorts edges by the source field position", () => {
    // Pass edges in reverse order
    const shuffledEdges = [...mockEdges].reverse();
    const ordered = orderEdgesBySourceFields(mockNodes, shuffledEdges);

    expect(ordered.map((e) => e.target)).toEqual([
      "tableAlpha",
      "tableBeta",
      "tableGamma",
      "tableDelta",
    ]);
  });

  it("applyDagreLayout (LR) positions target tables in top-to-bottom order matching field sequence", () => {
    const layoutNodes = applyDagreLayout(mockNodes, mockEdges, "LR");
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

    const yAlpha = nodeMap.get("tableAlpha")!.position.y;
    const yBeta = nodeMap.get("tableBeta")!.position.y;
    const yGamma = nodeMap.get("tableGamma")!.position.y;
    const yDelta = nodeMap.get("tableDelta")!.position.y;

    // Target tables must be placed in strictly increasing Y order (top to bottom)
    expect(yAlpha).toBeLessThan(yBeta);
    expect(yBeta).toBeLessThan(yGamma);
    expect(yGamma).toBeLessThan(yDelta);
  });

  it("applyDagreLayout (TB) positions target tables in left-to-right order matching field sequence", () => {
    const layoutNodes = applyDagreLayout(mockNodes, mockEdges, "TB");
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

    const xAlpha = nodeMap.get("tableAlpha")!.position.x;
    const xBeta = nodeMap.get("tableBeta")!.position.x;
    const xGamma = nodeMap.get("tableGamma")!.position.x;
    const xDelta = nodeMap.get("tableDelta")!.position.x;

    // Target tables must be placed in strictly increasing X order (left to right)
    expect(xAlpha).toBeLessThan(xBeta);
    expect(xBeta).toBeLessThan(xGamma);
    expect(xGamma).toBeLessThan(xDelta);
  });

  it("ensures edges from same table do not cross in LR mode", () => {
    const layoutNodes = applyDagreLayout(mockNodes, mockEdges, "LR");
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

    const targetsInOrder = ["tableAlpha", "tableBeta", "tableGamma", "tableDelta"];
    const yPositions = targetsInOrder.map((id) => nodeMap.get(id)!.position.y);

    let crossings = 0;
    for (let i = 0; i < yPositions.length; i++) {
      for (let j = i + 1; j < yPositions.length; j++) {
        if (yPositions[i]! > yPositions[j]!) {
          crossings++;
        }
      }
    }
    expect(crossings).toBe(0);
  });

  it("applyElkLayout positions target tables without inverted crossings", async () => {
    const layoutNodes = await applyElkLayout(
      mockNodes,
      mockEdges,
      "elk-layered",
      "LR",
      "normal",
    );
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

    const targetsInOrder = [
      "tableAlpha",
      "tableBeta",
      "tableGamma",
      "tableDelta",
    ];
    const yPositions = targetsInOrder.map((id) => nodeMap.get(id)!.position.y);

    let crossings = 0;
    for (let i = 0; i < yPositions.length; i++) {
      for (let j = i + 1; j < yPositions.length; j++) {
        if (yPositions[i]! > yPositions[j]!) {
          crossings++;
        }
      }
    }
    expect(crossings).toBe(0);
  });
  it("ensures endpoint root direct children with differing subtree depths do not cross", () => {
    // Mimic an endpoint where ApiData has both leaf children and deep subtree children
    const epNodes: GraphNode[] = [
      {
        id: "endpoint__ApiData",
        position: { x: 0, y: 0 },
        type: "endpointNode",
        data: {
          structName: "ApiData", isReq: false, isRes: false, isDataType: true,
          fields: [
            { name: "api_deep_child_1", type: "ApiDeepChild1" },
            { name: "api_leaf_child", type: "ApiLeafChild" },
            { name: "api_deep_child_2", type: "ApiDeepChild2" },
          ],
        },
      },
      {
        id: "endpoint__ApiDeepChild1",
        position: { x: 0, y: 0 },
        type: "endpointNode",
        data: {
          structName: "ApiDeepChild1", isReq: false, isRes: false, isDataType: false,
          fields: [{ name: "sub_field", type: "ApiSubStage" }],
        },
      },
      {
        id: "endpoint__ApiLeafChild",
        position: { x: 0, y: 0 },
        type: "endpointNode",
        data: {
          structName: "ApiLeafChild", isReq: false, isRes: false, isDataType: false,
          fields: [{ name: "val", type: "i64" }],
        },
      },
      {
        id: "endpoint__ApiDeepChild2",
        position: { x: 0, y: 0 },
        type: "endpointNode",
        data: {
          structName: "ApiDeepChild2", isReq: false, isRes: false, isDataType: false,
          fields: [{ name: "sub_field", type: "ApiSubStage" }],
        },
      },
      {
        id: "endpoint__ApiSubStage",
        position: { x: 0, y: 0 },
        type: "endpointNode",
        data: {
          structName: "ApiSubStage", isReq: false, isRes: false, isDataType: false,
          fields: [{ name: "deep_leaf", type: "i64" }],
        },
      },
    ];

    const epEdges: GraphEdge[] = [
      {
        id: "e-ApiData-api_deep_child_1",
        source: "endpoint__ApiData",
        sourceHandle: "endpoint__ApiData-api_deep_child_1",
        target: "endpoint__ApiDeepChild1",
        targetHandle: "endpoint__ApiDeepChild1-ApiDeepChild1",
      },
      {
        id: "e-ApiData-api_leaf_child",
        source: "endpoint__ApiData",
        sourceHandle: "endpoint__ApiData-api_leaf_child",
        target: "endpoint__ApiLeafChild",
        targetHandle: "endpoint__ApiLeafChild-ApiLeafChild",
      },
      {
        id: "e-ApiData-api_deep_child_2",
        source: "endpoint__ApiData",
        sourceHandle: "endpoint__ApiData-api_deep_child_2",
        target: "endpoint__ApiDeepChild2",
        targetHandle: "endpoint__ApiDeepChild2-ApiDeepChild2",
      },
      {
        id: "e-ApiDeepChild1-sub",
        source: "endpoint__ApiDeepChild1",
        sourceHandle: "endpoint__ApiDeepChild1-sub_field",
        target: "endpoint__ApiSubStage",
        targetHandle: "endpoint__ApiSubStage-ApiSubStage",
      },
      {
        id: "e-ApiDeepChild2-sub",
        source: "endpoint__ApiDeepChild2",
        sourceHandle: "endpoint__ApiDeepChild2-sub_field",
        target: "endpoint__ApiSubStage",
        targetHandle: "endpoint__ApiSubStage-ApiSubStage",
      },
    ];

    const layoutNodes = applyDagreLayout(epNodes, epEdges, "LR");
    const nodeMap = new Map(layoutNodes.map((n) => [n.id, n]));

    const child1 = nodeMap.get("endpoint__ApiDeepChild1")!;
    const leaf = nodeMap.get("endpoint__ApiLeafChild")!;
    const child2 = nodeMap.get("endpoint__ApiDeepChild2")!;

    // All direct children must be in the same rank column immediately adjacent to ApiData
    expect(child1.position.x).toBe(leaf.position.x);
    expect(leaf.position.x).toBe(child2.position.x);

    // And in strictly increasing Y order matching source fields: child1 < leaf < child2
    expect(child1.position.y).toBeLessThan(leaf.position.y);
    expect(leaf.position.y).toBeLessThan(child2.position.y);
  });
});
