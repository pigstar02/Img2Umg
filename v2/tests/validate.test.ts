import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import schema from "../schema/ui.schema.json";
import { assertDocument, validateDocument } from "../src/validate";
import type { UiDocument, UiNode } from "../src/types";

function node(id: string, kind: UiNode["kind"] = "panel"): UiNode {
  return {
    id, kind, layout: kind === "text" || kind === "image" ? "leaf" : "column",
    box: { width: "auto", height: "auto", padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0,
      align: "stretch", self: "auto", position: "flow", left: 0, top: 0, zIndex: 0,
      display: "visible", visibility: "visible", overflow: "visible" },
    paint: { background: "transparent", color: "rgb(0, 0, 0)" }, children: [],
  };
}
function textList(): UiDocument {
  const root = node("root");
  const view = node("list", "collection");
  view.collectionId = "rows";
  root.children = [view];
  const template = node("row");
  const label = node("label", "text");
  label.text = { value: "Default", family: "Test Sans", size: 16, weight: 400, align: "left" };
  template.children = [label];
  return {
    format: "html-umg-ir", version: 2, target: "ue-5.8.2", viewport: { width: 320, height: 240 }, root,
    templates: { rowTemplate: template },
    collections: [{ id: "rows", nodeId: "list", templateId: "rowTemplate", orientation: "vertical", items: [
      { key: "row", nodeIds: { row: "row", label: "label" }, overrides: { label: { text: "One", color: "rgba(0, 0, 0, 0.5)" } } },
      { key: "row2", nodeIds: { row: "row2", label: "label2" }, overrides: { label: { text: "Two" }, row: { background: "#abc" } } },
    ] }],
    assets: [{ id: "font", path: "fonts/test.ttf", kind: "font", mime: "font/ttf", sha256: "a".repeat(64) }],
    fonts: [{ family: "Test Sans", weight: 400, assetId: "font" }],
    observations: Object.fromEntries(["root", "list", "row", "label", "row2", "label2"].map((id) => [id, { x: 0, y: 0, width: 0, height: 0 }])),
  };
}
const template = (doc: UiDocument) => doc.templates.rowTemplate!;
const label = (doc: UiDocument) => template(doc).children[0]!;
const view = (doc: UiDocument) => doc.root.children[0]!;
const collection = (doc: UiDocument) => doc.collections[0]!;
const item = (doc: UiDocument) => collection(doc).items[0]!;

