/**
 * One case per finding from the first code review (2026-11-05).
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPage } from '../src/browser.ts';
import { checkSvg, DEFAULTS } from '../src/check.ts';
import { main } from '../src/cli.ts';
import { splitColours } from '../src/colours.ts';
import { exportSet } from '../src/export.ts';
import { collectSvgs } from '../src/files.ts';
import { renderSheet } from '../src/sheet.ts';

const ROOT = resolve(import.meta.dirname, '..');
const GOOD = join(ROOT, 'fixtures/good.svg');
const quiet = () => {};
const tmp = () => mkdtempSync(join(tmpdir(), 'tabcheck-r1-'));

let page: Page;
let close: () => Promise<void>;
beforeAll(async () => ({ page, close } = await openPage()));
afterAll(async () => close?.());

describe('colour lists', () => {
  it('keep commas inside rgb()/hsl() with the colour', () => {
    expect(splitColours('rgb(255, 255, 255), #dee1e6')).toEqual(['rgb(255, 255, 255)', '#dee1e6']);
    expect(splitColours('hsl(0 0% 90%),color(srgb 1 1 1)')).toEqual(['hsl(0 0% 90%)', 'color(srgb 1 1 1)']);
    expect(splitColours(' , ')).toEqual([]);
  });

  it('a functional colour works on the command line, for tabs and for the plate', async () => {
    expect(await main(['check', '--light', 'rgb(255, 255, 255),#dee1e6', GOOD], quiet, quiet)).toBe(0);
    expect(await main(['export', GOOD, '--plate', 'rgb(27, 42, 74)', '--out', join(tmp(), 'set')], quiet, quiet)).toBe(0);
  });

  it('a mistyped colour is a usage error, not a silent black', async () => {
    expect(await main(['check', '--light', 'whitee', GOOD], quiet, quiet)).toBe(2);
    expect(await main(['check', '--plate', 'navyy', GOOD], quiet, quiet)).toBe(2);
  });

  it('an empty list is a usage error, not a skipped gate', async () => {
    expect(await main(['check', '--light', ',', GOOD], quiet, quiet)).toBe(2);
    expect(await main(['check', '--dark', ' , ', GOOD], quiet, quiet)).toBe(2);
  });
});

describe('cli edges', () => {
  it('sheet --out must end in .png', async () => {
    expect(await main(['sheet', GOOD, '--out', join(tmp(), 'sheet')], quiet, quiet)).toBe(2);
  });

  it('--help works on every subcommand', async () => {
    for (const cmd of ['check', 'sheet', 'export']) expect(await main([cmd, '--help'], quiet, quiet), cmd).toBe(0);
  });

  it('gate settings outside their range are refused', async () => {
    expect(await main(['check', '--min-share', '75', GOOD], quiet, quiet)).toBe(2);
    expect(await main(['check', '--min-ratio', '0.5', GOOD], quiet, quiet)).toBe(2);
    expect(await main(['check', '--min-ratio', '22', GOOD], quiet, quiet)).toBe(2);
  });

  it('a crash exits 3, never 1 (which means a gate failed)', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'taken.png')); // a directory where the sheet file should go
    let code = 0;
    try {
      execFileSync(process.execPath, [join(ROOT, 'src/bin.ts'), 'sheet', GOOD, '--out', join(dir, 'taken.png'), '--no-pngs'], { stdio: 'pipe' });
    } catch (e) {
      code = (e as { status: number }).status;
    }
    expect(code).toBe(3);
  });
});

describe('library use', () => {
  it('the page still works after a sheet', async () => {
    const [f] = collectSvgs([GOOD]);
    await renderSheet(page, [f], { out: join(tmp(), 's.png'), pngs: false, light: DEFAULTS.light, dark: DEFAULTS.dark });
    expect((await checkSvg(page, f.file, f.svg, DEFAULTS)).ok).toBe(true);
  });
});

describe('export never leaves a mixed set', () => {
  it('a failed write leaves the existing files untouched and says so', async () => {
    const out = join(tmp(), 'public');
    mkdirSync(out);
    writeFileSync(join(out, 'icon-192.png'), 'old');
    chmodSync(out, 0o555); // the set cannot be moved in
    try {
      const [f] = collectSvgs([GOOD]);
      const r = await exportSet(page, f, f, { out, plate: '#1b2a4a', scheme: 'dark', fill: 0.72, check: DEFAULTS });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.partial).toEqual([]);
      expect(readFileSync(join(out, 'icon-192.png'), 'utf8')).toBe('old');
    } finally {
      chmodSync(out, 0o755);
    }
  });
});
