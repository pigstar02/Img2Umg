import { describe, expect, it } from 'vitest';
import * as css from 'css-tree';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { expandDocument, renderDocument, RESET_CSS } from '../src/render.js';
import type { UiDocument, UiNode } from '../src/types.js';

type Element = DefaultTreeAdapterMap['element'];
function elements(markup: string): Element[] {
  const result: Element[] = [];
  function visit(node: DefaultTreeAdapterMap['node']) {
    if ('tagName' in node) result.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  }
  visit(parse(markup));
  return result;
}
const attr = (node: Element, name: string) => node.attrs.find(attribute => attribute.name === name)?.value;
const byId = (markup: string, id: string) => elements(markup).find(node => attr(node, 'data-ui-id') === id)!;
function node(id: string, kind: UiNode['kind'] = 'panel', children: UiNode[] = []): UiNode {
  return { id, kind, layout: kind === 'text' || kind === 'image' ? 'leaf' : 'column',
    box: { width: 'auto', height: 'auto', padding: [0, 0, 0, 0], margin: [0, 0, 0, 0], gap: 0, align: 'stretch', self: 'auto', position: 'flow', left: 0, top: 0, zIndex: 0, display: 'visible', visibility: 'visible', overflow: 'visible' },
    paint: { background: 'transparent', color: '#ffffff' }, children,
    ...(kind === 'text' ? { text: { value: 'Default', family: 'DemoFont', size: 16, weight: 400 as const, align: 'left' as const } } : {}),
    ...(kind === 'image' ? { assetId: 'icon' } : {}),
  };
}
function fixture(): UiDocument {
  const template = node('card', 'panel', [node('label', 'text'), node('image', 'image')]);
  template.layout = 'row';
  template.children[0]!.field = 'title';
  const list = node('quests', 'collection');
  list.collectionId = 'questCollection';
  const root = node('root', 'panel', [list]);
  root.layout = 'canvas';
  const ids = ['root', 'quests', 'one', 'oneLabel', 'oneImage', 'two', 'twoLabel', 'twoImage'];
  return { format: 'html-umg-ir', version: 2, target: 'ue-5.8.2', viewport: { width: 800, height: 600 }, root,
    templates: { QuestCard: template },
    collections: [{ id: 'questCollection', nodeId: 'quests', templateId: 'QuestCard', orientation: 'vertical', items: [
      { key: 'one', nodeIds: { card: 'one', label: 'oneLabel', image: 'oneImage' }, overrides: { label: { text: 'First' } } },
      { key: 'two', nodeIds: { card: 'two', label: 'twoLabel', image: 'twoImage' }, overrides: { label: { text: 'Second', color: '#ff0000' }, card: { background: '#112233' }, image: { assetId: 'otherIcon' } } },
    ] }],
    assets: [
      { id: 'font', kind: 'font', path: 'assets/DemoFont.woff2', mime: 'font/woff2', sha256: 'a'.repeat(64) },
      { id: 'icon', kind: 'image', path: 'assets/quest.png', mime: 'image/png', sha256: 'b'.repeat(64) },
      { id: 'otherIcon', kind: 'image', path: 'assets/other.png', mime: 'image/png', sha256: 'c'.repeat(64) },
    ], fonts: [{ family: 'DemoFont', weight: 400, assetId: 'font' }],
    observations: Object.fromEntries(ids.map(id => [id, { x: 999, y: 999, width: 999, height: 999 }])),
  };
}

