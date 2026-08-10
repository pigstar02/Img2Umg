# Collections and item states

Use this reference when deciding ListView, TileView, fixed box children, nested collections, reusable entry schemas, or WidgetSwitcher placement.

## Recursive collection inventory

Inspect analogous siblings at every semantic depth. Finding an inner repeated row does not end evaluation of its enclosing repeated parents.

Record:

```text
candidate siblings | semantic record type | ordering/population lifecycle |
shared item chrome | varying fields | child collection |
structural variants | chosen collection/state | rejection reason
```

## List, tile, or fixed box

Use ListView when siblings are one-dimensional records with a reusable schema and a plausible shared population, refresh, selection, scrolling, or variable-count lifecycle.

Use TileView when the same collection wraps or forms evidenced columns.

Use HorizontalBox/VerticalBox when the children are fixed structural sections, not records, even if they look similar. Examples include title/body/footer or a fixed sequence of navigation landmarks with different ownership.

Do not create a collection for repeated decoration, background motifs, dots, or lines without record identity.

When screenshot evidence cannot prove runtime population, prefer the reusable collection only when record identity, repeated schema, and common lifecycle are strong; disclose the assumption.

## Normalize before rejecting a shared item

Separate invariant item chrome from variable content:

- identity icon/label;
- card or bubble surface;
- selection/focus chrome;
- child-list placement;
- trailing action region.

Treat different text, icons, colors, child counts, item heights, or action visibility as data or state variation, not automatically as different item templates.

Do not merge items when they differ in semantic record type, ownership, ordering model, interaction lifecycle, or enclosing chrome that cannot be factored into shared and variable subtrees.

## Different structures in one item

Use one entry template with a WidgetSwitcher when:

- variants occupy the same semantic item role;
- only a localized subtree differs;
- variants are mutually exclusive per record;
- shared item chrome and ownership remain stable.

Place the switcher at the lowest structurally different node. Keep shared surface, identity, selection, and child-list ownership outside it.

Examples:

- text-only detail versus icon/text/button detail: switch at detail-row level;
- normal versus selected item with different content structure: switch only the content subtree if selection chrome is shared;
- empty versus populated panel: switch at panel-content level, not screen root.

Use separate entry templates when variants need different data models, lifecycle, collection behavior, ownership, or incompatible outer layout.

## Nested collections

Use a nested ListView when one outer record owns zero or more child records. Declare the inner entry before the outer entry in the manifest.

Decide inner and outer `sizeToContent` only after reading `layout-sizing-anchors.md`. Variable child count alone does not guarantee that desired height propagates through the outer entry.

## Switcher evidence

Positive evidence includes multiple depicted variants of one role, shared bounds/chrome with localized differences, explicit state names, or repeated records visibly using different structures.

Do not invent hover/pressed/disabled states. Preview each evidenced state, use descriptive state IDs, and set `activeWidgetIndex` to the depicted default.

The package does not generate runtime transition graphs or data binding. Record that handoff explicitly.
