# 08. 편집모드 검색 하이라이팅 미표시 및 한글 IME Enter 중복 입력

## 상태
완료 (2026-08-04) — Ian이 두 가지를 직접 보고: (1) 편집모드(소스/분할뷰)에서 검색 시 매치가 하이라이트되지 않음, (2) 검색창에 한글을 입력하고 Enter를 누르면 마지막 글자가 중복 입력됨. 둘 다 원인을 코드로 확인하고 수정했다. [`docs/plans/07-usability-roadmap-followup-gaps.md`](./07-usability-roadmap-followup-gaps.md)의 B번 항목("검색 하드 비활성은 이미 해결됨")이 이 보고로 틀렸음이 드러나 함께 정정했다 — 라우팅(어느 모드에서 검색이 어디로 가는지)은 실제로 고쳐져 있었지만, 그 경로로 들어간 뒤의 **하이라이트 렌더링**이 별도로 깨져 있었다.

## 문제
### A. 편집모드 검색 하이라이팅이 표시되지 않음
소스/분할뷰에서 `⌘F`로 검색해 매치를 찾아도 미리보기 모드처럼 매치 위치가 시각적으로 표시되지 않는다.

### B. 검색창에 한글 입력 후 Enter 시 마지막 글자 중복
검색창에 한글 단어를 입력하고 Enter를 누르면 마지막 음절이 중복되어 표시된다.

## 근거 / 원인

### A. 하이라이팅 미표시
- `<textarea>`는 **포커스가 있을 때만** 선택 영역을 페인트한다 — Chromium은 포커스를 잃은 입력 요소의 선택을 `::selection` 커스텀 스타일 여부와 무관하게 그리지 않는다. `src/renderer/index.html:349`에 `#source-editor::selection { background: rgba(255,140,0,0.6); ... }`로 매치용 오렌지 하이라이트가 이미 준비되어 있었지만, 포커스가 없으면 애초에 그릴 기회가 없다.
- `src/renderer/search.js`의 (수정 전) `advanceEditorMatch`:
  ```js
  function advanceEditorMatch(direction) {
    searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
    selectEditorMatch(true)   // 에디터에 포커스 + setSelectionRange
    updateEditorCount()
    document.getElementById('search-input').focus()   // 같은 호출 안에서 즉시 포커스를 다시 뺏음
  }
  ```
  주석("Enter/Shift+Enter is the only moment the editor is focused, so the selection becomes visible")은 의도를 정확히 설명하고 있었지만, 구현이 그 의도를 무력화했다 — 포커스를 에디터로 옮긴 직후, 브라우저가 **페인트할 기회를 갖기 전에** 같은 동기 호출 안에서 포커스를 검색창으로 되돌린다. 자바스크립트 실행은 동기적이라 이 두 `focus()` 사이에 렌더링 프레임이 끼어들 수 없으므로, 선택 영역은 처음부터 끝까지 단 한 프레임도 그려지지 않는다.
  - 타이핑 중 첫 매치 표시(`runEditorSearch` → `selectEditorMatch(false)`)는애초에 포커스를 옮기지 않는다(의도적 — 타이핑 중 검색창 포커스를 유지하기 위함) — 이 경로는 라이브 하이라이팅이 없는 것이 설계이지, 버그가 아니다.

### B. IME 한글 중복 입력
- `src/renderer/app-shell.js`의 (수정 전) `bindSearchEvents`:
  ```js
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); searchPrev() }
    else if (event.key === 'Enter') { event.preventDefault(); searchNext() }
  })
  ```
  `event.isComposing` 체크가 없었다. 한글(또는 다른 IME) 조합을 Enter로 확정할 때 브라우저는 `compositionend`가 발생하기 **전에** `isComposing: true`인 `keydown(key: 'Enter')`를 먼저 보낸다. 이 커밋 키 입력에 `preventDefault()`를 거는 것은 조합이 정상적으로 마무리되는 것을 방해해, 관찰된 증상(마지막 음절 중복)의 원인이 된다.
  - 같은 파일 `src/renderer/editor.js:452`의 Enter 처리(목록 자동 이어쓰기)는 이미 `!event.isComposing` 가드를 갖고 있다 — 검색창 핸들러만 이 가드가 빠져 있었다. 즉 리포지토리 안에 이미 올바른 선례가 있었다.

