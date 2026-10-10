import { status, refresh as refreshRecords } from './engineering-record-sync.mjs';
import { engineeringSummaryUsesD1, summarizeEngineeringD1 } from './engineering-summary-d1.mjs';
import { backlinkNeedles, referencingNotes } from "./engineering-record-links.mjs";
import { completeEngineeringSummary } from "./engineering-summary-coverage.mjs";
// GitHub Pages engineering records API, independently bound to janyu056's D1.
export const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec';
const ORIGIN = 'https://prc174vrc174-oss.github.io';
const ID = /^[\w-]{10,100}$/;
export async function drive(action, extra = {}) {
  const response = await fetch(WEB_APP_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({action,...extra}), redirect:'follow', signal:AbortSignal.timeout(action === 'engineeringRecords.summarize' ? 120000 : 60000)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(String(result.error || 'Google Drive 同步失敗。'));
  return result;
}
export { status };
export async function list(db, offset = 0) {
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT id, name, relative_path AS relativePath, modified_time AS modifiedTime
      FROM engineering_notes
      ORDER BY CASE WHEN name GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        AND substr(name, 11, 1) NOT GLOB '[0-9]' THEN substr(name, 1, 10) ELSE '' END DESC,
        name COLLATE NOCASE DESC, id DESC LIMIT 15 OFFSET ?`).bind(offset)
      .all(),
    db.prepare("SELECT COUNT(*) AS total FROM engineering_notes").first(),
  ]);
  const total = count?.total || 0;
  const nextOffset = offset + rows.results.length;
  return { results: rows.results, total, nextOffset, hasMore: nextOffset < total };
}

export async function search(db, query) {
  const terms = query.split(/[\s，。；、？！?：:（）()／/]+/).map(s=>s.trim().toLowerCase())
    .filter(s=>s && (s.length>=2 || /^\d+$/.test(s))).slice(0,6);
  if (!terms.length) terms.push(query.toLowerCase());
  // Literal substring matching avoids D1 LIKE limits on long Chinese filenames.
  const predicates = terms.map(()=>"(instr(lower(name), ?) > 0 OR instr(lower(content), ?) > 0)");
  const params = terms.flatMap(term=>[term,term]);
  const result = await db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime
    FROM engineering_notes WHERE ${predicates.join(' AND ')} LIMIT 500`).bind(...params).all();
  return result.results;
}
export async function backlinks(db, id) {
  const target=await db.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes WHERE id=?').bind(id).first();
  if (!target) return null;
  const needles=backlinkNeedles(target);
  const [catalog,candidates]=await Promise.all([
    db.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime FROM engineering_notes').all(),
    db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes
      WHERE id <> ? AND (${needles.map(()=>"instr(lower(content), ?) > 0").join(' OR ')})`).bind(id,...needles).all(),
  ]);
  return referencingNotes(candidates.results,target,catalog.results);
}

export async function refresh(db, force, fetchDrive = drive) { return refreshRecords(db, force, fetchDrive); }
async function proxy(payload, env) {
  const allowed = new Set(['engineeringRecords.folders','engineeringRecords.settings.get','engineeringRecords.settings.save','engineeringRecords.image','engineeringRecords.summarize']);
  if (!allowed.has(payload.action)) return [{ok:false,error:'不支援的工程紀錄操作。'},400];
  if (['engineeringRecords.settings.save','engineeringRecords.summarize'].includes(payload.action) && (typeof payload.idToken!=='string' || !payload.idToken)) return [{ok:false,error:'請先使用允許的 Google 帳號登入。'},401];
  if (payload.action==='engineeringRecords.settings.save' && (!Array.isArray(payload.includedFolders) || payload.includedFolders.length>30 || payload.includedFolders.some(f=>typeof f!=='string' || f.length>120))) return [{ok:false,error:'搜尋資料夾設定不正確。'},400];
  if (payload.action==='engineeringRecords.image' && (typeof payload.id!=='string' || !ID.test(payload.id) || typeof payload.name!=='string')) return [{ok:false,error:'圖片參照不正確。'},400];
  if (payload.action==='engineeringRecords.summarize') {
    if (typeof payload.query!=='string' || !payload.query.trim()) return [{ok:false,error:'請先輸入搜尋關鍵字，再產生摘要。'},400];
    payload.query=payload.query.trim();
    if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.some(id=>typeof id!=='string' || !ID.test(id))) return [{ok:false,error:'目前沒有可摘要的搜尋結果。'},400];
    payload.ids=payload.ids.slice(0,40);
  }
  const forward=p=>drive(p.action,Object.fromEntries(Object.entries(p).filter(([key])=>key!=='action')));
  const result=payload.action==='engineeringRecords.summarize'
    ? engineeringSummaryUsesD1(env) ? await summarizeEngineeringD1(payload,env.DB,env) : await completeEngineeringSummary(payload,forward)
    : await forward(payload);
  return [result,200];
}
export default {
  async fetch(request,env) {
    const origin = request.headers.get('Origin') || '';
    const headers = {'Cache-Control':'no-store',Vary:'Origin',...(origin===ORIGIN ? {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'} : {})};
    const reply = (body,code=200)=>Response.json(body,{status:code,headers});
    if (origin && origin!==ORIGIN) return reply({ok:false,error:'來源不允許。'},403);
    const url = new URL(request.url);
    if (!['/api/engineering-records-d1','/api/engineering-records-drive'].includes(url.pathname)) return reply({ok:false,error:'找不到此 API。'},404);
    if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
    try {
      if (url.pathname.endsWith('-drive')) {
        if (request.method!=='POST') return reply({ok:false,error:'不支援的操作。'},405);
        const [body,code]=await proxy(await request.json(),env);return reply(body,code);
      }
      if (request.method==='GET') {
        const action=url.searchParams.get('action');
        if (action==='status') return reply({ok:true,...await status(env.DB)});
        if (action==='search') {
          const query=(url.searchParams.get('query') || '').trim();
          if (query.length>120) return reply({ok:false,error:'搜尋關鍵字最多 120 個字元。'},400);
          if (!query) {
            const rawOffset=url.searchParams.get('offset') || '0', offset=Number(rawOffset);
            if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset>10000000) return reply({ok:false,error:'載入位置不正確。'},400);
            return reply({ok:true,...await list(env.DB,offset)});
          }
          return reply({ok:true,results:await search(env.DB,query)});
        }
        if (action==='backlinks') {
          const id=url.searchParams.get('id') || '';
          if (!ID.test(id)) return reply({ok:false,error:'檔案編號不正確。'},400);
          const results=await backlinks(env.DB,id);
          return results ? reply({ok:true,results}) : reply({ok:false,error:'找不到工程紀錄。'},404);
        }
        if (action==='read') {
          const id=url.searchParams.get('id') || '';
          if (!ID.test(id)) return reply({ok:false,error:'檔案編號不正確。'},400);
          const record=await env.DB.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes WHERE id=?').bind(id).first();
          return record ? reply({ok:true,record}) : reply({ok:false,error:'找不到工程紀錄。'},404);
        }
      }
      if (request.method==='POST') {
        const payload=await request.json();
        if (payload.action==='refresh') return reply({ok:true,...await refresh(env.DB,payload.force===true)});
      }
      return reply({ok:false,error:'不支援的操作。'},400);
    } catch (error) { return reply({ok:false,error:error.message || '資料庫暫時無法使用。'},503); }
  }
};
