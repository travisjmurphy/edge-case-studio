'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), crypto=require('node:crypto');
const {EXAMPLE,readSchema,compile,generate,errorsFor,jsonl,htmlReport}=require('../scripts/edge-case.cjs');
const externalSample=require('../examples/checkout.schema.json');
const sample=generate(EXAMPLE), byId=id=>sample.cases.find(c=>c.id===id), obj=p=>({type:'object',properties:p});
test('example file matches built-in contract; golden checkout matrix',()=>{
  assert.deepEqual(externalSample,EXAMPLE);assert.deepEqual(sample.counts,{total:45,accept:17,reject:28});
  assert.equal(new Set(sample.cases.map(c=>c.id)).size,45);
  assert.equal(crypto.createHash('sha256').update(jsonl(sample)).digest('hex'),'dd0ae5fb2ded3316d76bcfd461bc931740f1a8d133a0776bad488835e57a9e7f');
});
test('exact same JSONL when schema property declaration or required order changes',()=>{
  function reverse(x) {if(!x||typeof x!=='object')return x;if(Array.isArray(x))return x;return Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,k==='required'?[...v].reverse():reverse(v)]));}
  assert.equal(jsonl(generate(reverse(EXAMPLE))),jsonl(sample));assert.notEqual(jsonl(generate(EXAMPLE,'s-43')),jsonl(sample));
});
test('enum wrong type would fail two rules; skip this invalid label',()=>{
  assert.ok(!byId('wrong-type:/currency'));assert.deepEqual(errorsFor(EXAMPLE.properties.currency,null),[{pointer:'',rule:'type'},{pointer:'',rule:'enum'}]);
  assert.deepEqual(byId('outside-enum:/currency').expectedErrors,[{pointer:'/currency',rule:'enum'}]);
});
test('focused checkout boundaries include valid zero, false, optional absence',()=>{
  for(const [id,v] of [['at-minimum:/lineItem/quantity',1],['past-minimum:/lineItem/quantity',0],['at-maximum:/lineItem/quantity',99],['past-maximum:/lineItem/quantity',100]])assert.equal(byId(id).payload.lineItem.quantity,v);
  assert.equal(byId('at-minimum:/lineItem/unitPriceCents').payload.lineItem.unitPriceCents,0);
  assert.strictEqual(byId('false:/giftWrap').payload.giftWrap,false);
  assert.equal(byId('omit-optional:/couponCode').expected,'accept');
  assert.ok(!Object.hasOwn(byId('missing-required:/lineItem/quantity').payload.lineItem,'quantity'));
});
test('negatives change exactly one field from baseline; exact oracle for every record',()=>{
  function differences(a,b,p=[]) {
    if(JSON.stringify(a)===JSON.stringify(b))return [];
    if(!a||!b||typeof a!=='object'||typeof b!=='object')return [p];
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>(!Object.hasOwn(a,k)||!Object.hasOwn(b,k))?[p.concat(k)]:differences(a[k],b[k],p.concat(k)));
  }
  for(const c of sample.cases) {
    assert.deepEqual(errorsFor(EXAMPLE,c.payload),c.expectedErrors);
    if(c.expected==='reject') {
      const diff=differences(sample.cases[0].payload,c.payload);
      assert.deepEqual(diff,[c.field?c.field.slice(1).split('/'):[]],c.id);
      assert.deepEqual(c.expectedErrors,[{pointer:c.field,rule:c.rule}]);
    }
  }
});
test('Unicode code points, not UTF-16 units, for lengths',()=>{
  assert.deepEqual(errorsFor({type:'string',minLength:1,maxLength:1},'🚚'),[]);
  assert.deepEqual(errorsFor({type:'string',minLength:1,maxLength:1},'🚚🚚'),[{pointer:'',rule:'maxLength'}]);
});
test('explicit references, unknown, wrong-type, and inapplicable keywords rejected',()=>{
  const bad=[
    [{$ref:'#/x'},/references/],[obj({x:{$ref:'https://example.invalid/schema'}}),/references/],
    [obj({x:{type:'string',pattern:'x'}}),/pattern/],[{...obj({}),unknown:true},/unsupported keyword/],
    [obj({x:{type:'boolean',minimum:0}}),/minimum/],[obj({x:{type:'array',items:{type:'string'}}}),/expected object/],
    [obj({x:{type:'toString'}}),/expected object/],[{...obj({}),$schema:'http://example.invalid'},/dialect/],
    [obj({x:{type:'string',enum:['a'],minLength:1}}),/outside this profile/],[obj({x:{type:'number'}}),/expected object/],
    [{...obj({}),additionalProperties:{}},/true\/false/],[Object.assign(obj({}),{definitions:{}}),/references/]];
  for(const [s,e] of bad)assert.throws(()=>generate(s),e);
});
test('bounds, object budgets, required names, and enum constraints fail closed',()=>{
  for(const s of [obj({x:{type:'integer',minimum:2,maximum:1}}),obj({x:{type:'integer',maximum:1000001}}),obj({x:{type:'string',maxLength:-1}}),obj({x:{type:'string',enum:['x','x']}}),obj({x:{type:'string',enum:[]}}),{...obj({a:{type:'boolean'}}),required:['b']},{...obj({a:{type:'boolean'}}),required:['a','a']},obj(Object.fromEntries(Array.from({length:33},(_,i)=>['x'+i,{type:'string'}]))),obj({x:obj({x:obj({x:obj({x:{type:'string'}})})})}),{type:'object'},obj({'a b':{type:'integer'}}),obj({constructor:{type:'boolean'}})])assert.throws(()=>generate(s));
});
test('duplicate keys including escaped spellings and nested duplicates rejected',()=>{
  for(const t of ['{"type":"string","ty\\u0070e":"object"}','{"p":{"v":1,"v":2}}'])assert.throws(()=>readSchema(t),/Duplicate/);
  assert.deepEqual(readSchema('{"first":{"k":"}:"},"second":{"k":"\\\"hey"}}'),{first:{k:'}:'},second:{k:'"hey'}});
  assert.throws(()=>readSchema(' '.repeat(32769)),/KiB/);
  assert.throws(()=>readSchema('['.repeat(17)+'0'+']'.repeat(17)),/nesting/);
  assert.throws(()=>readSchema('{"type":'),/Not valid JSON/);
});
test('one-sided bounds and zero-length strings, no impossible negative lengths',()=>{
  const s=obj({debt:{type:'integer',maximum:-190},count:{type:'integer',minimum:180},zero:{type:'string',maxLength:0,minLength:0},long:{type:'string',minLength:63}});
  for(let i=0;i<80;i++){const g=generate(s,'test-'+i);assert.ok(!g.cases.some(c=>c.id==='past-minLength:/zero'));assert.equal(g.cases[0].payload.zero,'');assert.ok(g.cases[0].payload.long.length>=63);}
});
test('JSON pointer escaping, constant and singleton schemas, open and closed objects',()=>{
  const s={...obj({'a/b~c':{type:'integer',minimum:0,maximum:0},'_extra':{type:'boolean'}}),additionalProperties:false};
  const g=generate(s);assert.ok(g.cases.some(c=>c.id==='past-minimum:/a~1b~0c'));assert.ok(g.cases.some(c=>c.id==='undeclared:/_extra_'));
  assert.deepEqual(generate(obj({})).counts,{total:2,accept:1,reject:1});
  assert.ok(!generate({...obj({}),additionalProperties:true}).cases.some(c=>c.rule==='additionalProperties'));
});
test('privacy, bounded seed, replay metadata on each JSONL line',()=>{
  for(const seed of ['',null,'x '.repeat(10),'é','t'.repeat(65)])assert.throws(()=>generate(EXAMPLE,seed),/Seed/);
  const records=jsonl(sample).trimEnd().split('\n').map(JSON.parse);assert.equal(records.length,45);for(const [i,r] of records.entries()){assert.equal(r.version,'0.1.1');assert.equal(r.seed,'checkout-42');assert.deepEqual(r.payload,sample.cases[i].payload);}
});
test('HTML is self-contained, safely serializes user enums, includes exact cases',()=>{
  const g=generate(obj({x:{type:'string',enum:['</script><p>literal & text</p>']}}));const html=htmlReport(g);
  assert.ok(!html.includes('</script><p>literal'));assert.ok(html.includes("connect-src 'none'"));assert.deepEqual(JSON.parse(html.match(/id="suite">([\s\S]*?)<\/script>/)[1]),g);
  assert.ok(!/<script\s+src=|<link\s|<iframe|\.innerHTML\s*=/.test(html));
});

