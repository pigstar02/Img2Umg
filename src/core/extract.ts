import { DESIGN_CANVAS, FORMAT_VERSION, type EntryFile, type ExtractionOptions, type NodeType, type PreviewFile, type PreviewOverride, type UiNode, type UiPackage, type UiSlot, type VisualNode } from "./types";

const defaults: Required<ExtractionOptions> = {
  sizeTolerance: 0.08,
  alignmentTolerance: 6,
  spacingTolerance: 6,
  minimumItems: 3,
};

type Bounds = VisualNode["bounds"];
type Pattern = { type: "ListView" | "TileView"; columns: number; spacing: [number, number]; ordered: VisualNode[] };

export function structureFingerprint(node: VisualNode): string {
  const children = (node.children ?? []).map(structureFingerprint).join(",");
  return `${node.type}(${children})`;
}

export function extractUiPackage(screenId: string, canvas: { width: number; height: number }, visualRoot: VisualNode, options: ExtractionOptions = {}): UiPackage {
  if (canvas.width !== DESIGN_CANVAS.width || canvas.height !== DESIGN_CANVAS.height) {
    throw new Error(`Img2UMG screen extraction requires a ${DESIGN_CANVAS.width}x${DESIGN_CANVAS.height} design canvas.`);
  }
  const config = { ...defaults, ...options };
  const entries: Record<string, EntryFile> = {};
  const previews: Record<string, PreviewFile> = {};
  const usedIds = new Map<string, number>();

  const convert = (visual: VisualNode, root = false, parentType?: NodeType, parentBounds?: Bounds): UiNode => {
    const node: UiNode = {
      id: visual.id,
      type: visual.type,
      ...(visual.isVariable !== undefined ? { isVariable: visual.isVariable } : {}),
      ...(visual.props ? { props: structuredClone(visual.props) } : {}),
      ...(!root && parentType && parentBounds ? { slot: slotFor(visual.bounds, parentBounds, parentType) } : {}),
    };
    if (!visual.children?.length) return node;

    const output: UiNode[] = [];
    for (let index = 0; index < visual.children.length;) {
      const run = sameFingerprintRun(visual.children, index);
      const pattern = run.length >= config.minimumItems ? classifyPattern(run, config) : null;
      if (!pattern) {
        output.push(convert(visual.children[index], false, visual.type, visual.bounds));
        index += 1;
        continue;
      }

      const baseName = uniqueId(`${safeId(visual.id)}_${pattern.type === "ListView" ? "ListItem" : "TileItem"}`, usedIds);
      const previewId = `${baseName}Preview`;
      const entryFile = `entries/${baseName}.entry.json`;
      const previewFile = `previews/${previewId}.preview.json`;
      const template = pattern.ordered[0];
      const normalized = normalizeTree(template);
      entries[entryFile] = {
        format: "img2umg-entry",
        version: FORMAT_VERSION,
        id: baseName,
        size: [template.bounds.width, template.bounds.height],
        root: convertEntry(normalized),
      };
      previews[previewFile] = {
        format: "img2umg-preview",
        version: FORMAT_VERSION,
        entryTemplate: baseName,
        items: pattern.ordered.map((item) => ({ overrides: collectOverrides(normalized, normalizeTree(item)) })),
      };
      const area = unionBounds(pattern.ordered.map((item) => item.bounds));
      output.push({
        id: `${baseName}View`,
        type: pattern.type,
        props: {
          entryTemplate: baseName,
          preview: previewId,
          entrySize: [template.bounds.width, template.bounds.height],
          spacing: pattern.spacing,
          ...(pattern.type === "ListView" ? { orientation: pattern.columns === 1 ? "vertical" : "horizontal" } : { columns: pattern.columns }),
        },
        slot: slotFor(area, visual.bounds, visual.type),
      });
      index += run.length;
    }
    node.children = output;
    return node;
  };

  const screenFile = `screens/${screenId}.screen.json`;
  const root = convert(visualRoot, true);
  const entryRefs = Object.entries(entries).map(([file, entry]) => ({ id: entry.id, file }));
  const previewRefs = Object.entries(previews).map(([file, preview]) => ({ id: `${preview.entryTemplate}Preview`, file }));
  return {
    manifest: {
      format: "img2umg-package",
      version: FORMAT_VERSION,
      screens: [{ id: screenId, file: screenFile }],
      entries: entryRefs,
      previews: previewRefs,
    },
    screens: {
      [screenFile]: { format: "img2umg-screen", version: FORMAT_VERSION, id: screenId, canvas, root },
    },
    entries,
    previews,
  };
}

function sameFingerprintRun(nodes: VisualNode[], start: number): VisualNode[] {
  const fingerprint = structureFingerprint(nodes[start]);
  let end = start + 1;
  while (end < nodes.length && structureFingerprint(nodes[end]) === fingerprint) end += 1;
  return nodes.slice(start, end);
}

function classifyPattern(nodes: VisualNode[], options: Required<ExtractionOptions>): Pattern | null {
  if (!similarSizes(nodes, options.sizeTolerance)) return null;
  const byY = cluster(nodes, (node) => node.bounds.y, options.alignmentTolerance);
  const byX = cluster(nodes, (node) => node.bounds.x, options.alignmentTolerance);
  const oneRow = byY.length === 1;
  const oneColumn = byX.length === 1;
  if (oneRow === oneColumn) {
    if (oneRow) return null;
    return classifyGrid(nodes, byY, byX, options);
  }
  const ordered = [...nodes].sort(oneRow ? byLeft : byTop);
  const gaps = adjacentGaps(ordered, oneRow ? "x" : "y");
  if (!stable(gaps, options.spacingTolerance) || overlaps(gaps)) return null;
  return { type: "ListView", columns: oneRow ? nodes.length : 1, spacing: oneRow ? [average(gaps), 0] : [0, average(gaps)], ordered };
}

