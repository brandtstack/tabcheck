/**
 * Writes the whole icon set from one master, or nothing:
 *
 *   favicon.svg            the master as drawn: transparent, scheme-aware. Not the --favicon master:
 *                          a retina tab draws favicon.svg at 32 device px, where a 16-grid drawing looks crude
 *   favicon.ico            16 (from --favicon, if given) + 32 + 48, transparent, rendered under the
 *                          LIGHT scheme: an .ico cannot switch, so it carries the variant that must read on every bar
 *   apple-touch-icon.png   180, full bleed on the plate (iOS fills transparency with black)
 *   icon-192.png, icon-512.png   purpose "any", on the plate
 *   icon-maskable-512.png  scaled so the furthest ink sits inside the central 80% circle
 *   manifest-icons.json    the manifest `icons` array for the above
 *
 * Installed icons render under `scheme` (auto: dark on a dark plate, so a scheme-switching mark
 * installs in its light-on-dark variant). Nothing is written unless `check` passes on every input
 * with the plate gated too, and every file clears its size floor before the first one is written.
 */
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { analyse, compose, setScheme, type Scheme } from './browser.ts';
import { splitColours } from './colours.ts';
import { fitByInk, fitMaskable } from './geometry.ts';
import { checkSvg, formatReport, type CheckOptions, type CheckReport } from './check.ts';
import { assertAsset, writeAsset, type SvgFile } from './files.ts';
import { ico } from './ico.ts';

export interface ExportOptions {
  out: string;
  plate: string;
  scheme: Scheme;
  /** Share of the icon the mark's ink fills on `any` icons. */
  fill: number;
  check: CheckOptions;
}

export type ExportResult =
  | { ok: true; written: string[]; reports: CheckReport[] }
  /** `partial` lists files already moved into `out` when a later move failed; empty means nothing changed. */
  | { ok: false; reason: string; reports: CheckReport[]; partial: string[] };

export async function exportSet(page: Page, master: SvgFile, favicon: SvgFile, opts: ExportOptions): Promise<ExportResult> {
  const { plate, scheme, fill } = opts;
  // 1. gate: nothing is written unless every input passes, the plate included
  const reports = [await checkSvg(page, master.file, master.svg, { ...opts.check, plate, plateScheme: scheme })];
  if (favicon !== master) reports.push(await checkSvg(page, favicon.file, favicon.svg, opts.check));
  if (!reports.every((r) => r.ok)) return { ok: false, reason: 'check failed', reports, partial: [] };
  const ground = splitColours(plate);

  try {
    // 2. render everything in memory first
    const files: [string, Buffer | string][] = [];
    const raster = async (name: string, spec: Parameters<typeof compose>[1]) => {
      const { png, inked } = await compose(page, spec);
      if (inked < 0.005) throw new Error(`${name}: only ${(inked * 100).toFixed(2)}% of pixels carry the mark; refusing a blank icon`);
      files.push([name, png]);
    };

    await setScheme(page, 'light');
    const icoFrames = [];
    for (const size of [16, 32, 48]) {
      const { png } = await compose(page, { size: [size, size], ground: null, marks: [{ svg: size === 16 ? favicon.svg : master.svg, box: { x: 0, y: 0, w: size, h: size } }] });
      icoFrames.push({ size, png });
    }
    files.push(['favicon.ico', ico(icoFrames)]);
    files.push(['favicon.svg', master.svg]);

    await setScheme(page, scheme);
    const a = await analyse(page, master.svg, 512);
    for (const [name, S] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
      await raster(name, { size: [S, S], ground, marks: [{ svg: master.svg, box: fitByInk(a, S, fill) }] });
    }
    await raster('icon-maskable-512.png', { size: [512, 512], ground, marks: [{ svg: master.svg, box: fitMaskable(a, 512, fill) }] });
    await setScheme(page, 'light');

    files.push(['manifest-icons.json', JSON.stringify([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ], null, 2) + '\n']);

    // 3. the whole set or nothing: every file clears its floor, then the set is written to a
    // staging folder beside `out`, and only a complete staging folder is moved in. A failed write
    // leaves `out` untouched; only a failed rename (rare: same filesystem) can leave it partial.
    for (const [name, data] of files) assertAsset(join(opts.out, name), data);
    const out = resolve(opts.out);
    mkdirSync(dirname(out), { recursive: true });
    const stage = mkdtempSync(join(dirname(out), `.${basename(out)}.tabcheck-`));
    try {
      for (const [name, data] of files) writeAsset(join(stage, name), data);
    } catch (e) {
      rmSync(stage, { recursive: true, force: true });
      return { ok: false, reason: e instanceof Error ? e.message : String(e), reports, partial: [] };
    }
    mkdirSync(out, { recursive: true });
    const moved: string[] = [];
    try {
      for (const [name] of files) { renameSync(join(stage, name), join(out, name)); moved.push(name); }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e), reports, partial: moved };
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
    return { ok: true, written: moved, reports };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), reports, partial: [] };
  } finally {
    await setScheme(page, 'light');
  }
}

export { formatReport };
