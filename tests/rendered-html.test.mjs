import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("engineering record folder selections match root-relative subtrees", async () => {
  const source = await readFile(new URL("../apps-script/engineering-records.gs", import.meta.url), "utf8");
  const context = {};
  runInNewContext(source, context);
  const rules = context.engineeringRecordsIncludedFolders_(["01.每日筆記", "02.主題筆記/舊資料"]);
  assert.equal(context.engineeringRecordsPathIncluded_("01.每日筆記/2026/記錄.md", rules), true);
  assert.equal(context.engineeringRecordsPathIncluded_("02.主題筆記/舊資料/子目錄/記錄.md", rules), true);
  assert.equal(context.engineeringRecordsPathIncluded_("02.主題筆記/新資料/記錄.md", rules), false);
  assert.equal(context.engineeringRecordsPathIncluded_("02.主題筆記/記錄.md", rules), false);
  assert.equal(context.engineeringRecordsPathIncluded_("01.每日筆記外/記錄.md", rules), false);
  assert.equal(context.engineeringRecordsPathIncluded_("任何資料夾/記錄.md", []), true);
});

test("engineering record folder picker lists root-relative nested folders", async () => {
  const source = await readFile(new URL("../apps-script/engineering-records.gs", import.meta.url), "utf8");
  const leaf = { getId: () => "leaf", getName: () => "2026", isTrashed: () => false, getFolders: () => iterator([]) };
  const child = { getId: () => "child", getName: () => "01.每日筆記", isTrashed: () => false, getFolders: () => iterator([leaf]) };
  const root = { getFolders: () => iterator([child]) };
  function iterator(items) {
    const values = [...items];
    return { hasNext: () => values.length > 0, next: () => values.shift() };
  }
  const context = { DriveApp: { getFolderById: () => root } };
  runInNewContext(source, context);
  assert.deepEqual(Array.from(context.engineeringRecordsFolders_().folders), ["01.每日筆記", "01.每日筆記/2026"]);
});

