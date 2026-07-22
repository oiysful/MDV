# 05. 분할 보기일 때 좌측 패널 무조건 숨김

## 상태
완료 (2026-07-20, 커밋 `ad3928e`) — 상세는 [`../plans/README.md`](./README.md#구현-요약-2026-07-20) 참고.

## 문제
현재는 분할뷰(split view)와 사이드바(좌측 패널) 열림/닫힘 상태가 서로 독립적이다. 사용자는 분할 보기일 때 좌측 패널이 항상(무조건) 숨겨지길 원한다.

## 근거
- `sidebarOpen` 상태: `src/renderer/app.js:14,79-80` — 별도 상태로 관리, `toggleSidebar` 커맨드로만 변경.
- `splitMode` 상태: `src/renderer/editor.js:94,107,111` — 에디터 모듈 내부 상태, `toggleSplitView()`(editor.js:262-292 부근)로 토글.
- 두 상태가 서로 참조하지 않음 — 분할뷰 진입/이탈 로직이 사이드바를 건드리는 코드가 없음.
- **탭 복원 경로도 별도로 존재**: `src/renderer/workspace.js:166` `setSplitMode(tab.splitMode || false)` — 탭 전환 시 저장된 `splitMode`가 복원되는데, 이 경로 역시 사이드바 상태를 건드리지 않는다. 즉 "분할뷰인 탭으로 전환"하는 케이스도 별도로 처리해야 누락이 없다.

## 제안 방안
1. **분할뷰 진입 시 강제 닫힘**: `editor.js#toggleSplitView`가 `splitMode`를 `true`로 전환하는 지점에서, 사이드바를 닫는 동일 로직(`app.js#setSidebarOpen(false)` 상당)을 호출한다. `editor.js`가 `app.js`의 사이드바 상태를 직접 알지 못하므로, 콜백/의존성 주입 형태로 배선 필요(기존에 `editor.js`가 `workspaceController.syncTabImageWatches()` 같은 걸 파라미터로 받는 패턴이 있으므로 유사하게 처리).
2. **탭 전환/복원 경로도 동일 적용**: `workspace.js:166` 부근에서 `setSplitMode(tab.splitMode || false)`를 호출한 직후, `tab.splitMode`가 true라면 사이드바도 강제로 닫는다. 인터랙티브 토글 경로와 탭 복원 경로 둘 다 빠짐없이 처리해야 함(기존 04번 항목 재발 사례처럼 render()/toggle 호출부가 여러 곳이라 하나 놓치면 회귀가 남는다 — [완료 항목 4번 재검토](../plans/README.md) 참고).
3. **재진입 방지**: 분할뷰인 동안 사이드바 토글 버튼(`#btn-sidebar`)을 `disabled` 처리하거나 클릭 시 무시하도록 해, 사용자가 수동으로 다시 열 수 없게 한다("무조건 숨김"이 요구사항이므로 토글 자체를 막는 것을 기본안으로 제시).
4. **분할뷰 이탈 시 동작 결정 필요** (미결정, 아래 참고): 이전에 사이드바가 열려 있었다면 복원할지, 계속 닫힌 채로 둘지.

## 변경 파일
- `src/renderer/editor.js` (`toggleSplitView` 및 관련 내부 진입/이탈 함수)
- `src/renderer/app.js` (사이드바 상태 wiring, 콜백 전달)
- `src/renderer/workspace.js` (탭 복원 경로)
- `src/renderer/index.html` (사이드바 토글 버튼 `disabled` 처리, 필요 시)

## 테스트 계획
- 유닛 테스트: 가능하면 `shouldMarkPreviewDirty`(workspace.js:18)처럼 순수 함수로 분리해(예: "분할뷰+사이드바 상태 조합 → 사이드바가 열려야 하는가") 테스트
- Electron 스모크 테스트: (a) 사이드바 연 상태에서 분할뷰 진입 → 사이드바 닫힘 확인, (b) 분할뷰 상태로 저장된 탭으로 전환 → 사이드바가 이미 닫혀 있는지 확인, (c) 분할뷰 중 사이드바 토글 버튼 클릭이 무시되는지 확인

## 리스크 / 미결정 사항
- **분할뷰를 벗어날 때 사이드바를 이전 상태로 복원할지 여부** — 명시적으로 정해지지 않음. 기본안: 이전 상태 복원(사용자가 놀라지 않는 쪽). 사용자 확인 후 확정 필요.