## 제안 방안 / 적용한 수정

### A. 하이라이팅
- `search.js`의 `advanceEditorMatch`에서 `document.getElementById('search-input').focus()` 호출을 제거 — Enter/Shift+Enter로 매치 이동 후 포커스가 에디터에 그대로 남아 오렌지 `::selection` 하이라이트가 실제로 그려진다.
- 이렇게 되면 포커스가 에디터에 있는 상태에서 사용자가 Enter를 또 누를 수 있는데, `editor.js`의 기존 keydown 핸들러(Tab/Enter-목록 이어쓰기/`⌘B`/`⌘I`)가 이를 가로채면 검색 이동 대신 개행/목록 이어쓰기가 **문서에 삽입**되어 버린다(데이터 훼손 — 단순 UX 트레이드오프가 아니라 반드시 막아야 하는 문제).
  - `app-shell.js`의 `bindSearchEvents`에 `#source-editor` 전용 keydown 리스너를 추가해, 검색이 열려 있고 대상이 `'editor'`일 때 Enter/Shift+Enter를 가로채 `searchNext()`/`searchPrev()`로 보내고 `stopImmediatePropagation()`으로 `editor.js`의 핸들러 실행을 막는다.
  - 두 리스너가 같은 엘리먼트(`#source-editor`)에 등록되므로 실행 순서는 **등록 순서**로 결정된다(캡처/버블 플래그는 같은 타깃에서는 순서를 바꾸지 못한다). `src/renderer/app.js`에서 `editorController.bindEditorEvents()` 호출을 `appShellController.bindUiEvents()` **뒤로** 옮겨, 검색 쪽 리스너가 항상 먼저 등록되게 했다.
  - 검색 대상 판별을 위해 `search.js`에 `getCurrentTarget()`, `app-runtime.js`에 `isEditorSearchActive()`(`isSearchOpen() && getCurrentTarget() === 'editor'`)를 추가해 `app-shell.js`까지 전달했다.
- **알려진 제한(의도적으로 다루지 않음)**: 타이핑 중 실시간 하이라이팅은 여전히 없다 — 첫 매치 표시 시점에 에디터로 포커스를 옮기면 사용자가 다음 글자를 칠 때마다 포커스가 끊겨 타이핑 자체가 불가능해진다. 미리보기 모드처럼 포커스 없이도 보이는 `<mark>` 기반 오버레이 하이라이팅으로 만들려면 에디터 텍스트를 미러링하는 별도 레이어가 필요한데(폰트/줄바꿈/스크롤을 픽셀 단위로 맞춰야 함), 이 저장소에는 시각적으로 검증할 방법이 없어 이번 범위에서는 제외했다. 필요해지면 후속 작업으로 분리할 것.
- 매치 이동 후 포커스가 검색창을 벗어나므로, 이동한 다음 새 검색어를 입력하려면 검색창을 다시 클릭해야 한다 — 타이핑 연속성보다 "하이라이팅이 보인다"를 우선한 의도적 트레이드오프.

### B. IME 중복 입력
- `app-shell.js`(및 새로 추가한 `#source-editor` 전용 리스너)의 Enter 처리 진입점에 `event.isComposing` 가드를 추가했다. 두 리스너의 공통 로직은 새로 뽑아낸 순수 함수 `resolveSearchKeydownAction(event)`(`app-shell.js`)로 통일했다 — `isComposing`이면 `null`, Enter가 아니면 `null`, Shift+Enter면 `'prev'`, Enter면 `'next'`.

