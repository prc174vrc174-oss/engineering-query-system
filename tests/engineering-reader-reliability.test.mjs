import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {referencingNotes} from '../cloudflare/engineering-record-links.mjs';

const source = await readFile(new URL('../public/engineering-records-d1.js', import.meta.url), 'utf8');
const callCode = source.slice(source.indexOf('  async function call('), source.indexOf('  function view('));
const imageCode = source.slice(source.indexOf('  var imageJobs ='), source.indexOf('  function recordLinkName('));
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (status, value) => ({status, ok: status < 400, json: async () => value});

test('read retries recover network errors and invalid gateway responses, with bounded attempts', async () => {
  const replies = [new TypeError('network'), response(502, null), response(200, {ok:true, results:[]})];
  let calls = 0;
  const context = {AbortController, setTimeout(fn, ms) { if (ms < 5000) queueMicrotask(fn); return 1; }, clearTimeout() {},
    fetch: async () => { calls++; const value = replies.shift(); if (value instanceof Error) throw value; return value; }};
  runInNewContext(callCode, context);
  assert.equal((await context.call('/backlinks', null, {retries:2, timeout:20000})).ok, true);
  assert.equal(calls, 3);
  context.fetch = async () => {calls++; return response(503, {ok:false,error:'busy'});};
  calls = 0;
  await assert.rejects(context.call('/backlinks', null, {retries:2}), /busy/);
  assert.equal(calls, 3);
});

test('authorization failures and writes are never automatically retried', async () => {
  let calls = 0;
  const context = {fetch:async () => {calls++; return response(401, {ok:false,error:'sign in'});}, clearTimeout() {}};
  runInNewContext(callCode, context);
  await assert.rejects(context.call('/backlinks', null, {retries:2}), /sign in/);
  assert.equal(calls, 1);
  context.fetch = async () => {calls++; return response(503, {ok:false,error:'busy'});};
  calls = 0;
  await assert.rejects(context.call('/summary', {method:'POST'}), /busy/);
  assert.equal(calls, 1);
});

class Node {
  constructor(tag) {this.tag=tag;this.children=[];this.style={};this.listeners={};this.classes=new Set();this.classList={add:label=>this.classes.add(label),remove:label=>this.classes.delete(label)};this.scrollLeft=0;this.scrollTop=0;this.clientWidth=624;this.clientHeight=424;this.naturalWidth=1200;this.naturalHeight=800;this.complete=true;}
  appendChild(node) {this.children.push(node);return node;}
  append(...nodes) {this.children.push(...nodes);}
  setAttribute(key, value) {this[key]=value;}
  removeAttribute(key) {delete this[key];}
  set textContent(value) {this.text=value;this.children=[];}
  get textContent() {return this.text;}
  showModal() {this.open=true;}
  close() {this.open=false;this.listeners.close?.();}
  addEventListener(event, callback) {this.listeners[event]=callback;}
  setPointerCapture(id) {this.capturedPointer=id;}
  hasPointerCapture(id) {return this.capturedPointer===id;}
  releasePointerCapture(id) {if(this.capturedPointer===id)this.capturedPointer=null;}
  focus() {this.focused=true;}
}
function imageContext(request) {
  return {request, imageCache:{}, URL, document:{createElement:tag=>new Node(tag),body:new Node('body')},
    window:{location:{href:'https://example.com/engineering-query.html'},addEventListener() {}}};
}

test('image queue bounds parallel requests and keeps working after one fails', async () => {
  const context=imageContext();runInNewContext(imageCode,context);
  let active=0, maximum=0;const pending=[];
  const jobs=Array.from({length:5},(_,i)=>context.queueImage(()=>new Promise((resolve,reject)=>{
    active++;maximum=Math.max(maximum,active);
    pending.push(()=>{active--;i===0?reject(Error('temporary')):resolve(i);});
  })).catch(()=>null));
  await tick();assert.equal(pending.length,2);
  for(let i=0;i<5;i++){pending[i]();await tick();}
  assert.equal(maximum,2);assert.deepEqual(await Promise.all(jobs),[null,1,2,3,4]);
});

