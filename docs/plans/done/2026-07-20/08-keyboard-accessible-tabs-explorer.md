# 08. 탭·탐색기가 키보드로 도달 불가

## 상태
완료 (2026-07-20, 커밋 `6007e9a`) — 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
파일 탭 바(`#tab-list`)와 탐색기 트리(`#explorer-tree`)의 각 행이 전부 `<div>` + `click` 핸들러로만 구현돼 있다. `tabindex`/`role`이 전혀 없어 `Tab` 키로 포커스가 아예 들어가지 않고, 마우스 없이는 탭을 전환하거나 탐색기에서 파일을 열 수 없다.

## 근거
- 탭 바: `src/renderer/workspace.js:201-253` `renderTabBar()` — `el`(각 탭 컨테이너)이 순수 `document.createElement('div')`이고, 클릭(`el.addEventListener('click', ...)`, workspace.js:223)으로만 `switchToTab`을 호출한다. `role`/`tabindex` 지정 없음.
- 탐색기 트리: `src/renderer/explorer.js:86-159` `renderTreeEntry()` — 폴더/파일 행(`row`)도 순수 `<div class="tree-row">`이며 폴더는 `row.addEventListener('click', ...)`(explorer.js:112)로 열고닫기, 파일은 `row.addEventListener('click', ...)`(explorer.js:144)로 `load()`를 호출한다. 마찬가지로 `role`/`tabindex` 없음.
- 마크업 확인: `src/renderer/index.html:1445` `<div id="explorer-tree">`, `index.html:1454` `<div id="tab-list"></div>` — 컨테이너 자체에도 `role="tree"`/`role="tablist"` 등이 없다.
- CSS 확인: `index.html:457-490`(`.file-tab` 관련 규칙), `index.html:545-561`(`.tree-item`/`.tree-row` 관련 규칙) 어디에도 `:focus`/`:focus-visible` 스타일이 없다 — 설령 `tabindex`만 추가해도 포커스가 시각적으로 보이지 않는다.
- 기존 키보드 단축키와 충돌 여부: `src/renderer/app-runtime.js:354-367`의 전역 `keydown` 핸들러는 `Escape`만 처리하고, 탭 전환은 네이티브 메뉴 가속기 `⌘⇧]`/`⌘⇧[`(주석 354행)로 처리된다. 좌우/상하 화살표 키는 현재 아무 곳에서도 사용하지 않으므로 이번 작업에서 새로 바인딩해도 충돌이 없다.

## 원인
탭 바와 탐색기 트리 모두 마우스 클릭만 가정하고 설계됐다. 두 위젯 모두 DOM 트리(`<div>` 중첩)로 구현돼 있어 시맨틱 HTML(`<button>`, `<a>` 등)의 암묵적 키보드 접근성도 없고, 명시적으로 `tabindex`/`role`/키 핸들러를 추가한 적도 없다.

## 제안 방안

### 1. 탭 바 (`role="tablist"` 패턴, ARIA APG Tabs)
- `index.html:1454` `#tab-list`에 `role="tablist"` 추가(방향은 가로이므로 `aria-orientation` 생략 가능 — 기본값이 horizontal).
- `workspace.js#renderTabBar`(workspace.js:201)에서 각 탭 `el`에:
  - `role="tab"`
  - `aria-selected="true"/"false"` (`tab.id === activeTabId`에 연동)
  - **로빙 tabindex**: 활성 탭만 `tabindex="0"`, 나머지는 `tabindex="-1"` — 탭 바에 진입할 때 `Tab` 키 한 번으로 들어오고, 그 안에서는 화살표로만 이동하게 한다.
  - `aria-label` 또는 `aria-labelledby`로 탭 이름 노출(현재 `el.title = tab.filename`은 툴팁일 뿐 스크린리더용이 아님).
- 좌우 화살표 키 핸들러(탭 바 컨테이너에 위임 방식으로 하나만 등록, 각 탭에 개별 등록하지 않음): `ArrowRight`/`ArrowLeft`로 포커스만 이동(탭 전환은 안 함, ARIA APG의 "automatic activation" vs "manual activation" 중 이 앱은 클릭=전환이므로 manual activation이 더 안전 — 포커스 이동과 탭 전환을 분리), `Enter`/`Space`로 포커스된 탭을 `switchToTab(tab.id)` 호출해 실제 전환.
  - manual activation을 선택하는 이유: 현재 탭 전환은 `loadMarkdown`/`restoreTabState` 등 상태 복원 비용이 있는 동작이라(workspace.js:195-199), 화살표로 훑기만 해도 매번 파일을 다시 로드하면 불필요한 부하 + 깜빡임이 생긴다.
  - `Home`/`End`로 첫/마지막 탭 포커스 이동(선택, APG 권장 사항).
