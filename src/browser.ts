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
    await resetPage(page);
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
export async function resetPage(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
  await page.addScriptTag({ content: PAGE_LIB });
}

/** The colours among `colours` that the browser does not accept as a CSS colour. */
export async function invalidColours(page: Page, colours: string[]): Promise<string[]> {
  return page.evaluate((cs) => cs.filter((c) => !CSS.supports('color', c)), colours);
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
  /** Share of the mark's opaque pixels (alpha >= 0.5) at >= minRatio against the ground. */
  share: number;
  /** Median contrast ratio of those pixels. */
  median: number;
}

export async function contrast(page: Page, svg: string, size: number, grounds: string[], minRatio: number): Promise<ContrastResult[]> {
  return page.evaluate(([s, n, g, r]) => (window as unknown as PageWindow).tabcheck.contrast(s, n, g, r), [svg, size, grounds, minRatio] as const);
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
    compose(spec: ComposeSpec): Promise<{ b64: string; inked: number }>;
    parseError(svg: string): string | null;
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

  return { analyse, contrast, compose, parseError, tile };
})();
`;
