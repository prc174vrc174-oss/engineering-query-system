import {generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{refresh,search,status,list} from './worker.mjs';
function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async run(){const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}
const note=(id,name='規定.md',content='雷射 折彎 10017')=>({id,name,relativePath:'筆記/'+name,modifiedTime:'2026-10-08T00:00:00.000Z',content});
function source(notes,extra={}) {return async(action,payload)=>{
  if(action==='engineeringRecords.catalog')return {records:notes.map(({content,...meta})=>meta),includedFolders:['筆記']};
  if(action==='engineeringRecords.batchRead')return {records:notes.filter(n=>payload.ids.includes(n.id)),...extra};
  if(action==='engineeringRecords.settings.get')return {includedFolders:['筆記']};
  throw new Error(action);
};}
async function seed(db,notes){for(const n of notes)await db.prepare('INSERT INTO engineering_notes VALUES (?,?,?,?,?)').bind(n.id,n.name,n.relativePath,n.modifiedTime,n.content).run();}
test('hierarchical tags cover D1, page filtered results and stay current after Drive synchronization',async()=>{
  const db=database(),notes=Array.from({length:21},(_,i)=>note('tag_note_'+String(i).padStart(4,'0'),'筆記'+i+'.md','#2-工程/02模具/簡易模\n沙拉'));
  notes.push(note('other_tag_0001','其他.md','#2-工程師/02模具\n沙拉'));
  await seed(db,notes);
  const get=async suffix=>{
    const response=await worker.fetch(new Request('https://api/api/engineering-records-d1?'+suffix),{DB:db});
    return {status:response.status,body:await response.json()};
  };
  const catalog=await get('action=tags');assert.equal(catalog.status,200);
  assert.equal(catalog.body.tags.find(t=>t.path==='2-工程').count,21);
  const first=await get('action=search&tag='+encodeURIComponent('2-工程/02模具'));
  assert.equal(first.body.results.length,15);assert.equal(first.body.total,21);assert.equal(first.body.hasMore,true);
  const next=await get('action=search&offset=15&tag='+encodeURIComponent('2-工程/02模具'));
  assert.equal(next.body.results.length,6);assert.equal(next.body.hasMore,false);
  const searched=await get('action=search&query=沙拉&tag='+encodeURIComponent('2-工程'));
  assert.equal(searched.body.results.length,21);
  const visible=await get('action=search&query='+encodeURIComponent('#2-工程/02模具'));
  assert.equal(visible.body.results.length,21);assert.equal(visible.body.hasMore,undefined);
  const combined=await get('action=search&query='+encodeURIComponent('#2-工程/02模具 沙拉'));
  assert.equal(combined.body.results.length,21);
  await db.prepare("UPDATE engineering_notes SET content=content || ' #1-客戶/10058新漢',modified_time=? WHERE id IN (?,?)")
    .bind('2026-10-11T00:00:00Z','tag_note_0000','tag_note_0001').run();
  const intersection=await get('action=search&query='+encodeURIComponent('#2-工程/02模具 #1-客戶/10058新漢 沙拉'));
  assert.equal(intersection.body.results.length,2);
  assert.equal((await get('action=search&tag=bad%20tag')).status,400);
  const changed={...notes[0],content:'#3-材料/AL',modifiedTime:'2026-10-12T00:00:00Z'};
  await refresh(db,true,source([changed,...notes.slice(2)]));
  const after=await get('action=tags');
  assert.equal(after.body.tags.find(t=>t.path==='2-工程').count,19);
  assert.equal(after.body.tags.find(t=>t.path==='3-材料/AL').count,1);
});
test('imports resumable batches and returns progress',async()=>{
  const db=database(),notes=Array.from({length:19},(_,i)=>note('record_'+String(i).padStart(6,'0')));
  const first=await refresh(db,true,source(notes));assert.equal(first.syncing,true);assert.equal(first.remaining,3);assert.equal(first.total,16);
  const last=await refresh(db,true,source(notes));assert.equal(last.total,19);assert.equal(last.changed,19);assert.equal(last.syncing,undefined);assert.ok(last.lastSync);
});
test('Drive add, content change, removal and rename/move commit',async()=>{
  const db=database(),old=[note('old_record_001'),note('edit_record_001'),note('move_record_001')];await seed(db,old);
  const changed={...old[1],content:'新版材料',modifiedTime:'2026-10-08T01:00:00Z'};
  const moved={...old[2],name:'移動.md',relativePath:'其他/移動.md'};
  const result=await refresh(db,true,source([changed,moved,note('new_record_001')]));
  assert.equal(result.changed,3);assert.equal(result.removed,1);assert.equal(result.total,3);
  assert.equal((await search(db,'新版材料'))[0].id,changed.id);
  assert.equal((await search(db,'移動'))[0].relativePath,'其他/移動.md');
});
test('incomplete full-text batch retains originals and never deletes',async()=>{
  const db=database();await seed(db,[note('keep_record_001')]);
  await assert.rejects(refresh(db,true,source([note('new_record_001')],{records:[]})),/無法完整讀取/);
  assert.equal((await status(db)).total,1);
});
test('invalid catalog retains originals',async()=>{
  const db=database();await seed(db,[note('keep_record_001')]);
  await assert.rejects(refresh(db,true,source([note('bad')])),/目錄資料不完整/);
  assert.equal((await status(db)).total,1);
});
test('search combines terms, escapes wildcard literals, and supports read',async()=>{
  const db=database();await seed(db,[note('search_record_001','A_10%.md','雷射 10017')]);
  assert.equal((await search(db,'雷射 10017')).length,1);assert.equal((await search(db,'A_10%')).length,1);assert.equal((await search(db,'不存在')).length,0);
  const response=await worker.fetch(new Request('https://api/api/engineering-records-d1?action=read&id=search_record_001'),{DB:db});assert.equal((await response.json()).record.content,'雷射 10017');
});
test('OR keyword branches are unions within all tag constraints and invalid operators return 400',async()=>{
  const db=database();await seed(db,[note('or_record_0001','第一.md','10258 沙拉 #2-工程/16噴砂'),note('or_record_0002','第二.md','10239 沙拉 #2-工程/16噴砂'),note('or_record_0003','其他.md','10239 沙拉'),note('or_record_0004','兩家.md','10258 10239 沙拉 #2-工程/16噴砂')]);
  assert.equal((await search(db,'10258 OR 10239')).length,4);
  assert.equal((await search(db,'10258 10239')).length,1);
  const get=q=>worker.fetch(new Request('https://api/api/engineering-records-d1?action=search&query='+encodeURIComponent(q)),{DB:db});
  const result=await get('#2-工程/16噴砂 10258 沙拉 OR 10239 沙拉');
  assert.equal(result.status,200);assert.equal((await result.json()).results.length,3);
  for(const q of ['OR','10258 OR','OR 10239','10258 OR OR 10239'])assert.equal((await get(q)).status,400);
});
test('tag OR accepts the exact screenshot query and does not impose the last tag on both branches',async()=>{
  const a='#1-客戶/10160昇達',b='#1-客戶/10252全漢',db=database();
  await seed(db,[note('tagor_record_01','第一.md',a+' 沙拉'),note('tagor_record_02','第二.md',b+'/子項 沙拉'),note('tagor_record_03','兩家.md',a+' '+b+' 沙拉'),note('tagor_record_04','其他.md','#1-客戶/其他 沙拉')]);
  const get=q=>worker.fetch(new Request('https://api/api/engineering-records-d1?action=search&query='+encodeURIComponent(q)+'&tag='+encodeURIComponent(b.slice(1))),{DB:db});
  const result=await get(a+' OR '+b);assert.equal(result.status,200);assert.equal((await result.json()).results.length,3);
  assert.equal((await search(db,a+' '+b)).length,1);
  assert.equal((await search(db,a+' 沙拉 OR '+b+' 沙拉')).length,3);
  assert.equal((await get(a+' OR')).status,400);
});
test('recent sync skips repeated requests and concurrent lock is respected',async()=>{
  const db=database();await refresh(db,true,source([note('record_test_001')]));
  assert.equal((await refresh(db,false,async()=>{throw new Error('must skip');})).skipped,true);
  await db.prepare("UPDATE engineering_sync SET value=?,updated_at=? WHERE key='lock'").bind(String(Date.now()),Date.now()).run();
  assert.equal((await refresh(db,true,source([]))).busy,true);
});
test('CORS, invalid IDs, unsupported routes, and Google authentication',async()=>{
  const db=database();const request=(path,init)=>worker.fetch(new Request('https://api'+path,init),{DB:db});
  const options=await request('/api/engineering-records-d1',{method:'OPTIONS',headers:{Origin:'https://prc174vrc174-oss.github.io'}});assert.equal(options.status,204);assert.equal(options.headers.get('Access-Control-Allow-Origin'),'https://prc174vrc174-oss.github.io');
  assert.equal((await request('/api/engineering-records-d1?action=status',{headers:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await request('/api/engineering-records-d1?action=read&id=bad')).status,400);
  assert.equal((await request('/api/engineering-records-d1?action=search&query=')).status,200);
  assert.equal((await request('/api/engineering-records-d1?action=search&query='+ 'x'.repeat(121))).status,400);
  assert.equal((await request('/unknown')).status,404);
  assert.equal((await request('/api/engineering-records-drive',{method:'POST',body:JSON.stringify({action:'engineeringRecords.settings.save',includedFolders:[]})})).status,401);
  assert.equal((await request('/api/engineering-records-drive',{method:'POST',body:JSON.stringify({action:'engineeringRecords.summarize',ids:['record_test_001']})})).status,401);
});

test('Gemini proxy forwards all 40 selected IDs in one request',async()=>{
  const ids=Array.from({length:40},(_,i)=>'record_'+String(i).padStart(6,'0'));
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({ok:true,summary:'摘要 '+ids.map(id=>'[來源：'+id+'.md]').join(''),sources:ids.map(id=>({id,name:id+'.md'}))});};
  try {
    for (const query of [undefined,'','   ',123]) {
      const invalid=await worker.fetch(new Request('https://api/api/engineering-records-drive',{method:'POST',body:JSON.stringify({action:'engineeringRecords.summarize',query,ids,idToken:'test-token'})}),{DB:database()});
      assert.equal(invalid.status,400);
      assert.equal((await invalid.json()).error,'請先輸入搜尋關鍵字，再產生摘要。');
    }
    assert.equal(calls.length,0);
    const response=await worker.fetch(new Request('https://api/api/engineering-records-drive',{method:'POST',body:JSON.stringify({action:'engineeringRecords.summarize',query:' 10017 ',ids,idToken:'test-token'})}),{DB:database()});
    assert.equal(response.status,200);
    assert.equal((await response.json()).sources.length,40);
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0].ids,ids);
    assert.match(calls[0].query,/10017[\s\S]*每篇提供的工程紀錄/);
  } finally {globalThis.fetch=original;}
});

