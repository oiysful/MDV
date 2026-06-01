/* ── marked renderer — One Dark code blocks ── */
const markdownController = window.MDVMarkdown.createMarkdownController({
  getRefs: () => $,
  markedLib: marked,
  hljsLib: hljs,
  pathUtils: window.MDVPathUtils,
  api: window.api,
  onShowModeButton: () => {
    if ($.btnMode) {
      $.btnMode.style.display = '';
      updateModeBtn();
    }
  },
});

/* ── State ── */
let md = '';
let sidebarOpen = true;
let activeTab = 'toc';
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
let sourceMode = false;
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let currentExplorerRoot = null;
let explorerShowFullPath = false;
let toastTimer = null;
const WELCOME_GUIDE_DISMISSED_KEY = 'mdv-welcome-guide-dismissed';
let $;

/* ── File watcher ── */
let watchedPath = null;

const themeController = window.MDVTheme.createThemeController({
  matchMedia: sysDark,
  storage: localStorage,
  documentRef: document,
  getRefs: () => $,
});
const onboardingController = window.MDVOnboarding.createOnboardingController({
  getRefs: () => $,
  storage: localStorage,
  dismissedKey: WELCOME_GUIDE_DISMISSED_KEY,
  getTabCount: () => tabs.length,
  getExplorerRoot: () => currentExplorerRoot,
  getExplorerShowFullPath: () => explorerShowFullPath,
  setExplorerShowFullPath: value => { explorerShowFullPath = value },
  revealInFinder,
});
const searchController = window.MDVSearch.createSearchController({
  getRefs: () => $,
});

async function watchFile(path) {
  if (watchedPath === path) return;
  if (watchedPath) await window.api.unwatchFile(watchedPath);
  watchedPath = path;
  if (path) await window.api.watchFile(path);
}

const EMPTY_HTML = `<div id="empty">
  <div class="empty-icon">📄</div>
  <div class="empty-title">열린 파일 없음</div>
  <div class="empty-sub">
    우측 상단의 <strong>+ 열기</strong> 버튼을 누르거나<br>
    아래 버튼 또는 드래그 앤 드롭으로 시작하세요<br><br>
    <kbd>.md</kbd>&nbsp; <kbd>.markdown</kbd>
  </div>
  <div class="empty-actions">
    <button class="empty-cta" onclick="openFile()">파일 열기</button>
    <button class="empty-cta secondary" onclick="openFolder()">폴더 열기</button>
  </div>
</div>`;

const EXPLORER_EMPTY_HTML = '<div class="tree-hint">위의 <strong>+</strong> 버튼으로<br>폴더를 열어 탐색하세요.</div>';

/* ── API calls (Electron IPC) ── */
async function openFile() {
  try {
    const data = JSON.parse(await window.api.openFileDialog());
    if (data.cancelled) return;
    if (data.files) data.files.forEach(f => load(f));
    else if (data.content !== undefined) load(data);
  } catch(e) { console.error(e); }
}

async function load(data) {
  if (data.error)     { alert('파일 오류: ' + data.error); return; }
  if (data.cancelled) return;
  await createTab(data);
}

/* ── Render ── */

async function render(text, filename, docPath) {
  $.content.classList.remove('is-empty');
  await markdownController.render(text, filename, docPath);
}

function stats(text) {
  const { words, minutes } = window.MDVMarkdown.computeStats(text)
  if (!words) {
    $.stats.classList.add('empty')
    $.sWords.textContent = ''
    $.sTime.textContent = ''
    return
  }
  $.stats.classList.remove('empty')
  $.sWords.textContent = `${words.toLocaleString()} 단어`
  $.sTime.textContent  = `약 ${minutes}분`
}

/* ── Tab management ── */
function findTabByPath(path) {
  if (!path) return null;
  return tabs.find(t => t.path === path) || null;
}

function saveCurrentTabState() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  tab.scrollTop    = $.scrollArea.scrollTop;
  tab.renderedHTML = $.content.innerHTML;
  tab.tocHTML      = $.tocList.innerHTML;
  tab.sourceMode   = sourceMode;
  if (sourceMode) { tab.content = $.sourceEditor.value; md = tab.content; }
}

