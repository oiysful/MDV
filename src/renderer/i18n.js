(function (globalScope) {
  // The app's UI strings, Korean and English (plan 31). Korean is the original wording, kept
  // character for character; English was added alongside it. A value is either a string or a
  // function of its arguments, so each language owns its whole sentence -- that is how Korean
  // particles (이(가)) and English plurals stay out of the call sites.
  //
  // Values used through data-i18n-html / innerHTML are fixed markup written here, never built
  // from user input; the only arguments any value takes are file names, counts, versions and
  // error text, and none of those go through the -html path.
  const STRINGS = {
    ko: {
      // Toolbar and the open menu
      'open.button': '열기',
      'open.hintTitle': '파일/폴더 열기',
      'open.hintSub': '여기서 바로 시작',
      'add.newFile': '새 파일 (⌘T)',
      'add.openFolder': '폴더 열기 (⌘⇧O)',
      'add.openFile': '파일 열기 (⌘O)',
      'toolbar.sidebar': '좌측 패널 (⌘B)',
      'toolbar.mode': '소스/미리보기 (⌘U)',
      'toolbar.modeLabel': '미리보기',
      'toolbar.split': '분할뷰',
      'toolbar.splitClose': '분할뷰 닫기',
      'toolbar.wrap': '줄바꿈',
      'toolbar.wrapOff': '줄바꿈 끄기',
      'toolbar.search': '검색 (⌘F)',
      'toolbar.copyAll': '전체 복사',
      'toolbar.save': '저장 (⌘S)',
      'toolbar.print': '인쇄 (⌘P)',
      'toolbar.exportPdf': 'PDF 내보내기',
      'mode.preview': '미리보기 (⌘U)',
      'mode.edit': '편집 (⌘U)',
      'theme.auto': '시스템 테마',
      'theme.light': '밝게',
      'theme.dark': '어둡게',

      // Shared action names (shortcuts guide, empty state, welcome guide, menus)
      'action.openFile': '파일 열기',
      'action.openFolder': '폴더 열기',
      'action.newFile': '새 파일',
      'action.newWindow': '새 창',
      'action.closeTab': '탭 닫기',
      'action.save': '저장',
      'action.saveAs': '다른 이름으로 저장',
      'action.toggleSource': '소스 보기',
      'action.splitView': '분할뷰',
      'action.toggleSidebar': '좌측 패널 표시/숨기기',
      'action.find': '찾기',
      'action.print': '인쇄',
      'action.nextTab': '다음 탭',
      'action.prevTab': '이전 탭',
      'action.close': '닫기',
      'action.closeGuide': '안내 닫기',
      'action.later': '나중에',
      'action.revealInFinder': 'Finder에 표시',
      'action.closeFolder': '폴더 닫기',

      // Update banner
      'update.available': version => `MDV ${version} 버전이 있습니다`,
      'update.releaseNotes': '릴리스 노트',
      'update.copyCommand': 'brew upgrade 명령어 복사',
      'update.commandCopied': '명령어가 복사되었습니다',

      // Welcome guide
      'welcome.title': '처음 시작하기',
      'welcome.body': '좌측 상단의 <strong>열기</strong> 버튼으로 파일이나 폴더를 바로 불러올 수 있어요.',
      'welcome.itemFile': '<strong>파일 열기</strong>: 단일 Markdown 문서 열기',
      'welcome.itemFolder': '<strong>폴더 열기</strong>: 문서 묶음을 탐색기 탭에서 보기',
      'welcome.itemDrop': '<strong>드래그 앤 드롭</strong>: <code>.md</code>, <code>.markdown</code> 파일을 바로 놓기',
      'welcome.callout': '기본 앱으로 쓰고 싶다면 Finder에서 Markdown 파일 선택 → <strong>정보 가져오기</strong> → <strong>Open with</strong> → <strong>MDV</strong> → <strong>Change All</strong> 순서로 지정하세요.',

      // Default-app guide
      'defaultApp.title': 'Markdown 기본 앱 등록',
      'defaultApp.intro': '마크다운 문서(<code>.md</code>, <code>.markdown</code> 확장자)를 편리하게 보기 위해서 아래의 단계를 진행해주세요.',
      'defaultApp.step1': 'Finder에서 마크다운 문서(<code>.md</code>, <code>.markdown</code>) 우클릭',
      'defaultApp.step2': '정보 가져오기',
      'defaultApp.step3': '다음으로 열기 드롭다운 &gt; MDV 선택',
      'defaultApp.step4': '<code>모두 변경...</code> 버튼 클릭',
      'defaultApp.doNotShow': '다시 보지 않기',
      'defaultApp.ok': '확인했습니다.',

      'shortcuts.title': '단축키',

      // Search bar
      'search.placeholder': '검색…',
      'search.prev': '이전 (Shift+Enter)',
      'search.next': '다음 (Enter)',
      'search.close': '닫기 (Esc)',
      'search.none': '없음',

      'drop.here': '여기에 놓으세요',
      'split.divider': '분할뷰 폭 조절',
      'goTop': '맨 위로',

      // Sidebar and explorer
      'sidebar.toc': '목차',
      'sidebar.explorer': '탐색기',
      'explorer.selectFolder': '폴더를 선택하세요',
      'explorer.showPath': '경로 보기',
      'explorer.treeLabel': '파일 탐색기',
      'explorer.emptyHint': '위의 <strong>열기</strong> 버튼으로<br>폴더를 열어 탐색하세요.',
      'explorer.loading': '로드 중…',
      'explorer.noMarkdown': '.md 파일 없음',
      'explorer.watchTooLarge': '폴더가 너무 커서 실시간 변경 감지를 껐습니다',
      'explorer.watchStopped': '폴더의 실시간 변경 감지가 중단되었습니다',

      // Tabs
      'tabs.label': '열린 파일 탭',
      'tabs.conflict': '이 파일이 외부에서 변경되었습니다. 탭을 열면 확인합니다.',
      'tabs.deleted': '이 파일이 외부에서 삭제되었습니다. 저장하면 다시 생성됩니다.',
      'tabs.openInNewWindow': '새 창으로 열기',
      'tabs.closeOthers': '다른 탭 닫기',
      'tabs.closeAll': '모든 탭 닫기',
      'confirm.closeDirtyTab': '저장하지 않은 변경 사항이 있습니다. 닫으시겠습니까?',
      'confirm.closeOthersDirty': '저장하지 않은 변경 사항이 있는 다른 탭이 있습니다. 닫으시겠습니까?',
      'confirm.closeAllDirty': '저장하지 않은 변경 사항이 있는 탭이 있습니다. 모두 닫으시겠습니까?',
      'confirm.reloadChanged': filename => `"${filename}"이(가) 외부에서 변경되었습니다. 편집 중인 내용을 버리고 디스크 내용으로 다시 불러오시겠습니까?`,

      // Empty state
      'empty.title': '열린 파일 없음',
      'empty.sub': '좌측 상단의 <strong>열기</strong> 버튼을 누르거나<br>\n    아래 버튼 또는 드래그 앤 드롭으로 시작하세요',

      // Document, saving, copying
      'doc.words': words => `${words.toLocaleString()} 단어`,
      'doc.minutes': minutes => `약 ${minutes}분`,
      'frontmatter.truncated': '생략됨',
      'frontmatter.metadata': '메타데이터: ',
      'code.copy': '코드 복사',
      'code.copyTooltip': '복사',
      'confirm.overwriteChanged': '이 파일이 외부에서 변경되었습니다. 편집 중인 내용으로 덮어쓰시겠습니까?',
      'confirm.overwriteUnreadable': '이 파일의 디스크 상태를 확인할 수 없습니다. 그래도 덮어쓰시겠습니까?',
      'toast.saved': '저장됨',
      'toast.pdfSaved': 'PDF 저장됨',
      'toast.copied': '복사됨',
      'toast.copyFailed': '복사 실패',
      'toast.codeCopied': '코드 복사됨',
      'toast.codeCopyFailed': '코드 복사 실패',
      'toast.skippedFiles': count => `${count}개 파일을 열 수 없어 건너뛰었습니다`,
      'error.file': message => '파일 오류: ' + message,
      'error.saveFailed': message => '저장 실패: ' + message,
      'error.revealFailed': message => `Finder 표시 실패: ${message}`,
      'error.exportPdfFailed': message => `PDF 내보내기 실패: ${message}`,
      'error.linkNeedsSave': '링크 열기 실패: 문서를 저장한 뒤에 상대 경로 링크를 열 수 있습니다.',
      'error.linkFailed': message => `링크 열기 실패: ${message}`,

      // Main process: errors returned over IPC, the close-window dialog
      'error.noActiveWindow': '활성 창을 찾을 수 없습니다.',
      'error.linkNotAllowed': '허용되지 않은 링크입니다.',
      'error.noPath': '경로가 없습니다.',
      'error.fileNotFound': targetPath => `파일을 찾을 수 없습니다: ${targetPath}`,
      'dialog.unsavedMessage': '저장하지 않은 변경이 있습니다.',
      'dialog.unsavedDetail': '변경 내용을 저장하지 않고 창을 닫으시겠습니까?',
      'dialog.close': '닫기',
      'dialog.cancel': '취소',

      // Main process: the application menu
      'menu.file': '파일',
      'menu.edit': '편집',
      'menu.view': '보기',
      'menu.window': '창',
      'menu.help': '도움말',
      'menu.exportPdf': 'PDF로 내보내기…',
      'menu.toggleTheme': '테마 전환',
      'menu.shortcuts': '단축키',
      // role items: Electron fills these in English whatever the system language (measured on
      // v1.4.0, plan 31), so both languages name them explicitly.
      'role.about': name => `${name}에 관하여`,
      'role.services': '서비스',
      'role.hide': name => `${name} 가리기`,
      'role.hideOthers': '기타 가리기',
      'role.unhide': '모두 보기',
      'role.quit': name => `${name} 종료`,
      'role.undo': '실행 취소',
      'role.redo': '실행 복귀',
      'role.cut': '오려두기',
      'role.copy': '복사하기',
      'role.paste': '붙여넣기',
      'role.selectAll': '전체 선택',
      'role.reload': '다시 불러오기',
      'role.forceReload': '강제로 다시 불러오기',
      'role.toggleDevTools': '개발자 도구 표시/숨기기',
      'role.resetZoom': '실제 크기',
      'role.zoomIn': '확대',
      'role.zoomOut': '축소',
      'role.togglefullscreen': '전체 화면 전환',
      'role.minimize': '최소화',
      'role.zoom': '확대/축소',
      'role.front': '모두 앞으로 가져오기',
    },
    en: {
      'open.button': 'Open',
      'open.hintTitle': 'Open a file or folder',
      'open.hintSub': 'Start here',
      'add.newFile': 'New File (⌘T)',
      'add.openFolder': 'Open Folder… (⌘⇧O)',
      'add.openFile': 'Open File… (⌘O)',
      'toolbar.sidebar': 'Sidebar (⌘B)',
      'toolbar.mode': 'Source/Preview (⌘U)',
      'toolbar.modeLabel': 'Preview',
      'toolbar.split': 'Split View',
      'toolbar.splitClose': 'Close Split View',
      'toolbar.wrap': 'Wrap lines',
      'toolbar.wrapOff': 'Don’t wrap lines',
      'toolbar.search': 'Find (⌘F)',
      'toolbar.copyAll': 'Copy all',
      'toolbar.save': 'Save (⌘S)',
      'toolbar.print': 'Print (⌘P)',
      'toolbar.exportPdf': 'Export as PDF',
      'mode.preview': 'Preview (⌘U)',
      'mode.edit': 'Edit source (⌘U)',
      'theme.auto': 'System theme',
      'theme.light': 'Light theme',
      'theme.dark': 'Dark theme',

      'action.openFile': 'Open File',
      'action.openFolder': 'Open Folder',
      'action.newFile': 'New File',
      'action.newWindow': 'New Window',
      'action.closeTab': 'Close Tab',
      'action.save': 'Save',
      'action.saveAs': 'Save As',
      'action.toggleSource': 'View Source',
      'action.splitView': 'Split View',
      'action.toggleSidebar': 'Show/Hide Sidebar',
      'action.find': 'Find',
      'action.print': 'Print',
      'action.nextTab': 'Next Tab',
      'action.prevTab': 'Previous Tab',
      'action.close': 'Close',
      'action.closeGuide': 'Dismiss',
      'action.later': 'Later',
      'action.revealInFinder': 'Show in Finder',
      'action.closeFolder': 'Close Folder',

      'update.available': version => `MDV ${version} is available`,
      'update.releaseNotes': 'Release Notes',
      'update.copyCommand': 'Copy “brew upgrade” Command',
      'update.commandCopied': 'Command copied',

      'welcome.title': 'Getting Started',
      'welcome.body': 'Use the <strong>Open</strong> button at the top left to open a file or folder.',
      'welcome.itemFile': '<strong>Open File</strong>: open a single Markdown document',
      'welcome.itemFolder': '<strong>Open Folder</strong>: browse a set of documents in the Explorer tab',
      'welcome.itemDrop': '<strong>Drag and drop</strong>: drop <code>.md</code> or <code>.markdown</code> files onto the window',
      'welcome.callout': 'To make MDV your default app, select a Markdown file in Finder → <strong>Get Info</strong> → <strong>Open with</strong> → <strong>MDV</strong> → <strong>Change All…</strong>.',

      'defaultApp.title': 'Set MDV as the Default Markdown App',
      'defaultApp.intro': 'To open Markdown documents (<code>.md</code>, <code>.markdown</code>) in MDV by default, follow these steps.',
      'defaultApp.step1': 'In Finder, Control-click a Markdown document (<code>.md</code>, <code>.markdown</code>)',
      'defaultApp.step2': 'Choose Get Info',
      'defaultApp.step3': 'In the Open with menu, choose MDV',
      'defaultApp.step4': 'Click <code>Change All…</code>',
      'defaultApp.doNotShow': 'Don’t show this again',
      'defaultApp.ok': 'Got It',

      'shortcuts.title': 'Keyboard Shortcuts',

      'search.placeholder': 'Search…',
      'search.prev': 'Previous (Shift+Enter)',
      'search.next': 'Next (Enter)',
      'search.close': 'Close (Esc)',
      'search.none': 'No results',

      'drop.here': 'Drop to open',
      'split.divider': 'Resize split view',
      'goTop': 'Back to top',

      'sidebar.toc': 'Contents',
      'sidebar.explorer': 'Explorer',
      'explorer.selectFolder': 'Choose a folder',
      'explorer.showPath': 'Show path',
      'explorer.treeLabel': 'File explorer',
      'explorer.emptyHint': 'Open a folder with the<br><strong>Open</strong> button above.',
      'explorer.loading': 'Loading…',
      'explorer.noMarkdown': 'No Markdown files',
      'explorer.watchTooLarge': 'This folder is too large to watch for changes',
      'explorer.watchStopped': 'MDV stopped watching this folder for changes',

      'tabs.label': 'Open files',
      'tabs.conflict': 'This file was changed outside MDV. You’ll be asked what to do when you switch to this tab.',
      'tabs.deleted': 'This file was deleted outside MDV. Saving will create it again.',
      'tabs.openInNewWindow': 'Open in New Window',
      'tabs.closeOthers': 'Close Other Tabs',
      'tabs.closeAll': 'Close All Tabs',
      'confirm.closeDirtyTab': 'You have unsaved changes. Close anyway?',
      'confirm.closeOthersDirty': 'Some other tabs have unsaved changes. Close them anyway?',
      'confirm.closeAllDirty': 'Some tabs have unsaved changes. Close them all anyway?',
      'confirm.reloadChanged': filename => `“${filename}” was changed outside MDV. Discard your edits and reload it from disk?`,

      'empty.title': 'No file open',
      'empty.sub': 'Click <strong>Open</strong> at the top left,<br>\n    use a button below, or drag a file here',

      'doc.words': words => `${words.toLocaleString()} ${words === 1 ? 'word' : 'words'}`,
      'doc.minutes': minutes => `${minutes} min read`,
      'frontmatter.truncated': 'Truncated',
      'frontmatter.metadata': 'Metadata: ',
      'code.copy': 'Copy code',
      'code.copyTooltip': 'Copy',
      'confirm.overwriteChanged': 'This file was changed outside MDV. Overwrite it with your edits?',
      'confirm.overwriteUnreadable': 'MDV can’t check this file on disk. Overwrite it anyway?',
      'toast.saved': 'Saved',
      'toast.pdfSaved': 'PDF saved',
      'toast.copied': 'Copied',
      'toast.copyFailed': 'Couldn’t copy',
      'toast.codeCopied': 'Code copied',
      'toast.codeCopyFailed': 'Couldn’t copy code',
      'toast.skippedFiles': count => `Skipped ${count} ${count === 1 ? 'file' : 'files'} that couldn’t be opened`,
      'error.file': message => `File error: ${message}`,
      'error.saveFailed': message => `Couldn’t save: ${message}`,
      'error.revealFailed': message => `Couldn’t show in Finder: ${message}`,
      'error.exportPdfFailed': message => `Couldn’t export PDF: ${message}`,
      'error.linkNeedsSave': 'Couldn’t open the link: save the document first to open relative links.',
      'error.linkFailed': message => `Couldn’t open the link: ${message}`,

      'error.noActiveWindow': 'No active window was found.',
      'error.linkNotAllowed': 'This link isn’t allowed.',
      'error.noPath': 'No path was given.',
      'error.fileNotFound': targetPath => `File not found: ${targetPath}`,
      'dialog.unsavedMessage': 'You have unsaved changes.',
      'dialog.unsavedDetail': 'Close the window without saving your changes?',
      'dialog.close': 'Close',
      'dialog.cancel': 'Cancel',

      'menu.file': 'File',
      'menu.edit': 'Edit',
      'menu.view': 'View',
      'menu.window': 'Window',
      'menu.help': 'Help',
      'menu.exportPdf': 'Export as PDF…',
      'menu.toggleTheme': 'Switch Theme',
      'menu.shortcuts': 'Keyboard Shortcuts',
      'role.about': name => `About ${name}`,
      'role.services': 'Services',
      'role.hide': name => `Hide ${name}`,
      'role.hideOthers': 'Hide Others',
      'role.unhide': 'Show All',
      'role.quit': name => `Quit ${name}`,
      'role.undo': 'Undo',
      'role.redo': 'Redo',
      'role.cut': 'Cut',
      'role.copy': 'Copy',
      'role.paste': 'Paste',
      'role.selectAll': 'Select All',
      'role.reload': 'Reload',
      'role.forceReload': 'Force Reload',
      'role.toggleDevTools': 'Toggle Developer Tools',
      'role.resetZoom': 'Actual Size',
      'role.zoomIn': 'Zoom In',
      'role.zoomOut': 'Zoom Out',
      'role.togglefullscreen': 'Toggle Full Screen',
      'role.minimize': 'Minimize',
      'role.zoom': 'Zoom',
      'role.front': 'Bring All to Front',
    },
  }

  // Frozen: nothing at runtime should be able to rewrite a string another module will read.
  Object.values(STRINGS).forEach(Object.freeze)
  Object.freeze(STRINGS)

  const LOCALES = Object.keys(STRINGS)

  // Own keys only: a key like 'constructor' or '__proto__' must not resolve to a prototype
  // member of the table object.
  function has(key) {
    return Object.hasOwn(STRINGS.ko, key)
  }

  // The main process's policy: Korean for a Korean system, English for everything else.
  function resolveLocale(tag) {
    return /^ko(?:$|[-_])/i.test(String(tag || '')) ? 'ko' : 'en'
  }

  // A key missing from one language falls back to Korean rather than showing the key; the
  // unit test that compares the two tables is what keeps that from ever happening.
  function translate(locale, key, args) {
    const table = Object.hasOwn(STRINGS, locale) ? STRINGS[locale] : STRINGS.ko
    const value = Object.hasOwn(table, key) ? table[key] : (has(key) ? STRINGS.ko[key] : undefined)
    if (value === undefined) return key
    return typeof value === 'function' ? value(...args) : value
  }

  function createTranslator(locale) {
    return (key, ...args) => translate(locale, key, args)
  }

  // The renderer's locale is whatever the main process passed in (preload exposes it as
  // api.locale). Anything else -- a jsdom unit test, a page without the preload -- is Korean.
  // This is the opposite of resolveLocale's default on purpose: the renderer never decides,
  // it only follows, and the unit tests assert the Korean strings the app was written with.
  function currentLocale() {
    const passed = globalScope.api && globalScope.api.locale
    return LOCALES.includes(passed) ? passed : 'ko'
  }

  function t(key, ...args) {
    return translate(currentLocale(), key, args)
  }

  // Static index.html markup names its strings with data-i18n attributes; this fills them in
  // once at startup (see the bottom of this file). It runs for Korean too, so the table -- not
  // the HTML -- is the single source of the wording, and the Korean in index.html is only what
  // shows before this script runs. An attribute naming a key the table doesn't have is left
  // alone rather than filled with the key itself (which the -html path would put into innerHTML).
  //   data-i18n          textContent (the element holds plain text only)
  //   data-i18n-html     innerHTML, from the fixed markup in STRINGS
  //   data-i18n-label    title and aria-label (most buttons carry the same text in both)
  //   data-i18n-title / data-i18n-aria-label / data-i18n-placeholder   that one attribute
  function applyStaticTranslations(documentRef) {
    const locale = currentLocale()
    documentRef.documentElement.lang = locale
    const each = (attr, apply) => {
      for (const el of documentRef.querySelectorAll(`[${attr}]`)) {
        const key = el.getAttribute(attr)
        if (has(key)) apply(el, translate(locale, key, []))
      }
    }
    each('data-i18n', (el, text) => { el.textContent = text })
    each('data-i18n-html', (el, html) => { el.innerHTML = html })
    each('data-i18n-label', (el, text) => {
      el.setAttribute('title', text)
      el.setAttribute('aria-label', text)
    })
    each('data-i18n-title', (el, text) => el.setAttribute('title', text))
    each('data-i18n-aria-label', (el, text) => el.setAttribute('aria-label', text))
    each('data-i18n-placeholder', (el, text) => el.setAttribute('placeholder', text))
  }

  const api = { STRINGS, LOCALES, has, resolveLocale, createTranslator, currentLocale, t, applyStaticTranslations }
  globalScope.MDVI18n = api

  // index.html loads this script after all of its markup and before the other app scripts, so
  // translating here -- not at the top of app.js, the last script -- swaps the static Korean out
  // before the remaining scripts run and the first paint can show it. Only in the app: preload
  // is what defines api; a jsdom test's document is left to the test.
  if (globalScope.api && globalScope.document) applyStaticTranslations(globalScope.document)

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
