import { status as recordStatus, refresh as refreshRecords } from "../cloudflare/engineering-record-sync.mjs";
import { env } from "cloudflare:workers";
import { backlinkNeedles, referencingNotes } from "../cloudflare/engineering-record-links.mjs";

type Note = { id: string; name: string; relativePath: string; modifiedTime: string; content: string };

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec";

function database(): D1Database {
  if (!env.DB) throw new Error("D1 資料庫尚未啟用。");
  return env.DB;
}

export async function engineeringStatus() { return recordStatus(database()); }

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
  const needles = backlinkNeedles(target);
  const [catalog, candidates] = await Promise.all([
    db.prepare("SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime FROM engineering_notes").all<Note>(),
    db.prepare(`SELECT id,name,relative_path AS relativePath,modified_time AS modifiedTime,content FROM engineering_notes
      WHERE id <> ? AND (${needles.map(() => "instr(lower(content), ?) > 0").join(" OR ")})`)
      .bind(id, ...needles).all<Note>(),
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

export async function refreshEngineeringD1(force: boolean) { return refreshRecords(database(), force, drive); }