function restoreTabState(tab) {
  $.content.classList.remove('is-empty');
  markdownController.hydrateFromDom(tab.renderedHTML || '', tab.tocHTML || '', tab.content);
  document.title = (tab.filename || 'untitled.md').replace(/\.md$/i, '');
  if ($.btnMode) $.btnMode.style.display = '';
  sourceMode = tab.sourceMode || false;
  applySourceMode();
  requestAnimationFrame(() => { $.scrollArea.scrollTop = tab.scrollTop || 0; });
}

function showEmptyState() {
  $.content.innerHTML = EMPTY_HTML;
  $.content.classList.add('is-empty');
  $.content.style.display = '';
  $.sourceView.style.display = 'none';
  document.title = 'MDV';
  if ($.btnMode) { $.btnMode.style.display = 'none'; $.btnMode.classList.remove('source-active'); }
  markdownController.resetEmptyStats();
  sourceMode = false; md = '';
}

function syncExplorerHeader() {
  return onboardingController.syncExplorerHeader()
}

function clearExplorerRoot() {
  currentExplorerRoot = null;
  onboardingController.clearExplorerRoot();
}

function toggleExplorerPathInfo() {
  return onboardingController.toggleExplorerPathInfo()
}

async function revealInFinder(targetPath) {
  if (!targetPath) return
  const res = JSON.parse(await window.api.revealInFinder(targetPath))
  if (res.error) alert(`Finder 표시 실패: ${res.error}`)
}

function showToast(message) {
  return onboardingController.showToast(message)
}

function updateEntryAffordance() {
  return onboardingController.updateEntryAffordance()
}

function dismissWelcomeGuide(persist = true) {
  return onboardingController.dismissWelcomeGuide(persist)
}

function maybeShowWelcomeGuide() {
  return onboardingController.maybeShowWelcomeGuide()
}

async function openFromGuide(kind) {
  dismissWelcomeGuide();
  if (kind === 'folder') await openFolder();
  else await openFile();
}

function updateToolbarActions() {
  if (!$) return;
  const activeTab = tabs.find(t => t.id === activeTabId) || null;
  if ($.btnSave) $.btnSave.disabled = !activeTab || !activeTab.dirty;
  if ($.btnPrint) $.btnPrint.disabled = !activeTab;
}

function renderTabBar() {
  const list = $.tabList;
  $.tabStrip.classList.toggle('hidden', tabs.length === 0);
  list.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'file-tab' + (tab.id === activeTabId ? ' active' : '');
    el.dataset.tabId = tab.id;
    el.draggable = true;
    el.innerHTML = `<span class="file-tab-name">${tab.dirty ? '● ' : ''}${tab.filename}</span><button class="file-tab-close">&times;</button>`;
    el.addEventListener('click', () => switchToTab(tab.id));
    el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      showAppContextMenu(e.clientX, e.clientY, [
        { label: '새 창으로 열기', action: () => openTabInNewWindow(tab.id) },
        { label: '다른 탭 닫기', action: () => closeOtherTabs(tab.id) },
        { label: '모든 탭 닫기', action: () => closeAllTabs() },
      ]);
    });
    el.querySelector('.file-tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
    el.addEventListener('dragstart', onTabDragStart);
    el.addEventListener('dragover',  onTabDragOver);
    el.addEventListener('dragleave', onTabDragLeave);
    el.addEventListener('drop',      onTabDrop);
    el.addEventListener('dragend',   onTabDragEnd);
    list.appendChild(el);
  });
  updateToolbarActions();
  updateEntryAffordance();
  maybeShowWelcomeGuide();
}

