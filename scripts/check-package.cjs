// Validate the files consumers receive, not merely the source checkout.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const manifest = require('../package.json');
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }));
const files = new Set(packed.files.map(file => file.path));
for (const entry of [manifest.main, manifest.types]) {
  assert.ok(entry && existsSync(resolve(entry)), 'Missing built entry: ' + entry);
  assert.ok(files.has(entry), 'Entry excluded from package: ' + entry);
}
assert.ok(Object.keys(require(resolve(manifest.main))).length > 0, 'No public exports');
console.log('Built runtime and declaration entries are present in the package.');
