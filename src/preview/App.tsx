import manifestJson from "../../examples/inventory/ui.manifest.json";
import screenJson from "../../examples/inventory/screens/Inventory.screen.json";
import listEntryJson from "../../examples/inventory/entries/Quest_ListItem.entry.json";
import tileEntryJson from "../../examples/inventory/entries/Inventory_TileItem.entry.json";
import listPreviewJson from "../../examples/inventory/previews/Quest_ListItemPreview.preview.json";
import tilePreviewJson from "../../examples/inventory/previews/Inventory_TileItemPreview.preview.json";
import type { UiPackage } from "../core/types";
import { validatePackage } from "../core/validation";
import { PackageRenderer } from "./Renderer";

const pkg = {
  manifest: manifestJson,
  screens: { "screens/Inventory.screen.json": screenJson },
  entries: {
    "entries/Quest_ListItem.entry.json": listEntryJson,
    "entries/Inventory_TileItem.entry.json": tileEntryJson,
  },
  previews: {
    "previews/Quest_ListItemPreview.preview.json": listPreviewJson,
    "previews/Inventory_TileItemPreview.preview.json": tilePreviewJson,
  },
} as unknown as UiPackage;

export default function App() {
  const validation = validatePackage(pkg);
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Img2UMG</p>
          <h1>UI package preview</h1>
        </div>
        <span className={validation.valid ? "status valid" : "status invalid"}>{validation.valid ? "Package valid" : `${validation.errors.length} errors`}</span>
      </header>
      {validation.valid ? <PackageRenderer pkg={pkg} screen={pkg.screens["screens/Inventory.screen.json"]} /> : <pre>{validation.errors.join("\n")}</pre>}
    </main>
  );
}
