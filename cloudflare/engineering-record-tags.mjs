// Derived tag metadata stays beside the notes in each site's own D1.
const CREATE = `CREATE TABLE IF NOT EXISTS engineering_note_tags (
  note_id TEXT PRIMARY KEY, modified_time TEXT NOT NULL, tags_json TEXT NOT NULL)`;
const PARSER_VERSION = '2';
const CREATE_STATE = `CREATE TABLE IF NOT EXISTS engineering_tag_index_state (
  id INTEGER PRIMARY KEY CHECK(id=1), parser_version TEXT NOT NULL)`;
const UPSERT = `INSERT INTO engineering_note_tags (note_id,modified_time,tags_json)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.modifiedTime'),json_extract(value,'$.tags')
  FROM json_each(?) WHERE EXISTS (SELECT 1 FROM engineering_notes
    WHERE id=json_extract(value,'$.id') AND modified_time=json_extract(value,'$.modifiedTime'))
  ON CONFLICT(note_id) DO UPDATE SET modified_time=excluded.modified_time,tags_json=excluded.tags_json`;

export function normalizeRecordTag(value) {
  const tag=String(value || '').trim().replace(/^#/, '').normalize('NFKC');
  if (!tag || tag.length>240 || /[\p{Cc}\p{Cs}\uFFFD\s#.,;:!?()[\]{}<>"'`\\，。；：、？！]/u.test(tag) || tag.split('/').some(part=>!part) || /^\d+$/.test(tag)) return '';
  return tag;
}
export function parseRecordTagQuery(value) {
  const tags=[], seen=new Set();let invalidTag=false;
  const query=String(value || '').trim().replace(/(?:^|\s)#([^\s#]+)/g,(_,raw)=>{
    const tag=normalizeRecordTag(raw),key=tag.toLowerCase();
    if(!tag)invalidTag=true;
    else if(!seen.has(key)){seen.add(key);tags.push(tag);}
    return ' ';
  }).replace(/\s+/g,' ').trim();
  if(tags.length>12)invalidTag=true;
  return {query,tag:tags[0]||'',tags,invalidTag};
}

export function extractRecordTags(content) {
  const source=String(content || '');
  // Binary files decoded as Markdown can contain random '#...' byte sequences.
  // Leave the original note untouched, but do not index tags from that content.
  const controls=(source.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g)||[]).length;
  const replacements=(source.match(/\uFFFD/g)||[]).length;
  if (controls>=4 || (replacements>=8 && replacements/source.length>0.02)) return [];
  const tags=new Set();
  const add=value=>{const tag=normalizeRecordTag(value);if(tag)tags.add(tag);};
  let text=source.replace(/\r/g,''), fence='';
  const front=/^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (front) {
    let inTags=false;
    for (const line of front[1].split('\n')) {
      const field=/^tags\s*:\s*(.*)$/i.exec(line);
      if (field) {
        inTags=true;
        field[1].replace(/^\[|\]$/g,'').split(',').forEach(value=>add(value.trim().replace(/^["']|["']$/g,'')));
      } else if (inTags && /^\s*-\s+/.test(line)) add(line.replace(/^\s*-\s+/,'').trim().replace(/^["']|["']$/g,''));
      else if (/^\S/.test(line)) inTags=false;
    }
    text=text.slice(front[0].length);
  }
  text=text.replace(/<!--[\s\S]*?-->/g,'').split('\n').map(line=>{
    const marker=/^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence=marker[1];
      else if (marker[1][0]===fence[0] && marker[1].length>=fence.length && !marker[2].trim()) fence='';
      return '';
    }
    return fence?'':line.replace(/(`+)[\s\S]*?\1/g,'');
  }).join('\n');
  for (const match of text.matchAll(/(?:^|[\s([（])#(?!#)([^\s#.,;:!?()[\]{}<>"'`\\，。；：、？！]+)/gu)) add(match[1]);
  return [...tags].sort((a,b)=>a.localeCompare(b,'zh-TW',{numeric:true}));
}

export async function ensureRecordTagTable(db) { await db.prepare(CREATE).run(); }
export function recordTagWrite(db, notes) {
  return db.prepare(UPSERT).bind(JSON.stringify(notes.map(note=>({id:note.id,modifiedTime:note.modifiedTime,tags:extractRecordTags(note.content)}))));
}
export async function ensureRecordTagIndex(db) {
  await ensureRecordTagTable(db);
  await db.prepare(CREATE_STATE).run();
  const state=await db.prepare('SELECT parser_version FROM engineering_tag_index_state WHERE id=1').first();
  const rebuild=state?.parser_version!==PARSER_VERSION;
  const stale=await db.prepare(`SELECT n.id,n.modified_time AS modifiedTime,n.content FROM engineering_notes n
    LEFT JOIN engineering_note_tags t ON t.note_id=n.id WHERE ${rebuild?'1=1':'t.note_id IS NULL OR t.modified_time<>n.modified_time'}`).all();
  // Chunk JSON parameters rather than one statement or binding per tag.
  for (let start=0;start<stale.results.length;start+=100) {
    const notes=stale.results.slice(start,start+100);
    await db.batch([recordTagWrite(db,notes)]);
  }
  await db.prepare('DELETE FROM engineering_note_tags WHERE note_id NOT IN (SELECT id FROM engineering_notes)').run();
  // Record the parser version only after every chunk succeeds. Existing caches
  // are rebuilt even when Drive modified_time has not changed.
  if(rebuild)await db.prepare(`INSERT INTO engineering_tag_index_state(id,parser_version) VALUES(1,?)
    ON CONFLICT(id) DO UPDATE SET parser_version=excluded.parser_version`).bind(PARSER_VERSION).run();
}
export const RECORD_TAG_PREDICATE = `id IN (SELECT note_id FROM engineering_note_tags, json_each(tags_json)
  WHERE value = ? COLLATE NOCASE OR substr(value,1,length(?) + 1) = ? || '/' COLLATE NOCASE)`;

export async function engineeringRecordTags(db) {
  await ensureRecordTagIndex(db);
  const rows=await db.prepare('SELECT tags_json FROM engineering_note_tags').all();
  const counts=new Map();
  for (const row of rows.results) {
    const paths=new Set();
    for (const tag of JSON.parse(row.tags_json)) {
      const parts=tag.split('/');
      for(let depth=1;depth<=parts.length;depth++)paths.add(parts.slice(0,depth).join('/'));
    }
    for(const path of paths)counts.set(path,(counts.get(path)||0)+1);
  }
  return [...counts].map(([path,count])=>({path,count})).sort((a,b)=>a.path.localeCompare(b.path,'zh-TW',{numeric:true}));
}
