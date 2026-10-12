// Regenerates integrations/<agent>/taskboard/SKILL.md from src/core/skill-text.js.
// Run after changing the instructions: node scripts/build-skills.js
// A test fails when the files and the generator disagree.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILT_IN_SKILLS, skillFile } from '../src/core/skill-text.js';

for (const { folder, by, sandbox } of BUILT_IN_SKILLS) {
  const file = fileURLToPath(new URL(`../integrations/${folder}/taskboard/SKILL.md`, import.meta.url));
  fs.writeFileSync(file, skillFile({ by, sandbox }));
  console.log(`wrote ${file}`);
}
