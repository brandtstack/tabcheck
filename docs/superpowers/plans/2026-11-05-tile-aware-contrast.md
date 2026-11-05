---
status: done
created: 2026-11-05
updated: 2026-11-05
---

# Tile-aware contrast (0.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** `check` judges an icon drawn on an opaque tile by its marks against the tile colour. The tile's edge against the tab gets a warning only.

**Architecture:** A new page-side function `tileContrast` sits beside the existing whole-canvas
`contrast` in `PAGE_LIB` (`src/browser.ts`). It detects the tile on the same 32 px render. If there
is no tile it returns `null`. `checkSvg` calls it first and falls back to `contrast` unchanged.

**Tech Stack:** TypeScript 6, Node 24, playwright-core (Chromium), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-tile-aware-contrast.md` (approved). Its "The rule"
section is normative. Copy its numbers verbatim.

## Global Constraints

- Thresholds: opaque = alpha **255**. A tile needs opaque ≥ **0.80**, tile pixels ≥ **0.35** and mark
  pixels ≥ **0.10** of the canvas, and no hole. A pixel is a tile pixel at < **1.1**:1 against the
  tile colour. `minRatio`/`minShare` and the default grounds do not change.
- An untiled icon's `check` output is **byte-identical** to 0.2.0.
- `tile-edge` is only ever `warn`.
- The repo is public. No fixture, comment, test or doc names a private project, repo, host or runner
  label (tabcheck `CLAUDE.md`).
- Exact-pin any dependency (none expected). Commit as the noreply identity, with no trailers.
- The name `tile` is taken: `src/browser.ts:164` is the sheet's tile renderer. The new function is
  `tileContrast`.

## Review Focus

1. **An icon on a near-white tile on a light tab:** the tile's edge warns on light and the marks are
   judged against the tile. Test it in Task 2 (inline SVG, a `#f8fafc` tile with a `#0f172a` disc →
   tile detected; in Task 3, `check` warns `tile-edge` on light and passes).
2. **A scheme-switching tiled icon** (its tile flips colour under `prefers-color-scheme: dark`): it
   must be detected per scheme. Test it in Task 3 (inline SVG with a `<style>` media query; the dark
   result names the dark tile colour).
3. **The plate group:** tiled results under `--plate` only warn, as before (`hard: 99`). Test it in
   Task 3 with `tile-bad` and `plate: '#ffffff'` → plate findings are `warn`, not `fail`.
4. **Ties for the tile colour:** a half-and-half square is decided by the spec's rule, not by scan
   order. Test it in Task 2 (left half `#020617`, right half `#0b1120`, a white disc → the tile colour
   is the lower luminance, `#020617`).
5. **16 px is not used:** detection runs at 32 only. No test; the plan never adds a 16 px pass.

---

### Task 1: Pin today's untiled output

**Files:**
- Create: `test/untiled-snapshot.test.ts` (+ the generated `test/__snapshots__/untiled-snapshot.test.ts.snap`)

**Interfaces:** Produces the snapshot that Tasks 2-3 must leave unchanged.

- [x] **Step 1:** Write the test `untiled output is unchanged`: for each of `good`, `low-contrast`,
  `scheme-switch`, `blank`, `text`, `bad-xml`, run `checkSvg(page, f.file, f.svg, DEFAULTS)` and
  `expect(formatReport(r).replace(FIXTURES, '<fixtures>')).toMatchSnapshot()`. Also add one case with
  `{ ...DEFAULTS, plate: '#1b2a4a' }` on `good`.
- [x] **Step 2:** Run `npx vitest run test/untiled-snapshot.test.ts` on the **unchanged** code. The
  snapshot file is written. Read it and check it holds real contrast lines (not empty).
- [x] **Step 3:** Commit `test: pin the 0.2.0 output of every untiled fixture`.

### Task 2: Detect the tile and measure on it (`tileContrast`)

**Files:**
- Modify: `src/browser.ts`: `PAGE_LIB` (new `tileContrast`, add it to the returned object at
  `:295`), `PageWindow`, and an exported wrapper. Update the `ContrastResult` doc comment (`:128-134`).