test("engineering record folder settings are shared through script properties", async () => {
  const source = await readFile(new URL("../apps-script/engineering-records.gs", import.meta.url), "utf8");
  const values = new Map();
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => values.get(key),
        setProperty: (key, value) => values.set(key, value),
      }),
    },
  };
  runInNewContext(source, context);
  assert.deepEqual(Array.from(context.engineeringRecordsSettings_().includedFolders), []);
  context.engineeringRecordsSaveSettings_(["01.每日筆記", "01.每日筆記"]);
  assert.deepEqual(Array.from(context.engineeringRecordsSettings_().includedFolders), ["01.每日筆記"]);
  assert.deepEqual(Array.from(context.engineeringRecordsIncludedFolders_(context.engineeringRecordsSettings_().includedFolders)), ["01.每日筆記"]);
});

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("developed calculator keeps three groups only for the current page session", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );
  const standalone = await readFile(
    new URL("../public/developed-calculator.html", import.meta.url),
    "utf8",
  );

  assert.match(source, />清除此組<\/button>/);
  assert.match(source, />清除全部<\/button>/);
  assert.match(source, /function clearDevelopedCalcGroup\(\)/);
  assert.match(source, /function clearAllDevelopedCalcGroups\(\)/);
  assert.match(source, /window\.open\('\/developed-calculator\.html\?/);
  assert.match(source, /engineeringDevelopedCalculator/);
  assert.match(standalone, /尺寸組 1／3/);
  assert.match(standalone, />清除此組<\/button>/);
  assert.match(standalone, />清除全部<\/button>/);
  assert.match(standalone, /data-reverse-toggle/);
  assert.match(standalone, /function toggleReverse\(button\)/);
  assert.doesNotMatch(standalone, />一般<\/button>/);
  assert.match(standalone, /const reverseCount=valid\.filter\(entry=>entry\.type==='reverse'\)\.length/);
  assert.match(standalone, /if\(reverseCount>foldCount\)\{note\.textContent='反折數不可超過總折數'/);
  assert.match(standalone, /<h1>BD扣除展開計算<\/h1>/);
  assert.match(standalone, /\.calculator\{width:min\(405px,100%\)/);
  assert.match(standalone, /\.bend-type-cell\{width:27\.2%/);
  assert.doesNotMatch(source, /engineering-developed-size-groups-v1/);
  assert.doesNotMatch(standalone, /engineering-developed-size-groups-v1/);
});

test("developed calculator recalculates independently and preserves only compatible thicknesses", async () => {
  const standalone = await readFile(
    new URL("../public/developed-calculator.html", import.meta.url),
    "utf8",
  );
  const coefficientSource = await readFile(
    new URL("../public/engineering-coefficients.js", import.meta.url),
    "utf8",
  );
  const sandbox = { window: {} };
  runInNewContext(coefficientSource, sandbox);
  const coefficients = sandbox.window.EngineeringCoefficients;

  assert.match(standalone, /<script src="\/engineering-coefficients\.js"><\/script>/);
  assert.match(standalone, /function updateLocalCoefficients\(/);
  assert.equal(coefficients.hasThickness("AL", "1"), true);
  assert.equal(coefficients.hasThickness("SGCC", "6"), false);
  assert.deepEqual(
    { ...coefficients.lookup("SGCC", "1") },
    { rate: 0.4, m: 0.4, bd: 1.6, f: 0.4, kf: 0.5 },
  );
});

test("nail results can switch between cards and the filtered report table", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /class="nail-result-tabs"[^>]*role="tablist"/);
  assert.match(source, /id="nailCardViewBtn"[^>]*role="tab"[^>]*aria-selected="true"[\s\S]*?卡片檢視[\s\S]*?<\/button>/);
  assert.match(source, /id="nailReportViewBtn"[^>]*role="tab"[^>]*aria-selected="false"[\s\S]*?列表檢視[\s\S]*?<\/button>/);
  assert.match(source, /function renderCurrentView\(rows\)/);
  assert.match(source, /currentView === 'report'\) renderReport\(rows\)/);
  assert.match(source, /function renderReport\(rows\)/);
  assert.match(source, /label: '種類', index: idxType[\s\S]*?label: '品號'[\s\S]*?label: '規格'[\s\S]*?label: '庫存', index: idxQty[\s\S]*?label: '區域', index: idxArea[\s\S]*?label: '廠商', index: findCol\(\/\^廠商\$\/\)/);
  assert.match(source, /function getReportColumns\(rows\)/);
  assert.doesNotMatch(source, /function getReportColumns\(rows\)[\s\S]*?label: '廠商圖號料號'[\s\S]*?function reportTableHtml/);
  assert.match(source, /if \(!rows\.length\) return columns/);
  assert.match(source, /return rows\.some\(function \(row\)[\s\S]*?String\(row\[column\.index\] == null \? '' : row\[column\.index\]\)\.trim\(\) !== ''/);
  assert.match(source, /var reportColumns = getReportColumns\(rows\)/);
  assert.match(source, /function cycleSortColumn\(columnIndex\)[\s\S]*?sortState\.dir = -1[\s\S]*?sortState\.col = -1[\s\S]*?sortState\.dir = 1/);
  assert.match(source, /cycleSortColumn\(\+th\.getAttribute\('data-col'\)\)/);
  assert.match(source, /label: '庫存', index: idxQty/);
  assert.match(source, /renderCurrentView\(shown\)/);
  assert.match(source, /\.nail-report-wrap \{/);
  assert.match(source, /id="inStock"[\s\S]*?id="nailClearBtn"[\s\S]*?class="nail-result-tabs"[\s\S]*?id="nailCardViewBtn"[\s\S]*?id="nailReportViewBtn"[\s\S]*?id="tableWrap"/);
  assert.match(source, /id="nailReportFloatingScroll"[^>]*aria-label="列表欄位水平捲動"[^>]*hidden/);
  assert.match(source, /currentView !== 'report'[\s\S]*?reportFloatingScroll\.hidden = true/);
  assert.match(source, /nativeScrollbarVisible = rect\.bottom <= window\.innerHeight/);
  assert.match(source, /nativeScrollbarVisible \|\| right - left < 40/);
  assert.match(source, /reportFloatingScroll\.scrollLeft = activeReportWrap\.scrollLeft/);
  assert.match(source, /activeReportWrap\.scrollLeft = reportFloatingScroll\.scrollLeft/);
  assert.match(source, /function normalizeDiameterSymbol\(value\)[\s\S]*?replace\(\/\[øØ\]\/g, '∅'\)/);
  assert.match(source, /headers = cols\.map\(function \(i\) \{ return normalizeDiameterSymbol\(rawHeaders\[i\]\)\.trim\(\); \}\)/);
  assert.match(source, /return cols\.map\(function \(i\) \{ return normalizeDiameterSymbol\(r\[i\]\)\.trim\(\); \}\)/);
  assert.match(source, /var q = normalizeDiameterSymbol\(rawSearch\)\.toLowerCase\(\)/);
  assert.match(source, /var rawDiaSearch = realDiaSearchEl \? normalizeDiameterSymbol\(realDiaSearchEl\.value\)\.trim\(\) : ''/);
  assert.match(source, /實量∅徑/);
  assert.doesNotMatch(source, /nailPrintBtn|nailPrintArea|列印報表|window\.print\(\)/);
});

test("M calculator keeps coefficient compensation separate from angle and R changes", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const calculator = await readFile(new URL("../public/m-calculator.html", import.meta.url), "utf8");
  assert.match(source, /openMCalc/);
  assert.match(source, /window\.open\('\/m-calculator\.html\?/);
  assert.match(calculator, /<th scope="row">係數補償<\/th>/);
  assert.match(calculator, /placeholder="\+0\.1 \/ -0\.1"/);
  assert.match(calculator, /<strong>角度與R變化<\/strong>/);
  assert.match(calculator, /zeroTotal\+total\+comp/);
  assert.match(calculator, /total\+=val-m/);
  assert.match(calculator, /Version 195 測試/);
  assert.match(calculator, /zero:value-tc\*\(t\+radius\)/);
  assert.match(calculator, /compact2=new Intl\.NumberFormat\('zh-TW',\{maximumFractionDigits:2\}\)/);
  assert.match(calculator, /Number\.isFinite\(e\.zero\)\?compact2\.format\(e\.zero\):'－'/);
  assert.doesNotMatch(calculator, /Number\.isFinite\(e\.zero\)\?fixed2\.format\(e\.zero\):'－'/);
  assert.doesNotMatch(calculator, /maximumFractionDigits:3|compact3/);
  assert.match(calculator, /id="defaultRadius"[^>]*aria-label="整體預設內R"/);
  assert.match(calculator, /function defaultM\(v\)/);
  assert.match(calculator, /Math\.PI\*90\*\(radius\+t\*v\.kf\)\/180/);
  assert.match(source, /function mCalcContextPayload\(\)\{return\{mat:[^}]*radius:/);
  assert.match(calculator, /button\[aria-pressed="true"\]/);
  assert.match(calculator, /const active=String\(b\.dataset\.tCount\)===selected/);
  assert.match(calculator, /'calcRows'\)\.addEventListener\('click'/);
  assert.doesNotMatch(calculator, /aria-label="變化折次"/);
  assert.doesNotMatch(calculator, />折次<|>第\d+折</);
  assert.match(calculator, /group\(\)\.specials\.length>=folds/);
  assert.match(calculator, /<span>角度＝<\/span>/);
  assert.match(calculator, /<span>內R＝<\/span>/);
  assert.match(calculator, /<span>係數變化＝<\/span>/);
  assert.doesNotMatch(calculator, /aria-label="折R模式"/);
  assert.match(calculator, /aria-label="折彎內R"/);
  assert.match(calculator, /radius===0\)return v\.m\*a\/90/);
  assert.match(calculator, /special-row input::-webkit-outer-spin-button/);
  assert.match(calculator, />清除此變化<\/button>/);
  assert.doesNotMatch(calculator, /id="changeSummary"/);
  assert.doesNotMatch(calculator, /折預設為90°自然R，每折 M/);
  assert.match(calculator, /data-reverse-toggle[^>]*>反折<\/button>/);
  assert.match(calculator, /reverseFlags:Array\(MAX_ROWS\)\.fill\(false\)/);
  assert.match(calculator, /reverseM=Number\.isFinite\(t\)&&Number\.isFinite\(v\.f\)\?2\*t-v\.f:NaN/);
  assert.match(calculator, /reverseM\*reverseFolds/);
  assert.match(calculator, /id="reverseMMetric">反折M －<\/span>/);
  assert.match(calculator, /'reverseMMetric'\)\.textContent='反折M '/);
  assert.match(calculator, /反折數不可超過總折數/);
  assert.match(calculator, /全部以90°及上方內R計算|一般折以90°及上方內R計算/);
  assert.match(calculator, /function fitPopupToCalculator\(\)/);
  assert.match(calculator, /new ResizeObserver\(fitPopupToCalculator\)/);
  assert.match(source, /engineeringMCalculator','popup=yes,width=480,height=840/);
  assert.match(calculator, /\.calculator\{width:min\(430px,100%\)/);
  assert.match(source, /popupHeight=710/);
  assert.match(source, /engineering-developed-popup-size-v3/);
  assert.match(source, /let popupWidth=450,popupHeight=710/);
});

test("Version 195 test labels live in the requested header areas", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );
  const standalone = await readFile(
    new URL("../public/developed-calculator.html", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /<header class="app-header-tabs">[\s\S]*?<span class="site-version"[^>]*>Version 195 測試<\/span>[\s\S]*?<\/header>/,
  );
  assert.match(
    standalone,
    /<header class="head">[\s\S]*?<span class="site-version"[^>]*>Version 195 測試<\/span>[\s\S]*?<\/header>/,
  );
  assert.equal((source.match(/Version 195 測試/g) || []).length, 2);
  assert.equal((standalone.match(/Version 195 測試/g) || []).length, 2);
});

test("GitHub Pages build is installable and receives verified upload responses", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const upload = await readFile(new URL("../public/nail-excel-upload.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");
  const pagesWorkflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const uploadRoute = await readFile(new URL("../app/api/nail-upload/route.ts", import.meta.url), "utf8");

  assert.match(source, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(source, /serviceWorker\.register\('\.\/service-worker\.js'/);
  assert.equal(manifest.name, "查詢系統");
  assert.equal(manifest.short_name, "查詢系統");
  assert.match(source, /<title>查詢系統<\/title>/);
  assert.match(source, /<h1 class="header-tabs-title">🔧 查詢系統<\/h1>/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "192x192"), true);
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
  assert.match(serviceWorker, /engineering-query-pwa-v223/);
  assert.doesNotMatch(source, /nailUploadSwitchAccountBtn|更換登入帳號/);
  assert.doesNotMatch(source, /Gemini notebook|geminiNotebookLink|notebook\.google\.com\/notebook\/e8e53926/);
  assert.doesNotMatch(pagesWorkflow, /Gemini notebook|geminiNotebookLink|notebook\.google\.com\/notebook\/e8e53926/);
  assert.match(upload, /https:\/\/engineering-query\.prc174\.chatgpt\.site\/api\/nail-upload/);
  assert.match(upload, /mode: 'cors'/);
  assert.doesNotMatch(upload, /mode: 'no-cors'/);
  assert.match(uploadRoute, /Access-Control-Allow-Origin/);
  assert.match(uploadRoute, /export async function OPTIONS/);
  assert.match(source, /id="nailGoogleSignInButton"/);
  assert.match(upload, /accounts\.google\.com\/gsi\/client/);
  assert.match(upload, /googleIdToken/);
  assert.match(upload, /idToken: googleIdToken/);
  assert.doesNotMatch(source, /nailUploadDirectToken|Google Sheet 更新密鑰/);
  assert.doesNotMatch(upload, /engineeringSheetUpdateToken|directToken/);
  assert.doesNotMatch(source, /lanWebUpdateToken = '[a-f0-9]{32,}'/);
});

test("GitHub Pages reads sheet metadata directly with the configured timeout", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  assert.match(source, /fetch\(metadataWebAppUrl \+ '\?_=' \+ Date\.now\(\), \{[\s\S]*?mode: 'cors'/);
  assert.match(source, /setTimeout\(function \(\) \{ controller\.abort\(\); \}, 12000\)/);
  assert.match(source, /if \(!\/\\\.github\\\.io\$\/i\.test\(window\.location\.hostname\)\)/);
  assert.match(source, /tryDirectMetadata\(\)/);
  assert.match(source, /\}, 45000\);/);
});

test("nail data cache and active tab are restored before background refresh", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  assert.match(source, /function loadCachedData\(\)/);
  assert.match(source, /localStorage\.getItem\('nailSheetCachedHeaders'\)/);
  assert.match(source, /localStorage\.setItem\('nailSheetCachedRows', JSON\.stringify\(rawRows\)\)/);
  assert.match(source, /loadCachedData\(\);[\s\S]*?loadSheet\(initialUrl\);/);
  assert.match(source, /localStorage\.setItem\('engineeringActiveTab', target\)/);
  assert.match(source, /localStorage\.getItem\('engineeringActiveTab'\)/);
});

test("custom inner R values can be committed with Enter", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /function commitRadiusInput\(\)/);
  assert.match(source, /raw!==''&&\(!Number\.isFinite\(value\)\|\|value<0\)/);
  assert.match(source, /if\(radiusKeyboardNavigating\)chooseRadiusOption\(\);else commitRadiusInput\(\)/);
  assert.match(source, /radiusKeyboardNavigating=false;activateRadiusOption\(radiusIndexForValue\(\)\)/);
});