test('source tokens are exact even where binary floating point would round or underflow',()=>{
  const schema=value=>'{"type":"object","properties":{"quantity":{"type":"integer","minimum":'+value+'}}}';
  for(const [text,actual] of [['1.0',1],['-0e-50000',-0],['1.2300e2',123],['120e-1',12],['-0.001e6',-1000]]) {
    const s=compile(readSchema(schema(text)));assert.equal(s.properties.quantity.minimum,actual);
  }
  for(const value of ['1.000000000000000001','0.99999999999999999999','1e-10000','-1e-10000','1.2e-10','1e400','9007199254740992'])
    assert.throws(()=>readSchema(schema(value)),/exact safe integers/);
  assert.deepEqual(readSchema('{"enum":["123e-1000","1.000000000000000001"]}').enum,['123e-1000','1.000000000000000001']);
});
test('32-field limit, largest enum and reordered numeric-looking names replay byte for byte',()=>{
  const options=Array.from({length:12},(_,i)=>'A'.repeat(62)+String(i));
  const pairs=Array.from({length:32},(_,i)=>[String(i),{type:'string',enum:options}]);
  const make=pairs=>({...obj(Object.fromEntries(pairs)),required:pairs.map(p=>p[0]),additionalProperties:false});
  const full=readSchema(JSON.stringify(make(pairs)));const out=generate(full,'--edge');assert.equal(out.cases.length,451);
  assert.equal(new Set(out.cases.map(c=>c.id)).size,out.cases.length);
  assert.equal(jsonl(out),jsonl(generate(make([...pairs].reverse()),'--edge')));
  assert.throws(()=>generate(obj({s:{type:'string',enum:['\ud83d']}})),/unpaired/);
  assert.throws(()=>generate(obj({s:{type:'string',enum:['x\udc00']}})),/unpaired/);
});
test('generated report and JSONL in examples are current byte-for-byte',()=>{
  const {readFileSync}=require('node:fs'), path=require('node:path');
  assert.equal(readFileSync(path.join(__dirname,'../examples/checkout-report.html'),'utf8'),htmlReport(sample));
  assert.equal(readFileSync(path.join(__dirname,'../examples/checkout.cases.jsonl'),'utf8'),jsonl(sample));
});
