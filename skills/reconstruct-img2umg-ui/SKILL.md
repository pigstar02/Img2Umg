---
name: reconstruct-img2umg-ui
description: Reconstruct static game UI from screenshots, mockups, or reference images as semantic Unreal UMG widget hierarchies and validated Img2UMG JSON packages. Use when Codex needs to inspect a UI image, decide containers and anchors, identify reusable list or tile entries, author Img2UMG manifests/screens/entries/previews, compare the local preview with the reference, or repair screenshot-derived Img2UMG JSON.
---

# Reconstruct Img2UMG UI

Turn visual intent into an editable UMG hierarchy. Let visual and semantic context drive layout decisions; use validation as a guardrail, not as a substitute for judgment.

## Prepare

1. Locate the Img2UMG repository containing `package.json`, `src/core`, and `unreal/Img2Umg`.
2. Read [references/format.md](references/format.md) completely before authoring or changing JSON.
3. Inspect every supplied reference image with the image viewing tool at original detail. Record its pixel dimensions.
4. If the reference or required assets are missing, ask for them. Do not invent visual evidence or Unreal asset paths.

## Understand the image

Analyze the whole composition before measuring individual controls:

- Identify the screen background, major regions, overlays, navigation, content areas, repeated items, and foreground decoration.
- Infer which visible shapes are containers and which are merely artwork. Prefer editable UMG primitives for panels, text, progress, and simple strokes; use `Image` for artwork that should remain a texture.
- Read visible text exactly when legible. Never add labels, symbols, initials, or filler text that are not visible in the reference. Report uncertain text outside the UI output or omit it.
- Detect repeated semantic components even when their content differs. Separate their shared structure from per-item preview values.
- Consider intended behavior beyond the captured resolution: what follows an edge, stays centered, spans available space, or belongs to a flow layout.

Do not choose anchors from fixed screen regions or geometric thirds. Decide them from the element's role, its parent, sibling alignment, preserved margins, and the composition as a whole.

## Design the UMG tree

Build a shallow semantic hierarchy before writing coordinates:

- Use `Canvas` for intentional overlap or independent placement.
- Use `Overlay` for stacked layers sharing one region.
- Use `HorizontalBox` or `VerticalBox` for true ordered flows with shared spacing and alignment.
- Use `SizeBox` to impose a meaningful size and `ScaleBox` when content should scale as one unit.
- Use `Border` for a single padded or stroked surface; insert an `Overlay` or box inside when it contains multiple elements.
- Use `ListView` or `TileView` only for repeated data-driven items. Create one entry document and express visible variations in its preview document.

Avoid a flat canvas containing every leaf. Also avoid wrappers that add no layout, clipping, sizing, or visual meaning.

Choose each Canvas anchor and alignment explicitly from intended responsive behavior. Preserve meaningful edge distances and centering. Use stretched anchors when the element should resize with its parent. Verify the decision at another viewport size instead of relying only on the source screenshot.

## Author the package

Write the final package directly as `ui.manifest.json`, screen documents, entry documents, and preview documents. Do not route model-decided structure through the legacy absolute-bounds extractor, because that extractor may infer a different hierarchy or anchor.

Use stable descriptive IDs in ASCII letters, digits, and underscores. Keep IDs unique within each document. Keep asset IDs unique across the manifest.

For artwork:

- Use a supplied Unreal texture object path when available.
- Otherwise set `source` to `null` and use a neutral placeholder color without invented text.
- Never place a local PNG path in `source`; the Unreal importer does not import source images.
- Do not use `placeholderLabel` as a substitute for missing artwork. If the reference visibly contains text over an image, create a real `Text` sibling with the exact observed text.

## Validate and iterate

Run after every meaningful edit:

```powershell
npm run validate -- <package-directory>/ui.manifest.json
```

Fix every reported error. Then preview the same package:

```powershell
$env:IMG2UMG_MANIFEST = "<absolute-path-to-ui.manifest.json>"
npm run dev
```

Open the page and compare it with the reference at the original dimensions. Check region bounds, stacking, spacing, typography, repeated entries, clipping, and placeholders. Resize the preview to expose incorrect anchor choices. Iterate until visual differences are explainable by unavailable source assets or unsupported runtime features.

The page also provides a visible package-folder picker. Choose the package directory when the preview is already running and a restart is inconvenient.

If Unreal Engine is available, import the manifest and verify the generated Widget Blueprints. The browser preview is a reconstruction aid, not proof that Unreal accepted the package.

## Completion gate

Finish only when all of the following hold:

- The package validator succeeds.
- The preview renders the intended screen without missing references.
- The tree is semantic and editable, not merely a pile of positioned leaves.
- Repeated content uses an entry template where appropriate.
- Anchors were chosen from design intent and checked under resize.
- Missing artwork and uncertain observations are disclosed.
- Unreal import succeeds when an engine is available in the workspace.
