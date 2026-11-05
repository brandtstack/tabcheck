/**
 * Every gate is proven red. A green gate that has never been red proves nothing, so each fixture
 * is a mutation with a known answer: a control that passes is a broken gate.
 */
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPage, tile } from '../src/browser.ts';
import { checkSvg, DEFAULTS, type CheckReport } from '../src/check.ts';
import { main } from '../src/cli.ts';
import { exportSet } from '../src/export.ts';
import { assertAsset, collectSvgs } from '../src/files.ts';
import { renderSheet } from '../src/sheet.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const fixture = (name: string) => collectSvgs([join(FIXTURES, `${name}.svg`)])[0];
const failedGates = (r: CheckReport) => [...new Set(r.findings.filter((f) => f.level === 'fail').map((f) => f.gate))];
const tmp = () => mkdtempSync(join(tmpdir(), 'tabcheck-test-'));

let page: Page;
let close: () => Promise<void>;
beforeAll(async () => ({ page, close } = await openPage()));
afterAll(async () => close?.());

describe('check: each fixture gets its known answer', () => {
  it('every fixture has an expectation', () => {
    const names = readdirSync(FIXTURES).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')).sort();
    expect(names).toEqual(['bad-xml', 'blank', 'good', 'low-contrast', 'scheme-switch', 'text', 'tile-bad', 'tile-cutout', 'tile-good', 'tile-thin']);
  });

  it.each([
    ['good', null],
    // dark-on-dark unless prefers-color-scheme really reaches the image
    ['scheme-switch', null],
    // the control: `--` inside an XML comment, which renders a blank favicon
    ['bad-xml', 'xml'],
    ['blank', 'blank'],
    ['text', 'no-text'],
    ['low-contrast', 'contrast'],
    // tile-aware: marks judged against their tile; a hole means no tile, so the dark tile fails dark
    ['tile-good', null],
    ['tile-thin', null],
    ['tile-bad', 'contrast'],
    ['tile-cutout', 'contrast'],
  ] as const)('%s → %s', async (name, gate) => {
    const f = fixture(name);
    const r = await checkSvg(page, f.file, f.svg, DEFAULTS);
    if (gate === null) expect(r.ok, JSON.stringify(r.findings, null, 2)).toBe(true);
    else expect(failedGates(r)).toContain(gate);
  });

  it('judges a dark plate with the mark\'s dark-scheme variant (auto), and fails it under light', async () => {
    const f = fixture('scheme-switch');
    expect((await checkSvg(page, f.file, f.svg, { ...DEFAULTS, plate: '#1b2a4a', plateScheme: 'auto' })).ok).toBe(true);
    expect((await checkSvg(page, f.file, f.svg, { ...DEFAULTS, plate: '#1b2a4a', plateScheme: 'light' })).ok).toBe(false);
  });

  it('static rules: foreignObject, image, external href, non-square and missing viewBox', async () => {
    const cases: [string, string][] = [
      ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><foreignObject width="64" height="64"/><circle cx="32" cy="32" r="30"/></svg>', 'no-foreign'],
      ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><image href="data:," width="64" height="64"/><circle cx="32" cy="32" r="30"/></svg>', 'no-raster'],
      ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>@import url("https://example.com/x.css");</style><circle cx="32" cy="32" r="30"/></svg>', 'no-external'],
      ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><circle cx="32" cy="16" r="15"/></svg>', 'viewbox'],
      ['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30"/></svg>', 'viewbox'],
    ];
    for (const [svg, gate] of cases) expect(failedGates(await checkSvg(page, 'inline.svg', svg, DEFAULTS)), svg).toContain(gate);
  });
});

