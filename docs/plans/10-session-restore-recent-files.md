# 10. 세션 복원 / 최근 파일

## 상태
계획 (미착수)

## 문제
앱을 재시작하면 열려 있던 탭과 탐색기(Explorer) 폴더가 전부 사라진다. 사용자는 매번 다시 폴더를 열고 파일을 클릭해야 한다. 또한 macOS의 Dock 아이콘 우클릭 "최근 항목" 메뉴(`app.addRecentDocument`)가 전혀 연동되어 있지 않다.

## 근거
- **영속화 메커니즘이 전혀 없음**: `grep -rn "electron-store|userData|addRecentDocument" src/` 결과 없음. `localStorage` 사용처는 테마(`src/renderer/app.js:41`)와 온보딩 가이드 노출 여부(`src/renderer/app.js:48,120`)뿐 — 탭/폴더 상태는 대상이 아니다.
- **모든 창이 같은 origin을 공유한다**: `createWindow()`(`src/main.js:13-71`)가 매 창마다 동일한 `renderer/index.html`을 `win.loadFile()`로 로드한다(`src/main.js:28`). Electron의 `file://` 로드에서 `localStorage`는 페이지 origin에 묶이므로, 여러 창이 **하나의 localStorage를 공유**한다. 즉 localStorage로 세션을 저장하면 창별로 분리할 수 없고, 각 렌더러가 자기 로드 시점에 독립적으로 "복원 시도"를 하게 되어 타이밍도 제어할 수 없다.
- **탭 모델**: `createTab()`(`src/renderer/workspace.js:300-339`)이 만드는 tab 객체(`workspace.js:309-324`)는 `path`, `filename`, `content`, `savedContent`, `dirty`, `scrollTop`, `renderedHTML`, `tocHTML`, `sourceMode`, `splitMode`, `previewDirty`, `previewScrollTop`, `sourceScrollTop` 필드를 가진다. 이 중 디스크에서 다시 읽을 수 있는 건 `path`뿐이고 나머지(`renderedHTML` 등)는 렌더링 캐시라 저장할 이유가 없다 — **경로만 저장하고 재기동 시 `read-file`로 다시 읽는 것이 저렴하고 안전**하다.
- **탐색기 루트**: `currentExplorerRoot`는 `explorer.js` 모듈 내부 클로저 변수(`src/renderer/explorer.js:21`)이며 `getCurrentExplorerRoot()`(`explorer.js:57-59`)로만 노출된다. `openFolder()`(`explorer.js:61-69`)가 `open-folder-dialog` IPC로 경로를 받아 설정한다.
- **모든 "파일 열기" 경로가 `createTab()`으로 수렴한다**: explorer 파일 클릭(`explorer.js:150-151`, `load(data)` 호출) → `app.js:169`(`load: data => runtimeController.load(data)`) → `app-runtime.js:52`(`getDocumentFlowController().load(data)`) → `document-flow.js:60-67`(`load()` → `getWorkspaceController().createTab(data)`). 열기 대화상자(`document-flow.js:69-79` `openFile()`)와 OS `open-file`/`새 창으로 열기`(`document-flow.js:160-163` `handleFileOpened()`)도 전부 같은 `load()` → `createTab()` 경로를 탄다. 단 "새 파일"(`app-runtime.js:242`)은 `path: null`로 `createTab`을 직접 호출한다 — 이 경로는 아직 경로가 없으므로 최근 문서 등록 대상이 아니다.
- **저장 시 경로 확정 지점**: 저장/다른 이름으로 저장 성공 후 `updateTabAfterSave()`(`document-flow.js:81-98`)에서 `tab.path`가 확정된다. `saveFile()`이 충돌 검사를 위해 `api.readFile(tab.path)`를 호출하는 지점(`document-flow.js:119`)도 있는데, 이건 "파일 열기"가 아니라 "저장 전 디스크 상태 확인"이라 최근 문서 등록 신호로 쓰면 저장할 때마다(=매 Cmd+S) 잘못 기록된다.
- **`addRecentDocument` 미사용 확인**: `grep -rn "addRecentDocument" src/` 결과 없음.
- **창 생성 진입점들**: 앱 시작(`app.whenReady()` → `createWindow(pendingFilePath)`, `src/main.js:135-138`), OS 파일 열기(`app.on('open-file', ...)`, `main.js:115-133`), Dock 클릭 시 창이 하나도 없을 때(`app.on('activate', ...)`, `main.js:151-153`), `Cmd+N`(`main.js:483-486`, `createWindow()`), `new-window` IPC(`main.js:253-255`, 탭 컨텍스트 메뉴 "새 창으로 열기"(`workspace.js:404-408`)와 탐색기 `Cmd+클릭`(`explorer.js:145-147`)에서 사용).
- **IPC 노출 표면**: `src/preload.js:3-25` — `readFile`, `openFileDialog`, `openFolderDialog`, `listDirectory`, `saveFile`, `newWindow` 등. 세션 저장/복원용 IPC는 아직 없다.

