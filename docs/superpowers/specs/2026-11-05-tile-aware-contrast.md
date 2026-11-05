---
status: approved
created: 2026-11-05
---

# tabcheck 0.3.0: tile-aware contrast

> **Request (Adrian, 2026-11-05):** "tabcheck 0.3.0 makes contrast tile-aware. Detect an opaque tile
> (an opaque shape covering most of the canvas), measure the marks drawn on it against the tile
> colour, and only WARN when the tile's edge blends into the tab. [...] add a tiled fixture that must
> pass and one that must fail, and prove the gate goes red on the failing one."
> Follow-up answers (same day): an icon with a hole in it is **not a tile**, and marks must cover at
> least **10 %** of the canvas.

## Why

A common favicon style is a dark tile: a near-black rounded square with a ring or a letter drawn on
it in bright colours. On Chrome's dark tab (`#3c3c3c`) 0.2.0 scores such an icon around 22 % and
fails it, because the tile counts as part of the mark. A person sees a dark square that merges into
the tab, with a bright mark clearly readable on it. The mark is what has to read. The tile only
frames it.

## Goals

- An icon drawn on an opaque tile is judged by its marks against the tile colour, under every ground
  (light, dark, inactive, plate).
- The tile's own edge against the tab gets its own number and is a **warning only**.
- Icons without a tile are judged exactly as in 0.2.0: same numbers, byte-identical findings.

## Non-goals

- **Cut-out marks.** An icon with a hole in it (the tab showing through a letter cut out of the
  tile) is not a tile and gets the 0.2.0 rule.
- Tiles that cover only part of the canvas, such as a badge in one corner. These get the 0.2.0 rule.
- Gradient tiles get **no special handling**. The rule picks the single most frequent colour (rule
  3), and Chrome renders even a near-flat gradient as several shades of about equal count. So a
  gradient tile is detected only when one of its shades outnumbers the mark's colour and still
  covers ≥ 35 % of the canvas within 1.1:1. Otherwise it falls back to the 0.2.0 rule. Tests pin
  both sides of this. (Corrected 2026-11-05 during the build: the first wording promised detection
  of any near-flat gradient, which rule 3 does not deliver.)
- **Mark-against-mark contrast** (Adrian, 2026-11-05, after the final review): a logo shape within
  1.1:1 of the tile counts as tile, and a logo on a badge inside a framed tile is not judged against
  the badge. What is visible reads; 0.2.0 never measured this either. Listed in the README.
- Changing any threshold (`--min-ratio 3`, `--min-share 0.75`) or default ground.

## Anti-goals: these would be failures even if every test is green

- **A tiled icon whose marks do not read on their tile passes.** The tile must never carry the
  score. The must-fail fixture passes 0.2.0 on light (the tile is 20:1 on white) and fails 0.3.0.
- **A tile with almost nothing drawn on it passes** because its few marks read: a solid square, or a
  square with a speck. Under the 10 % mark floor these get the 0.2.0 rule.
- **A cut-out passes** because the hole was taken for the edge.
- **An untiled icon's result changes.**
- **Tuning the rule until a particular icon passes.**

## The rule (decided)

This runs on the same 32 px render the contrast gate already uses, once per scheme. An icon that
switches by scheme is therefore judged per scheme.

1. **Opaque** means alpha 255. Flood-fill the non-opaque pixels from the canvas border.
   - **Outside:** the non-opaque pixels the fill reaches.
   - **Hole:** any non-opaque pixel the fill does not reach. If there is one, the icon is not a tile.
2. **Edge pixels:** opaque pixels with a 4-neighbour that is outside or off the canvas. **Interior
   pixels:** the other opaque pixels.
3. **Tile colour:** the most frequent exact RGB among the interior pixels. On a tie, the lower
   relative luminance wins, then the lower `#rrggbb` string. **Tile pixels:** interior pixels at
   < 1.1:1 against the tile colour. **Mark pixels:** the other interior pixels.
4. **It is a tile when all of these hold:** there is no hole, opaque pixels cover ≥ 80 % of the
   canvas, tile pixels cover ≥ 35 %, and mark pixels cover ≥ 10 %. Otherwise the 0.2.0 rule applies
   unchanged.
