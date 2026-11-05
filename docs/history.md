# History

## 2026-11-05: v0.1.0 built

Spec approved in plan-viewer with no flags. Ported `check`, `render-sheet` → `sheet`, `export` (minus the share card) from icon-kit (unpublished) into one CLI with exit codes 0/1/2; added browser resolution (explicit path → installed Chrome → Playwright cache), the page-level network block, and Vitest cases for every gate.

Measured while building:

- Removing the route block left the hostile-SVG test green: an SVG drawn through `<img>` gets no network in Chromium anyway. Added a page-level `fetch` test, which goes red without the block.
- The sheet screenshot padded to the 1600×900 viewport; it now screenshots `body`, which is `max-content` wide.
- brandtstack's `icon.svg` passes (`dark` inactive strip warns at 73 %); its maskable size read 413 px against the 408 hand-derived in its icon README; after review round 1 (shared geometry with a 3% margin) it reads 401.

Left open:

- **Tab colours not re-measured** in current Chrome (156): the Mac was locked. The README no longer claims a measurement date.
- npm: 0.1.0 published by Adrian 2026-11-05 (2FA had to be enabled first; npm shows a `0.0.0-stage` placeholder for ~2 min while it processes). **Trusted publisher not yet added** (package settings → `brandtstack/tabcheck`, `release.yml`).

## 2026-11-05: review round 1 (PR #1)

A cold `/code-review medium` of `src/` found 10 issues; all reproduced on reading and all fixed, one test each (`test/review-round-1.test.ts`): colour lists split inside `rgb()`; a mistyped colour measured as black; `--light ,` silently skipped the light gate; `sheet --out` without `.png` crashed; a failed export write could leave a mixed set while claiming "nothing written" (now staged, then moved); `renderSheet` left the page without its library; crashes exited 1 (now 3); the maskable maths existed in three disagreeing copies (now `geometry.ts`); `--help` on a subcommand was an error; `--min-share 75` and `--min-ratio 0.5` were accepted.

Panel on PR #1 (security clean; correctness 4 findings, all fixed with tests): a dark `rgb()`/`hsl()`/named plate got the light scheme (`plateSchemeFor` was hex-only, now browser-resolved and async); `openPage({ scheme })` was overridden by `resetPage`; `inherit`/`var()` passed `CSS.supports` and then crashed the canvas (now resolved through a two-sentinel `fillStyle` test); the README overstated sheet/export parity.