## 원인
설계 초기부터 탭/탐색기 상태를 메모리에만 두는 구조였고, 창을 닫을 때 확인하는 로직(`dirtyState` 맵, `main.js:9,53-68`)처럼 "종료 시점에 뭔가를 영속화"하는 인프라 자체가 없었다. 기능 자체가 아직 계획되지 않았을 뿐, 특별한 기술적 장애물은 없다.

## 제안 방안

### 1. 저장소: 메인 프로세스 + `userData` JSON 파일
`localStorage`는 위 "근거"에서 설명한 대로 다중 창 간에 공유되어 창별 분리도, 복원 타이밍 제어도 불가능하다. 대신 메인 프로세스가 `app.getPath('userData')/session.json`에 다음 형태로 저장:
```json
{ "tabs": ["/path/a.md", "/path/b.md"], "activeIndex": 0, "explorerRoot": "/path/to/folder" }
```
- 렌더러는 탭 목록/활성 탭/탐색기 루트가 바뀔 때마다 새 IPC(예: `session-state-changed`, `send` 방식)로 `{ tabs, activeIndex, explorerRoot }`를 메인에 통지한다(디바운스 300~500ms 권장 — 탭 전환·닫기마다 즉시 디스크 I/O는 과함).
- 메인은 창 id별로 마지막 상태를 메모리에 들고 있다가(기존 `dirtyState` 맵과 같은 패턴, `main.js:9`), **빈 세션(탭 0개 & explorerRoot 없음)은 절대 기록하지 않는다** — 그렇지 않으면 `Cmd+N`으로 연 빈 창이 저장된 세션을 덮어써 버린다(가장 흔한 회귀 시나리오).
- 실제 디스크 쓰기는 `app.on('before-quit')` 또는 각 창의 `close` 이벤트에서, "마지막으로 포커스된 창"의 상태를 저장한다(다중 창 중 하나를 고르는 구체적 규칙은 아래 "리스크" 참고).
- `app.whenReady()`(`main.js:135`)에서 `createWindow()` 호출 전에 `session.json`을 읽어, 있으면 `createWindow(pendingFilePath, restoredSession)` 형태로 첫 창에만 전달한다.

### 2. 복원 절차 (렌더러)
- 새 IPC `restore-session`(또는 `did-finish-load` 시점에 `file-opened`처럼 push)으로 저장된 `{ tabs, activeIndex, explorerRoot }`를 렌더러에 전달.
- 각 경로에 대해 기존 `load()`/`createTab()` 경로를 그대로 재사용해 `api.readFile(path)` → `documentFlowController.load(data)` 순서로 탭을 만든다. **`alertError`로 팝업을 띄우지 않고** 실패(파일 이동/삭제 등)한 항목은 조용히 건너뛴다 — 재시작마다 "파일을 찾을 수 없습니다" 경고가 여러 번 뜨는 건 경험을 해친다(필요하면 토스트 1줄 정도로 요약).
- `explorerRoot`가 있으면 `explorerController`에 루트 설정 + `loadDir()` 호출로 트리를 다시 그린다. 루트 폴더 자체가 사라졌다면 `list-directory` IPC(`main.js:194-209`)가 이미 `{ error }`를 반환하므로 그 경우 탐색기를 빈 상태로 둔다.
- **범위(v1)는 파일 경로 목록 + 활성 탭 인덱스 + 탐색기 루트까지만.** `sourceMode`/`splitMode`/스크롤 위치 같은 세부 UI 상태는 저장하지 않는다(README가 요구한 최소 버전에 맞춤; 필요하면 후속 작업으로 확장).

### 3. `app.addRecentDocument` 연동
조사 결과 모든 "파일 열기"는 `workspace.js:300` `createTab()`으로 수렴하고, "저장으로 경로가 확정되는" 경우는 `document-flow.js:81` `updateTabAfterSave()`로 수렴한다. `main.js`의 IPC 핸들러(`read-file`, `open-file-dialog` 등)에 흩어서 거는 방식은 피한다 — 특히 `read-file`은 저장 전 충돌 검사(`document-flow.js:119`)에도 쓰이므로 거기 걸면 저장할 때마다 잘못 기록된다.

대신:
- `createTab(data)`에서 `data.path`가 있을 때(`workspace.js:301` 근방) 새 IPC `api.addRecentDocument(path)`를 한 번 호출.
- `updateTabAfterSave()`(`document-flow.js:81-98`)에서도 동일하게 호출(새로 저장되어 경로가 생긴 파일도 최근 문서에 잡히도록).
- 메인 프로세스에는 `ipcMain.handle('add-recent-document', (_, p) => app.addRecentDocument(p))` 핸들러 하나만 추가하면 된다(Windows/macOS 외에서는 Electron이 자체적으로 no-op 처리).

