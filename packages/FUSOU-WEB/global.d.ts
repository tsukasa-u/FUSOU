declare type IHAlign = "left" | "center" | "right";
declare type IVAlign = "top" | "center" | "bottom";

// Removed NodeRequireFunction and NodeModule type definitions
// Cloudflare Workers (Edge environment) does not support Node.js require() syntax
// Using these types caused 'ReferenceError: require is not defined' at runtime

// module and define removed (Node.js specific)
declare var cytoscape: typeof cytoscape;
interface CytoscapeNodeHtmlParams {
    query?: string;
    halign?: IHAlign;
    valign?: IVAlign;
    halignBox?: IHAlign;
    valignBox?: IVAlign;
    cssClass?: string;
    tpl?: (d: any) => string;
}
interface CytoscapeContainerParams {
    enablePointerEvents?: boolean;
}

declare module 'cytoscape-node-html-label'