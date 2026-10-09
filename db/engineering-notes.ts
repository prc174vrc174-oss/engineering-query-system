import { env } from "cloudflare:workers";
import { backlinkPatterns, referencingNotes } from "../cloudflare/engineering-record-links.mjs";

type Note = { id: string; name: string; relativePath: string; modifiedTime: string; content: string };
type Meta = { id: string; modifiedTime: string };

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec";

function database(): D1Database {
  if (!env.DB) throw new Error("D1 資料庫尚未啟用。");
  return env.DB;
}

function upsert(db: D1Database, note: Note) {
  return db.prepare(`INSERT INTO engineering_notes (id, name, relative_path, modified_time, content)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name, relative_path=excluded.relative_path,
    modified_time=excluded.modified_time, content=excluded.content`)
    .bind(note.id, note.name, note.relativePath, note.modifiedTime, note.content);
}

async function batches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 20) await db.batch(statements.slice(i, i + 20));
}

export async function engineeringStatus() {
  const db = database();
  const [count, settings] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM engineering_notes").first<{ total: number }>(),
    db.prepare("SELECT key, value, updated_at FROM engineering_sync WHERE key IN ('folders', 'last_sync')")
      .all<{ key: string; value: string; updated_at: number }>(),
  ]);
  const values = Object.fromEntries(settings.results.map((row) => [row.key, row]));
  return { total: count?.total || 0, includedFolders: JSON.parse(values.folders?.value || "[]") as string[],
    lastSync: values.last_sync?.updated_at || 0 };
}

export async function listEngineeringD1(offset: number) {
  const db = database();
  const [rows, count] = await Promise.all([
    db.prepare(`SELECT id, name, relative_path AS relativePath, modified_time AS modifiedTime
      FROM engineering_notes
      ORDER BY CASE WHEN name GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        AND substr(name, 11, 1) NOT GLOB '[0-9]' THEN substr(name, 1, 10) ELSE '' END DESC,
        name COLLATE NOCASE DESC, id DESC LIMIT 15 OFFSET ?`).bind(offset)
      .all<{ id: string; name: string; relativePath: string; modifiedTime: string }>(),
    db.prepare("SELECT COUNT(*) AS total FROM engineering_notes").first<{ total: number }>(),
  ]);
  const total = count?.total || 0;
  const nextOffset = offset + rows.results.length;
  return { results: rows.results, total, nextOffset, hasMore: nextOffset < total };
}

export async function searchEngineeringD1(query: string) {
  const terms = query.split(/[\s，。；、？！?：:（）()／/]+/).map((s) => s.trim().toLowerCase())
    .filter((s) => s && (s.length >= 2 || /^\d+$/.test(s))).slice(0, 6);
  if (!terms.length) terms.push(query.toLowerCase());
  // Literal substring matching avoids D1 LIKE limits on long Chinese filenames.
  const predicates = terms.map(() => "(instr(lower(name), ?) > 0 OR instr(lower(content), ?) > 0)");
  const params = terms.flatMap((term) => [term, term]);
  const rows = await database().prepare(`SELECT id, name, relative_path AS relativePath, modified_time AS modifiedTime
    FROM engineering_notes WHERE ${predicates.join(" AND ")} LIMIT 500`).bind(...params)
    .all<{ id: string; name: string; relativePath: string; modifiedTime: string }>();
  return rows.results;
}

export async function readEngineeringD1(id: string) {
  return database().prepare(`SELECT id, name, relative_path AS relativePath, modified_time AS modifiedTime, content
    FROM engineering_notes WHERE id = ?`).bind(id).first<Note>();
}

export async function engineeringBacklinks(id: string) {
  const db = database();
  const target = await readEngineeringD1(id);
  if (!target) return null;
  const patterns = backlinkPatterns(target);
  const [catalog, candidates] = await Promise.all([
    db.prepare("SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime FROM engineering_notes").all<Note>(),
    db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes
      WHERE id <> ? AND (${patterns.map(() => "lower(content) LIKE ? ESCAPE '\\'").join(" OR ")})`)
      .bind(id, ...patterns).all<Note>(),
  ]);
  return referencingNotes(candidates.results, target, catalog.results);
}

async function drive(action: string, extra: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(WEB_APP_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ action, ...extra }), cache: "no-store", redirect: "follow", signal: controller.signal });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || !result.ok) throw new Error(String(result.error || "Google Drive 同步失敗。"));
    return result;
  } finally { clearTimeout(timeout); }
}

export async function refreshEngineeringD1(force: boolean) {
  const db = database();
  const now = Date.now();
  const last = await db.prepare("SELECT updated_at FROM engineering_sync WHERE key = 'last_sync'")
    .first<{ updated_at: number }>();
  // A newly saved folder selection must sync even during the reload cooldown.
  let foldersChanged = false;
  if (force && last && now - last.updated_at < 30_000) {
    const settings = await drive("engineeringRecords.settings.get");
    const current = await engineeringStatus();
    foldersChanged = JSON.stringify(settings.includedFolders || []) !== JSON.stringify(current.includedFolders);
  }
  if (!foldersChanged && last && now - last.updated_at < (force ? 30_000 : 10 * 60_000)) {
    return { ...(await engineeringStatus()), changed: 0, skipped: true };
  }
  await db.prepare("INSERT OR IGNORE INTO engineering_sync (key, value, updated_at) VALUES ('lock', '0', 0)").run();
  const lock = await db.prepare("UPDATE engineering_sync SET value = ?, updated_at = ? WHERE key = 'lock' AND CAST(value AS INTEGER) < ?")
    .bind(String(now), now, now - 120_000).run();
  if (!lock.meta.changes) return { ...(await engineeringStatus()), changed: 0, busy: true };
  try {
    const catalog = await drive("engineeringRecords.catalog");
    const entries = (Array.isArray(catalog.records) ? catalog.records : []) as Meta[];
    const existing = await db.prepare("SELECT id, modified_time AS modifiedTime FROM engineering_notes")
      .all<Meta>();
    const known = new Map(existing.results.map((row) => [row.id, row.modifiedTime]));
    const changed = entries.filter((entry) => known.get(entry.id) !== entry.modifiedTime);
    const updated: Note[] = [];
    for (let i = 0; i < changed.length; i += 8) {
      const chunk = changed.slice(i, i + 8);
      const result = await drive("engineeringRecords.batchRead", { ids: chunk.map((entry) => entry.id) });
      updated.push(...((Array.isArray(result.records) ? result.records : []) as Note[]));
    }
    if (updated.length !== changed.length) throw new Error("有工程紀錄無法讀取，請再試一次。");
    const ids = new Set(entries.map((entry) => entry.id));
    const removed = existing.results.filter((row) => !ids.has(row.id));
    await batches(db, [
      ...updated.map((note) => upsert(db, note)),
      ...removed.map((note) => db.prepare("DELETE FROM engineering_notes WHERE id = ?").bind(note.id)),
    ]);
    await db.batch([
      db.prepare("INSERT INTO engineering_sync (key, value, updated_at) VALUES ('folders', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(JSON.stringify(catalog.includedFolders || []), Date.now()),
      db.prepare("INSERT INTO engineering_sync (key, value, updated_at) VALUES ('last_sync', 'ok', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(Date.now()),
    ]);
    return { ...(await engineeringStatus()), changed: updated.length, removed: removed.length };
  } finally {
    await db.prepare("UPDATE engineering_sync SET value = '0', updated_at = 0 WHERE key = 'lock' AND value = ?")
      .bind(String(now)).run();
  }
}
