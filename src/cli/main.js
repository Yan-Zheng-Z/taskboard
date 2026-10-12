#!/usr/bin/env node
import { run } from './run.js';

process.exitCode = run(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
});
