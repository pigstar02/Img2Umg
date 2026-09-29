import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Browser } from "playwright-core";
import { loadSource } from "./source.js";
import { confinedFile, launchBrowser, loadPage, MIME } from "./browser.js";
import { snapshotPage, type SnapshotNode } from "./snapshot.js";
import { RESET_CSS } from "./render.js";
import { assertDocument } from "./validate.js";
import { CompileError, type UiDocument, type UiNode, type Asset, type CollectionItem, type Edges } from "./types.js";

const fail = (code: string, message: string, nodeId?: string): never => { throw new CompileError([{ code, message, ...(nodeId ? { nodeId } : {}) }]); };
const px = (value: string): number => value === "normal" || value === "auto" ? 0 : Number.parseFloat(value) || 0;
const length = (value: string): number | "auto" => value === "auto" ? "auto" : Number.parseFloat(value);
const familyName = (value: string): string => value.split(",")[0].trim().replace(/^["']|["']$/g, "");
// CSS nowrap collapses ASCII segment whitespace, not NBSP or ideographic spaces.
const trimText = (value: string): string => value.replace(/[ \t\n\r\f]+/g, " ").replace(/^ +| +$/g, "");
export interface Compilation {
  document: UiDocument; assetContents: Map<string, Buffer>; sourceScreenshot: Buffer; browserVersion: string;
}

export async function compileFile(input: string, externalBrowser?: Browser): Promise<Compilation> {
  const source = await loadSource(input);
  const browser = externalBrowser ?? await launchBrowser();
  let closePage: (() => Promise<void>) | undefined;
  try {
    const html = source.html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}<style>${RESET_CSS}</style>`);
    const loaded = await loadPage(browser, html, source.rootDirectory);
    closePage = loaded.close;
    const page = loaded.page;
    // Ensure declared fonts (including fonts only used in hidden subtrees) decode before snapshotting.
    await page.evaluate(async () => {
      await Promise.all(Array.from(window.document.fonts, (font) => font.load()));
      await window.document.fonts.ready;
    });
    // tsx/esbuild may emit __name wrappers; keep that trusted helper local to the measurement script.
    const readSnapshot = () => page.evaluate<ReturnType<typeof snapshotPage>>(`(() => { const __name = (fn) => fn; return (${snapshotPage.toString()})(); })()`);
    let snapshot = await readSnapshot();
    const width = length(snapshot.root.width), height = length(snapshot.root.height);
    if (width === "auto" || height === "auto" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 8192 || height > 8192) {
      fail("E_ROOT_SIZE", "Root requires positive px width/height, each at most 8192.", snapshot.root.id);
    }
    await page.setViewportSize({ width: Math.ceil(width as number), height: Math.ceil(height as number) });
    snapshot = await readSnapshot();
    const document: UiDocument = {
      format: "html-umg-ir", version: 2, target: "ue-5.8.2", viewport: { width: width as number, height: height as number },
      root: undefined as unknown as UiNode, templates: Object.create(null), collections: [], assets: [], fonts: [], observations: Object.create(null),
    };
    const assetContents = new Map<string, Buffer>();
    const assetBySource = new Map<string, Asset>();
    const addAsset = async (path: string, kind: Asset["kind"]): Promise<string> => {
      const file = await confinedFile(source.rootDirectory, decodeURIComponent(path));
      if (assetBySource.has(file)) return assetBySource.get(file)!.id;
      const contents = await readFile(file);
      if (contents.length > 20 * 1024 * 1024) fail("E_ASSET_SIZE", `Asset exceeds 20MB: ${path}`);
      const sha256 = createHash("sha256").update(contents).digest("hex");
      const extension = extname(path).toLowerCase();
      const existing = document.assets.find((asset) => asset.sha256 === sha256 && asset.kind === kind);
      if (existing) { assetBySource.set(file, existing); return existing.id; }
      const asset: Asset = { id: `${kind}_${sha256.slice(0, 16)}`, kind, path: `assets/${sha256}${extension}`, mime: MIME[extension], sha256 };
      document.assets.push(asset); assetContents.set(asset.path, contents); assetBySource.set(file, asset);
      return asset.id;
    };
    for (const font of snapshot.fonts) {
      if (!font.loaded) fail("E_FONT_LOAD", `Font did not load: ${font.family}`);
      const weight = font.weight === "bold" || font.weight === "700" ? 700 : 400;
      document.fonts.push({ family: font.family, weight, assetId: await addAsset(font.src, "font") });
    }
    const convert = async (item: SnapshotNode, parent?: SnapshotNode): Promise<UiNode> => {
      const { style: s, id } = item;
      document.observations[id] = item.rect;
      const isText = /^(span|p|h[1-6])$/.test(item.tag);
      const isButton = item.tag === "button";
      if (parent?.style.visibility === "hidden" && s.visibility === "visible") fail("E_VISIBILITY", "Visible descendants of hidden nodes are not supported.", id);
      if (item.entry && (!parent || parent.collection !== "list")) fail("E_COLLECTION_TEMPLATE", "data-ui-entry requires a direct list parent.", id);
      if ((isText || item.tag === "img") && item.children.length) fail("E_LAYOUT_CONTEXT", "Text/image nodes must be leaves.", id);
      if (!isText && !isButton && trimText(item.text)) fail("E_LAYOUT_CONTEXT", "Use a text leaf instead of anonymous container text.", id);
      if (isButton && item.children.length && trimText(item.text)) fail("E_LAYOUT_CONTEXT", "Button cannot mix text and element children.", id);
      if (isButton && item.children.length > 1) fail("E_LAYOUT_CONTEXT", "Wrap button contents in one container.", id);
      const leaf = isText || item.tag === "img" || (isButton && !item.children.length);
      if (item.layoutHint === "canvas" && leaf) fail("E_LAYOUT_CONTEXT", "Canvas must be a container.", id);
      if (leaf && s.display !== "block" && s.display !== "none") fail("E_LAYOUT_CONTEXT", "Text/image leaves require block layout, not flex anonymous text boxes.", id);
      const layout = leaf ? "leaf" : item.layoutHint === "canvas" ? "canvas" : s["flex-direction"] === "column" ? "column" : "row";
      if (!leaf && layout !== "canvas" && s.display !== "flex" && s.display !== "none") fail("E_LAYOUT_CONTEXT", "Containers require display:flex or data-ui-layout=canvas.", id);
      if (s.position === "absolute" && parent?.layoutHint !== "canvas") fail("E_LAYOUT_CONTEXT", "Absolute children require a direct canvas parent.", id);
      if (s.position === "absolute" && (item.left === "auto" || item.top === "auto")) fail("E_LAYOUT_CONTEXT", "Absolute children need authored left/top px, not inferred static positions.", id);
      if (parent?.layoutHint === "canvas" && s.position !== "absolute") fail("E_LAYOUT_CONTEXT", "Canvas children require position:absolute.", id);
      if (!parent && s.position === "absolute") fail("E_LAYOUT_CONTEXT", "Root cannot be absolute.", id);
      if (s.position !== "absolute" && (px(s.left) !== 0 || px(s.top) !== 0)) fail("E_LAYOUT_CONTEXT", "Relative left/top offsets are unsupported; use a canvas parent.", id);
      if (px(s["z-index"]) !== 0 && parent?.layoutHint !== "canvas") fail("E_LAYOUT_CONTEXT", "z-index is only supported for direct canvas children.", id);
      const edges = (name: string): Edges => [px(s[`${name}-left`]), px(s[`${name}-top`]), px(s[`${name}-right`]), px(s[`${name}-bottom`])];
      const padding = edges("padding"), margin = edges("margin");
      if (layout === "canvas" && padding.some(Boolean)) fail("E_LAYOUT_CONTEXT", "Canvas padding requires an outer wrapper.", id);
      if ((!parent || parent.layoutHint === "canvas") && margin.some(Boolean)) fail("E_LAYOUT_CONTEXT", "Margins only supported on flow children.", id);
      const w = length(item.width), h = length(item.height);
      if ((w !== "auto" && (!Number.isFinite(w) || w < padding[0] + padding[2])) || (h !== "auto" && (!Number.isFinite(h) || h < padding[1] + padding[3]))) fail("E_BOX_SIZE", "Fixed dimensions must contain padding.", id);
      if ((s.position === "absolute" || item.tag === "img") && (w === "auto" || h === "auto")) fail("E_LAYOUT_CONTEXT", "Images and absolute nodes require explicit px dimensions.", id);
      if (parent && parent.layoutHint !== "canvas" && s.display !== "none" && parent.rect.width && parent.rect.height) {
        const column = parent.style["flex-direction"] === "column";
        const crossSize = column ? w : h;
        const before = column ? 0 : 1, after = column ? 2 : 3;
        const axis = column ? "width" : "height";
        const available = parent.rect[axis] - px(parent.style[column ? "padding-left" : "padding-top"]) - px(parent.style[column ? "padding-right" : "padding-bottom"]) - margin[before] - margin[after];
        if (typeof crossSize === "number" && crossSize > available + 0.1) fail("E_LAYOUT_OVERFLOW", "Fixed cross-axis child exceeds available parent size (UMG would clamp).", id);
        const align = s["align-self"] === "auto" ? parent.style["align-items"] : s["align-self"];
        if (align === "center" && margin[before] !== margin[after]) fail("E_LAYOUT_CONTEXT", "Asymmetric margins with center alignment require a wrapper.", id);
      }
      const node: UiNode = {
        id, kind: isText ? "text" : item.tag === "img" ? "image" : isButton ? "button" : "panel", layout,
        ...(item.field ? { field: item.field } : {}),
        box: {
          width: w, height: h, padding, margin, gap: px(s[layout === "column" ? "row-gap" : "column-gap"]),
          align: (s["align-items"] === "normal" ? "stretch" : s["align-items"]) as UiNode["box"]["align"],
          self: s["align-self"] as UiNode["box"]["self"], position: s.position === "absolute" ? "absolute" : "flow",
          left: px(s.left), top: px(s.top), zIndex: px(s["z-index"]), display: s.display === "none" ? "collapsed" : "visible",
          visibility: s.visibility as "visible" | "hidden", overflow: s["overflow-x"] as "visible" | "clip",
        },
        paint: { background: s["background-color"], color: s.color }, children: [],
      };
      if (isText || (isButton && leaf)) {
        const family = familyName(s["font-family"]);
        const weight = Number(s["font-weight"]) === 700 ? 700 : 400;
        if (!document.fonts.some((font) => font.family === family && font.weight === weight)) fail("E_FONT_MISSING", `Explicit local @font-face required for ${family} weight ${weight}.`, id);
        // Text-only buttons get an explicit text child in IR, keeping the UMG Button a single-content container.
        const text = { value: trimText(item.text), family, size: px(s["font-size"]), weight, align: s["text-align"] === "start" ? "left" : s["text-align"] === "end" ? "right" : s["text-align"] } as NonNullable<UiNode["text"]>;
        if (isButton) fail("E_LAYOUT_CONTEXT", "Use an explicit text child inside button for portable font metrics.", id);
        node.text = text;
      }
      if (item.tag === "img") node.assetId = await addAsset(item.src!, "image");
      node.children = await Promise.all(item.children.map((child) => convert(child, item)));
      if (item.collection === "list") {
        if (leaf || layout === "canvas" || !node.children.length) fail("E_COLLECTION_TEMPLATE", "List requires flex layout and at least one explicit template instance.", id);
        if (node.children.some((child) => child.kind === "collection" || child.box.position !== "flow" || child.box.display !== "visible")) fail("E_COLLECTION_TEMPLATE", "List entries must be visible flow nodes; nested collections are unsupported.", id);
        const templateId = item.children[0].entry;
        if (!templateId || item.children.some((child) => child.entry !== templateId)) fail("E_COLLECTION_TEMPLATE", "Every direct list child must declare the same data-ui-entry.", id);
        if (Object.hasOwn(document.templates, templateId!)) fail("E_COLLECTION_TEMPLATE", "Template names must be unique per collection in MVP.", id);
        const template = node.children[0];
        if (template.box.width === "auto" || template.box.height === "auto") fail("E_COLLECTION_TEMPLATE", "List entry dimensions must be explicit px.", id);
        const seenFields = new Set<string>();
        const visitFields = (entry: UiNode) => {
          if (entry.kind === "collection") fail("E_COLLECTION_TEMPLATE", "Nested collections are not supported.", id);
          if (entry.kind === "text" || entry.kind === "image") {
            if (!entry.field || seenFields.has(entry.field)) fail("E_COLLECTION_TEMPLATE", "Text/image fields must have unique data-ui-field names within an entry.", entry.id);
            seenFields.add(entry.field!);
          }
          entry.children.forEach(visitFields);
        };
        visitFields(template);
        const items: CollectionItem[] = node.children.map((candidate) => {
          const result: CollectionItem = { key: candidate.id, nodeIds: Object.create(null), overrides: Object.create(null) };
          const match = (base: UiNode, current: UiNode) => {
            const structural = (entry: UiNode) => ({ kind: entry.kind, field: entry.field, layout: entry.layout, box: entry.box, text: entry.text ? { ...entry.text, value: "" } : undefined, childCount: entry.children.length });
            if (JSON.stringify(structural(base)) !== JSON.stringify(structural(current))) fail("E_COLLECTION_TEMPLATE", "Entry structure, field names, sizes and styles must match; only text/image/colors may vary.", current.id);
            result.nodeIds[base.id] = current.id;
            const override: CollectionItem["overrides"][string] = {};
            if (base.text?.value !== current.text?.value) override.text = current.text!.value;
            if (base.assetId !== current.assetId) override.assetId = current.assetId;
            if (base.paint.background !== current.paint.background) override.background = current.paint.background;
            if (base.paint.color !== current.paint.color) override.color = current.paint.color;
            if (Object.keys(override).length) result.overrides[base.id] = override;
            base.children.forEach((child, index) => match(child, current.children[index]));
          };
          match(template, candidate); return result;
        });
        document.templates[templateId!] = structuredClone(template);
        const collectionId = `${id}Collection`;
        document.collections.push({ id: collectionId, nodeId: id, templateId: templateId!, orientation: layout === "row" ? "horizontal" : "vertical", items });
        node.kind = "collection"; node.collectionId = collectionId; node.children = [];
      }
      return node;
    };
    document.root = await convert(snapshot.root);
    assertDocument(document);
    const sourceScreenshot = await page.screenshot({ type: "png" });
    return { document, assetContents, sourceScreenshot, browserVersion: browser.version() };
  } finally {
    await closePage?.();
    if (!externalBrowser) await browser.close();
  }
}
