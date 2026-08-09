#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EntryFile, ManifestFile, PreviewFile, ScreenFile, UiPackage } from "../core/types";
import { validateManifest, validatePackage } from "../core/validation";

const [manifestArgument] = process.argv.slice(2);
if (!manifestArgument) {
  console.error("Usage: npm run validate -- <ui.manifest.json>");
  process.exitCode = 1;
} else {
  try {
    const manifestPath = resolve(manifestArgument);
    const manifest = await readJson(manifestPath) as ManifestFile;
    const manifestValidation = validateManifest(manifest);
    if (!manifestValidation.valid) throw new Error(manifestValidation.errors.join("\n"));

    const baseDirectory = dirname(manifestPath);
    const pkg: UiPackage = { manifest, screens: {}, entries: {}, previews: {} };
    for (const ref of manifest.screens) pkg.screens[ref.file] = await readJson(resolve(baseDirectory, ref.file)) as ScreenFile;
    for (const ref of manifest.entries) pkg.entries[ref.file] = await readJson(resolve(baseDirectory, ref.file)) as EntryFile;
    for (const ref of manifest.previews) pkg.previews[ref.file] = await readJson(resolve(baseDirectory, ref.file)) as PreviewFile;

    const validation = validatePackage(pkg);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
    console.log(`Package valid: ${manifest.screens.length} screen(s), ${manifest.entries.length} entry template(s), ${manifest.previews.length} preview set(s)`);
  } catch (error) {
    console.error(`Package invalid:\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
