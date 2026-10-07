const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec";

const ALLOWED_ORIGINS = new Set([
  "https://engineering-query.prc174.chatgpt.site",
  "https://prc174vrc174-oss.github.io",
]);

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const headers: Record<string, string> = {
    "Cache-Control": "no-store, max-age=0",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function json(request: Request, body: object, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(request, { ok: false, error: "資料格式不正確。" }, 400);
  }
  const action = typeof payload.action === "string" ? payload.action : "";
  const allowed = new Set([
    "engineeringRecords.folders",
    "engineeringRecords.settings.get",
    "engineeringRecords.settings.save",
    "engineeringRecords.image",
    "engineeringRecords.summarize",
  ]);
  if (!allowed.has(action)) {
    return json(request, { ok: false, error: "不支援的工程紀錄操作。" }, 400);
  }
  if (action === "engineeringRecords.settings.save") {
    if (typeof payload.idToken !== "string" || !payload.idToken) {
      return json(request, { ok: false, error: "請先使用允許的 Google 帳號登入。" }, 401);
    }
    const folders = payload.includedFolders ?? [];
    if (!Array.isArray(folders) || folders.length > 30 || folders.some((folder) => typeof folder !== "string" || folder.length > 120)) {
      return json(request, { ok: false, error: "搜尋資料夾設定不正確。" }, 400);
    }
    payload.includedFolders = folders;
  }
  if (action === "engineeringRecords.image" && (typeof payload.id !== "string" || typeof payload.name !== "string")) {
    return json(request, { ok: false, error: "圖片參照不正確。" }, 400);
  }
  if (action === "engineeringRecords.summarize") {
    if (typeof payload.idToken !== "string" || !payload.idToken) {
      return json(request, { ok: false, error: "使用 AI 摘要前請先登入 Google 帳號。" }, 401);
    }
    if (!Array.isArray(payload.ids) || !payload.ids.length) {
      return json(request, { ok: false, error: "目前沒有可摘要的搜尋結果。" }, 400);
    }
    payload.ids = payload.ids.slice(0, 20);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), action === "engineeringRecords.summarize" ? 120_000 : 60_000);
  try {
    const upstream = await fetch(WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const text = (await upstream.text()).trim();
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("雲端程式回應格式不正確。");
    }
    if (!upstream.ok || !result.ok) {
      return json(request, result.ok ? result : { ok: false, error: result.error || "工程紀錄查詢失敗。" }, 502);
    }
    return json(request, result);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "查詢逾時，請縮小關鍵字範圍後重試。"
      : error instanceof Error ? error.message : "工程紀錄查詢失敗。";
    return json(request, { ok: false, error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
