'use strict';
const {EXAMPLE,generate}=require('../scripts/edge-case.cjs');
const obj=properties=>({type:'object',properties});
const schemas=[
  EXAMPLE,
  {...obj({'a/b~c':{type:'string',maxLength:0},debt:{type:'integer',maximum:-100},shipping:{type:'string',enum:['🚚','☂️']}}),additionalProperties:false},
  obj({stock:{type:'integer',minimum:1000},note:{type:'string',minLength:64},flag:{type:'boolean'}}),
  {...obj({nested:obj({tag:{type:'string',enum:['SYNTHETIC_OTHER','']},amount:{type:'integer',minimum:0,maximum:0}})}),required:['nested']},
  obj({}),
  {...obj({'1':{type:'string',enum:['<text>','🚚','\\u202e','zero\\nline']},state:{type:'object',properties:{note:{type:'string',minLength:0,maxLength:64}}}}),required:['state']},
  obj({debt:{type:'integer',minimum:-1000000,maximum:-1000000},cap:{type:'integer',maximum:1000000},count:{type:'integer',minimum:1000000}}),
  {...obj({numeric:obj({'10':{type:'boolean'},'2':{type:'string',minLength:64,maxLength:64}}),_extra:{type:'boolean'}}),additionalProperties:false}
];
for(let i=0;i<32;i++) for(const schema of schemas) console.log(JSON.stringify({schema,suite:generate(schema,'oracle-'+i)}));

// Mixed deterministic contracts, distinct from the fixture generator's own PRNG.
let state=6128;
const pick=xs=>(state=(Math.imul(48271,state)+7)>>>0,xs[(state>>>8)%xs.length]);
function field(depth) {
  const kind=pick(depth<2?['string','integer','boolean','object']:['string','integer','boolean']);
  const vals=[-1000000,-7,0,12,1000000];
  if(kind==='boolean')return {type:kind};
  if(kind==='integer') {const a=pick(vals),b=pick(vals);return {type:kind,minimum:Math.min(a,b),maximum:Math.max(a,b)};}
  if(kind==='string') return pick([true,false])?{type:kind,enum:pick([['🚚',''],['A','B'],['SYNTHETIC_OTHER','é','xy']])}:{type:kind,minLength:pick([0,1,5]),maxLength:pick([5,6,64])};
  return object(depth+1);
}
function object(depth) {
  const props=Object.fromEntries(['x/y','toString','2'].slice(0,pick([1,2,3])).map(k=>[k,field(depth)]));
  return {type:'object',properties:props,required:Object.keys(props).filter(()=>pick([true,false])),additionalProperties:pick([true,false])};
}
for(let i=0;i<48;i++) {const schema=object(0);console.log(JSON.stringify({schema,suite:generate(schema,'mixed-'+i)}));}
