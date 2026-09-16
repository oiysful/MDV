# 17. 단축키 추가(⌘B 좌측 패널, ⌘⇧O 폴더 열기) · + 메뉴 단축키 안내 · 전체화면 툴바 좌측 여백

## 상태
**구현·검증 완료** (2026-09-16, `c76f6c3` 외, 브랜치 `feat/shortcuts-fullscreen-toolbar`).
4건 모두 아래 설계대로 구현했다. 테스트 102 Electron / 210 unit / 12 controller 통과.
맨 아래 **수동 검증 체크리스트 7항목을 Ian이 실제 키보드로 전부 확인**했다. 그중 2번(편집기 포커스
상태의 ⌘B가 굵게만 적용)이 이 계획서가 끝까지 검증하지 못한 유일한 가정 — 실제 ⌘B 입력에서 macOS가
`triggeredByAccelerator`를 세우는지 — 의 판정이었고, 통과했다. **1차 설계가 확정이며 아래
"발동 순서 가정이 틀렸을 때"의 대비책은 불필요하다.** (기록용으로 남겨 둔다.)

구현하며 계획서에서 달라진 점과 새로 알아낸 것:

- **`switchTab`의 force-open에도 같은 가드가 필요했다** (계획에 없던 항목). `openFolder` →
  `switchToExplorerTab()` → `switchTab('explorer')`는 `toggleSidebar`의 분할뷰 가드를 우회해
  사이드바를 다시 연다. 그러면 `#btn-sidebar`는 `disabled` 그대로고 두 사이드바 명령은 모두 가드에
  걸려, **어떤 방법으로도 닫을 수 없는 상태**가 된다(탈출구는 ⌘\ 두 번). ⌘⇧O가 이걸 키 한 번
  거리로 만들어서, 이번 작업 안에서 같이 막았다.
- **메뉴 핸들러의 분기는 테스트로 고정할 수 있다** (계획의 "재현 불가"는 절반만 맞았다).
  `MenuItem#click`은 래퍼라 `click(event, focusedWindow, focusedWebContents)`로 호출되고 항목의
  핸들러를 `click(menuItem, focusedWindow, event)`로 되부른다 — **1번 인자가 핸들러의 3번째
  파라미터로 들어간다.** 그래서 `target.click({ triggeredByAccelerator: true }, win, {})`는
  accelerator 분기에 실제로 도달한다(실측). 다만 이건 플래그를 **합성**한 것이라, 진짜 ⌘B에서
  macOS가 그 플래그를 세우는지는 여전히 수동 검증 2번이 판정한다.
- **실제 키 입력은 어느 합성 경로로도 재현되지 않는다** (실측으로 확인). `sendInputEvent`뿐 아니라
  Playwright의 `page.keyboard.press('Meta+b')`도 네이티브 메뉴 키 매칭에 닿지 않는다(굵게만 적용되고
  사이드바는 그대로였다). 다음 사람이 스위트의 기본 도구라는 이유로 후자에 손대지 않도록 적어 둔다.

원래 결정은 그대로다. ⌘B는 소스 편집기의 "굵게"와 충돌하며, Ian의 결정은 **포커스로 구분**이다.
편집기에 커서가 있으면 굵게, 그 외에는 좌측 패널 토글로 동작한다.

## Context

Ian의 요청 원문:

1. 좌측 패널 표시/숨김 토글 버튼에 `⌘B` 단축키를 추가하자.
2. 폴더 열기에 `⌘⇧O` 단축키를 추가하자.
3. 좌측 상단 + 버튼을 누르면 나오는 메뉴에서, 폴더/파일 열기 옆에도 새 파일처럼 단축키 안내를 붙이자.
4. 전체화면으로 전환하면 툴바 좌측(신호등 버튼 자리)이 비어 있다. 그 자리로 + 버튼, 좌측 패널
   토글, 단어 수, 읽기 시간을 당겨올 수 있는지 조사해 달라.

---

# 공통 배경: 단축키가 앱에 들어오는 경로

