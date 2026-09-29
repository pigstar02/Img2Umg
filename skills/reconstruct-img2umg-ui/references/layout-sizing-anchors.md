# Layout, desired size, and anchors

Use this reference whenever deciding `sizeToContent`, Canvas `autoSize`, entry sizes, anchors, alignment, or adaptive behavior.

## Contents

- Axis-first model
- Desired-size chain
- ListView sizeToContent
- Canvas autoSize
- Anchor encoding
- Coupling rules
- Audit

## Axis-first model

Classify width and height independently for every relevant node:

- **fixed:** an evidenced explicit size;
- **fill/stretch:** consume the extent provided by the parent;
- **desired/content:** derive extent from children or intrinsic content;
- **near/far/center positioned:** fixed or desired size attached to a parent edge or center.

Record both the size producer and consumer. A property name is not a sizing explanation.

## Desired-size chain

A content-sized axis is valid only when size can propagate without a cycle:

```text
intrinsic leaf or fixed child
-> flow/single-child container desired size
-> entry root desired size
-> ListView entry sizing
-> enclosing flow or fixed/stretched list viewport
```

Prefer `VerticalBox` for vertical desired-size accumulation and `HorizontalBox` for horizontal accumulation. Use `SizeBox` when a fixed, minimum, or authoritative dimension is part of the design.

Treat a Canvas on a desired-size axis as a warning. Children positioned or stretched inside a Canvas usually do not establish a reliable aggregate desired size. Do not make a parent's desired size depend on a child whose size stretches back to that parent on the same axis.

For a nested variable-height list:

1. inner entries must report desired height;
2. the inner list must consume per-entry desired height;
3. the outer entry's vertical container must propagate the inner list's desired height;
4. the outer list must consume the outer entry's desired height;
5. the outer list viewport must still have an explicit placement and available extent.

If any link is absent, use an evidenced fixed/default item height or redesign the container. Do not hide the missing link with preview-only item sizes.

Reject this circular pattern:

```text
OuterList sizeToContent
-> OuterEntry Canvas needs a height
-> InnerList stretches to OuterEntry height
-> InnerList cannot produce the height OuterEntry needs
```

Preview `item.size` can make that pattern look correct in the browser while Unreal still lacks a runtime desired-height chain.

Prefer:

```text
OuterList sizeToContent
-> OuterEntry horizontal/vertical flow reports desired height
-> fixed/min-height identity region + desired-height detail region
-> InnerList consumes desired-height detail entries
```

Use a Canvas inside either region only for cross-axis overlap or independent placement; do not make it the vertical size accumulator.

## ListView sizeToContent

In Img2UMG, `ListView.props.sizeToContent: true` means the list uses each entry widget's desired/per-preview item size instead of one mandatory `entrySize`. It does **not** mean the ListView node collapses its own viewport to all children.

Enable it when:

- entries share one record schema but have evidenced variable size on the list axis;
- the entry root can produce desired size on that axis;
- the collection should lay out whole items rather than force a uniform row size;
- nested child counts or localized switcher states legitimately change entry size.

Keep it false and provide `entrySize` when:

- rows or tiles are uniform;
- the list is a fixed scrolling viewport whose entries have a stable extent;
- the entry root cannot produce a non-circular desired size;
- variation is only unused whitespace or a visual accident;
- the screenshot supplies no evidence and fixed size is the safer model.

Preview `item.size` is sample visual data. It validates the visible reconstruction but does not create runtime desired-size logic in Unreal. Disclose reliance on preview sizes when runtime propagation is uncertain.

## Canvas autoSize

Canvas slot `autoSize: true` derives a fixed-anchor child's slot size from desired content. It is separate from `ListView.sizeToContent`.

- Use it only on a fixed anchor for the auto-sized axis.
- Do not combine auto size and split/stretch anchors on the same axis.
- Ensure the child can actually report desired size.
- Use matching anchor/alignment to attach the desired-size result to the intended edge or center.
- Do not use it to make a Canvas aggregate independently positioned children.

## Anchor encoding

For every direct Canvas child, classify each axis:

| Behavior | Anchor | Alignment | Offset meaning |
| --- | --- | --- | --- |
| near-edge fixed | 0 | 0 | near margin |
| far-edge fixed | 1 | 1 | signed far-edge offset |
| centered fixed | 0.5 | 0.5 | center-relative offset |
| stretched | 0 to 1 | 0 | near and far margins |
| content-sized | semantic fixed anchor | matching alignment | anchor-relative offset plus desired size |

On a stretched axis, `position` is the near margin and `size` is the far margin. On a fixed axis, `size` is the element size.

Anchor module roots to the screen. Anchor descendants to their owning module. A trailing action belongs to the item or bubble far edge, not the screen.

## Coupling rules

- A content-sized entry may live in a fixed or stretched ListView viewport.
- A stretched entry width can coexist with desired entry height when width is supplied before height is measured.
- Text wrapping creates a width-to-height dependency; establish width before trusting desired height.
- A parent cannot be desired-sized from a child that fills that parent on the same axis.
- A fixed-height clipping parent defeats descendant content sizing.
- A switcher contributes the desired size of its active state; verify every state and choose whether item height changes or reserves a common extent.
- `collapsed` removes desired size; `hidden` preserves it.

## Audit

Record for every Canvas child and content-sized collection:

```text
node | width mode/producer | height mode/producer |
consumer | anchors/alignment | viewport extent |
cycle check | alternate-data check | resize invariant
```

Test:

- parent narrower and wider;
- parent shorter and taller;
- shortest and longest text;
- minimum and maximum evidenced child count;
- every switcher state;
- source aspect ratio and another meaningful ratio.

Treat many unexplained top-left anchors, clipped variable rows, or preview sizes that disagree with runtime structure as a failed audit.
