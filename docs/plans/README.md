# MDV 개선 작업 계획 (최상위 인덱스)

2026-07-13 감사에서 확인된 6개 미해결 항목의 구현 계획 문서(01~06, 구버전 번호 체계)는 전부 구현·검증 완료되어 삭제했다. 각 계획의 상세 내용은 git 히스토리(구현 커밋)와 `AGENTS.md`(CONVENTIONS/ANTI-PATTERNS/UNIQUE STYLES)에서 확인할 것.

**이 문서는 2026-07-16 시점에 새로 식별된 11개 항목의 최상위 계획 인덱스다.** 각 항목의 상세 조사·근거·제안 방안은 아래 표에서 링크된 개별 문서(신버전 번호 체계 01~11)에 있다 — 번호가 위 "구버전" 단락과 겹치지만 서로 다른 세대의 문서이니 혼동하지 말 것.

**2026-07-20에 11개 전부 구현·검증 완료됐다.** 각 항목의 커밋과 실제 구현 요약은 아래 표와 "구현 요약" 절 참고. 계획 문서 자체(문제/근거/제안 방안/리스크)는 착수 전 조사 기록으로 그대로 남겨둔다.

## 진행 상태 요약

| # | 문서 | 요약 | 상태 | 커밋 |
|---|------|------|------|------|
| 1 | [01-disable-dmg-build.md](./01-disable-dmg-build.md) | 빌드 시 `.dmg` 생성 중단, `.zip`으로 전환 | 완료 | `2238d1e` |
| 2 | [02-release-asset-pipeline.md](./02-release-asset-pipeline.md) | `*-release.sh`가 자산을 못 찾는 원인 규명 + CI 릴리즈 파이프라인 신설 | 완료(CI만) | `fef6133` |
| 3 | [03-allow-local-file-links.md](./03-allow-local-file-links.md) | 존재하는 로컬 파일 링크도 "허용되지 않은 링크" 오류 | 완료 | `5ec5427` |
| 4 | [04-cmd-hold-shortcut-hints.md](./04-cmd-hold-shortcut-hints.md) | Cmd 홀드 시 단축키 있는 버튼에 단축키 즉시 표시 | 완료 | `f7d4898` |
| 5 | [05-force-hide-sidebar-in-split-view.md](./05-force-hide-sidebar-in-split-view.md) | 분할 보기일 때 좌측 패널 무조건 숨김 | 완료 | `ad3928e` |
| 6 | [06-renderedhtml-snapshot-memory.md](./06-renderedhtml-snapshot-memory.md) | `tab.renderedHTML` 스냅샷의 base64 메모리 부풀림 | 완료 | `b73bd81` |
| 7 | [07-tab-scroll-into-view.md](./07-tab-scroll-into-view.md) | 활성 탭이 뷰포트로 스크롤되지 않음 | 완료 | `5ba1cd4` |
| 8 | [08-keyboard-accessible-tabs-explorer.md](./08-keyboard-accessible-tabs-explorer.md) | 탭·탐색기가 키보드로 도달 불가 | 완료 | `6007e9a` |
| 9 | [09-ipc-json-roundtrip-cleanup.md](./09-ipc-json-roundtrip-cleanup.md) | IPC가 JSON 문자열을 불필요하게 왕복 | 완료 | `33c6c02` |
| 10 | [10-session-restore-recent-files.md](./10-session-restore-recent-files.md) | 세션 복원 / 최근 파일(`addRecentDocument`) 미지원 | 완료 | `2b0c3b4` |
| 11 | [11-controller-level-tests.md](./11-controller-level-tests.md) | 컨트롤러 간 상호작용을 검증하는 테스트 계층 부재 | 완료 | `33debf8` |

각 문서는 상태/문제/근거(파일:라인)/원인/제안 방안/변경 파일/테스트 계획/리스크·미결정 사항 순서로 구성되어 있다 — 착수 전 조사 기록이며, 실제 구현이 그 제안 방안과 다르게 갔다면 아래 "구현 요약" 절에 그 차이를 명시했다.

## 구현 요약 (2026-07-20)

