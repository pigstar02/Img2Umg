import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const virtualPackageId = "virtual:img2umg-package";
const resolvedVirtualPackageId = `\0${virtualPackageId}`;

function loadPackage(manifestPath: string) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const base = dirname(manifestPath);
  const loadSection = (refs: { file: string }[]) => Object.fromEntries(refs.map((ref) => [ref.file, JSON.parse(readFileSync(resolve(base, ref.file), "utf8"))]));
  return {
    manifest,
    screens: loadSection(manifest.screens),
    entries: loadSection(manifest.entries),
    previews: loadSection(manifest.previews),
  };
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "img2umg-package",
      resolveId(id) {
        return id === virtualPackageId ? resolvedVirtualPackageId : undefined;
      },
      load(id) {
        if (id !== resolvedVirtualPackageId) return undefined;
        const manifestPath = resolve(process.env.IMG2UMG_MANIFEST ?? "examples/inventory/ui.manifest.json");
        return `export default ${JSON.stringify(loadPackage(manifestPath))}`;
      },
    },
  ],
});
