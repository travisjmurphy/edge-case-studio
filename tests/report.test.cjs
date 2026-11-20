'use strict';
// DOM contract checks, not a browser rendering or Cursor integration test.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {EXAMPLE,generate,htmlReport,jsonl}=require('../scripts/edge-case.cjs');
function setup(schema=EXAMPLE) {
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};this.events={};this.value='';this.textContent='';}
    append(...n){this.children.push(...n);}
    replaceChildren(...n){this.children=[...n];}
    setAttribute(k,v){this.attrs[k]=v;}
    addEventListener(k,v){this.events[k]=v;}
    querySelector(){return this.children.find(n=>n.attrs?.['aria-pressed']==='true');}
    focus(){this.focused=true;} click(){this.clicked=true;} remove(){this.removed=true;}
  }
  const suite=generate(schema),html=htmlReport(suite), elements={};
  const doc={getElementById:id=>elements[id]??=new Element(),createElement:t=>new Element(t),body:new Element('body')};
  const data=html.match(/id="suite">([\s\S]*?)<\/script>/)[1];doc.getElementById('suite').textContent=data;
  const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];let blob,revoked=false;
  vm.runInNewContext(code,{document:doc,Blob,URL:{createObjectURL:item=>(blob=item,'blob:example'),revokeObjectURL:()=>{revoked=true;}},setTimeout:f=>f()});
  return {e:elements,suite,doc,getBlob:()=>blob,wasRevoked:()=>revoked};
}
test('real report script renders initial inspector, filters and recovers from empty results',()=>{
  const {e}=setup();assert.equal(e.num.textContent,'45');assert.ok(e.meta.textContent.includes('/lineItem/quantity'));assert.equal(JSON.parse(e.payload.textContent).lineItem.quantity,0);
  e.outcome.value='accept';e.outcome.events.change();assert.equal(e.num.textContent,'17');assert.ok(e.meta.textContent.includes('ACCEPT'));
  e.search.value='quantity';e.search.events.input();assert.equal(e.num.textContent,'2');assert.ok(e.meta.textContent.includes('/lineItem/quantity'));
  e.list.children[1].onclick();assert.equal(JSON.parse(e.payload.textContent).lineItem.quantity,99);assert.equal(e.list.querySelector().focused,true);
  e.search.value='no-such-case';e.search.events.input();assert.equal(e.num.textContent,'0');assert.equal(e.payload.textContent,'');
  e.search.value='';e.search.events.input();assert.equal(e.num.textContent,'17');
});
test('JSONL download always includes full checked suite even with filters',async()=>{
  const {e,suite,doc,getBlob,wasRevoked}=setup();e.outcome.value='reject';e.outcome.events.change();e.export.events.click();
  assert.equal(await getBlob().text(),jsonl(suite));const link=doc.body.children[0];assert.equal(link.download,'edge-cases-checkout-42.jsonl');assert.ok(link.clicked&&link.removed&&wasRevoked());
});

test('one permitted script matches the exact report bytes; enum presentation preserves original values',async()=>{
  const schema={type:'object',properties:{sample:{type:'string',enum:['<box> & freight','wrap\u202eabc 🚚']}}};
  const html=htmlReport(generate(schema)),script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const hash=require('node:crypto').createHash('sha256').update(script).digest('base64');
  assert.ok(html.includes("script-src 'sha256-"+hash+"'"));assert.ok(!html.includes("script-src 'unsafe-inline'"));
  const {e,suite,getBlob}=setup(schema);
  e.list.children[suite.cases.findIndex(c=>c.id==='enum-1:/sample')].onclick();
  assert.ok(e.payload.textContent.includes('\\u202e'));assert.equal(JSON.parse(e.payload.textContent).sample,'wrap\u202eabc 🚚');
  e.export.events.click();assert.equal(await getBlob().text(),jsonl(suite));
});
