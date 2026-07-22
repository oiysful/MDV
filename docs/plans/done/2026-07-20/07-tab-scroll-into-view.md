# 07. 활성 탭이 뷰포트로 스크롤되지 않음

## 상태
완료 (2026-07-20, 커밋 `5ba1cd4`) — 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
탭이 많아 `#tab-list`가 가로로 넘칠 때, ⌘⇧] / ⌘⇧[ 로 탭을 전환하면 새로 활성화된 탭이 스크롤 영역 밖(보이지 않는 위치)에 있어도 스크롤이 따라가지 않는다. `#tab-list`는 `overflow-x: auto`이지만 스크롤바를 숨겨놓았기 때문에(`::-webkit-scrollbar { display: none }`), 사용자는 탭이 바뀐 사실조차 시각적으로 확인하기 어렵다.

## 근거
- `src/renderer/index.html:445-454` — `#tab-list`는 `overflow-x: auto; overflow-y: hidden; scrollbar-width: none;`이고 웹킷 스크롤바도 `display: none`.
- `src/main.js:525-534` — 메뉴의 "다음 탭"(`CmdOrCtrl+Shift+]`) / "이전 탭"(`CmdOrCtrl+Shift+[`)이 각각 `switchToNextTab` / `switchToPrevTab` 렌더러 커맨드를 전송.
- `src/renderer/app-runtime.js:172-178, 396-397` — 두 커맨드를 `workspaceController.switchToNextTab()` / `switchToPrevTab()`로 위임.
- `src/renderer/app.js:220-221` — 커맨드 이름을 동일한 컨트롤러 메서드에 매핑.
- `src/renderer/workspace.js:414-422` — `switchToNextTab`/`switchToPrevTab`이 인덱스만 계산해 `switchToTab(id)`를 호출.
- `src/renderer/workspace.js:341-352` — `switchToTab`이 `activeTabId`를 바꾸고 `renderTabBar()`를 호출. 스크롤 관련 코드 없음.
- `src/renderer/workspace.js:201-253` — `renderTabBar()`가 매번 `list.innerHTML = ''`로 탭 목록 DOM을 통째로 새로 만들고(207-208줄에서 `tab.id === activeTabId`인 경우에만 `active` 클래스를 부여), 마우스 클릭 핸들러(`el.addEventListener('click', () => switchToTab(tab.id))`, 223줄)도 여기서 등록된다.
- `grep -rn "scrollIntoView" src/renderer/*.js` 결과 — `markdown.js:139`(TOC 헤딩 이동, `{behavior:'smooth', block:'start'}`)와 `search.js:85`(검색 매치 이동, `{behavior:'smooth', block:'center'}`) 두 곳뿐. 탭 전환 경로에는 `scrollIntoView` 호출이 전혀 없다.
- `grep -n "renderTabBar()" src/renderer/workspace.js` 결과 — 16개 호출부(createTab, switchToTab, closeTab, closeOtherTabs, closeAllTabs, onTabDrop, restoreActiveTabState, applyExternalContent 등) 전부가 `renderTabBar()`를 거친다. `grep -n "classList.*active" src/renderer/workspace.js`는 207줄(`renderTabBar` 내부) 외에 `active` 클래스를 건드리는 곳이 없음을 확인 — 즉 `renderTabBar()`가 탭 활성 상태를 DOM에 반영하는 **유일한 경로**다.

## 원인
탭 전환(키보드 단축키, 마우스 클릭, 탭 닫기 후 다음 탭 활성화, 드래그 재정렬, 외부 변경 반영 등) 경로가 전부 `renderTabBar()`로 수렴하지만, 이 함수는 `active` 클래스만 부여할 뿐 해당 요소를 스크롤 컨테이너 안에서 보이도록 만드는 코드가 없다. `#tab-list`가 스크롤바까지 숨겨져 있어 문제가 더 눈에 띄지 않는다. 마우스 클릭의 경우 사용자가 이미 보이는 탭을 누르는 것이 일반적이라 체감상 문제가 적지만, 키보드 단축키는 현재 보이지 않는 탭(맨 끝 탭 등)으로도 이동할 수 있어 그 즉시 재현된다.

## 제안 방안
`renderTabBar()`(`workspace.js:201`) 내부, `tabs.forEach` 루프에서 활성 탭의 DOM 엘리먼트를 만들 때 참조를 저장해두고, 루프가 끝난 직후 그 엘리먼트에 대해 한 번만 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`를 호출한다.

```js
function renderTabBar() {
  const refs = getRefs()
  const list = refs.tabList
  refs.tabStrip.classList.toggle('hidden', tabs.length === 0)
  list.innerHTML = ''
  let activeEl = null
  tabs.forEach(tab => {
    const el = document.createElement('div')
    el.className = 'file-tab' + (tab.id === activeTabId ? ' active' : '') + (tab.conflictPending ? ' has-conflict' : '')
    // ...(기존 로직 동일)...
    list.appendChild(el)
    if (tab.id === activeTabId) activeEl = el
  })
  activeEl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  updateToolbarActions()
  updateEntryAffordance()
  maybeShowWelcomeGuide()
  syncDirtyState()
}
```

**왜 이 지점인가:** 위 근거에서 확인했듯 `renderTabBar()`는 탭 전환의 모든 경로(키보드 단축키, 마우스 클릭, 탭 닫기, 드래그 재정렬, 외부 변경 반영, 창 최초 로드 시 상태 복원)가 공통으로 거치는 **유일한** DOM 반영 지점이다. 04번 계획에서 겪었던 "여러 `render()` 호출부 중 일부만 새 로직을 연결해 회귀가 재발"하는 실수(문서 상단 2026-07-16 재검토 #4 참고)를 반복하지 않으려면, 개별 전환 함수(`switchToTab`, `switchToNextTab` 등)마다 스크롤 호출을 추가하는 대신 이 단일 chokepoint에 넣는 것이 안전하다.

**옵션 값 선택 근거:**
- `inline: 'nearest'` — `#tab-list`는 가로 스크롤 컨테이너이므로 실질적으로 중요한 축. 이미 보이는 탭이면 스크롤을 움직이지 않아 마우스 클릭이나 드래그 재정렬처럼 "이미 보이는 탭"을 대상으로 하는 흔한 케이스에서 불필요한 스크롤 점프가 발생하지 않는다.
- `block: 'nearest'` — `#tab-list`는 `overflow-y: hidden`이라 세로 스크롤은 의미가 없지만, `scrollIntoView`가 상위(예: `body`)의 세로 스크롤까지 건드리는 부작용을 막기 위해 명시적으로 `'nearest'`를 지정한다(`'start'`/`'center'`를 쓰면 조상 스크롤 컨테이너까지 불필요하게 움직일 수 있음).
- `behavior`를 지정하지 않아 기본값(즉시 이동, non-smooth)을 사용한다. `markdown.js`/`search.js`는 사용자가 단발성으로 촉발하는 "먼 곳으로 점프"라 `smooth`가 자연스럽지만, 탭 전환은 ⌘⇧]를 연타할 수 있는 빈번한 조작이라 매번 스무스 애니메이션이 걸리면 다음 전환과 겹쳐 오히려 버벅이는 체감을 줄 수 있다. 필요 시 QA에서 `smooth`로 바꾸는 것은 사소한 변경이므로 리스크 항목에 남겨둔다.

