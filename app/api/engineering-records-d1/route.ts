import { engineeringStatus, readEngineeringD1, refreshEngineeringD1, searchEngineeringD1 } from "../../../db/engineering-notes";

const origins = new Set(["https://engineering-query.prc174.chatgpt.site", "https://prc174vrc174-oss.github.io"]);
function headers(request: Request) {
  const origin = request.headers.get("origin") || "";
  return { "Cache-Control": "no-store", Vary: "Origin", ...(origins.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type" } : {}) };
}
function reply(request: Request, body: object, status = 200) {
  return Response.json(body, { status, headers: headers(request) });
}
function failure(request: Request, error: unknown) {
  console.error("Engineering D1 error", error);
  return reply(request, { ok: false, error: error instanceof Error ? error.message : "資料庫暫時無法使用。" }, 503);
}
export async function OPTIONS(request: Request) { return new Response(null, { status: 204, headers: headers(request) }); }
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("action") === "status") return reply(request, { ok: true, ...(await engineeringStatus()) });
    if (params.get("action") === "search") {
      const query = (params.get("query") || "").trim();
      if (!query || query.length > 120) return reply(request, { ok: false, error: "請輸入 1～120 個字元。" }, 400);
      return reply(request, { ok: true, results: await searchEngineeringD1(query) });
    }
    if (params.get("action") === "read") {
      const id = params.get("id") || "";
      if (!/^[\w-]{10,100}$/.test(id)) return reply(request, { ok: false, error: "檔案編號不正確。" }, 400);
      const record = await readEngineeringD1(id);
      return record ? reply(request, { ok: true, record }) : reply(request, { ok: false, error: "找不到工程紀錄。" }, 404);
    }
    return reply(request, { ok: false, error: "不支援的操作。" }, 400);
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    const payload = await request.json() as { action?: string; force?: boolean };
    if (payload.action !== "refresh") return reply(request, { ok: false, error: "不支援的操作。" }, 400);
    return reply(request, { ok: true, ...(await refreshEngineeringD1(payload.force === true)) });
  } catch (error) { return failure(request, error); }
}
