import { defineConfig } from 'vitest/config';

// Every test drives a real Chromium, so they are slow by unit-test standards and run one file at a time.
export default defineConfig({ test: { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } });
