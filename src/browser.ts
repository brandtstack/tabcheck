/**
 * Every raster tabcheck makes comes out of headless Chromium: it resolves fonts the way a browser
 * does and it is the rasteriser a tab strip uses. ImageMagick's SVG delegate is deliberately not
 * used (it cannot resolve SVG text fonts, and it is not what users see).
 *
 * The page does the pixel work itself (canvas getImageData) and hands back small results, so
 * no megabyte-sized arrays cross the CDP boundary.
 */
import { chromium, type Browser, type Page } from 'playwright-core';

export type Scheme = 'light' | 'dark';

/** A problem with the environment (no browser, unreadable input), not with the icon. Exit 2. */
export class EnvError extends Error {}

export interface BrowserOptions {
  /** An explicit Chromium/Chrome executable. Also read from TABCHECK_BROWSER. */
  executablePath?: string;
}

const INSTALL_HINT =
  'tabcheck needs Chromium. Install Google Chrome, or run `npx playwright-core install chromium-headless-shell`, ' +
  'or pass --browser <path> (or set TABCHECK_BROWSER).';

/**
 * Finds a browser in this order: an explicit path, the user's installed Chrome, Playwright's own
 * Chromium cache. No browser ships with the package, so `npm install tabcheck` stays small.
 */
async function launch(opts: BrowserOptions): Promise<Browser> {
  const explicit = opts.executablePath ?? process.env.TABCHECK_BROWSER;
  if (explicit) {
    try {
      return await chromium.launch({ executablePath: explicit });
    } catch (e) {
      throw new EnvError(`could not start the browser at ${explicit}: ${firstLine(e)}`);
    }
  }
  const errors: string[] = [];
  for (const attempt of [{ channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch(attempt);
    } catch (e) {
      errors.push(firstLine(e));
    }
  }
  throw new EnvError(`${INSTALL_HINT}\n  tried: installed Chrome (${errors[0]}); Playwright Chromium (${errors[1]})`);
}

const firstLine = (e: unknown) => String(e instanceof Error ? e.message : e).split('\n')[0];

/**
 * One page for a whole run. The SVG under test is untrusted: it is only ever drawn as an image
 * (so its scripts never run), and every request the page makes is refused, so nothing it
 * references can be fetched.
 */
export async function openPage(opts: BrowserOptions & { scheme?: Scheme; scale?: number } = {}): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser: Browser = await launch(opts);
  try {
    const context = await browser.newContext({ deviceScaleFactor: opts.scale ?? 1, colorScheme: opts.scheme ?? 'light', offline: true });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await resetPage(page, opts.scheme ?? 'light');
    return { page, close: () => browser.close() };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

/**
 * A blank document with the drawing library injected, light scheme, default viewport. Anything
 * that replaces the document (the sheet does) must call this afterwards, or the next call on the
 * page finds no library.
 */
export async function resetPage(page: Page, scheme: Scheme = 'light'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: PAGE_LIB });
}

/**
 * The colours among `colours` that a canvas cannot paint. CSS.supports alone is too loose: it
 * accepts `inherit` and `var(--x)`, which a canvas fillStyle silently ignores.
 */
export async function invalidColours(page: Page, colours: string[]): Promise<string[]> {
  return page.evaluate((cs) => cs.filter((c) => (window as unknown as PageWindow).tabcheck.resolve(c) === null), colours);
}

/** Relative luminance (0 black to 1 white) of a CSS colour, resolved by the browser. null when it is not one. */
export async function luminance(page: Page, colour: string): Promise<number | null> {
  return page.evaluate((c) => {
    const rgb = (window as unknown as PageWindow).tabcheck.resolve(c);
    if (!rgb) return null;
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  }, colour);
}

export async function withPage<T>(fn: (page: Page) => Promise<T>, opts: BrowserOptions & { scheme?: Scheme; scale?: number } = {}): Promise<T> {
  const { page, close } = await openPage(opts);
  try {
    return await fn(page);
  } finally {
    await close();
  }
}

export async function setScheme(page: Page, scheme: Scheme): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
}

export interface Analysis {
  size: number;
  /** Share of the canvas covered by alpha >= 0.5. */
  coverage: number;
  /** Painted bounding box, alpha >= 0.1, in canvas px. null when nothing is painted. */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** Furthest painted pixel from the canvas centre, in canvas px. */
  maxRadius: number;
}

