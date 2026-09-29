import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Browser } from "playwright-core";
import { launchBrowser } from "../src/browser.js";
import { compileFile } from "../src/compile.js";
import { buildPackage, compareLayout } from "../src/pipeline.js";
import { expandDocument } from "../src/render.js";
import { assertDocument } from "../src/validate.js";

let browser: Browser;
beforeAll(async () => { browser = await launchBrowser(); }, 30000);
afterAll(async () => { await browser?.close(); });
const sample = resolve("v2/examples/quests");
async function variant(htmlChange = (s: string) => s, cssChange = (s: string) => s) {
  const directory = await mkdtemp(join(tmpdir(), "img2umg-v2-"));
  await cp(sample, directory, { recursive: true });
  await writeFile(join(directory, "index.html"), htmlChange(await readFile(join(directory, "index.html"), "utf8")));
  await writeFile(join(directory, "style.css"), cssChange(await readFile(join(directory, "style.css"), "utf8")));
  return join(directory, "index.html");
}
async function minimal(body: string, extraCss = "") {
  const directory = await mkdtemp(join(tmpdir(), "img2umg-v2-min-"));
  const file = join(directory, "index.html");
  await writeFile(file, `<!doctype html><html><head><style>.root{display:flex;flex-direction:column;width:400px;height:300px}.child{display:flex;width:100px;height:40px}${extraCss}</style></head><body>${body}</body></html>`);
  return file;
}