- 단축키는 모두 네이티브 메뉴의 `accelerator`로 등록되어 있다(`src/main.js#buildMenu`, 891~1037줄).
  메뉴 click 핸들러가 `sendRendererCommand(name, win)`(`main.js:885`)으로 `renderer-command` IPC를
  보낸다. 렌더러는 이를 `preload.js:32 onRendererCommand` → `app-shell.js:111`을 거쳐
  `app.js#createRendererCommands`(244줄~)의 명령 맵으로 실행한다.
- 렌더러 전역 keydown에서는 메뉴 단축키를 **중복 처리하지 않는다**(`app-runtime.js:433~436` 주석).
- **메뉴 단축키는 렌더러가 `preventDefault()`해도 함께 발동한다.** 근거는 이 저장소 이력이다.
  `fb2284d`(2026-07-14)에서 제거된 옛 렌더러 핸들러는
  `if (modifier && event.key === 't') { event.preventDefault(); void newFile() }`처럼
  `preventDefault()`를 호출하고 있었다. 그런데도 메뉴 ⌘T가 같이 발동해 "⌘T 한 번에 탭 두 개"
  버그가 났다(커밋 메시지, `menu-and-guides.test.js:90` 주석). 2017년 보고인
  [electron#11116](https://github.com/electron/electron/issues/11116)(Electron 1.7, "렌더러
  `preventDefault`가 메뉴 단축키를 막는다")과는 반대 결과다. 현재 Electron(42.8)에서 이 앱으로 겪은
  실제 사례를 기준으로 삼는다.
- **실제 키 입력 → 메뉴 단축키 경로는 자동 테스트로 재현할 수 없다.** `webContents.sendInputEvent`로
  ⌘B를 합성해 실측해 보니, 렌더러 핸들러가 전혀 없는 경우에도 메뉴가 발동하지 않았다
  (`menuFired=0`). 합성 이벤트에는 macOS 네이티브 이벤트가 없어 메뉴 키 매칭 경로를 타지 않기
  때문이다. 그래서 기존 테스트도 메뉴 click 핸들러를 직접 부르거나(`clickApplicationMenuItem`)
  명령 IPC를 직접 쏜다(`emitRendererCommand`). 실제 키보드 동작은 **수동 검증**으로 확인한다(아래
  체크리스트).

---

# 1. ⌘B — 좌측 패널 표시/숨김

## 현황
- 버튼: `index.html:1372` `#btn-sidebar`(`data-command="toggleSidebar"`, `title="패널"`).
  `data-shortcut`이 없다.
- 메뉴: 좌측 패널 항목 자체가 없다.
- 동작: `app-runtime.js:197 toggleSidebar()`. 분할뷰 여부를 검사하지 않는다.
- 분할뷰에서는 패널을 강제로 닫고 버튼만 `disabled`로 막는다(`editor.js:217`). 버튼 클릭은 막히지만
  명령 경로에는 막는 조건이 없다. 단축키를 추가하면 **분할뷰에서도 패널을 여는 우회 경로**가 생긴다.

## 충돌: 소스 편집기의 ⌘B = 굵게
`editor.js:588`은 `modifier && (key === 'b' || key === 'i')`일 때 `**`/`*` 마커를 토글하고
`preventDefault()`한다. `editor-source-mode.test.js:227`이 이 동작을 보장한다. 위 공통 배경대로 메뉴
단축키는 `preventDefault()`와 무관하게 발동한다. 따라서 가드 없이 ⌘B 메뉴 단축키를 추가하면, 편집기
안에서 ⌘B를 누를 때 **굵게와 패널 토글이 동시에 일어난다.**

## 결정: 포커스로 구분 (Ian 선택)
- 소스 편집기(`#source-editor`)에 포커스가 있으면: 굵게만 적용한다(기존 동작 유지). 패널은 그대로 둔다.
- 그 외(미리보기, 툴바, 검색창 등)에서는 좌측 패널을 토글한다.
- 분할뷰에서는 패널 토글이 동작하지 않는다(버튼이 `disabled`인 것과 일치). 편집기 포커스라면
  굵게만 적용한다.
- 메뉴를 **마우스로** 클릭한 경우는 포커스와 상관없이 토글한다. 사용자가 명시적으로 고른 동작이기
  때문이다.

## 설계
1. `main.js` "보기" 메뉴에 항목을 추가한다(위치는 "분할뷰" 다음 권장).
   ```js
   {
     label: '좌측 패널 표시/숨기기',
     accelerator: 'CmdOrCtrl+B',
     // A real ⌘B press also reaches the source editor's own keydown (bold) -- menu
     // accelerators fire even when the renderer preventDefault()s (fb2284d's ⌘T
     // double-fire). The shortcut variant lets the renderer skip the toggle when the
     // editor owns the key; a mouse click on the menu item always toggles.
     click: (_, win, event) => sendRendererCommand(
       event?.triggeredByAccelerator ? 'toggleSidebarFromShortcut' : 'toggleSidebar', win),
   },
   ```
   `triggeredByAccelerator`는 Electron `KeyboardEvent` 구조체에 문서화된 속성이다("whether an
   accelerator was used to trigger the event as opposed to another user gesture like mouse click").
2. `app-runtime.js`
   - `toggleSidebar()` 맨 앞에 `if (getEditorController()?.getSplitMode()) return`을 추가한다.
     `applySidebarOpen()`에는 넣지 않는다. 분할뷰 진입·해제 때 패널을 강제로 닫고 복원하는
     `setSplitMode`(`editor.js:211~`)가 이 함수를 쓰기 때문이다(`app-runtime.js:493`에서
     `setSidebarOpen: applySidebarOpen`으로 넘겨짐).
   - 분할뷰에서 메뉴 항목 "좌측 패널 표시/숨기기"는 **활성 상태로 보이지만 누르면 아무 일도 없다.**
     main 프로세스는 렌더러의 분할뷰 상태를 알 방법(채널)이 없어서 `enabled: false`로 만들 수 없다.
     의도된 동작이므로, 이를 위해 새 채널을 만들거나 버그로 보고하지 않는다.
   - 새 `toggleSidebarFromShortcut()`: `documentRef.activeElement === getRefs().sourceEditor`이면
     아무것도 하지 않는다(굵게는 편집기 keydown이 이미 처리함). 그 외에는 `toggleSidebar()`를 부른다.
     반환 객체에 추가한다.
3. `app.js#createRendererCommands`에 `toggleSidebarFromShortcut: () => runtimeController.toggleSidebarFromShortcut()`를
   추가한다.
4. `index.html`
   - `#btn-sidebar`에 `data-shortcut="⌘B"`를 추가하고, `title`/`aria-label`을 `"좌측 패널 (⌘B)"`로 바꾼다.
     ⌘를 누르고 있을 때 뜨는 배지는 "실제 시스템 단축키가 있는 버튼"에만 붙는다는 규칙이 있다
     (`index.html:215` 주석, README 102줄). 그래서 메뉴 단축키와 **같은 커밋**에 넣는다.
   - 단축키 안내 목록(`#shortcuts-guide`, 1544줄~)에 `<li><span>좌측 패널 표시/숨기기</span><kbd>⌘B</kbd></li>`를 추가한다.

## 왜 렌더러 keydown이 아니라 메뉴 단축키인가
렌더러 keydown으로만 처리하면 충돌 가드는 더 단순해진다(`event.defaultPrevented`만 보면 됨). 대신
메뉴에 "⌘B"가 표시되지 않고, ⌘ 배지 규칙("실제 시스템 단축키")과도 어긋난다. 또 앱 전체가
"단축키는 메뉴가 소유한다"(`app-runtime.js:433`)는 규칙을 따르고 있어, 예외를 하나 만드는 셈이 된다.

## 발동 순서 가정이 틀렸을 때
- **실제로는 렌더러가 먼저 받고 `preventDefault` 시 메뉴가 발동하지 않는 경우**: 가드가 쓰일 일이
  없을 뿐, 동작은 그대로 맞다.
- **메뉴만 발동하고 편집기 keydown이 오지 않는 경우**: 편집기에서 굵게가 동작하지 않는다. 수동
  검증 2번에서 드러난다. 이때는 `toggleSidebarFromShortcut`이 편집기 포커스일 때 굵게 토글을
  직접 수행하도록 바꾼다(`editor.js`의 `computeInlineMarkerToggle` 적용부를 함수로 노출).
- **실제 ⌘B 입력에서 `triggeredByAccelerator`가 `true`로 오지 않는 경우**: 이 값은 문서에는 있지만,
  합성 입력이 메뉴 단축키 경로에 닿지 않아 이번 조사에서 실측하지 못했다. 값이 비어 있거나 false면
  메뉴가 가드 없는 `toggleSidebar`로 보내 버린다. 그러면 편집기에서 굵게와 패널 토글이 동시에
  일어나 원래 문제가 그대로 나간다. 수동 검증 2번에서 드러나며, 대비책은 오히려 더 단순하다. 메뉴
  항목이 **항상** `toggleSidebarFromShortcut`만 보내게 하고 명령 두 개로 나눈 구조를 없앤다. 대가는
  하나다. 편집기에 포커스가 있을 때 메뉴를 마우스로 눌러도 패널이 토글되지 않는다. 대신 검증할 수
  없는 값에 의존하지 않게 되고, `app.js` 명령 추가도 필요 없다. "포커스로 구분"이라는 결정도 그대로
  지켜진다. 1차 설계는 현재 안으로 두고, 수동 검증에서 실패하면 이 대비책으로 바꾼다.

  **전환할 때 같이 고쳐야 하는 것** (구현 후 추가). 코드는 `main.js`의 메뉴 항목 `click` **한 줄**이
  전부지만, 테스트 두 개가 현재 2-명령 구조를 고정하고 있어 함께 바뀌어야 한다. 둘 다
  `menu-and-guides.test.js`에 있다.
  - `보기 > 좌측 패널 표시/숨기기 still toggles when the source editor holds focus` — 마우스 클릭이
    편집기 포커스와 무관하게 토글한다는 단언. 대비책에서는 성립하지 않으므로 기대값을 뒤집는다.
  - `the ⌘B menu item routes the accelerator and the mouse click to different commands` — 두 분기가
    서로 **다른** 명령으로 간다는 단언. 대비책에서는 분기 자체가 없어지므로 제거한다.

  이 두 개만 빨개지고 나머지는 초록으로 남는다. 그게 정상이며 버그 신호가 아니다.

## 테스트
- `menu-and-guides.test.js`
  - "보기 > 좌측 패널 표시/숨기기" 항목이 있고 `accelerator === 'CmdOrCtrl+B'`인지 확인한다
    (`Menu.getApplicationMenu()`로 조회).
  - `clickApplicationMenuItem`으로 누르면 `#sidebar.closed`가 토글되는지 확인한다.
  - `emitRendererCommand('toggleSidebarFromShortcut')`: 소스 편집기에 포커스가 있으면 패널이
    그대로이고, 본문에 포커스가 있으면 토글되는지 확인한다.
  - 분할뷰에서 `toggleSidebar`/`toggleSidebarFromShortcut` 명령을 보내도 패널이 닫힌 채인지
    확인한다. 분할뷰 전환 후에는 `armSidebarTransitionWatch`/`waitForSidebarTransition`으로
    대기한다(`smoke-helpers.js:85~` 주석).
- 기존 `editor-source-mode.test.js:227`(⌘B 굵게)은 변경 없이 통과해야 한다.

---

# 2. ⌘⇧O — 폴더 열기

## 현황
`main.js:915~918` "폴더 열기…" 메뉴 항목에 `accelerator`가 없다. 명령(`openFolder`, `app.js:248`)은
이미 있다.

## 충돌 검사
- 메뉴 단축키 목록(⌘O/S/⇧S/T/W/P/N/F/U/\/⇧]/⇧[)에 ⌘⇧O가 없다.
- 렌더러 keydown 리스너 8곳(`app-shell.js:285,304`, `app-runtime.js:437,458`, `explorer.js:166`,
  `editor.js:548`, `onboarding.js:78`, `workspace.js:227`) 중 `o` 키를 처리하는 곳이 없다.

## 설계
- `main.js` "폴더 열기…"에 `accelerator: 'CmdOrCtrl+Shift+O'`를 추가한다.
- `#shortcuts-guide`에 `<li><span>폴더 열기</span><kbd>⌘⇧O</kbd></li>`를 추가한다("파일 열기" 바로 다음).

## 테스트
`menu-and-guides.test.js`에서 "파일 > 폴더 열기…"의 `accelerator === 'CmdOrCtrl+Shift+O'`를 확인한다.

---

# 3. + 메뉴(#add-menu) 단축키 안내

## 현황
`index.html:1346~1368`:
- "새 파일"만 본문 텍스트, `title`, `aria-label` 세 곳에 모두 `(⌘T)`가 붙어 있다(1347, 1353줄).
- "폴더 열기"(1355줄)와 "파일 열기"(1361줄)에는 안내가 없다. 파일 열기는 ⌘O 단축키가 이미
  있는데도 표시되지 않던 **기존 누락**이다.

## 설계
기존 "새 파일 (⌘T)" 패턴을 그대로 따른다. 각 항목의 본문 텍스트, `title`, `aria-label` 세 곳을 모두
바꾼다.
- `폴더 열기` → `폴더 열기 (⌘⇧O)`
- `파일 열기` → `파일 열기 (⌘O)`

⌘⇧O 안내는 2번(메뉴 단축키)과 **같은 커밋**에 들어가야 한다. 안내만 먼저 들어가면 동작하지 않는
단축키를 표시하게 된다.

(선택 사항, 이번 범위 밖) macOS 메뉴처럼 단축키를 오른쪽 끝에 흐리게 정렬하는 방식은 "새 파일"까지
세 항목을 함께 바꿔야 해서 제외했다. 원하면 `.ctx-item` 안에 `<kbd class="ctx-shortcut">`를 두고
`margin-left:auto`로 정렬하면 된다.

## 테스트
기존 테스트(`tabs.test.js:62`, `explorer-and-shell.test.js:159`)는 `data-command` 셀렉터로 항목을
찾으므로 텍스트 변경의 영향을 받지 않는다. 필요하면 세 항목의 `title`에 단축키가 들어 있는지
확인하는 단언을 추가한다.

---

# 4. 전체화면에서 툴바 좌측 빈 영역

## 원인
`index.html:145~146`의 `.traffic-gap`(폭 70px 고정)은 macOS 신호등 버튼 자리를 비워 두는 여백이다
(`titleBarStyle: 'hiddenInset'`, `main.js:205`). 네이티브 전체화면에서는 신호등 버튼이 사라지지만,
이 여백은 그대로 남아 스크린샷처럼 빈 공간이 된다.

실측(1280×800 창 → 전체화면, 1512×982 화면): 전체화면에서도 `.traffic-gap` 폭 70px, `#btn-add`
left 94px로 **변화가 없었다.**

## 가능 여부: 가능
+ 버튼, 좌측 패널 토글, 단어 수·읽기 시간(`#stats`)은 툴바 flex 행에서 `.traffic-gap` **바로 다음
순서**로 놓여 있다(`index.html:1331~1384`). 그래서 여백 하나만 없애면 네 요소가 함께 왼쪽으로
당겨진다. 순서를 바꾸거나 재배치할 필요가 없다. 당겨진 뒤에는 툴바의 기본 좌측 padding
(`var(--sp-md)`)만 남아, 오른쪽 끝과 대칭이 된다.

## CSS만으로는 감지할 수 없다 (실측)
네이티브 전체화면 상태에서 렌더러가 보는 값:
- `matchMedia('(display-mode: fullscreen)').matches` → **false**
- `document.fullscreenElement` → **null**(이 값은 HTML Fullscreen API 전용)

따라서 main 프로세스가 전체화면 상태를 렌더러에 알려줘야 한다(새 IPC 채널).

## 이벤트 시점 (실측, 설계에 직접 영향)
`setFullScreen(true)` 호출 시각을 0으로 두고 측정했다.

| 이벤트 | 시점 | 그 순간 `isFullScreen()` |
|---|---|---|
| `resize` | 31ms | true |
| `enter-full-screen` | 626ms (전환 애니메이션이 끝난 뒤) | true |
| `setFullScreen(false)` 후 `resize` | 약 40ms | false |
| `leave-full-screen` | 약 620ms | false |

전환 방향마다 필요한 시점이 다르다.
- **해제**: `leave-full-screen`만 쓰면 신호등 버튼이 먼저 다시 나타나고 여백은 약 0.6초 늦게
  복원된다. 그 사이 신호등이 + 버튼 위에 겹친다. 그래서 해제 방향은 `resize` 시점(`isFullScreen()`이
  이미 false)에 바로 알린다.
- **진입**: 반대로 `resize`(31ms)에 여백을 없애면, 전환 애니메이션 동안 아직 그려져 있는 신호등이
  약 0.6초간 + 버튼 위에 겹친다. 그래서 진입 방향은 애니메이션이 끝난 뒤 오는 `enter-full-screen`을
  기다린다.

정리하면 `resize`는 **해제 방향에서만** 쓰고, 진입은 `enter-full-screen`으로 처리한다.

## 설계
1. `main.js#createWindow`
   ```js
   // Native fullscreen hides the traffic lights, so the renderer drops .traffic-gap.
   let lastFullScreen = null
   const sendFullScreenState = (force = false) => {
     const fullScreen = win.isFullScreen()
     if (!force && fullScreen === lastFullScreen) return
     lastFullScreen = fullScreen
     win.webContents.send('fullscreen-changed', fullScreen)
   }
   win.on('enter-full-screen', () => sendFullScreenState())
   win.on('leave-full-screen', () => sendFullScreenState())
   // resize arrives ~30-40ms into the transition with isFullScreen() already flipped, while
   // enter/leave-full-screen only fire after the ~0.6s macOS animation. Hook it for the leave
   // direction only: the gap must be restored before the traffic lights reappear. Entering,
   // the lights are still drawn through the animation, so an early collapse would overlap
   // #btn-add for ~0.6s.
   win.on('resize', () => { if (!win.isFullScreen()) sendFullScreenState() })
   ```
   기존 `did-finish-load` 핸들러(`main.js:236`)에서 `sendFullScreenState(true)`를 호출한다.
   새로고침하면 렌더러의 클래스가 초기화되기 때문이다.
2. `preload.js`: `onFullScreenChanged: (cb) => ipcRenderer.on('fullscreen-changed', (_, fullScreen) => cb(Boolean(fullScreen)))`
3. `app-shell.js#registerIpcHandlers`(96줄~):
   `api.onFullScreenChanged?.(fullScreen => documentRef.body.classList.toggle('is-fullscreen', fullScreen))`.
   unit/controller 테스트는 `api`를 스텁으로 쓰므로 `?.`로 보호한다.
4. `index.html` CSS(146줄 옆): `body.is-fullscreen .traffic-gap { display: none; }`.
   여백이 없어지면 flex `gap` 한 칸도 함께 사라진다.

## 고려 사항
- **드래그 영역**: `.traffic-gap`은 `-webkit-app-region: drag`이다. 전체화면 창은 어차피 드래그로
  옮길 수 없으므로 잃는 것이 없다. 툴바 자체의 drag 영역은 그대로 유지된다.
- **보안**: 새 채널은 main → renderer 단방향이고 boolean만 전달한다. 렌더러가 호출할 수 있는
  `invoke`/`send` 핸들러는 추가하지 않으므로 공격 표면이 늘지 않는다.
- **전체화면에서 화면 상단에 마우스를 올릴 때**: macOS가 메뉴 막대와 제목 막대(신호등 포함)를 위에서
  내려 보이는데, 이때 신호등이 잠깐 + 버튼 위에 겹칠 수 있다. macOS 전체화면 앱에서 흔한 동작이다.
  수동 검증에서 확인하고, 거슬리면 별도로 다룬다.
- **노치 있는 MacBook**: 전체화면에서 `innerHeight`가 949px(화면 982px)였다. 내용이 노치 영역 아래에
  배치된다는 뜻이며, 툴바 가로 배치와는 무관하다.
- 창 최대화(zoom, 초록 버튼 option-클릭)는 신호등이 남아 있으므로 대상이 아니다. `isFullScreen()`만
  보면 자연히 제외된다.

## 테스트
- Electron(결정적, CI용): main에서 `win.webContents.send('fullscreen-changed', true)`를 보낸 뒤,
  `body.is-fullscreen`이 켜지고 `.traffic-gap` 폭이 0이며 `#btn-add` left가 30px 미만인지 확인한다.
  `false`를 보내면 70px로 돌아오는지도 확인한다.
- Electron(실제 전체화면, 선택): `setFullScreen(true/false)`로 main의 이벤트 연결까지 확인한다. 이번
  조사 중 로컬 하네스에서 약 3초 만에 정상 동작했다. 다만 실제 Space 전환이 일어나 CI의 macOS 러너에서
  불안정할 수 있으므로, 넣는다면 CI 안정성을 먼저 확인한다.

---

# 구현 순서와 변경 파일

한 브랜치(예: `feat/shortcuts-fullscreen-toolbar`)에서 진행한다.
1. **2 + 3**(⌘⇧O 단축키 + + 메뉴 안내): 가장 작고 서로 묶여야 한다.
2. **1**(⌘B): 가드 로직과 테스트가 핵심이다.
3. **4**(전체화면): 새 IPC 채널이 필요해 파일 수가 가장 많다.

| 파일 | 변경 |
|---|---|
| `src/main.js` | 보기 메뉴 ⌘B 항목, 폴더 열기 accelerator, 전체화면 상태 전송 |
| `src/preload.js` | `onFullScreenChanged` |
| `src/renderer/app.js` | `toggleSidebarFromShortcut` 명령 |
| `src/renderer/app-runtime.js` | `toggleSidebar` 분할뷰 가드, `toggleSidebarFromShortcut` |
| `src/renderer/app-shell.js` | `is-fullscreen` 클래스 토글 |
| `src/renderer/index.html` | `#btn-sidebar` 배지·title, + 메뉴 라벨 2개, 단축키 안내 2줄, `.traffic-gap` 전체화면 규칙 |
| `tests/electron/menu-and-guides.test.js` 외 | 위 항목별 테스트 |
| `AGENTS.md` | ⌘B 포커스 가드 규칙 추가 권장("메뉴 단축키는 렌더러 `preventDefault`와 무관하게 발동하므로, 편집기 단축키와 겹치는 메뉴 단축키는 `triggeredByAccelerator` + 포커스 검사로 가드한다") |

검증 단계: 편집할 때마다 unit + controller, 마무리 전에 Electron 전체 스위트를 1회 돌린다.

# 수동 검증 체크리스트 (Ian, 실제 키보드)

자동 테스트로는 실제 키 → 메뉴 단축키 경로를 재현할 수 없으므로(공통 배경 참고) 아래는 직접 확인한다.
1. 미리보기 모드에서 ⌘B → 좌측 패널이 토글된다.
2. 소스 모드에서 편집기에 커서를 두고 텍스트를 선택한 뒤 ⌘B → `**굵게**`만 적용되고 패널은 그대로다.
3. 편집기에 커서가 있는 상태에서 메뉴 "보기 > 좌측 패널 표시/숨기기"를 마우스로 클릭 → 패널이 토글된다.
4. 분할뷰에서 미리보기 쪽을 클릭한 뒤 ⌘B → 아무 일도 없다(패널이 닫힌 채).
5. ⌘⇧O → 폴더 선택 창이 열린다.
6. ⌃⌘F, 초록 버튼, 메뉴 "보기 > 전체 화면" 세 경로로 전체화면 진입 → 애니메이션이 끝난 뒤 + 버튼이
   왼쪽 끝으로 붙는다. 진입 애니메이션 도중에도, 해제할 때도 신호등과 + 버튼이 겹치지 않는다.
7. 전체화면에서 화면 상단에 마우스를 올려 제목 막대가 내려올 때 겹침 정도를 확인한다(허용 여부 판단).

# 알려진 한계 / 미결

- ⌘B 발동 순서는 저장소 이력(fb2284d)에 근거한 가정이다. 수동 검증 2번이 최종 판정이며, 결과별
  대응은 1번 항목의 "발동 순서 가정이 틀렸을 때"에 정리했다.
- 전체화면에서 상단 hover로 제목 막대가 내려올 때의 겹침은 macOS 기본 동작이라 이번 범위에서
  다루지 않는다.
- 작업 트리에 커밋되지 않은 인라인 코드 줄바꿈 수정(`src/renderer/index.html`,
  `tests/electron/boot-and-render.test.js`)이 있다. 이 계획을 구현하기 전에 먼저 정리해서, 두 변경이
  한 diff에 섞이지 않게 한다.
