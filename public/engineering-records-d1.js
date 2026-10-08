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
  var includedFolders = [], folderPaths = null, imageCache = {}, summarySources = [], saveAfterLogin = false;
  var excludeDialog = byId('SettingsDialog'), excludeInput = byId('SettingsInput');
  var excludeSave = byId('SettingsSave'), excludeError = byId('SettingsError');
  var excludeSuggestions = byId('SettingsSuggestions'), settingsSignIn = byId('SettingsGoogleButton');
  var started = false, rows = [], resultVersion = 0, timer = 0, token = '', signInPending = false;
  var recordParams = window.location ? new URL(window.location.href).searchParams : null;
  var recordWindow = recordParams && (recordParams.has('recordId') || recordParams.has('recordName'));
  var activeView = 'results';
  var viewStatuses = { results: { message: '', state: '' }, summary: { message: '', state: '' } };
  if (!query) return;

  function updateFolderLabel(count) {
    var full = document.createElement('span');
    full.className = 'engineering-button-full';
    full.textContent = '搜尋資料夾（' + (count || '全部') + '）';
    var compact = document.createElement('span');
    compact.className = 'engineering-button-compact';
    compact.textContent = '資料夾' + (count ? '(' + count + ')' : '');
    folders.replaceChildren(full, compact);
  }
  function paintStatus() {
    var current = viewStatuses[activeView];
    status.textContent = current.message;
    status.className = 'engineering-records-status' + (current.state ? ' is-' + current.state : '');
  }
  function setStatus(message, state, scope) {
    scope = scope || 'results';
    viewStatuses[scope] = { message: message, state: state || '' };
    if (scope === activeView) paintStatus();
  }
  function setSummaryStatus(message, state) { setStatus(message, state, 'summary'); }
  async function call(url, options) {
    var response = await fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
    var value = await response.json();
    if (!response.ok || !value.ok) throw new Error(value.error || '資料庫暫時無法使用。');
    return value;
  }
  function view(name) {
    activeView = name === 'summary' ? 'summary' : 'results';
    paintStatus();
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
    rows.forEach(function (record) {
      var item = document.createElement('li');
      item.className = 'engineering-record-item';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
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
      previewTitle.textContent = result.record.name;
      if (recordWindow) document.title = result.record.name.replace(/\.md$/i, '') + '｜工程紀錄';
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
      updateFolderLabel(result.includedFolders.length);
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
      updateFolderLabel(result.includedFolders.length);
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
  byId('DialogClose').onclick = function () { if (recordWindow) window.close(); else dialog.close(); };

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
    var ids = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(function (box) { return box.value; });
    if (!ids.length) { setStatus('請至少勾選一筆工程紀錄。', 'error'); return; }
    view('summary');
    if (!credentialValid()) {
      signInPending = true;
      setSummaryStatus('待登入後整理 ' + ids.length + ' 篇工程紀錄。');
      summary.textContent = '請先使用允許的 Google 帳號登入；登入後會自動產生摘要。';
      loadGoogle();
      return;
    }
    gemini.disabled = true;
    summary.textContent = 'Gemini 正在產生摘要…';
    setSummaryStatus('Gemini 正在整理 ' + ids.length + ' 篇…', 'loading');
    var summaries = [], summaryQuery = query.value.trim();
    summarySources = [];
    try {
      for (var start = 0; start < ids.length; start += 20) {
        var batch = ids.slice(start, start + 20);
        setSummaryStatus('Gemini 正在整理 ' + ids.length + ' 篇（' + start + '/' + ids.length + '）…', 'loading');
        var result = await call(driveApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'engineeringRecords.summarize', query: summaryQuery, ids: batch, idToken: token }) });
        summarySources = summarySources.concat(result.sources || []);
        var heading = ids.length > 20 ? '## 工程紀錄摘要（第 ' + (start + 1) + '–' + (start + batch.length) + ' 篇）\n\n' : '';
        summaries.push(heading + (result.summary || ''));
        renderSummary(summaries.join('\n\n---\n\n'));
      }
      setSummaryStatus('Gemini 摘要完成，共整理 ' + ids.length + ' 篇。', 'success');
    } catch (error) {
      if (summaries.length) renderSummary(summaries.join('\n\n---\n\n') + '\n\n> 部分摘要尚未完成：' + error.message);
      else summary.textContent = error.message;
      setSummaryStatus('摘要尚未完成：' + error.message, 'error');
    }
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
      updateFolderLabel(includedFolders.length);
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

  function recordLinkName(value) {
    var name = String(value || '').trim();
    try { name = decodeURIComponent(name); } catch (_) {}
    return name.replace(/\\/g, '/').split('#')[0].replace(/\.md$/i, '').toLowerCase();
  }
  function findLinkedRecord(records, reference) {
    var wanted = recordLinkName(reference);
    var exact = records.find(function (record) { return recordLinkName(record.relativePath) === wanted; });
    if (exact) return exact;
    var matches = records.filter(function (record) { return recordLinkName(record.name) === wanted.split('/').pop(); });
    var ids = new Set(matches.map(function (record) { return record.id; }));
    return ids.size === 1 ? matches[0] : null;
  }
  function appendRecordLink(parent, label, reference) {
    var link = document.createElement('a');
    link.className = 'engineering-markdown-link engineering-markdown-record-link';
    link.textContent = label;
    link.title = '在新視窗開啟工程紀錄：' + reference;
    var destination = new URL('engineering-query.html', window.location.href);
    var record = findLinkedRecord(rows.concat(summarySources), reference);
    destination.searchParams.set(record ? 'recordId' : 'recordName', record ? record.id : reference);
    link.href = destination.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.onclick = function (event) {
      var display = window.screen || {};
      var availableWidth = display.availWidth || window.innerWidth || 752;
      var availableHeight = display.availHeight || window.innerHeight || 574;
      var width = Math.round(Math.min(720, Math.max(1, availableWidth - 32)));
      var height = Math.round(Math.min(510, Math.max(1, availableHeight - 64)));
      var left = (Number.isFinite(display.availLeft) ? display.availLeft : 0) + Math.round((availableWidth - width) / 2);
      var top = (Number.isFinite(display.availTop) ? display.availTop : 0) + Math.round((availableHeight - height) / 2);
      var popup = window.open(link.href, '_blank', 'popup,width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
      if (popup) { popup.opener = null; event.preventDefault(); }
    };
    parent.appendChild(link);
  }
  async function loadLinkedRecord() {
    document.documentElement.classList.add('engineering-record-window');
    dialog.showModal();
    previewTitle.textContent = '工程紀錄';
    previewMeta.textContent = '讀取中…';
    try {
      var id = recordParams.get('recordId');
      var name = recordParams.get('recordName');
      var record = id ? { id: id, name: '工程紀錄' } : null;
      if (!record) {
        var wanted = recordLinkName(name);
        var result = await call(api + '?action=search&query=' + encodeURIComponent(wanted.split('/').pop().slice(0, 120)));
        record = findLinkedRecord(result.results || [], name);
      }
      if (!record) throw new Error('找不到連結的工程紀錄，或有多篇同名紀錄：' + name);
      await openRecord(record);
    } catch (error) { previewMeta.textContent = ''; preview.textContent = error.message; }
  }

  function appendSummaryCitation(parent, reference, citations) {
    var record = findLinkedRecord(summarySources.concat(rows), reference);
    var references = record ? [record.relativePath || record.name] : [reference];
    if (!record) {
      var contained = summarySources.filter(function (source) { return source.name && reference.indexOf(source.name) !== -1; });
      if (contained.length) references = contained.sort(function (a, b) { return reference.indexOf(a.name) - reference.indexOf(b.name); }).map(function (source) { return source.relativePath || source.name; });
    }
    references.forEach(function (ref) {
      var source = findLinkedRecord(summarySources.concat(rows), ref);
      var key = source ? source.id : recordLinkName(ref);
      var index = citations.entries.findIndex(function (entry) { return entry.key === key; });
      if (index === -1) {
        index = citations.entries.length;
        citations.entries.push({ key: key, reference: ref, name: source ? source.name : ref });
      }
      appendRecordLink(parent, '[' + (index + 1) + ']', ref);
      var link = parent.lastChild;
      link.className += ' engineering-summary-citation';
      link.setAttribute('aria-label', '來源 ' + (index + 1) + '：' + citations.entries[index].name);
    });
  }
  function summarySections(value) {
    var body = [], sources = [], sourceLevel = 0, inCode = false;
    String(value || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var trimmed = line.trim();
      var heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      var title = (heading ? heading[2] : trimmed).replace(/\*\*|__/g, '').replace(/^[^\u3400-\u9fffA-Za-z0-9]+/u, '').replace(/[：:]\s*$/, '').trim();
      if (!inCode && /^(?:[一二三四五六七八九十\d]+[、.．]\s*)?來源(?:檔案|文件)$/.test(title)) {
        sourceLevel = heading ? heading[1].length : 6;
      } else if (!inCode && sourceLevel && ((heading && heading[1].length <= sourceLevel) || /^---+$/.test(trimmed))) {
        sourceLevel = 0;
      }
      (sourceLevel ? sources : body).push(line);
      if (/^```/.test(trimmed)) inCode = !inCode;
    });
    return { body: body.join('\n'), sources: sources.join('\n') };
  }
  function renderSummary(value) {
    var citations = { entries: [] };
    var sections = summarySections(value);
    renderMarkdown(sections.body, '', summary, citations);
    // Keep references from Gemini's source list in the single source footer.
    if (sections.sources) renderMarkdown(sections.sources, '', document.createElement('div'), citations);
    if (!citations.entries.length) return;
    var section = document.createElement('section');
    section.className = 'engineering-summary-sources';
    var heading = document.createElement('h3');
    heading.textContent = '主要來源頁面';
    var sourcesList = document.createElement('ol');
    citations.entries.forEach(function (entry) {
      var item = document.createElement('li');
      appendRecordLink(item, entry.name.replace(/\.md$/i, ''), entry.reference);
      sourcesList.appendChild(item);
    });
    section.appendChild(heading);
    section.appendChild(sourcesList);
    summary.appendChild(section);
  }
  function appendFootnote(parent, token, markdown) {
    var inline = token[0] === '^';
    var key = inline ? 'inline:' + token.slice(2, -1) : token.slice(2, -1);
    var content = inline ? token.slice(2, -1) : markdown.definitions[key];
    if (content === undefined) { parent.appendChild(document.createTextNode(token)); return; }
    var index = markdown.notes.findIndex(function (note) { return note.key === key; });
    if (index === -1) { index = markdown.notes.length; markdown.notes.push({ key: key, content: content, references: 0 }); }
    var note = markdown.notes[index];
    note.references++;
    var sup = document.createElement('sup');
    sup.className = 'engineering-markdown-footnote-ref';
    var link = document.createElement('a');
    link.id = markdown.prefix + '-ref-' + (index + 1) + '-' + note.references;
    link.href = '#' + markdown.prefix + '-' + (index + 1);
    link.textContent = '[' + (index + 1) + ']';
    link.setAttribute('aria-label', '註腳 ' + (index + 1));
    sup.appendChild(link); parent.appendChild(sup);
  }
  function appendInline(parent, value, recordId, citations, markdown) {
    var tokens = /(\\[\\`*_{}\[\]()#+\-.!~=>]|!?\[\[[^\]]+\]\]|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\)|\[來源[：:][^\]]+\]|\^\[[^\]]+\]|\[\^[^\]]+\]|\*\*\*[\s\S]+?\*\*\*|___[\s\S]+?___|\*\*[\s\S]+?\*\*|__[\s\S]+?__|~~[\s\S]+?~~|==[\s\S]+?==|\*[^*\n]+\*|(?<!\w)_[^_\n]+_(?!\w)|`[^`]+`|https?:\/\/[^\s<>]+|(?:^|\s)#[^\s#]+)/g;
    var offset = 0;
    var match;
    while ((match = tokens.exec(value))) {
      parent.appendChild(document.createTextNode(value.slice(offset, match.index)));
      var token = match[0];
      var element;
      if (token[0] === '\\') {
        parent.appendChild(document.createTextNode(token.slice(1)));
        offset = match.index + token.length;
        continue;
      } else if (/^(\^\[|\[\^)/.test(token) && markdown) {
        appendFootnote(parent, token, markdown);
        offset = match.index + token.length;
        continue;
      } else if (token.indexOf('[[') !== -1) {
        element = document.createElement('span');
        element.className = 'engineering-markdown-link';
        var target = token.slice(token.indexOf('[[') + 2, -2);
        if (token[0] === '!' && /\.(png|jpe?g|gif|webp)(?:\|.*)?$/i.test(target)) {
          appendImage(parent, target.split('|')[0].split('/').pop(), target.split('|')[0], recordId);
          offset = match.index + token.length;
          continue;
        }
        if (citations) appendSummaryCitation(parent, target.split('|')[0], citations);
        else appendRecordLink(parent, target.split('|').pop(), target.split('|')[0]);
        offset = match.index + token.length;
        continue;
      } else if (/^!?\[[^\]]*\]\(/.test(token)) {
        var link = /^!?\[([^\]]*)\]\(([^)]*)\)$/.exec(token);
        if (token[0] === '!') {
          appendImage(parent, link[1], link[2], recordId);
          offset = match.index + token.length;
          continue;
        }
        if (!/^[a-z][a-z0-9+.-]*:/i.test(link[2]) && /\.md(?:#.*)?$/i.test(link[2])) {
          if (citations) appendSummaryCitation(parent, link[2], citations);
          else appendRecordLink(parent, link[1], link[2]);
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
      } else if (/^https?:\/\//.test(token)) {
        var address = token.replace(/[.,，。;；!！、）]+$/, '');
        element = document.createElement('a');
        element.href = address;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
        element.textContent = address;
        parent.appendChild(element);
        parent.appendChild(document.createTextNode(token.slice(address.length)));
        offset = match.index + token.length;
        continue;
      } else if (/^\[來源[：:]/.test(token)) {
        var reference = token.slice(1, -1).replace(/^來源[：:]\s*/, '').trim();
        if (citations) appendSummaryCitation(parent, reference, citations);
        else appendRecordLink(parent, token, reference);
        offset = match.index + token.length;
        continue;
      } else if (/^(\*\*\*|___)/.test(token)) {
        element = document.createElement('strong');
        var emphasis = document.createElement('em');
        appendInline(emphasis, token.slice(3, -3), recordId, citations, markdown);
        element.appendChild(emphasis);
      } else if (/^(\*\*|__)/.test(token)) {
        element = document.createElement('strong');
        appendInline(element, token.slice(2, -2), recordId, citations, markdown);
      } else if (/^(~~|==)/.test(token)) {
        element = document.createElement(token[0] === '~' ? 'del' : 'mark');
        appendInline(element, token.slice(2, -2), recordId, citations, markdown);
      } else if (token[0] === '*' || token[0] === '_') {
        element = document.createElement('em');
        appendInline(element, token.slice(1, -1), recordId, citations, markdown);
      } else if (token[0] === '`') {
        element = document.createElement('code');
        element.textContent = token.slice(1, -1);
      } else {
        if (/^\s/.test(token)) parent.appendChild(document.createTextNode(token[0]));
        element = document.createElement('span');
        element.className = 'engineering-markdown-tag';
        element.textContent = token.trim();
        var group = /^#([1-7])-/.exec(element.textContent);
        if (group) element.className += ' engineering-markdown-tag-group-' + group[1];
      }
      parent.appendChild(element);
      offset = match.index + token.length;
    }
    parent.appendChild(document.createTextNode(value.slice(offset)));
  }

  function tableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(function (cell) {
      return cell.trim().replace(/\\\|/g, '|');
    });
  }
  function markdownSource(value) {
    var inComment = false, fence = null;
    return String(value || '').replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      var match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence) {
        if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
        return line;
      }
      if (match && !inComment) { fence = match[1]; return line; }
      var output = '', ticks = 0;
      for (var i = 0; i < line.length; i++) {
        if (!inComment && line[i] === '\\') { output += line.slice(i, i + 2); i++; continue; }
        if (!inComment && line[i] === '`') {
          var run = /^`+/.exec(line.slice(i))[0];
          ticks = ticks === run.length ? 0 : (ticks || run.length);
          output += run; i += run.length - 1; continue;
        }
        if (!ticks && line.slice(i, i + 2) === '%%') { inComment = !inComment; i++; continue; }
        if (!inComment) output += line[i];
      }
      return output;
    }).join('\n');
  }

  function renderMarkdown(value, recordId, target, citations) {
    target = target || preview;
    target.replaceChildren();
    var lines = markdownSource(value).split('\n');
    var markdown = { notes: [], definitions: Object.create(null), prefix: 'engineering-footnote-' + (target.id || recordId || 'content') };
    var definitionFence = null;
    for (var d = 0; d < lines.length; d++) {
      var definitionFenceMatch = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[d]);
      if (definitionFenceMatch) {
        if (!definitionFence) definitionFence = definitionFenceMatch[1];
        else if (definitionFenceMatch[1][0] === definitionFence[0] && definitionFenceMatch[1].length >= definitionFence.length && !definitionFenceMatch[2].trim()) definitionFence = null;
        continue;
      }
      if (definitionFence) continue;
      var definition = /^\[\^([^\]]+)\]:\s*(.*)$/.exec(lines[d]);
      if (definition) {
        var definitionText = [definition[2]];
        lines[d] = '';
        while (d + 1 < lines.length && /^ {2,}\S/.test(lines[d + 1])) { d++; definitionText.push(lines[d].trim()); lines[d] = ''; }
        markdown.definitions[definition[1]] = definitionText.join('\n');
      }
    }
    var fragment = document.createDocumentFragment();
    var listStack = [];
    var paragraph = null;
    var code = null;
    var codeFence = null;
    var quote = null;
    var start = lines[0] === '---' ? Math.max(0, lines.indexOf('---', 1) + 1) : 0;
    for (var i = start; i < lines.length; i++) {
      var line = lines[i];
      if (!code) line = line.replace(/\s*\^[A-Za-z0-9-]+\s*$/, '');
      var trimmed = line.trim();
      var fence = /^(`{3,}|~{3,})(.*)$/.exec(trimmed);
      if (fence && (!code || (fence[1][0] === codeFence[0] && fence[1].length >= codeFence.length && !fence[2].trim()))) {
        if (code) { code = null; codeFence = null; } else {
          codeFence = fence[1];
          code = document.createElement('code');
          if (/^[\w+-]+$/.test(fence[2].trim())) code.className = 'language-' + fence[2].trim();
          var block = document.createElement('pre');
          block.appendChild(code);
          fragment.appendChild(block);
        }
        paragraph = null; listStack = []; quote = null;
        continue;
      }
      if (code) { code.textContent += (code.textContent ? '\n' : '') + line; continue; }
      if (!trimmed) { paragraph = null; listStack = []; quote = null; continue; }
      var callout = /^>\s*\[!([A-Za-z-]+)\]([+-])?\s*(.*)$/.exec(trimmed);
      if (callout) {
        var calloutType = callout[1].toLowerCase();
        var calloutBox = document.createElement(callout[2] ? 'details' : 'section');
        calloutBox.className = 'engineering-markdown-callout';
        calloutBox.setAttribute('data-callout', calloutType);
        if (callout[2] === '+') calloutBox.open = true;
        var calloutTitle = document.createElement(callout[2] ? 'summary' : 'div');
        calloutTitle.className = 'engineering-markdown-callout-title';
        var calloutLabels = { note: '筆記', info: '資訊', tip: '提示', warning: '注意', danger: '警告', success: '完成', question: '問題', example: '範例', quote: '引用' };
        appendInline(calloutTitle, callout[3] || calloutLabels[calloutType] || calloutType, recordId, citations, markdown);
        calloutBox.appendChild(calloutTitle);
        var calloutLines = [];
        while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) { i++; calloutLines.push(lines[i].replace(/^\s*>\s?/, '')); }
        var calloutBody = document.createElement('div');
        calloutBody.id = markdown.prefix + '-callout-' + i;
        renderMarkdown(calloutLines.join('\n'), recordId, calloutBody, citations);
        calloutBox.appendChild(calloutBody); fragment.appendChild(calloutBox);
        paragraph = null; listStack = []; quote = null;
        continue;
      }
      if (trimmed.indexOf('|') !== -1 && i + 1 < lines.length &&
        tableCells(lines[i + 1]).every(function (cell) { return /^:?-{3,}:?$/.test(cell); })) {
        var headers = tableCells(line);
        var separators = tableCells(lines[i + 1]);
        if (headers.length === separators.length) {
          var wrapper = document.createElement('div');
          wrapper.className = 'engineering-markdown-table';
          var table = document.createElement('table');
          var head = document.createElement('thead');
          var headRow = document.createElement('tr');
          headers.forEach(function (cell) {
            var th = document.createElement('th'); th.setAttribute('scope', 'col');
            appendInline(th, cell, recordId, citations, markdown); headRow.appendChild(th);
          });
          head.appendChild(headRow); table.appendChild(head);
          var body = document.createElement('tbody');
          i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) {
            var cells = tableCells(lines[i]);
            var row = document.createElement('tr');
            headers.forEach(function (_, column) {
              var td = document.createElement('td');
              appendInline(td, cells[column] || '', recordId, citations, markdown); row.appendChild(td);
            });
            body.appendChild(row); i++;
          }
          i--; table.appendChild(body); wrapper.appendChild(table); fragment.appendChild(wrapper);
          paragraph = null; listStack = []; quote = null;
          continue;
        }
      }
      var heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      var bullet = /^(\s*)([-*+] |\d+[.)] )(.+)$/.exec(line.replace(/\t/g, '    '));
      var element;
      if (/^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/.test(trimmed)) {
        fragment.appendChild(document.createElement('hr'));
        paragraph = null; listStack = []; quote = null;
      } else if (heading) {
        element = document.createElement('h' + heading[1].length);
        appendInline(element, heading[2], recordId, citations, markdown);
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
        var content = bullet[3];
        var task = /^\[([^\]])\]\s+(.*)$/.exec(content);
        if (task) {
          element.className = 'engineering-markdown-task' + (task[1] === ' ' ? '' : ' is-complete');
          var checkbox = document.createElement('input');
          checkbox.type = 'checkbox'; checkbox.checked = task[1] !== ' '; checkbox.disabled = true;
          checkbox.setAttribute('aria-label', checkbox.checked ? '已完成' : '未完成');
          element.appendChild(checkbox); content = task[2];
        }
        appendInline(element, content, recordId, citations, markdown);
        listStack[listStack.length - 1].list.appendChild(element);
        listStack[listStack.length - 1].lastItem = element;
        paragraph = null; quote = null;
      } else if (/^>\s?/.test(trimmed)) {
        if (!quote) { quote = document.createElement('blockquote'); fragment.appendChild(quote); }
        element = document.createElement('p');
        appendInline(element, trimmed.replace(/^>\s?/, ''), recordId, citations, markdown);
        quote.appendChild(element);
        paragraph = null; listStack = [];
      } else {
        if (!paragraph) { paragraph = document.createElement('p'); fragment.appendChild(paragraph); }
        else paragraph.appendChild(document.createElement('br'));
        appendInline(paragraph, trimmed, recordId, citations, markdown);
        listStack = []; quote = null;
      }
    }
    target.appendChild(fragment);
    if (markdown.notes.length) {
      var footnotes = document.createElement('section');
      footnotes.className = 'engineering-markdown-footnotes';
      footnotes.setAttribute('aria-label', '註腳');
      var footnotesList = document.createElement('ol');
      markdown.notes.forEach(function (note, index) {
        var item = document.createElement('li');
        item.id = markdown.prefix + '-' + (index + 1);
        appendInline(item, note.content, recordId, citations);
        for (var ref = 1; ref <= note.references; ref++) {
          var back = document.createElement('a');
          back.href = '#' + markdown.prefix + '-ref-' + (index + 1) + '-' + ref;
          back.textContent = ' ↩'; back.setAttribute('aria-label', '返回註腳 ' + (index + 1) + ' 的引用');
          item.appendChild(back);
        }
        footnotesList.appendChild(item);
      });
      footnotes.appendChild(footnotesList); target.appendChild(footnotes);
    }
  }

  excludeInput.addEventListener('input', function () {
    var selected = normalizeFolders(excludeInput.value.split('\n'));
    excludeSuggestions.querySelectorAll('input').forEach(function (box) { box.checked = selected.indexOf(box.value) >= 0; });
  });
  excludeSave.onclick = saveExcludeSettings;
  byId('SettingsCancel').onclick = function () { saveAfterLogin = false; excludeDialog.close(); };
  dialog.addEventListener('click', function (event) { if (!recordWindow && event.target === dialog) dialog.close(); });
  dialog.addEventListener('cancel', function (event) { if (recordWindow) { event.preventDefault(); window.close(); } });
  gemini.onclick = summarize;
  if (recordWindow) loadLinkedRecord();
})();
