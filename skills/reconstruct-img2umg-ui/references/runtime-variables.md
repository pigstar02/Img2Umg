# Runtime variables

Use this reference when deciding node-level `isVariable`, which maps to UMG Designer **Is Variable**.

## Set true from positive evidence

Set `isVariable: true` when runtime logic must directly:

- register or handle an event;
- populate, refresh, select, or scroll a ListView/TileView;
- change a WidgetSwitcher page;
- update text, image, progress, enabled state, selection, or visibility;
- animate, move, resize, show, hide, or replace a named module as one unit;
- access a widget explicitly named by the requirement.

Interactive controls and runtime collections are strong evidence. Entry fields that clearly represent per-record data are normally variable. Evaluate the collection, entry root, switcher, and leaves independently.

## Keep false by default

Omit or keep false for:

- static labels and fixed copy;
- decorative Image/Border/divider/frame nodes;
- layout-only Canvas, Overlay, boxes, SizeBox, ScaleBox, and Spacer;
- children never accessed directly even when an ancestor is variable;
- speculative future binding unsupported by the reference.

Do not mark an entire subtree variable. A variable ListView does not make its decorative surface variable; a variable switcher does not make every state wrapper variable.

## Audit

Record:

```text
node | runtime operation | caller/event evidence | direct reference required? | isVariable
```

If the runtime operation can be performed through an already-variable owner or data object without a direct widget reference, keep the child non-variable.
