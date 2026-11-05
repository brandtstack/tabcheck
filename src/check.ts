/**
 * The gates. Each returns findings; a finding with level 'fail' makes the run red.
 * The numbers come from the drawing, rendered, never from the SVG source: a viewBox says
 * nothing about where the ink is (a viewBox once put a maskable mark 50 px too big).
 */
import type { Page } from 'playwright-core';
import { analyse, contrast, luminance, parseError, setScheme, type Analysis, type ContrastResult, type Scheme } from './browser.ts';
import { splitColours } from './colours.ts';
import { maskableScale } from './geometry.ts';

export interface Finding { level: 'fail' | 'warn' | 'info'; gate: string; text: string }
export interface CheckOptions {
  /**
   * Tab-bar grounds the favicon must read on: Chrome's active tab, then its inactive strip.
   * The FIRST of each list is a hard gate; the rest only warn. Light grounds are rendered under
   * prefers-color-scheme: light and dark ones under dark, so a mark that switches by scheme
   * (many do) is judged the way a browser shows it.
   */
  light: string[];
  dark: string[];
  /** Optional plate for installed icons: a colour, or 'a,b' for a gradient (every stop is gated). Rendered in plateScheme. */
  plate?: string;
  /** 'auto' (default): dark when the plate's first stop is dark. See plateSchemeFor. */
  plateScheme: Scheme | 'auto';
  minRatio: number;
  minShare: number;
}
export interface CheckReport {
  file: string;
  findings: Finding[];
  analysis?: Analysis;
  contrast?: ContrastResult[];
  /** Px of a 512 canvas the mark may be drawn at so a circular mask (central 80%) never clips it. */
  maskableSize?: number;
  ok: boolean;
}

export const DEFAULTS: CheckOptions = {
  light: ['#ffffff', '#d3e3fd'],
  dark: ['#3c3c3c', '#1f2020'],
  plateScheme: 'auto',
  minRatio: 3,
  minShare: 0.75,
};

/**
 * Which prefers-color-scheme the installed icon is rendered in. A mark that switches by scheme has
 * its light-on-dark variant under 'dark', and a dark plate wants that one; defaulting to 'light'
 * forces a mark to find shades that pass on white AND on navy, and installs the dull variant.
 * The plate's first stop is resolved by the browser, so rgb(), hsl() and names count too.
 */
export async function plateSchemeFor(page: Page, plate: string): Promise<Scheme> {
  const first = splitColours(plate)[0];
  const l = first === undefined ? null : await luminance(page, first);
  return l !== null && l < 0.18 ? 'dark' : 'light';
}

export async function resolvePlateScheme(page: Page, plate: string, s: Scheme | 'auto'): Promise<Scheme> {
  return s === 'auto' ? plateSchemeFor(page, plate) : s;
}

/** Static rules that need no rendering. */
export function lint(svg: string): Finding[] {
  const out: Finding[] = [];
  const fail = (gate: string, text: string) => out.push({ level: 'fail', gate, text });
  if (/<(text|tspan|textPath)\b/i.test(svg)) fail('no-text', '<text> found: convert the letters to outlines (in Figma, Illustrator or Inkscape: Object to Path). Live text depends on fonts the viewer may not have.');
  if (/<foreignObject\b/i.test(svg)) fail('no-foreign', '<foreignObject> does not render inside <img> or as a favicon');
  if (/<image\b/i.test(svg)) fail('no-raster', '<image> embeds a raster or an external file; draw it in vector');
  if (/(?:xlink:)?href\s*=\s*["']https?:/i.test(svg) || /@import|url\(\s*["']?https?:/i.test(svg)) fail('no-external', 'external reference: an SVG used as an image loads nothing from the network');
  const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i.exec(svg);
  if (!vb) fail('viewbox', 'no viewBox: the mark cannot scale');
  else if (Number(vb[3]) !== Number(vb[4])) fail('viewbox', `viewBox is ${vb[3]}×${vb[4]}; an icon master must be square`);
  return out;
}

export async function checkSvg(page: Page, file: string, svg: string, opts: CheckOptions): Promise<CheckReport> {
  const findings: Finding[] = [];
  const err = await parseError(page, svg);
  if (err) return { file, findings: [{ level: 'fail', gate: 'xml', text: `does not parse: ${err}` }], ok: false };
  findings.push(...lint(svg));

  let a: Analysis;
  try {
    a = await analyse(page, svg, 512);
  } catch (e) {
    findings.push({ level: 'fail', gate: 'render', text: String(e) });
    return { file, findings, ok: false };
  }
  if (!a.bbox || a.coverage < 0.01) {
    findings.push({ level: 'fail', gate: 'blank', text: `renders blank: ${(a.coverage * 100).toFixed(2)}% of the canvas painted` });
    return { file, findings, analysis: a, ok: false };
  }
  const fill = Math.max(a.bbox.w, a.bbox.h) / 512;
  if (fill < 0.6) findings.push({ level: 'warn', gate: 'bbox', text: `mark spans only ${(fill * 100).toFixed(0)}% of its canvas; at 16 px it will be tiny. Tighten the viewBox.` });
  const maskableSize = Math.floor(512 * maskableScale(a));
  findings.push({ level: 'info', gate: 'safe-zone', text: `ink reaches ${a.maxRadius.toFixed(0)} px from centre at 512; maskable: draw the mark at most ${maskableSize} px, centred (export does this for you)` });

  const groups: { label: string; scheme: Scheme; grounds: string[]; hard: number }[] = [
    { label: 'light', scheme: 'light', grounds: opts.light, hard: 1 },
    { label: 'dark', scheme: 'dark', grounds: opts.dark, hard: 1 },
    ...(opts.plate ? [{ label: 'plate', scheme: await resolvePlateScheme(page, opts.plate, opts.plateScheme), grounds: splitColours(opts.plate), hard: 99 }] : []),
  ];
  const c: ContrastResult[] = [];
  try {
  for (const g of groups) {
    await setScheme(page, g.scheme);
    const rs = await contrast(page, svg, 32, g.grounds, opts.minRatio);
    rs.forEach((r, i) => {
      const passed = r.share >= opts.minShare;
      const level = passed ? 'info' : i < g.hard ? 'fail' : 'warn';
      findings.push({ level, gate: 'contrast', text: `${g.label}${i < g.hard ? '' : ' (inactive tab)'} ${r.ground}: ${(r.share * 100).toFixed(0)}% of the mark at >= ${opts.minRatio}:1 (median ${r.median.toFixed(2)}:1, need ${(opts.minShare * 100).toFixed(0)}%)` });
    });
    c.push(...rs);
  }
  } finally {
    await setScheme(page, 'light');
  }
  return { file, findings, analysis: a, contrast: c, maskableSize, ok: !findings.some((f) => f.level === 'fail') };
}

export function formatReport(r: CheckReport): string {
  const mark = { fail: '✗', warn: '!', info: '·' } as const;
  return [`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`, ...r.findings.map((f) => `  ${mark[f.level]} [${f.gate}] ${f.text}`)].join('\n');
}
