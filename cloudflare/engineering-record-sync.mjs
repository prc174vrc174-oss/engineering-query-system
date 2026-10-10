// Shared bounded Drive-to-D1 synchronization for both deployments.
const ID = /^[\w-]{10,100}$/;
const UPSERT = `INSERT INTO engineering_notes (id,name,relative_path,modified_time,content)
 VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
 relative_path=excluded.relative_path,modified_time=excluded.modified_time,content=excluded.content`;
const SAVE = `INSERT INTO engineering_sync (key,value,updated_at) VALUES (?,?,?)
 ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`;
export async function status(db) {
  const count = await db.prepare('SELECT COUNT(*) AS total FROM engineering_notes').first();
  const rows = await db.prepare("SELECT key,value,updated_at FROM engineering_sync WHERE key IN ('folders','last_sync','job')").all();
  const values = Object.fromEntries(rows.results.map(row => [row.key,row]));
  const job = values.job ? JSON.parse(values.job.value) : null;
  return {total:count.total, includedFolders:JSON.parse(values.folders?.value || '[]'),lastSync:values.last_sync?.updated_at || 0,
    ...(job ? {syncing:true,remaining:job.pending.length} : {})};
}
export async function refresh(db, force, fetchDrive) {
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
