(function () {
  'use strict';
  var remote = /\.github\.io$/i.test(location.hostname) ? 'https://engineering-records-api.janyu056.workers.dev' : '';
  var api = remote + '/api/engineering-records-d1';
  var driveApi = remote + '/api/engineering-records-drive';
  var clientId = '406267166897-8geeu3tpc425nc9n7gmimmmflbckp0ta.apps.googleusercontent.com';
  var byId = function (id) { return document.getElementById('d1Records' + id); };
  var query = byId('Query'), reload = byId('Reload'), gemini = byId('Gemini');
  var folders = byId('Folders'), status = byId('Status'), list = byId('List');
  var resultsTab = byId('ResultsTab'), summaryTab = byId('SummaryTab');
  var resultsView = byId('ResultsView'), summaryView = byId('SummaryView'), summary = byId('Summary');
  var dialog = byId('Dialog'), preview = byId('Preview'), previewTitle = byId('PreviewTitle');
  var previewMeta = byId('PreviewMeta'), googleButton = byId('GoogleButton');
  var includedFolders = [], folderPaths = null, imageCache = {}, saveAfterLogin = false;
  var excludeDialog = byId('SettingsDialog'), excludeInput = byId('SettingsInput');
  var excludeSave = byId('SettingsSave'), excludeError = byId('SettingsError');
  var excludeSuggestions = byId('SettingsSuggestions'), settingsSignIn = byId('SettingsGoogleButton');
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
      setStatus('輸入關鍵字即可搜尋。', 'success');
      return;
    }
    setStatus('正在搜尋工程紀錄…', 'loading');
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
      renderMarkdown(result.record.content, record.id, preview);
    } catch (error) { previewMeta.textContent = ''; preview.textContent = error.message; }
  }
  async function refresh(force) {
    reload.disabled = true;
    if (force) setStatus('正在比對 Google Drive，更新工程紀錄…', 'loading');
    try {
      var result;
      // Continue resumable Cloudflare sync batches until all full texts are present.
      do {
        result = await call(api, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'refresh', force: force }) });
        if (result.syncing && !result.busy) {
          setStatus('正在更新工程紀錄，剩餘 ' + result.remaining + ' 篇…', 'loading');
          await new Promise(function (resolve) { setTimeout(resolve, 1000); });
        }
      } while (result.syncing && !result.busy);
      includedFolders = normalizeFolders(result.includedFolders);
      folders.textContent = '搜尋資料夾（' + (result.includedFolders.length || '全部') + '）';
      if (result.busy) setStatus('另一台電腦正在同步；稍後再按重新載入。');
      else if (result.skipped) setStatus('工程紀錄已是最近同步的版本，共 ' + result.total + ' 篇。', 'success');
      else setStatus('工程紀錄已同步，共 ' + result.total + ' 篇；更新 ' + result.changed + ' 篇，移除 ' + (result.removed || 0) + ' 篇。', 'success');
      if (query.value.trim()) search();
    } catch (error) { setStatus('工程紀錄仍可搜尋；Drive 同步失敗：' + error.message, 'error'); }
    finally { reload.disabled = false; }
  }
  window.activateEngineeringRecordsD1 = async function () {
    if (started) return;
    started = true;
    reload.disabled = true;
    setStatus('正在準備工程紀錄…', 'loading');
    try {
      var result = await call(api + '?action=status');
      includedFolders = normalizeFolders(result.includedFolders);
      folders.textContent = '搜尋資料夾（' + (result.includedFolders.length || '全部') + '）';
      setStatus('已載入 ' + result.total + ' 篇；輸入關鍵字即可搜尋。', 'success');
      if (query.value.trim()) search();
      refresh(false);
    } catch (error) { reload.disabled = false; setStatus('工程紀錄載入失敗：' + error.message, 'error'); }
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
  folders.onclick = showExcludeSettings;
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
      settingsSignIn.replaceChildren();
      if (saveAfterLogin) { saveAfterLogin = false; saveExcludeSettings(); }
      if (signInPending) { signInPending = false; summarize(); }
    } });
    google.accounts.id.renderButton(settingsSignIn, { type: 'standard', theme: 'outline', size: 'medium', locale: 'zh_TW' });
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

  function request(payload) {
    return call(driveApi, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
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
      await request({ action: 'engineeringRecords.settings.get' }).then(function (result) { includedFolders = normalizeFolders(result.includedFolders); });
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

  }

  async function saveExcludeSettings() {
    var next = normalizeFolders(excludeInput.value.split('\n'));
    if (next.length > 30 || next.some(function (value) { return value.length > 120; })) {
      excludeError.textContent = '最多 30 個資料夾，每行最多 120 個字。';
      return;
    }
    if (!credentialValid()) {
      saveAfterLogin = true;
      excludeError.textContent = '請先使用允許的 Google 帳號登入，再儲存共用設定。';
      loadGoogle();
      return;
    }
    excludeSave.disabled = true;
    excludeError.textContent = '';
    try {
      var response = await request({ action: 'engineeringRecords.settings.save', includedFolders: next, idToken: token });
      includedFolders = normalizeFolders(response.includedFolders);
      folders.textContent = '搜尋資料夾（' + (includedFolders.length || '全部') + '）';
      excludeDialog.close();
      await refresh(true);
    } catch (error) {
      excludeError.textContent = error && error.message || '無法儲存共用設定。';
    } finally {
      excludeSave.disabled = false;
    }
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

  function renderMarkdown(value, recordId, target) {
    target = target || preview;
    target.replaceChildren();
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
    target.appendChild(fragment);
  }

  excludeInput.addEventListener('input', function () {
    var selected = normalizeFolders(excludeInput.value.split('\n'));
    excludeSuggestions.querySelectorAll('input').forEach(function (box) { box.checked = selected.indexOf(box.value) >= 0; });
  });
  excludeSave.onclick = saveExcludeSettings;
  byId('SettingsCancel').onclick = function () { saveAfterLogin = false; excludeDialog.close(); };
  dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
  gemini.onclick = summarize;
})();
