# Img2Umg Unreal Editor plugin

This editor-only plugin imports an Img2Umg package and creates editable UMG Widget Blueprints.

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
