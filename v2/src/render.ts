import type { Edges, UiDocument, UiNode } from './types.js';
import { assertDocument } from './validate.js';

/** Shared author-extraction and canonical-render defaults. Never includes author CSS. */
export const RESET_CSS = `*{box-sizing:border-box;margin:0;padding:0;border:0;min-width:0;min-height:0;}
:where(body){margin:0;background:transparent;}
:where(button){appearance:none;background:transparent;color:inherit;font:inherit;text-align:inherit;border-radius:0;}
:where(img){display:block;}
:where(ul,ol){list-style:none;}
:where([data-ui-id]){display:block;flex:0 0 auto;position:relative;white-space:nowrap;line-height:normal;font-style:normal;justify-content:flex-start;flex-wrap:nowrap;overflow-clip-margin:0;text-decoration:none;letter-spacing:normal;word-spacing:normal;}`;

const html = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
// CSS strings need CSS escapes, not HTML entities (style is a raw-text element).
const cssString = (value: string): string => `"${value.replace(/[\\"<>\u0000-\u001f\u007f]/g, character => `\\${character.codePointAt(0)!.toString(16)} `)}"`;
const length = (value: number | 'auto'): string => value === 'auto' ? 'auto' : `${value}px`;
const edges = ([left, top, right, bottom]: Edges): string => `${top}px ${right}px ${bottom}px ${left}px`;

function expandValidated(doc: UiDocument): UiNode {
  const collections = new Map(doc.collections.map(collection => [collection.id, collection]));
  function expand(node: UiNode): UiNode {
    const clone = structuredClone(node);
    if (node.kind !== 'collection') {
      clone.children = node.children.map(expand);
      return clone;
    }
    const collection = collections.get(node.collectionId!)!;
    clone.kind = 'panel';
    clone.layout = collection.orientation === 'horizontal' ? 'row' : 'column';
    clone.children = collection.items.map(item => {
      function instantiate(template: UiNode): UiNode {
        const result = structuredClone(template);
        result.id = item.nodeIds[template.id]!;
        const override = item.overrides[template.id];
        if (override) {
          if (override.text !== undefined && result.text) result.text.value = override.text;
          if (override.assetId !== undefined) result.assetId = override.assetId;
          if (override.background !== undefined) result.paint.background = override.background;
          if (override.color !== undefined) result.paint.color = override.color;
        }
        result.children = template.children.map(instantiate);
        return result;
      }
      return instantiate(doc.templates[collection.templateId]!);
    });
    return clone;
  }
  return expand(doc.root);
}

/** Return a detached tree retaining each item's original source ids. */
export function expandDocument(doc: UiDocument): UiNode {
  assertDocument(doc);
  return expandValidated(doc);
}

function inlineStyle(node: UiNode, doc: UiDocument, root: boolean): string {
  const b = node.box;
  const declarations = [
    `display:${b.display === 'collapsed' ? 'none' : node.layout === 'row' || node.layout === 'column' ? 'flex' : 'block'}`,
    `width:${length(root ? doc.viewport.width : b.width)}`,
    `height:${length(root ? doc.viewport.height : b.height)}`,
    `padding:${edges(b.padding)}`, `margin:${edges(b.margin)}`, `gap:${b.gap}px`,
    `align-items:${b.align}`, `align-self:${b.self}`, `position:${b.position === 'absolute' ? 'absolute' : 'relative'}`,
    `z-index:${b.zIndex}`, `visibility:${b.visibility}`, `overflow:${b.overflow}`,
    `background-color:${node.paint.background}`, `color:${node.paint.color}`,
  ];
  if (node.layout === 'row' || node.layout === 'column') declarations.push(`flex-direction:${node.layout}`);
  if (b.position === 'absolute') declarations.push(`left:${b.left}px`, `top:${b.top}px`);
  if (node.text) declarations.push(`font-family:${cssString(node.text.family)}`, `font-size:${node.text.size}px`, `font-weight:${node.text.weight}`, `text-align:${node.text.align}`);
  if (node.kind === 'image') declarations.push('object-fit:fill');
  return `${declarations.join(';')};`;
}

/** Full standalone canonical HTML; only assets retain document-relative URLs. */
export function renderDocument(doc: UiDocument): string {
  // Validate every IR value (including template overrides) before CSS/URL emission.
  assertDocument(doc);
  const root = expandValidated(doc);
  const assets = new Map(doc.assets.map(asset => [asset.id, asset]));
  const collections = new Map(doc.collections.map(collection => [collection.id, collection]));
  const fontCss = doc.fonts.map(font => `@font-face{font-family:${cssString(font.family)};src:url(${cssString(assets.get(font.assetId)!.path)});font-weight:${font.weight};font-style:normal;font-display:block;}`).join('\n');
  function element(node: UiNode, isRoot = false, entry?: string): string {
    const tag = node.kind === 'image' ? 'img' : node.kind === 'button' ? 'button' : 'div';
    const attributes = [`data-ui-id="${html(node.id)}"`, `style="${html(inlineStyle(node, doc, isRoot))}"`];
    if (isRoot) attributes.push('data-ui-root');
    if (node.layout === 'canvas') attributes.push('data-ui-layout="canvas"');
    if (node.field !== undefined) attributes.push(`data-ui-field="${html(node.field)}"`);
    if (entry !== undefined) attributes.push(`data-ui-entry="${html(entry)}"`);
    const collection = node.collectionId ? collections.get(node.collectionId) : undefined;
    if (collection) attributes.push('data-ui-collection="list"');
    if (tag === 'button') attributes.push('type="button"');
    if (tag === 'img') {
      attributes.push(`src="${html(assets.get(node.assetId!)!.path)}"`, 'alt=""');
      return `<img ${attributes.join(' ')}>`;
    }
    const content = node.text ? html(node.text.value) : '';
    return `<${tag} ${attributes.join(' ')}>${content}${node.children.map(child => element(child, false, collection?.templateId)).join('')}</${tag}>`;
  }
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Canonical UI</title><style>${RESET_CSS}\n${fontCss}</style></head><body>${element(root, true)}</body></html>\n`;
}