test('empty search loads 15 metadata rows per page with dates first, no gaps, and bounds', async () => {
  const db=database(), notes=Array.from({length:51},(_,i)=>note('all_record_'+String(i).padStart(6,'0'),i<45?'2026-10-'+String(1+i%9).padStart(2,'0')+' '+i+'.md':'99999 '+i+'.md'));
  await seed(db,notes);
  const fetchPage=async(offset)=>worker.fetch(new Request('https://api/api/engineering-records-d1?action=search&query=&offset='+offset),{DB:db});
  const pages=[];
  for(const offset of [0,15,30,45]){
    const response=await fetchPage(offset);assert.equal(response.status,200);pages.push(await response.json());
  }
  assert.deepEqual(pages.map(p=>p.results.length),[15,15,15,6]);
  assert.deepEqual(pages.map(p=>p.nextOffset),[15,30,45,51]);
  assert.deepEqual(pages.map(p=>p.hasMore),[true,true,true,false]);
  assert.ok(pages.every(p=>p.total===51));
  const records=pages.flatMap(p=>p.results);
  assert.equal(new Set(records.map(r=>r.id)).size,51);
  assert.ok(records.every(record=>record.id&&record.name&&record.relativePath&&record.modifiedTime&&!Object.hasOwn(record,'content')));
  assert.ok(records.slice(0,45).every(r=>/^2026/.test(r.name)));
  assert.ok(records.slice(45).every(r=>/^99999/.test(r.name)));
  const dates=records.slice(0,45).map(r=>r.name.slice(0,10));
  assert.deepEqual(dates,[...dates].sort().reverse());
  assert.equal((await search(db,'雷射')).length,51);
  assert.equal((await search(db,'不存在')).length,0);
  for(const offset of ['-1','1.5','no','10000001'])assert.equal((await fetchPage(offset)).status,400);
  const empty=await list(database());assert.deepEqual(empty,{results:[],total:0,nextOffset:0,hasMore:false});
});

