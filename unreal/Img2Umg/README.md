# Img2Umg Unreal Editor plugin

This plugin imports Img2Umg packages and creates editable UMG Widget Blueprints. V1 remains an editor import path; V2 adds an Editor importer and a small Runtime module for list entries and sample data.

## V2 IR import (source implementation)

**Target: UE 5.8.2. This revision has not been compiled or rendered in UE.** Browser tests do not validate C++, generated Blueprints, or visual parity.

1. Build and enable the plugin in a UE 5.8.2 C++ project. Keep both Editor and Runtime modules; generated V2 assets depend on Runtime when cooked.
2. Export a V2 package using the repository CLI. For a font-free first check:

   ```bash
   npm run v2:extract -- v2/examples/ue-smoke/index.html v2/output-ue-smoke
   ```

3. Choose **Tools > Import Img2Umg V2 IR...**, then select the generated IR JSON. Keep its asset directory beside it. Do not use the V1 manifest menu.
4. Each import creates a new unique folder below `/Game/Img2UmgV2`. It does not overwrite earlier imports or hand-authored assets. Open the generated Screen and Entry Widget Blueprints.
5. Create the generated Screen widget in a level/PIE to view actual sample records. The screen native base populates ListView items before Blueprint OnInitialized. Disable `bPopulateSamplesOnInitialized` to supply business data instead. Designer rows show the template only, not per-item values.

### V2 capabilities and limits

- Canvas, horizontal/vertical Auto boxes, single-child buttons, images, text and explicit ListView templates; editable native controls with SizeBox/background wrappers, not flattened screenshots.
- Fixed dimensions, padding/margin, static gap, alignment, visibility and rectangular clipping. Stock UMG-incompatible combinations are rejected. List templates require fixed sizes, zero root margin and a cross-axis size equal to the padded list viewport. TileView, responsive/fill layouts and arbitrary scrolling are not implemented.
- PNG/JPEG textures; single-face TTF/OTF fonts with recorded family/weight mappings. **WOFF/WOFF2 are rejected**: the existing web quest demo must be re-exported using a licensed TTF/OTF, or use the [font-free fixture](../../v2/examples/ue-smoke/index.html). No silent default font substitution. Native font size uses CSS px × 0.75; baseline, DPI and glyph rendering still need UE testing.
- Each list entry restores every bound default on assignment/release, then applies sparse text/image/background/text-color overrides. CSS text color does not tint images. Real sample data is serialized into the generated screen defaults; business interaction/bindings are not inferred.
- Preflight checks unknown fields, references, paths, resources and hashes before creating assets. Symlinks/reparse points and platforms unable to check them fail closed. Import is **not a disk transaction**: failures while generating/saving assets may leave partial output in the reported unique folder.

### UE verification still required

New Automation tests are under `Img2Umg.V2` (import validation and Runtime behavior); run them in the UE Session Frontend after compiling. Also verify import/save/reopen, Blueprint recompile, PIE list reuse, cooking and screenshot comparison at the intended DPI. The font-free browser fixture passed exact PNG and geometry comparison, but that is not an Unreal render test.

The existing [test host](../TestHost/Img2UmgTest.uproject) retains its historical UE 5.7 association; use a dedicated 5.8.2 host or explicitly select the 5.8.2 engine rather than assuming that host is upgraded.

## V1 (legacy package)

## Install and use

1. Copy the `Img2Umg` directory into an Unreal Engine 5 project's `Plugins` directory.
2. Regenerate project files, build the editor target, and enable **Img2Umg** in Plugins.
3. Open **Tools > Import Img2Umg UI Package...** and choose `ui.manifest.json`.
4. Generated assets are saved below `/Game/Img2Umg` as `WBP_<id>`.

Existing generated assets with the same name are rebuilt in place. The importer stops at the first invalid file, unsupported type, unknown field, missing texture, or Blueprint compile/save failure and shows the full context in a dialog.

## Import order

The manifest has three required arrays:

```json
{
  "format": "img2umg-package",
  "version": 1,
  "screens": [{ "id": "Inventory", "file": "screens/Inventory.screen.json" }],
  "entries": [{ "id": "InventoryItem", "file": "entries/InventoryItem.entry.json" }],
  "previews": [{ "id": "InventoryItems", "file": "previews/InventoryItems.preview.json" }]
}
```

All entry documents are generated and compiled first. Each entry Blueprint implements `IUserObjectListEntry`. Screen documents are generated second, so a `ListView` or `TileView` can resolve its `entryTemplate` to the generated class. Its `preview` value is a manifest preview ID; the number of preview items is copied to UMG's designer preview count. Preview overrides are visual sample data for the React renderer; UMG's built-in designer preview exposes only dummy entry count and does not apply per-item override values.

## Supported mapping

| JSON type | UMG type |
| --- | --- |
| `Canvas` / `CanvasPanel` | Canvas Panel |
| `Overlay` | Overlay |
| `HorizontalBox` | Horizontal Box |
| `VerticalBox` | Vertical Box |
| `SizeBox` | Size Box |
| `ScaleBox` | Scale Box |
| `Border` | Border |
| `Image` | Image |
| `Text` / `TextBlock` | Text Block |
| `Button` | Button |
| `ProgressBar` | Progress Bar |
| `Spacer` | Spacer |
| `ListView` | List View |
| `TileView` | Tile View |

`Image.source` is either `null` or an Unreal texture object path such as `/Game/UI/T_Icon.T_Icon`. The importer does not cut or import source image files. `placeholderColor` produces a colored placeholder. `placeholderLabel` is retained as recognized preview metadata but is not drawn by UMG Image because UMG Image has no text layer.

List and tile `spacing: [x, y]` maps to UMG's horizontal and vertical entry spacing. `TileView.entrySize` maps to entry width and height. `TileView.columns` is validated as a positive integer; UMG calculates the actual number of visible columns from the widget width, entry width, and spacing, so the slot width must be consistent with that value.

Canvas children accept `position`, `size`, and `zOrder`. Other UMG parents use their native slot properties (`padding`, alignment, and box sizing rules). A slot field unsupported by its actual UMG parent is an import error rather than being ignored.

## Compatibility and verification

The code uses Unreal Engine 5 editor APIs and public UMG widget setters. The list entry class and designer preview count are protected engine properties without public setters, so those two documented UMG properties are assigned through Unreal reflection. Compile the plugin against the exact engine release used by the project before distributing it.