## 변경 파일
- `src/renderer/workspace.js` — `renderTabBar()` 함수 하나만 수정.

## 테스트 계획
- 단위 테스트(`tests/unit/workspace.test.js`)는 현재 DOM을 다루지 않는 순수 함수(`findTabByPathInTabs`, `reorderTabsById` 등)만 검증하는 구조이고 `renderTabBar()`는 `getRefs()`로 실제 DOM을 조작하는 비순수 함수라 이 스위트로는 검증 불가. `jsdom`에는 `scrollIntoView` 구현이 없어(`grep -rn "scrollIntoView" tests/`도 0건) 목킹 없이는 실행조차 안 됨 — 이번 변경에서 별도 목/스텁을 새로 들이지 않는다.
- 대신 `tests/electron/smoke.test.js`(Playwright, 실제 크로미움에서 실행)에 새 케이스 추가:
  1. `#tab-list`의 가로 폭보다 많은 탭을 열어 오버플로 상태를 만든다(기존 파일들처럼 `createTab`을 반복 호출하거나 다수의 파일을 순차적으로 연다).
  2. 첫 번째 탭을 활성화한 뒤 `page.keyboard.press('Meta+Shift+]')`(또는 플랫폼별 accelerator, 기존 테스트의 단축키 트리거 방식을 따름)를 필요한 횟수만큼 실행해 화면 밖에 있는 마지막 탭까지 이동.
  3. `document.querySelector('#tab-list .file-tab.active')`의 `getBoundingClientRect()`가 `#tab-list`의 뷰포트 범위(`scrollLeft` ~ `scrollLeft + clientWidth`) 안에 들어오는지, 혹은 `#tab-list.scrollLeft`가 이동 전후로 변했는지 검증.
  4. 회귀 방지로 "이미 보이는 탭을 클릭했을 때 `scrollLeft`가 변하지 않는다"는 케이스도 함께 추가해 `inline: 'nearest'` 선택이 의도대로 동작하는지 확인.
- `npm run test:unit`과 `npm run test:electron`을 모두 통과해야 완료로 간주한다(`docs/plans/done/2026-07-20/README.md`의 기존 관례).

## 리스크 / 미결정 사항
- `behavior: 'smooth'` vs 기본(즉시) — 위에서 즉시 이동을 제안했지만 UX상 스무스가 더 낫다고 판단되면 한 줄만 바꾸면 되는 사소한 결정이라 구현 시점에 재논의 가능.
- 탭 드래그 재정렬(`onTabDrop`, `workspace.js:279-292`) 중에도 `renderTabBar()`가 호출되어 매번 `scrollIntoView`가 실행된다. 활성 탭이 이미 보이는 상태에서의 재정렬이면 `nearest`가 no-op이라 문제없을 것으로 예상되지만, 드래그 중 반복 호출로 인한 미세한 스크롤 튐 여부는 실제 UI에서 확인이 필요하다.
- `renderTabBar()`가 매 호출마다 탭 목록 DOM을 통째로 재생성(`list.innerHTML = ''`)하므로, 활성 탭 엘리먼트는 항상 새로 만들어진 노드다. `scrollIntoView`를 루프 종료 후 한 번만 호출하도록 설계했지만, 브라우저가 아직 레이아웃을 계산하지 않은 상태(예: `display: none`인 탭바)에서 호출될 경우 동작이 no-op이 될 수 있다 — `refs.tabStrip.classList.toggle('hidden', tabs.length === 0)`으로 숨겨지는 것은 탭이 0개일 때뿐이므로 실제 영향은 없을 것으로 보이나 확인 필요.
