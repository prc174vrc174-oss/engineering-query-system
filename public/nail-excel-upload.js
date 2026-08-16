(function () {
  'use strict';

  var TARGET_SHEET = '釘子自動彙總';
  var SYNC_URL = '/api/nail-upload';
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var EXPECTED_HEADERS = [
    '工作表', '品號', '區域', '規格', '廠商圖號料號', '數量', '材質', '實量ø徑',
    '釘外徑', '含板厚', '不含板厚', '總長', '廠商', '年月日', '備註', '來源檔案'
  ];

  var button = document.getElementById('nailUploadFileBtn');
  var fileInput = document.getElementById('nailExcelFileInput');
  var modal = document.getElementById('nailUploadModal');
  var changeButton = document.getElementById('nailUploadChangeBtn');
  var submitButton = document.getElementById('nailUploadSubmitBtn');
  var fileNameEl = document.getElementById('nailUploadFileName');
  var fileMetaEl = document.getElementById('nailUploadFileMeta');
  var sheetCheck = document.getElementById('nailUploadSheetCheck');
  var rangeCheck = document.getElementById('nailUploadRangeCheck');
  var headerCheck = document.getElementById('nailUploadHeaderCheck');
  var sheetValue = document.getElementById('nailUploadSheetValue');
  var rangeValue = document.getElementById('nailUploadRangeValue');
  var headerValue = document.getElementById('nailUploadHeaderValue');
  var accountValue = document.getElementById('nailUploadAccountValue');
  var switchAccountButton = document.getElementById('nailUploadSwitchAccountBtn');
  var statusEl = document.getElementById('nailUploadStatus');
  var parsedWorkbook = null;
  var authorizedEmail = '';
  var uploading = false;

  if (!button || !fileInput || !modal || !submitButton) return;

  function setStatus(message, state) {
    statusEl.textContent = message;
    statusEl.className = 'nail-upload-status' + (state ? ' is-' + state : '');
  }

  function setCheckState(element, valid) {
    element.classList.toggle('is-valid', !!valid);
  }

  function openSignInAtTop(signInUrl) {
    var link = document.createElement('a');
    link.href = signInUrl;
    link.target = '_top';
    link.rel = 'noopener';
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function updateSubmitState() {
    submitButton.disabled = uploading || !parsedWorkbook;
  }

  function resetChecks() {
    parsedWorkbook = null;
    sheetValue.textContent = '檢查中…';
    rangeValue.textContent = '－';
    headerValue.textContent = '－';
    [sheetCheck, rangeCheck, headerCheck].forEach(function (item) {
      setCheckState(item, false);
    });
    updateSubmitState();
  }

  function showModal() {
    modal.hidden = false;
    document.body.classList.add('nail-upload-open');
  }

  function closeModal() {
    if (uploading) return;
    modal.hidden = true;
    document.body.classList.remove('nail-upload-open');
    parsedWorkbook = null;
    fileInput.value = '';
    updateSubmitState();
    button.focus();
  }

  async function chooseFile() {
    if (uploading) return;
    button.disabled = true;
    try {
      var response = await fetch(SYNC_URL, { cache: 'no-store', credentials: 'same-origin' });
      var result = await response.json();
      if (response.status === 401 && result && result.signInUrl) {
        openSignInAtTop(result.signInUrl);
        return;
      }
      if (!response.ok || !result || !result.ok) {
        throw new Error((result && result.error) || '目前無法使用上傳功能。');
      }
      authorizedEmail = result.email || '';
      fileInput.value = '';
      fileInput.click();
    } catch (error) {
      window.alert(error && error.message ? error.message : '目前無法使用上傳功能。');
    } finally {
      button.disabled = false;
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function normalizeHeader(value) {
    return String(value == null ? '' : value).replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
  }

  function validateHeaders(rows) {
    if (!rows.length) throw new Error('工作表沒有資料。');
    var actual = rows[0] || [];
    for (var i = 0; i < EXPECTED_HEADERS.length; i += 1) {
      if (normalizeHeader(actual[i]) !== normalizeHeader(EXPECTED_HEADERS[i])) {
        throw new Error('第 ' + (i + 1) + ' 欄應為「' + EXPECTED_HEADERS[i] + '」，目前是「' + (actual[i] || '空白') + '」。');
      }
    }
  }

  function readUint16(view, offset) {
    return view.getUint16(offset, true);
  }

  function readUint32(view, offset) {
    return view.getUint32(offset, true);
  }

  function findEndOfCentralDirectory(view) {
    var minOffset = Math.max(0, view.byteLength - 65557);
    for (var offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
      if (readUint32(view, offset) === 0x06054b50) return offset;
    }
    throw new Error('檔案不是有效的 Excel ZIP 格式。');
  }

  function parseZipDirectory(buffer) {
    var bytes = new Uint8Array(buffer);
    var view = new DataView(buffer);
    var eocd = findEndOfCentralDirectory(view);
    var entryCount = readUint16(view, eocd + 10);
    var centralOffset = readUint32(view, eocd + 16);
    var decoder = new TextDecoder('utf-8');
    var entries = {};
    var offset = centralOffset;

    if (entryCount === 0xffff || centralOffset === 0xffffffff) {
      throw new Error('目前不支援 ZIP64 格式的 Excel。');
    }

    for (var index = 0; index < entryCount; index += 1) {
      if (readUint32(view, offset) !== 0x02014b50) throw new Error('Excel ZIP 目錄損壞。');
      var flags = readUint16(view, offset + 8);
      var method = readUint16(view, offset + 10);
      var compressedSize = readUint32(view, offset + 20);
      var uncompressedSize = readUint32(view, offset + 24);
      var nameLength = readUint16(view, offset + 28);
      var extraLength = readUint16(view, offset + 30);
      var commentLength = readUint16(view, offset + 32);
      var localOffset = readUint32(view, offset + 42);
      var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');

      if (flags & 1) throw new Error('不支援加密的 Excel 檔案。');
      entries[name] = {
        method: method,
        compressedSize: compressedSize,
        uncompressedSize: uncompressedSize,
        localOffset: localOffset
      };
      offset += 46 + nameLength + extraLength + commentLength;
    }

    return { bytes: bytes, view: view, entries: entries };
  }

  async function inflateRaw(compressed) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('目前瀏覽器不支援 Excel 解壓縮，請改用最新版 Chrome 或 Edge。');
    }
    var stream;
    try {
      stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    } catch (error) {
      throw new Error('瀏覽器無法解壓縮 Excel，請改用最新版 Chrome 或 Edge。');
    }
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZipEntry(zip, name) {
    var entry = zip.entries[name];
    if (!entry) throw new Error('Excel 缺少必要檔案：' + name);
    if (entry.uncompressedSize > 35 * 1024 * 1024) throw new Error('Excel 內部資料過大。');
    var view = zip.view;
    var localOffset = entry.localOffset;
    if (readUint32(view, localOffset) !== 0x04034b50) throw new Error('Excel ZIP 項目損壞：' + name);
    var localNameLength = readUint16(view, localOffset + 26);
    var localExtraLength = readUint16(view, localOffset + 28);
    var dataStart = localOffset + 30 + localNameLength + localExtraLength;
    var compressed = zip.bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === 0) return compressed.slice();
    if (entry.method === 8) return inflateRaw(compressed);
    throw new Error('Excel 使用不支援的壓縮方式。');
  }

  function parseXml(text, label) {
    var xml = new DOMParser().parseFromString(text, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw new Error(label + ' XML 無法解析。');
    return xml;
  }

  function descendantsByLocalName(node, localName) {
    return Array.prototype.slice.call(node.getElementsByTagNameNS('*', localName));
  }

  function directChildByLocalName(node, localName) {
    for (var i = 0; i < node.childNodes.length; i += 1) {
      var child = node.childNodes[i];
      if (child.nodeType === 1 && child.localName === localName) return child;
    }
    return null;
  }

  function normalizeZipPath(path) {
    var parts = [];
    String(path || '').replace(/\\/g, '/').split('/').forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    return parts.join('/');
  }

  function columnNumber(cellReference) {
    var match = /^([A-Z]+)/i.exec(cellReference || '');
    if (!match) return 0;
    var result = 0;
    for (var i = 0; i < match[1].length; i += 1) {
      result = result * 26 + match[1].toUpperCase().charCodeAt(i) - 64;
    }
    return result;
  }

  function rowNumber(cellReference) {
    var match = /([0-9]+)$/.exec(cellReference || '');
    return match ? Number(match[1]) : 0;
  }

  function textRuns(node) {
    return descendantsByLocalName(node, 't').map(function (item) { return item.textContent || ''; }).join('');
  }

  function cellValue(cell, sharedStrings) {
    var type = cell.getAttribute('t') || '';
    if (type === 'inlineStr') {
      var inlineNode = directChildByLocalName(cell, 'is');
      return inlineNode ? textRuns(inlineNode) : '';
    }
    var valueNode = directChildByLocalName(cell, 'v');
    var raw = valueNode ? valueNode.textContent || '' : '';
    if (type === 's') return raw === '' ? '' : (sharedStrings[Number(raw)] || '');
    if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
    return raw;
  }

  async function parseWorkbook(file) {
    var buffer = await file.arrayBuffer();
    var zip = parseZipDirectory(buffer);
    var decoder = new TextDecoder('utf-8');
    var workbookXml = parseXml(decoder.decode(await readZipEntry(zip, 'xl/workbook.xml')), '活頁簿');
    var relationshipsXml = parseXml(decoder.decode(await readZipEntry(zip, 'xl/_rels/workbook.xml.rels')), '活頁簿關聯');
    var sheets = descendantsByLocalName(workbookXml, 'sheet');
    var sheet = sheets.find(function (item) { return item.getAttribute('name') === TARGET_SHEET; });
    if (!sheet) throw new Error('找不到「' + TARGET_SHEET + '」工作表。');

    var relationshipId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheet.getAttribute('r:id');
    var relationships = descendantsByLocalName(relationshipsXml, 'Relationship');
    var relationship = relationships.find(function (item) { return item.getAttribute('Id') === relationshipId; });
    if (!relationship) throw new Error('無法找到工作表關聯。');
    var target = relationship.getAttribute('Target') || '';
    var sheetPath = normalizeZipPath(target.charAt(0) === '/' ? target.slice(1) : (target.indexOf('xl/') === 0 ? target : 'xl/' + target));

    var sharedStrings = [];
    if (zip.entries['xl/sharedStrings.xml']) {
      var sharedXml = parseXml(decoder.decode(await readZipEntry(zip, 'xl/sharedStrings.xml')), '共用文字');
      sharedStrings = descendantsByLocalName(sharedXml, 'si').map(textRuns);
    }

    var sheetXml = parseXml(decoder.decode(await readZipEntry(zip, sheetPath)), '工作表');
    var dimension = descendantsByLocalName(sheetXml, 'dimension')[0];
    var maxRow = 0;
    var maxColumn = 0;
    if (dimension) {
      var dimensionRef = dimension.getAttribute('ref') || '';
      var endRef = dimensionRef.split(':').pop();
      maxRow = rowNumber(endRef);
      maxColumn = columnNumber(endRef);
    }

    var cells = descendantsByLocalName(sheetXml, 'c');
    cells.forEach(function (cell) {
      var ref = cell.getAttribute('r') || '';
      maxRow = Math.max(maxRow, rowNumber(ref));
      maxColumn = Math.max(maxColumn, columnNumber(ref));
    });

    if (!maxRow || !maxColumn) throw new Error('工作表沒有可上傳的資料。');
    if (maxRow > 20000 || maxColumn > 80) throw new Error('工作表範圍過大，請確認是否選到正確檔案。');

    var rows = Array.from({ length: maxRow }, function () {
      return Array.from({ length: maxColumn }, function () { return ''; });
    });
    cells.forEach(function (cell) {
      var ref = cell.getAttribute('r') || '';
      var row = rowNumber(ref);
      var column = columnNumber(ref);
      if (row > 0 && column > 0 && row <= maxRow && column <= maxColumn) {
        rows[row - 1][column - 1] = cellValue(cell, sharedStrings);
      }
    });

    validateHeaders(rows);
    return {
      sheetName: TARGET_SHEET,
      rows: maxRow,
      columns: maxColumn,
      tsv: rows.map(function (row) { return row.map(toTsvField).join('\t'); }).join('\r\n')
    };
  }

  function toTsvField(value) {
    var text = String(value == null ? '' : value);
    if (text.charAt(0) === '=') text = "'" + text;
    if (/[\t\r\n"]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  async function handleSelectedFile(file) {
    if (!file) return;
    var extension = (file.name.split('.').pop() || '').toLowerCase();
    showModal();
    resetChecks();
    fileNameEl.textContent = file.name;
    fileMetaEl.textContent = formatBytes(file.size) + '｜修改時間 ' + new Date(file.lastModified).toLocaleString('zh-TW', { hour12: false });
    if (accountValue) accountValue.textContent = authorizedEmail || '已授權帳號';
    setStatus('正在讀取並檢查 Excel…', 'loading');

    try {
      if (extension !== 'xlsx' && extension !== 'xlsm') throw new Error('請選擇 .xlsx 或 .xlsm 檔案。');
      if (!file.size) throw new Error('選擇的檔案是空的。');
      if (file.size > MAX_FILE_BYTES) throw new Error('檔案不可超過 25 MB。');
      parsedWorkbook = await parseWorkbook(file);
      sheetValue.textContent = parsedWorkbook.sheetName;
      rangeValue.textContent = parsedWorkbook.rows + ' 列 × ' + parsedWorkbook.columns + ' 欄';
      headerValue.textContent = '符合 ' + EXPECTED_HEADERS.length + ' 個必要欄位';
      [sheetCheck, rangeCheck, headerCheck].forEach(function (item) { setCheckState(item, true); });
      setStatus('Excel 檢查完成，可以更新 Google Sheet。', 'success');
      submitButton.focus();
    } catch (error) {
      parsedWorkbook = null;
      sheetValue.textContent = '檢查失敗';
      rangeValue.textContent = '－';
      headerValue.textContent = '不符合';
      setStatus(error && error.message ? error.message : 'Excel 讀取失敗。', 'error');
    }
    updateSubmitState();
  }

  async function uploadWorkbook() {
    if (!parsedWorkbook || uploading) return;
    uploading = true;
    updateSubmitState();
    submitButton.textContent = '更新中…';
    setStatus('正在將 ' + parsedWorkbook.rows + ' 列資料傳送到 Google Sheet，請勿關閉視窗…', 'loading');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 300000);

    try {
      var payload = {
        worksheet: parsedWorkbook.sheetName,
        tsv: parsedWorkbook.tsv
      };
      var response = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        body: JSON.stringify(payload),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      var responseText = await response.text();
      var result;
      try { result = JSON.parse(responseText); }
      catch (error) { throw new Error('雲端程式回應格式不正確。'); }
      if (response.status === 401 && result && result.signInUrl) {
        openSignInAtTop(result.signInUrl);
        return;
      }
      if (!response.ok || !result || !result.ok) throw new Error((result && result.error) || 'Google Sheet 更新失敗。');

      setStatus('更新成功：' + (result.rows || parsedWorkbook.rows) + ' 列 × ' + (result.columns || parsedWorkbook.columns) + ' 欄。正在重新載入查詢資料…', 'success');
      var loadButton = document.getElementById('loadBtn');
      if (loadButton) setTimeout(function () { loadButton.click(); }, 900);
    } catch (error) {
      var message = error && error.name === 'AbortError' ? '更新逾時，請稍後確認 Google Sheet 狀態。' : (error && error.message ? error.message : 'Google Sheet 更新失敗。');
      setStatus(message, 'error');
    } finally {
      clearTimeout(timer);
      uploading = false;
      submitButton.textContent = '確認更新';
      updateSubmitState();
    }
  }

  button.addEventListener('click', chooseFile);
  changeButton.addEventListener('click', chooseFile);
  fileInput.addEventListener('change', function () {
    handleSelectedFile(fileInput.files && fileInput.files[0]);
  });
  submitButton.addEventListener('click', uploadWorkbook);
  if (switchAccountButton) {
    switchAccountButton.addEventListener('click', function () {
      if (uploading) return;
      openSignInAtTop('/signout-with-chatgpt?return_to=%2F%23nail-system');
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-nail-upload-close]'), function (closeButton) {
    closeButton.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.hidden) closeModal();
  });
})();