test("custom sheet X and Y values can be committed with Enter", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /const sheetKeyboardNavigating=\{sheetX:false,sheetY:false\}/);
  assert.match(source, /function commitSheetInput\(id\)/);
  assert.match(source, /raw===''\|\|!Number\.isFinite\(value\)\|\|value<=0/);
  assert.match(source, /if\(sheetKeyboardNavigating\[id\]\)chooseSheetOption\(id\);else commitSheetInput\(id\)/);
  assert.match(source, /sheetKeyboardNavigating\[id\]=false;activateSheetOption\(id,sheetIndexForValue\(id\)\)/);
});

test("shared common words keep public copying and require Google sign-in for management", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const client = await readFile(new URL("../public/common-words.js", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/common-words/route.ts", import.meta.url), "utf8");

  assert.match(source, /id="commonWordsManageBtn"/);
  assert.match(source, /id="commonWordsInput"[^>]*maxlength="40"/);
  assert.match(source, /<script src="common-words\.js"><\/script>/);
  assert.match(client, /commonWords\.add/);
  assert.match(client, /commonWords\.update/);
  assert.match(client, /commonWords\.delete/);
  assert.match(client, /accounts\.google\.com\/gsi\/client/);
  assert.match(client, /idToken: idToken/);
  assert.match(route, /JSON\.stringify\(\{ action: "commonWords\.list" \}\)/);
  assert.match(route, /Access-Control-Allow-Origin/);
  assert.match(route, /export async function OPTIONS/);
});

test("hole type and specification both use native selects", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /<select id="holeType"><\/select>/);
  assert.match(source, /<select id="holeSpec"><\/select>/);
  assert.doesNotMatch(source, /id="holeTypeMenu"/);
  assert.doesNotMatch(source, /id="holeSpecMenu"/);
  assert.match(source, /opt\(\$\('holeType'\),\[''\]\.concat\(D\.holeTypes\),''\)/);
  assert.match(source, /\$\('holeType'\)\.addEventListener\('change'/);
  assert.match(source, /\$\('holeSpec'\)\.addEventListener\('change',calcHole\)/);
  assert.match(source, /optSpec\(\$\('holeSpec'\),\[''\]\.concat\(availableHoleSpecs\(\)\),''\)/);
});