- `closeButton`(workspace.js:216)은 이미 `<button>`이라 자체적으로 키보드 접근 가능하지만, 탭이 `role="tab"`이 되면 버튼이 탭 안에 중첩된 인터랙티브 요소가 되므로 Tab 키 포커스 순서에서 별도로 도달 가능해야 한다(`tabindex="0"` 유지, 로빙 대상에서는 제외).

### 2. 탐색기 트리 (`role="tree"` 패턴, ARIA APG Treeview)
- `index.html:1445` `#explorer-tree`에 `role="tree"` 추가.
- `explorer.js#renderTreeEntry`(explorer.js:86)에서 각 `row`(또는 `item`)에:
  - `role="treeitem"`
  - 폴더 행: `aria-expanded="false"/"true"` (`children.classList.toggle('open')` 결과와 연동, explorer.js:113)
  - `aria-level`(깊이, 이미 `depth` 파라미터가 있으므로 `depth + 1`), 자식이 있는 폴더는 부모 `item`에 `role="group"`을 추가해 `children` 컨테이너를 감싸는 것도 APG 권장(현재 `children`은 `.tree-children`인데 역할 없음).
  - **로빙 tabindex**: 트리 전체에서 하나의 행만 `tabindex="0"`(최초는 루트의 첫 항목, 이후는 마지막으로 포커스했던 행), 나머지는 `-1"`.
- 상하 화살표: `ArrowDown`/`ArrowUp`으로 트리 내 "보이는" 행 사이 포커스 이동(접힌 폴더의 자식은 건너뜀 — `loadDir`이 지연 로딩(explorer.js:116-119)이라 아직 DOM에 없는 자식은 애초에 순회 대상에서 빠짐, 이 부분은 지연 로딩과 자연스럽게 맞물림).
- `ArrowRight`: 포커스가 닫힌 폴더면 열기(+ 필요 시 `loadDir` 트리거), 이미 열린 폴더거나 파일이면 다음 행(또는 첫 자식)으로 이동.
- `ArrowLeft`: 포커스가 열린 폴더면 닫기, 닫힌 폴더/파일이면 부모 폴더 행으로 이동.
- `Enter`: 파일이면 `load()` 호출(explorer.js:150-152 로직 재사용), 폴더면 열기/닫기 토글(explorer.js:112-120 로직 재사용) — 클릭 핸들러 내부 로직을 별도 함수로 뽑아 클릭과 키보드 양쪽에서 호출하는 형태 권장.
- `Home`/`End`(선택)로 트리의 첫/마지막 보이는 행으로 이동.

### 3. 포커스 스타일 (CSS)
- `index.html:457-490`(`.file-tab`), `index.html:545-561`(`.tree-row`) 근처에 `:focus-visible` 규칙 추가 필요 — 기존에 참고할 만한 패턴은 `index.html:237` `.btn-primary-add:focus-visible`.

### 4. `onboarding.js#getFocusableElements` 재사용 가능 여부 — **재사용 불가, README 제안과 다른 접근 필요**
`getFocusableElements`(onboarding.js:2-7)는 컨테이너 안의 "네이티브하게 포커스 가능한 요소"(`button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`)를 **한 번에 전부** 찾아 모달 포커스 트랩의 Tab 키 first/last 경계를 계산하는 용도다(onboarding.js:78-91, `bindDefaultAppGuideFocusTrap`). 이건 "모든 요소가 Tab 순서에 있고, Tab/Shift+Tab으로 자연스럽게 순회"하는 표준 포커스 트랩 패턴이다.

반면 tablist/tree는 **로빙 tabindex 패턴**이 필요하다 — 위젯 전체는 `Tab` 키 한 번으로 진입/이탈하고, 내부는 화살표 키로만 이동하며 오직 하나의 항목만 `tabindex="0"`이다. 이 둘은 셀렉터는 비슷해 보여도(둘 다 `tabindex` 관련) 동작 모델이 반대에 가깝다 — 포커스 트랩은 "전부 Tab 순회 가능"이 목표고, 로빙 tabindex는 "하나만 Tab 순회 가능, 나머지는 화살표 전용"이 목표다. 따라서 `getFocusableElements` 함수 자체를 가져다 쓸 일은 없다. 다만 "포커스 이동 후 `.focus()` 호출" 같은 사소한 패턴(예: `openDefaultAppGuide`의 `requestAnimationFrame` 안에서 포커스하는 방식, onboarding.js:100-103)은 참고할 만하다 — DOM이 방금 갱신된 직후(예: `renderTabBar()` 재호출 직후) 포커스를 옮길 때 레이아웃 타이밍 이슈가 재발할 수 있으니 유의.