/* ── Tab drag ── */
let draggedTabId = null;
function onTabDragStart(e) { draggedTabId = Number(e.currentTarget.dataset.tabId); e.dataTransfer.effectAllowed = 'move'; }
function onTabDragOver(e) {
  if (draggedTabId === null) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const after = e.clientX > rect.left + rect.width / 2;
  $.tabList.querySelectorAll('.file-tab').forEach(t => { if (t !== el) t.classList.remove('drag-before','drag-after'); });
  el.classList.toggle('drag-before', !after);
  el.classList.toggle('drag-after',  after);
}
function onTabDragLeave(e) { e.currentTarget.classList.remove('drag-before','drag-after'); }
function onTabDrop(e) {
  if (draggedTabId === null) return;
  e.preventDefault();
  const el = e.currentTarget;
  const targetId = Number(el.dataset.tabId);
  const src = tabs.findIndex(t => t.id === draggedTabId);
  const tgt = tabs.findIndex(t => t.id === targetId);
  if (src === -1 || tgt === -1 || src === tgt) { onTabDragEnd(); return; }
  const rect = el.getBoundingClientRect();
  const after = e.clientX > rect.left + rect.width / 2;
  let insert = after ? tgt + 1 : tgt;
  const [moved] = tabs.splice(src, 1);
  if (src < insert) insert -= 1;
  tabs.splice(insert, 0, moved);
  onTabDragEnd(); renderTabBar();
}
function onTabDragEnd() {
  $.tabList.querySelectorAll('.file-tab').forEach(t => t.classList.remove('drag-before','drag-after'));
  draggedTabId = null;
}

async function createTab(data) {
  if (data.path) {
    const existing = findTabByPath(data.path);
    if (existing) { switchToTab(existing.id); return; }
  }
  const tab = {
    id: ++tabIdCounter,
    filename: data.filename || 'untitled.md',
    path: data.path || null,
    content: data.content,
    savedContent: data.content,
    dirty: false,
    scrollTop: 0,
    renderedHTML: null,
    tocHTML: null,
  };
  tabs.push(tab);
  if (activeTabId !== null) saveCurrentTabState();
  activeTabId = tab.id;
  md = tab.content;
  sourceMode = false;
  applySourceMode();
  await render(tab.content, tab.filename, tab.path);
  tab.renderedHTML = $.content.innerHTML;
  tab.tocHTML = $.tocList.innerHTML;
  renderTabBar();
  // Start watching the file
  if (tab.path) watchFile(tab.path);
}

function switchToTab(tabId) {
  if (tabId === activeTabId) return;
  const target = tabs.find(t => t.id === tabId);
  if (!target) return;
  saveCurrentTabState();
  activeTabId = tabId;
  md = target.content;
  restoreTabState(target);
  renderTabBar();
  if (target.path) watchFile(target.path);
}

function closeTab(tabId) {
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  if (tabs[idx].dirty && !confirm('저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?')) return;
  tabs.splice(idx, 1);
  if (tabs.length === 0) { activeTabId = null; showEmptyState(); renderTabBar(); watchFile(null); return; }
  if (activeTabId === tabId) {
    const newIdx = Math.min(idx, tabs.length - 1);
    activeTabId = tabs[newIdx].id;
    md = tabs[newIdx].content;
    restoreTabState(tabs[newIdx]);
    if (tabs[newIdx].path) watchFile(tabs[newIdx].path);
  }
  renderTabBar();
}

function closeOtherTabs(tabId) {
  const target = tabs.find(t => t.id === tabId);
  if (!target) return;
  const dirtyOthers = tabs.some(t => t.id !== tabId && t.dirty);
  if (dirtyOthers && !confirm('저장하지 않은 변경 사항이 있는 다른 탭이 있습니다. 닫으시겠습니까?')) return;
  tabs = tabs.filter(t => t.id === tabId);
  activeTabId = tabId;
  md = target.content;
  restoreTabState(target);
  renderTabBar();
  if (target.path) watchFile(target.path);
}

function closeAllTabs() {
  const hasDirty = tabs.some(t => t.dirty);
  if (hasDirty && !confirm('저장하지 않은 변경 사항이 있는 탭이 있습니다. 모두 닫으시겠습니까?')) return;
  tabs = [];
  activeTabId = null;
  showEmptyState();
  renderTabBar();
  watchFile(null);
}

async function openTabInNewWindow(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;
  await window.api.newWindow(tab.path || null);
}

