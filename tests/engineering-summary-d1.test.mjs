import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign} from 'node:crypto';
import {authorizeEngineeringSummary,engineeringSummaryUsesD1,summarizeEngineeringD1} from '../cloudflare/engineering-summary-d1.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'google-test-key',alg:'RS256',use:'sig'};
const env={GEMINI_API_KEY:'test-secret',ENGINEERING_SUMMARY_ALLOWED_EMAILS:'allowed@example.com'};
const now=()=>Math.floor(Date.now()/1000);
function token(changes={},key=privateKey){
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const body=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({aud:'406267166897-8geeu3tpc425nc9n7gmimmmflbckp0ta.apps.googleusercontent.com',iss:'https://accounts.google.com',sub:'google-user',email:'allowed@example.com',email_verified:true,iat:now(),exp:now()+3600,...changes});
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),key).toString('base64url');
}
const notes=[{id:'record_first_001',name:'A.md',relativePath:'工程/A.md',content:'# 10239\n尺寸 5.2±0.05\n\n|項目|規定|\n|-|-|\n|鉚釘|先鍍後鉚|\n[^1]: [[來源]]'},
  {id:'record_second_001',name:'B.md',relativePath:'工程/B.md',content:'# U0002 展煜\n頭部必須大於外徑，沒有把握先給老闆看。'}];
