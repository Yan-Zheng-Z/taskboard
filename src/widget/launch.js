#!/usr/bin/env node
// The `taskboard` command: starts the widget and returns to the shell.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const appDir = fileURLToPath(new URL('../../', import.meta.url));

spawn(electron, [appDir], { detached: true, stdio: 'ignore' }).unref();
