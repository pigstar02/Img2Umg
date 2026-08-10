import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { EntryFile, PreviewFile, PreviewItem, ScreenFile, UiNode, UiPackage } from "../core/types";

interface PackageRendererProps {
  pkg: UiPackage;
  screen: ScreenFile;
  viewport: { width: number; height: number };
}

export function PackageRenderer({ pkg, screen, viewport }: PackageRendererProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const update = () => setScale(Math.min(1, element.clientWidth / viewport.width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewport.width]);

  return (
    <div ref={hostRef} className="preview-host" style={{ height: viewport.height * scale }}>
      <div className="screen" data-preview-width={viewport.width} data-preview-height={viewport.height} style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}>
        <NodeRenderer node={screen.root} pkg={pkg} root />
      </div>
    </div>
  );
}

function NodeRenderer({ node, pkg, root = false, parentType }: { node: UiNode; pkg: UiPackage; root?: boolean; parentType?: UiNode["type"] }) {
  const style: CSSProperties = root ? { position: "relative", width: "100%", height: "100%" } : slotStyle(node, parentType);
  const props = node.props ?? {};
  if (props.visibility === "collapsed") return <div data-node={node.id} style={{ ...style, display: "none" }} />;
  if (props.visibility === "hidden") style.visibility = "hidden";
  const children = node.children?.map((child) => <NodeRenderer key={child.id} node={child} pkg={pkg} parentType={node.type} />);

  switch (node.type) {
    case "Canvas":
    case "Overlay":
      return <div data-node={node.id} style={{ ...style, background: color(props.backgroundColor) }}>{children}</div>;
    case "HorizontalBox":
      return <div data-node={node.id} style={{ ...style, display: "flex" }}>{children}</div>;
    case "VerticalBox":
      return <div data-node={node.id} style={{ ...style, display: "flex", flexDirection: "column" }}>{children}</div>;
    case "WidgetSwitcher": {
      const activeWidgetIndex = number(props.activeWidgetIndex) ?? 0;
      const activeChild = node.children?.[activeWidgetIndex];
      return <div data-node={node.id} data-active-widget-index={activeWidgetIndex} style={{ ...style, overflow: "hidden" }}>
        {activeChild ? <NodeRenderer node={activeChild} pkg={pkg} parentType={node.type} /> : null}
      </div>;
    }
    case "SizeBox":
      return <div data-node={node.id} style={{ ...style, width: number(props.widthOverride) ?? style.width, height: number(props.heightOverride) ?? style.height, minWidth: number(props.minWidth), minHeight: number(props.minHeight) }}>{children}</div>;
    case "ScaleBox":
      return <div data-node={node.id} style={{ ...style, overflow: "hidden", display: "grid", placeItems: "center" }}>{children}</div>;
    case "Spacer":
      return <div data-node={node.id} style={{ ...style, width: arrayNumber(props.size, 0) ?? style.width, height: arrayNumber(props.size, 1) ?? style.height }} />;
    case "Border":
      return <div data-node={node.id} style={{ ...style, background: color(props.backgroundColor), border: `${number(props.borderWidth) ?? 0}px solid ${color(props.borderColor) ?? "transparent"}`, borderRadius: number(props.cornerRadius) ?? 0, padding: cssMargin(props.padding) }}>{children}</div>;
    case "Image":
      return <ImageNode node={node} style={style} />;
    case "Text":
      return <div data-node={node.id} style={{ ...style, color: color(props.color) ?? "white", fontSize: number(props.fontSize) ?? 16, textAlign: align(props.horizontalAlign), display: "flex", alignItems: vertical(props.verticalAlign), justifyContent: justify(props.horizontalAlign), whiteSpace: props.wrap === false ? "nowrap" : "normal", overflow: "hidden" }}>{String(props.text ?? "")}</div>;
    case "Button":
      return <button data-node={node.id} type="button" style={{ ...style, background: color(props.backgroundColor) ?? "#3b66b0", color: color(props.textColor) ?? "white", fontSize: number(props.fontSize) ?? 16, border: 0 }}>{children ?? String(props.label ?? "Button")}</button>;
    case "ProgressBar":
      return <div data-node={node.id} style={{ ...style, background: color(props.backgroundColor) ?? "#202633", overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(1, number(props.percent) ?? 0)) * 100}%`, height: "100%", background: color(props.fillColor) ?? "#68c6ff" }} /></div>;
    case "ListView":
    case "TileView":
      return <Collection node={node} pkg={pkg} style={style} />;
  }
}

function ImageNode({ node, style }: { node: UiNode; style: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const props = node.props ?? {};
  const source = typeof props.source === "string" ? props.source : "";
  if (source && !failed) return <img data-node={node.id} src={source} onError={() => setFailed(true)} style={{ ...style, objectFit: props.drawAs === "box" ? "fill" : "contain", background: color(props.placeholderColor) }} />;
  return <div data-node={node.id} className="image-placeholder" style={{ ...style, background: color(props.placeholderColor) ?? "#566176", color: color(props.tint) ?? "#dce4f0" }}>{String(props.placeholderLabel ?? "")}</div>;
}

function Collection({ node, pkg, style }: { node: UiNode; pkg: UiPackage; style: CSSProperties }) {
  const entryId = String(node.props?.entryTemplate ?? "");
  const previewId = String(node.props?.preview ?? "");
  const entry = resolveRef(pkg.entries, pkg.manifest.entries, entryId);
  const preview = resolveRef(pkg.previews, pkg.manifest.previews, previewId);
  if (!entry || !preview) return <div style={{ ...style, background: "#5b2020", color: "white" }}>Missing {entry ? "preview" : "entry"}</div>;
  const spacing = node.props?.spacing as [number, number] | undefined;
  const collectionStyle: CSSProperties = node.type === "TileView"
    ? { display: "grid", gridTemplateColumns: `repeat(${Number(node.props?.columns) || 1}, ${entry.size[0]}px)`, gridAutoRows: `${entry.size[1]}px`, columnGap: spacing?.[0] ?? 0, rowGap: spacing?.[1] ?? 0 }
    : { display: "flex", flexDirection: node.props?.orientation === "horizontal" ? "row" : "column", gap: node.props?.orientation === "horizontal" ? spacing?.[0] : spacing?.[1] };
  const sizeToContent = node.type === "ListView" && node.props?.sizeToContent === true;
  return <div data-node={node.id} style={{ ...style, ...collectionStyle, overflow: "hidden" }}>{preview.items.map((item, index) => <EntryRenderer key={index} entry={entry} item={item} pkg={pkg} sizeToContent={sizeToContent} />)}</div>;
}

function EntryRenderer({ entry, item, pkg, sizeToContent }: { entry: EntryFile; item: PreviewItem; pkg: UiPackage; sizeToContent: boolean }) {
  const root = useMemo(() => applyOverrides(entry.root, item), [entry.root, item]);
  const size = sizeToContent && item.size ? item.size : entry.size;
  return <div style={{ position: "relative", width: size[0], height: size[1], flex: "0 0 auto", overflow: "hidden" }}><NodeRenderer node={root} pkg={pkg} root /></div>;
}

function applyOverrides(root: UiNode, item: PreviewItem): UiNode {
  const copy = structuredClone(root);
  const map = new Map(item.overrides.map((override) => [override.target, override.props]));
  const visit = (node: UiNode) => {
    const props = map.get(node.id);
    if (props) node.props = { ...node.props, ...props };
    node.children?.forEach(visit);
  };
  visit(copy);
  return copy;
}

function resolveRef<T>(files: Record<string, T>, refs: { id: string; file: string }[], id: string): T | undefined {
  const ref = refs.find((candidate) => candidate.id === id);
  return ref ? files[ref.file] : undefined;
}

function slotStyle(node: UiNode, parentType?: UiNode["type"]): CSSProperties {
  const slot = node.slot;
  if (!slot) return { position: "relative", width: "100%", height: "100%" };
  if (parentType === "Canvas" && "position" in slot && "size" in slot) {
    const anchors = slot.anchors ?? [0, 0, 0, 0];
    const horizontalStretch = anchors[0] !== anchors[2];
    const verticalStretch = anchors[1] !== anchors[3];
    const autoSize = slot.autoSize === true;
    return {
      position: "absolute",
      left: `calc(${anchors[0] * 100}% + ${slot.position[0]}px)`,
      top: `calc(${anchors[1] * 100}% + ${slot.position[1]}px)`,
      right: horizontalStretch ? `calc(${(1 - anchors[2]) * 100}% + ${slot.size[0]}px)` : undefined,
      bottom: verticalStretch ? `calc(${(1 - anchors[3]) * 100}% + ${slot.size[1]}px)` : undefined,
      width: horizontalStretch ? undefined : autoSize ? "fit-content" : slot.size[0],
      height: verticalStretch ? undefined : autoSize ? "fit-content" : slot.size[1],
      transform: slot.alignment ? `translate(${horizontalStretch ? 0 : -slot.alignment[0] * 100}%, ${verticalStretch ? 0 : -slot.alignment[1] * 100}%)` : undefined,
      zIndex: slot.zOrder,
      boxSizing: "border-box",
    };
  }
  const padding = "padding" in slot ? slot.padding ?? [0, 0, 0, 0] : [0, 0, 0, 0];
  if ((parentType === "HorizontalBox" || parentType === "VerticalBox") && "sizeRule" in slot) {
    const horizontal = parentType === "HorizontalBox";
    return {
      position: "relative",
      boxSizing: "border-box",
      margin: `${padding[1]}px ${padding[2]}px ${padding[3]}px ${padding[0]}px`,
      flex: slot.sizeRule === "fill" ? `${slot.fill ?? 1} 1 0` : "0 0 auto",
      alignSelf: crossAxisAlignment(slot, horizontal),
    };
  }
  const horizontalAlign = "horizontalAlign" in slot ? slot.horizontalAlign ?? "fill" : "fill";
  const verticalAlign = "verticalAlign" in slot ? slot.verticalAlign ?? "fill" : "fill";
  const horizontalCenterOffset = (padding[0] - padding[2]) / 2;
  const verticalCenterOffset = (padding[1] - padding[3]) / 2;
  const translateX = horizontalAlign === "center" ? -50 : 0;
  const translateY = verticalAlign === "center" ? -50 : 0;
  return {
    position: "absolute",
    boxSizing: "border-box",
    left: horizontalAlign === "right" ? undefined : horizontalAlign === "center" ? `calc(50% + ${horizontalCenterOffset}px)` : padding[0],
    right: horizontalAlign === "left" || horizontalAlign === "center" ? undefined : padding[2],
    top: verticalAlign === "bottom" ? undefined : verticalAlign === "center" ? `calc(50% + ${verticalCenterOffset}px)` : padding[1],
    bottom: verticalAlign === "top" || verticalAlign === "center" ? undefined : padding[3],
    transform: translateX || translateY ? `translate(${translateX}%, ${translateY}%)` : undefined,
  };
}

function crossAxisAlignment(slot: { horizontalAlign?: string; verticalAlign?: string }, horizontal: boolean): CSSProperties["alignSelf"] {
  const value = horizontal ? slot.verticalAlign : slot.horizontalAlign;
  if (value === "top" || value === "left") return "flex-start";
  if (value === "bottom" || value === "right") return "flex-end";
  if (value === "center") return "center";
  return "stretch";
}

const number = (value: unknown) => typeof value === "number" ? value : undefined;
const arrayNumber = (value: unknown, index: number) => Array.isArray(value) && typeof value[index] === "number" ? value[index] : undefined;
const color = (value: unknown) => typeof value === "string" ? value : undefined;
const align = (value: unknown): CSSProperties["textAlign"] => value === "left" || value === "right" || value === "center" ? value : "left";
const vertical = (value: unknown): CSSProperties["alignItems"] => value === "top" ? "flex-start" : value === "bottom" ? "flex-end" : "center";
const justify = (value: unknown): CSSProperties["justifyContent"] => value === "right" ? "flex-end" : value === "center" ? "center" : "flex-start";
const cssMargin = (value: unknown): CSSProperties["padding"] => {
  if (typeof value === "number") return value;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) return undefined;
  if (value.length === 2) return `${value[1]}px ${value[0]}px`;
  if (value.length === 4) return `${value[1]}px ${value[2]}px ${value[3]}px ${value[0]}px`;
  return undefined;
};

export type { UiPackage, ScreenFile, PreviewFile };
