'use strict';
// Private adapter proof. The only business operation is the original local core.
const { EXAMPLE, generate } = require('./edge-case.cjs');
const VERSIONS = ['2025-11-25', '2025-06-18'];
const TOOL = {
  name: 'checkout_quantity_pair',
  description: 'Generate the accept/reject pair for the upper or lower quantity boundary in the built-in synthetic checkout. Returns two full fixture rows and counts for the whole suite. No endpoint is tested.',
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: {
      boundary: { type: 'string', enum: ['maximum', 'minimum'], default: 'maximum' },
      seed: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,64}$', minLength: 1, maxLength: 64, description: 'Replay token; omit for the standard checkout-42 run.' }
    }
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
};
const rec = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ok = (id,result) => ({jsonrpc:'2.0',id,result});
const err = (id,code,message) => ({jsonrpc:'2.0',id,error:{code,message}});
const textResult = (text,isError=false) => ({content:[{type:'text',text}],isError});
function pair(args) {
  if (!rec(args) || Object.keys(args).some(k=>k!=='boundary'&&k!=='seed'))
    return textResult('Use only boundary and seed. This tool accepts no schema, payload, path or URL.',true);
  const boundary = Object.hasOwn(args,'boundary') ? args.boundary : 'maximum';
  if (boundary!=='maximum' && boundary!=='minimum') return textResult('Use maximum or minimum.',true);
  let suite;
  try { suite = generate(EXAMPLE,args.seed); }
  catch (e) { return textResult(String(e.message),true); }
  const field='/lineItem/quantity';
  const pair=['at-','past-'].map(prefix=>suite.cases.find(c=>c.id===prefix+boundary+':'+field));
  if (pair.some(c=>!c)) return textResult('No matching pair in the built-in fixture suite.',true);
  return textResult(JSON.stringify({generator:suite.generator,version:suite.version,seed:suite.seed,
    counts:suite.counts,boundary,field,cases:pair,note:'Schema expectations only; no endpoint was contacted.'}));
}
function session() {
  let state='new';
  return req => {
    if (!rec(req)||req.jsonrpc!=='2.0'||typeof req.method!=='string') return err(null,-32600,'Invalid JSON-RPC request');
    const hasId=Object.hasOwn(req,'id'), {id,method,params}=req;
    if (hasId && !(typeof id==='string' || Number.isSafeInteger(id))) return err(null,-32600,'Invalid request ID');
    if (!hasId) {
      if (method==='notifications/initialized' && state==='pending') state='ready';
      return;
    }
    if (params!==undefined && !rec(params)) return err(id,-32602,'Expected object parameters');
    if (method==='ping') return ok(id,{});
    if (method==='initialize') {
      if (state!=='new') return err(id,-32600,'Already initialized');
      if (typeof params?.protocolVersion!=='string' || !rec(params.capabilities)||!rec(params.clientInfo) ||
          typeof params.clientInfo.name!=='string'||typeof params.clientInfo.version!=='string')
        return err(id,-32602,'Missing initialize parameters');
      state='pending';
      return ok(id,{protocolVersion:VERSIONS.includes(params.protocolVersion)?params.protocolVersion:VERSIONS[0],
        capabilities:{tools:{}},serverInfo:{name:'edge-case-checkout-proof',version:'0.1.0'}});
    }
    if (!['tools/list','tools/call'].includes(method)) return err(id,-32601,'Method not found');
    if (state!=='ready') return err(id,-32002,'Initialize this session first');
    if (method==='tools/list') {
      if (params?.cursor!==undefined) return err(id,-32602,'No continuation cursor');
      return ok(id,{tools:[TOOL]});
    }
    if (params?.name!==TOOL.name) return err(id,-32602,'Unknown tool');
    return ok(id,pair(Object.hasOwn(params,'arguments')?params.arguments:{}));
  };
}
// Fixed-size, newline-delimited UTF-8 frames; drain an oversized line without storing it.
async function serve(input,output) {
  const dispatch=session(),limit=16384,decoder=new TextDecoder('utf-8',{fatal:true});
  const buf=Buffer.allocUnsafe(limit); let used=0,oversized=false;
  async function emit(response) {
    if (response && !output.write(JSON.stringify(response)+'\n'))
      await require('node:events').once(output,'drain');
  }
  async function finish() {
    if (oversized) await emit(err(null,-32700,'Frame exceeds 16 KiB'));
    else if (used) {
      let request;
      try { request=JSON.parse(decoder.decode(buf.subarray(0,used))); }
      catch { await emit(err(null,-32700,'Invalid UTF-8 or JSON')); used=0; return; }
      await emit(dispatch(request));
    }
    oversized=false; used=0;
  }
  for await (const chunk of input) {
    let pos=0;
    while(pos<chunk.length) {
      const nl=chunk.indexOf(10,pos),end=nl<0?chunk.length:nl;
      if (used+end-pos>limit) oversized=true;
      if (!oversized) { chunk.copy(buf,used,pos,end); used+=end-pos; }
      if (nl<0) break;
      await finish(); pos=nl+1;
    }
  }
  // Incomplete final messages are not executed.
}
if (require.main===module) {
  if (process.argv.length!==2) {process.stderr.write('This tool accepts MCP on standard input only.\n');process.exitCode=2;}
  else serve(process.stdin,process.stdout).catch(()=>{process.exitCode=1;});
}
