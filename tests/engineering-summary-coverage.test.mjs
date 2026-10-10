import assert from 'node:assert/strict';
import test from 'node:test';
import {missingSummarySources, completeEngineeringSummary, completeD1EngineeringSummary, engineeringSummarySearchMode} from '../cloudflare/engineering-summary-coverage.mjs';

const a={id:'record_a_001',name:'中文(新版).md',relativePath:'工程/中文(新版).md'};
const b={id:'record_b_001',name:'B.md',relativePath:'工程/B.md'};
const cite=source=>'[來源：'+source.relativePath+']';
const payload={action:'engineeringRecords.summarize',query:' 10017 ',ids:[a.id,b.id],idToken:'test-token'};

test('only body citations count; mentions, inline code, fences and duplicate source lists do not',()=>{
  const text='只是提到 '+a.name+'\n`'+cite(a)+'`\n[外站](https://example.com/'+a.name+')\n![圖片]('+a.relativePath+')\n```md\n'+cite(a)+'\n```\n### 來源檔案清單\n'+cite(a)+'\n## 工程規則\n有效內容 '+cite(b);
  assert.deepEqual(missingSummarySources(text,[a,b]),[a]);
});
test('Chinese encoded names, aliases, combined references and balanced Markdown links resolve',()=>{
  for(const text of [cite(a)+cite(b),'[['+encodeURIComponent(a.relativePath)+'|別名]] [B](工程/B.md)','[A](工程/中文(新版).md) '+cite(b),'[來源：'+a.name+'、'+b.name+']'])
    assert.deepEqual(missingSummarySources(text,[a,b]),[]);
});
test('same filenames require exact paths to identify every source',()=>{
  const other={...a,id:'record_other_001',relativePath:'其他/'+a.name};
  assert.deepEqual(missingSummarySources('[來源：'+a.name+']',[a,other]),[a,other]);
  assert.deepEqual(missingSummarySources(cite(a),[a,other]),[other]);
});
test('outside and nonexistent references never replace missing submitted sources',()=>{
  assert.deepEqual(missingSummarySources('[來源：其他.md] [來源：不存在.md]',[a,b]),[a,b]);
  assert.deepEqual(missingSummarySources(cite(a)+' [來源：其他.md]',[a,b]),[b]);
  assert.deepEqual(missingSummarySources('[來源：未送入的資料夾/'+a.name+']',[a,b]),[a,b]);
});
test('complete summary adds policy and keeps all selected IDs and authentication in one call',async()=>{
  const calls=[];
  const result=await completeEngineeringSummary(payload,async p=>{calls.push(p);return {summary:'規定 '+cite(a)+cite(b),sources:[a,b]};});
  assert.equal(calls.length,1);assert.deepEqual(calls[0].ids,payload.ids);assert.equal(calls[0].idToken,payload.idToken);
  assert.match(calls[0].query,/10017[\s\S]*每篇[\s\S]*不得補造/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);assert.equal(result.citationCoverage.repairAttempted,false);
});
test('only omitted or uncited records are retried once; original content and actual sources survive',async()=>{
  const calls=[];
  const result=await completeEngineeringSummary(payload,async p=>{calls.push(p);return calls.length===1
    ?{summary:'原本工程尺寸 5.2±0.05 '+cite(a),sources:[a]}
    :{summary:'# 工程紀錄摘要\n\n資料不足，未載明尺寸 '+cite(b),sources:[b]};});
  assert.equal(calls.length,2);assert.deepEqual(calls[1].ids,[b.id]);assert.equal(calls[1].idToken,payload.idToken);
  assert.match(result.summary,/5.2±0.05[\s\S]*資料不足/);assert.deepEqual(result.sources,[a,b]);
  assert.deepEqual(result.citationCoverage.missingIds,[]);assert.deepEqual(result.citationCoverage.omittedIds,[]);
});
test('customer scope and universal U0002 rules survive citation repair without expanding the search',async()=>{
  const calls=[];
  const result=await completeEngineeringSummary({...payload,query:' 10239 '},async p=>{
    calls.push(p);
    return calls.length===1
      ?{summary:'## 鉚釘與特殊釘\n10239 適用的尺寸與共用操作規定 '+cite(a),sources:[a,b]}
      :{summary:'此紀錄無與搜尋客戶相關的內容 '+cite(b),sources:[b]};
  });
  assert.equal(calls.length,2);
  for(const call of calls){
    assert.ok(call.query.startsWith('搜尋關鍵字："10239"\n'));
    assert.match(call.query,/只摘要該客戶相關的段落/);
    assert.match(call.query,/U0002／展煜是適用所有客戶的通用規則/);
    assert.match(call.query,/專屬規則、適用的通用規則與共用規則，都必須整合在同一主題下/);
    assert.match(call.query,/不得按客戶或規則來源拆成多個區塊/);
    assert.match(call.query,/意思相同的內容合併為一項[\s\S]*所有支持它的來源引用/);
    assert.match(call.query,/適用條件、客戶例外或相互衝突的說法在對應主題內明確並列/);
    assert.doesNotMatch(call.query,/標示為「通用規則/);
    assert.match(call.query,/其他客戶的專屬尺寸、公差、做法及變更必須排除/);
    assert.match(call.query,/摘要範圍優先於完整引用要求/);
    assert.match(call.query,/不得為了引用而摘要其他客戶/);
    assert.match(call.query,/沒有指定客戶時依搜尋工程主題整理，不猜測客戶/);
  }
  assert.match(calls[1].query,/依原搜尋客戶／關鍵字範圍/);
  assert.match(calls[1].query,/已限定客戶時按主題整合/);
  assert.deepEqual(calls[1].ids,[b.id]);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
  assert.deepEqual(result.sources,[a,b]);
});
test('failed or still uncited repair is reported honestly without fake citations or endless calls',async()=>{
  for(const fails of [true,false]){
    let calls=0;
    const result=await completeEngineeringSummary(payload,async()=>{calls++;if(calls===2&&fails)throw Error('rate limit');return {summary:'規定 '+cite(a),sources:[a,b]};});
    assert.equal(calls,2);assert.deepEqual(result.citationCoverage.missingIds,[b.id]);
    assert.equal(result.citationCoverage.repairFailed,fails);assert.ok(!result.summary.includes(cite(b)));
  }
});

