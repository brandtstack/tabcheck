/** Programmatic API. The CLI (`tabcheck`) is the main interface; these are the same building blocks. */
export { withPage, EnvError, type Scheme, type BrowserOptions } from './browser.ts';
export { checkSvg, lint, formatReport, DEFAULTS, plateSchemeFor, type CheckOptions, type CheckReport, type Finding } from './check.ts';
export { renderSheet, type SheetOptions } from './sheet.ts';
export { exportSet, type ExportOptions, type ExportResult } from './export.ts';
export { collectSvgs, type SvgFile } from './files.ts';
export { main } from './cli.ts';
