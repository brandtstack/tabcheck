/**
 * The action pins the npm version it runs. The v1 tag moves with each release, so the pin must be
 * bumped in the same commit as package.json, or v1 would keep running the old release.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

describe('action.yml', () => {
  it('pins the version in package.json', () => {
    const action = readFileSync(resolve(ROOT, 'action.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };
    const block = action.match(/^ {2}version:\n(?: {4}.*\n)*/m)?.[0] ?? '';
    const pinned = block.match(/^ {4}default: ['"]?([^'"\s]+)/m)?.[1];
    expect(pinned, 'no `default:` under inputs.version').toBeDefined();
    expect(pinned).toBe(pkg.version);
  });

  it('never interpolates an input into a script (script injection)', () => {
    const action = readFileSync(resolve(ROOT, 'action.yml'), 'utf8');
    const scripts = [...action.matchAll(/^ {6}run: \|\n((?: {8}.*\n|\n)*)/gm)].map((m) => m[1]);
    expect(scripts.length).toBe(2);
    for (const s of scripts) expect(s).not.toContain('${{');
  });
});
