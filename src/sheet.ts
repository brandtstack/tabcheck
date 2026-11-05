/**
 * One contact sheet for a family of concepts: each row is one SVG at 180/48/32/16 px on a light
 * tab strip and a dark one (each rendered under its own prefers-color-scheme), plus the 16 px
 * render blown up ×8 nearest-neighbour, which is the only honest view of a favicon. With a plate,
 * two more cells show the installed icon: an iOS rounded square and an Android circle mask at the
 * maskable size derived from the drawing.
 *
 * A `<name>.favicon.svg` beside `<name>.svg` draws that concept's 16 px cells only.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright-core';
import { analyse, compose, resetPage, setScheme, tile, type Scheme } from './browser.ts';
import { splitColours } from './colours.ts';
import { DEFAULT_FILL, fitByInk, fitMaskable } from './geometry.ts';
import { plateSchemeFor } from './check.ts';
import { intentOf, type SvgFile } from './files.ts';

export interface SheetOptions {
  out: string;
  plate?: string;
  title?: string;
  /** Also write every raster to <out-without-.png>/<concept>/<scheme>-<size>.png. */
  pngs: boolean;
  light: string[];
  dark: string[];
}

const SIZES = [16, 32, 48, 180, 512];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const letter = (i: number) => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(Math.floor(i / 26)) : '');

export async function renderSheet(page: Page, all: SvgFile[], opts: SheetOptions): Promise<{ concepts: number; broken: string[] }> {
  const favicons = new Map(all.filter((c) => c.name.endsWith('.favicon')).map((c) => [c.name.replace(/\.favicon$/, ''), c.svg]));
  const concepts = all.filter((c) => !(c.name.endsWith('.favicon') && all.some((m) => m.name === c.name.replace(/\.favicon$/, ''))));
  const GROUND: Record<Scheme, string> = { light: opts.light[0], dark: opts.dark[0] };
  const STRIP: Record<Scheme, string> = { light: opts.light[1] ?? opts.light[0], dark: opts.dark[1] ?? opts.dark[0] };
  const rows: string[] = [];
  const brokenNames: string[] = [];

  for (const [i, c] of concepts.entries()) {
    const cells: Record<Scheme, Record<number, string>> = { light: {}, dark: {} };
    let broken = '';
    for (const scheme of ['light', 'dark'] as const) {
      await setScheme(page, scheme);
      for (const size of SIZES) {
        try {
          cells[scheme][size] = await tile(page, size === 16 ? favicons.get(c.name) ?? c.svg : c.svg, size, [GROUND[scheme]]);
        } catch (e) {
          broken = String(e instanceof Error ? e.message : e);
        }
      }
    }
    await setScheme(page, 'light');
    if (broken) brokenNames.push(c.name);
    if (!broken && opts.pngs) {
      const dir = join(opts.out.replace(/\.png$/, ''), c.name);
      mkdirSync(dir, { recursive: true });
      for (const scheme of ['light', 'dark'] as const) for (const size of SIZES) {
        writeFileSync(join(dir, `${scheme}-${size}.png`), Buffer.from(cells[scheme][size].split(',')[1], 'base64'));
      }
    }

    let installed = '';
    if (opts.plate && !broken) {
      await setScheme(page, plateSchemeFor(opts.plate));
      // The same placement export uses, so the preview is the file it would write.
      const a = await analyse(page, c.svg, 512);
      const ground = splitColours(opts.plate);
      if (a.bbox) {
        const ios = await compose(page, { size: [180, 180], ground, clip: 'squircle', marks: [{ svg: c.svg, box: fitByInk(a, 180, DEFAULT_FILL) }] });
        const circ = await compose(page, { size: [180, 180], ground, clip: 'circle', marks: [{ svg: c.svg, box: fitMaskable(a, 180, DEFAULT_FILL) }] });
        installed = `<div class="block inst"><img src="data:image/png;base64,${ios.png.toString('base64')}" width="120" height="120"><img src="data:image/png;base64,${circ.png.toString('base64')}" width="120" height="120"><span class="cap">installed: iOS · Android mask</span></div>`;
      }
      await setScheme(page, 'light');
    }

    const block = (scheme: Scheme) => broken ? '' : `
      <div class="block ${scheme}">
        <img src="${cells[scheme][180]}" width="180" height="180">
        <div class="col">
          <img src="${cells[scheme][48]}" width="48" height="48">
          <img src="${cells[scheme][32]}" width="32" height="32">
          <div class="tab"><img src="${cells[scheme][16]}" width="16" height="16"><span>Page title</span></div>
        </div>
        <img class="zoom" src="${cells[scheme][16]}" width="128" height="128">
      </div>`;
    rows.push(`
      <section>
        <div class="label"><b>${letter(i)}</b> ${esc(c.name)}${favicons.has(c.name) ? '<p><i>16 px from its .favicon.svg</i></p>' : ''}<p>${esc(intentOf(c.svg))}</p>${broken ? `<p class="err">does not render: ${esc(broken)}</p>` : ''}</div>
        ${block('light')}${block('dark')}${installed}
      </section>`);
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #8a8f98; font: 14px/1.35 -apple-system, system-ui, sans-serif; width: max-content; }
    h1 { font-size: 18px; margin: 0 0 16px; color: #111; }
    section { display: flex; gap: 12px; align-items: stretch; margin-bottom: 12px; }
    .label { width: 220px; background: #f4f4f4; padding: 10px 12px; border-radius: 6px; color: #111; }
    .label b { font-size: 28px; display: block; }
    .label p { margin: 6px 0 0; color: #444; font-size: 12px; }
    .label .err { color: #b00020; }
    .block { display: flex; gap: 14px; align-items: center; padding: 10px; border-radius: 6px; }
    .block.light { background: ${GROUND.light}; } .block.dark { background: ${GROUND.dark}; }
    .col { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
    .tab { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-radius: 6px 6px 0 0; font-size: 12px; }
    .light .tab { background: ${GROUND.light}; color: #1f1f1f; box-shadow: 0 0 0 6px ${STRIP.light}; }
    .dark .tab { background: ${GROUND.dark}; color: #e3e3e3; box-shadow: 0 0 0 6px ${STRIP.dark}; }
    .zoom { image-rendering: pixelated; outline: 1px dashed rgba(127,127,127,.5); }
    .inst { background: #b8bcc4; flex-wrap: wrap; width: 260px; }
    .cap { width: 100%; font-size: 11px; color: #222; }
    img { display: block; }
  </style></head><body>${opts.title ? `<h1>${esc(opts.title)}</h1>` : ''}${rows.join('')}</body></html>`;

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.setContent(html, { waitUntil: 'load' });
  mkdirSync(dirname(opts.out) || '.', { recursive: true });
  // The body is max-content wide, so its own box is the sheet: a page screenshot would pad it out to the viewport.
  await page.locator('body').screenshot({ path: opts.out });
  await resetPage(page);
  return { concepts: concepts.length, broken: brokenNames };
}

