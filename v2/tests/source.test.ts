import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'parse5';
import { loadSource, SourceError } from '../src/source.js';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture(html: string, files: Record<string, string | Uint8Array> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'umg-source-'));
  temporary.push(directory);
  for (const [name, content] of Object.entries({ 'index.html': html, ...files })) {
    const destination = path.join(directory, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  return { directory, file: path.join(directory, 'index.html') };
}
const document = (inside = '', head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Test</title>${head}</head><body><div data-ui-root data-ui-id="root">${inside}</div></body></html>`;
async function rejects(html: string, code: string, files: Record<string, string | Uint8Array> = {}) {
  const { file } = await fixture(html, files);
  try { await loadSource(file); expect.fail('Expected SourceError'); }
  catch (error) {
    expect(error).toBeInstanceOf(SourceError);
    const diagnostics = (error as SourceError).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]?.code).toBe(code);
    expect(diagnostics[0]?.file).toBeTruthy();
    expect(diagnostics[0]?.message).toBeTruthy();
  }
}

describe('loadSource', () => {
  it.each([String.raw`.foo\#bar`, String.raw`.foo\,bar`, String.raw`#r\6fot`, String.raw`d\69v`])('rejects escaped selector %s before cascade inference', async selector => {
    await rejects(document('', `<style>${selector}{width:100px}</style>`), 'E_CSS_UNSUPPORTED');
  });
  it.each(['<style>div{width:10px}</style>', '<meta charset="utf-8">', '<title>Wrong location</title>'])('rejects document structures inside export tree: %s', async markup => {
    await rejects(document(markup), 'E_HTML_UNSUPPORTED');
  });
  it('rejects export attributes on document structures', async () => {
    await rejects(document().replace('<head>', '<head data-ui-id="Head">'), 'E_HTML_UNSUPPORTED');
  });
  it('exposes a stable diagnostic code in the CLI error message', async () => {
    const { file } = await fixture(document('<script>alert(1)</script>'));
    await expect(loadSource(file)).rejects.toThrow('E_HTML_UNSUPPORTED');
  });
  it('preserves valid document structure, text and attributes without injecting reset', async () => {
    const { directory, file } = await fixture(document('<span data-ui-id="label" class="label" style="color:#fff;font-size:12px">A &amp; B</span><img data-ui-id="image" src="assets/icon.png" alt="icon">', '<style>.label { display:block; margin:0px; }</style>'), { 'assets/icon.png': new Uint8Array([137, 80, 78, 71]) });
    const result = await loadSource(file);
    expect(result.rootDirectory).toBe(await realpath(directory));
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('A &amp; B');
    expect(result.html).toContain('data-ui-root=""');
    expect(result.html).toContain('src="assets/icon.png"');
    expect(result.html).toContain('<title>Test</title>');
    expect(result.html).not.toContain('box-sizing');
    expect(parse(result.html).childNodes.length).toBe(2);
  });

  it('inlines external CSS and rewrites font URLs relative to the HTML root', async () => {
    const { file } = await fixture(document('<p data-ui-id="text">Hello</p>', '<link rel="stylesheet" href="css/main.css">'), {
      'css/main.css': '@font-face { font-family:"Local Font";src:url(../fonts/test.ttf) format("truetype");font-weight:400;font-style:normal;font-display:block } div > p {font-family:"Local Font",sans-serif;color:rgba(1,2,3,0.5)}',
      'fonts/test.ttf': new Uint8Array([0, 1, 0, 0]),
    });
    const result = await loadSource(file);
    expect(result.html).not.toContain('<link');
    expect(result.html).toContain('<style>');
    expect(result.html).toContain('url(fonts/test.ttf)');
    expect(result.html).not.toContain('../fonts');
    expect(result.html).toContain('font-display:block');
  });

  it('resolves fonts against the requested CSS location for in-tree symlinks', async () => {
    const { directory, file } = await fixture(document('', '<link rel="stylesheet" href="css/alias.css">'), {
      'shared/actual.css': '@font-face{font-family:X;src:url(font.ttf)}',
      'css/font.ttf': 'fake',
    });
    await symlink(path.join(directory, 'shared/actual.css'), path.join(directory, 'css/alias.css'));
    const result = await loadSource(file);
    expect(result.html).toContain('url(css/font.ttf)');
  });

  it('accepts all supported declaration families in static CSS', async () => {
    const declarations = 'display:flex;position:absolute;left:0px;top:2px;width:12px;height:auto;box-sizing:border-box;margin:0px 1px 2px 3px;padding:0px;padding-left:1px;margin-top:2px;gap:0px;row-gap:1px;column-gap:2px;flex-direction:column;flex-wrap:nowrap;flex:0 0 auto;align-items:stretch;align-self:auto;justify-content:flex-start;min-width:0;min-height:0px;background-color:#ff00aacc;color:rgb(1,2,3);font-family:"My Font", Arial,sans-serif;font-size:16px;font-weight:700;font-style:normal;text-align:center;white-space:nowrap;line-height:normal;object-fit:fill;overflow:clip;overflow-clip-margin:0;visibility:hidden;z-index:12;list-style:none;border:0';
    const { file } = await fixture(document('', `<style>div.root > p, #sample span.name { ${declarations} }</style>`));
    await expect(loadSource(file)).resolves.toMatchObject({ diagnostics: [] });
  });

  it.each([
    'display:grid', 'display:contents', 'position:fixed', 'left:-1px', 'top:1%', 'width:0px', 'width:10%', 'height:0',
    'margin:auto', 'margin:0', 'margin:1px 2px 3px 4px 5px', 'padding:-1px', 'gap:1em', 'box-sizing:content-box',
    'flex-direction:row-reverse', 'flex-wrap:wrap', 'flex:1', 'flex:0 1 auto', 'justify-content:center', 'align-items:baseline',
    'min-width:auto', 'min-height:1px', 'color:red', 'color:currentColor', 'color:var(--color)', 'color:#xyz', 'color:rgb(foo)',
    'background-color:url(x.png)', 'font-family:var(--font)', 'font-size:0px', 'font-weight:500', 'font-style:italic',
    'text-align:justify', 'white-space:normal', 'line-height:20px', 'object-fit:cover', 'overflow:hidden',
    'overflow-clip-margin:1px', 'visibility:collapse', 'z-index:-1', 'z-index:1.5', 'list-style:disc', 'border:1px solid #fff',
    'border-radius:1px', 'transform:scale(2)', '--custom:1px', 'color:#fff!important', 'width:calc(1px + 2px)',
    'background-image:url(https://example.com/a.png)', 'font-family:inherit', 'padding:1px garbage', 'constructor:foo', '__proto__:foo',
  ])('rejects unsupported declaration even in an unmatched rule: %s', async declaration => {
    await rejects(document('', `<style>.never-matches { ${declaration} }</style>`), 'E_CSS_UNSUPPORTED');
  });

  it.each(['p:hover', 'p::before', '[id=x]', '*', '.x + .y', '.x ~ .y', 'svg|div', ':root', ':is(div)', 'div:has(p)'])('rejects author selector %s', async selector => {
    await rejects(document('', `<style>${selector}{color:#fff}</style>`), 'E_CSS_UNSUPPORTED');
  });
  it.each(['@import "x.css";', '@media screen {div{color:#fff}}', '@supports(display:flex){div{display:flex}}', '@keyframes x {from{left:0px}}', '@layer foo;', 'div{color:}'])('rejects unsupported or malformed CSS %s', async rule => {
    await rejects(document('', `<style>${rule}</style>`), 'E_CSS_UNSUPPORTED');
  });
  it('validates inline declarations', async () => {
    await rejects(document('<p data-ui-id="text" style="width:-1px">Hi</p>'), 'E_CSS_UNSUPPORTED');
  });
  it('validates unmatched rules in external stylesheets with CSS file diagnostics', async () => {
    const { file, directory } = await fixture(document('', '<link rel="stylesheet" href="bad.css">'), { 'bad.css': '.unused { border-radius:10px }' });
    await expect(loadSource(file)).rejects.toMatchObject({ diagnostics: [{ code: 'E_CSS_UNSUPPORTED', file: await realpath(path.join(directory, 'bad.css')), line: 1 }] });
  });

  it.each(['script', 'iframe', 'object', 'embed', 'form', 'svg', 'canvas', 'input', 'a', 'video'])('rejects forbidden element %s', async tag => {
    await rejects(document(`<${tag} data-ui-id="bad"></${tag}>`), 'E_HTML_UNSUPPORTED');
  });
  it.each(['onclick="alert(1)"', 'onload="x()"', 'data-other="x"', 'hidden', 'aria-label="x"', 'title="x"'])('rejects unsupported attributes %s', async attribute => {
    await rejects(document(`<p data-ui-id="text" ${attribute}>Hi</p>`), 'E_HTML_UNSUPPORTED');
  });
  it('rejects meta refresh and base', async () => {
    await rejects(document('', '<meta http-equiv="refresh" content="0;url=https://example.com">'), 'E_HTML_UNSUPPORTED');
    await rejects(document('', '<base href="https://example.com/">'), 'E_HTML_UNSUPPORTED');
  });
  it('rejects javascript URLs and unauthorized link types', async () => {
    await rejects(document('<img data-ui-id="image" src="javascript:alert(1)">'), 'E_SOURCE_PATH');
    await rejects(document('', '<link rel="stylesheet" href="javascript:alert(1)">'), 'E_SOURCE_PATH');
    await rejects(document('', '<link rel="preload" href="style.css">'), 'E_HTML_UNSUPPORTED');
  });
  it('requires button type to be button if present', async () => {
    await rejects(document('<button data-ui-id="b" type="submit">Go</button>'), 'E_HTML_UNSUPPORTED');
  });
  it('requires unique nonempty export IDs and unique HTML IDs', async () => {
    await rejects(document('<p>No id</p>'), 'E_NODE_ID');
    await rejects(document('<p data-ui-id="root">Duplicate</p>'), 'E_NODE_ID');
    await rejects(document('<p data-ui-id="  ">Blank</p>'), 'E_NODE_ID');
    await rejects(document('<p data-ui-id="one" id="same"></p><p data-ui-id="two" id="same"></p>'), 'E_NODE_ID');
  });
  it('requires one export root as the sole direct body element', async () => {
    await rejects('<body><div data-ui-id="one"></div></body>', 'E_ROOT');
    await rejects('<body><div data-ui-root data-ui-id="one"></div><div data-ui-root data-ui-id="two"></div></body>', 'E_ROOT');
    await rejects(document('<p data-ui-root data-ui-id="nested"></p>'), 'E_ROOT');
    await rejects('<body><div data-ui-id="outside"><div data-ui-root data-ui-id="inside"></div></div></body>', 'E_ROOT');
    await rejects('<body>outside<div data-ui-root data-ui-id="root"></div></body>', 'E_ROOT');
  });
  it('gates tile/overlay and validates collection values', async () => {
    await rejects(document('<ul data-ui-id="list" data-ui-collection="tile"></ul>'), 'E_TARGET_CAPABILITY');
    await rejects(document('<div data-ui-id="x" data-ui-layout="overlay"></div>'), 'E_TARGET_CAPABILITY');
    await rejects(document('<div data-ui-id="x" data-ui-collection="grid"></div>'), 'E_HTML_UNSUPPORTED');
    const { file } = await fixture(document('<ul data-ui-id="list" data-ui-collection="list" data-ui-layout="canvas"><li data-ui-id="item" data-ui-entry data-ui-field="label">Hello</li></ul>'));
    await expect(loadSource(file)).resolves.toMatchObject({ diagnostics: [] });
  });

  it.each(['../outside.png', '%2e%2e/outside.png', '/assets/a.png', '//example.com/a.png', 'https://example.com/a.png', 'data:image/png,x', 'file:///tmp/a.png', 'a.png?x=1', 'a.png#hash', 'a.gif', 'a.svg', 'a.webp', 'assets\\a.png'])('rejects image path %s', async source => {
    await rejects(document(`<img data-ui-id="image" src="${source}">`), 'E_SOURCE_PATH');
  });
  it('rejects missing assets and wraps filesystem failures', async () => {
    await rejects(document('<img data-ui-id="image" src="missing.png">'), 'E_SOURCE_READ');
    const { file } = await fixture(document());
    await expect(loadSource(`${file}.missing`)).rejects.toBeInstanceOf(SourceError);
  });
  it('rejects an input HTML symlink escaping its containing directory', async () => {
    const outside = await fixture(document());
    const target = await fixture(document());
    const alias = path.join(target.directory, 'alias.html');
    await symlink(outside.file, alias);
    await expect(loadSource(alias)).rejects.toMatchObject({ diagnostics: [{ code: 'E_SOURCE_PATH' }] });
  });
  it('rejects asset symlinks escaping the root', async () => {
    const outside = await fixture(document(), { 'secret.png': 'fake' });
    const target = await fixture(document('<img data-ui-id="image" src="escape.png">'));
    await symlink(path.join(outside.directory, 'secret.png'), path.join(target.directory, 'escape.png'));
    await expect(loadSource(target.file)).rejects.toMatchObject({ diagnostics: [{ code: 'E_SOURCE_PATH' }] });
  });
  it('rejects stylesheet and font path traversal and symlink escape', async () => {
    await rejects(document('', '<link rel="stylesheet" href="../escape.css">'), 'E_SOURCE_PATH');
    await rejects(document('', '<style>@font-face{font-family:X;src:url(../escape.ttf)}</style>'), 'E_SOURCE_PATH');
    const outside = await fixture(document(), { 'escape.css': 'div{display:flex}', 'escape.ttf': 'fake' });
    const target = await fixture(document('', '<link rel="stylesheet" href="escape.css">'));
    await symlink(path.join(outside.directory, 'escape.css'), path.join(target.directory, 'escape.css'));
    await expect(loadSource(target.file)).rejects.toMatchObject({ diagnostics: [{ code: 'E_SOURCE_PATH' }] });
    await writeFile(target.file, document('', '<style>@font-face{font-family:X;src:url(escape.ttf)}</style>'));
    await symlink(path.join(outside.directory, 'escape.ttf'), path.join(target.directory, 'escape.ttf'));
    await expect(loadSource(target.file)).rejects.toMatchObject({ diagnostics: [{ code: 'E_SOURCE_PATH' }] });
  });
  it.each([
    ['src:local("Arial")', 'E_CSS_UNSUPPORTED'], ['src:url(font.ttf),url(font.ttf)', 'E_CSS_UNSUPPORTED'],
    ['src:url(https://example.com/font.ttf)', 'E_SOURCE_PATH'], ['src:url(/assets/font.ttf)', 'E_SOURCE_PATH'],
    ['src:url(font.ttf?x)', 'E_SOURCE_PATH'], ['src:url(font.eot)', 'E_SOURCE_PATH'],
    ['src:url(font.ttf);font-display:swap', 'E_CSS_UNSUPPORTED'], ['src:url(font.ttf);font-weight:300', 'E_CSS_UNSUPPORTED'],
    ['src:url(font.ttf);unicode-range:U+0-FF', 'E_CSS_UNSUPPORTED'], ['src:url(font.ttf)!important', 'E_CSS_UNSUPPORTED'],
    ['src:url(font.ttf) format("svg")', 'E_CSS_UNSUPPORTED'],
  ])('restricts font face: %s', async (descriptor, code) => {
    await rejects(document('', `<style>@font-face{font-family:X;${descriptor}}</style>`), code, { 'font.ttf': 'fake' });
  });
  it('does not let external CSS quoted strings terminate inline style elements', async () => {
    const { file } = await fixture(document('', '<link rel="stylesheet" href="style.css">'), { 'style.css': 'div{font-family:"</style><script>alert(1)</script>"}' });
    const result = await loadSource(file);
    expect(result.html).not.toContain('<script>');
    expect(result.html.match(/<\/style>/g)).toHaveLength(1);
  });
});
