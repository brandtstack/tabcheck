/**
 * Where the mark goes on an installed icon. One copy, used by check (its advice), sheet (its
 * previews) and export (the files), so the three can never disagree.
 */
import type { Analysis } from './browser.ts';

/** Android guarantees a maskable icon's central 80% circle: radius 0.4 of the canvas, less a 3% margin. */
export const SAFE_RADIUS_512 = 0.4 * 512 * 0.97;
/** Share of an `any` icon the mark's ink fills by default. */
export const DEFAULT_FILL = 0.72;

export type Box = { x: number; y: number; w: number; h: number };

/** Scale of the 512 drawing at which its furthest ink sits inside the safe circle (never above 1). */
export function maskableScale(a: Analysis): number {
  return Math.min(1, SAFE_RADIUS_512 / Math.max(a.maxRadius, 1));
}

/** Place the 512-canvas drawing so its painted bbox fills `f` of an S×S square, centred on the ink. */
export function fitByInk(a: Analysis, S: number, f: number): Box {
  const b = a.bbox!;
  const k = (f * S) / Math.max(b.w, b.h);
  return { x: S / 2 - (b.x + b.w / 2) * k, y: S / 2 - (b.y + b.h / 2) * k, w: 512 * k, h: 512 * k };
}

/** Maskable: centred as authored, inside the safe circle, and never larger than `fill` would make it. */
export function fitMaskable(a: Analysis, S: number, fill: number): Box {
  const k = Math.min(maskableScale(a), (fill * 512) / Math.max(a.bbox!.w, a.bbox!.h)) * (S / 512);
  return { x: S / 2 - 256 * k, y: S / 2 - 256 * k, w: 512 * k, h: 512 * k };
}