test("folding-tool tab embeds both supplied interactive coordinate pages", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );
  const pointed = await readFile(
    new URL("../public/fold-tool-pointed.html", import.meta.url),
    "utf8",
  );
  const curved117 = await readFile(
    new URL("../public/fold-tool-117.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /class="tab-btn active" data-sys="bend">係數查詢<\/button>/);
  assert.match(source, /class="tab-btn" data-sys="nail">釘子查詢<\/button>/);
  assert.match(source, /class="tab-btn other-pages-item" data-sys="nail-gallery"[^>]*>釘子圖<\/button>/);
  assert.match(source, /class="tab-btn other-pages-item" data-sys="fold-tool"[^>]*>座標圖<\/button>/);
  assert.match(source, /class="tab-btn" data-sys="die-setup">配模計算<\/button>/);
  assert.match(source, /id="fold-tool-panel"/);
  assert.match(source, /src="\.\/fold-tool-pointed\.html"/);
  assert.match(source, /src="\.\/fold-tool-117\.html"/);
  assert.match(source, /data-fold-tool-view="pointed">尖刀<\/button>/);
  assert.match(source, /data-fold-tool-view="curved117">彎刀 117<\/button>/);
  assert.match(source, /data-fold-tool-content="curved117"[^>]*hidden/);
  assert.match(source, /function selectFoldTool\(viewName\)/);
  assert.match(source, /localStorage\.setItem\('engineeringFoldToolView', viewName\)/);
  assert.doesNotMatch(source, /fold-tool-expand-btn|fold-tool-expanded|is-expanded/);
  assert.match(source, /id="angleReset90Btn"[^>]*>回到90度<\/button>/);
  assert.match(source, /\.angle-reset-control #angle,\s*\.r-reset-control #radius\s*{[\s\S]*?min-width:\s*0[\s\S]*?padding-right:\s*88px/);
  assert.match(source, /\.angle-reset-control #angle::\-webkit-inner-spin-button/);
  assert.match(source, /\.angle-reset-btn,\s*\.r-reset-btn\s*{[\s\S]*?position:\s*absolute[\s\S]*?right:\s*6px/);
  assert.match(source, /id="radiusResetR0Btn"[^>]*>回到R0<\/button>/);
  assert.match(source, /\$\('radiusResetR0Btn'\)\?\.addEventListener\('click',[\s\S]*?\$\('radius'\)\.value='';[\s\S]*?hideRadiusMenu\(\);calcAll\(\)/);
  assert.match(source, /\$\('angleReset90Btn'\)\?\.addEventListener\('click',[\s\S]*?\$\('angle'\)\.value='90';calcAll\(\)/);
  assert.match(source, /'fold-tool': document\.getElementById\('fold-tool-panel'\)/);
  assert.match(pointed, /<title>尖刀 座標互動定位<\/title>/);
  assert.match(pointed, /id="leftW"/);
  assert.match(pointed, /id="rightW"/);
  assert.match(curved117, /<title>彎刀_117 座標互動定位<\/title>/);
  assert.match(curved117, /id="leftW"/);
  assert.match(curved117, /id="rightW"/);
});

test("die setup calculator is integrated directly into the main page", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );
  const serviceWorker = await readFile(
    new URL("../public/service-worker.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /id="die-setup-panel"/);
  assert.match(source, /id="dieSetupTemplate"/);
  assert.match(source, /id="dieSetupCalculator"/);
  assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(source, /\.die-setup-component\{padding:0\}/);
  assert.match(source, /#fold-tool-panel,\s*#die-setup-panel,\s*#symbols-panel \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: hidden/);
  assert.match(source, /#fold-tool-panel \.fold-tool-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--notion-page-width\);[\s\S]*?min-width: 0/);
  assert.match(source, /#die-setup-panel \.die-setup-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--notion-page-width\);[\s\S]*?min-width: 0/);
  assert.doesNotMatch(source, /<iframe[^>]+die-setup-calculator/);
  assert.doesNotMatch(source, /src="\.\/die-setup-calculator\.html"/);
  assert.match(source, /'die-setup': document\.getElementById\('die-setup-panel'\)/);
  assert.match(source, /id="btn-downward"/);
  assert.match(source, /id="btn-upward"/);
  assert.match(source, /function recalculateAll\(trigger\)/);
  assert.match(source, /function compactNumber\(v\)/);
  assert.match(source, /String\(Number\(x\.toFixed\(2\)\)\)/);
  assert.match(source, /input\.addEventListener\('blur',[\s\S]*?this\.value=compactNumber\(this\.value\)/);
  assert.doesNotMatch(source, /\.value=[A-Z]\.toFixed\(2\)/);
  assert.match(source, /id="input-upper" value="2"/);
  assert.match(source, /id="input-lower" value="2"/);
  assert.match(source, /抽凸深度 = 沖子高度 − 上模高度/);
  assert.doesNotMatch(serviceWorker, /\.\/die-setup-calculator\.html/);
});

test("mobile navigation keeps system tabs on one horizontally scrollable row", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /@media \(max-width: 640px\) \{[\s\S]*?\.tabs-nav \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;[\s\S]*?scrollbar-width: none/);
  assert.match(source, /\.tabs-nav::\-webkit-scrollbar \{[\s\S]*?display: none/);
  assert.match(source, /@media \(max-width: 640px\) \{[\s\S]*?\.tab-btn \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap/);
  assert.match(source, /function revealActiveTab\(button\)[\s\S]*?nav\.scrollBy\(\{[\s\S]*?behavior: 'smooth'/);
  assert.match(source, /localStorage\.setItem\('engineeringActiveTab', target\);[\s\S]*?revealActiveTab\(btn\)/);
});

test("special symbols tab copies the Notion symbol collection", async () => {
  const source = await readFile(
    new URL("../public/engineering-query.html", import.meta.url),
    "utf8",
  );

  assert.match(source, /data-sys="symbols">字元符號<\/button>/);
  assert.doesNotMatch(source, /<header class="symbols-header">/);
  assert.doesNotMatch(source, />特殊符號<\/button>/);
  assert.match(source, /id="symbols-panel"/);
  assert.match(source, /\.symbols-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--notion-page-width\);[\s\S]*?min-width: 0/);
  assert.match(source, /symbols: document\.getElementById\('symbols-panel'\)/);
  assert.match(source, /symbolWords: \['晟展', '浤据', '靖紘', '㴫漛', '正翊信', '沅成', '荃倫', '鉸鍊'\]/);
  assert.match(source, /\.symbol-grid\.symbol-words \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: wrap/);
  assert.match(source, /\.symbol-words \.symbol-copy-btn \{[\s\S]*?width: auto;[\s\S]*?min-width: 68px;[\s\S]*?min-height: 38px;[\s\S]*?padding: 5px 12px/);
  assert.match(source, /symbolEngineering: \['∅', 'μ', '±', '≦', '≧'/);
  assert.doesNotMatch(source, /symbolEngineering: \[[^\]]*[→⇚⇛⇉][^\]]*\]/);
  assert.match(source, /symbolSolidNumbers: \['⓿'[\s\S]*?'❿'\]/);
  assert.match(source, /symbolKeycapNumbers: \['0️⃣'[\s\S]*?'🔟'\]/);
  assert.match(source, /symbolCircledNumbers: \['①'[\s\S]*?'⑩'\]/);
  assert.match(source, /id="symbolNumberSection"[\s\S]*?<h3>數字符號<\/h3>[\s\S]*?id="symbolSolidNumbers"[\s\S]*?id="symbolKeycapNumbers"[\s\S]*?id="symbolCircledNumbers"[\s\S]*?<\/section>/);
  assert.match(source, /\.symbol-number-group \{[\s\S]*?grid-template-columns: 116px minmax\(0, 1fr\)/);
  assert.match(source, /symbolEmoji: \[[\s\S]*?'🚩'[\s\S]*?'☎'/);
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(source, /fallbackCopySymbol\(value\)/);
  assert.match(source, /groupId === 'symbolSolidNumbers'/);
  assert.match(source, /button\.dataset\.symbolValue = value/);
  assert.match(source, /className = 'solid-number-visual'/);
  assert.match(source, /copySymbol\(button\.dataset\.symbolValue \|\| button\.textContent, button\)/);
});

test("D1 is the only engineering records surface", async () => {
  const html = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const client = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/engineering-records-drive/route.ts", import.meta.url), "utf8");
  assert.match(html, /data-sys="engineering-records-d1">工程紀錄<\/button>/);
  assert.doesNotMatch(html, /id="engineering-records-panel"|data-sys="engineering-records"|src="engineering-records\.js"|engineeringRecordsExclude/);
  assert.match(html, /id="d1RecordsSettingsDialog"/);
  assert.match(client, /api\/engineering-records-d1/);
  assert.match(client, /renderMarkdown\(result.record.content/);
  assert.match(client, /engineeringRecords\.settings.save/);
  assert.match(client, /engineeringRecords\.summarize/);
  assert.match(client, /renderSummary\(summaries.join/);
  assert.doesNotMatch(client, /loadStaticSnapshot|cachedRecords|activateEngineeringRecords\(/);
  assert.doesNotMatch(route, /engineeringRecords\.(search|read|catalog|batchRead)/);
});

test("D1 client searches, renders full text and opens its own folder settings", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  class Element {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; this.listeners = {}; }
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    querySelectorAll() { return []; }
  }
  const elements = new Map([...html.matchAll(/id="(d1Records[^"]+)"/g)].map((m) => [m[1], new Element()]));
  const requests = [];
  const note = { id: 'record123456789', name: '10239.md', relativePath: '工程/10239.md', content: '# 德承\n- 沙拉孔', modifiedTime: '2026-10-07' };
  const resultNames = [
    '99999 客戶筆記.md', '2024-07-22 (週一) 1 工程筆記.md',
    '2026-01-08 (週四) 2 新筆記.md', '10240 客戶筆記.md',
    '1999-01-01 舊筆記.md', '2026-01-08 (週四) 10 新筆記.md',
  ];
  const window = {};
  const document = {
    getElementById: (id) => { assert.ok(elements.has(id), `Missing ${id}`); return elements.get(id); },
    createElement: () => new Element(), createDocumentFragment: () => new Element(),
    createTextNode: (text) => Object.assign(new Element(), { textContent: text }),
  };
  runInNewContext(source, {
    window, document, location: { hostname: 'prc174vrc174-oss.github.io' },
    URL, Intl, Date, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      const action = options?.body ? JSON.parse(options.body).action : new URL(url).searchParams.get('action');
      requests.push({ url, action });
      const value = action === 'search' ? { results: Array.from({ length: 23 }, (_, i) => ({ ...note, id: note.id + i, name: resultNames[i] || note.name })) } : action === 'read' ? { record: note } : action === 'engineeringRecords.folders' ? { folders: ['工程', '.hidden'] } : { total: 350, includedFolders: ['工程'], changed: 0 };
      return { ok: true, json: async () => ({ ok: true, ...value }) };
    },
  });
  await window.activateEngineeringRecordsD1();
  const query = elements.get('d1RecordsQuery'); query.value = '10239';
  query.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const renderedItems = elements.get('d1RecordsList').children[0].children;
  assert.equal(renderedItems.length, 23);
  assert.ok(renderedItems.every(item => item.children[0].checked));
  assert.deepEqual(Array.from(renderedItems.slice(0, 6), item => item.children[1].textContent), [
    '2026-01-08 (週四) 10 新筆記', '2026-01-08 (週四) 2 新筆記',
    '2024-07-22 (週一) 1 工程筆記', '1999-01-01 舊筆記',
    '99999 客戶筆記', '10240 客戶筆記',
  ]);
  const item = renderedItems[0];
  item.children[1].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('d1RecordsDialog').open, true);
  assert.ok(elements.get('d1RecordsPreview').children.length > 0);
  await elements.get('d1RecordsFolders').onclick();
  assert.equal(elements.get('d1RecordsSettingsDialog').open, true);
  assert.equal(elements.get('d1RecordsSettingsInput').value, '工程');
  assert.equal(elements.get('d1RecordsSettingsSuggestions').children.length, 1);
  assert.ok(requests.some((r) => r.action === 'read' && r.url.includes('/api/engineering-records-d1')));
  assert.ok(requests.some((r) => r.action === 'engineeringRecords.folders' && r.url.includes('/api/engineering-records-drive')));
});


test("Gemini Markdown renders structure and keeps unsafe content inert", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; }
    appendChild(node) { this.children.push(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
  }
  const target = new Node('div');
  const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new Node('#text', text),
    createDocumentFragment: () => new Node('#fragment'),
  };
  const code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf("  excludeInput.addEventListener"));
  const value = '[來源：note.md]\n[[note|相關紀錄]]\n[紀錄](note.md)\n[官方](https://example.com/manual)\nhttps://example.com/help。\n\n### 工程重點\n**需確認**\n- 第一項\n  - 子項\n\n| 規格 | 備註 |\n| --- | --- |\n| M3 | **注意** |\n\n<script>alert(1)</script>\n[連結](javascript:alert)\n\n```js\n<script>raw</script>\n```';
  const popupSizes = [];
  const display = { availWidth: 1920, availHeight: 1080, availLeft: 0, availTop: 0 };
  runInNewContext(code + '\nrenderMarkdown(value, "", target);', { document, target, value, URL, rows: [{ id: 'note123456789', name: 'note.md' }], summarySources: [], openRecord: async () => {}, window: { screen: display, location: { href: 'https://example.com/' }, open: (url, target, features) => { popupSizes.push(features); return { opener: {} }; } } });
  const nodes = [];
  function walk(node) { nodes.push(node); node.children.forEach(walk); }
  walk(target);
  assert.equal(nodes.filter(n => n.tag === 'h3').length, 1);
  assert.equal(nodes.filter(n => n.tag === 'strong').length, 2);
  assert.equal(nodes.filter(n => n.tag === 'ul').length, 2);
  assert.equal(nodes.filter(n => n.tag === 'table').length, 1);
  assert.equal(nodes.filter(n => n.tag === 'th').length, 2);
  assert.equal(nodes.filter(n => n.tag === 'td').length, 2);
  assert.ok(nodes.some(n => n.tag === '#text' && n.textContent.includes('<script>alert(1)</script>')));
  assert.ok(nodes.some(n => n.tag === 'code' && n.textContent === '<script>raw</script>'));
  assert.ok(!nodes.some(n => n.tag === 'script'));
  const links = nodes.filter(n => n.tag === 'a');
  assert.equal(links.length, 5);
  assert.ok(links.every(n => n.href.startsWith('https://example.com/') && n.target === '_blank'));
  const noteLinks = links.filter(n => n.href.includes('recordId='));
  assert.equal(noteLinks.length, 3);
  let prevented = false;
  noteLinks[0].onclick({ preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.match(popupSizes[0], /width=720,height=510,left=600,top=285,/);
  display.availLeft = -1920;
  noteLinks[0].onclick({ preventDefault() {} });
  assert.match(popupSizes[1], /width=720,height=510,left=-1320,top=285,/);
  display.availLeft = 0; display.availWidth = 390; display.availHeight = 780;
  noteLinks[0].onclick({ preventDefault() {} });
  assert.match(popupSizes[2], /width=358,height=510,left=16,top=135,/);
  assert.ok(noteLinks.every(n => n.href.includes('recordId=note123456789')));
});


test("Obsidian reading syntax renders engineering notes and preserves safe navigation", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; }
    appendChild(node) { this.children.push(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
  }
  const preview = new Node('div'); preview.id = 'note-preview';
  const document = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
  const value = '# 規則\n#3-材料/AL/鋁擠 #5-圖形/壓J\n- ~~板金都要壓J~~ 已改為板金不壓J\n  - **注意** *斜體* ==重點==\n  - 說明 ^[114.04.09 說的]\n- [x] 已確認\n- [ ] 待確認\n- 名稱 #7-人/怡婷 ^74736b\n\n來源註腳[^rule] 再次[^rule] 不明[^constructor]\n\n%%不顯示的註解%%\n`%%保留程式文字%%`\n\\*literal\\*\n\n> [!warning]- 注意事項\n> - 請先確認 **板厚**\n\n- - -\n\n~~~js\n%%程式碼中的註解符號保留%%\n~~literal~~\n~~~\n\n[^rule]: **規則來源**\n  補充說明\n';
  const context = { document, preview, value, URL, rows: [], summarySources: [], window: { location: { href: 'https://example.com/' } } };
  const code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf("  excludeInput.addEventListener"));
  runInNewContext(code + '\nrenderMarkdown(value, "record123", preview);', context);
  const nodes = [];
  function walk(node) { nodes.push(node); node.children.forEach(walk); }
  walk(preview);
  assert.equal(nodes.filter(node => node.tag === 'h1').length, 1);
  assert.equal(nodes.find(node => node.tag === 'del').children[0].textContent, '板金都要壓J');
  assert.equal(nodes.filter(node => node.tag === 'em').length, 1);
  assert.equal(nodes.filter(node => node.tag === 'mark').length, 1);
  assert.deepEqual(nodes.filter(node => node.tag === 'input').map(node => node.checked), [true, false]);
  assert.ok(nodes.filter(node => node.tag === 'input').every(node => node.disabled));
  assert.ok(nodes.some(node => node.className?.includes('engineering-markdown-tag-group-3')));
  assert.ok(!nodes.some(node => node.textContent.includes('74736b') || node.textContent.includes('不顯示的註解')));
  assert.ok(nodes.some(node => node.textContent === '%%保留程式文字%%'));
  assert.ok(nodes.some(node => node.textContent.includes('程式碼中的註解符號保留')));
  const refs = nodes.filter(node => node.className === 'engineering-markdown-footnote-ref').map(node => node.children[0]);
  assert.deepEqual(refs.map(node => node.textContent), ['[1]', '[2]', '[2]']);
  assert.ok(refs.every(node => nodes.some(target => '#' + target.id === node.href)));
  const footer = nodes.find(node => node.className === 'engineering-markdown-footnotes');
  assert.equal(footer.children[0].children.length, 2);
  assert.ok(nodes.some(node => node.textContent.includes('114.04.09 說的')));
  assert.ok(nodes.some(node => node.textContent.includes('[^constructor]')));
  assert.ok(nodes.some(node => node.tag === 'details' && node['data-callout'] === 'warning' && !node.open));
  assert.equal(nodes.filter(node => node.tag === 'hr').length, 1);
});

test("Summary citations reuse numbers and open the corresponding source record", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; }
    get lastChild() { return this.children.at(-1); }
    appendChild(node) { this.children.push(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
  }
  const summary = new Node('div');
  const document = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
  const opened = [];
  const context = {
    document, summary, URL, rows: [],
    updateSummaryButtons() {}, summaryHasContent: false,
    summarySources: [{ id: 'first123', name: '壓注意.md', relativePath: '工程/壓注意.md' }, { id: 'second456', name: '烤漆.md', relativePath: '工程/烤漆.md' }, { id: 'third789', name: '只列來源.md', relativePath: '工程/只列來源.md' }],
    dialog: { getBoundingClientRect: () => ({ width: 900, height: 700 }) },
    window: { location: { href: 'https://example.com/engineering-query.html' }, open: (url, target, features) => { opened.push({ url, features }); return {}; } },
  };
  const code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf("  excludeInput.addEventListener"));
  runInNewContext(code + '\nrenderSummary("**規則** [來源：壓注意.md]\\n- 重複 [來源：壓注意.md]\\n- 另一篇 [來源：烤漆.md]\\n- 合併 [來源：壓注意.md、烤漆.md]\\n\\n### 三、來源檔案清單\\n1. `只列來源.md` [來源：只列來源.md]\\n\\n---\\n\\n## 第二批摘要\\n其他重點 [來源：烤漆.md]");', context);
  const nodes = [];
  function walk(node) { nodes.push(node); node.children.forEach(walk); }
  walk(summary);
  const citations = nodes.filter(node => node.className?.includes('engineering-summary-citation'));
  assert.deepEqual(citations.map(node => node.textContent), ['[1]', '[1]', '[2]', '[1]', '[2]', '[2]']);
  assert.ok(citations[0].href.includes('recordId=first123'));
  assert.ok(citations[2].href.includes('recordId=second456'));
  const footer = summary.children.at(-1);
  assert.equal(footer.children[0].textContent, '來源頁面');
  assert.equal(footer.children[1].textContent, '送入摘要的紀錄：3 篇。');
  assert.equal(footer.children[2].textContent, '已引用（2 篇）');
  assert.equal(footer.children[3].children.length, 2);
  assert.equal(footer.children[4].textContent, '未引用（1 篇）');
  assert.ok(!nodes.some(node => node.textContent.includes('來源檔案清單')));
  assert.ok(nodes.some(node => node.textContent === '第二批摘要'));
  assert.ok(footer.children[6].children[0].children[0].href.includes('recordId=third789'));
  assert.equal(context.summarySections('```\n### 來源檔案\n```').body, '```\n### 來源檔案\n```');
  citations[2].onclick({ preventDefault() {} });
  assert.ok(opened[0].url.includes('recordId=second456'));
  assert.match(opened[0].features, /width=720,height=510,left=16,top=32/);
  context.renderSummary('沒有引用標記的摘要。');
  assert.equal(summary.children.at(-1).children[2].textContent, '已引用（0 篇）');
  assert.equal(summary.children.at(-1).children[4].textContent, '未引用（3 篇）');
  assert.equal(summary.children.at(-1).children[6].children.length, 3);
  context.summarySources.push(context.summarySources[0]);
  context.renderSummary('[來源：壓注意.md] [來源：烤漆.md] [來源：只列來源.md]');
  assert.equal(summary.children.at(-1).children[1].textContent, '送入摘要的紀錄：3 篇。');
  assert.equal(summary.children.at(-1).children[4].textContent, '未引用（0 篇）');
  assert.equal(summary.children.at(-1).children.length, 5);
});

test("Gemini summarizes up to 40 records in one request and splits only above 40", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  for (const count of [20, 23, 40, 43]) {
  const selected = Array.from({ length: count }, (_, i) => ({ value: 'record' + i }));
  const calls = [], statuses = [], output = [];
  const code = source.slice(source.indexOf('  async function summarize()'), source.indexOf('  function normalizeFolders('));
  const context = {
    list: { querySelectorAll: () => selected }, summary: {}, gemini: {}, rows: selected,
    summarizing: false, summaryStart: {}, updateSummaryButtons() {},
    query: { value: '10258' }, token: 'test-credential', driveApi: '/api/test', summarySources: [],
    view() {}, credentialValid: () => true,
    setStatus: (text, state) => statuses.push({ text, state }),
    setSummaryStatus: (text, state) => statuses.push({ text, state }),
    renderSummary: (value) => output.push(value),
    call: async (_, options) => {
      const payload = JSON.parse(options.body); calls.push(payload);
      return { summary: '**重點** ' + payload.ids.join(', '), sources: [] };
    },
  };
  await runInNewContext(code + '\nsummarize();', context);
  assert.deepEqual(calls.map(call => call.ids.length), count <= 40 ? [count] : [40, 3]);
  assert.deepEqual(calls.flatMap(call => call.ids), selected.map(row => row.value));
  assert.ok(output.at(-1).includes('record' + (count - 1)));
  assert.equal(output.at(-1).includes('第 1–'), count > 40);
  assert.ok(statuses.at(-1).text.includes(String(count)));
  assert.equal(statuses.at(-1).state, 'success');
  }
});


test("Search counts and Gemini progress stay separate across tab switches", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const context = {
    activeView: 'results', viewStatuses: { results: { message: '', state: '' }, summary: { message: '', state: '' } },
    status: {}, resultsView: {}, summaryView: {},
    resultsTab: { setAttribute() {} }, summaryTab: { setAttribute() {} },
  };
  const code = source.slice(source.indexOf('  function paintStatus()'), source.indexOf('  async function call(')) +
    source.slice(source.indexOf('  function view('), source.indexOf('  function date('));
  runInNewContext(code, context);
  context.setStatus('找到 23 筆工程紀錄。', 'success');
  context.setSummaryStatus('Gemini 正在整理 23 篇…', 'loading');
  assert.equal(context.status.textContent, '找到 23 筆工程紀錄。');
  context.view('summary');
  assert.equal(context.status.textContent, 'Gemini 正在整理 23 篇…（3.5 Flash-lite）');
  context.view('results');
  context.setSummaryStatus('Gemini 摘要完成，共整理 23 篇。', 'success');
  assert.equal(context.status.textContent, '找到 23 筆工程紀錄。');
  context.view('summary');
  assert.equal(context.status.textContent, 'Gemini 摘要完成，共整理 23 篇。（3.5 Flash-lite）');
  context.setSummaryStatus('');
  assert.equal(context.status.textContent, '');
});


test("Record windows load linked IDs and filename references directly", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf('  function appendInline('));
  for (const query of ['recordId=note123456789', 'recordName=note.md']) {
    const opened = [], classes = [];
    const context = {
      recordParams: new URL('https://example.com/?' + query).searchParams,
      document: { documentElement: { classList: { add: value => classes.push(value) } } },
      dialog: { showModal() {} }, previewTitle: {}, previewMeta: {}, preview: {}, api: '/api/records',
      call: async url => {
        assert.equal(new URL(url, 'https://example.com').searchParams.get('query'), 'note');
        return { results: [{ id: 'note123456789', name: 'note.md', relativePath: '工程/note.md' }] };
      },
      openRecord: async record => opened.push(record.id),
    };
    await runInNewContext(code + '\nloadLinkedRecord();', context);
    assert.deepEqual(opened, ['note123456789']);
    assert.deepEqual(classes, ['engineering-record-window']);
  }
});

test("Summary sign-in opens a dialog, cancellation stops automatic generation, and refresh shares the busy state", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf('  function updateSummaryButtons()'), source.indexOf('  function normalizeFolders('));
  let callback, resolveRequest, calls = 0;
  const button = () => ({ replaceChildren() {} });
  const context = {
    gemini: {}, regenerate: {}, summaryClear: {}, rows: [{ id: 'note1' }], summarizing: false,
    signInPending: false, saveAfterLogin: false, summaryHasContent: false, token: '', summarySources: [], summaryStart: { hidden: false },
    summary: { textContent: '保留原摘要', hidden: false }, signInStatus: {}, settingsSignIn: button(), googleButton: button(),
    signInDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; }, addEventListener() {} },
    byId: () => ({}), query: { value: '10017' }, clientId: 'test', driveApi: '/test',
    list: { querySelectorAll: () => [{ value: 'note1' }] }, view() {}, setSummaryStatus() {},
    atob: value => Buffer.from(value, 'base64').toString(),
    call: () => { calls++; return new Promise(resolve => { resolveRequest = resolve; }); }, renderSummary() {},
    google: { accounts: { id: { initialize: options => { callback = options.callback; }, renderButton() {} } } },
  };
  context.window = { google: context.google };
  runInNewContext(code, context);
  await context.summarize();
  assert.equal(context.signInDialog.open, true);
  assert.equal(context.summary.textContent, '保留原摘要');
  assert.equal(calls, 0);
  context.cancelSummarySignIn();
  callback({ credential: 'test.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64') + '.test' });
  assert.equal(context.signInDialog.open, false);
  assert.equal(calls, 0);
  context.token = '';
  await context.summarize();
  callback({ credential: 'test.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64') + '.test' });
  assert.equal(context.signInDialog.open, false);
  assert.equal(calls, 1);
  assert.equal(context.summaryStart.hidden, true);
  assert.equal(context.gemini.disabled, true);
  assert.equal(context.regenerate.disabled, true);
  await context.summarize();
  assert.equal(calls, 1);
  resolveRequest({ summary: '摘要', sources: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.gemini.disabled, false);
  assert.equal(context.regenerate.disabled, false);
});

