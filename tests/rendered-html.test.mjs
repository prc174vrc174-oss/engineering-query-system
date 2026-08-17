import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

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
  assert.match(calculator, /Version 151 測試/);
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

test("Version 151 test labels live in the requested header areas", async () => {
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
    /<header class="app-header-tabs">[\s\S]*?<span class="site-version"[^>]*>Version 151 測試<\/span>[\s\S]*?<\/header>/,
  );
  assert.match(
    standalone,
    /<header class="head">[\s\S]*?<span class="site-version"[^>]*>Version 151 測試<\/span>[\s\S]*?<\/header>/,
  );
  assert.equal((source.match(/Version 151 測試/g) || []).length, 2);
  assert.equal((standalone.match(/Version 151 測試/g) || []).length, 2);
});

test("GitHub Pages build is installable and supports direct Apps Script upload", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  const upload = await readFile(new URL("../public/nail-excel-upload.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  const serviceWorker = await readFile(new URL("../public/service-worker.js", import.meta.url), "utf8");

  assert.match(source, /rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(source, /serviceWorker\.register\('\.\/service-worker\.js'/);
  assert.equal(manifest.name, "工程查詢系統");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "192x192"), true);
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
  assert.match(serviceWorker, /engineering-query-pwa-v151/);
  assert.match(upload, /isGitHubPages/);
  assert.match(upload, /DIRECT_SYNC_URL/);
  assert.match(upload, /mode: 'no-cors'/);
  assert.match(source, /id="nailUploadDirectToken"/);
  assert.match(upload, /sessionStorage\.setItem\('engineeringSheetUpdateToken'/);
  assert.doesNotMatch(source, /lanWebUpdateToken = '[a-f0-9]{32,}'/);
});

test("GitHub Pages reads sheet metadata directly with a mobile-safe timeout", async () => {
  const source = await readFile(new URL("../public/engineering-query.html", import.meta.url), "utf8");
  assert.match(source, /if \(\/\\\.github\\\.io\$\/i\.test\(window\.location\.hostname\)\) \{[\s\S]*?tryDirectMetadata\(\);[\s\S]*?return;/);
  assert.match(source, /\}, 45000\);/);
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
