'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), cp=require('node:child_process'),path=require('node:path');
const exe=path.resolve(__dirname,'../scripts/edge-case.cjs');
function run(args,input='') {return cp.spawnSync(process.execPath,[exe,...args],{input,encoding:'utf8',timeout:5000,maxBuffer:4*1024*1024});}
test('formatted stdout, empty stderr and deterministic content',()=>{
  const json=run([]),lines=run(['--format','jsonl']),html=run(['--format','html']);
  for(const result of [json,lines,html]) {assert.equal(result.status,0);assert.equal(result.stderr,'');}
  const suite=JSON.parse(json.stdout);assert.equal(suite.counts.total,45);assert.equal(lines.stdout.trimEnd().split('\n').length,45);assert.ok(html.stdout.includes('TEST MATRIX'));
});
test('custom input and seed do not read fixture records',()=>{
  const res=run(['--stdin','--seed','custom-87'],JSON.stringify({type:'object',properties:{checkout:{type:'boolean'}}}));assert.equal(res.status,0);
  const suite=JSON.parse(res.stdout);assert.equal(suite.seed,'custom-87');assert.equal(suite.counts.total,6);
});
test('invalid input exits 2 with stderr and zero stdout',()=>{
  for(const [args,input] of [
    [['--unknown'],''],[['--seed','--stdin'],''],[['--format','pdf'],''],[['--stdin','--stdin'],''],[['--stdin'],' '.repeat(32769)],
    [['--stdin'],'{"type":"string","type":"object"}'],[['--stdin'],'{"$ref":"https://example.invalid/schema"}'],[['--stdin'],Buffer.from([0xc3,0x28])],
    [['--stdin'],'NOT JSON']
  ]) {const res=run(args,input);assert.equal(res.status,2,res.stderr);assert.match(res.stderr,/^edge-case: /);assert.equal(res.stdout,'');}
});
test('--help is local and does not start a generator',()=>{const res=run(['--help']);assert.equal(res.status,0);assert.match(res.stdout,/--stdin/);assert.equal(res.stderr,'');});

test('literal double-hyphen seeds replay and duplicate flags cannot silently replace them',()=>{
  const result=run(['--seed=--example']);assert.equal(result.status,0);assert.equal(JSON.parse(result.stdout).seed,'--example');
  for(const args of [['--seed=A','--seed','B'],['--seed','A','--seed=B'],['--seed=A','--seed=B'],['--seed=']]) {
    const x=run(args);assert.equal(x.status,2);assert.equal(x.stdout,'');
  }
});
test('refusals are bounded single-line messages even for nonprintable or oversized keys',()=>{
  for(const key of ['long-key-'.repeat(2000),'bad\nfield','name\u202e',"bad\u001bkey"]) {
    const res=run(['--stdin'],JSON.stringify({type:'object',properties:{[key]:{type:'boolean'}}}));
    assert.equal(res.status,2);assert.equal(res.stdout,'');assert.ok(res.stderr.length<460);
    assert.doesNotMatch(res.stderr.trimEnd(),/[\n\r\u0000-\u001f\u007f-\u009f\u2028-\u202e]/);
  }
});
test('UTF-8 input byte ceiling is exact, BOM is accepted, numeric precision refusals have no partial stdout',()=>{
  const simple='{"type":"object","properties":{}}';
  for(const [input,status] of [[simple.padEnd(32768),0],[simple.padEnd(32769),2],['\ufeff'+simple,0],
    ['{"type":"object","properties":{"x":{"type":"integer","minimum":1.0000000000000000001}}}',2]]) {
    const r=run(['--stdin'],input);assert.equal(r.status,status);if(status===2)assert.equal(r.stdout,'');
  }
});
