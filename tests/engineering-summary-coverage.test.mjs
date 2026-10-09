import assert from 'node:assert/strict';
import test from 'node:test';
import {missingSummarySources, completeEngineeringSummary} from '../cloudflare/engineering-summary-coverage.mjs';

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
test('failed or still uncited repair is reported honestly without fake citations or endless calls',async()=>{
  for(const fails of [true,false]){
    let calls=0;
    const result=await completeEngineeringSummary(payload,async()=>{calls++;if(calls===2&&fails)throw Error('rate limit');return {summary:'規定 '+cite(a),sources:[a,b]};});
    assert.equal(calls,2);assert.deepEqual(result.citationCoverage.missingIds,[b.id]);
    assert.equal(result.citationCoverage.repairFailed,fails);assert.ok(!result.summary.includes(cite(b)));
  }
});
