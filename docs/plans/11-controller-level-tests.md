# 11. 컨트롤러 레벨 테스트 부재

## 상태
계획 (미착수)

## 문제
`tests/unit/*.test.js`는 각 렌더러 모듈에서 추출된 **순수 헬퍼 함수**만 테스트한다. 실제로 재발/신규로 터진 버그들은 대부분 **컨트롤러 두 개 이상이 콜백/공유 상태로 얽히는 지점**에서 나왔다(워처 공유, dirty 덮어쓰기, 검색+탭 전환). 이 지점을 직접 구동하는 테스트가 없어서, 헬퍼 함수는 정확해도 그 헬퍼를 호출하는 배선(wiring)이 빠지면 유닛 테스트를 전부 통과한 채로 회귀가 들어간다. 이걸 잡는 건 현재 `tests/electron/smoke.test.js`(Playwright, 실제 앱 기동) 뿐인데, 무겁고(전체 스위트 약 43초) 실패 시 원인이 "어느 컨트롤러의 어느 배선"인지 바로 안 보인다.

## 근거
- `tests/unit/workspace.test.js`, `search.test.js`, `onboarding.test.js`를 확인한 결과 대상은 `findTabByPathInTabs`, `shouldMarkPreviewDirty`, `findMatches`, `getFocusableElements`처럼 DOM/컨트롤러 상태 없이 입력→출력만 검증하는 순수 함수다. 단, `tests/unit/search.test.js:6-23`는 예외적으로 `createSearchController({ getRefs })`를 `jsdom`으로 만든 최소 DOM에 직접 실행해서 검증한다 — 이번에 제안하는 "컨트롤러 테스트"가 이미 이 파일 안에서 소규모로 선례를 만든 셈이다. 이 패턴을 다른 컨트롤러로 확장하는 것이 이 계획의 핵심이다.
- `tests/electron/smoke.test.js`(1860줄, 41개 `test()`)는 `tests/electron/helpers/launch.js`로 **실제 Electron 앱을 기동**해 Playwright로 클릭/타이핑하는 end-to-end 테스트다. 컨트롤러 간 상호작용을 실제로 검증하지만(예: 1075번 줄 "background tabs stay watched...", 1602번 줄 "search in split mode selects editor matches without marking the preview pane"), 앱 전체 부팅 비용 때문에 느리고 실패 지점이 컨트롤러 단위로 분리되지 않는다.
- `src/renderer/`의 모든 컨트롤러는 **팩토리 함수 + 의존성 주입** 패턴이다. 직접 `document`/`window`를 참조하지 않고 `getRefs()` 콜백과 개별 콜백 파라미터로 외부 의존을 받는다:
  - `workspace.js:57` `createWorkspaceController({ getRefs, markdownController, render, watchPath, unwatchPath, closeSearch, getSourceMode, setSourceMode, getSplitMode, setSplitMode, ... })`
  - `editor.js:92` `createEditorController({ getRefs, getMarkdown, setMarkdown, getActiveTab, rerenderTabBar, syncTabImageWatches, onSourceInput, render, closeSearch, storage })`
  - `search.js`(`createSearchController({ getRefs })`), `explorer.js:20`, `app-runtime.js:22`, `app-shell.js:48` 전부 동일한 형태.
  - 실제 배선은 `app.js:25-183`에서만 이뤄진다(예: `editorController`의 `syncTabImageWatches: (tab, imagePaths) => { if (workspaceController) workspaceController.syncTabImageWatches(tab, imagePaths) }`). 즉 컨트롤러 자체는 이미 격리 테스트가 가능한 구조이고, 지금 비어 있는 건 "이 배선이 실제로 호출되는가"를 확인하는 테스트 계층이다.
