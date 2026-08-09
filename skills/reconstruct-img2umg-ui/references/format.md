# Img2UMG package format

Read this file before writing package JSON. The TypeScript validator and Unreal importer are authoritative when this reference and the implementation differ.

## Package layout

```text
Package/
|-- ui.manifest.json
|-- screens/<Screen>.screen.json
|-- entries/<Entry>.entry.json
`-- previews/<Preview>.preview.json
```

The manifest uses:

```json
{
  "format": "img2umg-package",
  "version": 1,
  "screens": [{ "id": "Inventory", "file": "screens/Inventory.screen.json" }],
  "entries": [{ "id": "InventoryItem", "file": "entries/InventoryItem.entry.json" }],
  "previews": [{ "id": "InventoryItems", "file": "previews/InventoryItems.preview.json" }]
}
```

Every referenced file must exist. Screen and entry document IDs must match their manifest IDs. IDs must be unique across all three manifest sections.

## Documents

Screen:

```json
{
  "format": "img2umg-screen",
  "version": 1,
  "id": "Inventory",
  "canvas": { "width": 1920, "height": 1080 },
  "root": { "id": "Root", "type": "Canvas", "children": [] }
}
```

Entry:

```json
{
  "format": "img2umg-entry",
  "version": 1,
  "id": "InventoryItem",
  "size": [240, 280],
  "root": { "id": "ItemRoot", "type": "Overlay", "children": [] }
}
```

Preview:

```json
{
  "format": "img2umg-preview",
  "version": 1,
  "entryTemplate": "InventoryItem",
  "items": [
    { "overrides": [{ "target": "ItemName", "props": { "text": "Pulse Rifle" } }] }
  ]
}
```

Preview overrides are sample visual data. Unreal uses the preview item count but does not apply each override in its designer.

## Node shape

Every node accepts only:

```json
{
  "id": "UniqueWithinDocument",
  "type": "Text",
  "props": {},
  "slot": {},
  "children": []
}
```

The root has no `slot`. Every non-root node requires a slot whose shape is determined by its parent.

Single-child containers: `SizeBox`, `ScaleBox`, `Border`, `Button`.

Multi-child containers: `Canvas`, `Overlay`, `HorizontalBox`, `VerticalBox`.

Leaves: `Spacer`, `Image`, `Text`, `ProgressBar`, `ListView`, `TileView`.

## Supported properties

- `Canvas`, `Overlay`, `HorizontalBox`, `VerticalBox`: no properties.
- `SizeBox`: `widthOverride`, `heightOverride`, `minWidth`, `minHeight` as positive numbers.
- `ScaleBox`: `stretch` = `none`, `fill`, `scaleToFit`, `scaleToFill`, `scaleToFitX`, or `scaleToFitY`.
- `Spacer`: `size: [width, height]`.
- `Border`: `backgroundColor`, optional paired `borderColor` and non-negative `borderWidth`, optional non-negative `cornerRadius` (default `0`), and `padding`.
- `Image`: `source` as `null` or a non-empty Unreal texture object path; `tint`; `placeholderColor`; `placeholderLabel`; `drawAs` = `image`, `box`, or `border`; `margin`. `placeholderLabel` is Web-only metadata, so do not use it for reconstructed visible text.
- `Text`: required non-empty `text`; positive `fontSize`; `color`; `horizontalAlign` = `left`, `center`, or `right`; `verticalAlign` = `top`, `center`, or `bottom`; boolean `wrap`.
- `Button`: `label`, `backgroundColor`, `textColor`, positive `fontSize`. A button may use `label` or an explicit child, never both. Text styling requires `label`.
- `ProgressBar`: required `percent` from 0 to 1; `fillColor`; `backgroundColor`.
- `ListView`: required `entryTemplate`, `preview`, positive `entrySize`, non-negative `spacing`; optional `orientation` = `vertical` or `horizontal`.
- `TileView`: the same collection properties plus required positive integer `columns`.

Colors use `#RRGGBB` or `#RRGGBBAA`. Padding and brush margin accept a number, `[horizontal, vertical]`, or `[left, top, right, bottom]`.

## Slots

### Canvas parent

```json
{
  "position": [x, y],
  "size": [widthOrRightMargin, heightOrBottomMargin],
  "anchors": [minX, minY, maxX, maxY],
  "alignment": [pivotX, pivotY],
  "zOrder": 0
}
```

`anchors` and `alignment` use values from 0 to 1. Omitted anchors and alignment default to top-left behavior.

On a fixed axis, `size` is the positive element size. On a stretched axis, `position` is the near-edge margin and `size` is the far-edge margin. Examples:

```json
{ "position": [0, 0], "size": [0, 0], "anchors": [0, 0, 1, 1] }
```

fills the parent. A semantically centered fixed element can use:

```json
{ "position": [0, 0], "size": [400, 240], "anchors": [0.5, 0.5, 0.5, 0.5], "alignment": [0.5, 0.5] }
```

### Overlay and single-child-container parent

```json
{
  "padding": [left, top, right, bottom],
  "horizontalAlign": "fill",
  "verticalAlign": "fill"
}
```

Horizontal alignment is `left`, `center`, `right`, or `fill`. Vertical alignment is `top`, `center`, `bottom`, or `fill`.

### HorizontalBox or VerticalBox parent

```json
{
  "padding": [left, top, right, bottom],
  "horizontalAlign": "fill",
  "verticalAlign": "center",
  "sizeRule": "auto",
  "fill": 1
}
```

`sizeRule` is required and is `auto` or `fill`. `fill` is a positive number and is valid only with `sizeRule: "fill"`.

In Unreal Engine 5.1 or newer, a child directly under `ScaleBox` cannot use non-zero slot padding. Add a padding-capable wrapper.

## Current boundaries

The format reconstructs static UI only. It does not infer gameplay logic, bindings, interaction behavior, animation, materials, custom fonts, or texture slicing from the screenshot. The importer does not crop or import local image files. Use placeholders until valid Unreal texture paths are supplied.