test("Inline and named footnotes keep nested note links and balanced URL parentheses clickable", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.textContent = text; this.children = []; }
    appendChild(node) { this.children.push(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this[key] = value; }
  }
  const preview = new Node('div');
  const document = { createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text), createDocumentFragment: () => new Node('#fragment') };
  const value = '規則 ^[參閱 [[B(新版)|筆記 B]]、[原文](B(新版).md) 及 [網頁](https://example.com/a(b))，`a]b` 不截斷]，命名註腳[^named]。\n\n[^named]: [另一頁](C.md) 與 [[B(新版)]]\n';
  const opened = [], code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf("  excludeInput.addEventListener"));
  runInNewContext(code + '\nrenderMarkdown(value, "record1", preview);', {
    document, preview, value, URL, rows: [{ id: 'b', name: 'B(新版).md' }, { id: 'c', name: 'C.md' }], summarySources: [],
    openRecord: record => opened.push(record.id), window: { matchMedia: () => ({ matches: true }), location: { href: 'https://example.com/' } },
  });
  const all = []; (function walk(node) { all.push(node); node.children.forEach(walk); })(preview);
  const notes = all.filter(n => n.tag === 'li');
  assert.equal(notes.length, 2);
  const links = all.filter(n => n.tag === 'a' && n.className?.includes('engineering-markdown-record-link'));
  assert.equal(links.length, 4);
  links.forEach(link => link.onclick({ preventDefault() {} }));
  assert.deepEqual(opened, ['b', 'b', 'c', 'b']);
  assert.ok(all.some(n => n.tag === 'a' && n.href === 'https://example.com/a(b)'));
  assert.ok(all.some(n => n.tag === 'code' && n.textContent === 'a]b'));
});

