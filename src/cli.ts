import { readFileSync } from 'node:fs';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import type { Page } from 'playwright-core';
import { EnvError, invalidColours, withPage, type Scheme } from './browser.ts';
import { splitColours } from './colours.ts';
import { DEFAULT_FILL } from './geometry.ts';
import { checkSvg, DEFAULTS, formatReport, plateSchemeFor, type CheckOptions } from './check.ts';
import { exportSet } from './export.ts';
import { collectSvgs, type SvgFile } from './files.ts';
import { renderSheet } from './sheet.ts';

const HELP = `tabcheck: does your favicon actually show up on a browser tab?

Usage
  tabcheck check  <svg|dir>...  [--plate <colour|a,b>] [--plate-scheme auto|light|dark] [--json]
  tabcheck sheet  <svg|dir>...  --out sheet.png [--plate <colour>] [--title <text>] [--no-pngs]
  tabcheck export <master.svg>  --plate <colour|a,b> --out <dir> [--favicon <16px.svg>]
                                [--scheme auto|light|dark] [--fill ${DEFAULT_FILL}]

Colours are any CSS colour; separate several with commas (rgb(1, 2, 3) is one colour).

Shared options
  --light <a,b>      light tab colours: active (gated), inactive (warns)   default ${DEFAULTS.light.join(',')}
  --dark <a,b>       dark tab colours                                       default ${DEFAULTS.dark.join(',')}
  --min-ratio <n>    contrast a pixel needs against the tab, 1 to 21       default ${DEFAULTS.minRatio}
  --min-share <n>    share of the mark's pixels that must reach it, 0 to 1 default ${DEFAULTS.minShare}
  --browser <path>   Chromium or Chrome to use (also TABCHECK_BROWSER)
  -h, --help         this text
  -v, --version      the version

Exit codes: 0 pass, 1 a gate failed (nothing exported), 2 usage or environment error,
3 tabcheck itself crashed (please report it).
`;

const SHARED = {
  light: { type: 'string' },
  dark: { type: 'string' },
  'min-ratio': { type: 'string' },
  'min-share': { type: 'string' },
  browser: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} satisfies ParseArgsConfig['options'];

class UsageError extends Error {}

function list(v: string | undefined, fallback: string[], name: string): string[] {
  if (v === undefined) return fallback;
  const out = splitColours(v);
  if (!out.length) throw new UsageError(`--${name} needs at least one colour`);
  return out;
}

function num(v: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new UsageError(`--${name} must be a number from ${min} to ${max}, got ${JSON.stringify(v)}`);
  return n;
}

function checkOptions(values: Record<string, unknown>): CheckOptions {
  return {
    ...DEFAULTS,
    light: list(values.light as string | undefined, DEFAULTS.light, 'light'),
    dark: list(values.dark as string | undefined, DEFAULTS.dark, 'dark'),
    // a contrast ratio runs from 1:1 to 21:1, and a share is a fraction: 75 (a percent) is a typo
    minRatio: num(values['min-ratio'] as string | undefined, DEFAULTS.minRatio, 'min-ratio', 1, 21),
    minShare: num(values['min-share'] as string | undefined, DEFAULTS.minShare, 'min-share', 0, 1),
  };
}

/** A mistyped colour would otherwise be measured as black without a word. */
async function assertColours(page: Page, colours: (string | undefined)[]): Promise<void> {
  const bad = await invalidColours(page, colours.flatMap((c) => (c === undefined ? [] : splitColours(c))));
  if (bad.length) throw new UsageError(`not a CSS colour: ${bad.map((b) => JSON.stringify(b)).join(', ')}`);
}

function inputs(paths: string[]): SvgFile[] {
  let files: SvgFile[];
  try {
    files = collectSvgs(paths);
  } catch (e) {
    throw new EnvError(`cannot read input: ${e instanceof Error ? e.message : e}`);
  }
  if (!files.length) throw new UsageError(`no .svg files in ${paths.join(', ')}`);
  return files;
}

function version(): string {
  return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
}