/** Rasterise at `size` on a transparent canvas and measure what was actually drawn. */
export async function analyse(page: Page, svg: string, size: number): Promise<Analysis> {
  return page.evaluate(([s, n]) => (window as unknown as PageWindow).tabcheck.analyse(s, n), [svg, size] as const);
}

export interface ContrastResult {
  ground: string;
  /**
   * Share of the mark's opaque pixels (alpha >= 0.5) at >= minRatio against the ground.
   * When `tile` is present: share of the mark pixels on the tile at >= minRatio against `tile.colour`.
   */
  share: number;
  /** Median contrast ratio of those pixels (against `tile.colour` when `tile` is present). */
  median: number;
  /** Present when the icon is drawn on an opaque tile; its edge is measured against the ground. */
  tile?: { colour: string; edgeShare: number; edgeMedian: number };
}

export interface TileInfo {
  /** The tile colour, #rrggbb. */
  colour: string;
  /** Shares of the canvas: fully opaque, tile-coloured, and mark pixels. */
  opaque: number;
  tile: number;
  marks: number;
}
export type TileResult = ContrastResult & { tile: NonNullable<ContrastResult['tile']> };

export async function contrast(page: Page, svg: string, size: number, grounds: string[], minRatio: number): Promise<ContrastResult[]> {
  return page.evaluate(([s, n, g, r]) => (window as unknown as PageWindow).tabcheck.contrast(s, n, g, r), [svg, size, grounds, minRatio] as const);
}

/** Marks measured against an opaque tile, or null when the icon is not drawn on one (the spec's rule 4). */
export async function tileContrast(page: Page, svg: string, size: number, grounds: string[], minRatio: number): Promise<{ info: TileInfo; results: TileResult[] } | null> {
  return page.evaluate(([s, n, g, r]) => (window as unknown as PageWindow).tabcheck.tileContrast(s, n, g, r), [svg, size, grounds, minRatio] as const);
}

export interface ComposeSpec {
  size: [number, number];
  /** One CSS colour, or several for a top-to-bottom gradient. null = transparent. */
  ground: string[] | null;
  /** The mark is scaled so its painted bbox (or radius) lands where placement says. */
  marks: { svg: string; box: { x: number; y: number; w: number; h: number } }[];
  /** Extra outlined paths (share-card titles), drawn in canvas px. */
  paths?: { d: string; fill: string }[];
  /** iOS-style rounded mask or a circle, for previews only. */
  clip?: 'circle' | 'squircle';
}

/** Compose to a PNG and report how many pixels differ from the ground (a blank-output guard). */
export async function compose(page: Page, spec: ComposeSpec): Promise<{ png: Buffer; inked: number }> {
  const r = await page.evaluate((sp) => (window as unknown as PageWindow).tabcheck.compose(sp), spec);
  return { png: Buffer.from(r.b64, 'base64'), inked: r.inked };
}

/** Parse with the browser's own XML parser. Returns the error text, or null when it parses. */
export async function parseError(page: Page, svg: string): Promise<string | null> {
  return page.evaluate((s) => (window as unknown as PageWindow).tabcheck.parseError(s), svg);
}

/** A raster of the mark at size×size on a ground (null = transparent), as a PNG data URL. */
export async function tile(page: Page, svg: string, size: number, ground: string[] | null): Promise<string> {
  return page.evaluate(([s, n, g]) => (window as unknown as PageWindow).tabcheck.tile(s, n, g), [svg, size, ground] as const);
}

interface PageWindow {
  tabcheck: {
    analyse(svg: string, size: number): Promise<Analysis>;
    contrast(svg: string, size: number, grounds: string[], minRatio: number): Promise<ContrastResult[]>;
    tileContrast(svg: string, size: number, grounds: string[], minRatio: number): Promise<{ info: TileInfo; results: TileResult[] } | null>;
    compose(spec: ComposeSpec): Promise<{ b64: string; inked: number }>;
    parseError(svg: string): string | null;
    resolve(colour: string): [number, number, number] | null;
    tile(svg: string, size: number, ground: string[] | null): Promise<string>;
  };
}

