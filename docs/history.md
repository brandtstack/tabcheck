# History

## 2026-11-05: v0.1.0 built

Spec approved in plan-viewer with no flags. Ported `check`, `render-sheet` → `sheet`, `export` (minus the share card) from icon-kit (unpublished) into one CLI with exit codes 0/1/2; added browser resolution (explicit path → installed Chrome → Playwright cache), the page-level network block, and Vitest cases for every gate.

Measured while building:

- Removing the route block left the hostile-SVG test green: an SVG drawn through `<img>` gets no network in Chromium anyway. Added a page-level `fetch` test, which goes red without the block.
- The sheet screenshot padded to the 1600×900 viewport; it now screenshots `body`, which is `max-content` wide.
- brandtstack's `icon.svg` passes (`dark` inactive strip warns at 73 %); its maskable size reads 413 px against the 408 hand-derived in its icon README.

Left open:

- **Tab colours not re-measured** in current Chrome (156): the Mac was locked. The README no longer claims a measurement date.
- **npm publish is Adrian's step**: log in to npm, publish 0.1.0 once (or claim the name), add `brandtstack/tabcheck` + `release.yml` as trusted publisher.
