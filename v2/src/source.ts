import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import * as parse5 from 'parse5';
import * as css from 'css-tree';

export interface SourceDiagnostic {
  code: string;
  message: string;
  file: string;
  nodeId?: string;
  line?: number;
}

export class SourceError extends Error {
  diagnostics: SourceDiagnostic[];
  constructor(diagnostics: SourceDiagnostic[]) {
    super(diagnostics.map(d => `${d.code}: ${d.file}${d.line ? `:${d.line}` : ''}: ${d.message}`).join('\n'));
    this.name = 'SourceError';
    this.diagnostics = diagnostics;
  }
}

type HtmlNode = parse5.DefaultTreeAdapterMap['node'];
type Element = parse5.DefaultTreeAdapterMap['element'];
type Context = { file: string; nodeId?: string; line?: number };
const tags = new Set('html head body title meta style link div section article header footer nav span p h1 h2 h3 h4 h5 h6 img button ul ol li'.split(' '));
const structural = new Set(['html', 'head', 'body', 'title', 'meta', 'style', 'link']);
const globalAttributes = new Set(['id', 'class', 'style', 'lang', 'data-ui-root', 'data-ui-id', 'data-ui-collection', 'data-ui-entry', 'data-ui-field', 'data-ui-layout']);
const attr = (node: Element, name: string) => node.attrs.find(a => a.name === name)?.value;
const isElement = (node: HtmlNode): node is Element => 'tagName' in node;
const inside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const fail = (code: string, message: string, context: Context): never => {
  throw new SourceError([{ code, message, ...context }]);
};
const cssFail = (message: string, context: Context): never => fail('E_CSS_UNSUPPORTED', message, context);
const decodeIdent = (value: string) => css.ident.decode(value).toLowerCase();
const tokens = (value: css.CssNode): css.CssNode[] => value.type === 'Value' ? value.children.toArray() : [];
const number = (node: css.CssNode) => node.type === 'Number' ? Number(node.value) : NaN;
const px = (node: css.CssNode, positive = false) => node.type === 'Dimension' && decodeIdent(node.unit) === 'px'
  && Number.isFinite(Number(node.value)) && (positive ? Number(node.value) > 0 : Number(node.value) >= 0);
const ident = (node: css.CssNode, values: string[]) => node.type === 'Identifier' && values.includes(decodeIdent(node.name));

