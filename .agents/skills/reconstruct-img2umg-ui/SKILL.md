---
name: reconstruct-img2umg-ui
description: Reconstruct static or multi-state game UI from screenshots, annotated composites, mockups, or reference images as semantic Unreal UMG widget hierarchies and validated Img2UMG JSON packages. Use when Codex needs to recover ownership, adaptive anchors, desired-size propagation, runtime variables, Canvas versus flow containers, reusable list or tile entries, localized WidgetSwitcher states, manifests, previews, or repairs for screenshot-derived Img2UMG JSON.
---

# Reconstruct Img2UMG UI

Recover visual intent as an editable UMG hierarchy. Treat validation as a guardrail; derive structure, size behavior, and anchors from semantic evidence.

## Load the required guidance

1. Locate the Img2UMG repository containing `package.json`, `src/core`, and `unreal/Img2Umg`.
2. Read [references/format.md](references/format.md) completely before authoring JSON.
3. For a full reconstruction, read all four decision references before choosing final widgets:
   - [references/collections-states.md](references/collections-states.md) for ListView, TileView, fixed boxes, nested collections, and item-level switchers.
   - [references/containers-surfaces.md](references/containers-surfaces.md) for Canvas, boxes, Overlay, SizeBox, ScaleBox, and optional Border/Image surfaces.
   - [references/layout-sizing-anchors.md](references/layout-sizing-anchors.md) for desired-size propagation, `sizeToContent`, Canvas `autoSize`, anchors, and alignment.
   - [references/runtime-variables.md](references/runtime-variables.md) for UMG **Is Variable**.
4. For a focused repair, read `format.md` plus every decision reference touched by the repair. Always read both `collections-states.md` and `layout-sizing-anchors.md` when changing `sizeToContent`, nested lists, or entry height.

## Inspect the evidence

Inspect every supplied image at original detail and record its dimensions. Treat panels inside composites as separate views; exclude annotations and arrows from shipped UI unless visibly part of it.

Inspect the whole composition, then ambiguous regions, then repeated analogues. Do not invent text, Unreal asset paths, states, interactions, or hidden content. Author screens on the fixed `1920x1080` design canvas by preserving relationships, not by uniformly scaling source rectangles.

## Build the semantic scaffold

Make three passes before coordinates:

1. **Whole screen:** major modules, invariant chrome, overlays, repeated groups, and candidate states.
2. **Regions:** ownership, ordered flows, collections, independent controls, artwork, and clipping.
3. **Consistency:** normalize analogous regions and recurse through repeated structures.

Record:

```text
id | role | bounds | parent | sibling relation | collection/state relation |
width producer/consumer | height producer/consumer | runtime-reference evidence |
artwork/widget | confidence
```

Assign parents from shared clipping, parent-relative margins, common movement/state/lifecycle, ordered flow, or collection ownership. Visual containment alone is insufficient.

Before creating a Canvas, require independent anchoring, overlap, clipping, a shared coordinate system, or module-level lifecycle. Before creating a list, identify a record schema and collection lifecycle. Before using content sizing, identify a non-circular desired-size producer.

## Decide structure in this order

1. **Ownership:** recover the module or item that owns each visible part.
2. **Collection and state:** run the recursive collection inventory from `collections-states.md`; place switchers at the lowest structurally different subtree.
3. **Size propagation:** decide fixed, fill/stretch, or desired/content size independently on each axis using `layout-sizing-anchors.md`.
4. **Container:** choose Canvas, flow box, Overlay, collection, or sizing wrapper from the established relationships.
5. **Anchors and slots:** encode each Canvas child's axis behavior relative to its semantic parent.
6. **Runtime access:** set `isVariable` only from evidence in `runtime-variables.md`.
7. **Artwork:** use supplied Unreal paths; otherwise use unlabeled neutral placeholders.

Do not reverse this order. In particular, do not choose Canvas first and attempt to repair content sizing later, and do not enable `sizeToContent` merely because preview items have different heights.

## Author the package

Write `ui.manifest.json`, screen documents, entry documents, and preview documents directly. Use stable ASCII IDs unique within each document and asset IDs unique across the manifest.

Declare nested entry templates before their parent entries. Use previews for evidenced sample data and item sizes. Preview sizes approximate the evidence; they do not prove that runtime desired-size propagation exists.

Keep functional modules as selectable subtrees. Keep decoration inside its owner, but omit decorative nodes that add no independent brush, padding, stroke, texture, clipping, or state responsibility.

## Validate and iterate

Run after every meaningful edit:

```powershell
npm run validate -- <package-directory>/ui.manifest.json
```

Preview the package:

```powershell
$env:IMG2UMG_MANIFEST = "<absolute-path-to-ui.manifest.json>"
npm run dev
```

Compare at the source dimensions and another meaningful aspect ratio. Resize both module parents and list data: add/remove rows, switch item states, lengthen text, and change parent width. Diagnose parent structure before leaf coordinates.

If Unreal Engine is available, import the manifest and verify generated Widget Blueprints. Browser preview does not prove Unreal import or runtime desired-size behavior.

## Completion gate

Finish only when:

- validation succeeds and every screen uses `1920x1080`;
- every major region has an evidence-backed owner and sibling relationship;
- the collection inventory covers analogous siblings at every depth;
- structurally different records share an item only when they have one semantic role, with a lowest-difference switcher;
- every content-sized axis has a documented, non-circular desired-size chain from leaf to consumer;
- `ListView.sizeToContent` is used for entry sizing, not mistaken for sizing the list viewport;
- Canvas `autoSize`, list entry desired size, and parent anchors agree on each axis;
- Canvas is used only for independent placement/overlap/anchoring, while ordered size-propagating runs use boxes;
- Border exists only for an evidenced surface, stroke, brush, or authoritative padding and never substitutes for module ownership;
- every Canvas child passes the anchor audit in `layout-sizing-anchors.md`;
- every node passes the runtime-variable audit in `runtime-variables.md`;
- placeholders do not invent labels or Unreal asset paths;
- the preview survives different aspect ratios, data counts, item states, and text lengths without unexplained clipping;
- Unreal import succeeds when an engine is available.