- `jsdom`(`^29.1.1`)이 이미 devDependency이고 `tests/unit/search.test.js`, `onboarding.test.js`에서 이미 `new JSDOM(...)`으로 `document`를 만드는 방식을 쓰고 있다 — 새 인프라 도입 없이 그대로 확장 가능.
- 이 테스트 계층이 있었다면 잡혔을 실제 회귀 두 건(`docs/plans/README.md` "2026-07-16 재검토 결과" #4 참고):
  1. **워처 공유 배선 누락**: `editor.js`의 `toggleSource()`(227번 줄 근방, 실제 호출은 253번 줄)와 `toggleSplitView()`(262번 줄 근방, 275·289번 줄)가 `render()`가 반환하는 `imagePaths`를 받아 `syncTabImageWatches(tab, imagePaths)`를 호출하도록 지금은 고쳐져 있다. 이 호출 세 곳 중 하나만 빠져도 유닛 테스트(순수 헬퍼만 봄)는 전부 통과한다 — `editorController`와 `workspaceController`를 실제로 같이 구동해 "소스→프리뷰 전환 후 `syncTabImageWatches`가 새 이미지 경로로 호출됐는가"를 보는 테스트만 이걸 잡는다.
  2. **dirty 덮어쓰기**: `workspace.js#saveCurrentTabState`(133번 줄, 판단은 146번 줄 `shouldMarkPreviewDirty(...)`)가 `splitMode`일 때만 `previewDirty`를 세팅하던 버그. `shouldMarkPreviewDirty` 자체는 `tests/unit/workspace.test.js:56-77`에서 매트릭스로 테스트되지만, 이 헬퍼가 `saveCurrentTabState` 안에서 실제로 호출되고 그 결과가 `tab.previewDirty`에 반영되는지, 그리고 탭 전환 시 `restoreTabState`가 그 값을 존중해 stale `renderedHTML`을 안 쓰는지는 컨트롤러를 직접 구동해야 검증된다.
  3. **검색+탭 전환**: `workspace.js`는 `closeSearch?.()`를 탭 전환(345번 줄), 탭 닫기(358번 줄), 파일 열기(382, 396번 줄) 네 지점에서 호출한다. 이 콜백은 `app.js`에서 `closeSearch: () => runtimeController.closeSearch()` → `app-runtime.js:283` → `searchController.closeSearch()`로 배선된다. `workspaceController`와 `searchController`를 실제 `search.js` 구현으로 같이 구동하지 않으면, "탭을 바꾸면 검색이 닫힌다"는 배선이 깨져도 어떤 유닛 테스트도 못 잡는다.

## 원인
- 초기 테스트 전략이 "로직을 순수 함수로 뽑아서 유닛 테스트하자"에서 멈췄고, 뽑아낸 헬퍼가 컨트롤러 안에서 실제로 호출되고 그 결과가 다른 컨트롤러로 전파되는지는 Electron 스모크 테스트에만 맡겨져 있었다.
- 컨트롤러가 이미 의존성 주입 패턴이라 격리 테스트가 구조적으로 어렵지 않은데도, "컨트롤러 테스트"라는 중간 계층을 만들 계기(회귀 사례)가 없어서 시도되지 않았다.

## 제안 방안
1. **새 테스트 계층 `tests/controller/`를 만든다.** `tests/unit/`(순수 함수)과 `tests/electron/`(전체 앱 E2E) 사이의 중간 계층으로, 목적은 "2~3개의 실제 컨트롤러 팩토리를 그대로 `require`해서 jsdom으로 만든 최소 DOM + 스텁 콜백으로 묶어 구동하고, 서로 호출하는지 검증"한다. `app.js` 전체나 Electron은 띄우지 않는다.
2. **공용 하네스 헬퍼를 만든다** (`tests/controller/helpers/harness.js` 등): `app.js:25-183`의 배선을 참고해 최소 refs 집합(예: `content`, `sourceEditor`, `sourceView`, `scrollArea`, `tabList`, `tabStrip`, `tocList`, `search-bar` 등, 필요한 컨트롤러 조합에 따라 부분집합)을 만드는 jsdom DOM 팩토리와, `watchPath`/`unwatchPath`/`render` 같은 자주 나오는 콜백의 스파이(호출 기록용 mock) 생성기를 제공한다. `search.test.js`의 `makeEditorSearchHarness`(6-23번 줄)를 일반화하는 방향.
3. **첫 3개 테스트를 다음 상호작용에 맞춰 작성한다** (모두 위 "근거" 3번의 실제 재발 버그와 1:1 대응):
   - `workspace+editor` 조합: `editorController.toggleSource()` / `toggleSplitView()` 호출 후 `workspace.syncTabImageWatches`가 `render()`가 반환한 `imagePaths`로 호출됐는지(스파이로 인자 검증) — mock `render`가 고정된 imagePaths Set을 반환하도록 스텁.
   - `workspace` 단독(또는 `workspace+editor`): 소스 모드 전용 편집 후 `saveCurrentTabState()` → 탭 전환(`switchTab`/`restoreTabState`) → `previewDirty`가 살아있고 stale `renderedHTML`이 재사용되지 않는지.
   - `workspace+search` 조합: `searchController.toggleSearch()`로 검색을 연 상태에서 `workspaceController`의 탭 전환/닫기/열기 함수를 호출하면 `searchController.isSearchOpen()`이 false가 되는지.
4. **범위를 명시적으로 제한한다**: DOM 렌더 결과의 시각적 정확성(레이아웃, CSS)이나 IPC/Electron 계층(`main.js`, `preload`)은 이 계층의 대상이 아니다 — 그런 건 여전히 `tests/electron/smoke.test.js` 몫. 이 계층은 "컨트롤러 A의 콜백이 컨트롤러 B의 함수를 올바른 인자로 실제로 호출하는가"에 집중한다.
5. **기존 파일 구조를 건드리지 않는다**: `tests/unit/*.test.js`의 헬퍼 테스트는 그대로 두고, 새 파일은 전부 `tests/controller/*.test.js`에 추가한다. 순수 헬퍼는 여전히 유닛 테스트가 더 빠르고 명확하므로 컨트롤러 테스트로 옮기지 않는다.

## 변경 파일
- 신규: `tests/controller/workspace-editor.test.js` (이미지 워처 배선)
- 신규: `tests/controller/workspace-dirty.test.js` (previewDirty / 탭 복원)
- 신규: `tests/controller/workspace-search.test.js` (검색+탭 전환)
- 신규: `tests/controller/helpers/harness.js` (jsdom refs 팩토리 + 콜백 스파이 유틸)
- `package.json`: `scripts`에 `test:controller` 추가
- (선택) `AGENTS.md` 또는 `tests/` 하위 문서: 세 계층(unit/controller/electron)의 역할 구분을 한 줄씩 명시

## 테스트 계획
- `node --test tests/controller/*.test.js`가 단독으로 통과해야 함(신규 스크립트 `test:controller`).
- 각 신규 테스트는 "근거" 섹션의 실제 재발 버그를 되돌렸을 때(예: `editor.js`의 `syncTabImageWatches(tab, imagePaths)` 호출 한 곳을 주석 처리) 반드시 실패하는지 수동으로 한 번 확인한다(테스트가 실제로 그 회귀를 감지하는지 검증하는 메타 체크).
- 기존 `npm run test:unit`, `npm run test:electron`은 변경하지 않고 그대로 통과해야 함.
- CI/로컬 실행 순서 제안: `test:unit`(가장 빠름) → `test:controller`(신규, 중간) → `test:electron`(가장 느림). 커밋 전 습관은 `test:unit` + `test:controller`, `test:electron`은 기존 관례대로 완료 직전 1회.

## 리스크 / 미결정 사항
- **`test:controller`를 `test:unit`에 합칠지 별도 스크립트로 둘지 미결정.** 이 문서는 별도 스크립트(`test:controller`)를 기본안으로 제시한다 — 컨트롤러 테스트는 jsdom DOM 생성 비용 때문에 순수 함수 테스트보다 느릴 수 있고, "빠른 유닛 테스트"라는 `test:unit`의 성격을 흐리고 싶지 않기 때문. 다만 실측 후(신규 3개 테스트가 수 ms~수백 ms 수준이면) `test:unit`에 흡수해도 무방 — 사용자 확인 필요.
- **하네스 헬퍼의 재사용 범위가 얼마나 커질지 불확실.** 컨트롤러마다 요구하는 refs 필드가 달라(`workspace.js`는 `tabList`/`tabStrip`/`tocList`, `editor.js`는 `sourceEditor`/`sourceView`/`btnMode`/`btnSplit` 등) 공용 팩토리가 과하게 커지면 오히려 각 테스트 파일에서 필요한 것만 인라인으로 만드는 게 나을 수 있다. 첫 3개 테스트를 작성해보면서 실제 중복도를 보고 하네스를 뽑을지 결정.
- **`app.js`가 하는 실제 배선과 테스트의 스텁 배선이 어긋날 위험(회귀의 회귀).** 컨트롤러 테스트에서 만든 콜백 배선이 `app.js`의 실제 배선과 달라지면, 테스트는 통과하는데 실제 앱은 깨지는 역설이 생길 수 있다. 완화책: 새 컨트롤러 테스트를 추가할 때 해당 콜백 시그니처를 `app.js`의 실제 배선 코드에서 그대로 복사해오고, 주석으로 `app.js:<line>` 출처를 남긴다(이 문서의 "근거" 섹션과 동일한 방식).
- **이 계층이 `tests/electron/smoke.test.js`의 일부를 대체할 수 있는지는 별도 검토 필요.** 이번 계획은 스모크 테스트를 줄이는 게 아니라 "더 빠르고 원인이 명확한 실패"를 추가하는 것. 스모크 테스트 다이어트는 이 계획의 범위 밖.
