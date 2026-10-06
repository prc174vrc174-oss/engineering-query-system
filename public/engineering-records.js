(function () {
  'use strict';

  var API_URL = /\.github\.io$/i.test(window.location.hostname)
    ? 'https://engineering-query.prc174.chatgpt.site/api/engineering-records'
    : '/api/engineering-records';
  var GOOGLE_CLIENT_ID = '406267166897-8geeu3tpc425nc9n7gmimmmflbckp0ta.apps.googleusercontent.com';
  var queryInput = document.getElementById('engineeringRecordsQuery');
  var searchButton = document.getElementById('engineeringRecordsSearchBtn');
  var summaryButton = document.getElementById('engineeringRecordsSummaryBtn');
  var clearButton = document.getElementById('engineeringRecordsClearBtn');
  var status = document.getElementById('engineeringRecordsStatus');
  var list = document.getElementById('engineeringRecordsList');
  var previewTitle = document.getElementById('engineeringRecordsPreviewTitle');
  var previewMeta = document.getElementById('engineeringRecordsPreviewMeta');
  var preview = document.getElementById('engineeringRecordsPreview');
  var signIn = document.getElementById('engineeringRecordsGoogleButton');
  var dialog = document.getElementById('engineeringRecordsDialog');
  var closeDialog = document.getElementById('engineeringRecordsDialogClose');
  var summary = document.getElementById('engineeringRecordsSummary');
  var summaryMeta = document.getElementById('engineeringRecordsSummaryMeta');
  var resultsTab = document.getElementById('engineeringRecordsResultsTab');
  var summaryTab = document.getElementById('engineeringRecordsSummaryTab');
  var resultsView = document.getElementById('engineeringRecordsResultsView');
  var summaryView = document.getElementById('engineeringRecordsSummaryView');
  var activeRecordId = '';
  var summarizing = false;
  var results = [];
  var idToken = '';
  var identityLoading = null;
  var summarizeAfterLogin = false;

  if (!queryInput || !searchButton || !summaryButton || !list || !preview) return;

  function showView(name, focus) {
    var isSummary = name === 'summary';
    resultsView.hidden = isSummary;
    summaryView.hidden = !isSummary;
    resultsTab.setAttribute('aria-selected', String(!isSummary));
    summaryTab.setAttribute('aria-selected', String(isSummary));
    resultsTab.tabIndex = isSummary ? -1 : 0;
    summaryTab.tabIndex = isSummary ? 0 : -1;
    if (focus) (isSummary ? summaryTab : resultsTab).focus();
  }

  function setStatus(message, state) {
    status.textContent = message || '';
    status.className = 'engineering-records-status' + (state ? ' is-' + state : '');
  }

  async function request(payload) {
    var response = await fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });
    var result;
    try { result = await response.json(); } catch { throw new Error('伺服器回應格式不正確。'); }
    if (!response.ok || !result || !result.ok) throw new Error(result && result.error || '工程紀錄查詢失敗。');
    return result;
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  function selectedIds() {
    return Array.prototype.slice.call(list.querySelectorAll('input[data-record-select]:checked'))
      .map(function (checkbox) { return checkbox.value; }).slice(0, 20);
  }

  function renderResults() {
    list.innerHTML = '';
    if (!results.length) {
      list.innerHTML = '<div class="engineering-records-empty">沒有找到符合的 Markdown 工程紀錄。</div>';
      summaryButton.disabled = true;
      return;
    }
    var table = document.createElement('table');
    table.className = 'engineering-records-table';
    table.innerHTML = '<thead><tr><th scope="col" aria-label="選取摘要">選取</th><th scope="col">檔名</th></tr></thead><tbody></tbody>';
    var tbody = table.querySelector('tbody');
    results.forEach(function (record, index) {
      var item = document.createElement('tr');
      item.className = 'engineering-record-item';
      item.dataset.recordId = record.id;
      var selectCell = document.createElement('td');
      var nameCell = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = index < 20;
      checkbox.value = record.id;
      checkbox.setAttribute('data-record-select', '');
      checkbox.setAttribute('aria-label', '選取 ' + record.name + ' 供 AI 摘要');
      var body = document.createElement('button');
      body.type = 'button';
      body.className = 'engineering-record-open';
      body.textContent = record.name;
      body.addEventListener('click', function () { openRecord(record); });
      selectCell.appendChild(checkbox);
      nameCell.appendChild(body);
      item.appendChild(selectCell);
      item.appendChild(nameCell);
      tbody.appendChild(item);
    });
    list.appendChild(table);
    summaryButton.disabled = false;
  }

  async function search() {
    var query = queryInput.value.trim();
    if (!query) { queryInput.focus(); setStatus('請輸入客戶編號、名稱或工程關鍵字。', 'error'); return; }
    showView('results', false);
    searchButton.disabled = true;
    summaryButton.disabled = true;
    setStatus('正在搜尋 Google Drive…', 'loading');
    list.innerHTML = '<div class="engineering-records-empty">搜尋中…</div>';
    try {
      var result = await request({ action: 'engineeringRecords.search', query: query });
      results = Array.isArray(result.results) ? result.results : [];
      renderResults();
      setStatus('找到 ' + results.length + ' 筆工程紀錄。', 'success');

    } catch (error) {
      results = [];
      renderResults();
      setStatus(error && error.message ? error.message : '搜尋失敗。', 'error');
    } finally {
      searchButton.disabled = false;
    }
  }

  async function openRecord(record) {
    activeRecordId = record.id;
    if (!dialog.open) dialog.showModal();
    Array.prototype.forEach.call(list.querySelectorAll('.engineering-record-item'), function (item) {
      item.classList.toggle('is-active', item.dataset.recordId === record.id);
    });
    previewTitle.textContent = record.name;
    previewMeta.textContent = '讀取中…';
    preview.textContent = '';
    try {
      var result = await request({ action: 'engineeringRecords.read', id: record.id });
      if (activeRecordId !== record.id) return;
      var data = result.record || {};
      previewTitle.textContent = data.name || record.name;
      previewMeta.textContent = (data.relativePath || record.relativePath || '') + ' · 更新 ' + formatDate(data.modifiedTime || record.modifiedTime);
      preview.textContent = data.content || '';
    } catch (error) {
      if (activeRecordId !== record.id) return;
      previewMeta.textContent = '';
      preview.textContent = error && error.message ? error.message : '無法讀取工程紀錄。';
    }
  }

  function parseCredential(token) {
    try {
      var part = String(token || '').split('.')[1] || '';
      part = part.replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      return JSON.parse(decodeURIComponent(Array.prototype.map.call(atob(part), function (character) {
        return '%' + ('00' + character.charCodeAt(0).toString(16)).slice(-2);
      }).join('')));
    } catch { return null; }
  }

  function hasCredential() {
    var identity = parseCredential(idToken);
    return !!(identity && Number(identity.exp || 0) * 1000 > Date.now() + 30000);
  }

  function applyCredential(response) {
    idToken = response && response.credential || '';
    var identity = parseCredential(idToken);
    if (!identity || !identity.email) { setStatus('Google 登入失敗，請再試一次。', 'error'); return; }
    signIn.innerHTML = '';
    setStatus('已登入 ' + identity.email + '，可使用 Gemini 摘要。', 'success');
    if (summarizeAfterLogin) { summarizeAfterLogin = false; summarize(); }
  }

  function initializeIdentity() {
    if (!window.google || !window.google.accounts || !window.google.accounts.id) throw new Error('Google 登入程式尚未載入。');
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: applyCredential,
      auto_select: false,
      cancel_on_tap_outside: false
    });
    signIn.innerHTML = '';
    window.google.accounts.id.renderButton(signIn, {
      type: 'standard', theme: 'outline', size: 'medium', text: 'signin_with', shape: 'rectangular', width: 230, locale: 'zh_TW'
    });
  }

  function loadIdentity() {
    if (window.google && window.google.accounts && window.google.accounts.id) { initializeIdentity(); return Promise.resolve(); }
    if (identityLoading) return identityLoading;
    identityLoading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = function () { try { initializeIdentity(); resolve(); } catch (error) { reject(error); } };
      script.onerror = function () { reject(new Error('無法載入 Google 登入程式。')); };
      document.head.appendChild(script);
    });
    return identityLoading;
  }

  async function summarize() {
    if (summarizing) return;
    var ids = selectedIds();
    if (!ids.length) { setStatus('請至少勾選一筆工程紀錄。', 'error'); return; }
    showView('summary', true);
    if (!hasCredential()) {
      summaryMeta.textContent = '請先以允許的 Google 帳號登入。';
      summary.textContent = '登入後將自動產生勾選紀錄的摘要。';
      summarizeAfterLogin = true;
      setStatus('AI 摘要會使用 Gemini API，請先以允許的 Google 帳號登入。');
      loadIdentity().catch(function (error) { setStatus(error.message || '無法載入 Google 登入。', 'error'); });
      return;
    }
    summarizing = true;
    searchButton.disabled = true;
    clearButton.disabled = true;
    summaryButton.disabled = true;
    summaryMeta.textContent = '正在整理 ' + ids.length + ' 份工程紀錄…';
    summary.textContent = '';
    setStatus('Gemini 正在產生摘要…', 'loading');
    try {
      var result = await request({
        action: 'engineeringRecords.summarize', query: queryInput.value.trim(), ids: ids, idToken: idToken
      });
        summaryMeta.textContent = '根據 ' + (result.sources ? result.sources.length : ids.length) + ' 份搜尋結果整理';
      summary.textContent = result.summary || '';
      setStatus('AI 摘要完成。', 'success');
    } catch (error) {
      summaryMeta.textContent = '';
      summary.textContent = error && error.message ? error.message : 'Gemini 摘要失敗。';
      setStatus(summary.textContent, 'error');
    } finally {
      summarizing = false;
      searchButton.disabled = false;
      clearButton.disabled = false;
      summaryButton.disabled = !results.length;
    }
  }

  function clearAll() {
    summarizeAfterLogin = false;
    activeRecordId = '';
    if (dialog.open) dialog.close();
    showView('results', false);
    summaryMeta.textContent = '';
    summary.textContent = '勾選搜尋結果後，按「Gemini 摘要」開始整理。';
    queryInput.value = '';
    results = [];
    list.innerHTML = '<div class="engineering-records-empty">輸入關鍵字後開始搜尋。</div>';
    previewTitle.textContent = '內容預覽';
    previewMeta.textContent = '';
    preview.textContent = '選取檔名後，這裡會顯示完整 Markdown 內容。';
    summaryButton.disabled = true;
    setStatus('');
    queryInput.focus();
  }

  resultsTab.addEventListener('click', function () { showView('results', false); });
  summaryTab.addEventListener('click', function () { showView('summary', false); });
  [resultsTab, summaryTab].forEach(function (tab) {
    tab.addEventListener('keydown', function (event) {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
      event.preventDefault();
      showView(event.key === 'Home' ? 'results' : event.key === 'End' ? 'summary' : tab === resultsTab ? 'summary' : 'results', true);
    });
  });
  closeDialog.addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    var bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  searchButton.addEventListener('click', search);
  summaryButton.addEventListener('click', summarize);
  clearButton.addEventListener('click', clearAll);
  queryInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !searchButton.disabled) { event.preventDefault(); search(); }
  });
})();