5. **Blends** (added 2026-11-05 after the panel review, Adrian): a mark pixel is a blend of its
   mark and the tile. Its mark colour is the 3×3 mark neighbour furthest (in ratio) from the tile;
   its coverage is `(L(pixel) − L(tile)) / (L(mark colour) − L(tile))` in relative luminance. Pixels
   under 0.5 are skipped, as 0.2.0 skips alpha < 0.5 on a transparent canvas. The 10 % mark floor in
   rule 4 counts every mark pixel, blends included.
   **Tiled:** for each ground, `share` = the share of the remaining mark pixels at ≥ `minRatio` against the
   **tile colour**, and `median` = the median ratio of mark pixels against the tile colour. They are
   gated by `minShare` exactly as before: the first ground of the light and dark groups fails and the
   rest warn; every plate stop fails (`hard: 99`, as in 0.2.0). These two numbers do not depend on the ground.
6. **Edge:** for each ground, `edgeShare` = the share of edge pixels at ≥ `minRatio` against the
   ground, and `edgeMedian` = their median ratio. Below `minShare` → a `tile-edge` **warn**, never a
   fail.

Because a semi-transparent mark leaves non-opaque pixels that the fill cannot reach, rule 1 sends it
to the 0.2.0 rule. Anti-aliased corners of the tile are reached from outside, so they are ignored.

## Output

- **Untiled contrast lines do not change**, byte for byte.
- A tiled contrast line names what it was measured against: `dark #3c3c3c: 80% of the marks at >= 3:1
  against the tile #020617 (median …, need 75%)`.
- New finding `tile-edge` (warn): `dark #3c3c3c: the tile's edge blends into the tab (0% at >= 3:1);
  the icon reads as its marks alone`.
- `--json`: each `ContrastResult` gains an optional `tile: { colour, edgeShare, edgeMedian }`. When
  `tile` is present, `share` and `median` are measured against `tile.colour`, not against `ground`.
  The doc comment on `ContrastResult` says so.
- The whole-canvas `contrast()` stays as it is and stays callable. The tile logic is added beside it.

## Tests (Vitest, `test/`)

Fixtures sit well away from every cut-off: 80 / 35 / 10 % coverage, 1.1:1, and the 75 % share. That
way anti-aliasing differences between Chrome builds on three OSes cannot flip a result.

- `fixtures/tile-good.svg`: a `#020617` tile with a bright mark → exit 0, with a `tile-edge` warning
  on dark.
- `fixtures/tile-bad.svg`: a `#020617` tile with a `#334155` mark (1.95:1 on the tile, 10.35:1 on
  white) → exit **1**, failing light **and** dark. The same test runs the whole-canvas `contrast()` on
  it and asserts that light passes there. That is the case 0.3.0 closes.
- `fixtures/tile-cutout.svg`: a tile with a letter knocked out → not a tile, and it fails dark under
  the 0.2.0 rule.
- A full-bleed square with a speck (< 10 % marks) → not a tile, judged by the 0.2.0 rule.
- A near-flat gradient tile is detected as a tile, and a strong gradient is not.
- **No regression:** the output of `check` on every existing fixture is captured from `main` before
  the change, committed as a snapshot, and must stay identical.
- **Fail-closed proof** (`proving-fail-closed-gates`). Two mutants, run once and recorded in
  `docs/history.md`, not committed:
  - with tile detection forced off, `tile-good` fails dark;
  - with marks measured against the ground instead of the tile, `tile-bad` passes light.
- **CI:** `tile-bad.svg` joins both must-fail steps: the packed-build smoke (`ci.yml`, next to
  `low-contrast.svg`) and the action job's "A low-contrast icon fails".

## Release

Per `docs/releasing.md`, as 0.3.0 (minor: a tiled icon whose tile used to carry its score can now
fail, and tiled icons that used to fail can now pass).

## Left to the builder

Where the tile logic sits in `src/browser.ts` (`PAGE_LIB`) and `check.ts`, naming, the fixture
artwork (within the margins above), and the README section. The README section explains tiles in
general terms and names no private project.
