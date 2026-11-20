'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const path=require('node:path'), fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'mcp.json'),'utf8')).mcpServers['checkout-fixtures'];
assert.equal(config.command,'node');
const args=config.args.map(a=>a.replace('${CURSOR_PLUGIN_ROOT}',root));
const call=(id,arguments_,name='checkout_quantity_pair')=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:arguments_}});
const rpc=(id,method,params)=>({jsonrpc:'2.0',id,method,params});
const init=(version='2025-11-25')=>rpc(0,'initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'stdio-test',version:'1'}});
const ready={jsonrpc:'2.0',method:'notifications/initialized'};
function runRaw(input) {
  const p=spawnSync(process.execPath,args,{cwd:require('node:os').tmpdir(),input,maxBuffer:2**20,timeout:10000});
  assert.equal(p.status,0,p.error?.message||String(p.stderr));assert.equal(String(p.stderr),'');
  return String(p.stdout).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
}
const lines=messages=>messages.map(m=>JSON.stringify(m)+'\n').join('');
const run=(...messages)=>runRaw(lines(messages));
function cli(seed) {
  const p=spawnSync(process.execPath,[path.join(root,'scripts/edge-case.cjs'),'--seed='+seed],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
test('initialize both handshake versions, negotiate unknown request to a declared version, return exactly one bounded tool',()=>{
  for(const v of ['2025-11-25','2025-06-18','1900-01-01']) {
    const [i,l]=run(init(v),ready,rpc(1,'tools/list',{}));
    assert.equal(i.result.protocolVersion,v==='1900-01-01'?'2025-11-25':v);
    assert.deepEqual(i.result.capabilities,{tools:{}});
    assert.deepEqual(l.result.tools.map(x=>x.name),['checkout_quantity_pair']);
    assert.deepEqual(Object.keys(l.result.tools[0].inputSchema.properties).sort(),['boundary','seed']);
    assert.equal(l.result.tools[0].inputSchema.additionalProperties,false);
  }
});
test('default pair matches real CLI, including both full payloads and exact errors',()=>{
  const result=run(init(),ready,call(2,undefined)).at(-1).result;
  assert.equal(result.isError,false);
  const o=JSON.parse(result.content[0].text), all=cli('checkout-42');
  assert.deepEqual(o.counts,{total:45,accept:17,reject:28});
  assert.deepEqual(o.cases,all.cases.filter(c=>['at-maximum:/lineItem/quantity','past-maximum:/lineItem/quantity'].includes(c.id)));
  assert.deepEqual(o.cases.map(c=>c.payload.lineItem.quantity),[99,100]);
  assert.deepEqual(o.cases.map(c=>c.expectedErrors),[[],[{pointer:'/lineItem/quantity',rule:'maximum'}]]);
});
test('both boundaries across six seeds match CLI; repeat calls identical',()=>{
  const seeds=['checkout-42','alternate','a','--flag','a.b_c-d','Z'.repeat(64)];
  for(const seed of seeds) {
    const suite=cli(seed);
    for(const b of ['maximum','minimum']) {
      const [,r,rerun]=run(init(),ready,call(1,{boundary:b,seed}),call(2,{boundary:b,seed}));
      assert.deepEqual(r.result,rerun.result);
      const o=JSON.parse(r.result.content[0].text);
      assert.equal(o.version,suite.version);assert.equal(o.seed,seed);assert.deepEqual(o.counts,suite.counts);
      assert.deepEqual(o.cases,['at-'+b,'past-'+b].map(k=>suite.cases.find(c=>c.id===k+':/lineItem/quantity')));
      assert.deepEqual(o.cases.map(c=>c.payload.lineItem.quantity), b==='maximum'?[99,100]:[1,0]);
      assert.deepEqual(o.cases.map(c=>c.expected),['accept','reject']);
    }
  }
});
test('no caller-selected schema, path, payload, invalid seed, or URL; errors recover cleanly',()=>{
  const bad=[null,[],{seed:null},{seed:42},{seed:'x/y'},{seed:' '},{seed:'A'.repeat(65)},{boundary:'near'},{boundary:null},{schema:{}},{path:'demo.json'},{url:'https://example.test/'},{payload:{}},{command:'anything'}];
  const [, ...out]=run(init(),ready,...bad.map((a,i)=>call(i+1,a)),call(80,{},'other_tool'),call(81,{}));
  for(const item of out.slice(0,bad.length))assert.equal(item.result.isError,true);
  assert.equal(out.at(-2).error.code,-32602);assert.equal(out.at(-1).result.isError,false);
});
test('protocol errors, truncated and oversized lines, malformed UTF-8 and later recovery',()=>{
  const a=runRaw(Buffer.concat([
    Buffer.from(lines([rpc(9,'tools/list'),init(),rpc(1,'tools/list'),ready,init(),rpc(3,'ping'),rpc(4,'unknown'),rpc(5,'tools/list',{cursor:'invalid'})])+'{\n'+'a'.repeat(18000)+'\n'),
    Buffer.from([0xff,10]),Buffer.from(lines([call(7,{})])+JSON.stringify(call(8,{})))
  ]));
  assert.deepEqual(a.map(x=>x.id),[9,0,1,0,3,4,5,null,null,null,7]);
  assert.deepEqual(a.map(x=>x.error?.code||0),[-32002,0,-32002,-32600,0,-32601,-32602,-32700,-32700,-32700,0]);
});
