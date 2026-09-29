# Containers and visual surfaces

Use this reference when choosing Canvas, HorizontalBox, VerticalBox, Overlay, SizeBox, ScaleBox, Border, or Image.

## Choose from relationships

### Canvas

Use Canvas for at least one concrete responsibility:

- independent edge or center anchoring;
- intentional overlap or a shared local coordinate system;
- module-level clipping, visibility, input, animation, movement, or replacement;
- children attached to different parent edges;
- selection/focus chrome layered over item content.

Do not use Canvas for a simple ordered run or for an axis whose desired size must be accumulated from children. A Canvas root inside a content-sized list entry is a warning unless another node supplies authoritative desired size.

### HorizontalBox and VerticalBox

Use a box when siblings have stable order, common cross-axis alignment, consistent gaps, and a content-size change should push later siblings.

- Use HorizontalBox for leading identity plus flexible content, icon-label-value, or content plus action.
- Use VerticalBox for title/body/footer, stacked status rows, or variable-height child accumulation.
- Use `auto` for content retaining desired size and `fill` for the child consuming remaining space.

Fixed sibling count does not disqualify a box. Data-driven repetition may still require a ListView instead.

### Overlay

Use Overlay for stacked layers sharing one extent: background plus content, selection frame plus item, or state chrome plus foreground. Do not use it for ordered flow.

### SizeBox and ScaleBox

Use SizeBox only when fixed/minimum dimensions are semantic or needed to make a desired-size contract explicit. Use ScaleBox when a subtree scales as one visual unit.

## Border is optional

Do not create Border by default. Use it only when at least one evidenced responsibility exists:

- solid or tinted surface;
- border stroke;
- rounded rectangle;
- brush-style padding owned by the surface;
- one-child visual wrapper whose desired size should include authoritative padding.

Omit Border when it merely names a module, duplicates an Image/background, or wraps content without visible surface or padding responsibility.

Prefer Image when supplied artwork or an Unreal texture owns the visual surface. Keep the Image/Border as a visual child of a functional module; neither becomes module ownership merely because content appears on top of it.

Border accepts one child. If several independently placed children share a surface, use a module Canvas or Overlay and keep Border/Image as a fill visual sibling. If ordered content should determine surface size, a Border with one flow child is appropriate.

## Decision audit

For each container record:

```text
siblings | order/overlap | desired-size direction | independent edges |
collection lifecycle | chosen container | rejected alternatives
```

For each Border record its brush, stroke, corner, or padding responsibility. Remove it if none exists.