test("Mobile note links stay in the app and closing or browser back restores the previous note and search", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  class Element {
    constructor(tag = 'div', text = '') { this.tag = tag; this.children = []; this.value = ''; this.textContent = text; this.listeners = {}; this.scrollTop = 0; }
    get childNodes() { return this.children; }
    replaceChildren(...nodes) { this.children = nodes; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    querySelectorAll() { return []; }
  }
  const elements = new Map([...html.matchAll(/id="(d1Records[^"]+)"/g)].map(m => [m[1], new Element()]));
  const notes = [{ id: 'a', name: 'A.md', content: '# A\n[[B]]' }, { id: 'b', name: 'B.md', content: '# B' }];
  const events = {}, states = [{ preserved: 'app-state' }]; let index = 0, closed = 0, popups = 0;
  const window = {
    location: { href: 'https://example.com/engineering-query.html' }, matchMedia: () => ({ matches: true }),
    addEventListener: (name, callback) => { events[name] = callback; }, close: () => { closed++; }, open: () => { popups++; },
    history: {
      get state() { return states[index]; },
      pushState(state) { states.splice(index + 1); states.push(state); index++; },
      back() { index--; events.popstate({ state: states[index] }); },
    },
  };
  const document = {
    title: '查詢系統', getElementById: id => elements.get(id),
    createElement: tag => new Element(tag), createDocumentFragment: () => new Element('#fragment'), createTextNode: text => new Element('#text', text),
  };
  runInNewContext(source, { window, document, location: { hostname: 'example.com' }, URL, Intl, Date, setTimeout, clearTimeout,
    fetch: async url => {
      const params = new URL(url, window.location.href).searchParams;
      return { ok: true, json: async () => ({ ok: true, results: notes, record: notes.find(n => n.id === params.get('id')) }) };
    },
  });
  const query = elements.get('d1RecordsQuery'); query.value = '保留的關鍵字';
  query.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const rendered = elements.get('d1RecordsList').children[0].children;
  const first = rendered.find(item => item.children[0].value === 'a');
  await first.children[1].onclick(); await new Promise(resolve => setImmediate(resolve));
  const preview = elements.get('d1RecordsPreview'), dialog = elements.get('d1RecordsDialog');
  preview.scrollTop = 145;
  const nodes = []; (function walk(node) { nodes.push(node); node.children.forEach(walk); })(preview);
  const link = nodes.find(n => n.tag === 'a');
  link.onclick({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('d1RecordsPreviewTitle').textContent, 'B.md');
  assert.equal(window.history.state.preserved, 'app-state');
  elements.get('d1RecordsDialogClose').onclick();
  assert.equal(elements.get('d1RecordsPreviewTitle').textContent, 'A.md');
  assert.equal(preview.scrollTop, 145);
  assert.equal(dialog.open, true);
  elements.get('d1RecordsDialogClose').onclick();
  assert.equal(dialog.open, false);
  assert.equal(query.value, '保留的關鍵字');
  assert.ok(rendered.every(item => item.children[0].checked));
  first.children[1].onclick(); await new Promise(resolve => setImmediate(resolve));
  window.history.back();
  assert.equal(dialog.open, false);
  assert.equal(closed, 0);
  assert.equal(popups, 0);
});

test("Standalone mobile reader returns to the system and regeneration appears only after summary content", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const returned = [], context = {
    isMobileReader: () => true, readerStack: [], recordWindow: true,
    window: { location: { href: 'https://example.com/engineering-query.html?recordId=a#note', replace: url => returned.push(url) }, close() { throw new Error('Must not close mobile app'); } }, URL,
  };
  runInNewContext(source.slice(source.indexOf('  function closeRecordReader()'), source.indexOf('  if (window.addEventListener)')), context);
  context.closeRecordReader();
  assert.deepEqual(returned, ['https://example.com/engineering-query.html']);
  const controls = { gemini: {}, regenerate: {}, summaryClear: {}, rows: [{}], summarizing: false, summaryHasContent: false };
  runInNewContext(source.slice(source.indexOf('  function updateSummaryButtons()'), source.indexOf('  function cancelSummarySignIn()')), controls);
  controls.updateSummaryButtons(); assert.equal(controls.regenerate.hidden, true);
  controls.summaryHasContent = true;
  controls.updateSummaryButtons(); assert.equal(controls.regenerate.hidden, false);
  controls.summarizing = true;
  controls.updateSummaryButtons(); assert.equal(controls.regenerate.disabled, true);
});

test("Summary source-list title variants are omitted without hiding later batches or fenced examples", async () => {
  const source = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const context = {};
  runInNewContext(source.slice(source.indexOf('  function summarySections('), source.indexOf('  function renderSummary(')), context);
  for (const title of ['三、來源檔案清單', '三、 來源檔案清單', '3. 來源文件列表', '３）來源頁面一覽', '📁 來源檔案', '**三、來源檔案清單：**']) {
    const markdown = '## 工程紀錄摘要（第 21–40 篇）\n重點 [來源：A.md]\n\n### ' + title + '\n- [來源：B.md]\n\n---\n\n## 工程紀錄摘要（第 41–43 篇）\n後續重點 [來源：C.md]';
    const result = context.summarySections(markdown);
    assert.ok(!result.body.includes(title), title);
    assert.ok(result.body.includes('後續重點 [來源：C.md]'));
    assert.ok(result.sources.includes('[來源：B.md]'));
  }
  for (const fence of ['```', '~~~~']) {
    const value = fence + '\n### 三、來源檔案清單\n' + fence + '\n正常內容';
    assert.equal(context.summarySections(value).body, value);
  }
  const body = '### 三、來源檔案清單注意事項\n這是一般工程內容。';
  assert.equal(context.summarySections(body).body, body);
});

test("Sites Gemini API forwards 40 records to Apps Script without losing IDs", async () => {
  const { POST } = await import('../app/api/engineering-records-drive/route.ts');
  const ids = Array.from({ length: 40 }, (_, i) => 'record_' + String(i).padStart(6, '0'));
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (_, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ ok: true, summary: '摘要', sources: ids.map(id => ({ id })) });
  };
  try {
    const response = await POST(new Request('https://example.com/api/engineering-records-drive', {
      method: 'POST', body: JSON.stringify({ action: 'engineeringRecords.summarize', ids, idToken: 'test-token' }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sources.length, 40);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ids, ids);
  } finally { globalThis.fetch = original; }
});

test("Engineering Markdown renders Gemini formulas with local KaTeX and keeps code and links intact", async () => {
  const source = await readFile(new URL('../public/engineering-records-d1.js', import.meta.url), 'utf8');
  const library = await readFile(new URL('../public/vendor/katex/katex-0.19.0.min.js', import.meta.url), 'utf8');
  class Node {
    constructor(tag, text = '') { this.tag = tag; this.children = []; this.style = {}; this._text = text; }
    appendChild(node) { this.children.push(node); return node; }
    replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
    setAttribute(key, value) { this[key] = value; }
    set textContent(text) { this._text = text; this.children = []; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
  }
  const document = { compatMode: 'CSS1Compat', createElement: tag => new Node(tag),
    createElementNS: (namespace, tag) => new Node(tag), createTextNode: text => new Node('#text', text),
    createDocumentFragment: () => new Node('#fragment') };
  const target = new Node('div');
  const context = { document, target, console, URL, rows: [], summarySources: [], window: { location: { href: 'https://example.com/' } } };
  runInNewContext(library, context);
  context.window.katex = context.katex;
  context.value = String.raw`- 鋁釘開孔 $\varnothing$4.35；**公差 $\pm0.05$**。
- 素材尺寸 $ +0.1/-0.05$，厚度 \(T^2\)，尺寸 \[\frac{1}{2}\]。

$$
BD = 2T - M \\
L = \frac{a+b}{2}
$$

\[
x_{1} = \sqrt{4}
\]

來源[^rule] [官方](https://example.com/manual)

[^rule]: 公差 $\pm0.05$

\`$\pm0.05$\` 費用 \$100，未閉合 $x；未閉合 \(x

~~~tex
$\frac{1}{2}$
~~~

$\href{javascript:alert(1)}{unsafe}$
$\unsupportedCommand{1}$`;
  // String.raw preserves backticks' escaping as well; remove only these fixture escapes.
  context.value = context.value.replace(/\\`/g, '`');
  const code = source.slice(source.indexOf('  function recordLinkName('), source.indexOf('  excludeInput.addEventListener'));
  runInNewContext(code + '\nrenderMarkdown(value, "", target);', context);
  const nodes = [];
  const walk = node => { nodes.push(node); node.children.forEach(walk); }; walk(target);
  const math = nodes.filter(n => n.tag === 'math');
  assert.equal(math.length, 10);
  assert.ok(nodes.some(n => n.tag === 'mi' && n.textContent === '∅'));
  assert.ok(nodes.some(n => n.tag === 'mo' && n.textContent === '±'));
  assert.equal(nodes.filter(n => n.tag === 'mfrac').length, 2);
  assert.ok(nodes.some(n => n.tag === 'msup'));
  assert.ok(nodes.some(n => n.tag === 'msub'));
  assert.ok(nodes.some(n => n.tag === 'msqrt'));
  assert.equal(nodes.filter(n => n.className === 'engineering-markdown-math is-display').length, 3);
  assert.ok(nodes.some(n => n.tag === 'code' && n.textContent === String.raw`$\pm0.05$`));
  assert.ok(nodes.some(n => n.tag === 'code' && n.textContent === String.raw`$\frac{1}{2}$`));
  assert.ok(nodes.some(n => n.tag === '#text' && n.textContent.includes('100')));
  assert.ok(nodes.some(n => n.tag === '#text' && n.textContent.includes('$x')));
  assert.ok(nodes.some(n => n.tag === 'a' && n.href === 'https://example.com/manual'));
  assert.ok(!nodes.some(n => /^(script|iframe|img)$/.test(n.tag) || /^javascript:/.test(n.href || '')));
  const html = await readFile(new URL('../public/engineering-query.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('src="vendor/katex/katex-0.19.0.min.js"') < html.indexOf('src="engineering-records-d1.js?'));
  const sw = await readFile(new URL('../public/service-worker.js', import.meta.url), 'utf8');
  assert.ok(sw.includes('./vendor/katex/katex-0.19.0.min.js'));
});
