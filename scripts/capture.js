// Development helper: opens the widget, optionally runs some page script, saves a screenshot.
//   npx electron scripts/capture.js <out.png> [script-file.js] [wait-ms]
// The page script can be async; its return value is printed. Use TASKBOARD_HOME for sample data.

import { app } from 'electron';
import fs from 'node:fs';
import { createWidgetWindow, connectWindow } from '../src/widget/window.js';

const [outFile, scriptFile, waitMs = '400'] = process.argv.slice(2);

app.whenReady().then(async () => {
  const window = createWidgetWindow();
  const stop = connectWindow(window);
  window.webContents.on('console-message', (_event, _level, message) => console.log(`[page] ${message}`));
  await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (scriptFile) {
    const source = fs.readFileSync(scriptFile, 'utf8');
    const result = await window.webContents.executeJavaScript(`(async () => { ${source} })()`);
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  }
  await new Promise((resolve) => setTimeout(resolve, Number(waitMs)));
  fs.writeFileSync(outFile, (await window.webContents.capturePage()).toPNG());
  stop();
  app.quit();
});