function hideAppContextMenu() {
  if (!$?.appContextMenu) return;
  $.appContextMenu.style.display = 'none';
  $.appContextMenu.innerHTML = '';
}

function showAppContextMenu(x, y, items) {
  if (!$?.appContextMenu || !items.length) return;
  const menu = $.appContextMenu;
  menu.innerHTML = '';
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'ctx-item';
    btn.textContent = item.label;
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      hideAppContextMenu();
      await item.action();
    });
    menu.appendChild(btn);
  });
  menu.style.display = 'block';
  menu.style.left = '0px';
  menu.style.top = '0px';
  const rect = menu.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function closeCurrentTab() { if (activeTabId !== null) closeTab(activeTabId); }
function switchToNextTab() {
  const idx = tabs.findIndex(t => t.id === activeTabId);
  if (idx < tabs.length - 1) switchToTab(tabs[idx + 1].id);
}
function switchToPrevTab() {
  const idx = tabs.findIndex(t => t.id === activeTabId);
  if (idx > 0) switchToTab(tabs[idx - 1].id);
}

/* ── DOMContentLoaded ── */
document.addEventListener('DOMContentLoaded', () => {
  $ = {
    scrollArea:    document.getElementById('scroll-area'),
    content:       document.getElementById('content'),
    tocList:       document.getElementById('toc-list'),
    sWords:        document.getElementById('s-words'),
    sTime:         document.getElementById('s-time'),
    stats:         document.getElementById('stats'),
    sidebar:       document.getElementById('sidebar'),
    sidebarTabs:   document.getElementById('sidebar-tabs'),
    tabStrip:      document.getElementById('tab-strip'),
    tabList:       document.getElementById('tab-list'),
    appContextMenu:document.getElementById('app-context-menu'),
    btnAdd:        document.getElementById('btn-add'),
    openEntryHint: document.getElementById('open-entry-hint'),
    btnSave:       document.getElementById('btn-save'),
    btnPrint:      document.getElementById('btn-print'),
    goTop:         document.getElementById('go-top'),
    btnMode:       document.getElementById('btn-mode'),
    modeLabel:     document.getElementById('mode-label'),
    sourceView:    document.getElementById('source-view'),
    sourceEditor:  document.getElementById('source-editor'),
    sourceLines:   document.getElementById('source-lines'),
    dropOverlay:   document.getElementById('drop-overlay'),
    btnTheme:      document.getElementById('btn-theme'),
    icAuto:        document.getElementById('ic-auto'),
    icMoon:        document.getElementById('ic-moon'),
    icSun:         document.getElementById('ic-sun'),
    panelToc:      document.getElementById('panel-toc'),
    panelExplorer: document.getElementById('panel-explorer'),
    explorerTree:  document.getElementById('explorer-tree'),
    explorerLabel: document.getElementById('explorer-root-label'),
    explorerPath:  document.getElementById('explorer-root-path'),
    btnExplorerReveal: document.getElementById('btn-explorer-reveal'),
    btnExplorerClose:  document.getElementById('btn-explorer-close'),
    toast:         document.getElementById('toast'),
    welcomeGuide:  document.getElementById('welcome-guide'),
  };

  applyTheme();
  $.sidebar.classList.toggle('closed', !sidebarOpen);
  $.sidebarTabs.dataset.active = activeTab;
  $.stats.classList.add('empty');
  syncExplorerHeader();
  updateToolbarActions();
  updateEntryAffordance();
  maybeShowWelcomeGuide();

  // Electron: system theme changed
  window.api.onThemeChanged(dark => {
    if (themeController.getTheme() === 'auto') {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }
  });

  // Electron: file opened from Finder or main process
  window.api.onFileOpened(async jsonStr => {
    const data = JSON.parse(jsonStr);
    await load(data);
  });

  // Electron: file changed on disk
  window.api.onFileChanged(async ({ path: changedPath, content }) => {
    const tab = findTabByPath(changedPath);
    if (!tab) return;
    tab.content = content;
    tab.savedContent = content;
    tab.dirty = false;
    // If it's the active tab, re-render
    if (tab.id === activeTabId) {
      md = content;
      await render(content, tab.filename, tab.path);
      tab.renderedHTML = $.content.innerHTML;
      tab.tocHTML = $.tocList.innerHTML;
    }
    renderTabBar();
  });

  $.content.addEventListener('click', async e => {
    const link = e.target.closest('a[href]')
    if (!link) return
    const href = link.getAttribute('href')
    if (!href || href.startsWith('#')) return
    e.preventDefault()
    const res = JSON.parse(await window.api.openExternalUrl(href))
    if (res.error) alert(`링크 열기 실패: ${res.error}`)
  })

  $.explorerLabel.addEventListener('contextmenu', e => {
    if (!currentExplorerRoot) return;
    e.preventDefault();
    showAppContextMenu(e.clientX, e.clientY, [
      { label: 'Finder에 표시', action: () => revealInFinder(currentExplorerRoot) },
      { label: '폴더 닫기', action: () => clearExplorerRoot() },
    ]);
  });
  $.explorerTree.addEventListener('contextmenu', e => {
    if (!currentExplorerRoot) return;
    const row = e.target.closest('.tree-row');
    if (row) return;
    e.preventDefault();
    showAppContextMenu(e.clientX, e.clientY, [
      { label: 'Finder에 표시', action: () => revealInFinder(currentExplorerRoot) },
      { label: '폴더 닫기', action: () => clearExplorerRoot() },
    ]);
  });

  // Scroll → go-top + TOC active
  const sa = $.scrollArea;
  let scrollTicking = false;
  sa.addEventListener('scroll', () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      scrollTicking = false;
      $.goTop.classList.toggle('on', sa.scrollTop > 300);
      markdownController.refreshTocActive(sa.scrollTop);
    });
  });
  window.addEventListener('resize', () => { markdownController.refreshHeadingOffsets(); });

  const editor = $.sourceEditor;
  editor.addEventListener('input', () => {
    updateLineNumbers(); autoResizeEditor(); updateLineHighlight();
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) { tab.dirty = (editor.value !== tab.savedContent); renderTabBar(); }
  });
  editor.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, end = editor.selectionEnd;
      editor.value = editor.value.substring(0, s) + '\t' + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = s + 1;
      updateLineNumbers();
    }
  });
  editor.addEventListener('focus',   updateLineHighlight);
  editor.addEventListener('click',   updateLineHighlight);
  editor.addEventListener('keyup',   updateLineHighlight);
  editor.addEventListener('mouseup', updateLineHighlight);
  editor.addEventListener('blur', () => {
    document.getElementById('line-highlight').style.display = 'none';
  });

  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); searchPrev(); }
    else if (e.key === 'Enter') { e.preventDefault(); searchNext(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  $.scrollArea.addEventListener('scroll', hideAppContextMenu);
});

