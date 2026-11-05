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

## 2026-11-05: 0.1.1, staged releases

The npm trusted publisher (`brandtstack/tabcheck`, `release.yml`) is allowed **`npm stage publish` only**, Adrian's choice: a tag stages the version, and it goes live once he approves it on npmjs.com with 2FA. `release.yml` installs npm 11.19.1 first, because `npm stage` is newer than the npm bundled with the runner's Node. npm requires one publish through a new trusted publisher within two days to validate it; 0.1.1 is that publish.

## 2026-11-05: the GitHub Action (PR #4), `v1`

`action.yml` (composite): installs the pinned tabcheck in `$RUNNER_TEMP` (run from there, so the caller's project `.npmrc` cannot steer it), installs `chromium-headless-shell` only when no Chrome is found (`install-browser: auto`), runs `check` with every flag as an input and the paths after `--`, and exposes `exit-code`. Inputs reach bash through `env` only. Release order is in `docs/releasing.md`: `v1` moves only after the npm approval.

CI `action` job: the PR's own tarball on ubuntu, macOS and Windows × `install-browser` auto/true, a must-fail that asserts exit **1** exactly, and an option-injection probe (`--min-ratio=1` as a path line: exit 0 if read as a flag, 2 as a path; proven to give 0 with the `--` removed). Every hosted runner ships Chrome, which tabcheck prefers, so `action-no-chrome` (a bare `node:24-bookworm` container) is the only job that renders with the installed Chromium.

Panel (security, correctness, backend; 6 distinct findings, all fixed): option injection via a `-`-leading path line (`--browser=./x` would pick the executable launched); the must-fail accepted any failure; `v1` could move before a staged version is live; the caller's `.npmrc` applied; a CI comment overclaimed the browser paths; `v*` tags were unprotected (now the `release tags` ruleset: create/update/delete, repo-admin bypass). `release.yml` triggers on `vX.Y.Z` only, so moving `v1` starts no release (checked after the first `v1` push).

Measured while building: inside a container `${{ github.workspace }}` is the host path; `$GITHUB_WORKSPACE` is right in containers and on Windows (bash's `$PWD` there is `/d/a/...`, which Windows npm cannot open). One `verify (24)` run timed out launching Chromium in `beforeAll` and passed on re-run (cause unknown, untouched code). One `--with-deps` install took 8.5 min on a slow Azure apt mirror.

## 2026-11-05: 0.2.0, measured tab colours

New defaults, Chrome 156 default theme on macOS: light `#ffffff` / `#d3e3fd`, dark `#3c3c3c` / `#1f2020` (was `#ffffff`/`#dee1e6`, `#202124`/`#35363a`). Light came from Adrian's screenshot, tagged with the display profile ("Color LCD"): raw pixels read `#d6e2fb`, converted to sRGB `#d3e3fd`. Dark is the earlier one-off capture (not re-converted; neutral greys move by about one step). In dark mode the active tab is now the lighter of the two.

Effects: `fixtures/good.svg` (one orange) fell to 2.99:1 on `#3c3c3c` and moved from `#e4572e` to `#ea6540` (3.26:1 on white, 3.38:1 on dark): a single colour now has a narrow band. brandtstack.com's own `icon.svg` now **fails** dark at 73 % (needs 75 %). The README sheet was rebuilt from its sources, now tracked in `docs/img/src/`.

## 2026-11-05: 0.3.0, tile-aware contrast

Spec: `docs/superpowers/specs/2026-11-05-tile-aware-contrast.md`. An icon drawn on an opaque tile (≥ 80 % opaque with no hole, ≥ 35 % one colour, ≥ 10 % marks, at 32 px) is judged by its marks against the tile colour; the tile's edge against the tab is a `tile-edge` warning only. Everything else goes through the 0.2.0 path: byte-identical output was proven against a snapshot captured before the change, then replaced by `test/untiled.test.ts` (no tile, the 0.2.0 line format), because exact percentages move between canvas backends and the snapshot came from the Mac while CI runs Linux (final review I-4).

Fixtures: `tile-good` (passes, warns on dark), `tile-bad` (a `#334155` mark on `#020617`, 1.95:1: fails light and dark, where the 0.2.0 rule passes light because the tile is 20:1 on white), `tile-cutout` (a hole: not a tile, fails dark). CI runs `tile-bad` with both tabs white (`--dark '#ffffff'`) as a must-fail in the packed smoke and as its own exit-1 step in the action job: on default grounds 0.2.0 fails it too (the dark tile on the dark tab), so only white tabs tell the two apart (final review I-3; 0.2.0 exits 0 there, 0.3.0 exits 1).

Panel review (PR #7): security clean; backend 1 low; correctness found that blends between a mark and the tile all counted as marks, where 0.2.0 skips alpha < 0.5. Now a mark pixel under half coverage (estimated against its strongest 3×3 mark neighbour) is skipped; `tile-thin` (1.2 px strokes) scores 70 % without the cut and 100 % with it. A real dark-tile icon went from 74 % to 88 % with no change to the icon. A dim stroke one or two pixels wide right next to a bright one is skipped as a blend; the bright one still has to read.

Proven red: forcing detection off turns 12 tile tests red (`tile-good` fails dark); measuring marks against the tab instead of the tile turns 8 red (`tile-bad` passes light).

Measured while building:

- **The canvas backend moves the score.** tabcheck draws on a software canvas (`willReadFrequently`); a spike on a GPU canvas read a real dark-tile icon 6 points higher (80 % vs 74 %) from the same SVG, through different anti-aliasing. Fixtures sit far from every cut-off for this reason.
- Chrome renders a 32 px gradient as a few shades of about equal count, so a gradient tile is detected only when one shade outnumbers the mark's colour. The spec's first wording promised more; corrected in the spec, both sides tested.
- Every plate stop is a hard gate (`hard: 99`), tiled or not. The draft spec said the plate only warns; corrected.
