# 01. 탭 이동 시 탐색기가 활성 파일을 추적하지 않음

## 상태
요청 ([`docs/self-check-request.md`](../self-check-request.md) 1번 항목, 2026-07-22)

## 문제
폴더 열기로 탐색기를 연 뒤 탐색기에서 여러 문서를 탭으로 열었을 때, 탭 바에서 다른 탭으로 이동(클릭/키보드 단축키)해도 좌측 탐색기 트리의 활성 표시(하이라이트)가 새 탭을 따라가지 않는다. 탐색기에서 파일을 클릭해 여는 방향은 정상 동작한다 — 문제는 그 반대 방향(탭 → 탐색기)이다.

## 근거
- `src/renderer/explorer.js:26-29` — `setActiveTreeItem(container, item)`이 `.tree-item.active` 클래스를 관리하는 유일한 함수.
- `src/renderer/explorer.js:73-81` — `openFileRow()`가 파일 클릭 시 `load(data)` 후 `setActiveTreeItem(...)`을 호출하는, 코드베이스 전체에서 **유일한 호출부**.
- `src/renderer/explorer.js:288-298` — `createExplorerController`의 반환 객체에 `openFolder/loadDir/renderTreeEntry/syncExplorerHeader/clearExplorerRoot/toggleExplorerPathInfo/revealCurrentExplorerRoot/getCurrentExplorerRoot/restoreRoot`만 노출되어 있고, 활성 파일을 외부에서 지정할 수 있는 `setActivePath` 류 함수가 아예 없다.
- `src/renderer/workspace.js:252-326` — `renderTabBar()`가 탭 활성 상태 변화(생성 `:412`, 전환 `:426`, 닫기 `:441/:450`, 다른 탭 닫기 `:466`, 전체 닫기 `:477`)의 유일한 DOM 반영 지점이며, `:325`에 `onTabsChanged?.()`라는 전용 콜백 체크포인트가 이미 있다.
- `src/renderer/app.js:175` — `onTabsChanged: () => notifySessionState()` — 이 체크포인트는 현재 세션 저장 알림에만 연결되어 있고, 탐색기로의 동기화 호출이 없다.
- `src/renderer/app.js:153-186` — `workspaceController`(`:153`)가 `explorerController`(`:178`)보다 먼저 생성된다. 다만 `onTabsChanged`는 화살표 함수로 지연 평가되므로(기존 `onExplorerRootChanged: () => notifySessionState()`와 동일 패턴), 클로저 안에서 나중에 생성되는 `explorerController`를 참조해도 문제없다.
- `src/renderer/explorer.js:196-220` — `loadDir()`이 매번 `container.innerHTML = ''`로 트리를 통째로 재생성하는데, 활성 클래스는 다시 부여하지 않는다. `:188-194`의 `restoreRoot()`(세션 복원 경로)도 마찬가지로 활성 표시를 세팅하지 않는다.

## 원인
탐색기 → 탭 방향의 동기화(`openFileRow`가 클릭 시 `setActiveTreeItem` 호출)만 구현되어 있고, 탭 → 탐색기 방향의 동기화 자체가 존재하지 않는다. 게다가 트리가 재렌더링될 때마다(`loadDir`) 활성 표시가 초기화되어, 설령 다른 경로로 활성 클래스를 세팅해두었더라도 트리를 다시 그리는 순간 사라진다.

## 제안 방안
1. `src/renderer/explorer.js`에 공개 함수 `setActiveFilePath(path)`를 추가한다 — `setActiveTreeItem`을 감싸서 `[data-path="..."]`에 해당하는 row를 찾아 활성화하고, `path`가 없거나 해당 row가 (접힌 폴더 안이라) 보이지 않으면 전체 활성 클래스를 해제한다.
2. `createExplorerController`가 현재 활성 경로를 기억하도록 내부 상태를 하나 추가하고, `loadDir()`의 루트 재렌더 직후(`:216-220` 부근)와 `restoreRoot()`(`:188-194`) 완료 후에도 이를 재적용해 트리 재생성으로 표시가 사라지지 않게 한다.
3. `src/renderer/app.js:175`의 `onTabsChanged` 콜백에서 `explorerController?.setActiveFilePath(workspaceController.getActiveTab()?.path ?? null)`을 함께 호출한다.

```js
// app.js:175 부근
onTabsChanged: () => {
  notifySessionState()
  explorerController?.setActiveFilePath(workspaceController.getActiveTab()?.path ?? null)
},
```

**왜 이 지점인가:** `renderTabBar()`의 `onTabsChanged?.()`(`workspace.js:325`)는 이미 "탭 열기/닫기/전환/재정렬의 단일 체크포인트"로 설계되어 있다 — 07번 계획(탭 스크롤)이 정착시킨 것과 같은 패턴을 재사용하는 것이 가장 안전하다.

## 변경 파일
- `src/renderer/explorer.js` — `setActiveFilePath` 추가, `loadDir`/`restoreRoot`에서 재적용.
- `src/renderer/app.js` — `onTabsChanged` 콜백 확장.

## 테스트 계획
- `tests/unit/explorer.test.js`에는 현재 "active" 관련 테스트가 전혀 없다(`grep -n "active" tests/unit/explorer.test.js` 0건). `tests/controller/`에도 탐색기 관련 테스트가 없다.
- `tests/controller/` 아래에 workspace+explorer 컨트롤러를 함께 구동하는 신규 테스트 추가: 탐색기에서 파일 A, B를 순서대로 열고, 탭 바를 통해 A로 다시 전환한 뒤 `#explorer-tree .tree-item.active .tree-row`의 `dataset.path`가 A의 경로와 일치하는지 확인.
- `tests/electron/smoke.test.js`에 회귀 케이스 추가 권장(실제 폴더 열기 → 다중 파일 열기 → 탭 전환 → 탐색기 하이라이트 확인).

## 리스크 / 미결정 사항
- 활성 탭의 파일이 접힌 폴더 안에 있어 트리에 보이지 않는 경우(`getVisibleTreeRows()`가 필터링), v1은 아무 표시도 하지 않는 것으로 범위를 제한한다(자동으로 상위 폴더를 펼치는 것은 v2 후보) — 갑자기 트리가 펼쳐지며 스크롤 위치가 바뀌는 부작용을 피하기 위함.
- 탭이 없는(path가 null인 미저장 새 파일) 상태로 전환 시 탐색기 활성 표시를 완전히 해제하는 것이 맞는지는 실제 UI에서 확인 권장.
