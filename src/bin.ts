#!/usr/bin/env node
import { main } from './cli.ts';

// Exit 1 means "a gate failed", so a crash must not land there: CI scripts branch on it.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  console.error('tabcheck crashed. This is a bug; please report it at https://github.com/brandtstack/tabcheck/issues');
  console.error(e);
  process.exitCode = 3;
}