/** Runs inside the page. Plain JS on purpose: it is injected as a script tag. */
const PAGE_LIB = String.raw`
window.tabcheck = (() => {
  const load = (svg) => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('svg failed to load as an image'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const draw = async (svg, size) => {
    const img = await load(svg);
    const c = canvas(size, size);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, size, size);
    return g.getImageData(0, 0, size, size).data;
  };
  const rgb = (css) => {
    const c = canvas(1, 1).getContext('2d', { willReadFrequently: true });
    c.fillStyle = css; c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  };
  // A colour the canvas accepts paints the same from two different starting fills; one it
  // ignores leaves each start in place. CSS.supports is checked too, for keywords like inherit.
  const resolve = (css) => {
    if (typeof css !== 'string' || !CSS.supports('color', css) || /^\s*(inherit|initial|unset|revert|revert-layer)\s*$/i.test(css) || /var\(/i.test(css)) return null;
    const c = canvas(1, 1).getContext('2d', { willReadFrequently: true });
    c.fillStyle = '#000000'; c.fillStyle = css; const a = c.fillStyle;
    c.fillStyle = '#ffffff'; c.fillStyle = css; const b = c.fillStyle;
    if (a !== b) return null;
    c.clearRect(0, 0, 1, 1); c.fillStyle = css; c.fillRect(0, 0, 1, 1);
    const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  };
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  async function analyse(svg, size) {
    const d = await draw(svg, size);
    let x0 = size, y0 = size, x1 = -1, y1 = -1, solid = 0, rmax = 0;
    const c = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const a = d[(y * size + x) * 4 + 3];
      if (a >= 128) solid++;
      if (a >= 26) {
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        // furthest corner of this pixel from the centre
        const dx = Math.max(Math.abs(x - c), Math.abs(x + 1 - c)), dy = Math.max(Math.abs(y - c), Math.abs(y + 1 - c));
        const r = Math.hypot(dx, dy); if (r > rmax) rmax = r;
      }
    }
    return { size, coverage: solid / (size * size), bbox: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, maxRadius: rmax };
  }

  async function contrast(svg, size, grounds, minRatio) {
    const d = await draw(svg, size);
    return grounds.map((ground) => {
      const gr = rgb(ground); const rs = [];
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255; if (a < 0.5) continue;
        const px = [0, 1, 2].map((k) => d[i + k] * a + gr[k] * (1 - a));
        rs.push(ratio(px, gr));
      }
      rs.sort((p, q) => p - q);
      return { ground, share: rs.length ? rs.filter((r) => r >= minRatio).length / rs.length : 0, median: rs.length ? rs[rs.length >> 1] : 1 };
    });
  }

  // ⚠️ The tile rule, step for step: docs/superpowers/specs/2026-11-05-tile-aware-contrast.md
  // (The rule 1-6). Its numbers (alpha 255, 0.80 / 0.35 / 0.10, 1.1:1) are the spec's; change both.
  async function tileContrast(svg, size, grounds, minRatio) {
    const d = await draw(svg, size);
    const n = size * size;
    const opaque = (p) => d[p * 4 + 3] === 255;
    const px = (p) => [d[p * 4], d[p * 4 + 1], d[p * 4 + 2]];
    // 1. outside = non-opaque pixels reachable from the border; any other non-opaque pixel is a hole
    const outside = new Uint8Array(n); const stack = [];
    const seed = (p) => { if (!opaque(p) && !outside[p]) { outside[p] = 1; stack.push(p); } };
    for (let i = 0; i < size; i++) { seed(i); seed((size - 1) * size + i); seed(i * size); seed(i * size + size - 1); }
    while (stack.length) {
      const p = stack.pop(); const x = p % size, y = (p - x) / size;
      if (x > 0) seed(p - 1); if (x < size - 1) seed(p + 1); if (y > 0) seed(p - size); if (y < size - 1) seed(p + size);
    }
    let opaqueCount = 0;
    for (let p = 0; p < n; p++) { if (opaque(p)) opaqueCount++; else if (!outside[p]) return null; }
    // 2. edge = opaque with a 4-neighbour outside or off the canvas; interior = the rest
    const edge = []; const interior = [];
    const out = (x, y) => x < 0 || y < 0 || x >= size || y >= size || outside[y * size + x] === 1;
    for (let p = 0; p < n; p++) {
      if (!opaque(p)) continue;
      const x = p % size, y = (p - x) / size;
      (out(x - 1, y) || out(x + 1, y) || out(x, y - 1) || out(x, y + 1) ? edge : interior).push(px(p));
    }
    // 3. tile colour = the modal interior RGB; ties to lower luminance, then the lower #rrggbb
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    const counts = new Map();
    for (const c of interior) { const k = hex(c); counts.set(k, (counts.get(k) || 0) + 1); }
    let best = null, bestN = 0, bestL = 0;
    for (const [k, cnt] of counts) {
      const l = lum(rgb(k));
      if (cnt > bestN || (cnt === bestN && (l < bestL || (l === bestL && k < best)))) { best = k; bestN = cnt; bestL = l; }
    }
    if (best === null) return null;
    const tc = rgb(best);
    const marks = []; let tileCount = 0;
    for (const c of interior) { const r = ratio(c, tc); if (r < 1.1) tileCount++; else marks.push(r); }
    // 4. the gate
    if (opaqueCount / n < 0.8 || tileCount / n < 0.35 || marks.length / n < 0.1) return null;
    // 5-6. marks against the tile (the same for every ground), the edge against each ground
    const stats = (rs) => { rs.sort((p, q) => p - q); return { share: rs.length ? rs.filter((r) => r >= minRatio).length / rs.length : 0, median: rs.length ? rs[rs.length >> 1] : 1 }; };
    const m = stats(marks);
    return {
      info: { colour: best, opaque: opaqueCount / n, tile: tileCount / n, marks: marks.length / n },
      results: grounds.map((ground) => {
        const gr = rgb(ground); const e = stats(edge.map((c) => ratio(c, gr)));
        return { ground, share: m.share, median: m.median, tile: { colour: best, edgeShare: e.share, edgeMedian: e.median } };
      }),
    };
  }

  function paintGround(g, w, h, ground) {
    if (!ground) return;
    const parts = ground;
    if (parts.length > 1) {
      const lg = g.createLinearGradient(0, 0, 0, h);
      parts.forEach((p, i) => lg.addColorStop(i / (parts.length - 1), p));
      g.fillStyle = lg;
    } else g.fillStyle = parts[0];
    g.fillRect(0, 0, w, h);
  }

  async function compose(sp) {
    const [w, h] = sp.size;
    const c = canvas(w, h); const g = c.getContext('2d', { willReadFrequently: true });
    if (sp.clip) {
      g.beginPath();
      if (sp.clip === 'circle') g.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
      else g.roundRect(0, 0, w, h, Math.min(w, h) * 0.2237);
      g.clip();
    }
    paintGround(g, w, h, sp.ground);
    const before = g.getImageData(0, 0, w, h).data.slice();
    for (const m of sp.marks) { const img = await load(m.svg); g.drawImage(img, m.box.x, m.box.y, m.box.w, m.box.h); }
    for (const p of sp.paths || []) { g.fillStyle = p.fill; g.fill(new Path2D(p.d)); }
    const after = g.getImageData(0, 0, w, h).data;
    let inked = 0;
    for (let i = 0; i < after.length; i += 4) {
      if (Math.abs(after[i] - before[i]) + Math.abs(after[i + 1] - before[i + 1]) + Math.abs(after[i + 2] - before[i + 2]) + Math.abs(after[i + 3] - before[i + 3]) > 24) inked++;
    }
    return { b64: c.toDataURL('image/png').split(',')[1], inked: inked / (w * h) };
  }

  function parseError(svg) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) return err.textContent.replace(/^This page contains the following errors:/, '').split('Below is a rendering')[0].trim();
    if (doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg' || doc.documentElement.localName !== 'svg') return 'root element is not <svg> in the SVG namespace';
    return null;
  }

  /** One raster of the mark at size×size on a ground (null = transparent), as a data URL. */
  async function tile(svg, size, ground) {
    const c = canvas(size, size); const g = c.getContext('2d');
    paintGround(g, size, size, ground);
    g.drawImage(await load(svg), 0, 0, size, size);
    return c.toDataURL('image/png');
  }

  return { analyse, contrast, tileContrast, compose, parseError, tile, resolve };
})();
`;