describe("v2 JSON schema and runtime validation", () => {
  it("accepts a valid text list, including template/instance IDs in separate namespaces", () => {
    const doc: unknown = textList();
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
    expect(() => assertDocument(doc)).not.toThrow();
    assertDocument(doc);
    expect(doc.version).toBe(2);
    expect(new Ajv({ strict: true }).compile(schema)(doc)).toBe(true);
  });

  it("accepts collapsed zero rects, empty item lists, and horizontal layout", () => {
    const doc = textList();
    view(doc).box.display = "collapsed";
    view(doc).layout = "row";
    collection(doc).orientation = "horizontal";
    collection(doc).items = [];
    doc.observations = { root: { x: -5, y: -5, width: 0, height: 0 }, list: { x: 0, y: 0, width: 0, height: 0 } };
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });

  it("accepts image assets and image overrides", () => {
    const doc = textList();
    doc.assets.push({ id: "photo", path: "images/photo.png", kind: "image", mime: "image/png", sha256: "F".repeat(64) });
    label(doc).kind = "image";
    delete label(doc).text;
    label(doc).assetId = "photo";
    for (const row of collection(doc).items) row.overrides = { label: { assetId: "photo", color: "#11223344" } };
    expect(validateDocument(doc).valid).toBe(true);
  });

  const invalidSemantics: [string, (doc: UiDocument) => void, string][] = [
    ["orphan template", d => { d.templates.unused = node("unused"); }, "orphan template"],
    ["text nonleaf layout", d => { label(d).layout = "row"; }, "text/image layout must be leaf"],
    ["image nonleaf layout", d => { label(d).kind = "image"; delete label(d).text; label(d).layout = "canvas"; }, "text/image layout must be leaf"],
    ["image with children", d => { label(d).kind = "image"; delete label(d).text; label(d).children = [node("illegal")]; }, "image node cannot have children"],
    ["button multiple children", d => { template(d).kind = "button"; template(d).children.push(node("extra")); }, "button allows at most one child"],
    ["duplicate root ids", d => { view(d).id = "root"; }, "duplicate node id"],
    ["duplicate template ids", d => { label(d).id = "row"; }, "duplicate node id"],
    ["missing view reference", d => { collection(d).nodeId = "missing"; }, "does not exist"],
    ["missing template reference", d => { collection(d).templateId = "missing"; }, "templateId"],
    ["duplicate collections", d => { d.collections.push(structuredClone(collection(d))); }, "duplicate collection id"],
    ["duplicate collection nodeId", d => { d.collections.push({ ...collection(d), id: "another", items: [] }); }, "duplicate collection nodeId"],
    ["view kind", d => { view(d).kind = "panel"; }, "view must be collection"],
    ["view collectionId", d => { view(d).collectionId = "missing"; }, "matching collectionId"],
    ["view missing collectionId", d => { delete view(d).collectionId; }, "requires collectionId"],
    ["view has children", d => { view(d).children = [node("illegal")]; }, "cannot have children"],
    ["orphan collection view", d => { d.collections = []; }, "no matching collection"],
    ["noncollection collectionId", d => { d.root.collectionId = "rows"; }, "only collection nodes"],
    ["text requires payload", d => { delete label(d).text; }, "requires text"],
    ["text forbids children", d => { label(d).children = [node("illegal")]; }, "text node cannot"],
    ["nontext forbids payload", d => { d.root.text = label(d).text; }, "only text nodes"],
    ["image requires asset", d => { label(d).kind = "image"; delete label(d).text; }, "requires assetId"],
    ["image reference kind", d => { label(d).kind = "image"; delete label(d).text; label(d).assetId = "font"; }, "image asset"],
    ["nonimage forbids asset", d => { d.root.assetId = "font"; }, "only image nodes"],
    ["panel cannot be leaf", d => { d.root.layout = "leaf"; }, "leaf layout"],
    ["collection cannot be leaf", d => { view(d).layout = "leaf"; }, "leaf layout"],
    ["button with children cannot be leaf", d => { d.root.kind = "button"; d.root.layout = "leaf"; }, "leaf layout"],
    ["template forbids collection", d => { template(d).children.push(node("nested", "collection")); }, "templates cannot"],
    ["font reference missing", d => { d.fonts[0]!.assetId = "missing"; }, "font asset"],
    ["font reference kind", d => { d.assets[0]!.kind = "image"; }, "font asset"],
    ["duplicate font pair", d => { d.fonts.push({ ...d.fonts[0]! }); }, "duplicate family/weight"],
    ["text font missing", d => { label(d).text!.weight = 700; }, "no font definition"],
    ["duplicate asset id", d => { d.assets.push({ ...d.assets[0]!, path: "other.ttf" }); }, "duplicate asset id"],
    ["duplicate asset path", d => { d.assets.push({ ...d.assets[0]!, id: "other" }); }, "duplicate asset path"],
    ["mapping missing id", d => { delete item(d).nodeIds.label; }, "exactly all template"],
    ["mapping extra id", d => { item(d).nodeIds.extra = "extra"; }, "exactly all template"],
    ["mapping root collision", d => { item(d).nodeIds.label = "root"; }, "duplicate actual node id"],
    ["mapping internal collision", d => { item(d).nodeIds.label = "row"; }, "duplicate actual node id"],
    ["mapping cross-item collision", d => { collection(d).items[1]!.nodeIds.label = "label"; }, "duplicate actual node id"],
    ["key/root mismatch", d => { item(d).key = "different"; }, "key must equal"],
    ["duplicate item key", d => { collection(d).items[1]!.key = "row"; }, "duplicate item key"],
    ["override missing target", d => { item(d).overrides.missing = {}; }, "override target"],
    ["override wrong text target", d => { item(d).overrides.row = { text: "bad" }; }, "text override"],
    ["override wrong image target", d => { item(d).overrides.label = { assetId: "font" }; }, "assetId override"],
    ["override missing image", d => { label(d).kind = "image"; delete label(d).text; label(d).assetId = "missing"; item(d).overrides.label = { assetId: "missing" }; }, "image asset"],
    ["orientation mismatch", d => { collection(d).orientation = "horizontal"; }, "orientation"],
    ["template root absolute", d => { template(d).box.position = "absolute"; }, "position must be flow"],
    ["missing observation", d => { delete d.observations.label; }, "missing actual node"],
    ["extra observation", d => { d.observations.extra = { x: 0, y: 0, width: 0, height: 0 }; }, "unexpected node"],
  ];
  it.each(invalidSemantics)("rejects %s", (_name, mutate, expected) => {
    const doc = textList(); mutate(doc);
    const result = validateDocument(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(expected);
    expect(() => assertDocument(doc)).toThrow(result.errors.join("\n"));
  });

  it.each(["../font.ttf", "a/../font.ttf", "a\\..\\font.ttf", "/font.ttf", "\\server\\font.ttf", "C:\\font.ttf", "C:font.ttf", "https://site/font.ttf", "fonts/\u0000.ttf"])("rejects unsafe path %s", path => {
    const doc = textList(); doc.assets[0]!.path = path;
    expect(validateDocument(doc).errors.join("\n")).toContain("safe relative path");
  });

  it.each([
    "%2e%2e/font.ttf", "fonts/%2E%2e/font.ttf", "fonts/.%2e/font.ttf", "fonts/%2e./font.ttf",
    "%2ffont.ttf", "%5cfont.ttf", "fonts%5cfont.ttf", "https%3a//site/font.ttf", "C%3afont.ttf",
    "font.ttf?v=1", "font.ttf#x", "font.ttf%3fv=1", "font.ttf%23x", "%00font.ttf", "font%zz.ttf",
    " font.ttf", "font.ttf ", "fonts\\font.ttf",
  ])("rejects decoded URL path hazards %s", path => {
    const doc = textList(); doc.assets[0]!.path = path;
    expect(validateDocument(doc).errors.join("\n")).toContain("safe relative path");
  });
  it("accepts safe URL-encoded local names and a button with one text child", () => {
    const doc = textList();
    doc.assets[0]!.path = "fonts/Test%20Sans.ttf";
    template(doc).kind = "button";
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
  });
  it.each(["#fff; background:url(https://evil)", "rgb(0,0,0);color:red", "</style><script>alert(1)</script>", "url(file:///etc/passwd)", "rgba(0,0,0,var(--x))"])("rejects color injection %s", color => {
    const doc = textList();
    doc.root.paint.color = color;
    expect(validateDocument(doc).valid).toBe(false);
    doc.root.paint.color = "transparent";
    item(doc).overrides.label!.background = color;
    expect(validateDocument(doc).valid).toBe(false);
  });

  const shapeCases: [string, (doc: any) => void][] = [
    ["unknown document property", d => { d.extra = true; }],
    ["unknown box property", d => { d.root.box.extra = true; }],
    ["unknown node property", d => { d.root.extra = true; }],
    ["unknown paint property", d => { d.root.paint.extra = true; }],
    ["unknown text property", d => { d.templates.rowTemplate.children[0].text.extra = true; }],
    ["unknown viewport property", d => { d.viewport.extra = true; }],
    ["unknown font property", d => { d.fonts[0].extra = true; }],
    ["unknown asset property", d => { d.assets[0].extra = true; }],
    ["unknown collection property", d => { d.collections[0].extra = true; }],
    ["unknown item property", d => { d.collections[0].items[0].extra = true; }],
    ["unknown override property", d => { d.collections[0].items[0].overrides.label.extra = true; }],
    ["unknown rect property", d => { d.observations.root.extra = true; }],
    ["empty template key", d => { d.templates[""] = template(d); }],
    ["empty observation key", d => { d.observations[""] = d.observations.root; }],
    ["empty mapping key", d => { item(d).nodeIds[""] = "value"; }],
    ["empty override key", d => { item(d).overrides[""] = {}; }],
    ["null node", d => { d.root = null; }],
    ["null child", d => { d.root.children = [null]; }],
    ["null box", d => { d.root.box = null; }],
    ["null item", d => { d.collections[0].items = [null]; }],
    ["null mapping", d => { d.collections[0].items[0].nodeIds = null; }],
    ["bad mapping value", d => { d.collections[0].items[0].nodeIds.label = 4; }],
    ["null override", d => { d.collections[0].items[0].overrides.label = null; }],
    ["null text", d => { d.templates.rowTemplate.children[0].text = null; }],
    ["null asset", d => { d.assets = [null]; }],
    ["missing children", d => { delete d.root.children; }],
    ["empty id", d => { d.root.id = ""; }],
    ["negative length", d => { d.root.box.width = -1; }],
    ["invalid length", d => { d.root.box.height = "50px"; }],
    ["infinite number", d => { d.root.box.width = Infinity; }],
    ["NaN number", d => { d.viewport.width = NaN; }],
    ["zero viewport", d => { d.viewport.height = 0; }],
    ["zero font size", d => { label(d).text!.size = 0; }],
    ["negative gap", d => { d.root.box.gap = -1; }],
    ["negative padding", d => { d.root.box.padding[0] = -1; }],
    ["negative margin", d => { d.root.box.margin[1] = -1; }],
    ["short edges", d => { d.root.box.padding = [0, 0]; }],
    ["negative left", d => { d.root.box.left = -1; }],
    ["negative top", d => { d.root.box.top = -1; }],
    ["negative z", d => { d.root.box.zIndex = -1; }],
    ["fractional z", d => { d.root.box.zIndex = 0.5; }],
    ["negative rect", d => { d.observations.root.width = -1; }],
    ["invalid color", d => { d.root.paint.color = "red"; }],
    ["invalid override color", d => { item(d).overrides.label!.color = "garbage"; }],
    ["empty asset path", d => { d.assets[0].path = ""; }],
    ["short sha", d => { d.assets[0].sha256 = "abc"; }],
    ["nonhex sha", d => { d.assets[0].sha256 = "g".repeat(64); }],
    ["sha trailing newline", d => { d.assets[0].sha256 = "a".repeat(64) + "\n"; }],
    ["wrong version", d => { d.version = 1; }],
  ];
  it.each(shapeCases)("schema rejects malformed %s without crashing", (_name, mutate) => {
    const doc = textList(); mutate(doc);
    expect(validateDocument(doc).valid).toBe(false);
    expect(new Ajv({ strict: true }).compile(schema)(doc)).toBe(false);
  });

  it.each([null, undefined, 42, "text", [], {}, { root: null }])("rejects arbitrary unknown input %j", value => {
    expect(validateDocument(value).valid).toBe(false);
  });
  it("handles cycles and throwing accessors without leaking exceptions", () => {
    const cycle = textList(); cycle.root.children.push(cycle.root);
    expect(validateDocument(cycle).valid).toBe(false);
    const throwing = Object.defineProperty({}, "format", { get() { throw new Error("unreadable"); } });
    expect(validateDocument(throwing).valid).toBe(false);
  });
});