test('image failures evict the cache and expose a working retry and click-to-zoom', async () => {
  let requests=0;const policies=[];
  const context=imageContext(async (payload,policy)=>{
    requests++;policies.push(policy);if(requests===1)throw Error('temporary');
    return {image:{dataUrl:'data:image/png;base64,AAAA'}};
  });runInNewContext(imageCode,context);
  const parent=new Node('div');context.appendImage(parent,'圖面','中文圖.png','record1');await tick();
  const [image,hint]=parent.children[0].children;
  assert.equal(image.hidden,true);assert.match(hint.textContent,/temporary/);
  assert.equal(context.imageCache['record1/中文圖.png'],undefined);
  assert.equal(hint.children[0].textContent,'重試圖片');
  hint.children[0].onclick();await tick();
  assert.equal(requests,2);assert.equal(policies[1].retries,2);
  image.onload();assert.equal(image.hidden,false);assert.equal(hint.hidden,true);
  image.onclick();
  const viewer=context.document.body.children[0];assert.equal(viewer.open,true);
  const [toolbar,viewport]=viewer.children;const enlarged=viewport.children[0];
  assert.equal(enlarged.src,image.src);assert.equal(enlarged.style.width,'600px');
  toolbar.children[2].onclick();assert.equal(enlarged.style.width,'900px');
  toolbar.children[3].onclick();assert.equal(enlarged.style.width,'600px');
  toolbar.children[4].onclick();assert.equal(viewer.open,false);
  let prevented=false;image.onkeydown({key:'Enter',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(viewer.open,true);
  const second=new Node('div');context.appendImage(second,'同張圖片','中文圖.png','record1');await tick();
  assert.equal(requests,2);
});

test('external images retain their URL and support retry without changing signed query strings', () => {
  const context=imageContext(()=>{throw Error('must not proxy');});runInNewContext(imageCode,context);
  const parent=new Node('div'),url='https://example.com/a.png?token=signed';
  context.appendImage(parent,'external',url,'record1');const [image,hint]=parent.children[0].children;
  assert.equal(image.src,url);image.onerror();assert.equal(image.hidden,true);
  hint.children[0].onclick();assert.equal(image.src,url);image.onload();assert.equal(image.hidden,false);
});

test('zoomed images pan on both axes with mouse or touch and release the drag on cancellation or close', () => {
  const context=imageContext();runInNewContext(imageCode,context);
  const image=new Node('img');image.src='https://example.com/drawing.png';context.openImageViewer(image);
  const viewer=context.document.body.children[0], [toolbar,viewport]=viewer.children;
  toolbar.children[2].onclick();
  assert.equal(viewport.children[0].draggable,false);
  const event=(pointerId,x,y,extra={})=>({pointerId,clientX:x,clientY:y,button:0,preventDefault(){},...extra});
  viewport.onpointerdown(event(1,300,200,{pointerType:'mouse'}));
  viewport.onpointermove(event(1,180,120));
  assert.equal(viewport.scrollLeft,120);assert.equal(viewport.scrollTop,80);
  assert.equal(viewport.capturedPointer,1);assert.ok(viewport.classes.has('is-dragging'));
  viewport.onpointermove(event(2,0,0));assert.equal(viewport.scrollLeft,120);
  viewport.onpointerup(event(1,180,120));assert.equal(viewport.capturedPointer,null);
  viewport.onpointermove(event(1,0,0));assert.equal(viewport.scrollLeft,120);
  viewport.onpointerdown(event(3,200,200,{pointerType:'touch'}));
  viewport.onpointermove(event(3,160,170));assert.equal(viewport.scrollLeft,160);assert.equal(viewport.scrollTop,110);
  viewport.onpointercancel(event(3,160,170));assert.ok(!viewport.classes.has('is-dragging'));
  viewport.onpointerdown(event(4,200,200));viewer.close();
  assert.equal(viewport.capturedPointer,null);assert.ok(!viewport.classes.has('is-dragging'));
});

test('nail keyword clear updates results and focus while preserving other filters', async () => {
  const html=await readFile(new URL('../public/engineering-query.html',import.meta.url),'utf8');
  const start=html.indexOf('\tfunction updateNailSearchClear('),end=html.indexOf("\tsearchEl.addEventListener('input', applyFilters);",start);
  const handlers={},searchEl={value:'SO-M3',focus(){this.focused=true;}},searchClearBtn={hidden:true,addEventListener(name,fn){handlers[name]=fn;}};
  let refreshes=0,closed=0;
  const inStockEl={checked:true},realDiaSearchEl={value:'4.2'},sortState={col:3,dir:-1};
  const context={searchEl,searchClearBtn,inStockEl,realDiaSearchEl,sortState,applyFilters(){refreshes++;context.updateNailSearchClear();},closeSearchHistory(){closed++;}};
  runInNewContext(html.slice(start,end),context);
  assert.equal(searchClearBtn.hidden,false);
  handlers.click();assert.equal(searchEl.value,'');assert.equal(searchClearBtn.hidden,true);
  assert.equal(refreshes,1);assert.equal(searchEl.focused,true);assert.equal(closed,1);
  assert.equal(inStockEl.checked,true);assert.equal(realDiaSearchEl.value,'4.2');assert.deepEqual(sortState,{col:3,dir:-1});
  searchEl.value='FH';context.updateNailSearchClear();assert.equal(searchClearBtn.hidden,false);
});

test('indexed backlinks preserve relative paths, aliases, ambiguity, code exclusions and fresh catalog changes', () => {
  const target={id:'target',name:'中文圖面.md',relativePath:'A/中文圖面.md'};
  const duplicate={id:'duplicate',name:target.name,relativePath:'B/'+target.name};
  const candidate=(id,path,content)=>({id,name:id+'.md',relativePath:path,content});
  const candidates=[candidate('relative','A/來源.md','[[中文圖面|規定]]'),
    candidate('other','B/來源.md','[[中文圖面]]'),candidate('exact','C/來源.md','[來源](A/%E4%B8%AD%E6%96%87%E5%9C%96%E9%9D%A2.md)'),
    candidate('ambiguous','C/來源.md','[[中文圖面]]'),candidate('code','A/code.md','`[[中文圖面]]`\n```md\n[[中文圖面]]\n```'),
    candidate('mention','A/mention.md','只是提到中文圖面'),candidate('footnote','C/footnote.md','[^x]: [[A/中文圖面|註腳]]')];
  const ids=catalog=>referencingNotes(candidates,target,catalog).map(n=>n.id);
  assert.deepEqual(ids([target,duplicate,...candidates]),['relative','exact','footnote']);
  assert.deepEqual(ids([target,...candidates]),['relative','other','exact','ambiguous','footnote']);
  assert.deepEqual(ids([duplicate,...candidates]),[]);
});

function navigationContext() {
  const rows=['a','b','c'].map(id=>({id,name:id+'.md',relativePath:'工程/'+id+'.md',content:id,modifiedTime:''}));
  const preview=new Node('article');preview.replaceChildren=function(...nodes){this.children=nodes;};
  Object.defineProperty(preview,'childNodes',{get(){return this.children;}});
  const states=[];
  const context={rows,readerRecordId:'',readerPrevious:new Node('button'),readerNext:new Node('button'),dialog:new Node('dialog'),
    preview,previewTitle:new Node('h3'),previewMeta:new Node('p'),readerStack:[],readerRequest:0,readerSession:'test',readerSearch:'a',readerTitle:'查詢系統',
    recordWindow:false,isMobileReader:()=>true,api:'/api/records',date:()=>'',
    document:{title:'查詢系統',createElement:tag=>new Node(tag)},
    window:{location:{href:'https://example.com/'},history:{state:{preserved:true},pushState(state){this.state=state;states.push(state);}}},
    call:async url=>({record:rows.find(note=>note.id===new URL(url,'https://example.com/').searchParams.get('id'))}),
    renderMarkdown(content,id,target){target.appendChild(new Node(content));},highlightRecordContent(){},loadRecordBacklinks:async()=>{}};
  runInNewContext(source.slice(source.indexOf('  function updateReaderNavigation('),source.indexOf('  async function loadRecordBacklinks('))+
    source.slice(source.indexOf('  function restoreReaderView('),source.indexOf('  function closeRecordReader(')),context);
  return {context,states};
}

test('reader navigation follows loaded records, hides boundaries and restores linked-note state without stacking sibling switches', async () => {
  const {context,states}=navigationContext();const {rows,readerPrevious,readerNext}=context;
  await context.openRecord(rows[0]);assert.equal(readerPrevious.hidden,true);assert.equal(readerNext.hidden,false);
  await context.navigateReader(1);assert.equal(context.readerRecordId,'b');assert.equal(readerPrevious.hidden,false);assert.equal(readerNext.hidden,false);
  await context.navigateReader(1);assert.equal(context.readerRecordId,'c');assert.equal(readerNext.hidden,true);
  await context.navigateReader(1);assert.equal(context.readerRecordId,'c');
  assert.equal(states.length,1);assert.equal(context.readerStack.length,1);
  await context.navigateReader(-1);await context.openRecord(rows[0]);
  assert.equal(states.length,2);context.restoreReaderView(context.readerStack.pop());
  assert.equal(context.readerRecordId,'b');assert.equal(readerPrevious.hidden,false);assert.equal(readerNext.hidden,false);
  context.rows=[rows[1]];context.updateReaderNavigation();assert.equal(readerPrevious.hidden,true);assert.equal(readerNext.hidden,true);
  context.readerRecordId='outside-results';context.updateReaderNavigation();assert.equal(readerPrevious.hidden,true);assert.equal(readerNext.hidden,true);
  context.rows=rows;context.readerRecordId='b';context.recordWindow=true;context.updateReaderNavigation();
  assert.equal(readerPrevious.hidden,true);assert.equal(readerNext.hidden,true);await context.navigateReader(1);assert.equal(context.readerRecordId,'b');
});

test('rapid next-page clicks keep the newest note when an older read finishes later', async () => {
  const {context}=navigationContext();await context.openRecord(context.rows[0]);
  let finishOlder;
  context.call=async url=>{const id=new URL(url,'https://example.com/').searchParams.get('id');
    if(id==='b')return new Promise(resolve=>{finishOlder=()=>resolve({record:context.rows[1]});});
    return {record:context.rows.find(row=>row.id===id)};};
  const older=context.navigateReader(1);await context.navigateReader(1);
  assert.equal(context.previewTitle.textContent,'c.md');finishOlder();await older;
  assert.equal(context.previewTitle.textContent,'c.md');assert.equal(context.readerRecordId,'c');
});
