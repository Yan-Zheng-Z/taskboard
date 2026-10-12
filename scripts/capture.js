// Development helper: opens the widget, optionally runs some page script, saves a screenshot.
//   npx electron scripts/capture.js <out.png> [script-file.js] [wait-ms]
// The page script can be async; its return value is printed. Use TASKBOARD_HOME for sample data
// and TASKBOARD_THEME=light|dark to force a colour scheme.

import { app, nativeTheme } from 'electron';
import fs from 'node:fs';
import { createWidgetWindow, connectWindow } from '../src/widget/window.js';

const [outFile, scriptFile, waitMs = '400'] = process.argv.slice(2);

app.whenReady().then(async () => {
  const window = createWidgetWindow();
  // TASKBOARD_CAPTURE_AGENT="<script> <mode>" runs that script with Node in place of Claude Code;
  // TASKBOARD_CAPTURE_AGENT=none pretends no agent is installed.
  const stand = process.env.TASKBOARD_CAPTURE_AGENT;
  const options = {};
  if (stand === 'none') options.launch = null;
  else if (stand) options.launch = { command: process.execPath, args: stand.split(' '), env: { ELECTRON_RUN_AS_NODE: '1' } };
  const stop = connectWindow(window, options);
  if (process.env.TASKBOARD_THEME) nativeTheme.themeSource = process.env.TASKBOARD_THEME;
  window.webContents.on('console-message', (_event, _level, message) => console.log(`[page] ${message}`));
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (scriptFile) {
    const source = fs.readFileSync(scriptFile, 'utf8');
    try {
      const result = await window.webContents.executeJavaScript(`(async () => { ${source} })()`);
      if (result !== undefined) console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      // Without this a broken page script would leave the window open forever.
      console.error(`page script failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Number(waitMs)));
  fs.writeFileSync(outFile, (await window.webContents.capturePage()).toPNG());
  stop();
  app.quit();
});
