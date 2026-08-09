export const FORMAT_VERSION = 1 as const;

export type Point = [number, number];
export type Size = [number, number];

export interface FixedSlot {
  position: Point;
  size: Size;
  zOrder?: number;
}

export interface OverlaySlot {
  padding?: [number, number, number, number];
  horizontalAlign?: "left" | "center" | "right" | "fill";
  verticalAlign?: "top" | "center" | "bottom" | "fill";
}

export interface BoxSlot extends OverlaySlot {
  sizeRule: "auto" | "fill";
  fill?: number;
}

export type UiSlot = FixedSlot | OverlaySlot | BoxSlot;

export type NodeType =
  | "Canvas"
  | "Overlay"
  | "HorizontalBox"
  | "VerticalBox"
  | "SizeBox"
  | "ScaleBox"
  | "Spacer"
  | "Border"
  | "Image"
  | "Text"
  | "Button"
  | "ProgressBar"
  | "ListView"
  | "TileView";

export interface UiNode {
  id: string;
  type: NodeType;
  props?: Record<string, unknown>;
  slot?: UiSlot;
  children?: UiNode[];
}

export interface ScreenFile {
  format: "img2umg-screen";
  version: typeof FORMAT_VERSION;
  id: string;
  canvas: { width: number; height: number };
  root: UiNode;
}

export interface EntryFile {
  format: "img2umg-entry";
  version: typeof FORMAT_VERSION;
  id: string;
  size: Size;
  root: UiNode;
}

export interface PreviewOverride {
  target: string;
  props: Record<string, unknown>;
}

export interface PreviewItem {
  overrides: PreviewOverride[];
}

export interface PreviewFile {
  format: "img2umg-preview";
  version: typeof FORMAT_VERSION;
  entryTemplate: string;
  items: PreviewItem[];
}

export interface ManifestRef {
  id: string;
  file: string;
}

export interface ManifestFile {
  format: "img2umg-package";
  version: typeof FORMAT_VERSION;
  screens: ManifestRef[];
  entries: ManifestRef[];
  previews: ManifestRef[];
}

export interface UiPackage {
  manifest: ManifestFile;
  screens: Record<string, ScreenFile>;
  entries: Record<string, EntryFile>;
  previews: Record<string, PreviewFile>;
}

export interface VisualNode {
  id: string;
  type: Exclude<NodeType, "ListView" | "TileView">;
  bounds: { x: number; y: number; width: number; height: number };
  props?: Record<string, unknown>;
  children?: VisualNode[];
}

export interface ExtractionOptions {
  sizeTolerance?: number;
  alignmentTolerance?: number;
  spacingTolerance?: number;
  minimumItems?: number;
}
