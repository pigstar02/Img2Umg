# Img2UMG

Img2UMG uses one constrained JSON package as the source for both a React preview and Unreal UMG generation. It represents static UI only: no game logic, bindings, or interaction behavior are inferred.

## Package layout

```text
Inventory/
├── ui.manifest.json
├── screens/Inventory.screen.json
├── entries/Inventory_TileItem.entry.json
└── previews/Inventory_TileItemPreview.preview.json
```

The manifest stores arrays of `{ "id", "file" }` references. A list node refers to an entry and preview by their ids:

```json
{
  "id": "InventoryGrid",
  "type": "TileView",
  "props": {
    "entryTemplate": "Inventory_TileItem",
    "preview": "Inventory_TileItemPreview",
    "entrySize": [205, 214],
    "spacing": [16, 16],
    "columns": 4
  },
  "slot": { "position": [430, 188], "size": [868, 674] }
}
```

Each entry is a separate widget tree and becomes a separate UMG entry blueprint. Preview files contain only visual variations for the screenshot reconstruction:

```json
{
  "format": "img2umg-preview",
  "version": 1,
  "entryTemplate": "Inventory_TileItem",
  "items": [
    { "overrides": [{ "target": "ItemName", "props": { "text": "Pulse Rifle" } }] }
  ]
}
```

## Supported controls

`Canvas`, `Overlay`, `HorizontalBox`, `VerticalBox`, `SizeBox`, `ScaleBox`, `Spacer`, `Border`, `Image`, `Text`, `Button`, `ProgressBar`, `ListView`, and `TileView` are accepted. A child's `slot` is defined by its parent: Canvas uses `position`, `size`, and optional `zOrder`; Overlay and single-child containers use padding plus alignment; horizontal and vertical boxes use padding, alignment, and an `auto` or `fill` size rule. Missing image sources deliberately render as labelled placeholders in React and should do the same in UMG.

The runtime validator rejects unknown top-level fields, unknown node fields, properties unsupported by a control, invalid sizes, duplicate ids, and broken entry or preview references.

## Extract repeated UI

Input is a visual node tree with absolute `bounds`:

```bash
npm install
npm run extract -- examples/input.visual.json examples/generated
```

The extractor only creates a collection for at least three consecutive siblings with the same structural fingerprint, similar sizes, and stable alignment and spacing. A single row or column becomes a `ListView`; a regular multi-row, multi-column grid becomes a `TileView`. Incomplete final tile rows are supported. Ambiguous, irregular, non-contiguous, or two-item groups remain ordinary nodes.

The command validates the visual input and the generated package before writing `ui.manifest.json`, `screens`, `entries`, and `previews`.

## Preview and verification

```bash
npm run dev
npm test
npm run build
```

The included inventory package demonstrates both list types, independent entry templates, preview overrides, placeholders, text, a button, and a progress bar.
