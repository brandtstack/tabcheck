/**
 * The 0.2.0 output of every untiled fixture, captured before tile-aware contrast existed.
 * Tile detection must leave an untiled icon's report byte-identical (spec: 2026-11-05-tile-aware-contrast).
 */
import { join, resolve } from 'node:path';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openPage } from '../src/browser.ts';
import { checkSvg, DEFAULTS, formatReport, type CheckOptions } from '../src/check.ts';
import { collectSvgs } from '../src/files.ts';

const FIXTURES = resolve(import.meta.dirname, '../fixtures');
const fixture = (name: string) => collectSvgs([join(FIXTURES, `${name}.svg`)])[0];

let page: Page;
let close: () => Promise<void>;
beforeAll(async () => ({ page, close } = await openPage()));
afterAll(async () => close?.());

const cases: [string, CheckOptions][] = [
  ...['good', 'low-contrast', 'scheme-switch', 'text'].map((n) => [n, DEFAULTS] as [string, CheckOptions]),
  ['good', { ...DEFAULTS, plate: '#1b2a4a' }],
];

it.each(cases)('untiled output is unchanged: %s %#', async (name, opts) => {
  const f = fixture(name);
  const r = await checkSvg(page, f.file, f.svg, opts);
  expect(formatReport(r).replaceAll(FIXTURES, '<fixtures>')).toMatchSnapshot();
});
