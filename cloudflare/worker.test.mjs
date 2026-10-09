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
  globalThis.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json({ok:true,summary:'摘要',sources:ids.map(id=>({id}))});};
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
    assert.equal(calls[0].query,'10017');
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
