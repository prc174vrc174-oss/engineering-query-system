import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {extractRecordTags, engineeringRecordTags, normalizeRecordTag,parseRecordTagQuery} from '../cloudflare/engineering-record-tags.mjs';

function database(notes) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE engineering_notes(id TEXT PRIMARY KEY,name TEXT,relative_path TEXT,modified_time TEXT,content TEXT)');
  for(const [i,content]of notes.entries())sqlite.prepare('INSERT INTO engineering_notes VALUES (?,?,?,?,?)').run('record_tag_'+i,'2026-10-'+String(i+1).padStart(2,'0')+'.md','工程/'+i+'.md','v1',content);
  return {sqlite,prepare(sql){return {values:[],bind(...values){this.values=values;return this;},async run(){const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:r.changes}};},async first(){return sqlite.prepare(sql).get(...this.values)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};}};},async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
test('Obsidian hierarchical tags support frontmatter, Chinese and emoji without code, comments or URL fragments',()=>{
  const md='---\ntags:\n  - "1-客戶/10239德承"\n  - 3-材料/AL\naliases: [不是標籤]\n---\n# 標題\n#2-工程/02模具/簡易模 #7-📣/國恩 #2-工程/02模具/簡易模\n`#假標籤`\n```md\n#程式碼/範例\n```\n<!-- #註解 -->\n[連結](https://example.com/#網址片段) \\#跳脫 #123';
  assert.deepEqual(extractRecordTags(md).sort(),['1-客戶/10239德承','2-工程/02模具/簡易模','3-材料/AL','7-📣/國恩'].sort());
  assert.deepEqual(extractRecordTags('---\ntags: ["3-材料/SUS", 2-工程/05沙拉]\n---').sort(),['2-工程/05沙拉','3-材料/SUS']);
  for(const tag of ['a//b','/a','a/','a b','a\' OR 1=1','a'.repeat(241)])assert.equal(normalizeRecordTag(tag),'');
});
test('visible tag query keeps keyword text separate and preserves literal descendant filtering',()=>{
  assert.deepEqual(parseRecordTagQuery('#1-客戶/10239德承'),{query:'',tag:'1-客戶/10239德承',tags:['1-客戶/10239德承'],invalidTag:false});
  assert.deepEqual(parseRecordTagQuery('沙拉 #2-工程/02模具 SUS'),{query:'沙拉 SUS',tag:'2-工程/02模具',tags:['2-工程/02模具'],invalidTag:false});
  assert.deepEqual(parseRecordTagQuery('沙拉'),{query:'沙拉',tag:'',tags:[],invalidTag:false});
  assert.equal(parseRecordTagQuery('#a//b').invalidTag,true);
  assert.deepEqual(parseRecordTagQuery('#2-工程/16噴砂 #1-客戶/10058新漢 #2-工程/16噴砂 沙拉'),{
    query:'沙拉',tag:'2-工程/16噴砂',tags:['2-工程/16噴砂','1-客戶/10058新漢'],invalidTag:false,
  });
  assert.equal(parseRecordTagQuery(Array.from({length:13},(_,i)=>'#工程/'+i).join(' ')).invalidTag,true);
});
test('corrupt decoded content and malformed tag characters never become catalog tags',()=>{
  for(const tag of ['a\u001c�1&MK\u0012','T�K��D\u001f͒���','工程/\u0000範例','工程/\ud800'])assert.equal(normalizeRecordTag(tag),'');
  for(const tag of ['1-客戶/10239德承','7-📣/國恩','9-⚙️/設定','工程/👩‍🔧'])assert.equal(normalizeRecordTag(tag),tag);
  const binary='\u0000\u0002\u0003\u001c #a\u001c�1&MK\u0012 #T�K��D\u001f͒��� #randomASCII';
  assert.deepEqual(extractRecordTags(binary),[]);
  assert.deepEqual(extractRecordTags('�'.repeat(20)+' #randomASCII'),[]);
  assert.deepEqual(extractRecordTags('#2-工程/16噴砂\n說明：舊資料有一個 � 字元。'),['2-工程/16噴砂']);
});
test('existing tag caches rebuild with unchanged note timestamps when the parser changes',async()=>{
  const db=database(['#1-客戶/10239德承 #7-📣/國恩','\u0000\u0002\u0003\u001c #randomASCII']);
  db.sqlite.exec('CREATE TABLE engineering_note_tags(note_id TEXT PRIMARY KEY,modified_time TEXT NOT NULL,tags_json TEXT NOT NULL)');
  db.sqlite.prepare('INSERT INTO engineering_note_tags VALUES(?,?,?)').run('record_tag_0','v1',JSON.stringify(['a\u001c�1&MK\u0012']));
  db.sqlite.prepare('INSERT INTO engineering_note_tags VALUES(?,?,?)').run('record_tag_1','v1',JSON.stringify(['randomASCII']));
  const paths=(await engineeringRecordTags(db)).map(tag=>tag.path);
  assert.deepEqual(paths,['1-客戶','1-客戶/10239德承','7-📣','7-📣/國恩']);
  assert.deepEqual(JSON.parse(db.sqlite.prepare('SELECT tags_json FROM engineering_note_tags WHERE note_id=?').get('record_tag_1').tags_json),[]);
  assert.equal(db.sqlite.prepare('SELECT parser_version FROM engineering_tag_index_state WHERE id=1').get().parser_version,'2');
  assert.deepEqual((await engineeringRecordTags(db)).map(tag=>tag.path),paths);
  assert.equal(db.sqlite.prepare('SELECT modified_time FROM engineering_notes WHERE id=?').get('record_tag_0').modified_time,'v1');
});
test('multiple tags intersect exact hierarchies and keywords on the same note',async()=>{
  const {env}=await import('cloudflare:workers');
  const {searchEngineeringD1}=await import('../db/engineering-notes.ts');
  const db=database(['#2-工程/16噴砂 #1-客戶/10058新漢 沙拉','#2-工程/16噴砂 #1-客戶/10239德承 沙拉','#2-工程/04折床 #1-客戶/10058新漢 沙拉',
    '#2-工程/16噴砂/鋁擠件 #1-客戶/10058新漢 沙拉','#2-工程/16噴砂 #1-客戶/10058新漢\n另一主題']);
  const saved=env.DB;env.DB=db;
  try {
    const filtered=await searchEngineeringD1('沙拉',['2-工程/16噴砂','1-客戶/10058新漢']);
    assert.deepEqual(filtered.map(n=>n.id).sort(),['record_tag_0','record_tag_3']);
    assert.equal((await searchEngineeringD1('',['2-工程/16噴砂','1-客戶/10058新漢'])).length,3);
  }finally{env.DB=saved;}
});
test('catalog creates all ancestors and counts each note once per ancestor across the entire D1',async()=>{
  const db=database(['#2-工程/02模具/簡易模 #2-工程/02模具/成型模','#2-工程/02模具/簡易模','#2-工程/05沙拉','#7-📣/國恩']);
  const catalog=await engineeringRecordTags(db);
  const count=path=>catalog.find(tag=>tag.path===path)?.count;
  assert.equal(count('2-工程'),3);assert.equal(count('2-工程/02模具'),2);assert.equal(count('2-工程/02模具/簡易模'),2);assert.equal(count('7-📣'),1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM engineering_note_tags').get().count,4);
});
test('tag metadata follows note edits and deletions without stale tags',async()=>{
  const db=database(['#2-工程/舊規則','#3-材料/AL']);
  await engineeringRecordTags(db);
  db.sqlite.prepare('UPDATE engineering_notes SET content=?,modified_time=? WHERE id=?').run('#2-工程/新規則','v2','record_tag_0');
  db.sqlite.prepare('DELETE FROM engineering_notes WHERE id=?').run('record_tag_1');
  const paths=(await engineeringRecordTags(db)).map(tag=>tag.path);
  assert.deepEqual(paths,['2-工程','2-工程/新規則']);
});
test('Sites tag filtering keeps true 15-row database pages and ANDs keyword search with descendants',async()=>{
  const {env}=await import('cloudflare:workers');
  const {listEngineeringD1,searchEngineeringD1}=await import('../db/engineering-notes.ts');
  const db=database([...Array.from({length:21},()=> '#2-工程/02模具/簡易模\n沙拉'), '#2-工程師/02模具\n沙拉', '#2-工程/05沙拉\n沙拉', '#2-工程/02模具/成型模\n不同主題']);
  const saved=env.DB;env.DB=db;
  try {
    const a=await listEngineeringD1(0,'2-工程/02模具/簡易模'),b=await listEngineeringD1(a.nextOffset,'2-工程/02模具/簡易模');
    assert.equal(a.results.length,15);assert.equal(a.total,21);assert.equal(a.hasMore,true);assert.equal(b.results.length,6);assert.equal(b.hasMore,false);
    assert.equal(new Set([...a.results,...b.results].map(r=>r.id)).size,21);assert.ok(!('content' in a.results[0]));
    assert.equal((await searchEngineeringD1('沙拉','2-工程/02模具')).length,21);
    assert.equal((await listEngineeringD1(0,'2-工程/02模具')).total,22);
    assert.equal((await listEngineeringD1(0,'2-工程')).total,23);
    assert.equal((await searchEngineeringD1('不存在','2-工程')).length,0);
    const {transpileModule,ModuleKind}=await import('typescript');
    const routeSource=(await readFile(new URL('../app/api/engineering-records-d1/route.ts',import.meta.url),'utf8'))
      .replace('"../../../db/engineering-notes"',JSON.stringify(new URL('../db/engineering-notes.ts',import.meta.url).href))
      .replace('"../../../cloudflare/engineering-record-tags.mjs"',JSON.stringify(new URL('../cloudflare/engineering-record-tags.mjs',import.meta.url).href));
    const {GET}=await import('data:text/javascript,'+encodeURIComponent(transpileModule(routeSource,{compilerOptions:{module:ModuleKind.ESNext}}).outputText));
    const response=await GET(new Request('https://example.com/api/engineering-records-d1?action=search&query='+encodeURIComponent('#2-工程/02模具')));
    const result=await response.json();assert.equal(response.status,200);assert.equal(result.results.length,22);
  } finally {env.DB=saved;}
});
test('cascading picker includes descendants, applies one path, preserves keyword and restores all tags',async()=>{
  const source=await readFile(new URL('../public/engineering-records-d1.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  function updateRecordTagLabel('),source.indexOf('  function paintStatus('));
  const ids=new Map();
  class Element {
    constructor(){this.children=[];this.value='';}
    set id(id){this._id=id;ids.set(id,this);}get id(){return this._id;}
    appendChild(child){this.children.push(child);}append(...children){this.children.push(...children);}
    replaceChildren(){this.children=[];}setAttribute(key,value){this[key]=value;}
    showModal(){this.open=true;}close(){this.open=false;}focus(){}
  }
  const tags=[{path:'2-工程',count:30},{path:'2-工程/02模具',count:20},{path:'2-工程/02模具/簡易模',count:12},{path:'3-材料',count:18},{path:'3-材料/AL',count:18}];
  const context={document:{createElement:()=>new Element(),getElementById:id=>ids.get(id)},selectedTag:'',draftTag:'',tagCatalog:[],tagRequest:0,
    tagButton:new Element(),tagDialog:new Element(),tagLevels:new Element(),tagPath:new Element(),tagError:new Element(),tagApply:new Element(),
    byId:id=>{if(!ids.has(id))ids.set(id,new Element());return ids.get(id);},call:async()=>({tags}),api:'/api',timer:0,clearTimeout(){},query:{value:'沙拉'},updateRecordQueryClear(){},search(){}};
  runInNewContext(code,context);
  await context.tagButton.onclick();
  assert.equal(context.tagLevels.children.length,1);
  const choose=(id,value)=>{const select=ids.get(id);select.value=value;select.onchange();};
  choose('d1RecordsTagLevel1','2-工程');assert.equal(context.tagLevels.children.length,2);
  choose('d1RecordsTagLevel2','2-工程/02模具');assert.equal(context.tagLevels.children.length,3);
  context.tagApply.onclick();
  assert.equal(context.selectedTag,'2-工程/02模具');assert.equal(context.query.value,'#2-工程/02模具 沙拉');
  assert.equal(context.recordTagParameter(),'&tag='+encodeURIComponent('2-工程/02模具'));
  await context.tagButton.onclick();choose('d1RecordsTagLevel3','2-工程/02模具/簡易模');context.tagApply.onclick();
  assert.equal(context.selectedTag,'2-工程/02模具/簡易模');
  assert.equal(context.query.value,'#2-工程/02模具 #2-工程/02模具/簡易模 沙拉');
  await context.tagButton.onclick();context.tagApply.onclick();
  assert.equal(context.query.value,'#2-工程/02模具 #2-工程/02模具/簡易模 沙拉');
  await context.tagButton.onclick();choose('d1RecordsTagLevel1','3-材料');choose('d1RecordsTagLevel2','3-材料/AL');context.tagApply.onclick();
  assert.equal(context.query.value,'#2-工程/02模具 #2-工程/02模具/簡易模 #3-材料/AL 沙拉');
  const clearCode=source.slice(source.indexOf('  function clearRecordQuery('),source.indexOf('  async function search('));
  context.query.focus=()=>{};context.closeRecordSearchHistory=()=>{};
  runInNewContext(clearCode,context);context.clearRecordQuery();
  assert.equal(context.selectedTag,'');assert.equal(context.recordTagParameter(),'');assert.equal(context.query.value,'');
  context.query.value='#2-工程/02模具 沙拉';context.syncRecordTagFromQuery();
  context.query.value='沙拉';context.syncRecordTagFromQuery();
  assert.equal(context.selectedTag,'');
  const html=await readFile(new URL('../public/engineering-query.html',import.meta.url),'utf8');
  assert.ok(!html.includes('id="d1RecordsTagClear"'));
});
