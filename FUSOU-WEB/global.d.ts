declare type IHAlign = "left" | "center" | "right";
declare type IVAlign = "top" | "center" | "bottom";

interface NodeRequireFunction {
  (id: string): any;
}

interface NodeModule {
  exports: any;
  require: NodeRequireFunction;
  id: string;
  filename: string;
  loaded: boolean;
  /** @deprecated since 12.19.0 Please use `require.main` and `module.children` instead. */
  parent: NodeModule | null | undefined;
  children: NodeModule[];
  /**
   * @since 11.14.0
   *
   * The directory name of the module. This is usually the same as the path.dirname() of the module.id.
   */
  path: string;
  paths: string[];
}

declare var module: NodeModule;
declare var define: any;
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