/* ── Actions ── */
function toggleSidebar() { sidebarOpen = !sidebarOpen; $.sidebar.classList.toggle('closed', !sidebarOpen); }
function goTop()         { $.scrollArea.scrollTo({ top: 0, behavior: 'smooth' }); }
function printDoc()      { window.print(); }

function applySourceMode() {
  $.content.style.display    = sourceMode ? 'none' : '';
  $.sourceView.style.display = sourceMode ? 'block' : 'none';
  $.scrollArea.classList.toggle('source-mode', sourceMode);
  if (sourceMode) { $.sourceEditor.value = md; updateLineNumbers(); autoResizeEditor(); }
  updateModeBtn();
}

function updateLineNumbers() {
  const count = $.sourceEditor.value.split('\n').length;
  $.sourceLines.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}
function autoResizeEditor() {
  $.sourceEditor.style.height = 'auto';
  $.sourceEditor.style.height = $.sourceEditor.scrollHeight + 'px';
}
function updateLineHighlight() {
  const editor = $.sourceEditor;
  const hl = document.getElementById('line-highlight');
  if (!hl) return;
  const lineIndex = editor.value.substring(0, editor.selectionStart).split('\n').length - 1;
  const lineH = parseFloat(getComputedStyle(editor).lineHeight);
  const padTop = parseFloat(getComputedStyle(editor).paddingTop);
  hl.style.top = (padTop + lineIndex * lineH) + 'px';
  hl.style.height = lineH + 'px';
  hl.style.display = 'block';
}

