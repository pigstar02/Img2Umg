import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractUiPackage, structureFingerprint } from "../src/core/extract";
import type { EntryFile, UiNode, VisualNode } from "../src/core/types";
import { validateEntry, validatePackage, validateScreen } from "../src/core/validation";
import { writeUiPackage } from "../src/cli/write-package";
import exampleManifest from "../examples/inventory/ui.manifest.json";
import exampleScreen from "../examples/inventory/screens/Inventory.screen.json";
import exampleQuestEntry from "../examples/inventory/entries/Quest_ListItem.entry.json";
import exampleTileEntry from "../examples/inventory/entries/Inventory_TileItem.entry.json";
import exampleQuestPreview from "../examples/inventory/previews/Quest_ListItemPreview.preview.json";
import exampleTilePreview from "../examples/inventory/previews/Inventory_TileItemPreview.preview.json";
import type { UiPackage } from "../src/core/types";

const card = (id: string, x: number, y: number, text = id): VisualNode => ({
  id,
  type: "Border",
  bounds: { x, y, width: 100, height: 80 },
  props: { backgroundColor: "#223344FF" },
  children: [{
    id: "Label",
    type: "Text",
    bounds: { x: x + 10, y: y + 10, width: 80, height: 24 },
    props: { text, fontSize: 16, color: "#FFFFFFFF" },
  }],
});

const DESIGN_CANVAS = { width: 1920, height: 1080 } as const;
const root = (children: VisualNode[]): VisualNode => ({ id: "Root", type: "Canvas", bounds: { x: 0, y: 0, ...DESIGN_CANVAS }, children });

function firstCollection(pkg: ReturnType<typeof extractUiPackage>): UiNode | undefined {
  return pkg.screens["screens/Test.screen.json"].root.children?.find((node) => node.type === "ListView" || node.type === "TileView");
}

describe("list extraction", () => {
  it("extracts a vertical run into a ListView and captures visual overrides", () => {
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([
      card("A", 20, 20, "Alpha"), card("B", 20, 110, "Beta"), card("C", 20, 200, "Gamma"),
    ]));
    const list = firstCollection(pkg);
    expect(list?.type).toBe("ListView");
    expect(list?.isVariable).toBeUndefined();
    expect(list?.props).toMatchObject({ orientation: "vertical", spacing: [0, 10] });
    expect(pkg.manifest.entries).toHaveLength(1);
    expect(Object.values(pkg.previews)[0].items).toHaveLength(3);
    expect(Object.values(pkg.previews)[0].items[1].overrides).toContainEqual({ target: "Label", props: { text: "Beta" } });
    expect(validatePackage(pkg)).toEqual({ valid: true, errors: [] });
  });

  it("extracts repeated structures nested inside an ordinary panel", () => {
    const panel: VisualNode = {
      id: "Panel", type: "Overlay", bounds: { x: 50, y: 50, width: 500, height: 400 },
      children: [card("A", 70, 70), card("B", 70, 160), card("C", 70, 250)],
    };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([panel]));
    expect(pkg.screens["screens/Test.screen.json"].root.children?.[0].children?.[0].type).toBe("ListView");
    expect(pkg.manifest.entries).toHaveLength(1);
  });
});

describe("tile extraction", () => {
  it("extracts a regular grid whose final row is incomplete", () => {
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([
      card("A", 20, 20), card("B", 130, 20), card("C", 240, 20),
      card("D", 20, 110), card("E", 130, 110),
    ]));
    const tile = firstCollection(pkg);
    expect(tile?.type).toBe("TileView");
    expect(tile?.props).toMatchObject({ columns: 3, spacing: [10, 10] });
    expect(Object.values(pkg.previews)[0].items).toHaveLength(5);
  });
});