const payload=()=>({action:'engineeringRecords.summarize',query:'10239',ids:notes.map(n=>n.id),idToken:token()});
function database(items=notes,lastSync=Date.now()){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE engineering_notes(id TEXT PRIMARY KEY,name TEXT,relative_path TEXT,modified_time TEXT,content TEXT); CREATE TABLE engineering_sync(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);');
  for(const n of items)sqlite.prepare('INSERT INTO engineering_notes VALUES (?,?,?,?,?)').run(n.id,n.name,n.relativePath,'2026-10-10T01:00:00Z',n.content);
  sqlite.prepare('INSERT INTO engineering_sync VALUES (?,?,?)').run('last_sync','ok',lastSync);
  sqlite.prepare('INSERT INTO engineering_sync VALUES (?,?,?)').run('lock','0',0);
  return {sqlite,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};}};}};
}
function upstream(answer){
  const calls=[];
  return {calls,async fetch(url,options){
    if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY);
    const request=JSON.parse(options.body);calls.push(request);
    assert.equal(request.model,'gemini-3.5-flash-lite');assert.equal(request.store,false);
    return answer ? answer(request,calls.length) : Response.json({status:'completed',steps:[{type:'user_input',content:[{type:'text',text:'不要回傳這段'}]},{type:'model_output',content:[{type:'text',text:'## 鉚釘\n工程規定 [來源：工程/A.md] [來源：工程/B.md]'}]}]});
  }};
}
test('D1 mode activates with a server key and can explicitly return to Drive',()=>{
  assert.equal(engineeringSummaryUsesD1({}),false);assert.equal(engineeringSummaryUsesD1(env),true);
  assert.equal(engineeringSummaryUsesD1({...env,ENGINEERING_SUMMARY_SOURCE:'drive'}),false);
  assert.throws(()=>engineeringSummaryUsesD1({ENGINEERING_SUMMARY_SOURCE:'d1'}),/金鑰/);
});
test('verified Google signature, audience, issuer, expiry and allowlist are required before D1 or Gemini',async()=>{
  const api=upstream();
  assert.equal(await authorizeEngineeringSummary(token(),env,api.fetch),'allowed@example.com');
  const other=generateKeyPairSync('rsa',{modulusLength:2048});
  for(const bad of [token({aud:'wrong'}),token({iss:'evil'}),token({exp:now()-1}),token({iat:now()+300}),token({email_verified:false}),token({email:'unapproved@example.com'}),token({},other.privateKey),'test-token']){
    await assert.rejects(summarizeEngineeringD1({...payload(),idToken:bad},{prepare(){throw Error('Must authorize before reading D1');}},env,api.fetch),/Google|權限/);
  }
  assert.equal(api.calls.length,0);
});
test('only selected D1 full text reaches Gemini, preserving Markdown, paths and IDs without Drive reads',async()=>{
  const db=database([...notes,{id:'record_outside_001',name:'X.md',relativePath:'其他/X.md',content:'其他客戶禁止送入'}]),api=upstream();
  const result=await summarizeEngineeringD1({...payload(),records:[{content:'瀏覽器偽造文字'}]},db,env,api.fetch);
  assert.equal(api.calls.length,1);
  for(const note of notes)assert.ok(api.calls[0].input.includes(note.content));
  assert.doesNotMatch(api.calls[0].input,/其他客戶禁止送入|瀏覽器偽造文字|test-secret/);
  assert.match(api.calls[0].input,/專屬規則、適用的通用規則與共用規則，都必須整合在同一主題下/);
  assert.match(api.calls[0].input,/不得為了引用而摘要其他客戶/);
  assert.deepEqual(result.sources,notes.map(({id,name,relativePath})=>({id,name,relativePath})));
  assert.deepEqual(result.citationCoverage.missingIds,[]);assert.equal(result.summaryInputSource,'d1');
  assert.doesNotMatch(result.summary,/不要回傳這段/);
});
test('citation repair reuses the same D1 snapshot and sends only uncited full text',async()=>{
  const api=upstream((request,n)=>Response.json({outputs:[{type:'text',text:n===1?'尺寸 5.2±0.05 [來源：工程/A.md]':'頭部大於外徑 [來源：工程/B.md]'}]}));
  const result=await summarizeEngineeringD1(payload(),database(),env,api.fetch);
  assert.equal(api.calls.length,2);assert.ok(!api.calls[1].input.includes(notes[0].content));assert.ok(api.calls[1].input.includes(notes[1].content));
  assert.match(result.summary,/5.2±0.05[\s\S]*頭部大於外徑/);assert.equal(result.sources.length,2);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('stale or incomplete synchronization blocks D1 summaries without sending content',async()=>{
  const cases=[database(notes,Date.now()-600001),database(),database()];
  cases[1].sqlite.prepare('INSERT INTO engineering_sync VALUES (?,?,?)').run('job','{"pending":[]}',Date.now());
  cases[2].sqlite.prepare("UPDATE engineering_sync SET value=? WHERE key='lock'").run(String(Date.now()));
  const api=upstream();for(const db of cases)await assert.rejects(summarizeEngineeringD1(payload(),db,env,api.fetch),/同步|重新載入/);
  assert.equal(api.calls.length,0);
});
test('missing, truncated or over-budget full text is rejected instead of silently dropping records',async()=>{
  const api=upstream();
  for(const db of [database(notes.slice(0,1)),database([{...notes[0],content:'[內容過長，已截斷]'},notes[1]]),database([{...notes[0],content:'字'.repeat(100001)},notes[1]])])
    await assert.rejects(summarizeEngineeringD1(payload(),db,env,api.fetch),/移除|全文不完整|長度限制/);
  assert.equal(api.calls.length,0);
});
test('a concurrent sync detected after reading notes prevents a mixed snapshot',async()=>{
  const db=database(),prepare=db.prepare.bind(db),api=upstream();
  db.prepare=sql=>{const statement=prepare(sql);if(sql.includes('FROM engineering_notes')){const all=statement.all;statement.all=async function(){const result=await all.call(this);db.sqlite.prepare("UPDATE engineering_sync SET updated_at=updated_at+1 WHERE key='last_sync'").run();return result;};}return statement;};
  await assert.rejects(summarizeEngineeringD1(payload(),db,env,api.fetch),/剛完成更新/);assert.equal(api.calls.length,0);
});
test('blank query and invalid IDs never read D1 or invoke the model',async()=>{
  const api=upstream();
  for(const changes of [{query:' '},{ids:[]},{ids:['bad']},{ids:Array(41).fill(notes[0].id)}])
    await assert.rejects(summarizeEngineeringD1({...payload(),...changes},database(),env,api.fetch),/關鍵字|搜尋結果/);
  assert.equal(api.calls.length,0);
});
test('failed, non-text and oversized Gemini responses cannot claim success or expose server secrets',async()=>{
  for(const answer of [()=>Response.json({error:{message:'test-secret'}},{status:429}),()=>Response.json({status:'failed',outputs:[{type:'text',text:'錯誤'}]}),()=>new Response('x'.repeat(1048577))]){
    const api=upstream(answer);
    await assert.rejects(summarizeEngineeringD1(payload(),database(),env,api.fetch),error=>!error.message.includes('test-secret'));
    assert.equal(api.calls.length,1);
  }
});
test('Sites summary route selects D1 when configured and preserves the API response contract',async()=>{
  const {env:runtime}=await import('cloudflare:workers');
  const {POST}=await import('../app/api/engineering-records-drive/route.ts');
  const saved={...runtime},original=globalThis.fetch,api=upstream();
  try {
    Object.assign(runtime,env,{DB:database()});globalThis.fetch=api.fetch;
    const response=await POST(new Request('https://engineering-query.prc174.chatgpt.site/api/engineering-records-drive',{method:'POST',body:JSON.stringify(payload())}));
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.ok,true);assert.equal(result.summaryInputSource,'d1');assert.equal(result.sources.length,2);
    assert.equal(api.calls.length,1);
  } finally {globalThis.fetch=original;for(const key of Object.keys(runtime))delete runtime[key];Object.assign(runtime,saved);}
});
