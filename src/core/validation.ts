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
  Border: new Set(["backgroundColor", "borderColor", "borderWidth", "cornerRadius", "padding"]),
  Image: new Set(["source", "tint", "placeholderColor", "placeholderLabel", "drawAs", "margin"]),
  Text: new Set(["text", "fontSize", "color", "horizontalAlign", "verticalAlign", "wrap"]),
  Button: new Set(["label", "backgroundColor", "textColor", "fontSize"]),
  ProgressBar: new Set(["percent", "fillColor", "backgroundColor"]),
  ListView: new Set(["entryTemplate", "preview", "orientation", "entrySize", "spacing"]),
  TileView: new Set(["entryTemplate", "preview", "orientation", "entrySize", "spacing", "columns"]),
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

function optionalNumber(value: unknown, path: string, errors: string[], minimum?: number) {
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value)) errors.push(`${path}: expected finite number`);
  else if (minimum !== undefined && value < minimum) errors.push(`${path}: expected number at least ${minimum}`);
}

function optionalBoolean(value: unknown, path: string, errors: string[]) {
  if (value !== undefined && typeof value !== "boolean") errors.push(`${path}: expected boolean`);
}

function optionalEnum(value: unknown, allowed: string[], path: string, errors: string[]) {
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) errors.push(`${path}: expected one of ${allowed.join(", ")}`);
}

function optionalColor(value: unknown, path: string, errors: string[]) {
  if (value !== undefined && (typeof value !== "string" || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value))) errors.push(`${path}: expected #RRGGBB or #RRGGBBAA`);
}

function margin(value: unknown, path: string, errors: string[]) {
  if (value === undefined) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!Array.isArray(value) || ![2, 4].includes(value.length) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    errors.push(`${path}: expected a number, two numbers, or four numbers`);
  }
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
  if (root && value.slot !== undefined) errors.push(`${path}.slot: root widget cannot have slot properties`);
  if (!root) {
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
  if (type === "SizeBox") {
    for (const key of ["widthOverride", "heightOverride", "minWidth", "minHeight"]) if (props[key] !== undefined) positiveNumber(props[key], `${path}.props.${key}`, errors);
  }
  if (type === "ScaleBox") optionalEnum(props.stretch, ["none", "fill", "scaleToFit", "scaleToFill", "scaleToFitX", "scaleToFitY"], `${path}.props.stretch`, errors);
  if (type === "Border") {
    optionalColor(props.backgroundColor, `${path}.props.backgroundColor`, errors);
    optionalColor(props.borderColor, `${path}.props.borderColor`, errors);
    margin(props.padding, `${path}.props.padding`, errors);
    optionalNumber(props.borderWidth, `${path}.props.borderWidth`, errors, 0);
    optionalNumber(props.cornerRadius, `${path}.props.cornerRadius`, errors, 0);
    if ((props.borderColor === undefined) !== (props.borderWidth === undefined)) errors.push(`${path}.props: borderColor and borderWidth must be used together`);
  }
  if (type === "Image") {
    if (props.source !== undefined && props.source !== null && (typeof props.source !== "string" || props.source.length === 0)) errors.push(`${path}.props.source: expected null or non-empty Unreal texture path`);
    optionalColor(props.tint, `${path}.props.tint`, errors);
    optionalColor(props.placeholderColor, `${path}.props.placeholderColor`, errors);
    if (props.placeholderLabel !== undefined && typeof props.placeholderLabel !== "string") errors.push(`${path}.props.placeholderLabel: expected string`);
    optionalEnum(props.drawAs, ["image", "box", "border"], `${path}.props.drawAs`, errors);
    margin(props.margin, `${path}.props.margin`, errors);
  }
  if (type === "Text") {
    nonEmptyString(props.text, `${path}.props.text`, errors);
    if (props.fontSize !== undefined) positiveNumber(props.fontSize, `${path}.props.fontSize`, errors);
    optionalColor(props.color, `${path}.props.color`, errors);
    optionalEnum(props.horizontalAlign, ["left", "center", "right"], `${path}.props.horizontalAlign`, errors);
    optionalEnum(props.verticalAlign, ["top", "center", "bottom"], `${path}.props.verticalAlign`, errors);
    optionalBoolean(props.wrap, `${path}.props.wrap`, errors);
  }
  if (type === "Button") {
    if (props.label !== undefined && typeof props.label !== "string") errors.push(`${path}.props.label: expected string`);
    optionalColor(props.backgroundColor, `${path}.props.backgroundColor`, errors);
    optionalColor(props.textColor, `${path}.props.textColor`, errors);
    if (props.fontSize !== undefined) positiveNumber(props.fontSize, `${path}.props.fontSize`, errors);
    if ((props.textColor !== undefined || props.fontSize !== undefined) && typeof props.label !== "string") errors.push(`${path}.props: textColor and fontSize require label`);
    if (typeof props.label === "string" && Array.isArray(children) && children.length > 0) errors.push(`${path}: Button cannot use label and explicit children together`);
  }
  if (type === "ProgressBar") {
    if (typeof props.percent !== "number" || props.percent < 0 || props.percent > 1) errors.push(`${path}.props.percent: expected number from 0 to 1`);
    optionalColor(props.fillColor, `${path}.props.fillColor`, errors);
    optionalColor(props.backgroundColor, `${path}.props.backgroundColor`, errors);
  }
  if (type === "Spacer") pair(props.size, `${path}.props.size`, errors);
  if (type === "ListView" || type === "TileView") {
    nonEmptyString(props.entryTemplate, `${path}.props.entryTemplate`, errors);
    nonEmptyString(props.preview, `${path}.props.preview`, errors);
    pair(props.entrySize, `${path}.props.entrySize`, errors, true);
    pair(props.spacing, `${path}.props.spacing`, errors);
    if (Array.isArray(props.spacing) && props.spacing.some((value) => typeof value === "number" && value < 0)) errors.push(`${path}.props.spacing: values cannot be negative`);
    optionalEnum(props.orientation, ["vertical", "horizontal"], `${path}.props.orientation`, errors);
    if (type === "TileView" && (!Number.isInteger(props.columns) || Number(props.columns) < 1)) errors.push(`${path}.props.columns: expected positive integer`);
    if (type === "ListView" && props.columns !== undefined) errors.push(`${path}.props.columns: unsupported for ListView`);
  }
}

