/**
 * Tile-aware contrast (spec: docs/superpowers/specs/2026-11-05-tile-aware-contrast.md). Each case
 * sits well away from the rule's cut-offs (80 / 35 / 10 %, 1.1:1, 75 %) so renderer differences
 * cannot flip it.
 */
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contrast, openPage, tileContrast } from '../src/browser.ts';
import { checkSvg, DEFAULTS, type CheckReport } from '../src/check.ts';
import { main } from '../src/cli.ts';
import { collectSvgs } from '../src/files.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const svgOf = (name: string) => collectSvgs([join(FIXTURES, `${name}.svg`)])[0].svg;
const S = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`;
const disc = (r: number) => `<circle cx="16" cy="16" r="${r}" fill="#ffffff"/>`;
// Chrome renders a 32 px gradient as a few shades of near-equal count, so the tile colour (the modal
// shade) only wins when the mark's own colour is rarer than one shade.
const grad = (a: string, b: string, r = 7) => S(`<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="32" height="32" fill="url(#g)"/>${disc(r)}`);
const INLINE = {
  speck: S('<rect width="32" height="32" fill="#3c3c3c"/><rect x="14" y="14" width="3" height="4" fill="#ffffff"/>'),
  flatGradient: grad('#020617', '#030819'),
  strongGradient: grad('#020617', '#64748b'),
  flatGradientBigMark: grad('#020617', '#030819', 10),
  tie: S('<rect width="16" height="32" fill="#0b1120"/><rect x="16" width="16" height="32" fill="#020617"/><circle cx="16" cy="16" r="9" fill="#ffffff"/>'),
  schemeSwitch: S('<style>.t{fill:#f8fafc}.m{fill:#0f172a}@media (prefers-color-scheme: dark){.t{fill:#020617}.m{fill:#f0f9ff}}</style><rect class="t" width="32" height="32" rx="6"/><circle class="m" cx="16" cy="16" r="10"/>'),
  nearWhite: S('<rect width="32" height="32" rx="6" fill="#f8fafc"/><circle cx="16" cy="16" r="10" fill="#0f172a"/>'),
};

let page: Page;
let close: () => Promise<void>;
beforeAll(async () => ({ page, close } = await openPage()));
afterAll(async () => close?.());

const run = (svg: string) => tileContrast(page, svg, 32, ['#ffffff', '#3c3c3c'], 3);

describe('tileContrast: detection and measurement', () => {
  it('tile-good: detected; marks read on the tile; the edge blends only on dark', async () => {
    const t = await run(svgOf('tile-good'));
    expect(t).not.toBeNull();
    expect(t!.info.colour).toBe('#020617');
    expect(t!.info.marks).toBeGreaterThan(0.2);
    expect(t!.info.marks).toBeLessThan(0.45);
    expect(t!.info.opaque).toBeGreaterThan(0.9);
    for (const r of t!.results) expect(r.share).toBeGreaterThanOrEqual(0.9);
    expect(t!.results[0].share).toBe(t!.results[1].share);
    expect(t!.results[0].tile.colour).toBe('#020617');
    expect(t!.results[0].tile.edgeShare).toBeGreaterThanOrEqual(0.75);
    expect(t!.results[1].tile.edgeShare).toBeLessThan(0.75);
  });

  it('tile-bad: detected, and the marks do not read on the tile', async () => {
    const t = await run(svgOf('tile-bad'));
    expect(t).not.toBeNull();
    for (const r of t!.results) expect(r.share).toBeLessThan(0.1);
  });

  it.each([
    ['tile-cutout (a hole)', () => svgOf('tile-cutout')],
    ['a speck on a square (marks < 10 %)', () => INLINE.speck],
    ['a strong gradient', () => INLINE.strongGradient],
    ['a near-flat gradient whose mark outnumbers each of its shades', () => INLINE.flatGradientBigMark],
    ...['good', 'low-contrast', 'scheme-switch', 'text'].map((n) => [`untiled fixture ${n}`, () => svgOf(n)] as [string, () => string]),
  ])('not a tile: %s', async (_, svg) => {
    expect(await run(svg())).toBeNull();
  });

  it('a near-flat gradient is a tile', async () => {
    expect(await run(INLINE.flatGradient)).not.toBeNull();
  });

  it('a tie between two colours goes to the lower luminance', async () => {
    expect((await run(INLINE.tie))?.info.colour).toBe('#020617');
  });

  it('a near-white tile is detected, and its edge blends on white', async () => {
    const t = await run(INLINE.nearWhite);
    expect(t?.info.colour).toBe('#f8fafc');
    expect(t!.results[0].tile.edgeShare).toBeLessThan(0.75);
    expect(t!.results[0].share).toBeGreaterThanOrEqual(0.9);
  });
});

describe('check on tiles', () => {
  const quiet = () => {};
  const check = (svg: string, opts = DEFAULTS) => checkSvg(page, 'x.svg', svg, opts);
  const of = (r: CheckReport, level: string, gate: string) => r.findings.filter((f) => f.level === level && f.gate === gate).map((f) => f.text);

  it('tile-good passes, with one tile-edge warning per dark ground and none on light', async () => {
    const r = await check(svgOf('tile-good'));
    expect(r.ok, JSON.stringify(r.findings, null, 2)).toBe(true);
    const edge = of(r, 'warn', 'tile-edge');
    expect(edge).toHaveLength(2);
    expect(edge[0]).toMatch(/^dark #3c3c3c: the tile's edge blends into the tab \(\d+% at >= 3:1\); the icon reads as its marks alone$/);
    expect(edge[1]).toMatch(/^dark \(inactive tab\) #1f2020: /);
    expect(of(r, 'info', 'contrast')[0]).toMatch(/^light #ffffff: \d+% of the marks at >= 3:1 against the tile #020617 \(median [\d.]+:1, need 75%\)$/);
  });

  it('tile-bad fails light AND dark, where the whole-canvas 0.2.0 rule passes light', async () => {
    const r = await check(svgOf('tile-bad'));
    const fails = of(r, 'fail', 'contrast');
    expect(fails.some((t) => t.startsWith('light #ffffff'))).toBe(true);
    expect(fails.some((t) => t.startsWith('dark #3c3c3c'))).toBe(true);
    const [old] = await contrast(page, svgOf('tile-bad'), 32, ['#ffffff'], 3);
    expect(old.share).toBeGreaterThanOrEqual(0.75);
  });

  it('the CLI exits 1 on tile-bad and 0 on tile-good', async () => {
    expect(await main(['check', join(FIXTURES, 'tile-bad.svg')], quiet, quiet)).toBe(1);
    expect(await main(['check', join(FIXTURES, 'tile-good.svg')], quiet, quiet)).toBe(0);
  });

  it('on white tabs only, tile-bad still fails (a whole-canvas measure passes it there; CI relies on this)', async () => {
    expect(await main(['check', '--dark', '#ffffff', join(FIXTURES, 'tile-bad.svg')], quiet, quiet)).toBe(1);
    const [old] = await contrast(page, svgOf('tile-bad'), 32, ['#ffffff'], 3);
    expect(old.share).toBeGreaterThanOrEqual(0.75);
  });

  it('--json carries the tile', async () => {
    let printed = '';
    await main(['check', '--json', join(FIXTURES, 'tile-good.svg')], (s: string) => { printed += s; }, quiet);
    const [report] = JSON.parse(printed) as CheckReport[];
    expect(report.contrast!.length).toBe(4);
    for (const c of report.contrast!) expect(c.tile?.colour).toBe('#020617');
  });

  it('a scheme-switching tile is detected per scheme', async () => {
    const r = await check(INLINE.schemeSwitch);
    expect(r.ok, JSON.stringify(r.findings, null, 2)).toBe(true);
    expect(r.contrast!.map((c) => c.tile?.colour)).toEqual(['#f8fafc', '#f8fafc', '#020617', '#020617']);
  });

  it('on a plate, a tiled result is gated like any plate stop (every stop is hard)', async () => {
    const r = await check(svgOf('tile-bad'), { ...DEFAULTS, plate: '#ffffff' });
    const plate = r.findings.filter((f) => f.gate === 'contrast' && f.text.startsWith('plate'));
    expect(plate).toHaveLength(1);
    expect(plate[0].level).toBe('fail');
    expect(plate[0].text).toContain('against the tile #020617');
  });

  it('a near-white tile passes, warning that its edge blends on light', async () => {
    const r = await check(INLINE.nearWhite);
    expect(r.ok, JSON.stringify(r.findings, null, 2)).toBe(true);
    expect(of(r, 'warn', 'tile-edge')[0]).toMatch(/^light #ffffff: /);
  });
});