describe("conservative decisions", () => {
  it("does not extract two matching nodes", () => {
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([card("A", 20, 20), card("B", 20, 110)]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("does not join non-contiguous matching structures", () => {
    const separator: VisualNode = { id: "Divider", type: "Image", bounds: { x: 20, y: 110, width: 100, height: 5 }, props: { placeholderColor: "#FFFFFFFF" } };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([
      card("A", 20, 20), card("B", 20, 120), separator, card("C", 20, 220), card("D", 20, 320),
    ]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("rejects irregular spacing instead of guessing", () => {
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([
      card("A", 20, 20), card("B", 20, 110), card("C", 20, 260),
    ]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("fingerprints structure while ignoring ids and visual props", () => {
    expect(structureFingerprint(card("A", 0, 0, "one"))).toBe(structureFingerprint(card("B", 500, 500, "two")));
  });
});

describe("legacy canvas extraction", () => {
  it("keeps full-screen geometry as conservative top-left fixed layout", () => {
    const backdrop: VisualNode = { id: "Backdrop", type: "Image", bounds: { x: 0, y: 0, ...DESIGN_CANVAS } };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([backdrop]));
    expect(pkg.screens["screens/Test.screen.json"].root.children?.[0].slot).toEqual({
      position: [0, 0], size: [1920, 1080], anchors: [0, 0, 0, 0], alignment: [0, 0],
    });
    expect(validatePackage(pkg)).toEqual({ valid: true, errors: [] });
  });

  it("does not infer center or edge anchors from geometry", () => {
    const centered: VisualNode = { id: "Centered", type: "Border", bounds: { x: 860, y: 490, width: 200, height: 100 } };
    const topRight: VisualNode = { id: "TopRight", type: "Button", bounds: { x: 1820, y: 30, width: 60, height: 40 }, props: { label: "Close" } };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([centered, topRight]));
    const children = pkg.screens["screens/Test.screen.json"].root.children ?? [];
    expect(children.find((node) => node.id === "Centered")?.slot).toEqual({
      position: [860, 490], size: [200, 100], anchors: [0, 0, 0, 0], alignment: [0, 0],
    });
    expect(children.find((node) => node.id === "TopRight")?.slot).toEqual({
      position: [1820, 30], size: [60, 40], anchors: [0, 0, 0, 0], alignment: [0, 0],
    });
  });

  it("does not infer stretch or bottom anchoring from edge proximity", () => {
    const footer: VisualNode = { id: "Footer", type: "Border", bounds: { x: 4, y: 1020, width: 1912, height: 40 } };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([footer]), { alignmentTolerance: 6 });
    expect(pkg.screens["screens/Test.screen.json"].root.children?.[0].slot).toEqual({
      position: [4, 1020], size: [1912, 40], anchors: [0, 0, 0, 0], alignment: [0, 0],
    });
  });

  it("keeps ambiguous geometry top-left fixed", () => {
    const ambiguous: VisualNode = { id: "Ambiguous", type: "Border", bounds: { x: 700, y: 220, width: 200, height: 100 } };
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([ambiguous]));
    expect(pkg.screens["screens/Test.screen.json"].root.children?.[0].slot).toEqual({
      position: [700, 220], size: [200, 100], anchors: [0, 0, 0, 0], alignment: [0, 0],
    });
  });
});

describe("validation and file output", () => {
  it("accepts WidgetSwitcher states and validates the active child", () => {
    const screen = {
      format: "img2umg-screen", version: 1, id: "States", canvas: DESIGN_CANVAS,
      root: {
        id: "Root", type: "Canvas", children: [{
          id: "DialogStates", type: "WidgetSwitcher", props: { activeWidgetIndex: 1 },
          slot: { position: [100, 100], size: [400, 300] },
          children: [
            { id: "NormalState", type: "Overlay", slot: { padding: [0, 0, 0, 0], horizontalAlign: "fill", verticalAlign: "fill" } },
            { id: "ConfirmState", type: "Overlay", slot: { padding: [0, 0, 0, 0], horizontalAlign: "fill", verticalAlign: "fill" } },
          ],
        }],
      },
    };
    expect(validateScreen(screen)).toEqual({ valid: true, errors: [] });
    screen.root.children[0].props.activeWidgetIndex = 2;
    expect(validateScreen(screen).errors).toContain("$.root.children[0].props.activeWidgetIndex: expected index below child count 2");
    screen.root.children[0].props.activeWidgetIndex = -1;
    expect(validateScreen(screen).errors).toContain("$.root.children[0].props.activeWidgetIndex: expected non-negative integer");
    screen.root.children[0].props.activeWidgetIndex = 0;
    screen.root.children[0].children = [];
    expect(validateScreen(screen).errors).toContain("$.root.children[0].children: WidgetSwitcher requires at least one child");
  });

  it("validates the complete checked-in example package", () => {
    const pkg = {
      manifest: exampleManifest,
      screens: { "screens/Inventory.screen.json": exampleScreen },
      entries: {
        "entries/Quest_ListItem.entry.json": exampleQuestEntry,
        "entries/Inventory_TileItem.entry.json": exampleTileEntry,
      },
      previews: {
        "previews/Quest_ListItemPreview.preview.json": exampleQuestPreview,
        "previews/Inventory_TileItemPreview.preview.json": exampleTilePreview,
      },
    } as unknown as UiPackage;
    expect(validatePackage(pkg)).toEqual({ valid: true, errors: [] });
  });

  it("accepts a canvas child stretched to all four edges", () => {
    const stretched = structuredClone(exampleScreen);
    const backdrop = stretched.root.children?.find((node) => node.id === "Backdrop");
    expect(backdrop?.slot).toMatchObject({ position: [0, 0], size: [0, 0], anchors: [0, 0, 1, 1] });
    expect(validateScreen(stretched)).toEqual({ valid: true, errors: [] });
  });

  it("accepts semantic canvas alignment and rejects values outside the normalized range", () => {
    const centered = structuredClone(exampleScreen);
    const title = centered.root.children?.find((node) => node.id === "Title") as UiNode | undefined;
    if (!title?.slot || !("position" in title.slot)) throw new Error("Title canvas slot missing");
    title.slot.alignment = [0.5, 0.5];
    expect(validateScreen(centered)).toEqual({ valid: true, errors: [] });
    title.slot.alignment = [1.2, 0.5];
    expect(validateScreen(centered).errors).toContain("$.root.children[1].slot.alignment: expected values from 0 to 1");
  });

  it("rejects property values that the Unreal importer cannot apply", () => {
    const invalid = structuredClone(exampleScreen);
    const title = invalid.root.children?.find((node) => node.id === "Title") as UiNode | undefined;
    if (!title?.props) throw new Error("Title props missing");
    title.props.color = "white";
    title.props.horizontalAlign = "stretch";
    const errors = validateScreen(invalid).errors;
    expect(errors).toContain("$.root.children[1].props.color: expected #RRGGBB or #RRGGBBAA");
    expect(errors).toContain("$.root.children[1].props.horizontalAlign: expected one of left, center, right");
  });

  it("keeps border corners square by default and accepts an explicit non-negative radius", () => {
    const entry = structuredClone(exampleQuestEntry) as unknown as EntryFile;
    const background = entry.root.children?.find((node) => node.id === "QuestBackground");
    if (!background?.props) throw new Error("Quest background missing");
    expect(background.props.cornerRadius).toBeUndefined();
    background.props.cornerRadius = 8;
    expect(validateEntry(entry)).toEqual({ valid: true, errors: [] });
    background.props.cornerRadius = -1;
    expect(validateEntry(entry).errors).toContain("$.root.children[0].props.cornerRadius: expected number at least 0");
  });

  it("reports unknown fields and properties", () => {
    const invalid = {
      format: "img2umg-screen", version: 1, id: "Bad", canvas: DESIGN_CANVAS, surprise: true,
      root: { id: "Root", type: "Canvas", props: { madeUp: true } },
    };
    const result = validateScreen(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.surprise: unknown field");
    expect(result.errors).toContain("$.root.props.madeUp: unsupported for Canvas");
  });

  it("requires the fixed 1920x1080 screen canvas and validates isVariable", () => {
    const screen = structuredClone(exampleScreen) as unknown as Record<string, any>;
    screen.canvas = { width: 1280, height: 720 };
    expect(validateScreen(screen).errors).toContain("$.canvas: expected fixed 1920x1080 design canvas");
    screen.canvas = DESIGN_CANVAS;
    screen.root.children[0].isVariable = "yes";
    expect(validateScreen(screen).errors).toContain("$.root.children[0].isVariable: expected boolean");
    screen.root.children[0].isVariable = true;
    expect(validateScreen(screen)).toEqual({ valid: true, errors: [] });
    screen.root.type = "Overlay";
    expect(validateScreen(screen).errors).toContain("$.root.type: screen root must be Canvas");
    expect(() => extractUiPackage("Test", { width: 1280, height: 720 }, root([]))).toThrow("requires a 1920x1080 design canvas");
  });

  it("validates preview override targets and values against their entry template", () => {
    const pkg = {
      manifest: structuredClone(exampleManifest),
      screens: { "screens/Inventory.screen.json": structuredClone(exampleScreen) },
      entries: {
        "entries/Quest_ListItem.entry.json": structuredClone(exampleQuestEntry),
        "entries/Inventory_TileItem.entry.json": structuredClone(exampleTileEntry),
      },
      previews: {
        "previews/Quest_ListItemPreview.preview.json": structuredClone(exampleQuestPreview),
        "previews/Inventory_TileItemPreview.preview.json": structuredClone(exampleTilePreview),
      },
    } as unknown as UiPackage;
    pkg.previews["previews/Quest_ListItemPreview.preview.json"].items[0].overrides.push({ target: "MissingWidget", props: { text: "No target" } });
    pkg.previews["previews/Quest_ListItemPreview.preview.json"].items[0].overrides.push({ target: "QuestName", props: { color: "white" } });
    const errors = validatePackage(pkg).errors;
    expect(errors).toContain("previews/Quest_ListItemPreview.preview.json.items[0]: missing override target MissingWidget");
    expect(errors).toContain("previews/Quest_ListItemPreview.preview.json.items[0].root.children[2].props.color: expected #RRGGBB or #RRGGBBAA");
  });

  it("writes every manifest reference to disk", async () => {
    const pkg = extractUiPackage("Test", DESIGN_CANVAS, root([
      card("A", 20, 20), card("B", 20, 110), card("C", 20, 200),
    ]));
    const directory = await mkdtemp(join(tmpdir(), "img2umg-test-"));
    await writeUiPackage(pkg, directory);
    const manifest = JSON.parse(await readFile(join(directory, "ui.manifest.json"), "utf8"));
    for (const section of ["screens", "entries", "previews"] as const) {
      for (const ref of manifest[section]) {
        const contents = JSON.parse(await readFile(join(directory, ref.file), "utf8"));
        expect(contents.id ?? `${contents.entryTemplate}Preview`).toBe(ref.id);
      }
    }
  });
});