async function toggleSource() {
  if (activeTabId === null) return;
  closeSearch();
  if (sourceMode) {
    const edited = $.sourceEditor.value;
    if (edited !== md) {
      md = edited;
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab) { tab.content = edited; tab.dirty = (edited !== tab.savedContent); renderTabBar(); }
      await render(edited, tab ? tab.filename : '', tab ? tab.path : null);
    }
  }
  sourceMode = !sourceMode;
  applySourceMode();
}

/* ── Sidebar tabs ── */
function switchTab(tab) {
  activeTab = tab;
  $.panelToc.style.display      = tab === 'toc'      ? '' : 'none';
  $.panelExplorer.style.display = tab === 'explorer' ? 'flex' : 'none';
  $.sidebarTabs.dataset.active = tab;
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (!sidebarOpen) { sidebarOpen = true; $.sidebar.classList.remove('closed'); }
}

/* ── New window / new file ── */
async function newWindow() { await window.api.newWindow(null); }
let untitledCounter = 0;
async function newFile() {
  untitledCounter++;
  const name = untitledCounter === 1 ? 'untitled.md' : `untitled-${untitledCounter}.md`;
  await createTab({ content: '', filename: name, path: null });
  sourceMode = true; applySourceMode(); $.sourceEditor.focus();
}

/* ── Save ── */
async function saveFile() {
  if (activeTabId === null) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  if (sourceMode) { tab.content = $.sourceEditor.value; md = tab.content; }
  if (tab.path) {
    const res = JSON.parse(await window.api.saveFile(tab.path, tab.content));
    if (res.error) { alert('저장 실패: ' + res.error); return; }
    tab.savedContent = tab.content; tab.dirty = false; renderTabBar(); showToast('저장됨');
  } else {
    await saveFileAs();
  }
}

async function saveFileAs() {
  if (activeTabId === null) return;
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  if (sourceMode) { tab.content = $.sourceEditor.value; md = tab.content; }
  const dlg = JSON.parse(await window.api.saveFileDialog(tab.filename));
  if (dlg.cancelled || dlg.error) return;
  const res = JSON.parse(await window.api.saveFile(dlg.path, tab.content));
  if (res.error) { alert('저장 실패: ' + res.error); return; }
  tab.path = dlg.path;
  tab.filename = res.filename;
  tab.savedContent = tab.content;
  tab.dirty = false;
  document.title = tab.filename.replace(/\.md$/i, '');
  renderTabBar();
  watchFile(tab.path);
  showToast('저장됨');
}

/* ── Directory explorer ── */
async function openFolder() {
  const res = JSON.parse(await window.api.openFolderDialog());
  if (res.cancelled || res.error) return;
  currentExplorerRoot = res.path;
  explorerShowFullPath = false;
  syncExplorerHeader();
  switchTab('explorer');
  await loadDir(res.path, $.explorerTree, 0);
}

async function loadDir(path, container, depth) {
  container.innerHTML = '<div class="tree-hint">로드 중…</div>';
  const res = JSON.parse(await window.api.listDirectory(path));
  container.innerHTML = '';
  if (res.error) { container.innerHTML = `<div class="tree-hint">${res.error}</div>`; return; }
  if (!res.entries.length) { container.innerHTML = '<div class="tree-hint">.md 파일 없음</div>'; return; }
  res.entries.forEach(entry => renderTreeEntry(entry, container, depth));
}