function validateSlot(slot: Record<string, unknown>, parentType: UiNode["type"] | undefined, path: string, errors: string[]) {
  if (parentType === "Canvas") {
    exactKeys(slot, ["position", "size", "anchors", "alignment", "zOrder"], path, errors);
    pair(slot.position, `${path}.position`, errors);
    pair(slot.size, `${path}.size`, errors);
    const anchors = slot.anchors;
    if (anchors !== undefined && (!Array.isArray(anchors) || anchors.length !== 4 || anchors.some((value) => typeof value !== "number" || !Number.isFinite(value)))) {
      errors.push(`${path}.anchors: expected four finite numbers`);
    }
    const validAnchors = Array.isArray(anchors) && anchors.length === 4 && anchors.every((value) => typeof value === "number" && Number.isFinite(value));
    if (validAnchors && (anchors.some((value) => value < 0 || value > 1) || anchors[0] > anchors[2] || anchors[1] > anchors[3])) {
      errors.push(`${path}.anchors: expected ordered values from 0 to 1`);
    }
    if (slot.alignment !== undefined) {
      pair(slot.alignment, `${path}.alignment`, errors);
      if (Array.isArray(slot.alignment) && slot.alignment.some((value) => typeof value === "number" && (value < 0 || value > 1))) errors.push(`${path}.alignment: expected values from 0 to 1`);
    }
    if (Array.isArray(slot.size) && slot.size.length === 2) {
      const fixedX = !validAnchors || anchors[0] === anchors[2];
      const fixedY = !validAnchors || anchors[1] === anchors[3];
      if (fixedX && (typeof slot.size[0] !== "number" || slot.size[0] <= 0)) errors.push(`${path}.size[0]: expected positive size for fixed horizontal anchors`);
      if (fixedY && (typeof slot.size[1] !== "number" || slot.size[1] <= 0)) errors.push(`${path}.size[1]: expected positive size for fixed vertical anchors`);
    }
    if (slot.zOrder !== undefined && !Number.isInteger(slot.zOrder)) errors.push(`${path}.zOrder: expected integer`);
    return;
  }
  const box = parentType === "HorizontalBox" || parentType === "VerticalBox";
  const allowed = box ? ["padding", "horizontalAlign", "verticalAlign", "sizeRule", "fill"] : ["padding", "horizontalAlign", "verticalAlign"];
  exactKeys(slot, allowed, path, errors);
  if (slot.padding !== undefined && (!Array.isArray(slot.padding) || slot.padding.length !== 4 || slot.padding.some((value) => typeof value !== "number" || !Number.isFinite(value)))) errors.push(`${path}.padding: expected four finite numbers`);
  if (parentType === "ScaleBox" && Array.isArray(slot.padding) && slot.padding.some((value) => typeof value === "number" && value !== 0)) errors.push(`${path}.padding: ScaleBox does not support non-zero slot padding in Unreal Engine 5.1 or newer`);
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
  const manifestValidation = validateManifest(pkg.manifest);
  if (!manifestValidation.valid) return manifestValidation;
  const errors = manifestValidation.errors;
  for (const [file, screen] of Object.entries(pkg.screens)) errors.push(...validateScreen(screen).errors.map((error) => `${file}${error.slice(1)}`));
  for (const [file, entry] of Object.entries(pkg.entries)) errors.push(...validateEntry(entry).errors.map((error) => `${file}${error.slice(1)}`));
  for (const [file, preview] of Object.entries(pkg.previews)) errors.push(...validatePreview(preview).errors.map((error) => `${file}${error.slice(1)}`));

  for (const ref of pkg.manifest.screens) if (!pkg.screens[ref.file]) errors.push(`manifest: missing screen file ${ref.file}`);
  for (const ref of pkg.manifest.entries) if (!pkg.entries[ref.file]) errors.push(`manifest: missing entry file ${ref.file}`);
  for (const ref of pkg.manifest.previews) if (!pkg.previews[ref.file]) errors.push(`manifest: missing preview file ${ref.file}`);

  const assetIds = new Set<string>();
  const assetFiles = new Set<string>();
  for (const section of [pkg.manifest.screens, pkg.manifest.entries, pkg.manifest.previews]) for (const ref of section) {
    if (assetIds.has(ref.id)) errors.push(`manifest: duplicate asset id ${ref.id}`);
    if (assetFiles.has(ref.file)) errors.push(`manifest: duplicate asset file ${ref.file}`);
    assetIds.add(ref.id);
    assetFiles.add(ref.file);
  }
  for (const ref of pkg.manifest.screens) if (pkg.screens[ref.file] && pkg.screens[ref.file].id !== ref.id) errors.push(`manifest: screen id ${ref.id} does not match ${ref.file}`);
  for (const ref of pkg.manifest.entries) if (pkg.entries[ref.file] && pkg.entries[ref.file].id !== ref.id) errors.push(`manifest: entry id ${ref.id} does not match ${ref.file}`);

  const entryIds = new Set(pkg.manifest.entries.map((ref) => ref.id));
  const previewIds = new Set(pkg.manifest.previews.map((ref) => ref.id));
  const roots = [...Object.values(pkg.screens).map((document) => ({ id: document.id, root: document.root })), ...Object.values(pkg.entries).map((document) => ({ id: document.id, root: document.root }))];
  for (const document of roots) walk(document.root, (node) => {
    if (node.type !== "ListView" && node.type !== "TileView") return;
    const entry = node.props?.entryTemplate;
    const preview = node.props?.preview;
    if (typeof entry === "string" && !entryIds.has(entry)) errors.push(`${document.id}.${node.id}: missing entry ${entry}`);
    if (typeof preview === "string" && !previewIds.has(preview)) errors.push(`${document.id}.${node.id}: missing preview ${preview}`);
  });
  for (const preview of Object.values(pkg.previews)) if (!entryIds.has(preview.entryTemplate)) errors.push(`preview ${preview.entryTemplate}: missing entry`);

  const entriesById = new Map(pkg.manifest.entries.map((ref) => [ref.id, pkg.entries[ref.file]]));
  for (const [file, preview] of Object.entries(pkg.previews)) {
    const entry = entriesById.get(preview.entryTemplate);
    if (!entry || !Array.isArray(preview.items)) continue;
    preview.items.forEach((item, itemIndex) => {
      if (!Array.isArray(item.overrides)) return;
      const candidate = structuredClone(entry);
      const targets = new Map<string, UiNode>();
      walk(candidate.root, (node) => targets.set(node.id, node));
      for (const override of item.overrides) {
        const target = targets.get(override.target);
        if (!target) errors.push(`${file}.items[${itemIndex}]: missing override target ${override.target}`);
        else target.props = { ...target.props, ...override.props };
      }
      errors.push(...validateEntry(candidate).errors.map((error) => `${file}.items[${itemIndex}]${error.slice(1)}`));
    });
  }
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
