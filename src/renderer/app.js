let editorController;
let explorerController;

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
      if (editorController) editorController.updateModeButton();
    }
  },
});

/* ── State ── */
let md = '';
let sidebarOpen = true;
let activeTab = 'toc';
const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
let currentExplorerRoot = null;
let explorerShowFullPath = false;
let toastTimer = null;
const WELCOME_GUIDE_DISMISSED_KEY = 'mdv-welcome-guide-dismissed';
let $;
let workspaceController;

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
  getTabCount: () => workspaceController ? workspaceController.getTabCount() : 0,
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

/* ── API calls (Electron IPC) ── */
async function openFile() {
  try {
    const data = JSON.parse(await window.api.openFileDialog());
    if (data.cancelled) return;
    if (data.files) data.files.forEach(f => { load(f); });
    else if (data.content !== undefined) load(data);
  } catch(e) { console.error(e); }
}

async function load(data) {
  if (data.error)     { alert('파일 오류: ' + data.error); return; }
  if (data.cancelled) return;
  await workspaceController.createTab(data);
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

function showEmptyState() {
  $.content.innerHTML = EMPTY_HTML;
  $.content.classList.add('is-empty');
  $.content.style.display = '';
  $.sourceView.style.display = 'none';
  document.title = 'MDV';
  if ($.btnMode) { $.btnMode.style.display = 'none'; $.btnMode.classList.remove('source-active'); }
  markdownController.resetEmptyStats();
  if (editorController) editorController.setSourceMode(false);
  md = '';
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
  const activeTab = workspaceController ? workspaceController.getActiveTab() : null;
  if ($.btnSave) $.btnSave.disabled = !activeTab || !activeTab.dirty;
  if ($.btnPrint) $.btnPrint.disabled = !activeTab;
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

function closeCurrentTab() { workspaceController.closeCurrentTab(); }
function switchToNextTab() { workspaceController.switchToNextTab(); }
function switchToPrevTab() { workspaceController.switchToPrevTab(); }

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

  editorController = window.MDVEditor.createEditorController({
    getRefs: () => $,
    getMarkdown: () => md,
    setMarkdown: value => { md = value; },
    getActiveTab: () => workspaceController ? workspaceController.getActiveTab() : null,
    rerenderTabBar: () => { if (workspaceController) workspaceController.renderTabBar(); },
    onSourceInput: value => { if (workspaceController) workspaceController.updateActiveTabDirtyFromEditor(value); },
    render,
    closeSearch,
  });

  workspaceController = window.MDVWorkspace.createWorkspaceController({
    getRefs: () => $,
    markdownController,
    render,
    applySourceMode: () => editorController.applySourceMode(),
    showEmptyState,
    watchFile,
    updateToolbarActions,
    updateEntryAffordance,
    maybeShowWelcomeGuide,
    showAppContextMenu,
    getSourceMode: () => editorController.getSourceMode(),
    setSourceMode: value => { editorController.setSourceMode(value); },
    setMarkdown: value => { md = value; },
    confirmClose: message => confirm(message),
    openNewWindow: path => window.api.newWindow(path),
  });

  explorerController = window.MDVExplorer.createExplorerController({
    getRefs: () => $,
    api: window.api,
    load,
    switchToExplorerTab: () => switchTab('explorer'),
    showAppContextMenu,
    clearExplorerRoot,
    syncExplorerHeader,
    getCurrentExplorerRoot: () => currentExplorerRoot,
    setCurrentExplorerRoot: value => { currentExplorerRoot = value; },
    setExplorerShowFullPath: value => { explorerShowFullPath = value; },
  });

  editorController.bindEditorEvents();

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
    await workspaceController.handleExternalFileChange({ path: changedPath, content });
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

async function toggleSource() {
  await editorController.toggleSource();
}

/* ── Sidebar tabs ── */
function switchTab(tab) {
  activeTab = tab;
  $.panelToc.style.display      = tab === 'toc'      ? '' : 'none';
  $.panelExplorer.style.display = tab === 'explorer' ? 'flex' : 'none';
  $.sidebarTabs.dataset.active = tab;
  document.querySelectorAll('.stab').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); });
  if (!sidebarOpen) { sidebarOpen = true; $.sidebar.classList.remove('closed'); }
}

/* ── New window / new file ── */
async function newWindow() { await window.api.newWindow(null); }
let untitledCounter = 0;
async function newFile() {
  untitledCounter++;
  const name = untitledCounter === 1 ? 'untitled.md' : `untitled-${untitledCounter}.md`;
  await workspaceController.createTab({ content: '', filename: name, path: null });
  editorController.openInSourceMode();
}

/* ── Save ── */
async function saveFile() {
  const tab = workspaceController.getActiveTab();
  if (!tab) return;
  if (editorController.getSourceMode()) { tab.content = editorController.getEditorValue(); md = tab.content; }
  if (tab.path) {
    const res = JSON.parse(await window.api.saveFile(tab.path, tab.content));
    if (res.error) { alert('저장 실패: ' + res.error); return; }
    tab.savedContent = tab.content; tab.dirty = false; workspaceController.renderTabBar(); showToast('저장됨');
  } else {
    await saveFileAs();
  }
}

async function saveFileAs() {
  const tab = workspaceController.getActiveTab();
  if (!tab) return;
  if (editorController.getSourceMode()) { tab.content = editorController.getEditorValue(); md = tab.content; }
  const dlg = JSON.parse(await window.api.saveFileDialog(tab.filename));
  if (dlg.cancelled || dlg.error) return;
  const res = JSON.parse(await window.api.saveFile(dlg.path, tab.content));
  if (res.error) { alert('저장 실패: ' + res.error); return; }
  tab.path = dlg.path;
  tab.filename = res.filename;
  tab.savedContent = tab.content;
  tab.dirty = false;
  document.title = tab.filename.replace(/\.md$/i, '');
  workspaceController.renderTabBar();
  watchFile(tab.path);
  showToast('저장됨');
}

/* ── Directory explorer ── */
async function openFolder() {
  await explorerController.openFolder();
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
  if (m && e.key === 'f') { e.preventDefault(); if (!editorController.getSourceMode()) toggleSearch(); }
  if (m && e.key === 's' &&  e.shiftKey) { e.preventDefault(); saveFileAs(); }
  if (m && e.key === 's' && !e.shiftKey) { e.preventDefault(); saveFile(); }
  if (m && e.shiftKey && (e.key === '}' || e.code === 'BracketRight')) { e.preventDefault(); switchToNextTab(); }
  if (m && e.shiftKey && (e.key === '{' || e.code === 'BracketLeft'))  { e.preventDefault(); switchToPrevTab(); }
  if (e.key === 'Escape') { closeSearch(); }
  if (e.key === 'Escape') { hideAppContextMenu(); }
});
document.addEventListener('click', () => { hideAddMenu(); hideAppContextMenu(); });
