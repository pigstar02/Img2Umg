import Ajv from "ajv";
import schema from "../schema/ui.schema.json";
import type { UiDocument, UiNode } from "./types";

const ajv = new Ajv({ allErrors: true, strict: true, ownProperties: true });
const validateShape = ajv.compile<UiDocument>(schema);
const fontKey = (family: string, weight: number) => JSON.stringify([family, weight]);

function safeAssetPath(path: string): boolean {
  const safe = (value: string) => value.length > 0 && value === value.trim()
    && !value.startsWith("/") && !/^[a-z][a-z\d+.-]*:/i.test(value)
    && !/[\\\u0000-\u001f\u007f?#]/.test(value) && !value.split("/").includes("..");
  try {
    // Browsers resolve URL-encoded dot segments and the resource router decodes paths.
    return safe(path) && safe(decodeURIComponent(path));
  } catch {
    return false;
  }
}

/** Validate structure first: no semantic pass ever receives an unchecked payload. */
export function validateDocument(value: unknown): { valid: boolean; errors: string[] } {
  try {
    if (!validateShape(value)) {
      return {
        valid: false,
        errors: (validateShape.errors ?? []).map((error) =>
          `${error.instancePath || "/"}: ${error.message ?? "invalid value"} (${JSON.stringify(error.params)})`,
        ),
      };
    }
    const errors = validateSemantics(value);
    return { valid: errors.length === 0, errors };
  } catch (error) {
    // Non-JSON inputs (cycles, getters, proxies) must not escape as runtime crashes.
    return { valid: false, errors: [`Document validation failed: ${error instanceof Error ? error.message : "unreadable input"}`] };
  }
}

export function assertDocument(value: unknown): asserts value is UiDocument {
  const result = validateDocument(value);
  if (!result.valid) throw new Error(result.errors.join("\n"));
}

function validateSemantics(doc: UiDocument): string[] {
  const errors: string[] = [];
  const fail = (where: string, message: string) => { errors.push(`${where}: ${message}`); };
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]));
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  for (const asset of doc.assets) {
    if (assetIds.has(asset.id)) fail("assets", `duplicate asset id ${asset.id}`);
    if (assetPaths.has(asset.path)) fail("assets", `duplicate asset path ${asset.path}`);
    assetIds.add(asset.id);
    assetPaths.add(asset.path);
    if (!safeAssetPath(asset.path)) {
      fail(`assets/${asset.id}`, "path must be a safe relative path before and after URL decoding (no '..', backslash, protocol, query, or hash)");
    }
  }
  const fonts = new Set<string>();
  for (const font of doc.fonts) {
    const key = fontKey(font.family, font.weight);
    if (fonts.has(key)) fail("fonts", `duplicate family/weight ${key}`);
    fonts.add(key);
    if (assets.get(font.assetId)?.kind !== "font") fail("fonts", `asset ${font.assetId} must reference a font asset`);
  }
  const requireImage = (assetId: string, where: string) => {
    if (assets.get(assetId)?.kind !== "image") fail(where, `asset ${assetId} must reference an image asset`);
  };
  function indexTree(root: UiNode, where: string, template: boolean): Map<string, UiNode> {
    const nodes = new Map<string, UiNode>();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      const at = `${where}/${node.id}`;
      if (nodes.has(node.id)) fail(at, "duplicate node id within tree");
      nodes.set(node.id, node);
      if (node.kind === "text") {
        if (!node.text) fail(at, "text node requires text");
        if (node.children.length) fail(at, "text node cannot have children");
      } else if (node.text !== undefined) fail(at, "only text nodes may carry text");
      if (node.text && !fonts.has(fontKey(node.text.family, node.text.weight))) fail(at, "text family/weight has no font definition");
      if (node.kind === "text" || node.kind === "image") {
        if (node.layout !== "leaf") fail(at, "text/image layout must be leaf");
      }
      if (node.kind === "button" && node.children.length > 1) fail(at, "button allows at most one child");
      if (node.kind === "image") {
        if (node.children.length) fail(at, "image node cannot have children");
        if (!node.assetId) fail(at, "image node requires assetId");
        else requireImage(node.assetId, at);
      } else if (node.assetId !== undefined) fail(at, "only image nodes may carry assetId");
      if (node.kind === "collection") {
        if (template) fail(at, "templates cannot contain collections");
        if (!node.collectionId) fail(at, "collection node requires collectionId");
        if (node.children.length) fail(at, "collection view cannot have children");
      } else if (node.collectionId !== undefined) fail(at, "only collection nodes may carry collectionId");
      if (node.layout === "leaf" && !(node.kind === "text" || node.kind === "image" || (node.kind === "button" && node.children.length === 0))) {
        fail(at, "leaf layout requires text, image, or a childless button");
      }
      stack.push(...node.children);
    }
    return nodes;
  }
  const rootNodes = indexTree(doc.root, "root", false);
  const templates = new Map<string, { root: UiNode; nodes: Map<string, UiNode> }>();
  for (const [id, root] of Object.entries(doc.templates)) {
    templates.set(id, { root, nodes: indexTree(root, `templates/${id}`, true) });
    if (root.box.position !== "flow") fail(`templates/${id}`, "template root box.position must be flow");
  }
  const referencedTemplates = new Set(doc.collections.map(collection => collection.templateId));
  for (const id of templates.keys()) {
    if (!referencedTemplates.has(id)) fail(`templates/${id}`, "orphan template must be referenced by a collection");
  }
  // Template IDs live in separate namespaces; only actual root/instance IDs share this set.
  const actualIds = new Set(rootNodes.keys());
  const collectionIds = new Set<string>();
  const collectionNodeIds = new Set<string>();
  const itemKeys = new Set<string>();
  for (const collection of doc.collections) {
    const at = `collections/${collection.id}`;
    if (collectionIds.has(collection.id)) fail(at, "duplicate collection id");
    if (collectionNodeIds.has(collection.nodeId)) fail(at, "duplicate collection nodeId");
    collectionIds.add(collection.id);
    collectionNodeIds.add(collection.nodeId);
    const view = rootNodes.get(collection.nodeId);
    if (!view) fail(at, `nodeId ${collection.nodeId} does not exist in root tree`);
    else {
      if (view.kind !== "collection" || view.collectionId !== collection.id) fail(at, "view must be collection kind with matching collectionId");
      if (view.layout !== (collection.orientation === "horizontal" ? "row" : "column")) fail(at, "orientation must match view row/column layout");
    }
    const template = templates.get(collection.templateId);
    if (!template) fail(at, `templateId ${collection.templateId} does not exist`);
    for (const item of collection.items) {
      const itemAt = `${at}/items/${item.key}`;
      if (itemKeys.has(item.key)) fail(itemAt, "duplicate item key");
      itemKeys.add(item.key);
      if (template) {
        const keys = Object.keys(item.nodeIds);
        if (keys.length !== template.nodes.size || keys.some((id) => !template.nodes.has(id))) fail(itemAt, "nodeIds must contain exactly all template node ids");
        if (!Object.prototype.hasOwnProperty.call(item.nodeIds, template.root.id) || item.key !== item.nodeIds[template.root.id]) fail(itemAt, "item key must equal mapped template root id");
      }
      for (const actualId of Object.values(item.nodeIds)) {
        if (actualIds.has(actualId)) fail(itemAt, `duplicate actual node id ${actualId}`);
        actualIds.add(actualId);
      }
      for (const [targetId, override] of Object.entries(item.overrides)) {
        const target = template?.nodes.get(targetId);
        if (!target) fail(itemAt, `override target ${targetId} does not exist in template`);
        if (override.text !== undefined && target?.kind !== "text") fail(itemAt, "text override requires a text target");
        if (override.assetId !== undefined) {
          if (target?.kind !== "image") fail(itemAt, "assetId override requires an image target");
          requireImage(override.assetId, itemAt);
        }
      }
    }
  }
  for (const node of rootNodes.values()) {
    if (node.kind === "collection" && !doc.collections.some((collection) => collection.id === node.collectionId && collection.nodeId === node.id)) {
      fail(`root/${node.id}`, "collection view has no matching collection definition");
    }
  }
  const observedIds = new Set(Object.keys(doc.observations));
  for (const id of actualIds) if (!observedIds.has(id)) fail("observations", `missing actual node id ${id}`);
  for (const id of observedIds) if (!actualIds.has(id)) fail("observations", `unexpected node id ${id}`);
  return errors;
}