function renderTreeEntry(entry, container, depth) {
  const item = document.createElement('div');
  item.className = 'tree-item tree-' + entry.type;
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.paddingLeft = `${12 + depth * 14}px`;

  const folderClosedSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.35c.34 0 .67.12.93.34l1.12.91c.13.11.3.16.47.16h4.13a1.75 1.75 0 0 1 1.75 1.75v5.34a1.75 1.75 0 0 1-1.75 1.75H3.5a1.75 1.75 0 0 1-1.75-1.75V4.75Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;
  const folderOpenSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 5.25A1.75 1.75 0 0 1 3.5 3.5h2.14c.34 0 .67.11.94.33l1.15.92c.13.1.29.15.46.15h4.31c.97 0 1.75.78 1.75 1.75 0 .14-.02.29-.05.43l-.86 4.02a1.75 1.75 0 0 1-1.71 1.4H3.48a1.75 1.75 0 0 1-1.72-1.42L1.2 7.07a1.75 1.75 0 0 1 .55-1.82Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;
  const fileSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 2.75h4.88c.33 0 .65.13.88.36l2.88 2.88c.23.23.36.55.36.88V13A1.25 1.25 0 0 1 11.75 14.25h-7.5A1.25 1.25 0 0 1 3 13V4A1.25 1.25 0 0 1 4.25 2.75H4Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M8.75 2.75V6.5h3.75" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>`;

  if (entry.type === 'dir') {
    const arrow = document.createElement('span');
    arrow.className = 'tree-arrow'; arrow.textContent = '▶';
    const icon  = document.createElement('span');
    icon.className = 'tree-icon'; icon.innerHTML = folderClosedSvg;
    const name  = document.createElement('span');
    name.className = 'tree-name'; name.textContent = entry.name;
    row.append(arrow, icon, name);
    const children = document.createElement('div');
    children.className = 'tree-children';
    let loaded = false;
    row.addEventListener('click', async () => {
      const open = children.classList.toggle('open');
      arrow.textContent = open ? '▼' : '▶';
      icon.innerHTML = open ? folderOpenSvg : folderClosedSvg;
      if (open && !loaded) { loaded = true; await loadDir(entry.path, children, depth + 1); }
    });
    row.addEventListener('contextmenu', e => {
      if (!currentExplorerRoot) return;
      e.preventDefault();
      showAppContextMenu(e.clientX, e.clientY, [
        {
          label: '폴더 닫기',
          action: () => clearExplorerRoot(),
        },
      ]);
    });
    item.append(row, children);
  } else {
    const icon = document.createElement('span');
    icon.className = 'tree-icon'; icon.innerHTML = fileSvg;
    const name = document.createElement('span');
    name.className = 'tree-name'; name.textContent = entry.name;
    row.append(icon, name);
    row.addEventListener('click', async e => {
      if (e.metaKey) {
        await window.api.newWindow(entry.path);
      } else {
        const data = JSON.parse(await window.api.readFile(entry.path));
        await load(data);
        container.closest('#layout').querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
      }
    });
    item.appendChild(row);
  }
  container.appendChild(item);
}

/* ── Add menu ── */
function toggleAddMenu(e) {
  e.stopPropagation();
  const m = document.getElementById('add-menu');
  m.style.display = m.style.display === 'none' ? '' : 'none';
  $.btnAdd.classList.toggle('active', m.style.display !== 'none');
}
function hideAddMenu() {
  document.getElementById('add-menu').style.display = 'none';
  if ($?.btnAdd) $.btnAdd.classList.remove('active');
}

/* ── Mode button ── */
function updateModeBtn() {
  if (!$ || !$.btnMode || $.btnMode.style.display === 'none') return;
  if (sourceMode) {
    $.btnMode.title = '미리보기 (⌘U)';
    $.btnMode.classList.add('source-active');
    $.btnMode.querySelector('svg').innerHTML = `<circle cx="6.5" cy="6.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M1 6.5C2.5 3.5 4.3 2 6.5 2s4 1.5 5.5 4.5C10.5 9.5 8.7 11 6.5 11S2.5 9.5 1 6.5z" stroke="currentColor" stroke-width="1.3"/>`;
  } else {
    $.btnMode.title = '편집 (⌘U)';
    $.btnMode.classList.remove('source-active');
    $.btnMode.querySelector('svg').innerHTML = `<path d="M3 3.25 1 6.5 3 9.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 3.25 12 6.5 10 9.75" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.75 2.5 6.25 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`;
  }
}