새로 만들어야 할 것: 탭 바용, 트리용 각각의 "로빙 tabindex 이동" 헬퍼(예: `moveRovingFocus(items, currentIndex, direction)` 같은 순수 함수) — 두 위젯이 거의 동일한 로직(다음/이전 인덱스 계산 + wrap 여부)을 쓰므로 공용 유틸로 뽑아 `workspace.js`/`explorer.js` 양쪽에서 재사용하는 편이 나을 수 있다(현재 `onboarding.js`처럼 `MDVXxx` 전역 네임스페이스 + `module.exports` 패턴을 따르는 새 파일이나, 기존 유틸 파일에 추가).

## 변경 파일
- `src/renderer/workspace.js` — `renderTabBar()`(workspace.js:201-253)에 `role`/`aria-selected`/로빙 `tabindex` 추가, 화살표·Enter/Space 키 핸들러 신설.
- `src/renderer/explorer.js` — `renderTreeEntry()`(explorer.js:86-159), `loadDir()`(explorer.js:71-84)에 `role`/`aria-expanded`/`aria-level`/로빙 `tabindex` 추가, 화살표·Enter 키 핸들러 신설. 클릭 핸들러 내부 로직(파일 열기, 폴더 토글)을 키보드 핸들러와 공유하도록 리팩터링 필요.
- `src/renderer/index.html` — `#tab-list`에 `role="tablist"`(index.html:1454), `#explorer-tree`에 `role="tree"`(index.html:1445), `.file-tab`/`.tree-row` 근처에 `:focus-visible` CSS 추가.
- (선택) 로빙 tabindex 공용 헬퍼를 위한 신규 유틸 파일 또는 기존 유틸 파일 확장.

## 테스트 계획
- 유닛 테스트: `tests/unit/workspace.test.js`, `tests/unit/explorer.test.js`에 로빙 tabindex 이동 계산(다음/이전 인덱스, 경계에서 멈춤 또는 wrap 여부)을 순수 함수로 뽑아 테스트. `aria-selected`/`aria-expanded` 값이 상태와 일치하는지도 DOM 어서션으로 검증 가능.
- Electron 스모크 테스트(`tests/electron/smoke.test.js`): (a) `Tab` 키로 탭 바에 진입 후 좌우 화살표로 포커스만 이동(파일 전환 안 됨) 확인, (b) 포커스된 탭에서 `Enter` 시 실제 전환 확인, (c) 탐색기에서 `Tab` 진입 → 상하 화살표로 행 이동 → `ArrowRight`로 폴더 펼침 → `Enter`로 파일 열기까지 키보드만으로 전체 플로우 재현, (d) 마우스 클릭 경로가 기존과 동일하게 동작하는지 회귀 확인(클릭 핸들러 리팩터링 영향 범위).

## 리스크 / 미결정 사항
- **tablist activation 모드(automatic vs manual)** — 위 제안은 manual(포커스 이동과 전환 분리)을 기본안으로 제시했으나, ARIA APG는 원래 automatic activation(화살표로 포커스 이동 시 즉시 전환)도 흔한 패턴이다. 탭 전환 비용(상태 복원, workspace.js:195-199)을 고려하면 manual이 안전하다고 판단했지만, 사용자 기대와 다를 수 있어 확인 필요.
- **트리 지연 로딩과 로빙 tabindex의 상호작용** — 닫힌 폴더의 자식은 아직 DOM에 없으므로(explorer.js:110, `loaded` 플래그) `ArrowDown`으로 폴더를 지나칠 때 자식을 건너뛰는 것은 자연스럽지만, `ArrowRight`로 방금 편 폴더의 첫 자식으로 바로 이동하려면 `loadDir()`의 비동기 완료를 기다렸다가 포커스해야 한다 — 타이밍 처리 필요.
- **탭/트리 리렌더 시 포커스 유지** — `renderTabBar()`(workspace.js:201)와 `loadDir()`(explorer.js:71)는 매번 `innerHTML = ''` 후 DOM을 통째로 다시 만든다(workspace.js:205, explorer.js:74). 키보드로 포커스를 옮긴 상태에서 탭 목록이나 트리가 리렌더되면(예: 다른 탭에서 파일 저장, 외부 변경 감지) 포커스가 통째로 날아간다 — 리렌더 후 포커스 복원 로직이 필요할 수 있음(예: `tab.id` 또는 `entry.path` 기준으로 이전 포커스 대상 재탐색).
- **`aria-level`/`aria-setsize`/`aria-posinset` 등 세부 ARIA 속성 범위** — 최소 동작(`role`, `aria-expanded`, `aria-selected`, 로빙 tabindex)까지만 이번 계획에 포함했고, 완전한 APG 준수를 위한 추가 속성(`aria-setsize`, `aria-posinset`)은 범위에서 제외했다 — 필요 시 별도 항목으로.
