# D1 全文摘要與切回 Drive

兩個網站各從自己的 `DB` 讀取勾選筆記全文，後端呼叫 Gemini Interactions API，維持 `gemini-3.5-flash-lite` 及共享的工程摘要政策。瀏覽器僅傳送查詢、紀錄 ID 與 Google ID token，不接受瀏覽器提供的筆記內容。

## 啟用

- GPT Sites：在正式站的後端環境設定新增秘密值 `GEMINI_API_KEY`。
- GitHub Pages：在 Cloudflare 帳號 janyu056 的 Worker `engineering-records-api` 新增秘密值 `GEMINI_API_KEY`，不是 GitHub Pages 的 JavaScript 或儲存庫檔案。
- 兩個後端使用相同的 Google OAuth client ID，核對 Google RSA 簽章、issuer、audience、有效期限、已驗證 email 及允許名單。
- GPT Sites 的允許名單取自 `ENGINEERING_SUMMARY_ALLOWED_EMAILS`，未另設定時沿用 `NAIL_UPLOAD_ALLOWED_EMAILS`。GitHub Worker 使用 `ENGINEERING_SUMMARY_ALLOWED_EMAILS`。
- 變更 GPT Sites 正式環境值後須重新部署已儲存的版本。Worker 的秘密值使用 Cloudflare 支援的部署流程套用。

沒有後端金鑰時，自動保留原來的 Apps Script／Drive 摘要流程；不聲稱已經使用 D1。設定金鑰後，自動啟用 D1 摘要。可明確設定 `ENGINEERING_SUMMARY_SOURCE=d1`；此模式缺少金鑰時回報設定錯誤，避免誤認已切換。

## 全文與同步

摘要使用最近十分鐘內完成同步的 D1。背景同步進行中、同步快照變動、已刪除的 ID、資料不完整或超過每批十萬字時，摘要回報原因並停止；不靜默截斷或漏送筆記。請按「重新載入」完成同步再搜尋及摘要。全文中原有圖片參照保持原樣，但目前摘要仍僅送 Markdown 文字，與原流程相同。

每批最多四十篇。引用補充只重送未引用筆記，並使用同一份 D1 快照；每個來源都保留 Drive ID、檔名及相對路徑。回應 `summaryInputSource=d1` 與 `snapshotTime` 供核對；來源篇數與引用計數仍由既有機制判定。

## 切回原流程

兩個後端設定 `ENGINEERING_SUMMARY_SOURCE=drive` 並套用部署，即恢復 Apps Script 在 Drive 讀取內文。不要刪除 D1 或變更搜尋方式。原始 Drive Markdown 與原 Apps Script 摘要端點保留，金鑰可保留在後端，以便再次切回 D1。

## 驗證範圍

自動測試涵蓋 Google 真實 RSA 簽章驗證、D1 全文與來源、未選取內容排除、引用補充、同步狀態及快照變動、長度限制、回應限制、原流程回退及兩個 API 的整合。上線後仍須使用實際後端金鑰及允許的 Google 登入測試 Gemini 摘要，程式測試不代表已完成真實模型速度或輸出品質比較。