test('backlinks resolve wiki aliases, footnotes, encoded Markdown and note URLs without false mentions', async () => {
  const db=database(), target={...note('back_target_001','A_%(新版).md','[[A_%(新版)]]'),relativePath:'工程/A_%(新版).md'};
  const link=(id,content,path='其他/'+id+'.md')=>({...note(id,id+'.md',content),relativePath:path});
  await seed(db,[target,
    link('wiki_record_001','[[A_%(新版)|顯示名稱]]\n註腳[^x]\n[^x]: [[工程/A_%(新版).md#段落]]'),
    link('mark_record_001','[筆記](../工程/A_%25(新版).md#段落)'),
    link('url_record_001','[筆記](https://engineering-query.prc174.chatgpt.site/engineering-query.html?recordId=back_target_001)'),
    link('text_record_001','只是提到 A_%(新版).md，沒有連結'),
    link('code_record_001','`[[A_%(新版)]]`\n```md\n[[A_%(新版)]]\n```\n%%[[A_%(新版)]]%%'),
    link('evil_record_001','[外站](https://unrelated.example/?recordId=back_target_001)'),
    link('wrong_record_001','[[A_%(新版)其他]]'),
  ]);
  const response=await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id='+target.id),{DB:db});
  assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(result.results.map(r=>r.id).sort(),['mark_record_001','url_record_001','wiki_record_001']);
  assert.ok(result.results.every(r=>!Object.hasOwn(r,'content')));
  await seed(db,[{...note('duplicate_0001',target.name),relativePath:'別處/'+target.name},link('ambig_record_001','[[A_%(新版)]]')]);
  const again=await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id='+target.id),{DB:db});
  assert.ok(!(await again.json()).results.some(r=>r.id==='ambig_record_001'));
  assert.equal((await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id=bad'),{DB:db})).status,400);
  assert.equal((await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id=missing_record_001'),{DB:db})).status,404);
});

test('backlinks span all records and reflect Drive content edits and removals', async () => {
  const db=database(),target=note('back_target_002','目標.md','規則');
  const links=Array.from({length:26},(_,i)=>note('back_source_'+String(i).padStart(6,'0'),'來源'+i+'.md','[[目標]]'));
  await seed(db,[target,...links]);
  const read=async()=> (await (await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id='+target.id),{DB:db})).json()).results;
  assert.equal((await read()).length,26);
  const edited={...links[0],content:'已移除原連結',modifiedTime:'2026-10-09T07:00:00Z'};
  await refresh(db,true,source([target,edited,...links.slice(2)]));
  const result=await read();assert.equal(result.length,24);
  assert.ok(!result.some(r=>r.id===links[0].id || r.id===links[1].id));
});

 test('backlinks accept long Chinese and emoji filenames without LIKE patterns', async () => {
  const db=database(),name='2025-09-22 (週一) 1📣防烤治具以0.8T為主';
  const target=note('long_target_001',name+'.md');
  await seed(db,[target,note('long_source_001','來源.md','[來源]('+encodeURIComponent(name)+'.md)')]);
  const prepare=db.prepare;
  db.prepare=function(sql){assert.ok(!sql.includes('LIKE'),'Avoid production D1 LIKE limits');return prepare.call(this,sql);};
  const response=await worker.fetch(new Request('https://api/api/engineering-records-d1?action=backlinks&id='+target.id),{DB:db});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).results.map(row=>row.id),['long_source_001']);
});

test('long linked filenames and wildcard literals avoid production D1 LIKE limits', async () => {
  const db=database(),name='2025-06-30 (週一) 3📣(鴻發)烤漆件,如果客圖未明確提到哪裡是外觀面或是毛邊面.md';
  await seed(db,[note('long_link_001',name),note('literal_link_001','A_10%.md','C:\\Temp A_10%'),note('decoy_link_001','AX100.md','雷射')]);
  const prepare=db.prepare;
  db.prepare=function(sql){assert.doesNotMatch(sql,/\bLIKE\b|\bGLOB\b/i);return prepare.call(this,sql);};
  const query=name.replace(/\.md$/,'');
  assert.ok(Buffer.byteLength(query)>50);
  const response=await worker.fetch(new Request('https://api/api/engineering-records-d1?action=search&query='+encodeURIComponent(query)),{DB:db});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).results.map(row=>row.id),['long_link_001']);
  for(const query of ['A_10%','C:\\Temp'])assert.deepEqual((await search(db,query)).map(row=>row.id),['literal_link_001']);
  assert.deepEqual((await search(db,'雷射 10017')).map(row=>row.id),['long_link_001']);
});

test('GitHub API uses its own D1 full text and never calls Drive when the server key is configured',async()=>{
  const db=database();await seed(db,[note('direct_record_001','直接摘要.md','10239 D1 全文 尺寸5.2±0.05')]);
  await db.prepare("INSERT INTO engineering_sync VALUES ('last_sync','ok',?)").bind(Date.now()).run();
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'test'};
  const enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const signed=enc({alg:'RS256',kid:'test'})+'.'+enc({iss:'https://accounts.google.com',aud:'406267166897-8geeu3tpc425nc9n7gmimmmflbckp0ta.apps.googleusercontent.com',sub:'user',email:'allowed@example.com',email_verified:true,iat:now,exp:now+3600});
  const idToken=signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(url);
    if(url==='https://www.googleapis.com/oauth2/v3/certs')return Response.json({keys:[jwk]});
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.ok(JSON.parse(options.body).contents[0].parts[0].text.includes('10239 D1 全文 尺寸5.2±0.05'));
    return Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:JSON.stringify({topics:[{customer:'',title:'公差',items:[{text:'尺寸 5.2±0.05',sources:['R1']}]}],exclusions:[]})}]}}]});
  };
  try {
    const result=await worker.fetch(new Request('https://api/api/engineering-records-drive',{method:'POST',body:JSON.stringify({action:'engineeringRecords.summarize',query:'10239',ids:['direct_record_001'],idToken})}),{DB:db,GEMINI_API_KEY:'test-secret',ENGINEERING_SUMMARY_ALLOWED_EMAILS:'allowed@example.com'});
    assert.equal(result.status,200);const body=await result.json();assert.equal(body.summaryInputSource,'d1');assert.equal(body.sources[0].id,'direct_record_001');assert.equal(calls.length,2);
  } finally {globalThis.fetch=original;}
});