describe('canonical Web renderer', () => {
  it('resets exported elements to block while canonical containers explicitly use flex', () => {
    expect(RESET_CSS).toMatch(/:where\(\[data-ui-id\]\)\{[^}]*display:block;/);
    expect(RESET_CSS).toContain(':where(button){');
    const reset = css.parse(RESET_CSS);
    css.walk(reset, { visit: 'Rule', enter(rule) {
      const selector = css.generate(rule.prelude);
      expect(selector === '*' || selector.startsWith(':where(')).toBe(true);
    } });
    expect(attr(byId(renderDocument(fixture()), 'quests'), 'style')).toContain('display:flex;');
  });

  it('keeps CSS string breakout payloads inside a single family and local asset URL', () => {
    const doc = fixture();
    const family = '\\";color:red;} </style><script>alert(1)</script>\\\\\n';
    const fontPath = 'assets/font\" );} </style><script>alert(1)</script>.woff2';
    doc.fonts[0]!.family = family;
    doc.templates.QuestCard!.children[0]!.text!.family = family;
    doc.assets[0]!.path = fontPath;
    const markup = renderDocument(doc);
    const all = elements(markup);
    expect(all.filter(element => element.tagName === 'style')).toHaveLength(1);
    expect(all.filter(element => element.tagName === 'script')).toHaveLength(0);
    const style = all.find(element => element.tagName === 'style')!;
    const styleText = style.childNodes.map(child => child.nodeName === '#text' ? (child as DefaultTreeAdapterMap['textNode']).value : '').join('');
    const stylesheet = css.parse(styleText);
    const fontDeclarations: string[] = [];
    css.walk(stylesheet, { visit: 'Atrule', enter(rule) {
      if (rule.name !== 'font-face') return;
      css.walk(rule, { visit: 'Declaration', enter(declaration) { fontDeclarations.push(declaration.property); } });
    } });
    expect(fontDeclarations).toEqual(['font-family', 'src', 'font-weight', 'font-style', 'font-display']);
    const strings: string[] = [];
    css.walk(stylesheet, { visit: 'String', enter(value) { strings.push(value.value); } });
    expect(strings).toContain(family);
    const urls: string[] = [];
    css.walk(stylesheet, { visit: 'Url', enter(value) { urls.push(value.value); } });
    expect(urls).toEqual([fontPath]);
    const inline = css.parse(attr(byId(markup, 'oneLabel'), 'style')!, { context: 'declarationList' });
    const families: string[] = [];
    css.walk(inline, { visit: 'String', enter(value) { families.push(value.value); } });
    expect(families).toEqual([family]);
  });
  it('expands list templates with original source IDs and per-item overrides without mutations', () => {
    const doc = fixture();
    const original = structuredClone(doc);
    const expanded = expandDocument(doc);
    const list = expanded.children[0]!;
    expect(list.kind).toBe('panel');
    expect(list.layout).toBe('column');
    expect(list.children.map(child => child.id)).toEqual(['one', 'two']);
    expect(list.children[0]!.children[0]!.text!.value).toBe('First');
    expect(list.children[1]!.children[0]!.text!.value).toBe('Second');
    expect(list.children[1]!.children[0]!.paint.color).toBe('#ff0000');
    expect(list.children[1]!.paint.background).toBe('#112233');
    expect(list.children[1]!.children[1]!.assetId).toBe('otherIcon');
    list.children[0]!.children[0]!.text!.value = 'Mutation';
    expect(list.children[1]!.children[0]!.text!.value).toBe('Second');
    expect(doc).toEqual(original);
    const markup = renderDocument(doc);
    expect(attr(byId(markup, 'quests'), 'data-ui-collection')).toBe('list');
    expect(attr(byId(markup, 'one'), 'data-ui-entry')).toBe('QuestCard');
    expect(attr(byId(markup, 'two'), 'data-ui-entry')).toBe('QuestCard');
    expect(attr(byId(markup, 'oneLabel'), 'data-ui-field')).toBe('title');
    expect(attr(byId(markup, 'twoImage'), 'src')).toBe('assets/other.png');
    expect(doc).toEqual(original);
  });

  it('escapes text, attributes and CSS strings without producing executable markup', () => {
    const doc = fixture();
    const hostile = '\"><script>alert(1)</script>&\'';
    doc.collections[0]!.items[0]!.overrides.label!.text = hostile;
    doc.templates.QuestCard!.children[0]!.field = hostile;
    doc.root.id = hostile;
    doc.observations[hostile] = doc.observations.root!;
    delete doc.observations.root;
    doc.fonts[0]!.family = hostile;
    doc.templates.QuestCard!.children[0]!.text!.family = hostile;
    const markup = renderDocument(doc);
    const all = elements(markup);
    expect(all.some(element => element.tagName === 'script')).toBe(false);
    expect(all.some(element => element.attrs.some(attribute => attribute.name.startsWith('on')))).toBe(false);
    expect(attr(byId(markup, hostile), 'data-ui-id')).toBe(hostile);
    expect(attr(byId(markup, 'oneLabel'), 'data-ui-field')).toBe(hostile);
    expect(markup).toContain('&lt;script&gt;');
    expect(markup).toContain('\\3c script\\3e ');
    expect(markup.match(/<style>/g)).toHaveLength(1);
    expect(markup.match(/<\/style>/g)).toHaveLength(1);
  });

  it('normalizes box layout, keeps auto sizes, ignores observations, and embeds only canonical CSS', () => {
    const doc = fixture();
    const box = doc.root.children[0]!.box;
    Object.assign(box, { padding: [1, 2, 3, 4], margin: [5, 6, 7, 8], gap: 12, align: 'center', self: 'flex-end', position: 'absolute', left: 20, top: 30, zIndex: 4, visibility: 'hidden', overflow: 'clip' });
    const markup = renderDocument(doc);
    const style = attr(byId(markup, 'quests'), 'style')!;
    for (const declaration of ['display:flex', 'flex-direction:column', 'width:auto', 'height:auto', 'padding:2px 3px 4px 1px', 'margin:6px 7px 8px 5px', 'gap:12px', 'align-items:center', 'align-self:flex-end', 'position:absolute', 'left:20px', 'top:30px', 'z-index:4', 'visibility:hidden', 'overflow:clip']) expect(style).toContain(`${declaration};`);
    expect(attr(byId(markup, 'root'), 'style')).toContain('width:800px;height:600px;');
    expect(markup).not.toContain('999px');
    expect(markup).toContain(RESET_CSS);
    expect(markup).toContain('src:url("assets/DemoFont.woff2")');
    expect(markup).not.toContain('<link');
    expect(markup).toContain('object-fit:fill');
    box.display = 'collapsed';
    expect(attr(byId(renderDocument(doc), 'quests'), 'style')).toContain('display:none;');
  });

  it('handles horizontal and empty collections as flex containers', () => {
    const doc = fixture();
    doc.collections[0]!.orientation = 'horizontal';
    doc.root.children[0]!.layout = 'row';
    expect(attr(byId(renderDocument(doc), 'quests'), 'style')).toContain('flex-direction:row;');
    doc.collections[0]!.items = [];
    doc.observations = { root: doc.observations.root!, quests: doc.observations.quests! };
    expect(expandDocument(doc).children[0]!.children).toEqual([]);
    expect(attr(byId(renderDocument(doc), 'quests'), 'data-ui-collection')).toBe('list');
  });

  it('rejects invalid CSS and unsafe asset URLs before rendering', () => {
    const doc = fixture();
    doc.collections[0]!.items[1]!.overrides.card!.background = 'red;position:fixed';
    expect(() => renderDocument(doc)).toThrow();
    expect(() => expandDocument(doc)).toThrow();
    const badAsset = fixture();
    badAsset.assets[0]!.path = 'javascript:alert(1)';
    expect(() => renderDocument(badAsset)).toThrow();
    const badNumber = fixture();
    badNumber.root.box.gap = Number.POSITIVE_INFINITY;
    expect(() => renderDocument(badNumber)).toThrow();
  });
});
