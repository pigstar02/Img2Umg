export type Edges = [number, number, number, number]; // left, top, right, bottom
export type Length = number | "auto";
export type Align = "flex-start" | "flex-end" | "center" | "stretch";
export interface UiNode {
  id: string;
  kind: "panel" | "text" | "image" | "button" | "collection";
  field?: string;
  layout: "row" | "column" | "canvas" | "leaf";
  box: {
    width: Length; height: Length; padding: Edges; margin: Edges;
    gap: number; align: Align; self: Align | "auto";
    position: "flow" | "absolute"; left: number; top: number; zIndex: number;
    display: "visible" | "collapsed"; visibility: "visible" | "hidden";
    overflow: "visible" | "clip";
  };
  paint: { background: string; color: string };
  text?: { value: string; family: string; size: number; weight: 400 | 700; align: "left" | "center" | "right" };
  assetId?: string;
  collectionId?: string;
  children: UiNode[];
}
export interface Asset {
  id: string; path: string; kind: "image" | "font"; mime: string; sha256: string;
}
export interface FontFace { family: string; weight: 400 | 700; assetId: string }
export interface ItemOverride { text?: string; assetId?: string; background?: string; color?: string }
export interface CollectionItem { key: string; nodeIds: Record<string, string>; overrides: Record<string, ItemOverride> }
export interface Collection {
  id: string; nodeId: string; templateId: string; orientation: "horizontal" | "vertical";
  items: CollectionItem[];
}
export interface Rect { x: number; y: number; width: number; height: number }
export interface UiDocument {
  format: "html-umg-ir";
  version: 2;
  target: "ue-5.8.2";
  viewport: { width: number; height: number };
  root: UiNode;
  templates: Record<string, UiNode>;
  collections: Collection[];
  assets: Asset[];
  fonts: FontFace[];
  observations: Record<string, Rect>;
}
export interface Diagnostic { code: string; message: string; nodeId?: string }
export class CompileError extends Error {
  constructor(public diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => `${d.code}${d.nodeId ? ` [${d.nodeId}]` : ""}: ${d.message}`).join("\n"));
    this.name = "CompileError";
  }
}
