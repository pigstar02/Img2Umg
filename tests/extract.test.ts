import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractUiPackage, structureFingerprint } from "../src/core/extract";
import type { UiNode, VisualNode } from "../src/core/types";
import { validatePackage, validateScreen } from "../src/core/validation";
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

const root = (children: VisualNode[]): VisualNode => ({ id: "Root", type: "Canvas", bounds: { x: 0, y: 0, width: 800, height: 600 }, children });

function firstCollection(pkg: ReturnType<typeof extractUiPackage>): UiNode | undefined {
  return pkg.screens["screens/Test.screen.json"].root.children?.find((node) => node.type === "ListView" || node.type === "TileView");
}

describe("list extraction", () => {
  it("extracts a vertical run into a ListView and captures visual overrides", () => {
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([
      card("A", 20, 20, "Alpha"), card("B", 20, 110, "Beta"), card("C", 20, 200, "Gamma"),
    ]));
    const list = firstCollection(pkg);
    expect(list?.type).toBe("ListView");
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
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([panel]));
    expect(pkg.screens["screens/Test.screen.json"].root.children?.[0].children?.[0].type).toBe("ListView");
    expect(pkg.manifest.entries).toHaveLength(1);
  });
});

describe("tile extraction", () => {
  it("extracts a regular grid whose final row is incomplete", () => {
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([
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
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([card("A", 20, 20), card("B", 20, 110)]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("does not join non-contiguous matching structures", () => {
    const separator: VisualNode = { id: "Divider", type: "Image", bounds: { x: 20, y: 110, width: 100, height: 5 }, props: { placeholderColor: "#FFFFFFFF" } };
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([
      card("A", 20, 20), card("B", 20, 120), separator, card("C", 20, 220), card("D", 20, 320),
    ]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("rejects irregular spacing instead of guessing", () => {
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([
      card("A", 20, 20), card("B", 20, 110), card("C", 20, 260),
    ]));
    expect(pkg.manifest.entries).toHaveLength(0);
  });

  it("fingerprints structure while ignoring ids and visual props", () => {
    expect(structureFingerprint(card("A", 0, 0, "one"))).toBe(structureFingerprint(card("B", 500, 500, "two")));
  });
});

describe("explicit collection decisions", () => {
  const extract = (node: VisualNode, onDiagnostic?: import("../src/core/types").ExtractionOptions["onDiagnostic"]) => extractUiPackage("Test", { width: 800, height: 600 }, node, { onDiagnostic });

  it("extracts two explicitly identified records and omits metadata", () => {
    const input = { ...root([card("A", 20, 20), card("B", 20, 110)]), collection: "list" as const };
    const diagnostics: import("../src/core/types").ExtractionDiagnostic[] = [];
    const pkg = extract(input, (diagnostic) => diagnostics.push(diagnostic));
    expect(firstCollection(pkg)?.type).toBe("ListView");
    expect(diagnostics[0]).toMatchObject({ parentId: "Root", status: "extracted", itemIds: ["A", "B"] });
    expect(JSON.stringify(pkg)).not.toContain('"collection"');
    expect(validatePackage(pkg).valid).toBe(true);
  });

  it("extracts an explicit horizontal list and an incomplete tile grid", () => {
    const horizontal = extract({ ...root([card("A", 20, 20), card("B", 130, 20)]), collection: "list" });
    expect(firstCollection(horizontal)?.props?.orientation).toBe("horizontal");
    const tile = extract({ ...root([card("A", 20, 20), card("B", 130, 20), card("C", 20, 110)]), collection: "tile" });
    expect(firstCollection(tile)?.type).toBe("TileView");
    expect(validatePackage(tile).valid).toBe(true);
  });

  it.each(["invalid", "leaf"])("rejects %s collection hints in the CLI", async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), "img2umg-cli-"));
    const input = join(directory, "input.json");
    const node = mode === "invalid" ? { ...root([]), collection: "force" } : { id: "Text", type: "Text", bounds: { x: 0, y: 0, width: 100, height: 20 }, props: { text: "Hi" }, collection: "none" };
    await writeFile(input, JSON.stringify({ screenId: "Test", canvas: { width: 800, height: 600 }, root: node }));
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/extract.ts", input, join(directory, "out")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("$.root.collection:");
  });

  it("keeps fixed buttons ordinary with none", () => {
    const buttons: VisualNode[] = [0, 1, 2].map((i) => ({ id: `Button${i}`, type: "Button", bounds: { x: i * 110, y: 0, width: 100, height: 40 }, props: { label: String(i) } }));
    expect(extract({ ...root(buttons), collection: "none" }).manifest.entries).toHaveLength(0);
  });

  it("still extracts nested collections beneath none", () => {
    const panel = { ...root([card("A", 20, 20), card("B", 20, 110)]), id: "Panel", collection: "list" as const };
    expect(extract({ ...root([panel]), collection: "none" }).manifest.entries).toHaveLength(1);
  });

  it.each(["list", "tile"] as const)("never partially extracts an invalid explicit %s", (collection) => {
    const nodes = [card("A", 20, 20), card("B", 20, 110), card("C", 20, 200)];
    nodes.push({ id: "Heading", type: "Text", bounds: { x: 0, y: 0, width: 100, height: 20 }, props: { text: "Title" } });
    const diagnostics: import("../src/core/types").ExtractionDiagnostic[] = [];
    expect(extract({ ...root(nodes), collection }, (d) => diagnostics.push(d)).manifest.entries).toHaveLength(0);
    expect(diagnostics[0].reason).toContain("structure");
  });

  it("rejects conflicting hints and irregular spacing", () => {
    expect(extract({ ...root([card("A", 20, 20), card("B", 20, 110)]), collection: "tile" }).manifest.entries).toHaveLength(0);
    expect(extract({ ...root([card("A", 20, 20), card("B", 20, 110), card("C", 20, 300)]), collection: "list" }).manifest.entries).toHaveLength(0);
  });

  it("rejects a final grid row that starts at the second column", () => {
    const nodes = [card("A", 20, 20), card("B", 130, 20), card("C", 240, 20), card("D", 130, 110), card("E", 240, 110)];
    expect(extract({ ...root(nodes), collection: "tile" }).manifest.entries).toHaveLength(0);
  });

  it("rejects incompatible property keys rather than losing deletions", () => {
    const nodes = [card("A", 20, 20), card("B", 20, 110)];
    delete nodes[1].children![0].props!.color;
    expect(extract({ ...root(nodes), collection: "list" }).manifest.entries).toHaveLength(0);
  });
});

describe("validation and file output", () => {
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

  it("reports unknown fields and properties", () => {
    const invalid = {
      format: "img2umg-screen", version: 1, id: "Bad", canvas: { width: 100, height: 100 }, surprise: true,
      root: { id: "Root", type: "Canvas", props: { madeUp: true } },
    };
    const result = validateScreen(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.surprise: unknown field");
    expect(result.errors).toContain("$.root.props.madeUp: unsupported for Canvas");
  });

  it("writes every manifest reference to disk", async () => {
    const pkg = extractUiPackage("Test", { width: 800, height: 600 }, root([
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
