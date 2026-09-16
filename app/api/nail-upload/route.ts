const SYNC_WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbw2WWjD9NKQKYNYLnVtU0E7xLKe69ELXw1FeIeEMUaFGY0zintiPAhwsnCC_figFrEScQ/exec";
const SPREADSHEET_ID = "1uUZgtiScqYtEqcDF8JjvROHwBkjlZ2IniGLhFUwMp-4";
const TARGET_SHEET = "釘子自動彙總";
const MAX_BODY_LENGTH = 12 * 1024 * 1024;
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
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function noStoreJson(request: Request, body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders(request),
  });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  return noStoreJson(request, { ok: true, authentication: "google" });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_LENGTH) {
    return noStoreJson(request, { ok: false, error: "上傳資料過大。" }, 413);
  }

  let payload: { idToken?: unknown; spreadsheetId?: unknown; worksheet?: unknown; tsv?: unknown };
  try {
    const body = await request.text();
    if (body.length > MAX_BODY_LENGTH) {
      return noStoreJson(request, { ok: false, error: "上傳資料過大。" }, 413);
    }
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return noStoreJson(request, { ok: false, error: "上傳資料格式不正確。" }, 400);
  }

  if (
    typeof payload.idToken !== "string" ||
    !payload.idToken ||
    payload.spreadsheetId !== SPREADSHEET_ID ||
    payload.worksheet !== TARGET_SHEET ||
    typeof payload.tsv !== "string"
  ) {
    return noStoreJson(request, { ok: false, error: "Excel 工作表資料不正確。" }, 400);
  }
  if (!payload.tsv.startsWith("工作表\t品號\t區域\t規格\t")) {
    return noStoreJson(request, { ok: false, error: "Excel 欄位標題不符合規定。" }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280_000);

  try {
    const upstream = await fetch(SYNC_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        idToken: payload.idToken,
        spreadsheetId: SPREADSHEET_ID,
        worksheet: TARGET_SHEET,
        tsv: payload.tsv,
      }),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    const responseText = await upstream.text();
    let result: { ok?: boolean; error?: string; rows?: number; columns?: number };
    try {
      result = JSON.parse(responseText) as typeof result;
    } catch {
      throw new Error("雲端程式回應格式不正確。");
    }

    if (!upstream.ok || !result.ok) {
      return noStoreJson(
        request,
        { ok: false, error: result.error || "Google Sheet 更新失敗。" },
        502,
      );
    }

    return noStoreJson(request, {
      ok: true,
      rows: result.rows,
      columns: result.columns,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "更新逾時，請稍後確認 Google Sheet 狀態。"
        : error instanceof Error
          ? error.message
          : "Google Sheet 更新失敗。";
    return noStoreJson(request, { ok: false, error: message }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