/** Load and validate author source. No browser, reset stylesheet, or asset copying occurs here. */
export async function loadSource(inputFile: string): Promise<{ html: string; rootDirectory: string; diagnostics: SourceDiagnostic[] }> {
  const input = path.resolve(inputFile);
  try {
    const rootDirectory = await realpath(path.dirname(input));
    const actualInput = await realpath(input);
    if (!inside(rootDirectory, actualInput)) fail('E_SOURCE_PATH', 'Input HTML symlink escapes its directory.', { file: input });
    if (!['.html', '.htm'].includes(path.extname(actualInput).toLowerCase())) {
      fail('E_SOURCE_PATH', 'Input must be an HTML file.', { file: input });
    }
    const original = await readFile(actualInput, 'utf8');

    async function resource(raw: string, directory: string, extensions: string[], context: Context): Promise<{ file: string; relative: string; directory: string }> {
      let value: string;
      try { value = decodeURIComponent(raw); }
      catch { return fail('E_SOURCE_PATH', `Invalid URL encoding: ${raw}`, context); }
      if (!value || value !== value.trim() || /[\\\u0000-\u001f\u007f?#]/.test(value) || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) {
        return fail('E_SOURCE_PATH', `Only relative local asset paths without query/hash are allowed: ${raw}`, context);
      }
      const candidate = path.resolve(directory, value);
      if (!inside(rootDirectory, candidate)) return fail('E_SOURCE_PATH', `Asset escapes the HTML directory: ${raw}`, context);
      if (!extensions.includes(path.extname(candidate).toLowerCase())) return fail('E_SOURCE_PATH', `Unsupported asset extension: ${raw}`, context);
      let actual: string;
      try {
        actual = await realpath(candidate);
        if (!inside(rootDirectory, actual)) return fail('E_SOURCE_PATH', `Asset symlink escapes the HTML directory: ${raw}`, context);
        if (!extensions.includes(path.extname(actual).toLowerCase())) return fail('E_SOURCE_PATH', `Unsupported real asset extension: ${raw}`, context);
        await readFile(actual);
      } catch (error) {
        if (error instanceof SourceError) throw error;
        return fail('E_SOURCE_READ', `Cannot read asset ${raw}: ${String(error)}`, context);
      }
      // Use lexical path (already realpath-checked), retaining in-tree symlink names.
      const relative = path.relative(rootDirectory, candidate).split(path.sep).map(encodeURIComponent).join('/');
      return { file: actual, relative, directory: path.dirname(candidate) };
    }

    function declaration(node: css.Declaration, context: Context) {
      if (node.important) cssFail('!important is not supported.', context);
      const property = decodeIdent(node.property);
      const list = tokens(node.value);
      if (!list.length || list.some(n => n.type === 'Raw')) cssFail(`Invalid value for ${property}.`, context);
      css.walk(node.value, n => {
        if (n.type === 'Url' || n.type === 'Function' && !['rgb', 'rgba'].includes(decodeIdent(n.name))) {
          cssFail(`URLs and unsupported functions are forbidden in ${property}.`, context);
        }
      });
      const one = list.length === 1;
      const single = list[0]!;
      let valid = false;
      const keywords: Record<string, string[]> = {
        display: ['flex', 'block', 'none'], position: ['relative', 'absolute'], 'box-sizing': ['border-box'],
        'flex-direction': ['row', 'column'], 'flex-wrap': ['nowrap'],
        'align-items': ['flex-start', 'flex-end', 'center', 'stretch'],
        'align-self': ['auto', 'flex-start', 'flex-end', 'center', 'stretch'],
        'justify-content': ['flex-start'], 'font-weight': ['normal', 'bold'], 'font-style': ['normal'],
        'text-align': ['left', 'center', 'right'], 'white-space': ['nowrap'], 'line-height': ['normal'],
        'object-fit': ['fill'], overflow: ['visible', 'clip'], visibility: ['visible', 'hidden'], 'list-style': ['none'],
      };
      if (Object.hasOwn(keywords, property)) valid = one && ident(single, keywords[property]!);
      if (['left', 'top', 'gap', 'row-gap', 'column-gap', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'].includes(property)) valid = one && px(single);
      if (['margin', 'padding'].includes(property)) valid = list.length >= 1 && list.length <= 4 && list.every(n => px(n));
      if (['width', 'height'].includes(property)) valid = one && (px(single, true) || ident(single, ['auto']));
      if (property === 'font-size') valid = one && px(single, true);
      if (['min-width', 'min-height', 'overflow-clip-margin'].includes(property)) valid = one && (number(single) === 0 || px(single) && single.type === 'Dimension' && Number(single.value) === 0);
      if (property === 'flex') valid = list.length === 3 && number(list[0]!) === 0 && number(list[1]!) === 0 && ident(list[2]!, ['auto']);
      if (property === 'font-weight') valid ||= one && [400, 700].includes(number(single));
      if (property === 'z-index') valid = one && single.type === 'Number' && /^\+?\d+$/.test(single.value) && Number.isSafeInteger(number(single)) && number(single) >= 0;
      if (property === 'border') valid = one && (number(single) === 0 || ident(single, ['none']));
      if (['background-color', 'color'].includes(property)) {
        valid = one && (single.type === 'Hash' || ident(single, ['transparent']) || single.type === 'Function' && ['rgb', 'rgba'].includes(decodeIdent(single.name)));
        if (valid) {
          css.walk(node.value, child => {
            if (!['Value', 'Hash', 'Identifier', 'Function', 'Number', 'Percentage', 'Operator'].includes(child.type) || child.type === 'Identifier' && !ident(child, ['transparent'])) valid = false;
          });
          valid &&= css.lexer.matchProperty(property, node.value).error === null;
        }
      }
      if (property === 'font-family') {
        valid = list.every(n => n.type === 'String' || n.type === 'Identifier' && !['inherit', 'initial', 'unset', 'revert', 'revert-layer'].includes(decodeIdent(n.name)) || n.type === 'Operator' && n.value === ',')
          && css.lexer.matchProperty(property, node.value).error === null;
      }
      if (!valid) cssFail(`Unsupported CSS declaration: ${property}: ${css.generate(node.value)}`, context);
    }

    async function stylesheet(text: string, context: Context, directory: string, inline = false): Promise<string> {
      let tree: css.CssNode;
      try {
        tree = css.parse(text, { context: inline ? 'declarationList' : 'stylesheet', positions: true,
          onParseError: error => cssFail(`Invalid CSS: ${error.message}`, { ...context, line: (context.line ?? 1) + (error.line ?? 1) - 1 }),
        });
      } catch (error) {
        if (error instanceof SourceError) throw error;
        return cssFail(`Invalid CSS: ${String(error)}`, context);
      }
      const localContext = (node: css.CssNode): Context => ({ ...context, line: (context.line ?? 1) + (node.loc?.start.line ?? 1) - 1 });
      const declarations = (block: css.Block | css.DeclarationList) => {
        block.children.forEach(node => {
          if (node.type !== 'Declaration') cssFail('Only declarations are allowed in a rule.', localContext(node));
          declaration(node as css.Declaration, localContext(node));
        });
      };
      if (tree.type === 'DeclarationList') declarations(tree);
      else if (tree.type === 'StyleSheet') {
        for (const node of tree.children) {
          const ctx = localContext(node);
          if (node.type === 'Rule') {
            if (node.prelude.type !== 'SelectorList') cssFail('Invalid selector.', ctx);
            css.walk(node.prelude, selector => {
              if (!['SelectorList', 'Selector', 'TypeSelector', 'ClassSelector', 'IdSelector', 'Combinator'].includes(selector.type)) cssFail(`Unsupported selector component: ${selector.type}`, ctx);
              if (selector.type === 'Combinator' && ![' ', '>'].includes(selector.name)) cssFail('Only descendant and child combinators are allowed.', ctx);
              if (selector.type === 'TypeSelector' && !/^[a-z][a-z\d-]*$/i.test(selector.name)) cssFail('Only unescaped ASCII tag selectors are supported; universal and namespaced selectors are forbidden.', ctx);
              if ((selector.type === 'ClassSelector' || selector.type === 'IdSelector') && (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(selector.name) || css.ident.decode(selector.name) !== selector.name)) cssFail('Class/id selectors require simple unescaped ASCII identifiers.', ctx);
            });
            declarations(node.block);
          } else if (node.type === 'Atrule' && decodeIdent(node.name) === 'font-face' && !node.prelude && node.block) {
            const seen = new Set<string>();
            for (const descriptor of node.block.children) {
              if (descriptor.type !== 'Declaration') cssFail('Invalid @font-face descriptor.', ctx);
              const desc = descriptor as css.Declaration;
              const key = decodeIdent(desc.property);
              if (!['font-family', 'src', 'font-weight', 'font-style', 'font-display'].includes(key) || desc.important || seen.has(key)) cssFail(`Unsupported or repeated @font-face descriptor: ${key}`, ctx);
              seen.add(key);
              if (key === 'src') {
                const list = tokens(desc.value);
                if (!(list.length >= 1 && list.length <= 2 && list[0]?.type === 'Url')) cssFail('@font-face src requires one local URL, optionally followed by format().', ctx);
                const url = list[0] as css.Url;
                if (list.length === 2) {
                  const format = list[1]!;
                  if (format.type !== 'Function' || decodeIdent(format.name) !== 'format' || format.children.size !== 1) cssFail('Invalid font format().', ctx);
                  const argument = (format as css.FunctionNode).children.first!;
                  const formatValue = argument.type === 'String' ? argument.value : argument.type === 'Identifier' ? decodeIdent(argument.name) : '';
                  if (!['truetype', 'opentype', 'woff', 'woff2'].includes(formatValue)) cssFail('Unsupported font format().', ctx);
                }
                const resolved = await resource(url.value, directory, ['.ttf', '.otf', '.woff', '.woff2'], ctx);
                url.value = resolved.relative;
              } else if (key === 'font-display') {
                const list = tokens(desc.value);
                if (list.length !== 1 || !ident(list[0]!, ['block'])) cssFail('font-display must be block.', ctx);
              } else {
                declaration(desc, ctx);
                if (key === 'font-family' && tokens(desc.value).some(n => n.type === 'Operator')) cssFail('@font-face must name a single family.', ctx);
              }
            }
            if (!seen.has('font-family') || !seen.has('src')) cssFail('@font-face requires font-family and src.', ctx);
          } else cssFail('Only ordinary style rules and local @font-face are allowed.', ctx);
        }
      } else cssFail('Invalid CSS syntax tree.', context);
      // HTML raw-text style elements do not escape '<'; keep external strings from ending the element.
      return css.generate(tree).replaceAll('<', '\\3c ');
    }

    const document = parse5.parse(original, { sourceCodeLocationInfo: true, onParseError: error => {
      if (error.code !== 'missing-doctype') fail('E_HTML_INVALID', `Invalid HTML: ${error.code}`, { file: actualInput, line: error.startLine });
    } });
    const elements: Element[] = [];
    function visit(node: HtmlNode) {
      if (isElement(node)) elements.push(node);
      if ('childNodes' in node) node.childNodes.forEach(visit);
    }
    visit(document);
    const body = elements.find(node => node.tagName === 'body')!;
    const ids = new Set<string>();
    const htmlIds = new Set<string>();
    const roots: Element[] = [];
    for (const node of elements) {
      const ctx: Context = { file: actualInput, nodeId: attr(node, 'data-ui-id'), line: node.sourceCodeLocation?.startLine };
      if (!tags.has(node.tagName) || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') fail('E_HTML_UNSUPPORTED', `Unsupported HTML element: ${node.tagName}`, ctx);
      for (const attribute of node.attrs) {
        const name = attribute.name;
        if (structural.has(node.tagName) && name.startsWith('data-ui-')) fail('E_HTML_UNSUPPORTED', 'Document structural elements cannot carry data-ui-* export annotations.', ctx);
        const allowed = globalAttributes.has(name) || name === 'charset' && node.tagName === 'meta'
          || ['href', 'rel'].includes(name) && node.tagName === 'link'
          || ['src', 'alt'].includes(name) && node.tagName === 'img'
          || name === 'type' && node.tagName === 'button' && attribute.value.toLowerCase() === 'button';
        if (!allowed || attribute.namespace || attribute.prefix) fail('E_HTML_UNSUPPORTED', `Unsupported attribute: ${name}`, ctx);
      }
      if (node.tagName === 'meta' && attr(node, 'charset') === undefined) fail('E_HTML_UNSUPPORTED', 'Only meta charset is supported.', ctx);
      if (attr(node, 'data-ui-root') !== undefined) roots.push(node);
      const collection = attr(node, 'data-ui-collection');
      if (collection === 'tile') fail('E_TARGET_CAPABILITY', 'Tile collections are not supported by this target.', ctx);
      if (collection !== undefined && !['none', 'list'].includes(collection)) fail('E_HTML_UNSUPPORTED', 'data-ui-collection must be none or list.', ctx);
      const layout = attr(node, 'data-ui-layout');
      if (layout !== undefined && layout !== 'canvas') fail('E_TARGET_CAPABILITY', 'Only explicit canvas layout is supported; overlay is gated.', ctx);
      let inBody = false;
      for (let parent: HtmlNode | null = node.parentNode; parent; parent = 'parentNode' in parent ? parent.parentNode : null) if (parent === body) inBody = true;
      if (inBody && structural.has(node.tagName)) fail('E_HTML_UNSUPPORTED', 'Document structural elements must not appear inside the body export tree.', ctx);
      const id = attr(node, 'data-ui-id');
      if (inBody && !structural.has(node.tagName) && (!id || !id.trim())) fail('E_NODE_ID', 'Every exported body element needs a nonempty data-ui-id.', ctx);
      if (id !== undefined) {
        if (!id.trim() || ids.has(id)) fail('E_NODE_ID', `Empty or duplicate data-ui-id: ${id}`, ctx);
        ids.add(id);
      }
      const htmlId = attr(node, 'id');
      if (htmlId) {
        if (htmlIds.has(htmlId)) fail('E_NODE_ID', `Duplicate HTML id: ${htmlId}`, ctx);
        htmlIds.add(htmlId);
      }
      if (attr(node, 'style') !== undefined) await stylesheet(attr(node, 'style')!, ctx, rootDirectory, true);
      if (node.tagName === 'style') {
        const text = node.childNodes.map(child => child.nodeName === '#text' ? (child as parse5.DefaultTreeAdapterMap['textNode']).value : '').join('');
        const generated = await stylesheet(text, ctx, rootDirectory);
        node.childNodes = [{ nodeName: '#text', value: generated, parentNode: node }];
      }
      if (node.tagName === 'img') {
        const source = node.attrs.find(a => a.name === 'src');
        if (!source) fail('E_SOURCE_PATH', 'Images require a local src.', ctx);
        const resolved = await resource(source!.value, rootDirectory, ['.png', '.jpg', '.jpeg'], ctx);
        source!.value = resolved.relative;
      }
      if (node.tagName === 'link') {
        if (attr(node, 'rel')?.toLowerCase() !== 'stylesheet' || !attr(node, 'href')) fail('E_HTML_UNSUPPORTED', 'Only link rel=stylesheet with a local href is supported.', ctx);
        const resolved = await resource(attr(node, 'href')!, rootDirectory, ['.css'], ctx);
        const generated = await stylesheet(await readFile(resolved.file, 'utf8'), { file: resolved.file, line: 1 }, resolved.directory);
        node.tagName = 'style';
        node.nodeName = 'style';
        node.attrs = node.attrs.filter(a => !['rel', 'href'].includes(a.name));
        node.childNodes = [{ nodeName: '#text', value: generated, parentNode: node }];
      }
    }
    const bodyElements = body.childNodes.filter(isElement);
    if (roots.length !== 1 || roots[0]?.parentNode !== body || structural.has(roots[0]?.tagName ?? '') || bodyElements.length !== 1 || bodyElements[0] !== roots[0]) {
      fail('E_ROOT', 'Exactly one data-ui-root is required, and it must be the sole direct body element.', { file: actualInput });
    }
    if (body.childNodes.some(node => node.nodeName === '#text' && (node as parse5.DefaultTreeAdapterMap['textNode']).value.trim())) fail('E_ROOT', 'Text outside the export root is not allowed.', { file: actualInput });
    return { html: parse5.serialize(document), rootDirectory, diagnostics: [] };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError([{ code: 'E_SOURCE_READ', message: `Unable to load source: ${String(error)}`, file: input }]);
  }
}
