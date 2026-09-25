// Bumps APP_VERSION in src/version.js by 1. Invoked by .githooks/pre-commit
// on every commit, so a stale cached tab is easy to spot. Uses plain string
// replacement (not sed) so unrelated formatting/line endings are untouched.
// .cjs (not .js) because the project's package.json sets "type": "module".
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'version.js');
const content = fs.readFileSync(file, 'utf8');
const match = content.match(/export const APP_VERSION = (\d+)/);

if (!match) {
  console.error('bump-version: APP_VERSION not found — skipping bump');
  process.exit(0);
}

const next = Number(match[1]) + 1;
const updated = content.replace(/export const APP_VERSION = \d+/, `export const APP_VERSION = ${next}`);
fs.writeFileSync(file, updated, 'utf8');
console.log(`bump-version: APP_VERSION ${match[1]} -> ${next}`);
