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
  var excludeButton = document.getElementById('engineeringRecordsExcludeBtn');
  var excludeDialog = document.getElementById('engineeringRecordsExcludeDialog');
  var excludeInput = document.getElementById('engineeringRecordsExcludeInput');
  var excludeSave = document.getElementById('engineeringRecordsExcludeSave');
  var excludeCancel = document.getElementById('engineeringRecordsExcludeCancel');
  var excludeError = document.getElementById('engineeringRecordsExcludeError');
  var excludeSuggestions = document.getElementById('engineeringRecordsExcludeSuggestions');
  var status = document.getElementById('engineeringRecordsStatus');
  var list = document.getElementById('engineeringRecordsList');
  var previewTitle = document.getElementById('engineeringRecordsPreviewTitle');
  var previewMeta = document.getElementById('engineeringRecordsPreviewMeta');
  var preview = document.getElementById('engineeringRecordsPreview');
  var signIn = document.getElementById('engineeringRecordsGoogleButton');
  var settingsSignIn = document.getElementById('engineeringRecordsSettingsGoogleButton');
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
  var saveAfterLogin = false;
  var imageCache = {};
  var includedFolders = [];
  var settingsLoaded = false;
  var settingsLoading = null;
  var folderPaths = null;
  var searchVersion = 0;

  if (!queryInput || !searchButton || !summaryButton || !list || !preview) return;

  function normalizeFolders(value) {
    var unique = {};
    return (Array.isArray(value) ? value : []).map(function (item) {
      return String(item || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    }).filter(function (item) {
      if (!item || unique[item.toLowerCase()]) return false;
      unique[item.toLowerCase()] = true;
      return true;
    });
  }

  function updateExcludeButton() {
    excludeButton.textContent = '搜尋資料夾' + (includedFolders.length ? '（' + includedFolders.length + '）' : '（全部）');
  }

  updateExcludeButton();

  function loadSharedSettings(force) {
    if (settingsLoading) return settingsLoading;
    if (settingsLoaded && !force) return Promise.resolve();
    settingsLoading = request({ action: 'engineeringRecords.settings.get' }).then(function (response) {
      includedFolders = normalizeFolders(response.includedFolders);
      settingsLoaded = true;
      updateExcludeButton();
    }).finally(function () { settingsLoading = null; });
    return settingsLoading;
  }

  loadSharedSettings().catch(function () { setStatus('無法載入共用搜尋資料夾設定，請重新整理頁面。', 'error'); });

  function renderFolderOptions() {
    excludeSuggestions.replaceChildren();
    var selected = normalizeFolders(excludeInput.value.split('\n'));
    var names = (folderPaths || []).concat(selected.filter(function (name) {
      return !folderPaths || folderPaths.indexOf(name) < 0;
    }));
    if (!names.length) {
      excludeSuggestions.textContent = '此資料夾下沒有可選的子資料夾。';
      return;
    }
    names.forEach(function (name) {
      var label = document.createElement('label');
      label.className = 'engineering-records-folder-option';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = selected.indexOf(name) >= 0;
      checkbox.addEventListener('change', function () {
        var values = normalizeFolders(excludeInput.value.split('\n'));
        values = values.filter(function (value) { return value !== name; });
        if (checkbox.checked) values.push(name);
        excludeInput.value = values.join('\n');
      });
      var title = document.createElement('span');
      title.textContent = name;
      label.appendChild(checkbox);
      label.appendChild(title);
      excludeSuggestions.appendChild(label);
    });
  }

  async function showExcludeSettings() {
    excludeSave.disabled = true;
    excludeError.textContent = '';
    excludeSuggestions.textContent = '正在載入共用設定與資料夾…';
    excludeDialog.showModal();
    try {
      await loadSharedSettings(true);
      if (!excludeDialog.open) return;
      excludeInput.value = includedFolders.join('\n');
      excludeSave.disabled = false;
      if (!folderPaths) {
        excludeSuggestions.textContent = '正在載入資料夾…';
        var response = await request({ action: 'engineeringRecords.folders' });
        folderPaths = Array.isArray(response.folders) ? response.folders.filter(function (path) {
          return !String(path).split('/').some(function (part) { return part.charAt(0) === '.'; });
        }) : [];
      }
      if (excludeDialog.open) renderFolderOptions();
    } catch (error) {
      if (excludeDialog.open) {
        excludeSuggestions.textContent = '無法載入資料夾，請稍後再試。';
        excludeError.textContent = error && error.message || '無法取得共用設定。';
      }
    }
    loadIdentity().catch(function (error) {
      if (excludeDialog.open) excludeError.textContent = error.message || '無法載入 Google 登入。';
    });
  }

  async function saveExcludeSettings() {
    var next = normalizeFolders(excludeInput.value.split('\n'));
    if (next.length > 30 || next.some(function (value) { return value.length > 120; })) {
      excludeError.textContent = '最多 30 個資料夾，每行最多 120 個字。';
      return;
    }
    if (!hasCredential()) {
      saveAfterLogin = true;
      excludeError.textContent = '請先使用允許的 Google 帳號登入，再儲存共用設定。';
      loadIdentity().catch(function (error) { excludeError.textContent = error.message || '無法載入 Google 登入。'; });
      return;
    }
    excludeSave.disabled = true;
    excludeError.textContent = '';
    try {
      var response = await request({ action: 'engineeringRecords.settings.save', includedFolders: next, idToken: idToken });
      includedFolders = normalizeFolders(response.includedFolders);
      updateExcludeButton();
      excludeDialog.close();
      if (queryInput.value.trim()) search();
      else setStatus(includedFolders.length ? '已共用 ' + includedFolders.length + ' 個搜尋資料夾。' : '已共用搜尋全部資料夾的設定。', 'success');
    } catch (error) {
      excludeError.textContent = error && error.message || '無法儲存共用設定。';
    } finally {
      excludeSave.disabled = false;
    }
  }

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

  function appendImage(parent, label, source, recordId) {
    var figure = document.createElement('figure');
    figure.className = 'engineering-markdown-image';
    var img = document.createElement('img');
    img.alt = label || '工程紀錄圖片';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    var hint = document.createElement('figcaption');
    hint.textContent = '圖片載入中…';
    figure.appendChild(img);
    figure.appendChild(hint);
    parent.appendChild(figure);
    img.onload = function () { hint.remove(); };
    img.onerror = function () { img.remove(); hint.textContent = '圖片無法預覽：' + (label || source); };
    var url;
    try { url = new URL(source, window.location.href); } catch { url = null; }
    if (url && /^https?:\/\//.test(source) && /^https?:$/.test(url.protocol)) {
      img.src = url.href;
      return;
    }
    var key = recordId + '/' + source;
    if (!imageCache[key]) imageCache[key] = request({ action: 'engineeringRecords.image', id: recordId, name: source })
      .then(function (result) { return result.image && result.image.dataUrl; });
    imageCache[key].then(function (dataUrl) {
      if (dataUrl && /^data:image\/(png|jpeg|gif|webp);base64,/.test(dataUrl)) img.src = dataUrl;
      else throw new Error('圖片格式不支援。');
    }).catch(function () { img.remove(); hint.textContent = '圖片無法預覽：' + (label || source); delete imageCache[key]; });
  }

  function appendInline(parent, value, recordId) {
    var tokens = /(!?\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`|(?:^|\s)#[^\s#]+)/g;
    var offset = 0;
    var match;
    while ((match = tokens.exec(value))) {
      parent.appendChild(document.createTextNode(value.slice(offset, match.index)));
      var token = match[0];
      var element;
      if (token.indexOf('[[') !== -1) {
        element = document.createElement('span');
        element.className = 'engineering-markdown-link';
        var target = token.slice(token.indexOf('[[') + 2, -2);
        if (token[0] === '!' && /\.(png|jpe?g|gif|webp)(?:\|.*)?$/i.test(target)) {
          appendImage(parent, target.split('|')[0].split('/').pop(), target.split('|')[0], recordId);
          offset = match.index + token.length;
          continue;
        }
        element.textContent = target.split('|').pop();
        element.title = target.split('|')[0];
      } else if (/^!?\[/.test(token)) {
        var link = /^!?\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
        if (token[0] === '!') {
          appendImage(parent, link[1], link[2], recordId);
          offset = match.index + token.length;
          continue;
        }
        var url;
        try { url = new URL(link[2], window.location.href); } catch { url = null; }
        if (url && /^https?:$/.test(url.protocol)) {
          element = document.createElement('a');
          element.href = url.href;
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        } else {
          element = document.createElement('span');
          element.className = 'engineering-markdown-link';
        }
        element.textContent = link[1];
      } else if (token.slice(0, 2) === '**') {
        element = document.createElement('strong');
        element.textContent = token.slice(2, -2);
      } else if (token[0] === '`') {
        element = document.createElement('code');
        element.textContent = token.slice(1, -1);
      } else {
        if (/^\s/.test(token)) parent.appendChild(document.createTextNode(token[0]));
        element = document.createElement('span');
        element.className = 'engineering-markdown-tag';
        element.textContent = token.trim();
      }
      parent.appendChild(element);
      offset = match.index + token.length;
    }
    parent.appendChild(document.createTextNode(value.slice(offset)));
  }

  function renderMarkdown(value, recordId) {
    preview.replaceChildren();
    var lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    var fragment = document.createDocumentFragment();
    var listStack = [];
    var paragraph = null;
    var code = null;
    var quote = null;
    var start = lines[0] === '---' ? Math.max(0, lines.indexOf('---', 1) + 1) : 0;
    for (var i = start; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        if (code) { code = null; } else {
          code = document.createElement('code');
          var block = document.createElement('pre');
          block.appendChild(code);
          fragment.appendChild(block);
        }
        paragraph = null; listStack = []; quote = null;
        continue;
      }
      if (code) { code.textContent += (code.textContent ? '\n' : '') + line; continue; }
      if (!trimmed) { paragraph = null; listStack = []; quote = null; continue; }
      var heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      var bullet = /^(\s*)([-*+] |\d+\. )(.+)$/.exec(line.replace(/\t/g, '    '));
      var element;
      if (heading) {
        element = document.createElement('h' + Math.min(heading[1].length + 1, 6));
        appendInline(element, heading[2], recordId);
        fragment.appendChild(element);
        paragraph = null; listStack = []; quote = null;
      } else if (bullet) {
        var indent = bullet[1].length;
        var type = /^\d/.test(bullet[2]) ? 'ol' : 'ul';
        while (listStack.length && (listStack[listStack.length - 1].indent > indent ||
          (listStack[listStack.length - 1].indent === indent && listStack[listStack.length - 1].type !== type))) listStack.pop();
        if (!listStack.length || listStack[listStack.length - 1].indent < indent) {
          var newList = document.createElement(type);
          var parent = listStack.length ? listStack[listStack.length - 1].lastItem : fragment;
          parent.appendChild(newList);
          listStack.push({ indent: indent, type: type, list: newList, lastItem: null });
        }
        element = document.createElement('li');
        var content = bullet[3].replace(/^\[[ xX]\]\s*/, '');
        appendInline(element, content, recordId);
        listStack[listStack.length - 1].list.appendChild(element);
        listStack[listStack.length - 1].lastItem = element;
        paragraph = null; quote = null;
      } else if (/^>\s?/.test(trimmed)) {
        if (!quote) { quote = document.createElement('blockquote'); fragment.appendChild(quote); }
        element = document.createElement('p');
        appendInline(element, trimmed.replace(/^>\s?/, ''), recordId);
        quote.appendChild(element);
        paragraph = null; listStack = [];
      } else if (/^([-*_])\1{2,}$/.test(trimmed)) {
        fragment.appendChild(document.createElement('hr'));
        paragraph = null; listStack = []; quote = null;
      } else {
        if (!paragraph) { paragraph = document.createElement('p'); fragment.appendChild(paragraph); }
        else paragraph.appendChild(document.createElement('br'));
        appendInline(paragraph, trimmed, recordId);
        listStack = []; quote = null;
      }
    }
    preview.appendChild(fragment);
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
    var items = document.createElement('ul');
    items.className = 'engineering-records-items';
    results.forEach(function (record, index) {
      var item = document.createElement('li');
      item.className = 'engineering-record-item';
      item.dataset.recordId = record.id;
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = index < 20;
      checkbox.value = record.id;
      checkbox.setAttribute('data-record-select', '');
      checkbox.setAttribute('aria-label', '選取 ' + record.name + ' 供 AI 摘要');
      var body = document.createElement('button');
      body.type = 'button';
      body.className = 'engineering-record-open';
      var icon = document.createElement('span');
      icon.className = 'engineering-record-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = record.name.indexOf('📣') !== -1 ? '📣' : '💬';
      var title = document.createElement('span');
      title.textContent = record.name.replace(/\.md$/i, '').replace(/[📣💬]/gu, '');
      body.appendChild(icon);
      body.appendChild(title);
      body.addEventListener('click', function () { openRecord(record); });
      item.appendChild(checkbox);
      item.appendChild(body);
      items.appendChild(item);
    });
    list.appendChild(items);
    summaryButton.disabled = false;
  }

  async function search() {
    var query = queryInput.value.trim();
    if (!query) { queryInput.focus(); setStatus('請輸入客戶編號、名稱或工程關鍵字。', 'error'); return; }
    var version = ++searchVersion;
    showView('results', false);
    summaryMeta.textContent = '';
    summary.textContent = '勾選搜尋結果後，按「Gemini 摘要」開始整理。';
    searchButton.disabled = true;
    summaryButton.disabled = true;
    setStatus('正在搜尋 Google Drive…', 'loading');
    list.innerHTML = '<div class="engineering-records-empty">搜尋中…</div>';
    try {
      var result = await request({ action: 'engineeringRecords.search', query: query });
      if (version !== searchVersion) return;
      includedFolders = normalizeFolders(result.includedFolders);
      updateExcludeButton();
      results = Array.isArray(result.results) ? result.results : [];
      results.sort(function (a, b) {
        return String(b.name || '').localeCompare(String(a.name || ''), 'zh-TW', { numeric: true, sensitivity: 'base' });
      });
      renderResults();
      setStatus('找到 ' + results.length + ' 筆工程紀錄' + (includedFolders.length ? '（僅搜尋 ' + includedFolders.length + ' 個資料夾）' : '') + '。', 'success');

    } catch (error) {
      if (version !== searchVersion) return;
      results = [];
      renderResults();
      setStatus(error && error.message ? error.message : '搜尋失敗。', 'error');
    } finally {
      if (version === searchVersion) searchButton.disabled = false;
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
      renderMarkdown(data.content || '', record.id);
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
    settingsSignIn.innerHTML = '';
    setStatus('已登入 ' + identity.email + '。', 'success');
    if (saveAfterLogin) {
      saveAfterLogin = false;
      if (excludeDialog.open) saveExcludeSettings();
    }
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
    settingsSignIn.innerHTML = '';
    window.google.accounts.id.renderButton(settingsSignIn, {
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
    searchVersion++;
    searchButton.disabled = false;
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
  excludeButton.addEventListener('click', showExcludeSettings);
  excludeInput.addEventListener('input', function () {
    excludeSuggestions.querySelectorAll('input[type="checkbox"]').forEach(function (checkbox) {
      checkbox.checked = normalizeFolders(excludeInput.value.split('\n')).indexOf(checkbox.value) >= 0;
    });
  });
  excludeSave.addEventListener('click', saveExcludeSettings);
  excludeCancel.addEventListener('click', function () { saveAfterLogin = false; excludeDialog.close(); });
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
