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
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { analyse, compose, setScheme, type Analysis, type Scheme } from './browser.ts';
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
  | { ok: false; reason: string; reports: CheckReport[] };

type Box = { x: number; y: number; w: number; h: number };

/** Place the 512-canvas drawing so its painted bbox fills `f` of an S×S square, centred on the ink. */
function fitByInk(a: Analysis, S: number, f: number): Box {
  const b = a.bbox!;
  const k = (f * S) / Math.max(b.w, b.h);
  return { x: S / 2 - (b.x + b.w / 2) * k, y: S / 2 - (b.y + b.h / 2) * k, w: 512 * k, h: 512 * k };
}

/** Maskable: centred as authored, scaled so the furthest ink lies inside radius 0.4·S (3% margin). */
function fitMaskable(a: Analysis, S: number, fill: number): Box {
  const k = Math.min((0.4 * 512 * 0.97) / a.maxRadius, (fill * 512) / Math.max(a.bbox!.w, a.bbox!.h)) * (S / 512);
  return { x: S / 2 - 256 * k, y: S / 2 - 256 * k, w: 512 * k, h: 512 * k };
}

export async function exportSet(page: Page, master: SvgFile, favicon: SvgFile, opts: ExportOptions): Promise<ExportResult> {
  const { plate, scheme, fill } = opts;
  // 1. gate: nothing is written unless every input passes, the plate included
  const reports = [await checkSvg(page, master.file, master.svg, { ...opts.check, plate, plateScheme: scheme })];
  if (favicon !== master) reports.push(await checkSvg(page, favicon.file, favicon.svg, opts.check));
  if (!reports.every((r) => r.ok)) return { ok: false, reason: 'check failed', reports };

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
      await raster(name, { size: [S, S], ground: plate, marks: [{ svg: master.svg, box: fitByInk(a, S, fill) }] });
    }
    await raster('icon-maskable-512.png', { size: [512, 512], ground: plate, marks: [{ svg: master.svg, box: fitMaskable(a, 512, fill) }] });
    await setScheme(page, 'light');

    files.push(['manifest-icons.json', JSON.stringify([
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ], null, 2) + '\n']);

    // 3. the whole set or nothing: every file clears its floor before the first one is written
    for (const [name, data] of files) assertAsset(join(opts.out, name), data);
    mkdirSync(opts.out, { recursive: true });
    for (const [name, data] of files) writeAsset(join(opts.out, name), data);
    return { ok: true, written: files.map(([n]) => n), reports };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), reports };
  }
}

export { formatReport };