## 변경 파일
- `src/renderer/search.js` — `advanceEditorMatch`에서 검색창 재포커스 제거, `getCurrentTarget()` 추가.
- `src/renderer/app-shell.js` — `resolveSearchKeydownAction()` 신설(공유 순수 함수, IME 가드 포함), `bindSearchEvents`에 `#source-editor` 전용 Enter 포워딩 리스너 추가, `createAppShellController`에 `isEditorSearchActive` 파라미터 추가.
- `src/renderer/app-runtime.js` — `isEditorSearchActive()` 추가.
- `src/renderer/app.js` — 두 함수를 각각 wiring, `editorController.bindEditorEvents()` 호출 위치를 `appShellController.bindUiEvents()` 뒤로 이동(리스너 등록 순서 보장).

## 테스트 계획
- `tests/unit/search.test.js`: 매치 이동(`searchNext`/`searchPrev`) 후 `document.activeElement`가 `sourceEditor`인지 확인하는 테스트 추가 완료(하이라이팅이 실제로 그려질 조건인 "포커스 유지"를 직접 검증), `getCurrentTarget()` 테스트 추가 완료.
- `tests/unit/app-shell.test.js`: `resolveSearchKeydownAction`에 대해 (a) `isComposing: true`면 Enter/Shift+Enter 모두 `null`, (b) Enter가 아닌 키는 `null`, (c) 일반 Enter/Shift+Enter가 각각 `'next'`/`'prev'`로 매핑되는지 유닛 테스트 추가 완료.
- `#source-editor` 리스너의 `stopImmediatePropagation` 자체(실제로 `editor.js`의 개행 삽입을 막는지)와 리스너 등록 순서는 jsdom 유닛 테스트로는 이벤트 디스패치 타이밍까지 재현하기 번거로워 커버하지 못했다 — **2026-08-05에 Electron 스모크 테스트로 커버 완료**(아래 리스크 절 참고).

## 리스크 / 미결정 사항
- ~~리스너 등록 순서 의존~~ — **2026-08-05 해소.** `app.js`에서 `editorController.bindEditorEvents()`를 `appShellController.bindUiEvents()` 뒤로 옮긴 순서가 이 수정의 핵심 전제였고, 이를 지키는 자동 회귀 테스트가 없다는 것이 리스크였다. `tests/electron/smoke.test.js`에 `'a second Enter with a collapsed cursor after a search match jump navigates search instead of corrupting the document'` 테스트를 추가해 닫았다.
  - 구현 중 중요한 정정이 있었다: 매치로 막 이동한 직후에는 `selectEditorMatch()`가 항상 **비어 있지 않은** 선택 영역을 남기고, `editor.js`의 자체 Enter 핸들러는 선택 영역이 비어 있을 때만 동작하도록 가드돼 있다 — 즉 "Enter 두 번 연속"만으로는 리스너 등록 순서를 바꿔도 재현되지 않는, 테스트로서 공허한 케이스였다. 실제로 재현 가능한 경로는 매치 이동 후 커서를 한 번 움직여(예: → 화살표) 선택을 접은 상태에서, 목록 줄 위에 커서가 있고 검색이 열려 있는 채로 Enter를 누르는 경우다. 최종 테스트는 `tests/fixtures/search-list.md`(매치 2개가 모두 목록 줄 위에 있음)로 이 조건을 만들고, `app.js`의 두 호출 순서를 일부러 바꿔 실제로 실패(문서가 훼손됨)하는 것과 원래 순서에서 통과하는 것을 둘 다 확인해 테스트 자체의 유효성을 검증했다.
- 매치 이동 후 포커스가 에디터로 넘어가므로, 새 검색어를 입력하려면 검색창을 다시 클릭해야 한다는 동작 변화가 있다 — 위 "알려진 제한"에서 의도적 트레이드오프로 명시했지만, 실사용에서 불편하다는 피드백이 나오면 재검토 대상.
- 타이핑 중 실시간(포커스 무관) 하이라이팅은 이번 범위에서 제외했다 — 필요해지면 미리보기 모드의 `<mark>` 방식을 참고한 오버레이 레이어 설계가 별도로 필요하다.
