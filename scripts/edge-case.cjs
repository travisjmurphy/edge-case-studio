'use strict';
// Edge Case Studio 0.1.1. Public operations consume only a schema and a seed.
const EXAMPLE = {
  "type": "object",
  "additionalProperties": false,
  "required": [
    "orderRef",
    "currency",
    "lineItem",
    "giftWrap"
  ],
  "properties": {
    "orderRef": {
      "type": "string",
      "minLength": 4,
      "maxLength": 18
    },
    "currency": {
      "type": "string",
      "enum": [
        "CAD",
        "USD",
        "EUR"
      ]
    },
    "lineItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "sku",
        "quantity",
        "unitPriceCents"
      ],
      "properties": {
        "sku": {
          "type": "string",
          "minLength": 3,
          "maxLength": 16
        },
        "quantity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 99
        },
        "unitPriceCents": {
          "type": "integer",
          "minimum": 0,
          "maximum": 500000
        }
      }
    },
    "giftWrap": {
      "type": "boolean"
    },
    "couponCode": {
      "type": "string",
      "minLength": 3,
      "maxLength": 12
    }
  }
};
const VERSION = '0.1.1', LIMIT = 32768, DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const own = (o,k) => Object.hasOwn(o,k);
const record = o => o !== null && typeof o === 'object' && !Array.isArray(o);
// Diagnostics may contain user-supplied keys. Keep stderr bounded and single-line.
const diagnostic = m => {
  const clean = String(m).slice(0,512).replace(/[\u0000-\u001f\u007f-\u009f\u0600-\u0605\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  return clean.length > 380 ? clean.slice(0,377)+'...' : clean;
};
const fail = m => { throw new Error(diagnostic(m)); };
const ptr = p => p.length ? '/' + p.map(k=>k.replace(/~/g,'~0').replace(/\//g,'~1')).join('/') : '';
const at = (p,m) => fail((ptr(p)||'(root)')+': '+m);
const boundedInt = (v,a,b) => Number.isSafeInteger(v) && v>=a && v<=b;
function readSchema(text) {
  if (typeof text!=='string' || text.length>LIMIT || Buffer.byteLength(text)>LIMIT) fail('Schema exceeds 32 KiB or is not text');
  let data;
  try { data=JSON.parse(text); } catch { fail('Not valid JSON'); }
  // JSON.parse accepts duplicate keys. Reject them, including escaped equivalents.
  const stack=[];
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if (c==='{') stack.push(new Set());
    else if(c==='[') stack.push(null);
    else if(c==='}' || c===']') stack.pop();
    else if(c==='"') {
      const start=i++;
      while(text[i]!=='"') { if(text[i]==='\\') i++; i++; }
      const end=i; let n=i+1; while(/\s/.test(text[n]||'x')) n++;
      if(text[n]===':') {
        const key=JSON.parse(text.slice(start,end+1)); const keys=stack[stack.length-1];
        if(keys.has(key)) fail('Duplicate JSON key: '+JSON.stringify(key)); keys.add(key);
      }
    }
    // JSON.parse rounds decimals and can underflow a tiny nonzero number to zero.
    // Inspect the original token, not just the rounded JS value. Exact 1.0 and
    // 12e2 remain supported. No large powers or arbitrary-size integers needed.
    else if(c==='-' || (c>='0' && c<='9')) {
      const start=i; while(i+1<text.length && /[0-9eE+.\-]/.test(text[i+1])) i++;
      const token=text.slice(start,i+1);
      const [,whole,frac='',exp='0']=/^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
      const digits=whole+frac; let end=digits.length;
      while(end>0 && digits[end-1]==='0') end--;
      if(!Number.isSafeInteger(Number(token)) || (end>0 && Number(exp)<frac.length-(digits.length-end)))
        fail('Numeric schema constraints must be exact safe integers');
    }
    if(stack.length>16) fail('Schema nesting exceeds parser limit');
  }
  return data;
}
function compile(schema) {
  let fields=0;
  function check(s,p,depth) {
    if (!record(s)) at(p,'expected a schema object');
    if (depth>3) at(p,'object depth limit exceeded');
    const t=s.type, keys=Object.keys(s);
    const common=['type'];
    if (!depth) common.push('$schema');
    const allowed = {
      object:['properties','required','additionalProperties'],
      string:['minLength','maxLength','enum'], integer:['minimum','maximum'], boolean:[]
    };
    // Check reference keys before type so a bare ref fails with a useful reason.
    for(const key of ['$ref','$dynamicRef','$defs','definitions']) if(own(s,key)) at(p.concat(key),'references/definitions are not supported');
    if(typeof t!=='string'||!own(allowed,t)) at(p.concat('type'),'expected object, string, integer, or boolean');
    if(!depth && t!=='object') at(p,'root must be an object schema');
    for(const k of keys) if(!common.includes(k)&&!allowed[t].includes(k)) at(p.concat(k),'unsupported keyword for '+t);
    if(own(s,'$schema') && s.$schema!==DIALECT) at(p.concat('$schema'),'unsupported dialect');
    if (t==='object') {
      if (!record(s.properties)) at(p.concat('properties'),'explicit properties object required');
      const names=Object.keys(s.properties).sort();
      fields+=names.length; if(fields>32) at(p,'maximum 32 declared fields total');
      for(const k of names) {
        if(!/^[\x21-\x7e]{1,40}$/.test(k)||['__proto__','prototype','constructor'].includes(k)) at(p.concat('properties',k),'field name must be 1–40 printable non-space ASCII characters and non-reserved');
      }
      if (own(s,'required')&&(!Array.isArray(s.required)||s.required.some(x=>typeof x!=='string'||!own(s.properties,x))||new Set(s.required).size!==s.required.length)) at(p.concat('required'),'use unique declared field names');
      if (own(s,'additionalProperties')&&typeof s.additionalProperties!=='boolean') at(p.concat('additionalProperties'),'only true/false supported');
      for(const k of names) check(s.properties[k],p.concat('properties',k),depth+1);
    } else if(t==='string') {
      for(const k of ['minLength','maxLength']) if(own(s,k)&&!boundedInt(s[k],0,64)) at(p.concat(k),'use an integer 0..64');
      if(own(s,'minLength')&&own(s,'maxLength')&&s.minLength>s.maxLength) at(p,'minLength exceeds maxLength');
      if(own(s,'enum')) {
        if(own(s,'minLength')||own(s,'maxLength')) at(p,'enum + length rules are outside this profile');
        if(Array.isArray(s.enum) && s.enum.some(v=>typeof v==='string' && [...v].some(c=>/^[\ud800-\udfff]$/.test(c)))) at(p.concat('enum'),'unpaired Unicode surrogate in enum string');
        if(!Array.isArray(s.enum)||s.enum.length<1||s.enum.length>12||s.enum.some(v=>typeof v!=='string'||[...v].length>64)||new Set(s.enum).size!==s.enum.length) at(p.concat('enum'),'use 1..12 unique strings of at most 64 characters');
      }
    } else if(t==='integer') {
      for(const k of ['minimum','maximum']) if(own(s,k)&&!boundedInt(s[k],-1000000,1000000)) at(p.concat(k),'use an integer within ±1000000');
      if(own(s,'minimum')&&own(s,'maximum')&&s.minimum>s.maximum) at(p,'minimum exceeds maximum');
    }
  }
  check(schema,[],0); return schema;
}
function errorsFor(s,v,p=[],errors=[]) {
  const add=(q,rule)=>errors.push({pointer:ptr(q),rule});
  const ok=s.type==='object'?record(v):s.type==='integer'?Number.isInteger(v):typeof v===s.type;
  if(!ok) add(p,'type');
  if(s.enum&&!s.enum.includes(v)) add(p,'enum'); // enum applies even when type is wrong
  if(!ok) return errors;
  if(s.type==='object') {
    for(const k of s.required||[]) if(!own(v,k)) add(p.concat(k),'required');
    for(const k of Object.keys(v).sort()) {
      if(own(s.properties,k)) errorsFor(s.properties[k],v[k],p.concat(k),errors);
      else if(s.additionalProperties===false) add(p.concat(k),'additionalProperties');
    }
  } else if(s.type==='integer') {
    if(v<s.minimum) add(p,'minimum'); if(v>s.maximum) add(p,'maximum');
  } else if(s.type==='string') {
    const n=[...v].length;
    if(n<s.minLength) add(p,'minLength'); if(n>s.maxLength) add(p,'maxLength');
  }
  return errors;
}
function seeded(seed) {
  if(typeof seed!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(seed)) fail('Seed must be 1–64 ASCII letters, digits, dots, underscores or hyphens');
  let state=2166136261;
  for(const ch of seed) state=Math.imul(state^ch.charCodeAt(0),16777619)>>>0;
  return (lo,hi)=>{state=(Math.imul(state,1664525)+1013904223)>>>0; return lo+Math.floor((state/4294967296)*(hi-lo+1));};
}
function generate(schema,seed='checkout-42') {
  const s=compile(schema), rand=seeded(seed), cases=[];
  function valid(n) {
    if(n.type==='object') return Object.fromEntries(Object.keys(n.properties).sort().map(k=>[k,valid(n.properties[k])]));
    if(n.type==='boolean') return Boolean(rand(0,1));
    if(n.enum) return n.enum[rand(0,n.enum.length-1)];
    if(n.type==='integer') {const lo=n.minimum??Math.min(0,(n.maximum??100)-100);return rand(lo,n.maximum??lo+100);}
    const lo=n.minLength??0, hi=n.maxLength??Math.max(12,lo);
    let target=rand(Math.min(hi,Math.max(lo,6)),Math.min(hi,Math.max(lo,16))), val=''; 
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for(let i=0;i<target;i++) val+=alphabet[rand(0,alphabet.length-1)]; return val;
  }
  const base=valid(s);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const DROP=Symbol('drop');
  function withChange(path,value) {
    if(!path.length) return value; const payload=clone(base); let parent=payload;
    for(const k of path.slice(0,-1)) parent=parent[k]; const k=path.at(-1);
    if(value===DROP) delete parent[k]; else Object.defineProperty(parent,k,{value,writable:true,enumerable:true,configurable:true}); return payload;
  }
  function add(kind,path,rule,label,payload,invalid=false) {
    const pointer=ptr(path), expectedErrors=invalid?[{pointer,rule}]:[], got=errorsFor(s,payload);
    if(JSON.stringify(got)!==JSON.stringify(expectedErrors)) fail('Internal oracle disagreement for '+kind+':'+pointer);
    cases.push({id:kind+':'+pointer,label,field:pointer,rule,expected:invalid?'reject':'accept',expectedErrors,payload});
  }
  add('baseline',[],'schema','Complete seeded order or record',base);
  const variant=(kind,p,rule,label,value,invalid=false)=>add(kind,p,rule,label,withChange(p,value),invalid);
  function walk(n,p) {
    if(!n.enum) variant('wrong-type',p,'type','Null instead of '+n.type,null,true);
    if (n.type==='object') {
      for(const k of Object.keys(n.properties).sort()) {
        const q=p.concat(k),required=(n.required||[]).includes(k);
        variant(required?'missing-required':'omit-optional',q,required?'required':'optional',required?'Omit required field':'Omit optional field',DROP,required);
        walk(n.properties[k],q);
      }
      if(n.additionalProperties===false) {let k='_extra';while(own(n.properties,k)) k+='_';variant('undeclared',p.concat(k),'additionalProperties','Undeclared extra field',true,true);}
    } else if(n.type==='integer'||n.type==='string'&&!n.enum) {
      const str=n.type==='string';
      for(const [rule,step] of (str?[['minLength',-1],['maxLength',1]]:[['minimum',-1],['maximum',1]])) {
        if(!own(n,rule)) continue; const limit=n[rule], value=x=>str?'S'.repeat(x):x;
        variant('at-'+rule,p,rule,'Exactly at '+rule+' ('+limit+')',value(limit));
        if(!str||limit+step>=0) variant('past-'+rule,p,rule,'One '+(step<0?'below ':'above ')+rule+' ('+(limit+step)+')',value(limit+step),true);
      }
    } else if(n.enum) {
      let x='SYNTHETIC_OTHER'; while(n.enum.includes(x)) x+='_'; variant('outside-enum',p,'enum','Unsupported enum string',x,true);
      for(let i=0;i<n.enum.length;i++) variant('enum-'+i,p,'enum','Allowed enum option '+(i+1),n.enum[i]);
    } else if(n.type==='boolean') {
      for(const b of [false,true]) variant(String(b),p,'type','Boolean '+b,b);
    }
  }
  walk(s,[]);
  return {generator:'edge-case-studio',version:VERSION,profile:'bounded-object-v1',seed,counts:{total:cases.length,accept:cases.filter(c=>c.expected==='accept').length,reject:cases.filter(c=>c.expected==='reject').length},cases};
}
function jsonl(suite) {
  return suite.cases.map(c=>JSON.stringify({generator:suite.generator,version:suite.version,profile:suite.profile,seed:suite.seed,...c})).join('\n')+'\n';
}

function htmlReport(suite) {
  const ui='('+wireUI.toString().replace(/\r\n?/g,'\n')+')();';
  const uiHash=require('node:crypto').createHash('sha256').update(ui,'utf8').digest('base64');
  const safe=JSON.stringify(suite).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-'+uiHash+'\'; style-src \'unsafe-inline\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'"><title>Edge Case Studio | Fixture workbench</title><style>'+STYLES+'</style><body><main><header><div class="eyebrow">CONTRACT QA &nbsp; / &nbsp; LOCAL FIXTURE WORKBENCH</div><h1>Edge Case Studio<span>.</span></h1><p>Start with one valid payload. Change one field and see which rule should reject it.</p></header><section id="stats" aria-label="Suite statistics"></section><section class="tools"><label>Outcome <select id="outcome"><option value="">All cases</option><option value="reject">Should reject</option><option value="accept">Should accept</option></select></label><label>Find a field <input id="search" type="search" placeholder="e.g. quantity" autocomplete="off"></label><button id="export">Save JSONL</button></section><section class="grid"><div class="panel"><div class="eyebrow sectiontop">TEST MATRIX <span id="num"></span></div><div id="list"></div></div><div class="panel detail"><div class="eyebrow">CASE INSPECTOR</div><h2 id="title"></h2><p id="meta"></p><h3>Payload</h3><pre id="payload"></pre><h3>Expected schema errors</h3><pre id="errors"></pre></div></section><footer>Fixtures generated from schema rules, not sampled customer records. No endpoint is contacted. These are contract expectations, not observed application results.</footer></main><script type="application/json" id="suite">'+safe+'</script><script>'+ui+'</script></body></html>\n';
}
const STYLES='*{box-sizing:border-box}body{margin:0;background:#f3f2ec;color:#182923;font:15px/1.5 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:40px clamp(14px,4vw,52px)}header{border-bottom:2px solid #213a2e;padding-bottom:20px}h1{font-size:clamp(42px,6vw,78px);letter-spacing:-.07em;margin:4px 0;line-height:1.1}h1 span{color:#ad552b}.eyebrow,h3{font-size:11px;letter-spacing:.11em;font-weight:750;color:#47584e}.tools,#stats{display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin:18px 0}.chip{background:#e4e8de;border:1px solid #bbc8bb;border-radius:3px;padding:3px 10px;font:13px/1.6 ui-monospace,monospace}.tools label{display:grid;gap:3px;font-size:12px;color:#384d42}.tools select,.tools input,.tools button{border:1px solid #9ca99f;border-radius:4px;background:#fff;padding:8px 11px;font:inherit;color:inherit}.tools button{background:#213c30;color:white;cursor:pointer;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1.1fr;gap:16px}.panel{border:1px solid #bfc6b8;background:#fffef8;border-radius:5px;min-width:0}.sectiontop,.detail{padding:17px}.sectiontop span{float:right}#list{max-height:560px;overflow:auto;border-top:1px solid #cbd0c4}.row{display:grid;grid-template-columns:60px 1fr;align-items:start;text-align:left;width:100%;border:0;border-bottom:1px solid #e0e3d8;background:none;padding:9px 12px;gap:8px;color:#26382e;cursor:pointer}.row[aria-pressed="true"]{background:#e5ecdf;box-shadow:inset 4px 0 #367b51}.row b{font-size:11px}.row.reject b{color:#9d3d26}.row.accept b{color:#29663d}code,pre{font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}pre{background:#172c24;color:#d9f1d8;padding:14px;border-radius:4px;white-space:pre-wrap;tab-size:2}h2{font-size:24px;line-height:1.2;margin:12px 0;overflow-wrap:anywhere}#meta{font:13px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}footer{color:#546356;margin-top:18px;font-size:12px}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #b36f25}#list>p{padding:10px}@media(max-width:730px){.grid{grid-template-columns:1fr}#list{max-height:240px}}';
function wireUI() {
  const el=id=>document.getElementById(id), suite=JSON.parse(el('suite').textContent);
  // Escape bidirectional/line controls in the inspector, never in the exported data.
  const inspect=v=>JSON.stringify(v,null,2).replace(/[\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  let selected=suite.cases.find(c=>c.id==='past-minimum:/lineItem/quantity')?.id||suite.cases[0].id;
  for(const value of ['seed: '+suite.seed,suite.counts.total+' fixtures',suite.counts.accept+' should accept',suite.counts.reject+' should reject']) {
    const s=document.createElement('span'); s.className='chip';s.textContent=value;el('stats').append(s);
  }
  function redraw() {
    const q=el('search').value.trim().toLowerCase(), out=el('outcome').value;
    const list=suite.cases.filter(c=>(!out||out===c.expected)&&(!q||(c.field+' '+c.rule+' '+c.label).toLowerCase().includes(q)));
    if(!list.some(c=>c.id===selected)) selected=list[0]?.id??null;
    const target=list.find(c=>c.id===selected); const nodes=[];
    for(const c of list) {
      const b=document.createElement('button'),status=document.createElement('b'), d=document.createElement('span'),path=document.createElement('code');
      b.type='button';b.className='row '+c.expected;b.setAttribute('aria-pressed',String(selected===c.id));status.textContent=c.expected.toUpperCase();path.textContent=c.field||'(root)';d.append(path,document.createElement('br'),c.label);b.append(status,d);
      b.onclick=()=>{selected=c.id; redraw(); const active=el('list').querySelector('[aria-pressed="true"]');active?.focus({preventScroll:true});};nodes.push(b);
    }
    if(!nodes.length) {const p=document.createElement('p');p.textContent='No matching cases. Clear the filters to see the matrix.';nodes.push(p);}
    el('list').replaceChildren(...nodes);el('num').textContent=String(list.length);
    el('title').textContent=target?.label??'No case selected';
    el('meta').textContent=target?[target.expected.toUpperCase(),target.field||'(root)',target.rule].join('  /  '):'';
    el('payload').textContent=target?inspect(target.payload):'';
    el('errors').textContent=target?inspect(target.expectedErrors):'';
  }
  el('search').addEventListener('input',redraw);el('outcome').addEventListener('change',redraw);
  el('export').addEventListener('click',()=>{
    const blob=new Blob([suite.cases.map(c=>JSON.stringify({generator:suite.generator,version:suite.version,profile:suite.profile,seed:suite.seed,...c})).join('\n')+'\n'],{type:'application/x-ndjson'});
    const url=URL.createObjectURL(blob), a=document.createElement('a');a.href=url;a.download='edge-cases-'+suite.seed+'.jsonl';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });redraw();
}

const USAGE='Edge Case Studio | bounded-object-v1\n\nnode scripts/edge-case.cjs [--stdin] [--seed TOKEN] [--format json|jsonl|html]\n\nDefault: built-in synthetic checkout schema, seed checkout-42, JSON to stdout.\n--stdin reads a UTF-8 JSON schema (32 KiB limit). No URLs, file lookup, or requests.\nFor seeds beginning with --, use --seed=TOKEN.\nUse shell redirection to create a new file only when you intend to write it.';
async function main(args,input=process.stdin) {
  if(args.length===1&&args[0]==='--help') {process.stdout.write(USAGE+'\n');return;}
  let useStdin=false, seed='checkout-42',format='json';const seen=new Set();
  for(let i=0;i<args.length;i++) {
    const k=args[i]; if(seen.has(k)) fail('Repeated argument: '+k);seen.add(k);
    if(k.startsWith('--seed=')) {
      if(seen.has('--seed')) fail('Repeated argument: --seed');
      seen.add('--seed'); seed=k.slice(7);
    }
    else if(k==='--stdin') useStdin=true;
    else if(k==='--seed'||k==='--format') {const v=args[++i];if(!v||v.startsWith('--')) fail('Missing value for '+k);if(k==='--seed') seed=v;else format=v;}
    else fail('Unknown argument; use --help');
  }
  if(!['json','jsonl','html'].includes(format)) fail('Use --format json, jsonl or html');
  let schema=EXAMPLE;
  if(useStdin) {
    const chunks=[];let size=0;
    for await(const chunk of input) {const b=Buffer.from(chunk);size+=b.length;if(size>LIMIT) fail('Schema exceeds 32 KiB');chunks.push(b);}
    let text;try {text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch {fail('Schema must be UTF-8');}
    schema=readSchema(text);
  }
  const suite=generate(schema,seed);
  process.stdout.write(format==='jsonl'?jsonl(suite):format==='html'?htmlReport(suite):JSON.stringify(suite,null,2)+'\n');
}
module.exports={EXAMPLE,compile,readSchema,generate,errorsFor,jsonl,htmlReport,main};
if(require.main===module) main(process.argv.slice(2)).catch(e=>{process.stderr.write('edge-case: '+diagnostic(e.message)+'\n');process.exitCode=2;});
