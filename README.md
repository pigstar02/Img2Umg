# Img2UMG

## HTML/CSS workflow (v2)

The independent [v2 implementation](v2/README.md) now validates restricted HTML/CSS, extracts a semantic IR with explicit list templates, and reconstructs a standalone Web preview with geometry and screenshot comparison. Run `npm run v2:extract -- v2/examples/quests/index.html v2/output-quests` (new output directory required). A local Chrome/Chromium is required. **The [Unreal plugin](unreal/Img2Umg/README.md) now includes a separate V2 IR importer and Runtime module (source implementation; UE compilation/rendering not yet verified).** V1 import remains available; V2 IR must use the new V2 menu. UE imports require TTF/OTF rather than the web demo's WOFF2 font. A font-free fixture is available at [ue-smoke](v2/examples/ue-smoke/index.html). The original JSON workflow below is preserved.

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

### Explicit collection intent (recommended for screenshot workflows)

Geometry alone cannot tell data records from fixed navigation or action buttons. Add a `collection` field to a **visual container**, not to its `props`:

- `"list"`: all direct children form one single-row/column collection; accepts two or more compatible items.
- `"tile"`: all direct children form one regular multi-row, multi-column grid.
- `"none"`: do not merge this container's direct children; nested containers are still evaluated independently.
- `"auto"` (or omitted): retain the legacy three-item geometric heuristic. This is not a semantic guarantee.

Explicit hints still require matching structures, property-key sets and valid geometry. Invalid explicit groups remain ordinary nodes, without extracting a partial subset at that level. Grid rows must match the first row's columns, including an incomplete final row starting at column one. Hints are input-only and do not change the Unreal package format.

Put a collection in a dedicated Canvas whose children are complete items; keep headings and filters outside it. Mark fixed or uncertain repeated layouts `none`. The CLI prints extraction/skipping reasons to stderr; API users can pass `onDiagnostic` in `ExtractionOptions`.

The project-local skill is [skills/img2umg/SKILL.md](skills/img2umg/SKILL.md). It specifies a screenshot → candidate decisions → grouped visual JSON → validated package workflow, including counterexamples and uncertainty handling. It is not automatically installed into an external skill registry.

Limitations: the extractor does not read image pixels, infer runtime data/scrolling, normalize heterogeneous entries, or prove that a visually repeated region must use UMG virtualization. Single visible entries and inconsistent templates require clarification or ordinary layout fallback.

## Preview and verification

```bash
npm run dev
npm test
npm run build
```

The included inventory package demonstrates both list types, independent entry templates, preview overrides, placeholders, text, a button, and a progress bar.
