/** @jsxImportSource react */
import cytoscape from "cytoscape";
import { useEffect, useRef } from "react";
import "./css/graph.css";
import "../../styles/global.css";

import nodeHtmlLabel from "cytoscape-node-html-label";
cytoscape.use(nodeHtmlLabel);

import dagre from "cytoscape-dagre";
cytoscape.use(dagre);

import "cytoscape-navigator/cytoscape.js-navigator.css";
import navigator from "cytoscape-navigator";
cytoscape.use(navigator);

import automove from "cytoscape-automove";
cytoscape.use(automove);

export const elems = [
  // Nodes
  {
    data: {
      id: "table-a",
      parent: "mod-a",
      label: "Node A",
    },
  },
  {
    data: {
      id: "table-b",
      parent: "mod-a",
      label: "Node B",
    },
  },
  {
    data: {
      id: "table-c",
      parent: "mod-a",
      label: "Node C",
    },
  },
  {
    data: {
      id: "table-d",
      parent: "mod-b",
      label: "Node D",
    },
  },
  {
    data: {
      id: "table-e",
      parent: "mod-b",
      label: "Node E",
    },
  },
  // Mod
  {
    data: {
      id: "mod-a",
      label: "Mod A",
    },
  },
  {
    data: {
      id: "mod-b",
      label: "Mod B",
    },
  },
  // Field
  {
    data: {
      id: "field-a",
      parent: "table-a",
      label: "Field A",
    },
    grabbable: false,
  },
  {
    data: {
      id: "field-b",
      parent: "table-a",
      label: "Field B",
    },
    grabbable: false,
  },
  {
    data: {
      id: "field-c",
      parent: "table-a",
      label: "Field C",
    },
    grabbable: false,
  },
  {
    data: {
      id: "field-d",
      parent: "table-a",
      label: "Field D",
    },
    grabbable: false,
  },
  // Edges
  {
    data: {
      id: "edge-a",
      source: "field-d",
      target: "table-b",
      label: "Edge A",
    },
  },
  {
    data: {
      id: "edge-b",
      source: "table-c",
      target: "table-b",
      label: "Edge B",
    },
  },
  {
    data: {
      id: "edge-c",
      source: "table-e",
      target: "table-d",
      label: "Edge C",
    },
  },
];

export const styles = [
  {
    selector: "node[id ^= 'table']",
    style: {
      width: "316px",
      height: "180px",
      shape: "round-rectangle",
      "background-color": "gray",
      "overlay-color": "red",
      "overlay-padding": "0px",
      padding: "0px",
      "compound-sizing-wrt-labels": "exclude",
      "min-width": "316px",
      "min-height": "180px",
    } as const,
  },
  {
    selector: "node[id ^= 'field']",
    style: {
      width: "316px",
      height: "0.5px",
      visibility: "hidden",
    } as const,
  },
  {
    selector: "node[id ^= 'mod']",
    style: {
      shape: "round-rectangle",
      label: "data(label)",
      "overlay-color": "red",
      "overlay-padding": "0px",
    } as const,
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "curve-style": "round-taxi",
      "target-arrow-shape": "chevron",
      "target-distance-from-node": "4px",
      "taxi-direction": "horizontal",
    } as const,
  },
  {
    selector: `node.active`,
    style: {} as const,
  },
  {
    selector: `edge.active`,
    style: {
      "line-style": "dashed",
    } as const,
  },
];

export default function Graph() {
  const cyElemRef = useRef<HTMLDivElement>(null);

  // 描画後 => useEfect
  useEffect(() => {
    const cyInstance = cytoscape({
      container: cyElemRef.current,
      elements: elems,
      style: styles,
    });

    let fieldNodeList = cyInstance
      .nodes()
      .nonorphans()
      .filter("node[id ^= 'field']");
    for (let i = 0; i < fieldNodeList.length; i++) {
      let n = fieldNodeList[i];
      let parent = n.parent()[0];
      let family = parent.children();
      family.add(parent);

      cyInstance.automove({
        nodesMatching: family,
        reposition: "drag",
        dragWith: n,
      });
    }

    cyInstance.nodeHtmlLabel([
      {
        query: "node[id ^= 'table']", // cytoscape query selector
        halign: "center", // title vertical position. Can be 'left',''center, 'right'
        valign: "center", // title vertical position. Can be 'top',''center, 'bottom'
        halignBox: "center", // title vertical position. Can be 'left',''center, 'right'
        valignBox: "center", // title relative box vertical position. Can be 'top',''center, 'bottom'
        cssClass: "", // any classes will be as attribute of <div> container for every title
        tpl(data: { label: string }) {
          return `<div class="overflow-x-auto rounded-lg outline-2 outline-gray-300">
                    <table class="table bg-base-100 w-80 rounded-lg">
                      <!-- head -->
                      <thead>
                      <tr>
                        <th colspan="2">${data.label}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr class="hover:bg-base-300">
                        <td>Cy Ganderton</td>
                        <td align="right">Quality</td>
                      </tr>
                      <tr class="hover:bg-base-300">
                        <td>Hart</td>
                        <td align="right">Desktop</td>
                      </tr>
                      <tr class="hover:bg-base-300">
                        <td>Brice</td>
                        <td align="right">Tax</td>
                      </tr>
                    </tbody>
                  </table>
                </div>`; // your html template here
        },
      },
    ]);

    var defaults = {
      container: false, // html dom element
      viewLiveFramerate: 0, // set false to update graph pan only on drag end; set 0 to do it instantly; set a number (frames per second) to update not more than N times per second
      thumbnailEventFramerate: 30, // max thumbnail's updates per second triggered by graph updates
      thumbnailLiveFramerate: false, // max thumbnail's updates per second. Set false to disable
      dblClickDelay: 200, // milliseconds
      removeCustomContainer: false, // destroy the container specified by user on plugin destroy
      rerenderDelay: 100, // ms to throttle rerender updates to the panzoom for performance
    };

    var nav = cyInstance.navigator(defaults);

    cyInstance
      .layout({ name: "dagre", rankDir: "LR", spacingFactor: 0.9 })
      .run();

    // // イベントを付ける(ホバーイベント)
    // cyInstance.on(
    //   "mouseover", // ターゲットに入ったとき
    //   "node", // すべてのノードに対して
    //   (e) => {
    //     // ハンドラ
    //     const target = e.target; // ホバーされたノード
    //     const connEdges = target.connectedEdges(); // 隣接エッジたち
    //     const connNodes = connEdges.connectedNodes(); // 隣接エッジに隣接したノードたち

    //     // e のなかにも cy がある
    //     // その中から .batch() という再描画させずに要素を操作する関数を使う。
    //     e.cy.batch(() => {
    //       // addClass で対象にcssクラスを付与する
    //       target.addClass("active"); // .active というクラスを付与
    //       connEdges.addClass("active");
    //       connNodes.addClass("active");
    //     });
    //   }
    // );
    // cyInstance.on(
    //   "mouseout", // ターゲットが外れた時
    //   "node",
    //   (e) => {
    //     // 面倒なのですべてのノードから `.active` クラスをはぎ取ります
    //     e.cy.batch(() => {
    //       e.cy.elements().removeClass("active");
    //     });
    //   }
    // );
    // creanup 処理
    return () => {
      cyInstance.destroy();
    };
  }, []);

  return <div id="cy" ref={cyElemRef} />;
}
