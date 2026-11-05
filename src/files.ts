import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface SvgFile { file: string; name: string; svg: string }

/** Files and folders on the command line → every .svg among them, sorted, with their text. */
export function collectSvgs(paths: string[]): SvgFile[] {
  const files: string[] = [];
  for (const p of paths) {
    if (statSync(p).isDirectory()) files.push(...readdirSync(p).filter((f) => f.endsWith('.svg')).sort().map((f) => join(p, f)));
    else files.push(p);
  }
  return files.map((file) => ({ file, name: basename(file, '.svg'), svg: readFileSync(file, 'utf8') }));
}

/** The line of intent a concept carries in its own <title> (or <desc>). */
export function intentOf(svg: string): string {
  const m = /<(?:title|desc)>([\s\S]*?)<\/(?:title|desc)>/i.exec(svg);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

export const MIN_RASTER_BYTES = 1024;

/**
 * The only way tabcheck writes an asset. Rasters under 1 KB are refused: that is the size of
 * the placeholders that actually ship (a 1×1 PNG from printf, a `data:,` favicon). ⚠️ A real 16 px
 * PNG CAN be smaller (500–700 bytes, measured 2026-10-22), so the floor only fits what export
 * writes: 180 px and up, and a multi-frame .ico. SVGs get a floor of 120 bytes plus the check gate.
 */
export function assertAsset(path: string, data: Buffer | string): void {
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  const floor = path.endsWith('.svg') || path.endsWith('.json') ? 120 : MIN_RASTER_BYTES;
  if (bytes < floor) throw new Error(`refusing to write ${path}: ${bytes} bytes is under the ${floor}-byte floor (a placeholder, not an icon)`);
}

export function writeAsset(path: string, data: Buffer | string): void {
  assertAsset(path, data);
  writeFileSync(path, data);
}