### 4. 경계 케이스별 동작 결정
- **OS 파일 열기(더블클릭)로 실행된 경우**: `main.js:135-138`은 `pendingFilePath`가 있으면 그 파일로 첫 창을 연다. 이 경우 저장된 세션과 병합할지, 세션 복원을 건너뛸지 결정 필요 — **제안: 병합하지 않고, 더블클릭한 파일을 우선한다(세션 복원 스킵).** "무엇을 열려던 의도인지"가 명확한 경우 저장된 오래된 세션을 얹으면 오히려 혼란스럽다.
- **`activate` 핸들러(Dock 클릭)**: 창이 하나도 없을 때 빈 창을 만드는 경로(`main.js:151-153`)다. 이건 세션 복원 대상이 아니다 — 복원은 **앱 최초 기동(`whenReady`) 시 첫 창에서만** 수행한다.
- **다중 창**: 창마다 독립된 탭 목록을 가질 수 있으므로 "세션"을 어느 창 기준으로 저장할지가 핵심 리스크다. v1은 "마지막으로 포커스된 창의 상태"만 저장하는 단순화된 모델을 쓰고, 여러 창을 모두 복원하는 것은 범위 밖으로 둔다(README도 "탭 경로만 저장해도 체감이 크다"는 최소 버전을 요구).

## 변경 파일
- `src/main.js` — `session.json` 읽기/쓰기, `before-quit`/`close` 훅에서 저장, `whenReady()`에서 복원 데이터를 첫 창에 전달, `add-recent-document` IPC 핸들러, `session-state-changed`/`restore-session` IPC 배선.
- `src/preload.js` — `saveSessionState`(또는 `send` 방식), `addRecentDocument`, `onRestoreSession` 브리지 추가.
- `src/renderer/document-flow.js` — `updateTabAfterSave()`에서 `addRecentDocument` 호출, 세션 복원 시 조용히 실패를 건너뛰는 로드 경로 추가(또는 별도 `restoreSession()` 함수).
- `src/renderer/workspace.js` — `createTab()`에서 `addRecentDocument` 호출, 탭/활성 탭 변경 시 세션 상태 통지(디바운스) 배선.
- `src/renderer/explorer.js` — `openFolder()`/`clearExplorerRoot()`에서 탐색기 루트 변경을 세션 상태 통지에 반영, 복원 시 루트 재설정 함수 노출.
- `src/renderer/app.js` / `app-runtime.js` — 컨트롤러 간 의존성 주입 배선(디바운스 타이머, 복원 IPC 수신 핸들러 등록).

## 테스트 계획
- **유닛 테스트**: 세션 상태 계산을 순수 함수로 분리할 수 있다면(예: "탭 배열 + activeTabId → 저장할 `{tabs, activeIndex}`" 변환, "빈 세션인지 판별") `tests/unit/workspace.test.js`에 추가. "빈 세션은 저장하지 않는다" 판별 로직은 특히 회귀 방지 차원에서 단위 테스트로 고정.
- **Electron 스모크 테스트**(`tests/electron/smoke.test.js` 패턴 참고):
  1. 탭 2개 + 탐색기 폴더를 연 상태로 앱 종료 → 재기동 → 탭 2개와 탐색기 루트가 복원되는지 확인.
  2. 복원 대상 파일 중 하나를 재기동 전에 삭제/이동 → 재기동 시 에러 팝업 없이 나머지 탭만 복원되는지 확인.
  3. 탭이 하나도 없는 상태(빈 세션)로 종료 후 재기동 → 이전 세션이 지워지지 않고 유지되는지 확인(빈 세션 미기록 로직 검증).
  4. `Cmd+N`으로 두 번째 창을 열고 바로 닫음 → 첫 번째 창의 세션이 두 번째(빈) 창 상태로 덮어써지지 않는지 확인.
  5. 파일 하나를 저장(다른 이름으로 저장 포함)한 뒤 macOS Dock 아이콘 우클릭 → "최근 항목"에 해당 파일이 나타나는지 수동 확인(자동화 어려우면 수동 QA로 명시).

## 리스크 / 미결정 사항
- **다중 창 중 "세션"의 기준을 어느 창으로 할지**: 마지막 포커스 창 기준으로 제안했지만, 사용자가 여러 창을 동시에 의미 있게 쓰는 워크플로우라면 이 단순화가 체감상 아쉬울 수 있다 — 사용자 확인 필요.
- **OS 파일 더블클릭 시 세션 복원을 완전히 건너뛸지, 병합할지**: 위 "제안 방안 4"에서 스킵을 기본안으로 제시했으나 확정되지 않음.
- **`sourceMode`/`splitMode`/스크롤 위치까지 복원할지**: v1 범위에서 제외를 제안했지만, 이후 "완료 항목"으로 넘어가기 전에 범위를 넓힐지 논의 필요.
- **디바운스 간격과 쓰기 빈도**: 탭 전환/닫기마다 매번 메인에 IPC를 보내는 게 과한지, 어느 정도 배칭할지는 구현 중에 조정 여지 있음.
