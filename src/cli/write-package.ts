import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UiPackage } from "../core/types";
import { assertValidPackage } from "../core/validation";

export async function writeUiPackage(pkg: UiPackage, outputDirectory: string): Promise<void> {
  assertValidPackage(pkg);
  await mkdir(outputDirectory, { recursive: true });
  await writeJson(join(outputDirectory, "ui.manifest.json"), pkg.manifest);
  await writeFiles(outputDirectory, pkg.screens);
  await writeFiles(outputDirectory, pkg.entries);
  await writeFiles(outputDirectory, pkg.previews);
}

async function writeFiles(outputDirectory: string, files: Record<string, unknown>) {
  for (const [relativePath, value] of Object.entries(files)) {
    const path = join(outputDirectory, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeJson(path, value);
  }
}

const writeJson = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
