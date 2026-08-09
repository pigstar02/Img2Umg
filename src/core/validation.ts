import type { EntryFile, ManifestFile, PreviewFile, ScreenFile, UiNode, UiPackage } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const nodeProps: Record<UiNode["type"], Set<string>> = {
  Canvas: new Set([]),
  Overlay: new Set([]),
  HorizontalBox: new Set([]),
  VerticalBox: new Set([]),
  SizeBox: new Set(["widthOverride", "heightOverride", "minWidth", "minHeight"]),
  ScaleBox: new Set(["stretch"]),
  Spacer: new Set(["size"]),
  Border: new Set(["backgroundColor", "borderColor", "borderWidth", "padding"]),
  Image: new Set(["source", "tint", "placeholderColor", "placeholderLabel", "drawAs", "margin"]),
  Text: new Set(["text", "fontSize", "color", "horizontalAlign", "verticalAlign", "wrap"]),
  Button: new Set(["label", "backgroundColor", "textColor", "fontSize"]),
  ProgressBar: new Set(["percent", "fillColor", "backgroundColor"]),
  ListView: new Set(["entryTemplate", "preview", "orientation", "entrySize", "spacing"]),
  TileView: new Set(["entryTemplate", "preview", "entrySize", "spacing", "columns"]),
};