function classifyGrid(nodes: VisualNode[], rows: VisualNode[][], columns: VisualNode[][], options: Required<ExtractionOptions>): Pattern | null {
  if (rows.length < 2 || columns.length < 2) return null;
  const columnCount = columns.length;
  if (rows.some((row, index) => index < rows.length - 1 && row.length !== columnCount)) return null;
  if (rows.at(-1)!.length > columnCount || rows.at(-1)!.length === 0) return null;
  const sortedRows = rows.map((row) => [...row].sort(byLeft)).sort((a, b) => a[0].bounds.y - b[0].bounds.y);
  const ordered = sortedRows.flat();
  const horizontalGaps = sortedRows.flatMap((row) => adjacentGaps(row, "x"));
  const verticalGaps = adjacentGaps(sortedRows.map((row) => row[0]), "y");
  if (!stable(horizontalGaps, options.spacingTolerance) || !stable(verticalGaps, options.spacingTolerance)) return null;
  if (overlaps(horizontalGaps) || overlaps(verticalGaps)) return null;
  return { type: "TileView", columns: columnCount, spacing: [average(horizontalGaps), average(verticalGaps)], ordered };
}

function cluster(nodes: VisualNode[], coordinate: (node: VisualNode) => number, tolerance: number): VisualNode[][] {
  const sorted = [...nodes].sort((a, b) => coordinate(a) - coordinate(b));
  const groups: VisualNode[][] = [];
  for (const node of sorted) {
    const group = groups.at(-1);
    if (!group || Math.abs(coordinate(node) - average(group.map(coordinate))) > tolerance) groups.push([node]);
    else group.push(node);
  }
  return groups;
}

function similarSizes(nodes: VisualNode[], tolerance: number): boolean {
  const first = nodes[0].bounds;
  return nodes.every(({ bounds }) => Math.abs(bounds.width - first.width) <= first.width * tolerance && Math.abs(bounds.height - first.height) <= first.height * tolerance);
}

function adjacentGaps(nodes: VisualNode[], axis: "x" | "y"): number[] {
  return nodes.slice(1).map((node, index) => {
    const previous = nodes[index].bounds;
    return axis === "x" ? node.bounds.x - (previous.x + previous.width) : node.bounds.y - (previous.y + previous.height);
  });
}

function stable(values: number[], tolerance: number): boolean {
  if (!values.length) return true;
  const mean = average(values);
  return values.every((value) => Math.abs(value - mean) <= tolerance);
}

const overlaps = (values: number[]) => values.some((value) => value < 0);
const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
const byLeft = (a: VisualNode, b: VisualNode) => a.bounds.x - b.bounds.x;
const byTop = (a: VisualNode, b: VisualNode) => a.bounds.y - b.bounds.y;

function normalizeTree(node: VisualNode, origin = node.bounds): VisualNode {
  return {
    ...structuredClone(node),
    bounds: { x: node.bounds.x - origin.x, y: node.bounds.y - origin.y, width: node.bounds.width, height: node.bounds.height },
    children: node.children?.map((child) => normalizeTree(child, origin)),
  };
}

function convertEntry(node: VisualNode, root = true, parentType?: NodeType, parentBounds?: Bounds): UiNode {
  return {
    id: node.id,
    type: node.type,
    ...(node.isVariable !== undefined ? { isVariable: node.isVariable } : {}),
    ...(node.props ? { props: structuredClone(node.props) } : {}),
    ...(!root && parentType && parentBounds ? { slot: slotFor(node.bounds, parentBounds, parentType) } : {}),
    ...(node.children?.length ? { children: node.children.map((child) => convertEntry(child, false, node.type, node.bounds)) } : {}),
  };
}

function collectOverrides(template: VisualNode, item: VisualNode): PreviewOverride[] {
  const overrides: PreviewOverride[] = [];
  const compare = (base: VisualNode, candidate: VisualNode) => {
    const changed: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base.props ?? {}), ...Object.keys(candidate.props ?? {})]);
    for (const key of keys) {
      const a = base.props?.[key];
      const b = candidate.props?.[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) changed[key] = structuredClone(b);
    }
    if (Object.keys(changed).length) overrides.push({ target: base.id, props: changed });
    base.children?.forEach((child, index) => compare(child, candidate.children![index]));
  };
  compare(template, item);
  return overrides;
}

function slotFor(bounds: Bounds, parent: Bounds, parentType: NodeType): UiSlot {
  const left = bounds.x - parent.x;
  const top = bounds.y - parent.y;
  if (parentType === "Canvas") {
    return {
      position: [left, top],
      size: [bounds.width, bounds.height],
      anchors: [0, 0, 0, 0],
      alignment: [0, 0],
    };
  }
  if (parentType === "HorizontalBox" || parentType === "VerticalBox") return { sizeRule: "auto", padding: [0, 0, 0, 0], horizontalAlign: "fill", verticalAlign: "fill" };
  return {
    padding: [left, top, parent.width - left - bounds.width, parent.height - top - bounds.height],
    horizontalAlign: "fill",
    verticalAlign: "fill",
  };
}

function unionBounds(bounds: Bounds[]): Bounds {
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.x + item.width));
  const bottom = Math.max(...bounds.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

function safeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned || "Entry";
}

function uniqueId(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}_${count + 1}`;
}