착수 순서는 README가 권장한 순서(#1→#2→#11→#3/#4→#7→#8→#5→#6→#10→#9)를 그대로 따랐다.

- **#1**: `package.json#build.mac.target`을 `"dmg"`→`"zip"`으로 변경, `README.md` 빌드 산출물 절 갱신. 스크립트 쪽은 이미 `.zip`을 지원하고 있어 변경 불필요했음(계획 문서의 예상대로).
- **#2**: `.github/workflows/release.yml` 신설(v* 태그 push 시 빌드 + `SHA256SUMS` + 릴리즈 첨부)만 완료. **기존 v1.0.1 릴리즈를 수동으로 복구하는 절차는 계획대로 범위 밖으로 남겨뒀다** — 저장소 쓰기 권한이 필요한 실제 배포 행위라 별도 사용자 승인 필요.
- **#3**: `open-local-path` IPC 채널 신설. 상대/절대 경로 분류는 `path-utils.js#resolveLocalPath`, `.md`는 새 탭으로 열고 그 외 파일은 `shell.openPath`로 OS 기본 앱 사용. 없는 파일은 "파일을 찾을 수 없습니다" 별도 메시지로 구분.
- **#4**: `main.js#buildMenu`의 실제 accelerator와 대조해 저장/인쇄/검색/소스모드/분할뷰 5개 버튼에만 `data-shortcut` 부여. `body.cmd-held`는 keydown/keyup + `window` blur로 관리(Cmd+Tab 전환 시 눌어붙음 방지).
- **#5**: `editor.js#setSplitMode`를 단일 chokepoint로 만들어(인터랙티브 토글과 탭 복원 경로 둘 다 이걸 거침) 분할뷰 진입 시 사이드바를 강제로 닫고, 이탈 시 진입 전 상태로 복원. `#btn-sidebar`는 분할뷰 동안 `disabled`.
- **#6**: `markdown.js`에 `captureSnapshotHTML()`(DOM 클론 후 base64 제거) / `rehydrateSnapshotImages()`(공유 캐시에서 동기 재수화, 캐시 미스만 비동기 폴백) 추가. 레이스 가드는 `workspace.js`의 기존 `restoreRenderVersion` 패턴을 그대로 재사용.
- **#7**: `workspace.js#renderTabBar`에서 활성 탭 엘리먼트를 추적해 렌더 루프 종료 후 `scrollIntoView({block:'nearest', inline:'nearest'})` 1회 호출.
- **#8**: `#tab-list`에 `role="tablist"`, `#explorer-tree`에 `role="tree"` + 로빙 tabindex, manual activation(화살표는 포커스만, Enter/Space가 실제 동작). 공용 로빙 인덱스 헬퍼는 신규 `roving.js`로 분리해 탭 바와 탐색기 트리가 공유. `onboarding.js#getFocusableElements`는 계획 문서의 결론대로 재사용하지 않음(포커스 트랩과 로빙 tabindex는 반대 모델).
- **#9**: main.js 12개 핸들러 + `sendFile()` 전부에서 `JSON.stringify` 제거, 대응하는 렌더러 17곳에서 `JSON.parse` 제거. 계획 문서의 "12/14" 카운트는 그사이 #3·#6·#10이 추가한 신규 IPC 호출부(총 3곳) 때문에 실제로는 12/17이었음 — 전부 반영.
- **#10**: 세션 저장소는 계획대로 `localStorage`가 아니라 `userData/session.json`(메인 프로세스). 빈 세션(탭 0개 & explorerRoot 없음)은 `session-state.js#isEmptySession`(순수 함수, 단위 테스트 있음)으로 절대 기록하지 않음. 복원은 앱 최초 기동 시 첫 창에만, OS 파일-열기로 뜬 경우는 건너뜀. `app.addRecentDocument`는 탭 생성(경로 있는 경우)과 저장 완료 시점 두 곳에서 호출.
- **#11**: `tests/controller/` 신설, 공용 하네스(`tests/controller/helpers/harness.js`) + 3개 테스트(이미지 워처 배선, previewDirty, 검색+탭 전환) — 전부 실제 회귀를 일부러 되돌려서 테스트가 잡아내는지 확인 후 복원.

### 이번 세션 중 발견해 같이 고친 부수 사항
- `tests/controller/` 스위트가 #7(`scrollIntoView`)과 #8(`roving.js` 전역 의존)이 착수되면서 조용히 깨져 있던 걸 발견 — jsdom에 `scrollIntoView` 스텁 추가, 테스트 하네스에서 `roving.js`를 `index.html`과 동일한 순서로 require하도록 수정(`5682e97`).

### 검증
`npm run test:unit`(82), `npm run test:controller`(6), `npm run test:electron`(59) 전부 통과. 이전 세대 기록에 남아있던 `toggleTheme cycles theme state and highlight stylesheets` flaky 테스트는 이번 전체 스위트 실행에서도 정상 통과했다(순서 의존성으로 인한 과거의 단발성 문제였던 것으로 보임).

## 항목별 배경과 우선순위 메모

### 1~2. 빌드·릴리즈 파이프라인 (연쇄 관계)
사용자가 보고한 두 문제는 사실 하나의 인과 사슬이다.

- **#1**은 `package.json#build.mac.target`이 `"dmg"`로 고정된 게 원인 — `.zip`으로 바꾸면 해결되고, 로컬 설치 스크립트(`install-local.sh`)는 압축 해제된 앱 번들만 쓰므로 영향 없음.
- **#2**는 스크립트 버그가 아니라 **릴리즈 프로세스 누락**으로 확인됐다. 사용자가 GitHub에서 확인했다는 두 링크(`archive/refs/tags/v1.0.1.zip`, `.tar.gz`)는 GitHub이 태그마다 자동 생성하는 "Source code" 아카이브이지 electron-builder가 만든 실제 빌드 산출물이 아니다 — Releases API의 `assets` 배열에 아예 잡히지 않는다. `.github/workflows/`가 존재하지 않아 v1.0.1 릴리즈에 빌드된 `.dmg`/`.zip`이 한 번도 첨부된 적이 없다.
- **착수 순서: #1을 먼저 결정(빌드 타깃)한 뒤 #2의 CI 워크플로가 그 산출물을 업로드하도록** 만들어야 한다. #2는 기존 v1.0.1 릴리즈 자체를 수동으로 복구하는 절차도 별도로 필요(저장소 쓰기 권한 필요, 사용자 승인 하에 진행).

### 3. 로컬 파일 링크
`open-external-url` IPC 핸들러(`main.js:257-267`)가 `^https?://`만 허용하도록 설계돼 있는데, 렌더러의 콘텐츠 링크 클릭 핸들러(`app-shell.js:86-96`)가 로컬 파일 경로까지 구분 없이 같은 채널로 보내서 생기는 문제. **미구현 기능**에 가깝다 — 로컬 파일을 여는 전용 경로 자체가 없다. 새 IPC 채널 신설이 핵심이며, 마크다운 파일은 새 탭으로 열지 OS 기본 앱으로 열지 등 UX 결정이 남아 있다.

### 4~5. UI/UX 개선 (독립적, 병행 가능)
- **#4**(Cmd 홀드 단축키 힌트)는 순수 신규 기능. `main.js#buildMenu`의 accelerator 목록과 대조해 "실제 시스템 단축키가 있는 버튼"에만 힌트를 붙이는 것이 핵심 — 없는 단축키를 표시하면 오히려 혼란.
- **#5**(분할뷰 시 사이드바 강제 숨김)는 인터랙티브 토글 경로(`editor.js#toggleSplitView`)와 탭 복원 경로(`workspace.js:166`) **둘 다** 고쳐야 한다 — 하나만 고치면 과거 #4(2026-07-14 완료 항목, 이미지 캐시 무효화)가 겪었던 "여러 호출부 중 일부 누락" 재발 패턴을 반복하게 된다.

### 6. 잔여 항목 — `tab.renderedHTML` 메모리 부풀림
이전 세대 작업(위 "완료된 항목 (2026-07-14)" 표의 #4)에서 의도적으로 범위 밖으로 뺐던 항목. 이번 조사로 **실제로 이미지가 base64 data URI로 DOM에 인라인된다**는 사실이 확인됐고(`markdown.js:82-109`), 탭마다 그 전체를 문자열로 캡처해 백그라운드 탭에도 계속 들고 있다는 점, 그리고 이미 존재하는 공유 캐시(`imageDataUrlCache`, 100개 LRU)와 별개로 탭별 중복 보관된다는 점까지 근거가 갖춰졌다. 제안 방안은 스냅샷에서 base64를 스트리핑하고 복원 시 공유 캐시에서 동기적으로 재수화하는 것.

### 7~8. 탭 바 접근성 (연관, 순서 권장)
- **#7**(탭 스크롤)과 **#8**(탭/탐색기 키보드 접근성)은 같은 파일(`workspace.js#renderTabBar`)을 건드린다. **#7을 먼저 처리**하고 나서 #8의 `role="tab"`/로빙 tabindex 작업을 얹는 순서를 권장 — 반대로 하면 머지 충돌 부담이 커진다.
- #8은 README의 원래 제안("`onboarding.js#getFocusableElements` 재사용")이 실제로는 **재사용 불가**하다는 게 조사로 확인됐다 — 포커스 트랩(전부 Tab 순회)과 로빙 tabindex(하나만 Tab, 나머지는 화살표)는 반대에 가까운 모델이라, 새 공용 헬퍼가 필요하다.

### 9. IPC JSON 왕복 정리
가장 우선순위가 낮다 — README도 원래 "급하지 않다"고 명시했고, 이번 조사도 같은 결론이다. main.js 12개 핸들러 + `sendFile()` 1곳, 렌더러 5개 파일 14곳이 정확히 1:1 대응하는 기계적 치환. **다른 이유로 `main.js`/IPC 호출부를 건드릴 일이 생기면 그때 같이 처리**하는 것을 권장(예: #3, #10 작업 중 자연스럽게 겹칠 가능성 있음).

### 10. 세션 복원 / 최근 파일
가장 규모가 큰 항목. 핵심 결정은 **저장소를 `localStorage`가 아니라 메인 프로세스의 `userData` JSON 파일로** 가야 한다는 것 — 모든 창이 `file://`로 같은 `index.html`을 로드해 `localStorage`가 창 간에 공유되기 때문에, README가 제안한 "localStorage에 탭 경로 저장"은 다중 창 환경에서 성립하지 않는다는 게 조사로 밝혀졌다. v1 범위는 파일 경로 + 활성 탭 인덱스 + 탐색기 루트까지로 제한(스크롤 위치·모드 상태는 제외)을 제안. **빈 세션을 저장하지 않는 것**이 핵심 안전장치(그렇지 않으면 Cmd+N으로 연 빈 창이 기존 세션을 덮어씀).

### 11. 컨트롤러 레벨 테스트
`tests/unit`(순수 헬퍼)과 `tests/electron`(전체 앱 E2E, ~43초) 사이에 `tests/controller/` 계층을 신설하는 제안. 모든 렌더러 컨트롤러가 이미 팩토리+의존성주입 패턴이라 격리 테스트가 구조적으로 어렵지 않다는 게 확인됐고, `search.test.js`에 이미 소규모 선례(`createSearchController`를 jsdom으로 직접 구동)가 있다. 제안하는 첫 3개 테스트는 전부 위 2026-07-16 재검토에서 실제로 터졌던 회귀(워처 배선 누락, dirty 덮어쓰기, 검색+탭 전환)와 1:1 대응한다 — **이 항목이 먼저 갖춰지면 #5(분할뷰+사이드바)처럼 여러 호출부를 고쳐야 하는 향후 작업의 회귀 방지 비용이 줄어든다.**

## 권장 착수 순서

1. **#1 → #2**: 빌드 타깃 결정 없이는 릴리즈 파이프라인을 설계할 수 없음. 사용자 승인 필요(기존 v1.0.1 릴리즈 수동 복구 여부 포함).
2. **#11**: 컨트롤러 테스트 계층을 먼저 갖추면 #5, #8처럼 여러 호출부를 건드리는 이후 작업의 안전망이 된다 — 순서상 당장 급하지 않지만 일찍 투자할수록 이득.
3. **#3, #4, #5**: 서로 독립적인 렌더러 UX 작업, 병행 가능. #5는 #8과 파일이 겹치므로 담당자를 맞추거나 순서를 조율할 것.
4. **#7 → #8**: 같은 함수(`renderTabBar`)를 건드리므로 반드시 이 순서로.
5. **#6**: 이미지 캐시/렌더링 경로를 건드리는 만큼 04번(2026-07-14, 이미지 캐시 무효화) 작업 내용을 먼저 재숙지하고 착수.
6. **#9, #10**: 급하지 않음. #10 작업 중 IPC 핸들러를 새로 추가/수정하게 되므로 #9를 그 김에 같이 처리하는 것을 권장.

## 이번 11개에 포함되지 않은, 더 이전 감사 문서의 항목

`docs/analysis-2026-07-02.md`와 보완 문서(`-supplement.md`)에서 제기됐던 항목 중 위 11개 표에 흡수되지 않은 게 있는지는 이번 재검토에서 별도로 다시 훑지 않았다 — 두 분석 문서는 2026-07-02 스냅샷이라 상당수가 이미 해결됐을 가능성이 높다. 착수 전 재확인 권장.

---

## 참고: 이전 세대(2026-07-14~16) 작업 기록

<details>
<summary>2026-07-14 완료 항목, 2026-07-16 재검토·재수정 기록 (펼치기)</summary>

## 완료된 항목 (2026-07-14)

| # | 작업 | 요약 |
|---|------|------|
| 1 | ⌘F가 소스/분할 모드에서 죽은 키 | `search.js`에 프리뷰/에디터 검색 전략 분리, `toggleSearch`의 early-return 제거 |
| 2 | 네이티브 메뉴에 대부분의 명령 누락 | `main.js#buildMenu`에 12개 명령 전부 노출, 렌더러 keydown과 accelerator 중복 실행 제거 |
| 3 | 가이드 모달에 포커스 트랩/ESC 없음 | `#default-app-guide`에만 포커스 트랩(모)ㆍ`#welcome-guide`는 비차단 유지, ESC를 else-if 우선순위 체인으로 |
| 4 | 이미지 캐시가 파일 변경 시 무효화 안 됨 | 재렌더/저장 시 캐시 무효화 + 05번 인프라 위에 이미지 경로 자체 감시 추가 |
| 5 | 백그라운드 탭은 감시 안 됨 | 탭 경로 집합으로 다중 감시, 비활성 탭은 모달 대신 충돌 표시(`mark-conflict`) |
| 6 | 에디터에 마크다운 보조 없음 | 리스트 이어쓰기, ⌘B/⌘I 토글, 워드랩(거터 숨김) — 전부 `execCommand` 기반으로 undo 보존 |

## 2026-07-16 재검토 결과

2026-07-14 "완료" 표시 6개 항목을 실제 앱 재사용 + 코드 감사로 재검증했다. **6개 중 4개(#1, #2, #4, #6)가 완전/부분적으로 재발 또는 미완이었다.** 아래는 재검증 결과이며, 각 항목의 원래 "완료" 표는 위 표에 유지하되 이 섹션이 최신 상태를 덮어쓴다.

| # | 재검토 결과 | 근거 |
|---|------------|------|
| 1 | **재발(회귀 아님, 원래부터 미완)** | 소스/분할 모드는 `textarea.setSelectionRange`만 쓰고 `#source-editor::selection` CSS가 없어 지속적 하이라이트가 없음. 검색 후 포커스가 검색창으로 즉시 복귀해 선택 표시조차 흐려짐. 렌더 모드는 `<mark class="search-hl">`로 지속 하이라이트. `search.js:51-104`. `tests/unit/search.test.js`는 `findMatches` 오프셋 로직만 테스트, 하이라이트 자체는 미검증. |
| 2 | **원래부터 미완(문서 과장)** | `main.js#buildMenu`의 Cmd/Ctrl+O, N, S, Shift+S 4개 커맨드가 `app-runtime.js:357-362` 렌더러 keydown 핸들러와 **이중 실행**됨. 최악의 경우 Cmd+N이 창을 2개 연다(`main.js:485`의 `createWindow()` 직접 호출 + 렌더러 경로의 IPC `new-window`가 다시 `createWindow()` 호출). 개발자 코멘트(`app-runtime.js:354-356`)는 T/W/U/⌘\\/⌘P/⇧]/⇧[ 만 중복 제거했다고 명시하며 O/N/S/Shift+S는 애초에 범위 밖이었음. 메뉴 명령 12개 노출 자체는 정확(app.js:199-244와 1:1 매칭). 테스트 없음. |
| 3 | **정확(단, 미검증 상태)** | `#default-app-guide`만 포커스 트랩(`onboarding.js:75-91`), `#welcome-guide`는 트랩 없음. ESC는 `app-runtime.js:363-370`의 else-if 체인으로 defaultAppGuide→shortcutsGuide→welcomeGuide→search→context menu 순. 코드는 문서 그대로지만 `tests/unit/onboarding.test.js`는 `getFocusableElements` 헬퍼만 테스트, 트랩/ESC 체인 자체는 테스트 없음. |
| 4 | **재발(2개의 독립적 원인)** | (1) 이미지 변경 미반영: `editor.js`의 `toggleSource()`/`toggleSplitView()` 3곳이 `render()`가 반환하는 imagePaths를 버려서 `workspaceController.syncTabImageWatches()`를 호출하지 않음 → 소스→미리보기 전환으로 처음 본 이미지는 워처가 등록되지 않아 파일이 바뀌어도 `file-changed`가 안 옴. 다른 모든 render() 호출부(workspace.js:174,328,440,482, app.js:283,305)는 정상 연결됨. (2) 삭제한 이미지가 남음: `workspace.js#saveCurrentTabState`(126-150)가 `previewDirty`를 `splitMode`일 때만 true로 설정, 순수 소스 모드 편집은 previewDirty가 안 켜져서 탭 전환 시 오래된 `tab.renderedHTML` 스냅샷(이미지 삭제 전 상태)이 그대로 복원됨 — 이미지 전용 버그가 아니라 소스 모드 전용 편집 전반의 stale-preview 버그. 관련 테스트 0건. |
| 5 | **정확(테스트됨)** | `workspace.js:330`이 경로 있는 모든 탭에 `watchPath()` 호출, `main.js`는 경로별 Map+구독자 Set으로 다중 감시. 비활성/더티 탭은 `tab.conflictPending` 마커만 세팅(`workspace.js:499,510-514`), 탭 전환 시에만 `resolvePendingConflict` 프롬프트. `tests/unit/workspace.test.js:56-72`가 활성/비활성/더티 매트릭스를 직접 테스트. |
| 6 | **재발(부분 재현, 원인 규명)** | 리스트는 `contenteditable`이 아니라 순수 마크다운 텍스트(`<textarea>`) + 렌더 미리보기 방식. `editor.js:352-368`의 Enter 핸들러가 "현재 줄이 리스트의 진짜 끝인지"를 판단하지 않고 현재 줄만 봄. 커서를 리스트 **첫 줄 끝**으로 되돌린 뒤 Enter를 반복하면 그때마다 빈 리스트 항목이 하나씩 추가됨(Playwright로 실제 앱에서 재현: `- a\n- b\n- c` → 3회 반복 시 `- a\n- \n- \n- \n- b\n- c`). `<ul>`이 여러 개 생기는 게 아니라 항목이 누적되는 것. 부차적으로 `editor.js:352`에 `event.isComposing` 가드가 없어 한글 IME 조합 확정 Enter가 이중 발화할 가능성도 있음(코드만으로는 미확정, Playwright로는 IME 조합을 재현 못 함). `tests/electron/smoke.test.js:541-580`은 커서가 항상 문서 끝에 있는 단일 케이스만 검증, 이 시나리오는 커버 안 됨. |

**결론: #1, #2, #4, #6은 여전히 열려 있고 수정이 필요하다. #3, #5는 코드상 정확하나 해당 동작을 직접 검증하는 테스트가 없다.**

## 2026-07-16 재수정 완료

위 4개 재발 항목을 모두 수정했다. `npm run test:unit`(62/62) 통과, `npm run test:electron`(41개 중 40개 통과 — 나머지 1개 `toggleTheme cycles theme state and highlight stylesheets`는 단독 실행 시 통과하는 순서 의존적 기존 flaky 테스트로 이번 변경과 무관, 미해결로 남김).

| # | 수정 내용 |
|---|-----------|
| 1 | `index.html`에 `#source-editor::selection` CSS 추가(포커스 무관 렌더링). `search.js`는 변경 없음(포커스 관리 유지). |
| 2 | `app-runtime.js`의 Cmd/Ctrl+O·N·S·Shift+S 렌더러 keydown 직접 호출 제거, 메뉴 accelerator→`renderer-command` IPC 경로만 남김. **후속 과제**: 이 정리로 `app-runtime.js`의 `newWindow()`가 이제 아무 데서도 호출되지 않는 죽은 코드가 됨 — 별도 정리 필요. |
| 4 | `editor.js`의 `toggleSource()`/`toggleSplitView()`가 `render()`의 imagePaths로 `syncTabImageWatches()`를 호출하도록 수정(신규 파라미터를 `app.js`에서 배선). `workspace.js`에 `shouldMarkPreviewDirty()` 순수 헬퍼를 추출해 소스 모드 단독 편집도 `previewDirty`를 켜도록 수정. |
| 6 | `editor.js:355` Enter 핸들러에 `!event.isComposing` 가드 추가(한글 IME 조합 확정 시 이중 발화 방지). **주의**: "커서를 리스트 첫 줄로 되돌린 뒤 반복 Enter" 시나리오 자체는 코드 추적 결과 의도된 리스트 분할 동작으로 확인되어 로직은 변경하지 않았다 — 사용자가 실제로 겪은 건 IME 이중 발화일 가능성이 높다는 판단. 만약 재현 시나리오가 그대로 남아 있다면(IME와 무관하게), 원인이 다른 곳에 있다는 뜻이므로 추가 재보고가 필요하다. |

관련 테스트 추가: `tests/unit/search.test.js`(에디터 검색 선택 검증), `tests/unit/workspace.test.js`(`shouldMarkPreviewDirty` 매트릭스), `tests/electron/smoke.test.js`(메뉴 이중 실행 부재, 반복 Enter 리스트 분할).

## 완료 과정에서 확인된 잔여 항목 (→ [06번 계획](./06-renderedhtml-snapshot-memory.md)으로 승격)

- **`tab.renderedHTML` 스냅샷의 base64 메모리 부풀림** — 원래 04번에 포함시킬 계획이었으나, 실제 구현 시 **의도적으로 범위 밖으로 뺐다.** 이유: 검증 방법이 계획에 없었고, 04번이 만든 `previewDirty` 재렌더 경로와 얽혀 있어 스냅샷을 벗겨내고 즉시 채워 넣지 않으면 탭 복원 시 이미지가 깨진 채로 보일 위험이 있었음. 2026-07-16에 [06번 계획](./06-renderedhtml-snapshot-memory.md)으로 정식 조사·계획 문서화됨.

## 이번 6개에 포함되지 않았던 미해결 항목 (→ 07~11번 계획으로 승격)

`docs/analysis-2026-07-02.md`와 그 보완 문서(`-supplement.md`)에서 제기됐고 아직 안 고쳐진 것들.

> 두 분석 문서는 **수정 전(2026-07-02) 스냅샷**이다. 거기 적힌 버그 대부분은 이미 수정됐고(PR #1, 그리고 이번 6개 작업) 1건은 오탐으로 판명됐다. 아래 항목만 아직 유효했고, 2026-07-16에 각각 정식 계획 문서로 승격됐다.

- **활성 탭이 뷰포트로 스크롤되지 않음** → [07번 계획](./07-tab-scroll-into-view.md)
- **탭·탐색기가 키보드로 도달 불가** → [08번 계획](./08-keyboard-accessible-tabs-explorer.md)
- **IPC가 JSON 문자열을 왕복** → [09번 계획](./09-ipc-json-roundtrip-cleanup.md)
- **세션 복원 / 최근 파일** → [10번 계획](./10-session-restore-recent-files.md)
- **컨트롤러 레벨 테스트 부재** → [11번 계획](./11-controller-level-tests.md)

</details>
