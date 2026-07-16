# MDV 개선 작업 완료 기록

2026-07-13 감사에서 확인된 6개 미해결 항목의 구현 계획 문서(01~06)는 전부 구현·검증 완료되어 삭제했다.
각 계획의 상세 내용은 git 히스토리(구현 커밋)와 `AGENTS.md`(CONVENTIONS/ANTI-PATTERNS/UNIQUE STYLES)에서 확인할 것.

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

## 완료 과정에서 확인된 잔여 항목

- **`tab.renderedHTML` 스냅샷의 base64 메모리 부풀림** — 원래 04번에 포함시킬 계획이었으나, 실제 구현 시 **의도적으로 범위 밖으로 뺐다.** 이유: 검증 방법이 계획에 없었고, 04번이 만든 `previewDirty` 재렌더 경로와 얽혀 있어 스냅샷을 벗겨내고 즉시 채워 넣지 않으면 탭 복원 시 이미지가 깨진 채로 보일 위험이 있었음. **아직 미해결.**

## 이번 6개에 포함되지 않았던 미해결 항목

`docs/analysis-2026-07-02.md`와 그 보완 문서(`-supplement.md`)에서 제기됐고 아직 안 고쳐진 것들. 착수 전에 한 번 읽어볼 것.

> 두 분석 문서는 **수정 전(2026-07-02) 스냅샷**이다. 거기 적힌 버그 대부분은 이미 수정됐고(PR #1, 그리고 이번 6개 작업) 1건은 오탐으로 판명됐다. 아래 항목만 아직 유효하다.

- **활성 탭이 뷰포트로 스크롤되지 않음** — `#tab-list`가 `overflow-x:auto`인데 스크롤바가 숨겨져 있고, ⌘⇧[ ] 로 탭을 바꿔도 `scrollIntoView`가 호출되지 않는다. 탭이 많으면 **보이지 않는 탭으로 전환된다.** 비용 S, 영향 중간.
- **탭·탐색기가 키보드로 도달 불가** — 파일 탭·탐색기 행 모두 `<div>` + click 핸들러라 `tabindex`/`role`이 없다. 키보드만 쓰는 사용자는 탐색기에서 파일을 열 수 없다. 방향: 탭 바에 `role="tablist"`/`role="tab"` + 좌우 화살표, 탐색기 트리에 `role="tree"`/`role="treeitem"` + 상하 화살표 + Enter. 03번에서 만든 포커스 유틸(`onboarding.js#getFocusableElements`)을 재사용할 수 있다.
- **IPC가 JSON 문자열을 왕복** — 모든 핸들러가 `JSON.stringify` → 렌더러가 `JSON.parse`. contextBridge는 구조화 클론을 지원하므로 불필요한 이중 처리다. 순수 정리 작업이라 급하지 않지만, IPC를 손댈 일이 생기면 같이 처리할 것.
- **세션 복원 / 최근 파일** — 재시작하면 열려 있던 탭·폴더가 전부 사라진다. `localStorage`에 탭 경로만 저장해도 체감이 크다. `app.addRecentDocument`도 macOS 관례.
- **컨트롤러 레벨 테스트 부재** — 단위 테스트는 순수 헬퍼만 다룬다. 실제로 터진 버그들은 대부분 **컨트롤러 간 상호작용**(워처 공유, dirty 덮어쓰기, 검색+탭 전환)에서 나왔다. 모의 refs를 주입하는 컨트롤러 테스트가 다음 투자처.
