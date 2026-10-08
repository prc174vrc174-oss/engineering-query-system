# GitHub Pages 工程紀錄獨立後端

GitHub Pages 的工程紀錄使用 `https://engineering-records-api.janyu056.workers.dev`，
直接透過既有 Apps Script 同步 Google Drive。GPT Sites 的 D1 與釘子表介面保持原有連線。

- Cloudflare 使用者：`janyu056@gmail.com`
- 帳號：`e7afb53fac3928d5e1bb02c4474792aa`
- Worker：`engineering-records-api`
- D1：`engineering-records-github`
- D1 UUID：`a8ff1ec0-5ac7-415d-b9e8-53a925182d9a`
- D1 binding：`DB`

## API

`GET /api/engineering-records-d1?action=status` 回傳筆數、共用資料夾與最後同步時間。
`action=search&query=...` 搜尋檔名與全文；`action=read&id=...` 讀取全文。
`POST /api/engineering-records-d1` 接受 `{"action":"refresh","force":true}`。

第一次開啟頁籤時自動比對 Drive（十分鐘內重複開啟略過），「重新載入」強制比對（三十秒冷卻）。
初次匯入或大量修改每次最多讀取兩批、每批八篇；回傳 `syncing` 與 `remaining` 時，前端持續呼叫至完成。
進度存放 D1，可從另一台電腦或重新整理後續傳。同一時間只允許一個同步請求寫入。
新增、修改、改名、搬移都會更新；所有必要全文讀取成功後才移除已刪除或不在選定資料夾內的紀錄。
這是開啟頁籤／按鈕觸發同步，未設定定時背景同步。

`POST /api/engineering-records-drive` 保留資料夾列表、共用設定、圖片預覽與 Gemini 摘要。
修改共用資料夾、Gemini 摘要仍由 Apps Script 驗證 Google 帳號，API Key 保留在 Apps Script。
資料夾選擇仍是兩個網站共用；各自的 D1 在下一次同步時套用。
CORS 僅允許 `https://prc174vrc174-oss.github.io`，查詢內容沿用既有公開授權。

## 維護

在本目錄執行 `npx wrangler deploy` 更新 Worker，使用 `wrangler.json` 指定的帳號與 D1。
首次建表使用 `npx wrangler d1 execute engineering-records-github --remote --file=schema.sql`。
不需在 GitHub Pages 儲存 Cloudflare Token 或 Gemini API Key。

`node --test cloudflare/worker.test.mjs` 驗證同步與 API。
`node cloudflare/prepare-github-assets.mjs` 將從 GPT Sites 下載的工程紀錄資產套用 GitHub 專用連線與分批同步。
GitHub 資產同步工作流程會自動執行這個步驟；若上游程式結構變更，會停止並要求檢查，避免默默切回 GPT Sites。