const containers = new Set<UiNode["type"]>(["Canvas", "Overlay", "HorizontalBox", "VerticalBox", "SizeBox", "ScaleBox", "Border", "Button"]);
const leaves = new Set<UiNode["type"]>(["Spacer", "Image", "Text", "ProgressBar", "ListView", "TileView"]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string, errors: string[]) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}.${key}: unknown field`);
  }
}

function nonEmptyString(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "string" || value.length === 0) errors.push(`${path}: expected non-empty string`);
}

function positiveNumber(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) errors.push(`${path}: expected positive number`);
}

function pair(value: unknown, path: string, errors: string[], positive = false) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    errors.push(`${path}: expected two finite numbers`);
  } else if (positive && value.some((v) => v <= 0)) {
    errors.push(`${path}: values must be positive`);
  }
}

function validateNode(value: unknown, path: string, errors: string[], ids: Set<string>, root = false, parentType?: UiNode["type"]) {
  if (!isObject(value)) return errors.push(`${path}: expected object`);
  exactKeys(value, ["id", "type", "props", "slot", "children"], path, errors);
  nonEmptyString(value.id, `${path}.id`, errors);
  if (typeof value.id === "string") {
    if (ids.has(value.id)) errors.push(`${path}.id: duplicate id ${value.id}`);
    ids.add(value.id);
  }
  if (typeof value.type !== "string" || !(value.type in nodeProps)) {
    errors.push(`${path}.type: unsupported node type`);
    return;
  }
  const type = value.type as UiNode["type"];
  if (value.props !== undefined) {
    if (!isObject(value.props)) errors.push(`${path}.props: expected object`);
    else for (const key of Object.keys(value.props)) {
      if (!nodeProps[type].has(key)) errors.push(`${path}.props.${key}: unsupported for ${type}`);
    }
  }
  if (!root || value.slot !== undefined) {
    if (!isObject(value.slot)) errors.push(`${path}.slot: expected object`);
    else validateSlot(value.slot, parentType, `${path}.slot`, errors);
  }
  const children = value.children;
  if (children !== undefined && !Array.isArray(children)) errors.push(`${path}.children: expected array`);
  if (Array.isArray(children)) {
    if (leaves.has(type) && children.length > 0) errors.push(`${path}.children: ${type} cannot have children`);
    if (!containers.has(type) && !leaves.has(type)) errors.push(`${path}.children: unsupported container`);
    children.forEach((child, index) => validateNode(child, `${path}.children[${index}]`, errors, ids, false, type));
    if ((type === "SizeBox" || type === "ScaleBox" || type === "Border" || type === "Button") && children.length > 1) errors.push(`${path}.children: ${type} accepts at most one child`);
  }
  const props = isObject(value.props) ? value.props : {};
  if (type === "Text") nonEmptyString(props.text, `${path}.props.text`, errors);
  if (type === "ProgressBar" && (typeof props.percent !== "number" || props.percent < 0 || props.percent > 1)) errors.push(`${path}.props.percent: expected number from 0 to 1`);
  if (type === "ListView" || type === "TileView") {
    nonEmptyString(props.entryTemplate, `${path}.props.entryTemplate`, errors);
    nonEmptyString(props.preview, `${path}.props.preview`, errors);
    pair(props.entrySize, `${path}.props.entrySize`, errors, true);
    pair(props.spacing, `${path}.props.spacing`, errors);
  }
}

function validateSlot(slot: Record<string, unknown>, parentType: UiNode["type"] | undefined, path: string, errors: string[]) {
  if (parentType === "Canvas") {
    exactKeys(slot, ["position", "size", "zOrder"], path, errors);
    pair(slot.position, `${path}.position`, errors);
    pair(slot.size, `${path}.size`, errors, true);
    if (slot.zOrder !== undefined && !Number.isInteger(slot.zOrder)) errors.push(`${path}.zOrder: expected integer`);
    return;
  }
  const box = parentType === "HorizontalBox" || parentType === "VerticalBox";
  const allowed = box ? ["padding", "horizontalAlign", "verticalAlign", "sizeRule", "fill"] : ["padding", "horizontalAlign", "verticalAlign"];
  exactKeys(slot, allowed, path, errors);
  if (slot.padding !== undefined && (!Array.isArray(slot.padding) || slot.padding.length !== 4 || slot.padding.some((value) => typeof value !== "number" || !Number.isFinite(value)))) errors.push(`${path}.padding: expected four finite numbers`);
  if (slot.horizontalAlign !== undefined && !["left", "center", "right", "fill"].includes(String(slot.horizontalAlign))) errors.push(`${path}.horizontalAlign: invalid alignment`);
  if (slot.verticalAlign !== undefined && !["top", "center", "bottom", "fill"].includes(String(slot.verticalAlign))) errors.push(`${path}.verticalAlign: invalid alignment`);
  if (box) {
    if (slot.sizeRule !== "auto" && slot.sizeRule !== "fill") errors.push(`${path}.sizeRule: expected auto or fill`);
    if (slot.fill !== undefined && (typeof slot.fill !== "number" || slot.fill <= 0)) errors.push(`${path}.fill: expected positive number`);
    if (slot.sizeRule !== "fill" && slot.fill !== undefined) errors.push(`${path}.fill: only valid with fill sizeRule`);
  }
}

function validateHeader(value: unknown, format: string, allowed: string[], errors: string[]): value is Record<string, unknown> {
  if (!isObject(value)) {
    errors.push("$: expected object");
    return false;
  }
  exactKeys(value, allowed, "$", errors);
  if (value.format !== format) errors.push(`$.format: expected ${format}`);
  if (value.version !== 1) errors.push("$.version: expected 1");
  return true;
}

export function validateScreen(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (validateHeader(value, "img2umg-screen", ["format", "version", "id", "canvas", "root"], errors)) {
    nonEmptyString(value.id, "$.id", errors);
    if (!isObject(value.canvas)) errors.push("$.canvas: expected object");
    else {
      exactKeys(value.canvas, ["width", "height"], "$.canvas", errors);
      positiveNumber(value.canvas.width, "$.canvas.width", errors);
      positiveNumber(value.canvas.height, "$.canvas.height", errors);
    }
    validateNode(value.root, "$.root", errors, new Set(), true);
  }
  return { valid: errors.length === 0, errors };
}

export function validateEntry(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (validateHeader(value, "img2umg-entry", ["format", "version", "id", "size", "root"], errors)) {
    nonEmptyString(value.id, "$.id", errors);
    pair(value.size, "$.size", errors, true);
    validateNode(value.root, "$.root", errors, new Set(), true);
  }
  return { valid: errors.length === 0, errors };
}

export function validatePreview(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (validateHeader(value, "img2umg-preview", ["format", "version", "entryTemplate", "items"], errors)) {
    nonEmptyString(value.entryTemplate, "$.entryTemplate", errors);
    if (!Array.isArray(value.items)) errors.push("$.items: expected array");
    else value.items.forEach((item, itemIndex) => {
      const path = `$.items[${itemIndex}]`;
      if (!isObject(item)) return errors.push(`${path}: expected object`);
      exactKeys(item, ["overrides"], path, errors);
      if (!Array.isArray(item.overrides)) errors.push(`${path}.overrides: expected array`);
      else item.overrides.forEach((override, index) => {
        const overridePath = `${path}.overrides[${index}]`;
        if (!isObject(override)) return errors.push(`${overridePath}: expected object`);
        exactKeys(override, ["target", "props"], overridePath, errors);
        nonEmptyString(override.target, `${overridePath}.target`, errors);
        if (!isObject(override.props)) errors.push(`${overridePath}.props: expected object`);
      });
    });
  }
  return { valid: errors.length === 0, errors };
}

export function validateManifest(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (validateHeader(value, "img2umg-package", ["format", "version", "screens", "entries", "previews"], errors)) {
    for (const field of ["screens", "entries", "previews"] as const) {
      const refs = value[field];
      if (!Array.isArray(refs)) errors.push(`$.${field}: expected array`);
      else refs.forEach((ref, index) => {
        const path = `$.${field}[${index}]`;
        if (!isObject(ref)) return errors.push(`${path}: expected object`);
        exactKeys(ref, ["id", "file"], path, errors);
        nonEmptyString(ref.id, `${path}.id`, errors);
        nonEmptyString(ref.file, `${path}.file`, errors);
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validatePackage(pkg: UiPackage): ValidationResult {
  const errors = validateManifest(pkg.manifest).errors;
  for (const [file, screen] of Object.entries(pkg.screens)) errors.push(...validateScreen(screen).errors.map((error) => `${file}${error.slice(1)}`));
  for (const [file, entry] of Object.entries(pkg.entries)) errors.push(...validateEntry(entry).errors.map((error) => `${file}${error.slice(1)}`));
  for (const [file, preview] of Object.entries(pkg.previews)) errors.push(...validatePreview(preview).errors.map((error) => `${file}${error.slice(1)}`));

  for (const ref of pkg.manifest.screens) if (!pkg.screens[ref.file]) errors.push(`manifest: missing screen file ${ref.file}`);
  for (const ref of pkg.manifest.entries) if (!pkg.entries[ref.file]) errors.push(`manifest: missing entry file ${ref.file}`);
  for (const ref of pkg.manifest.previews) if (!pkg.previews[ref.file]) errors.push(`manifest: missing preview file ${ref.file}`);

  const entryIds = new Set(pkg.manifest.entries.map((ref) => ref.id));
  const previewIds = new Set(pkg.manifest.previews.map((ref) => ref.id));
  for (const screen of Object.values(pkg.screens)) walk(screen.root, (node) => {
    if (node.type !== "ListView" && node.type !== "TileView") return;
    const entry = node.props?.entryTemplate;
    const preview = node.props?.preview;
    if (typeof entry === "string" && !entryIds.has(entry)) errors.push(`${screen.id}.${node.id}: missing entry ${entry}`);
    if (typeof preview === "string" && !previewIds.has(preview)) errors.push(`${screen.id}.${node.id}: missing preview ${preview}`);
  });
  for (const preview of Object.values(pkg.previews)) if (!entryIds.has(preview.entryTemplate)) errors.push(`preview ${preview.entryTemplate}: missing entry`);
  return { valid: errors.length === 0, errors };
}

export function assertValidPackage(pkg: UiPackage): asserts pkg is UiPackage {
  const result = validatePackage(pkg);
  if (!result.valid) throw new Error(result.errors.join("\n"));
}

function walk(node: UiNode, visit: (node: UiNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

export type { ScreenFile, EntryFile, PreviewFile, ManifestFile };