- Create: `fixtures/tile-good.svg`, `fixtures/tile-bad.svg`, `fixtures/tile-cutout.svg`
- Test: `test/tile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TileInfo { colour: string /* #rrggbb */; opaque: number; tile: number; marks: number /* canvas shares 0..1 */ }
  export interface TileResult extends ContrastResult { tile: { colour: string; edgeShare: number; edgeMedian: number } }
  export async function tileContrast(page: Page, svg: string, size: number, grounds: string[], minRatio: number): Promise<{ info: TileInfo; results: TileResult[] } | null>
  ```
  It returns `null` when rule 4 does not hold. `ContrastResult` gains `tile?: { colour; edgeShare; edgeMedian }`.

**Fixtures** (viewBox `0 0 32 32`, each with a `<title>fixture: …</title>` like the existing ones):
- `tile-good`: `<rect width="32" height="32" rx="6" fill="#020617"/>` plus a `#f0f9ff` disc,
  `r="10"` at the centre. That gives marks ≈ 31 %, tile ≈ 60 % and opaque ≈ 97 %, well clear of every
  cut-off.
- `tile-bad`: the same, with the disc `#334155`.
- `tile-cutout`: the same rect with a disc `r="8"` knocked out (`fill-rule="evenodd"` in one path),
  plus a `#f0f9ff` bar of 4×20 inside the rect, not touching the hole.

- [x] **Step 1: Write the failing tests** in `test/tile.test.ts` (`openPage` in `beforeAll`, as in
  `gates.test.ts`). Each runs `tileContrast(page, svg, 32, ['#ffffff', '#3c3c3c'], 3)`:
  - `tile-good` → `info.colour === '#020617'`. `info.marks` is in 0.2–0.45 and `info.opaque > 0.9`.
    Every result has `share >= 0.9`, and the same share for both grounds. `tile.edgeShare` is
    `>= 0.75` on `#ffffff` and `< 0.75` on `#3c3c3c`.
  - `tile-bad` → detected, and every `share < 0.1`.
  - `tile-cutout` → `null` (hole).
  - Speck (inline: a full `#3c3c3c` rect plus a 3×4 `#ffffff` rect) → `null` (marks < 10 %).
  - Near-flat gradient (inline: a full rect, `linearGradient` `#020617`→`#030819`, white disc
    `r="10"`) → detected.
  - Strong gradient (`#020617`→`#64748b`, same disc) → `null`.
  - Tie (Review Focus 4) → `info.colour === '#020617'`.
  - Near-white tile (Review Focus 1) → detected, and `info.colour === '#f8fafc'`.
  - Every existing fixture (`good`, `low-contrast`, `scheme-switch`, `text`) → `null`.
- [x] **Step 2:** Run `npx vitest run test/tile.test.ts`. Expected: FAIL, because `tileContrast` is
  not exported.
- [x] **Step 3: Implement `tileContrast`** in `PAGE_LIB`, exactly per spec §The rule 1-6:
  - Flood-fill the non-opaque pixels from the border to find outside and holes.
  - Edge pixels are opaque pixels with a 4-neighbour outside or off the canvas. Interior pixels are
    the rest.
  - The tile colour is the modal interior RGB. Break ties by lower `lum`, then the lower hex string.
  - Tile pixels are at `ratio < 1.1` against the tile colour; mark pixels are the rest.
  - Apply the rule 4 gate.
  - For each ground: `share`/`median` of the mark ratios against the tile colour (sort, `rs[rs.length >> 1]`,
    as in `contrast`), and `edgeShare`/`edgeMedian` of the edge pixels against the ground.
  - Reuse `draw`, `rgb`, `lum` and `ratio`.
  - Add a ⚠️ comment at the top citing the spec file (tripwire + pointer).
- [x] **Step 4:** Run `npx vitest run test/tile.test.ts test/untiled-snapshot.test.ts`. Expected:
  PASS, with the snapshot untouched.
- [x] **Step 5:** Commit `feat: detect an opaque tile and measure its marks against it`.

### Task 3: Gate on it in `check`

**Files:**
- Modify: `src/check.ts:91-114` (the contrast loop) and `test/gates.test.ts:30` (the fixture list
  gains `tile-bad`, `tile-cutout`, `tile-good`, plus `it.each` rows)
- Test: `test/tile.test.ts` (new `describe('check on tiles')`)

**Interfaces:** Consumes `tileContrast` and `TileResult` from Task 2.

**Copy (exact, from the spec §Output):**
- The tiled contrast line is `${label}${suffix} ${ground}: ${pct}% of the marks at >= ${minRatio}:1 against the tile ${colour} (median ${m}:1, need ${need}%)`. `suffix` is `''` or `' (inactive tab)'`, exactly as the untiled line has it today.
- The `tile-edge` warn is `${label}${suffix} ${ground}: the tile's edge blends into the tab (${pct}% at >= ${minRatio}:1); the icon reads as its marks alone`.

