# Releasing

1. Bump `version` in `package.json` **and** the `version` default in `action.yml` (a test fails if
   they differ). PR, merge.
2. Push the tag: `git tag vX.Y.Z origin/main && git push origin vX.Y.Z`. `release.yml` runs verify
   and **stages** the version through npm trusted publishing (no token).
3. Approve it on npmjs.com → the package → Staged Packages, with 2FA. (`npm stage approve` with a
   security key only prints that URL and exits.)
4. **Only after** `npm view tabcheck@X.Y.Z version` prints it, move the action tag:
   `git tag -f v1 vX.Y.Z && git push -f origin v1`.
   ⚠️ Moving `v1` first breaks every `uses: brandtstack/tabcheck@v1` run (npm ETARGET) until the
   approval lands, because `v1` runs the version its `action.yml` pins.

`release.yml` triggers on `vX.Y.Z` tags only, so moving `v1` never starts a release. A tag ruleset
limits creating, moving and deleting `v*` tags to repository admins.

A breaking change to the action's inputs gets a new major tag (`v2`), never a move of `v1`.
