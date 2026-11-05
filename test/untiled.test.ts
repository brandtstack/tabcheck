/**
 * Tile detection must leave an untiled icon's report as it was in 0.2.0 (spec:
 * 2026-11-05-tile-aware-contrast). Byte-identity was proven once against a snapshot captured before
 * the change (docs/history.md); exact percentages move with the canvas backend and Chrome build, so
 * what stays pinned here is that no untiled fixture is treated as a tile and the 0.2.0 line format.
 */
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openPage } from '../src/browser.ts';
import { checkSvg, DEFAULTS, type CheckOptions } from '../src/check.ts';
import { collectSvgs } from '../src/files.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const fixture = (name: string) => collectSvgs([join(FIXTURES, `${name}.svg`)])[0];
const LINE = /^(light|dark|plate)( \(inactive tab\))? \S+: \d+% of the mark at >= 3:1 \(median \d+\.\d\d:1, need 75%\)$/;

let page: Page;
let close: () => Promise<void>;
beforeAll(async () => ({ page, close } = await openPage()));
afterAll(async () => close?.());

const cases: [string, CheckOptions][] = [
  ...['good', 'low-contrast', 'scheme-switch', 'text'].map((n) => [n, DEFAULTS] as [string, CheckOptions]),
  ['good', { ...DEFAULTS, plate: '#1b2a4a' }],
];

it.each(cases)('untiled output keeps the 0.2.0 shape: %s %#', async (name, opts) => {
  const f = fixture(name);
  const r = await checkSvg(page, f.file, f.svg, opts);
  const lines = r.findings.filter((x) => x.gate === 'contrast').map((x) => x.text);
  expect(lines).toHaveLength(4 + (opts.plate ? 1 : 0));
  for (const l of lines) expect(l).toMatch(LINE);
  expect(r.findings.some((x) => x.gate === 'tile-edge')).toBe(false);
  for (const c of r.contrast ?? []) expect(c.tile).toBeUndefined();
});