describe("real Chromium extraction", () => {
  it("extracts two items as one shared template; fixed buttons remain ordinary", async () => {
    const { document } = await compileFile(join(sample, "index.html"), browser);
    assertDocument(document);
    expect(document.collections).toHaveLength(1);
    expect(document.collections[0].items).toHaveLength(2);
    expect(Object.keys(document.templates)).toEqual(["QuestCard"]);
    expect(document.collections[0].items[1].overrides.QuestOneTitle.text).toBe("Supplies for the Village");
    const actions = document.root.children.find((node) => node.id === "QuestActions")!;
    expect(actions.kind).toBe("panel");
    expect(actions.children.map((node) => node.kind)).toEqual(["button", "button", "button"]);
    expect(document.assets.map((asset) => asset.kind).sort()).toEqual(["font", "image"]);
    expect(expandDocument(document).children[1].children[1].children[1].children[0].id).toBe("QuestTwoTitle");
  });

  it("round trips all geometry and the actual PNG screenshot exactly for the sample", async () => {
    const parent = await mkdtemp(join(tmpdir(), "img2umg-v2-package-"));
    const output = join(parent, "out");
    const report = await buildPackage(join(sample, "index.html"), output);
    expect(report.status).toBe("passed");
    expect(report.checks.layout).toMatchObject({ checked: 20, maxError: 0 });
    expect(await readFile(join(output, "source.png"))).toEqual(await readFile(join(output, "reconstructed.png")));
    expect(report.ueVerification).toBe("not-run");
    await expect(buildPackage(join(sample, "index.html"), output)).rejects.toThrow(/EEXIST/);
  }, 30000);

  it("exports the font-free UE smoke fixture with complete color overrides", async () => {
    const { document } = await compileFile(resolve("v2/examples/ue-smoke/index.html"), browser);
    assertDocument(document);
    expect(document.assets).toEqual([]);
    expect(document.fonts).toEqual([]);
    expect(document.collections).toHaveLength(1);
    const collection = document.collections[0];
    expect(collection.items).toHaveLength(2);
    expect(collection.items[1].nodeIds).toEqual({ CardA: "CardB", SwatchA: "SwatchB", DetailA: "DetailB" });
    expect(Object.keys(collection.items[1].overrides).sort()).toEqual(["CardA", "DetailA", "SwatchA"]);
    expect(document.root.children[1].kind).toBe("button");
    expect(document.observations.Cards).toMatchObject({ width: 432, height: 232 });
  });

  it("retains one explicitly declared item as a collection", async () => {
    const file = await variant((html) => html.replace(/      <div class="card" data-ui-id="QuestTwo"[\s\S]*?\n      <\/div>/, ""));
    const result = await compileFile(file, browser);
    expect(result.document.collections[0].items).toHaveLength(1);
  });

  it("does not infer a list from repeated unannotated cards", async () => {
    const file = await variant((html) => html.replace('data-ui-collection="list"', 'data-ui-collection="none"').replaceAll(' data-ui-entry="QuestCard"', ""));
    expect((await compileFile(file, browser)).document.collections).toHaveLength(0);
  });

  it("rejects mismatched field names instead of partially merging", async () => {
    const file = await variant((html) => html.replace('data-ui-id="QuestTwoTitle" data-ui-field="title"', 'data-ui-id="QuestTwoTitle" data-ui-field="different"'));
    await expect(compileFile(file, browser)).rejects.toThrow("E_COLLECTION_TEMPLATE");
  });

  it("rejects differing entry dimensions", async () => {
    const file = await variant(undefined, (css) => `${css}\n.card + .card{width:600px}`);
    // Sibling selector itself is outside the authoring subset, before browser inference.
    await expect(compileFile(file, browser)).rejects.toThrow(/combinator/);
    const file2 = await variant((html) => html.replace('data-ui-id="QuestTwo"', 'data-ui-id="QuestTwo" style="width:600px"'));
    await expect(compileFile(file2, browser)).rejects.toThrow(/E_LAYOUT_OVERFLOW|E_COLLECTION_TEMPLATE/);
  });

  it("rejects missing local font mapping instead of using a system fallback", async () => {
    const file = await variant(undefined, (css) => css.replaceAll("font-family: 'DemoFont';", "font-family: 'DemoFont';").concat("\np{font-family:Arial}"));
    await expect(compileFile(file, browser)).rejects.toThrow("E_FONT_MISSING");
  });

  it("preserves nonbreaking spaces in text data", async () => {
    const file = await variant((html) => html.replace("The Lost Compass", "The&nbsp;Lost&nbsp;Compass"));
    const doc = (await compileFile(file, browser)).document;
    expect(doc.templates.QuestCard.children[1].children[0].text?.value).toBe("The\u00a0Lost\u00a0Compass");
  });

  it("loads font-face with its default normal weight", async () => {
    const file = await variant(undefined, (css) => css.replace("  font-weight: 400;", ""));
    const doc = (await compileFile(file, browser)).document;
    expect(doc.fonts[0].weight).toBe(400);
  });

  it("preserves authored auto dimensions rather than baking measured width", async () => {
    const file = await minimal('<div class="root" data-ui-root data-ui-id="Root"><div class="child" data-ui-id="Auto" style="width:auto"></div></div>');
    const doc = (await compileFile(file, browser)).document;
    expect(doc.root.children[0].box.width).toBe("auto");
    expect(doc.observations.Auto.width).toBe(400);
  });

  it("uses selector specificity and source order for declared sizes", async () => {
    const file = await minimal('<div id="root" class="root" data-ui-root data-ui-id="Root"></div>', '#root{width:300px}.root{width:200px}');
    const doc = (await compileFile(file, browser)).document;
    expect(doc.viewport.width).toBe(300);
  });

  it.each([
    ['relative offsets', 'left:20px;top:10px'],
    ['absolute outside canvas', 'position:absolute;left:0px;top:0px'],
    ['cross-axis clamp', 'width:500px'],
    ['noncanvas z order', 'z-index:2'],
  ])("rejects %s", async (_label, style) => {
    const file = await minimal(`<div class="root" data-ui-root data-ui-id="Root"><div class="child" data-ui-id="Child" style="${style}"></div></div>`);
    await expect(compileFile(file, browser)).rejects.toThrow(/E_LAYOUT_CONTEXT|E_LAYOUT_OVERFLOW/);
  });

  it("does not let reset specificity override author tag selectors", async () => {
    const file = await minimal('<section data-ui-root data-ui-id="Root"></section>', 'section{display:flex;width:200px;height:100px}');
    const doc = (await compileFile(file, browser)).document;
    expect(doc.root.layout).toBe("row");
    expect(doc.viewport.width).toBe(200);
  });

  it("rejects flex text leaves which would change text alignment", async () => {
    const file = await variant(undefined, (css) => `${css}\n.quest-title{display:flex}`);
    await expect(compileFile(file, browser)).rejects.toThrow("E_LAYOUT_CONTEXT");
  });

  it("rejects hidden parent / visible child semantics", async () => {
    const file = await minimal('<div class="root" data-ui-root data-ui-id="Root" style="visibility:hidden"><div class="child" data-ui-id="Child" style="visibility:visible"></div></div>');
    await expect(compileFile(file, browser)).rejects.toThrow("E_VISIBILITY");
  });

  it("rejects broken image bytes after static path validation", async () => {
    const file = await variant();
    await writeFile(join(file, "..", "assets", "quest.png"), "not a PNG");
    await expect(compileFile(file, browser)).rejects.toThrow("E_BROWSER_RESOURCE");
  });

  it("supports encoded in-tree asset filenames and special record keys", async () => {
    const file = await variant((html) => html.replaceAll("assets/quest.png", "assets/quest%20icon.png").replace('data-ui-id="ScreenTitle"', 'data-ui-id="__proto__"'));
    await cp(join(file, "..", "assets", "quest.png"), join(file, "..", "assets", "quest icon.png"));
    const doc = (await compileFile(file, browser)).document;
    expect(Object.hasOwn(doc.observations, "__proto__")).toBe(true);
    expect(doc.assets).toHaveLength(2);
  });
});

describe("layout comparison", () => {
  it("reports missing nodes and actual coordinate differences", () => {
    const rect = { x: 0, y: 0, width: 100, height: 40 };
    const result = compareLayout({ A: rect, B: rect }, { A: { ...rect, x: 2 }, C: rect });
    expect(result.passed).toBe(false);
    expect(result.maxError).toBe(2);
    expect(result.mismatches).toHaveLength(3);
  });
});
