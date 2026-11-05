/**
 * Tile-aware contrast (spec: docs/superpowers/specs/2026-11-05-tile-aware-contrast.md). Each case
 * sits well away from the rule's cut-offs (80 / 35 / 10 %, 1.1:1, 75 %) so renderer differences
 * cannot flip it.
 */
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPage, tileContrast } from '../src/browser.ts';
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