const json = (items, exclusions=[]) => JSON.stringify({topics:[{customer:'',title:'沙拉公差',items}],exclusions});
const noteA = {...a,content:'#1-客戶/10239德承\n沙拉孔公差 +0.2/-0'};
const noteB = {...b,content:'#1-客戶/U0001友通\n沙拉孔公差 ±0.15'};
const commonNote={id:'record_common_001',name:'U0002(展煜).md',relativePath:'工程/U0002(展煜).md',content:'#1-客戶/U0002展煜\n沙拉加工先確認刀具'};
test('classification supports every keyword and recognizes customer codes and names',()=>{
  for(const query of ['白鐵','0.8T','手滑','12000 RPM','沙拉'])
    assert.equal(engineeringSummarySearchMode(query,[noteA,noteB,commonNote]),'keyword');
  for(const query of ['10239','德承','德承 沙拉','10239 白鐵','U0001'])
    assert.equal(engineeringSummarySearchMode(query,[noteA,noteB,commonNote]),'customer');
});
test('keyword summaries put universal rules first and nest topics under each customer',async()=>{
  const notes=[noteA,noteB,commonNote];
  const result=await completeD1EngineeringSummary({...payload,query:'沙拉',ids:notes.map(n=>n.id)},notes,async()=>JSON.stringify({topics:[
    {customer:'德承',title:'沙拉加工',items:[{text:'沙拉孔公差 +0.2/-0',sources:['R1']}]},
    {customer:'友通',title:'沙拉加工',items:[{text:'沙拉孔公差 ±0.15',sources:['R2']}]},
    {customer:'U0002 展煜（專用）',title:'沙拉加工',items:[{text:'U0002 展煜（專用）：先確認刀具',sources:['R3']}]},
  ]}));
  assert.equal(result.summarySearchMode,'keyword');
  assert.match(result.summary,/^# 工程紀錄摘要\n\n## 一、通用規則\n\n### 沙拉加工/);
  assert.match(result.summary,/## 一、通用規則[\s\S]*## 二、客戶專屬規則\n\n### 10239/);
  assert.match(result.summary,/### 10239 德承（專用）\n\n#### 沙拉加工/);
  assert.match(result.summary,/### U0001 友通（專用）\n\n#### 沙拉加工/);
  assert.doesNotMatch(result.summary,/展煜（專用）/);
  assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
  assert.equal(result.sources.length,3);
});
test('customer searches merge universal and customer rules under topics without a universal section',async()=>{
  for(const query of ['10239','德承']){
    const notes=[noteA,commonNote];
    const result=await completeD1EngineeringSummary({...payload,query,ids:notes.map(n=>n.id)},notes,async()=>JSON.stringify({topics:[
      {customer:'通用規則',title:'沙拉加工',items:[{text:'先確認刀具',sources:['R2']}]},
      {customer:'10239 德承',title:'沙拉加工',items:[{text:'沙拉孔公差 +0.2/-0',sources:['R1']}]},
    ]}));
    assert.equal(result.summarySearchMode,'customer');
    assert.equal((result.summary.match(/^## 沙拉加工$/gm)||[]).length,1);
    assert.doesNotMatch(result.summary,/^## 一、通用規則|^## 二、客戶專屬規則|^## .*德承|^### /m);
    assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
  }
});
test('universal-only and unidentified rules never create an empty customer block',async()=>{
  for(const note of [commonNote,{...a,content:'操作時需確認刀具'}]){
    const result=await completeD1EngineeringSummary({...payload,query:'刀具',ids:[note.id]},[note],async()=>JSON.stringify({topics:[
      {customer:'適用範圍未註明',title:'刀具確認',items:[{text:'確認刀具',sources:['R1']}]},
    ]}));
    assert.doesNotMatch(result.summary,/客戶專屬規則/);
    assert.match(result.summary,note===commonNote?/^## 一、通用規則/m:/^## 適用範圍未註明/m);
  }
});
test('mixed-client notes split customer topics while counting one unique submitted source',async()=>{
  const mixed={...noteA,content:'#1-客戶/10239德承 #1-客戶/U0001友通\n德承 +0.2/-0；友通 ±0.15'};
  const result=await completeD1EngineeringSummary({...payload,query:'公差',ids:[mixed.id]},[mixed],async()=>JSON.stringify({topics:[
    {customer:'德承',title:'公差',items:[{text:'+0.2/-0',sources:['R1']}]},
    {customer:'友通',title:'公差',items:[{text:'±0.15',sources:['R1']}]},
  ]}));
  assert.match(result.summary,/### 10239 德承（專用）[\s\S]*### U0001 友通（專用）/);
  assert.equal(result.sources.length,1);
  assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
});
test('repairs preserve the original keyword mode and put repaired universal rules first',async()=>{
  const notes=[noteA,commonNote];let calls=0;
  const result=await completeD1EngineeringSummary({...payload,query:'刀具',ids:notes.map(n=>n.id)},notes,async prompt=>{
    calls++;
    assert.match(prompt,/本次是未限定客戶的關鍵字搜尋/);
    return JSON.stringify({topics:[calls===1
      ? {customer:'德承',title:'刀具',items:[{text:'客戶專用條件',sources:['R1']}]}
      : {customer:'U0002',title:'刀具',items:[{text:'先確認刀具',sources:['R2']}]}]});
  });
  assert.equal(calls,2);
  assert.match(result.summary,/^# 工程紀錄摘要\n\n## 一、通用規則[\s\S]*### 10239 德承（專用）/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('D1 short source keys produce exact clickable IDs even for duplicate or bracketed filenames',async()=>{
  const notes = [noteA,{...noteB,name:a.name,relativePath:'其他/含[符號]'+a.name}];
  const calls=[];
  const result=await completeD1EngineeringSummary({...payload,query:'沙拉'},notes,async prompt=>{
    calls.push(prompt);return json([{text:'10239 德承（專用）：+0.2/-0',sources:['R1']},{text:'友通（專用）：±0.15',sources:['R02']}]);
  });
  assert.equal(calls.length,1);assert.ok(calls[0].includes(notes[1].content));
  assert.match(result.summary,/10239 德承（專用）[\s\S]*友通（專用）/);
  assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
  assert.match(result.summary,/\[來源：ID:record_a_001\]/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('D1 merges duplicate-rule source arrays and excludes fabricated or outside IDs',async()=>{
  const result=await completeD1EngineeringSummary(payload,[noteA,noteB],async()=>json([
    {text:'原文共同規則',sources:['R1','R1','R2','R999']},
    {text:'不明來源規定',sources:['R999']},
  ]));
  assert.doesNotMatch(result.summary,/不明來源規定|R999/);
  assert.equal((result.summary.match(/ID:record_a_001/g)||[]).length,1);
  assert.equal((result.summary.match(/ID:record_b_001/g)||[]).length,1);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('D1 missing-source batch and isolated repair use only missing notes and merge existing topics',async()=>{
  const calls=[];
  const result=await completeD1EngineeringSummary({...payload,query:'沙拉'},[noteA,noteB],async prompt=>{
    calls.push(prompt);
    if(calls.length===1)return json([{text:'德承（專用）：+0.2/-0',sources:['R1']}]);
    if(calls.length===2)return json([]);
    return json([{text:'友通（專用）：±0.15'}]); // Model forgets source array again.
  });
  assert.equal(calls.length,3);
  for(const prompt of calls.slice(1)){
    assert.ok(prompt.includes(noteB.content));assert.ok(!prompt.includes(noteA.content));
    assert.match(prompt,/既有工程主題名稱[\s\S]*沙拉公差/);
    assert.match(prompt,/未指定客戶的任何關鍵字搜尋，必須納入[\s\S]*專用/);
  }
  assert.equal((result.summary.match(/^#### 沙拉公差$/gm)||[]).length,2);
  assert.doesNotMatch(result.summary,/補充工程紀錄/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
  assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
});
test('D1 no-relevant-content explanations cite the reviewed note without claiming an engineering rule',async()=>{
  const result=await completeD1EngineeringSummary({...payload,query:'10239'},[noteA,noteB],async()=>json(
    [{text:'德承（專用）：+0.2/-0',sources:['R1']}],
    [{source:'R2',reason:'此篇僅記載友通的專用規則，未記載適用於 10239 的內容。'}]));
  assert.match(result.summary,/搜尋範圍核對[\s\S]*未記載適用於 10239/);
  assert.doesNotMatch(result.summary,/±0.15/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('D1 incomplete or failed isolated repairs remain genuinely uncited and all sent notes remain visible',async()=>{
  for(const fails of [true,false]){
    let calls=0;
    const result=await completeD1EngineeringSummary(payload,[noteA,noteB],async()=>{
      calls++;if(calls===1)return json([{text:'德承（專用）：+0.2/-0',sources:['R1']}]);
      if(fails)throw Error('provider failure');return json([]);
    });
    assert.equal(calls,3);assert.deepEqual(result.sources,[a,b]);
    assert.deepEqual(result.citationCoverage.missingIds,[b.id]);
    assert.equal(result.citationCoverage.repairFailed,fails);
    assert.doesNotMatch(result.summary,/ID:record_b_001/);
  }
});
test('D1 isolated repair cannot attach a source already handled or outside its input',async()=>{
  let calls=0;
  const result=await completeD1EngineeringSummary(payload,[noteA,noteB],async()=>{
    calls++;if(calls===1)return json([{text:'德承（專用）：+0.2/-0',sources:['R1']}]);
    if(calls===2)return json([{text:'不可接受的 R1 規定',sources:['R1']}]);
    return json([{text:'友通（專用）：±0.15',sources:['R999']}]);
  });
  assert.doesNotMatch(result.summary,/不可接受的 R1 規定/);
  assert.deepEqual(result.citationCoverage.missingIds,[]);
});
test('D1 40-note batches account for exactly 40 submitted unique IDs without filename transcription',async()=>{
  const notes=Array.from({length:40},(_,i)=>({...noteA,id:'record_'+i+'_001',name:'重複.md',relativePath:'目錄'+i+'/重複.md'}));
  let calls=0;
  const result=await completeD1EngineeringSummary({...payload,ids:notes.map(n=>n.id)},notes,async()=>{
    calls++;return json([{text:'共同規則',sources:notes.map((_,i)=>'R'+(i+1))}]);
  });
  assert.equal(calls,1);assert.equal(result.sources.length,40);
  assert.equal((result.summary.match(/\[來源：ID:/g)||[]).length,40);
  assert.deepEqual(missingSummarySources(result.summary,result.sources),[]);
});
test('D1 rejects malformed structured output instead of presenting JSON as a completed summary',async()=>{
  for(const text of ['not JSON','{"topics":{}}','null'])
    await assert.rejects(completeD1EngineeringSummary(payload,[noteA,noteB],async()=>text),/格式未完整/);
});