/** Runs one command and returns its exit code. Never calls process.exit, so tests can drive it. */
export async function main(argv: string[], log = console.log, err = console.error): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (!command || command === '-h' || command === '--help' || command === 'help') { log(HELP); return command ? 0 : 2; }
    if (command === '-v' || command === '--version') { log(version()); return 0; }

    if (command === 'check') {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { ...SHARED, plate: { type: 'string' }, 'plate-scheme': { type: 'string' }, json: { type: 'boolean' } } });
      if (values.help) { log(HELP); return 0; }
      if (!positionals.length) throw new UsageError('check needs at least one .svg file or folder');
      const files = inputs(positionals);
      const ps = values['plate-scheme'];
      if (ps !== undefined && ps !== 'light' && ps !== 'dark' && ps !== 'auto') throw new UsageError('--plate-scheme is auto, light or dark');
      const opts: CheckOptions = { ...checkOptions(values), plate: values.plate, plateScheme: (ps ?? 'auto') as Scheme | 'auto' };
      if (values.plate !== undefined) list(values.plate, [], 'plate');
      const reports = await withPage(async (page) => {
        await assertColours(page, [...opts.light, ...opts.dark, opts.plate]);
        const out = [];
        for (const { file, svg } of files) out.push(await checkSvg(page, file, svg, opts));
        return out;
      }, { executablePath: values.browser });
      log(values.json ? JSON.stringify(reports, null, 2) : reports.map(formatReport).join('\n\n'));
      return reports.every((r) => r.ok) ? 0 : 1;
    }

    if (command === 'sheet') {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { ...SHARED, out: { type: 'string' }, plate: { type: 'string' }, title: { type: 'string' }, 'no-pngs': { type: 'boolean' } } });
      if (values.help) { log(HELP); return 0; }
      if (!positionals.length || !values.out) throw new UsageError('sheet needs .svg files or folders and --out sheet.png');
      // the per-concept rasters go in <out without .png>/, which must not be the sheet's own path
      if (!values.out.endsWith('.png')) throw new UsageError('--out for sheet must end in .png');
      if (values.plate !== undefined) list(values.plate, [], 'plate');
      const files = inputs(positionals);
      const c = checkOptions(values);
      const r = await withPage(async (page) => {
        await assertColours(page, [...c.light, ...c.dark, values.plate]);
        return renderSheet(page, files, { out: values.out!, plate: values.plate, title: values.title, pngs: !values['no-pngs'], light: c.light, dark: c.dark });
      }, { executablePath: values.browser });
      log(`${values.out}  (${r.concepts} concept${r.concepts === 1 ? '' : 's'})`);
      if (r.broken.length) { err(`does not render: ${r.broken.join(', ')}`); return 1; }
      return 0;
    }

    if (command === 'export') {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { ...SHARED, plate: { type: 'string' }, out: { type: 'string' }, favicon: { type: 'string' }, scheme: { type: 'string' }, fill: { type: 'string' } } });
      if (values.help) { log(HELP); return 0; }
      if (positionals.length !== 1 || !values.plate || !values.out) throw new UsageError('export needs exactly one master .svg, --plate and --out');
      list(values.plate, [], 'plate');
      const [master] = inputs(positionals);
      const favicon = values.favicon ? inputs([values.favicon])[0] : master;
      const s = values.scheme ?? 'auto';
      if (s !== 'auto' && s !== 'light' && s !== 'dark') throw new UsageError('--scheme is auto, light or dark');
      const fill = num(values.fill, DEFAULT_FILL, 'fill', 0.05, 1);
      const check = checkOptions(values);
      const r = await withPage(async (page) => {
        await assertColours(page, [...check.light, ...check.dark, values.plate]);
        const scheme: Scheme = s === 'auto' ? await plateSchemeFor(page, values.plate!) : s;
        return exportSet(page, master, favicon, { out: values.out!, plate: values.plate!, scheme, fill, check });
      }, { executablePath: values.browser });
      log(r.reports.map(formatReport).join('\n\n'));
      if (!r.ok) {
        err(r.partial.length
          ? `\nexport failed partway: ${r.reason}. Already replaced in ${values.out}: ${r.partial.join(', ')}.`
          : `\nexport refused: ${r.reason}. Nothing was written.`);
        return 1;
      }
      log(`\nwrote ${r.written.length} files to ${values.out}: ${r.written.join(', ')}`);
      return 0;
    }

    throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  } catch (e) {
    if (e instanceof UsageError || (e instanceof TypeError && 'code' in e && String(e.code).startsWith('ERR_PARSE_ARGS'))) {
      err(`tabcheck: ${e.message}\n\n${HELP}`);
      return 2;
    }
    if (e instanceof EnvError) { err(`tabcheck: ${e.message}`); return 2; }
    throw e;
  }
}