describe('an untrusted SVG cannot reach the network', () => {
  let server: Server;
  let hits = 0;
  let hostile = '';
  beforeAll(async () => {
    server = createServer((_req, res) => { hits++; res.end('x'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    hostile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><script>fetch('${url}/script')</script><style>@import url("${url}/import.css");</style><image href="${url}/image.png" width="64" height="64"/><circle cx="32" cy="32" r="30" fill="#e4572e"/></svg>`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('is refused by the static gates', async () => {
    const gates = failedGates(await checkSvg(page, 'hostile.svg', hostile, DEFAULTS));
    expect(gates).toEqual(expect.arrayContaining(['no-raster', 'no-external']));
  });

  it('makes no request through check, tile or sheet (the listener is reachable, as the control shows)', async () => {
    await checkSvg(page, 'hostile.svg', hostile, DEFAULTS);
    await tile(page, hostile, 64, null);
    await renderSheet(page, [{ file: 'hostile.svg', name: 'hostile', svg: hostile }], { out: join(tmp(), 'sheet.png'), pngs: false, light: DEFAULTS.light, dark: DEFAULTS.dark });
    expect(hits).toBe(0);
    // control: the listener does answer a request from outside the page
    const port = (server.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}/control`);
    expect(hits).toBe(1);
  });

  // ⚠️ The test above stays green with the network block removed: Chromium already gives an SVG
  // drawn as an image no network (measured 2026-11-05). This one proves the second layer on its
  // own: a request made by the page itself, which only the block stops.
  it('refuses a request made by the page itself (the second layer)', async () => {
    const before = hits;
    const port = (server.address() as { port: number }).port;
    const outcome = await page.evaluate((u) => fetch(u).then(() => 'reached', () => 'refused'), `http://127.0.0.1:${port}/page`);
    expect(outcome).toBe('refused');
    expect(hits).toBe(before);
  });
});

describe('export: the whole set or nothing', () => {
  const opts = (out: string, plate: string) => ({ out, plate, scheme: 'dark' as const, fill: 0.72, check: DEFAULTS });

  it.each([
    ['blank master', 'blank', '#1b2a4a'],
    ['mark that fails its plate', 'good', '#e4572e'],
  ])('refuses a %s and writes nothing', async (_label, name, plate) => {
    const out = join(tmp(), 'set');
    const f = fixture(name);
    const r = await exportSet(page, f, f, opts(out, plate));
    expect(r.ok).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it('writes every file of the set for a passing master', async () => {
    const out = join(tmp(), 'set');
    const f = fixture('good');
    const r = await exportSet(page, f, f, opts(out, '#1b2a4a'));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(readdirSync(out).sort()).toEqual(['apple-touch-icon.png', 'favicon.ico', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest-icons.json']);
    const ico = readFileSync(join(out, 'favicon.ico'));
    expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]); // an icon, three frames
    expect(statSync(join(out, 'icon-512.png')).size).toBeGreaterThan(1024);
  });
});

describe('the size floor', () => {
  it.each([
    ['icon-512.png', 68, true], // a 1×1 PNG from printf
    ['icon-512.png', 4096, false],
    ['favicon.svg', 6, true], // `data:,`
  ] as const)('%s at %i bytes: refused=%s', (path, bytes, refused) => {
    const run = () => assertAsset(path, Buffer.alloc(bytes, 1));
    if (refused) expect(run).toThrow();
    else expect(run).not.toThrow();
  });
});

describe('cli exit codes', () => {
  const quiet = () => {};
  it('0 on a pass, 1 on a gate failure, 2 on usage and environment errors', async () => {
    expect(await main(['check', join(FIXTURES, 'good.svg')], quiet, quiet)).toBe(0);
    expect(await main(['check', join(FIXTURES, 'low-contrast.svg')], quiet, quiet)).toBe(1);
    expect(await main(['check'], quiet, quiet)).toBe(2);
    expect(await main(['check', join(FIXTURES, 'missing.svg')], quiet, quiet)).toBe(2);
    expect(await main(['check', '--min-share', 'lots', join(FIXTURES, 'good.svg')], quiet, quiet)).toBe(2);
    expect(await main(['check', '--nope', join(FIXTURES, 'good.svg')], quiet, quiet)).toBe(2);
    expect(await main(['check', '--browser', '/nonexistent/chrome', join(FIXTURES, 'good.svg')], quiet, quiet)).toBe(2);
    expect(await main(['frobnicate'], quiet, quiet)).toBe(2);
  });

  it('--json prints a parseable report', async () => {
    let printed = '';
    await main(['check', '--json', join(FIXTURES, 'good.svg')], (s: string) => { printed += s; }, quiet);
    const [report] = JSON.parse(printed) as CheckReport[];
    expect(report.ok).toBe(true);
    expect(report.maskableSize).toBeGreaterThan(300);
  });

  it('sheet writes the sheet and one folder of rasters per concept', async () => {
    const dir = tmp();
    const svgs = join(dir, 'in');
    const out = join(dir, 'sheet.png');
    // a folder with two concepts
    for (const n of ['good', 'scheme-switch']) {
      const target = join(svgs, `${n}.svg`);
      await import('node:fs').then((fs) => fs.mkdirSync(svgs, { recursive: true }));
      writeFileSync(target, fixture(n).svg);
    }
    expect(await main(['sheet', svgs, '--out', out, '--plate', '#1b2a4a'], quiet, quiet)).toBe(0);
    expect(statSync(out).size).toBeGreaterThan(20_000);
    expect(readdirSync(join(dir, 'sheet')).sort()).toEqual(['good', 'scheme-switch']);
    expect(readdirSync(join(dir, 'sheet', 'good'))).toHaveLength(10);
  });
});
