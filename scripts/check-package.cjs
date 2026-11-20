'use strict';
// Standalone repository shape/identity checks. Not Cursor's loader or a Marketplace review.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=k=>fs.readFileSync(path.join(ROOT,k),'utf8');
const manifest=JSON.parse(read('.cursor-plugin/plugin.json')), pkg=JSON.parse(read('package.json'));
function relativeAsset(rel,kind) {
  assert(typeof rel==='string' && rel.length && !rel.includes('\\') && !rel.startsWith('/') && !rel.includes(':') && !rel.split('/').includes('..'), 'relative '+kind);
  const resolved=fs.realpathSync(path.resolve(ROOT,rel));
  assert(resolved.startsWith(fs.realpathSync(ROOT)+path.sep),'asset exists within root');
  return resolved;
}
function frontmatter(file,id) {
  const doc=read(file); const fm=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(doc);
  assert(fm,'frontmatter exists: '+file);assert(fm[1].split(/\r?\n/).includes('name: '+id));
  assert(/^description: \S.+$/m.test(fm[1]),'missing description: '+file);
}
assert.match(manifest.name,/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/);assert.equal(manifest.name,pkg.name);
assert.equal(manifest.version,pkg.version);assert.equal(pkg.private,true);
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.ok(manifest.description.length>24);
assert(fs.statSync(relativeAsset(manifest.skills,'skills')).isDirectory());assert(fs.statSync(relativeAsset(manifest.commands,'commands')).isDirectory());
if(manifest.logo) assert(fs.statSync(relativeAsset(manifest.logo,'logo')).isFile());
frontmatter('skills/edge-case-studio/SKILL.md',manifest.name);frontmatter('commands/edge-case-matrix.md','edge-case-matrix');
assert(fs.statSync(relativeAsset('./scripts/edge-case.cjs','generator')).isFile());
assert(read('README.md').includes('examples/checkout-report.html'));assert(read('README.md').includes('--stdin'));
assert(!manifest.mcpServers && !manifest.hooks && !manifest.variables && !pkg.dependencies && !pkg.devDependencies);
const mcp=JSON.parse(read('mcp.json'));
assert.deepEqual(mcp,{mcpServers:{'checkout-fixtures':{command:'node',args:['${CURSOR_PLUGIN_ROOT}/scripts/checkout-mcp.cjs']}}});
assert(fs.statSync(relativeAsset('./scripts/checkout-mcp.cjs','checkout adapter')).isFile());
const first=JSON.parse(read('examples/checkout.cases.jsonl').split('\n')[0]);assert.match(pkg.fixtureGeneratorVersion,/^\d+\.\d+\.\d+$/);assert.equal(first.version,pkg.fixtureGeneratorVersion);
const core=require('./edge-case.cjs');assert.equal(core.generate(core.EXAMPLE).version,pkg.fixtureGeneratorVersion);
console.log('Single-plugin layout, names, component paths/frontmatter, MCP entry point, package version and fixture generator version verified. Optional logo: '+(manifest.logo||'not included')+'. No IDE or listing check implied.');