/* ── Copy all ── */
async function copyAll() {
  if (!md) return;
  await navigator.clipboard.writeText(md);
  const btn = document.getElementById('btn-copy-all');
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 1500);
}

/* ── Search ── */
function toggleSearch() {
  return searchController.toggleSearch()
}
function closeSearch() {
  return searchController.closeSearch()
}
function clearSearchHighlights() {
  return searchController.clearSearchHighlights()
}
function runSearch(query) {
  return searchController.runSearch(query)
}
function highlightCurrent() {
  return searchController.highlightCurrent()
}
function searchNext() {
  return searchController.searchNext()
}
function searchPrev() {
  return searchController.searchPrev()
}

function copyCode(btn) {
  const code = btn.closest('.code-wrapper').querySelector('code');
  navigator.clipboard.writeText(code?.innerText || '');
  btn.textContent = '✓ 복사됨'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = '복사'; btn.classList.remove('copied'); }, 1500);
}

/* ── Theme ── */
function applyTheme() {
  return themeController.applyTheme();
}

function toggleTheme() {
  return themeController.toggleTheme();
}

sysDark.addEventListener('change', () => { themeController.handleSystemThemeChange(); });

/* 인쇄 전 항상 light hljs, 인쇄 후 현재 테마로 복원 */
window.addEventListener('beforeprint', () => {
  document.getElementById('hljs-dark').disabled  = true;
  document.getElementById('hljs-light').disabled = false;
});
window.addEventListener('afterprint', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.getElementById('hljs-dark').disabled  = !isDark;
  document.getElementById('hljs-light').disabled =  isDark;
});

/* ── Drag & Drop files ── */
function hasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return types ? Array.prototype.indexOf.call(types, 'Files') !== -1 : false;
}
function onDragOver(e) { if (!hasFiles(e)) return; e.preventDefault(); $.dropOverlay.classList.add('on'); }
function onDragLeave()  { $.dropOverlay.classList.remove('on'); }
async function onDrop(e) {
  if (!hasFiles(e)) return;
  e.preventDefault(); $.dropOverlay.classList.remove('on');
  const files = [...e.dataTransfer.files].filter(f => /\.(md|markdown)$/i.test(f.name));
  if (!files.length) return;
  for (const f of files) load({ content: await f.text(), filename: f.name });
}

Object.assign(window, {
  openFile,
  openFolder,
  saveFile,
  saveFileAs,
  toggleSidebar,
  toggleSource,
  toggleSearch,
  copyAll,
  printDoc,
  toggleTheme,
  toggleAddMenu,
  hideAddMenu,
  dismissWelcomeGuide,
  openFromGuide,
  searchPrev,
  searchNext,
  closeSearch,
  switchTab,
  toggleExplorerPathInfo,
  clearExplorerRoot,
  goTop,
  copyCode,
})

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  const m = e.metaKey || e.ctrlKey;
  if (m && e.key === 'p') { e.preventDefault(); if (md) printDoc(); }
  if (m && e.key === 'o') { e.preventDefault(); openFile(); }
  if (m && e.key === 't') { e.preventDefault(); newFile(); }
  if (m && e.key === 'n') { e.preventDefault(); newWindow(); }
  if (m && e.key === 'w') { e.preventDefault(); closeCurrentTab(); }
  if (m && e.key === 'u') { e.preventDefault(); toggleSource(); }
  if (m && e.key === 'f') { e.preventDefault(); if (!sourceMode) toggleSearch(); }
  if (m && e.key === 's' &&  e.shiftKey) { e.preventDefault(); saveFileAs(); }
  if (m && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
  if (m && e.shiftKey && (e.key === '}' || e.code === 'BracketRight')) { e.preventDefault(); switchToNextTab(); }
  if (m && e.shiftKey && (e.key === '{' || e.code === 'BracketLeft'))  { e.preventDefault(); switchToPrevTab(); }
  if (e.key === 'Escape') { closeSearch(); }
  if (e.key === 'Escape') { hideAppContextMenu(); }
});
document.addEventListener('click', () => { hideAddMenu(); hideAppContextMenu(); });
