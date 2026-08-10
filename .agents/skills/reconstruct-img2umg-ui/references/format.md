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
    { "size": [240, 280], "overrides": [{ "target": "ItemName", "props": { "text": "Pulse Rifle" } }] }
  ]
}
```

Preview overrides are sample visual data. Unreal uses the preview item count but does not apply each override in its designer.

Every screen document uses the fixed `1920x1080` design canvas. Source images may use other resolutions, but their UI regions must be re-expressed on this canvas from their edge, center, stretch, and parent-local relationships. Do not uniformly scale every source rectangle.
The root widget of every screen must be a `Canvas`, matching Unreal's root Canvas Panel convention for screen-level anchoring. Entry roots may use any supported container appropriate to the reusable item.

## Node shape

Every node accepts only:

```json
{
  "id": "UniqueWithinDocument",
  "type": "Text",
  "isVariable": true,
  "props": {},
  "slot": {},
  "children": []
}
```

The root has no `slot`. Every non-root node requires a slot whose shape is determined by its parent.

`isVariable` is optional and defaults to `false`. It maps directly to UMG Designer's **Is Variable** flag (`UWidget::bIsVariable`). The widget `id` becomes the Blueprint variable name when this flag is enabled.

Set `isVariable: true` only when there is positive evidence that Blueprint or C++ needs a direct reference to the widget. Typical cases are interactive controls with runtime event handling, dynamic text/image/progress content, a `WidgetSwitcher` whose active page changes, a `ListView` or `TileView` populated at runtime, a widget whose visibility or enabled state changes independently, or a named module root animated or controlled as one unit. Keep it false or omit it for static labels, decorative images and borders, backgrounds, spacers, and layout-only Canvas Panels, Overlays, boxes, Size Boxes, or Scale Boxes. Do not mark an entire subtree as variable merely because its parent is variable.

Single-child containers: `SizeBox`, `ScaleBox`, `Border`, `Button`.

Multi-child containers: `Canvas`, `Overlay`, `HorizontalBox`, `VerticalBox`, `WidgetSwitcher`.

Leaves: `Spacer`, `Image`, `Text`, `ProgressBar`, `ListView`, `TileView`.

## Supported properties

- `Canvas`, `Overlay`, `HorizontalBox`, `VerticalBox`: no properties.
- `WidgetSwitcher`: optional non-negative integer `activeWidgetIndex` (default `0`), which must identify one of its children. It requires at least one child and displays exactly one child at a time.
- Every node supports optional `visibility` = `visible`, `hidden`, or `collapsed`. Use `collapsed` for content that should not consume layout space in the designer default.
- `SizeBox`: `widthOverride`, `heightOverride`, `minWidth`, `minHeight` as positive numbers.
- `ScaleBox`: `stretch` = `none`, `fill`, `scaleToFit`, `scaleToFill`, `scaleToFitX`, or `scaleToFitY`.
- `Spacer`: `size: [width, height]`.
- `Border`: `backgroundColor`, optional paired `borderColor` and non-negative `borderWidth`, optional non-negative `cornerRadius` (default `0`), and `padding`.
- `Image`: `source` as `null` or a non-empty Unreal texture object path; `tint`; `placeholderColor`; `placeholderLabel`; `drawAs` = `image`, `box`, or `border`; `margin`. `placeholderLabel` is Web-only metadata, so do not use it for reconstructed visible text.
- `Text`: required non-empty `text`; positive `fontSize`; `color`; `horizontalAlign` = `left`, `center`, or `right`; `verticalAlign` = `top`, `center`, or `bottom`; boolean `wrap`.
- `Button`: `label`, `backgroundColor`, `textColor`, positive `fontSize`. A button may use `label` or an explicit child, never both. Text styling requires `label`.
- `ProgressBar`: required `percent` from 0 to 1; `fillColor`; `backgroundColor`.
- `ListView`: required `entryTemplate`, `preview`, non-negative `spacing`; optional `orientation` = `vertical` or `horizontal`, and `sizeToContent` boolean. `entrySize` is required unless `sizeToContent` is `true`. Content-sized lists use each entry widget's desired size at runtime; previews may provide a positive `size: [width, height]` per item.
- `TileView`: the same collection properties plus required positive integer `columns`.

Example state region:

```json
{
  "id": "DialogStates",
  "type": "WidgetSwitcher",
  "props": { "activeWidgetIndex": 0 },
  "slot": { "position": [100, 100], "size": [640, 420] },
  "children": [
    {
      "id": "NormalState",
      "type": "Overlay",
      "slot": { "padding": [0, 0, 0, 0], "horizontalAlign": "fill", "verticalAlign": "fill" },
      "children": []
    },
    {
      "id": "ConfirmState",
      "type": "Overlay",
      "slot": { "padding": [0, 0, 0, 0], "horizontalAlign": "fill", "verticalAlign": "fill" },
      "children": []
    }
  ]
}
```

Colors use `#RRGGBB` or `#RRGGBBAA`. Padding and brush margin accept a number, `[horizontal, vertical]`, or `[left, top, right, bottom]`.

## Slots

### Canvas parent

```json
{
  "position": [x, y],
  "size": [widthOrRightMargin, heightOrBottomMargin],
  "autoSize": false,
  "anchors": [minX, minY, maxX, maxY],
  "alignment": [pivotX, pivotY],
  "zOrder": 0
}
```

`anchors` and `alignment` use values from 0 to 1. Omitted anchors and alignment default to top-left behavior.

Use Unreal terminology consistently: `anchors` maps to Canvas Panel Slot Anchors, `alignment` maps to Canvas Panel Slot Alignment, `position` maps to the slot offset position, and `size` maps to fixed size or the far-edge margin on a stretched axis. Do not call `alignment` a pivot in package documentation or handoff notes.

Set `autoSize` to `true` only for a fixed-anchor Canvas child whose desired size should be derived from its contents, such as a content-sized card or nested list surface. Keep `position` and `size` present for compatibility; the fixed-axis size is ignored when auto-sizing.

On a fixed axis, `size` is the positive element size. On a stretched axis, `position` is the near-edge margin and `size` is the far-edge margin. Examples:

```json
{ "position": [0, 0], "size": [0, 0], "anchors": [0, 0, 1, 1] }
```

fills the parent. A semantically centered fixed element can use:

```json
{ "position": [0, 0], "size": [400, 240], "anchors": [0.5, 0.5, 0.5, 0.5], "alignment": [0.5, 0.5] }
```

### Overlay, WidgetSwitcher, and single-child-container parent

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

The format reconstructs static UI and mutually exclusive visual states. A `WidgetSwitcher` captures the state pages and their default active index, but the format does not generate Blueprint graphs, event bindings, or runtime transition logic. It also does not infer gameplay logic, animation, materials, custom fonts, or texture slicing from the screenshot. The importer does not crop or import local image files. Use placeholders until valid Unreal texture paths are supplied.
