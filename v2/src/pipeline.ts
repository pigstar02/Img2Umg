import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { compileFile } from "./compile.js";
import { launchBrowser, loadPage } from "./browser.js";
import { renderDocument } from "./render.js";
import type { Rect } from "./types.js";

export interface LayoutComparison { passed: boolean; tolerance: number; checked: number; maxError: number; mismatches: { id: string; message: string }[] }
export function compareLayout(expected: Record<string, Rect>, actual: Record<string, Rect>, tolerance = 0.5): LayoutComparison {
  const mismatches: LayoutComparison["mismatches"] = [];
  let maxError = 0;
  for (const id of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (!Object.hasOwn(expected, id) || !Object.hasOwn(actual, id)) { mismatches.push({ id, message: "Missing or unexpected node" }); continue; }
    for (const key of ["x", "y", "width", "height"] as const) {
      const error = Math.abs(expected[id][key] - actual[id][key]);
      maxError = Math.max(maxError, error);
      if (!Number.isFinite(error) || error > tolerance) mismatches.push({ id, message: `${key}: expected ${expected[id][key]}, got ${actual[id][key]}` });
    }
  }
  return { passed: mismatches.length === 0, tolerance, checked: Object.keys(expected).length, maxError, mismatches };
}
export async function buildPackage(input: string, output: string) {
  const browser = await launchBrowser();
  try {
    const result = await compileFile(input, browser);
    const directory = resolve(output);
    // Refuse accidental replacement of previous deliveries or authored sources.
    await mkdir(directory, { recursive: false });
    await mkdir(join(directory, "assets"));
    for (const [path, contents] of result.assetContents) await writeFile(join(directory, path), contents);
    await writeFile(join(directory, "ui.ir.json"), `${JSON.stringify(result.document, null, 2)}\n`);
    const canonical = renderDocument(result.document);
    await writeFile(join(directory, "preview.html"), canonical);
    await writeFile(join(directory, "source.png"), result.sourceScreenshot);
    const loaded = await loadPage(browser, canonical, directory, { width: Math.ceil(result.document.viewport.width), height: Math.ceil(result.document.viewport.height) });
    try {
      const actual = await loaded.page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>("[data-ui-id]"), (element) => {
        const rect = element.getBoundingClientRect();
        return [element.dataset.uiId!, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
      })));
      const comparison = compareLayout(result.document.observations, actual);
      const reconstructed = await loaded.page.screenshot({ path: join(directory, "reconstructed.png"), type: "png" });
      const image = {
        identical: result.sourceScreenshot.equals(reconstructed),
        sourceSha256: createHash("sha256").update(result.sourceScreenshot).digest("hex"),
        reconstructedSha256: createHash("sha256").update(reconstructed).digest("hex"),
      };
      const report = {
        status: comparison.passed && image.identical ? "passed" : "needs-revision", browser: result.browserVersion,
        source: resolve(input), target: result.document.target, ueVerification: "not-run",
        checks: { schema: "passed", layout: comparison, image },
        collections: result.document.collections.map((collection) => ({ id: collection.id, templateId: collection.templateId, count: collection.items.length, orientation: collection.orientation })),
        note: "Image check is exact PNG byte equality in this browser, not a tolerant image metric or Unreal rendering verification.",
      };
      await writeFile(join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      return report;
    } finally { await loaded.close(); }
  } finally { await browser.close(); }
}
