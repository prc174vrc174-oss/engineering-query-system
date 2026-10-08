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
  assert.match(serviceWorker, /engineering-query-pwa-v199/);
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
  assert.match(source, /class="tab-btn" data-sys="nail-gallery">釘子圖<\/button>/);
  assert.match(source, /class="tab-btn" data-sys="fold-tool">座標圖<\/button>/);
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
  assert.match(source, /current === 'nail-gallery'[\s\S]*?data-sys="fold-tool"/);
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
  assert.match(source, /current === 'fold-tool'[\s\S]*?data-sys="die-setup"/);
  assert.match(source, /current === 'die-setup'[\s\S]*?data-sys="fold-tool"/);
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
  assert.match(source, /class="symbols-title"[^>]*>[\s\S]*?字元符號<\/h2>/);
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
  assert.match(source, /current === 'die-setup'[\s\S]*?data-sys="symbols"/);
  assert.match(source, /current === 'symbols'[\s\S]*?data-sys="die-setup"/);
});

test("D1 is the only engineering records surface", async () => {
  const html = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const client = await readFile(new URL("../public/engineering-records-d1.js", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/engineering-records-drive/route.ts", import.meta.url), "utf8");
  assert.match(html, /data-sys="engineering-records-d1">工程紀錄 D1<\/button>/);
  assert.doesNotMatch(html, /id="engineering-records-panel"|data-sys="engineering-records"|src="engineering-records\.js"|engineeringRecordsExclude/);
  assert.match(html, /id="d1RecordsSettingsDialog"/);
  assert.match(client, /api\/engineering-records-d1/);
  assert.match(client, /renderMarkdown\(result.record.content/);
  assert.match(client, /engineeringRecords\.settings.save/);
  assert.match(client, /engineeringRecords\.summarize/);
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
      const value = action === 'search' ? { results: [note] } : action === 'read' ? { record: note } : action === 'engineeringRecords.folders' ? { folders: ['工程', '.hidden'] } : { total: 350, includedFolders: ['工程'], changed: 0 };
      return { ok: true, json: async () => ({ ok: true, ...value }) };
    },
  });
  await window.activateEngineeringRecordsD1();
  const query = elements.get('d1RecordsQuery'); query.value = '10239';
  query.listeners.keydown({ key: 'Enter', preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const item = elements.get('d1RecordsList').children[0].children[0];
  item.children[1].onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.get('d1RecordsDialog').open, true);
  assert.ok(elements.get('d1RecordsPreview').children.length > 0);
  await elements.get('d1RecordsFolders').onclick();
  assert.equal(elements.get('d1RecordsSettingsDialog').open, true);
  assert.equal(elements.get('d1RecordsSettingsInput').value, '工程');
  assert.equal(elements.get('d1RecordsSettingsSuggestions').children.length, 1);
  assert.ok(requests.every((r) => r.url.startsWith('https://engineering-records-api.janyu056.workers.dev/')));
  assert.ok(requests.some((r) => r.action === 'read' && r.url.includes('/api/engineering-records-d1')));
  assert.ok(requests.some((r) => r.action === 'engineeringRecords.folders' && r.url.includes('/api/engineering-records-drive')));
});
