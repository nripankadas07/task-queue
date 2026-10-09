const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
test('the locked dependency graph contains no vulnerable sprintf-js', () => {
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  assert.deepEqual(Object.keys(lock.packages).filter(p => p.endsWith('/sprintf-js')), []);
  const yamlPath = path.dirname(require.resolve('js-yaml/package.json', {paths: [path.dirname(require.resolve('@istanbuljs/load-nyc-config'))]}));
  const argparse = require.resolve('argparse/package.json', {paths: [yamlPath]});
  assert.equal(JSON.parse(fs.readFileSync(argparse, 'utf8')).version, '2.0.1');
});
test('NYC YAML configuration retains arrays, booleans and kebab-case fields', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyc-audit-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{}');
    fs.writeFileSync(path.join(dir, '.nycrc.yml'), 'include: [src/**]\nexclude: [test/**]\nall: true\ncheck-coverage: true\n');
    const {loadNycConfig} = require('@istanbuljs/load-nyc-config');
    const config = await loadNycConfig({cwd: dir, nycrcPath: '.nycrc.yml'});
    assert.deepEqual(config.include, ['src/**']); assert.deepEqual(config.exclude, ['test/**']);
    assert.equal(config.all, true); assert.equal(config.checkCoverage, true);
    fs.writeFileSync(path.join(dir, '.nycrc.yml'), 'include: [unterminated');
    await assert.rejects(loadNycConfig({cwd: dir, nycrcPath: '.nycrc.yml'}));
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
test('legacy js-yaml CLI still parses valid input and rejects invalid input', () => {
  const yamlPath = path.dirname(require.resolve('js-yaml/package.json', {paths: [path.dirname(require.resolve('@istanbuljs/load-nyc-config'))]}));
  const cli = path.join(yamlPath, 'bin/js-yaml.js');
  const ok = cp.spawnSync(process.execPath, [cli, '--compact'], {input: 'count: 4\n', encoding: 'utf8', timeout: 3000});
  assert.equal(ok.status, 0); assert.deepEqual(JSON.parse(ok.stdout), {count: 4});
  const bad = cp.spawnSync(process.execPath, [cli], {input: 'count: [unterminated', encoding: 'utf8', timeout: 3000});
  assert.equal(bad.status, 1); assert.match(bad.stderr, /YAMLException/);
});

// Regression cases for GHSA-8r5x-fm3f-whwj and GHSA-p8wg-vrv2-v86f.
// See upstream advisories; these fixtures do not execute injected commands.
test('Handlebars rejects a Program with non-array block parameters', () => {
  const h = require('handlebars');
  const ast = h.parse('{{#if ok}}hello{{/if}}');
  ast.body[0].program.blockParams = {length: '0'};
  assert.throws(() => h.precompile(ast), /blockParams|array|Array/);
  assert.equal(h.compile('{{#if ok}}hello {{name}}{{/if}}')({ok:true,name:'reader'}), 'hello reader');
});
test('Handlebars prevents prototype constructor lookup while preserving plain data', () => {
  const h = require('handlebars');
  h.registerHelper('inspect', (value, options) => options.lookupProperty(value, 'constructor') === Function ? 'exposed' : 'blocked');
  assert.equal(h.compile('{{inspect target}}')({target:Function.prototype}, {allowProtoMethodsByDefault:true}), 'blocked');
  assert.equal(h.compile('{{constructor.name}}')({constructor:{name:'ordinary'}}), 'ordinary');
});
