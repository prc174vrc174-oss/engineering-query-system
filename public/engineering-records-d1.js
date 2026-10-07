(function () {
  'use strict';
  var remote = /\.github\.io$/i.test(location.hostname) ? 'https://engineering-query.prc174.chatgpt.site' : '';
  var api = remote + '/api/engineering-records-d1';
  var driveApi = remote + '/api/engineering-records';
  var clientId = '406267166897-8geeu3tpc425nc9n7gmimmmflbckp0ta.apps.googleusercontent.com';
  var byId = function (id) { return document.getElementById('d1Records' + id); };
  var query = byId('Query'), reload = byId('Reload'), gemini = byId('Gemini');
  var folders = byId('Folders'), status = byId('Status'), list = byId('List');
  var resultsTab = byId('ResultsTab'), summaryTab = byId('SummaryTab');
  var resultsView = byId('ResultsView'), summaryView = byId('SummaryView'), summary = byId('Summary');
  var dialog = byId('Dialog'), preview = byId('Preview'), previewTitle = byId('PreviewTitle');
  var previewMeta = byId('PreviewMeta'), googleButton = byId('GoogleButton');
  var started = false, rows = [], resultVersion = 0, timer = 0, token = '', signInPending = false;
  if (!query) return;

  function setStatus(message, state) {
    status.textContent = message;
    status.className = 'engineering-records-status' + (state ? ' is-' + state : '');
  }
  async function call(url, options) {
    var response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
    var value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error || '資料庫暫時無法使用。');
    return value;
  }
  function view(name) {
    var showingSummary = name === 'summary';
    resultsView.hidden = showingSummary;
    summaryView.hidden = !showingSummary;
    resultsTab.setAttribute('aria-selected', String(!showingSummary));
    summaryTab.setAttribute('aria-selected', String(showingSummary));
  }
  function date(value) {
    if (!value || isNaN(Date.parse(value))) return '';
    return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }
  function render() {
    list.replaceChildren();
    gemini.disabled = !rows.length;
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'engineering-records-empty';
      empty.textContent = '沒有找到符合的工程紀錄。';
      list.appendChild(empty);
      return;
    }
    var items = document.createElement('ul');
    items.className = 'engineering-records-items';
    rows.forEach(function (record, index) {
      var item = document.createElement('li');
      item.className = 'engineering-record-item';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = index < 20;
      checkbox.value = record.id;
      checkbox.setAttribute('aria-label', '選取 ' + record.name + ' 供 Gemini 摘要');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'engineering-record-open';
      button.textContent = record.name.replace(/\.md$/i, '');
      button.onclick = function () { openRecord(record); };
      item.append(checkbox, button);
      items.appendChild(item);
    });
    list.appendChild(items);
  }
  async function search() {
    var value = query.value.trim(), version = ++resultVersion;
    view('results');
    if (!value) {
      rows = [];
      list.innerHTML = '<div class="engineering-records-empty">輸入關鍵字即可搜尋。</div>';
      gemini.disabled = true;
      setStatus('已連接 D1；輸入關鍵字即可搜尋。', 'success');
      return;
    }
    setStatus('正在搜尋 D1…', 'loading');
    try {
      var result = await call(api + '?action=search&query=' + encodeURIComponent(value));
      if (version !== resultVersion) return;
      rows = result.results || [];
      rows.sort(function (a, b) { return b.name.localeCompare(a.name, 'zh-TW', { numeric: true, sensitivity: 'base' }); });
      render();
      setStatus('找到 ' + rows.length + ' 筆工程紀錄。', 'success');
    } catch (error) {
      if (version !== resultVersion) return;
      setStatus('搜尋失敗：' + error.message, 'error');
    }
  }
  async function openRecord(record) {
    dialog.showModal();
    previewTitle.textContent = record.name;
    previewMeta.textContent = '讀取中…';
    preview.textContent = '';
    try {
      var result = await call(api + '?action=read&id=' + encodeURIComponent(record.id));
      if (!dialog.open || previewTitle.textContent !== record.name) return;
      previewMeta.textContent = result.record.relativePath + ' · 更新 ' + date(result.record.modifiedTime);
      if (window.renderEngineeringRecordsMarkdown) window.renderEngineeringRecordsMarkdown(result.record.content, record.id, preview);
      else preview.textContent = result.record.content;
    } catch (error) { previewMeta.textContent = ''; preview.textContent = error.message; }
  }
  async function refresh(force) {
    reload.disabled = true;
    if (force) setStatus('正在比對 Google Drive，更新 D1…', 'loading');
    try {
      var result = await call(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', force: force }) });
      folders.textContent = '搜尋資料夾（' + (result.includedFolders.length || '全部') + '）';
      if (result.busy) setStatus('另一台電腦正在同步；稍後再按重新載入。');
      else if (result.skipped) setStatus('D1 已是最近同步的版本，共 ' + result.total + ' 篇。', 'success');
      else setStatus('D1 已同步，共 ' + result.total + ' 篇；更新 ' + result.changed + ' 篇，移除 ' + (result.removed || 0) + ' 篇。', 'success');
      if (query.value.trim()) search();
    } catch (error) { setStatus('D1 仍可搜尋；Drive 同步失敗：' + error.message, 'error'); }
    finally { reload.disabled = false; }
  }
  window.activateEngineeringRecordsD1 = async function () {
    if (started) return;
    started = true;
    reload.disabled = true;
    setStatus('正在連接 D1 並準備工程紀錄…', 'loading');
    try {
      var result = await call(api + '?action=status');
      folders.textContent = '搜尋資料夾（' + (result.includedFolders.length || '全部') + '）';
      setStatus('D1 已載入 ' + result.total + ' 篇；輸入關鍵字即可搜尋。', 'success');
      if (query.value.trim()) search();
      refresh(false);
    } catch (error) { reload.disabled = false; setStatus('D1 載入失敗：' + error.message, 'error'); }
  };
  query.addEventListener('input', function () {
    clearTimeout(timer);
    if (!query.value.trim()) search();
    else timer = setTimeout(search, 180);
  });
  query.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); clearTimeout(timer); search(); }
  });
  reload.onclick = function () { refresh(true); };
  folders.onclick = function () {
    var original = document.querySelector('.tab-btn[data-sys="engineering-records"]');
    original.click();
    document.getElementById('engineeringRecordsExcludeBtn').click();
  };
  resultsTab.onclick = function () { view('results'); };
  summaryTab.onclick = function () { view('summary'); };
  byId('DialogClose').onclick = function () { dialog.close(); };

  function credentialValid() {
    try { return !!token && JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000 > Date.now() + 30000; }
    catch (error) { return false; }
  }
  function loadGoogle() {
    if (window.google && google.accounts && google.accounts.id) { showGoogleButton(); return; }
    var script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = showGoogleButton;
    script.onerror = function () { setStatus('無法載入 Google 登入。', 'error'); };
    document.head.appendChild(script);
  }
  function showGoogleButton() {
    google.accounts.id.initialize({ client_id: clientId, callback: function (response) {
      token = response.credential || '';
      googleButton.replaceChildren();
      if (signInPending) { signInPending = false; summarize(); }
    } });
    google.accounts.id.renderButton(googleButton, { type: 'standard', theme: 'outline', size: 'medium', text: 'signin_with', locale: 'zh_TW' });
  }
  async function summarize() {
    var ids = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(function (box) { return box.value; }).slice(0, 20);
    if (!ids.length) { setStatus('請至少勾選一筆工程紀錄。', 'error'); return; }
    view('summary');
    if (!credentialValid()) {
      signInPending = true;
      summary.textContent = '請先使用允許的 Google 帳號登入；登入後會自動產生摘要。';
      loadGoogle();
      return;
    }
    gemini.disabled = true;
    summary.textContent = 'Gemini 正在產生摘要…';
    setStatus('Gemini 正在整理 ' + ids.length + ' 篇…', 'loading');
    try {
      var result = await call(driveApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'engineeringRecords.summarize', query: query.value.trim(), ids: ids, idToken: token }) });
      summary.textContent = result.summary || '';
      setStatus('Gemini 摘要完成。', 'success');
    } catch (error) { summary.textContent = error.message; setStatus('摘要失敗：' + error.message, 'error'); }
    finally { gemini.disabled = !rows.length; }
  }
  gemini.onclick = summarize;
})();
