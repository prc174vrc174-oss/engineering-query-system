import { backlinkPatterns, referencingNotes } from "./engineering-record-links.mjs";
// GitHub Pages engineering records API, independently bound to janyu056's D1.
export const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec';
const ORIGIN = 'https://prc174vrc174-oss.github.io';
const ID = /^[\w-]{10,100}$/;
const UPSERT = `INSERT INTO engineering_notes (id,name,relative_path,modified_time,content)
 VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
 relative_path=excluded.relative_path,modified_time=excluded.modified_time,content=excluded.content`;
const SAVE = `INSERT INTO engineering_sync (key,value,updated_at) VALUES (?,?,?)
 ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`;
export async function drive(action, extra = {}) {
  const response = await fetch(WEB_APP_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({action,...extra}), redirect:'follow', signal:AbortSignal.timeout(action === 'engineeringRecords.summarize' ? 120000 : 60000)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(String(result.error || 'Google Drive 同步失敗。'));
  return result;
}
export async function status(db) {
  const count = await db.prepare('SELECT COUNT(*) AS total FROM engineering_notes').first();
  const rows = await db.prepare("SELECT key,value,updated_at FROM engineering_sync WHERE key IN ('folders','last_sync','job')").all();
  const values = Object.fromEntries(rows.results.map(row => [row.key,row]));
  const job = values.job ? JSON.parse(values.job.value) : null;
  return {total:count.total, includedFolders:JSON.parse(values.folders?.value || '[]'),lastSync:values.last_sync?.updated_at || 0,
    ...(job ? {syncing:true,remaining:job.pending.length} : {})};
}
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
  const predicates = terms.map(()=>"(lower(name) LIKE ? ESCAPE '\\' OR lower(content) LIKE ? ESCAPE '\\')");
  const params = terms.flatMap(term=>{const pattern=`%${term.replace(/[\\%_]/g,'\\$&')}%`;return [pattern,pattern];});
  const result = await db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime
    FROM engineering_notes WHERE ${predicates.join(' AND ')} LIMIT 500`).bind(...params).all();
  return result.results;
}
export async function backlinks(db, id) {
  const target=await db.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes WHERE id=?').bind(id).first();
  if (!target) return null;
  const patterns=backlinkPatterns(target);
  const [catalog,candidates]=await Promise.all([
    db.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime FROM engineering_notes').all(),
    db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes
      WHERE id <> ? AND (${patterns.map(()=>"lower(content) LIKE ? ESCAPE '\\'").join(' OR ')})`).bind(id,...patterns).all(),
  ]);
  return referencingNotes(candidates.results,target,catalog.results);
}

export async function refresh(db, force, fetchDrive = drive) {
  const now = Date.now();
  await db.prepare("INSERT OR IGNORE INTO engineering_sync (key,value,updated_at) VALUES ('lock','0',0)").run();
  const lock = await db.prepare("UPDATE engineering_sync SET value=?,updated_at=? WHERE key='lock' AND CAST(value AS INTEGER) < ?")
    .bind(String(now),now,now-300000).run();
  if (!lock.meta.changes) return {...await status(db),changed:0,busy:true};
  try {
    const saved = await db.prepare("SELECT value FROM engineering_sync WHERE key='job'").first();
    let job = saved ? JSON.parse(saved.value) : null;
    if (!job) {
      const current = await status(db);
      let settingsChanged = false;
      if (force && now-current.lastSync<30000) {
        const settings = await fetchDrive('engineeringRecords.settings.get');
        settingsChanged = JSON.stringify(settings.includedFolders || []) !== JSON.stringify(current.includedFolders);
      }
      if (!settingsChanged && current.lastSync && now-current.lastSync<(force?30000:600000)) {
        return {...current,changed:0,skipped:true};
      }
      const catalog = await fetchDrive('engineeringRecords.catalog');
      if (!Array.isArray(catalog.records) || !Array.isArray(catalog.includedFolders)) throw new Error('Drive 目錄格式不正確。');
      const entries = catalog.records;
      if (entries.some(e=>!ID.test(e.id) || typeof e.name!=='string' || typeof e.relativePath!=='string' || !Number.isFinite(Date.parse(e.modifiedTime))) || new Set(entries.map(e=>e.id)).size!==entries.length) {
        throw new Error('Drive 目錄資料不完整，已保留原資料。');
      }
      const existing = await db.prepare('SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime FROM engineering_notes').all();
      const known = new Map(existing.results.map(e=>[e.id,e]));
      const pending = entries.filter(e=>{const old=known.get(e.id);return !old || old.modifiedTime!==e.modifiedTime || old.name!==e.name || old.relativePath!==e.relativePath;});
      const ids = new Set(entries.map(e=>e.id));
      job = {pending,removed:existing.results.filter(e=>!ids.has(e.id)).map(e=>e.id),folders:catalog.includedFolders,changed:pending.length};
      await db.prepare(SAVE).bind('job',JSON.stringify(job),now).run();
    }
    // At most two batches per invocation, including redirect hops within the Free plan limits.
    for (let batch=0;batch<2 && job.pending.length;batch++) {
      const chunk = job.pending.slice(0,8);
      const result = await fetchDrive('engineeringRecords.batchRead',{ids:chunk.map(e=>e.id)});
      const notes = Array.isArray(result.records) ? result.records : [];
      const expected = new Set(chunk.map(e=>e.id));
      if (notes.length!==chunk.length || new Set(notes.map(e=>e.id)).size!==chunk.length || notes.some(e=>!expected.has(e.id) || typeof e.content!=='string' || typeof e.name!=='string' || typeof e.relativePath!=='string' || !Number.isFinite(Date.parse(e.modifiedTime)))) {
        // Rebuild the catalog on retry; a source may have disappeared while being read.
        await db.prepare("DELETE FROM engineering_sync WHERE key='job'").run();
        throw new Error('部分工程紀錄無法完整讀取，已保留原資料；請重新載入。');
      }
      const next = {...job,pending:job.pending.slice(chunk.length)};
      await db.batch([...notes.map(e=>db.prepare(UPSERT).bind(e.id,e.name,e.relativePath,e.modifiedTime,e.content)),
        db.prepare(SAVE).bind('job',JSON.stringify(next),Date.now())]);
      job = next;
    }
    if (job.pending.length) return {...await status(db),changed:job.changed,removed:0,syncing:true,remaining:job.pending.length};
    // Deletions and sync metadata commit only after all required full texts are present.
    await db.batch([...job.removed.map(id=>db.prepare('DELETE FROM engineering_notes WHERE id=?').bind(id)),
      db.prepare(SAVE).bind('folders',JSON.stringify(job.folders),Date.now()),
      db.prepare(SAVE).bind('last_sync','ok',Date.now()),
      db.prepare("DELETE FROM engineering_sync WHERE key='job'")]);
    return {...await status(db),changed:job.changed,removed:job.removed.length};
  } finally {
    await db.prepare("UPDATE engineering_sync SET value='0',updated_at=0 WHERE key='lock' AND value=?").bind(String(now)).run();
  }
}
async function proxy(payload) {
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
  return [await drive(payload.action,Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='action'))),200];
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
        const [body,code]=await proxy(await request.json());return reply(body,code);
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