- [x] **Step 1: Write the failing tests:**
  - `gates.test.ts` fixture rows: `tile-good` → `null`, `tile-bad` → `'contrast'`,
    `tile-cutout` → `'contrast'`.
  - `tile-good` passes dark and gets exactly one `warn` with gate `tile-edge` per dark ground
    (`#3c3c3c`, `#1f2020`) and none on light.
  - `tile-bad` fails **both** light and dark: the `fail` findings include a line starting `light
    #ffffff` and a line starting `dark #3c3c3c`.
  - The same test calls the whole-canvas `contrast(page, svg, 32, ['#ffffff'], 3)` on `tile-bad` and
    asserts `share >= 0.75`. That is the 0.2.0 pass that 0.3.0 closes.
  - `main(['check', tileBad])` returns **1** and `main(['check', tileGood])` returns **0** (use the
    pattern `gates.test.ts` already uses for `main`).
  - `--json` on `tile-good`: `contrast[*].tile.colour === '#020617'`.
  - Review Focus 2: a scheme-switching tile. The `dark` result's `tile.colour` is the dark-scheme
    tile, and the light one is the light-scheme tile.
  - Review Focus 3: `tile-bad` with `plate: '#ffffff'` gives plate findings at level `warn` only.
  - Review Focus 1: the near-white tile `check` → `ok`, with a `tile-edge` warn on light.
- [x] **Step 2:** Run `npx vitest run`. Expected: the new cases FAIL and the snapshot PASSES.
- [x] **Step 3: Implement.** In the per-group loop, call `tileContrast` first. If it returns `null`,
  run the existing code path untouched. Otherwise push the tiled line at the same level logic
  (`passed ? 'info' : i < g.hard ? 'fail' : 'warn'`), and a `tile-edge` warn when
  `edgeShare < minShare`. Push the `TileResult`s into `c`.
- [x] **Step 4:** Run `npm run verify`. Expected: typecheck, build and all tests PASS, with the
  snapshot unchanged.
- [x] **Step 5: Mutants**, run once and not committed:
  - (a) make `tileContrast` return `null` always → `tile-good` must fail dark;
  - (b) measure marks against the ground instead of the tile colour → the `tile-bad` light assertion
    must fail.
  Record both outputs for Task 4's history entry, then `git checkout src/`.
- [x] **Step 6:** Commit `feat: judge tiled icons by their marks, warn on a blending tile edge`.

### Task 4: CI, docs, version

**Files:**
- Modify: `.github/workflows/ci.yml` (smoke `Run it` at about `:52`; the action job's "A low-contrast
  icon fails" at about `:88`), `README.md`, `package.json` + `package-lock.json` (`0.3.0`),
  `action.yml` (the `version` default, which must equal `package.json`, and a test enforces it),
  `docs/history.md`

- [x] **Step 1: Smoke.** Add a second must-fail next to `low-contrast.svg`, with the same `if …; then
  ::error …; exit 1` shape, for `tile-bad.svg`.
- [x] **Step 2: Action job.** Add `fixtures/tile-bad.svg` as a second line of `path:` in the
  must-fail step. Check that the step after it still asserts exit **1** exactly.
- [x] **Step 3: README.** Add a short "Tiled icons" section: what counts as a tile (the 4
  conditions), what is measured, the `tile-edge` warning, and that holes and gradients fall back.
  Keep it general and name no project.
- [x] **Step 4: Version.** Run `npm version 0.3.0 --no-git-tag-version` and update the `action.yml`
  default. Run `npm run verify`. Expected: PASS, including the action-version test.
- [x] **Step 5: History.** Add a `docs/history.md` entry "2026-11-05: 0.3.0, tile-aware contrast"
  with: the rule in one line, the two mutant results from Task 3 Step 5, and the fixtures. Keep it
  general and name no private repo.
- [x] **Step 6:** Commit `feat: tabcheck 0.3.0, tile-aware contrast` and set this plan's
  `status: done`. (Versions here are not minted from the PR title: the tag is pushed by hand per
  `docs/releasing.md` step 2.)

**After the plan (host, not a task):** PR → panel review → merge → release per `docs/releasing.md`
(Adrian approves on npmjs.com; `v1` moves only after `npm view tabcheck version` = 0.3.0, Adrian's
push) → the rollout in `.superpowers/0.3.0-rollout.md`.
