# 작업 계획 문서

진행 중인 계획 문서는 이 디렉토리에 바로 둔다. 완료된 계획은 완료 시점 날짜로 이름 붙인
`done/<YYYY-MM-DD>/` 하위로 옮겨 배치 단위로 보관한다.

- [done/2026-07-20/](./done/2026-07-20/) — 2026-07-16에 식별된 11개 항목, 2026-07-20 전부 구현·검증 완료.
- [done/2026-07-30/](./done/2026-07-30/) — 아래 2026-07-22 배치 중 01/02/03/05/06, 2026-07-30 전부 구현·독립 리뷰 2회(코드/보안)·검증 완료.
- [done/2026-08-04/](./done/2026-08-04/) — [08](./done/2026-08-04/08-search-highlight-and-ime-fixes.md) 편집모드 검색 하이라이팅 + 한글 IME Enter 중복 입력, 2026-08-04 구현·검증 완료.
- [done/2026-08-05/](./done/2026-08-05/) — [04](./done/2026-08-05/04-split-view-scroll-boundary-latch.md) 분할뷰 스크롤 경계 래칭(Ian 실사용 재확인 완료), [07](./done/2026-08-05/07-usability-roadmap-followup-gaps.md) 사용성 로드맵 후속 갭 A/B/C/D 전부, [09](./done/2026-08-05/09-code-block-copy-gutter-redesign.md) 코드블럭 복사버튼 gutter 재설계, [10](./done/2026-08-05/10-mermaid-support-and-usability-fixes.md) mermaid 지원 + 표 정렬/검색 가로스크롤/탐색기 watch + 프론트매터 메타 블록 + 복사버튼 오버레이 회귀(6항목) — 2026-08-05 구현·검증 완료.
- [done/2026-08-12/](./done/2026-08-12/) — [11](./done/2026-08-12/11-blockquote-github-alerts.md) GitHub 스타일 블록쿼트 Alert(`[!NOTE]` 등 5종) 렌더링, [13](./done/2026-08-12/13-performance-diet.md) 성능 개선(대용량 폴더 열기 중단·Cmd+Q 종료 지연 — 단일 근본 원인인 디렉토리 워처 과다 프로비저닝 해결, mermaid/katex 지연 로딩, 세션 복원 lazy 탭 렌더링) — 2026-08-12 구현·검증 완료.
- [done/2026-08-14/](./done/2026-08-14/) — [14](./done/2026-08-14/14-frontmatter-yaml-structures.md) 프론트매터 YAML 구조 전면 지원(정규식 라인 스캐너 → `js-yaml` 기반 파싱, 단순/객체 배열·중첩 객체·블록 스칼라 개행·타입 인식 재귀 렌더러) — 2026-08-14 구현·검증 완료.
- [done/2026-08-18/](./done/2026-08-18/) — [15](./done/2026-08-18/15-in-app-update-notification.md) 인앱 업데이트 알림(notify-only) 기능 — Electron `autoUpdater`는 unsigned 앱이라 macOS에서 적용 불가함을 확인, GitHub Releases 폴링 + `brew upgrade` 안내 배너 방식으로 확정·구현. 실제 GitHub API 대상 수동 검증까지 완료. 2026-08-18 구현·검증 완료.
- [done/2026-08-21/](./done/2026-08-21/) — [16](./done/2026-08-21/16-mermaid-hidden-render-and-print-palette.md) mermaid 렌더링 버그 2건 — 소스 모드(⌘U) 왕복 시 다이어그램이 빈 공간으로 남는 문제(`display:none` 중 `getBBox()`가 0을 반환), 다크 모드 인쇄/PDF에서 다이어그램만 검게 남는 문제(mermaid가 팔레트를 SVG에 구워 넣어 `@media print`의 CSS 변수 강제를 따라오지 않음). advisor + code-reviewer 리뷰로 계획서 범위 밖 레이스 3건(인쇄 복원 시 테마 재확인, 동시 재렌더 직렬화, 파킹 중 스냅샷 자체복구)도 함께 반영. 2026-08-21 구현·검증 완료.

## [`17-shortcuts-and-fullscreen-toolbar.md`](./17-shortcuts-and-fullscreen-toolbar.md) — ⌘B 좌측 패널·⌘⇧O 폴더 열기 단축키, + 메뉴 단축키 안내, 전체화면 툴바 좌측 여백 (2026-09-15 조사)

Ian이 요청한 4건을 조사한 계획서이며, 4건 모두 구현할 수 있다. ⌘B는 소스 편집기의 "굵게"와
충돌하는데, 메뉴 단축키는 렌더러가 `preventDefault()`해도 함께 발동한다(fb2284d의 ⌘T 이중 실행이
근거). 그래서 Ian의 결정(포커스로 구분)대로 `triggeredByAccelerator`와 포커스를 함께 검사하는
가드를 둔다. 전체화면에서 비는 자리는 `.traffic-gap` 70px 여백이다. CSS만으로는 전체화면을 감지할
수 없음을 실측으로 확인했으므로, main → renderer IPC로 알려준다. 전체화면 이벤트는 전환 애니메이션이
끝난 뒤에야 온다. 그래서 신호등과 + 버튼이 겹치지 않도록, 진입은 `enter-full-screen`을 기다리고
해제는 전환이 시작될 때 오는 `resize`에서 바로 알린다. 실제 키보드 동작은 자동 테스트로 재현할 수
없어 수동 검증 항목으로 남겼다. 구현 대기.

## [`12-i18n-feasibility-assessment.md`](./12-i18n-feasibility-assessment.md) — 전체 UI i18n 적용 타당성 검토 (2026-08-12 조사)

착수 계획이 아니라 조사 보고서. 하드코딩된 한국어 UI 문자열 규모(~171줄, 13개 파일)와 테스트 커플링(21개 테스트 파일이 한국어 리터럴을 직접 assert)을 근거로, 전면 착수보다 단계적 축소 착수를 권장. 실행 여부는 사용자 결정 대기.

## [`docs/self-check-request.md`](./done/2026-08-05/self-check-request.md) 기반 (2026-07-22 조사)

사용자가 직접 작성한 개선 요청 6건을 코드 조사로 검증하고 계획 문서화했다. 각 항목의 상세 근거(파일:라인)·원인·제안 방안은 아래 표에서 링크된 문서 참고.

**이 배치(01~06) 작업은 전부 `fix/self-check-2026-07-22` 브랜치에서 진행한다.** `main`에서 새로 가지치기하지 말고 이 브랜치에 이어서 커밋할 것. 항목별로 병렬 작업이 필요하면 `main`이 아니라 이 브랜치를 기준으로 브랜치아웃(`git checkout -b fix/self-check-XX-... fix/self-check-2026-07-22`)하거나, 동시에 여러 항목을 건드려야 하면 `git worktree`로 별도 작업 트리를 두고 각각 이 브랜치로 머지해 들어오는 방식을 쓴다.

| # | 문서 | 요약 | 상태 |
|---|------|------|------|
| 1 | [done/2026-07-30/01-explorer-active-tab-sync.md](./done/2026-07-30/01-explorer-active-tab-sync.md) | 탭 이동 시 탐색기가 활성 파일을 추적하지 않음 — 탭→탐색기 동기화 자체가 없음 | 완료 |
| 2 | [done/2026-07-30/02-toc-scrollspy-offset-bias.md](./done/2026-07-30/02-toc-scrollspy-offset-bias.md) | 좌측 목차 하이라이트가 실제 스크롤보다 한 항목 뒤처짐 — offsetTop 기준점 오차(≈116px) | 완료 |
| 3 | [done/2026-07-30/03-tab-switch-scroll-animation.md](./done/2026-07-30/03-tab-switch-scroll-animation.md) | 탭 전환/새 문서 열기 시 불필요한 스크롤 애니메이션 — `scroll-behavior:smooth` + 새 탭 스크롤 미리셋 | 완료 |
| 4 | [done/2026-08-05/04-split-view-scroll-boundary-latch.md](./done/2026-08-05/04-split-view-scroll-boundary-latch.md) | 분할뷰 스크롤 경계에서 반대 방향 전까지 먹통 — 2026-07-30엔 네이티브 래칭으로 잠정 결론, 2026-08-04 Ian이 직접 재현해 결론이 뒤집힘(에코 판별 버스트 오판이 원인). 근본 수정 적용, 2026-08-05 Ian이 실기기에서 재확인 | 완료 |
| 5 | [done/2026-07-30/05-local-link-anchor-fragment.md](./done/2026-07-30/05-local-link-anchor-fragment.md) | `#앵커` 붙은 로컬 링크가 항상 열기 실패 — 해시가 파일 경로 문자열에 그대로 섞여 들어감 | 완료 |
| 6 | [done/2026-07-30/06-security-hardening-audit-2026-07-22.md](./done/2026-07-30/06-security-hardening-audit-2026-07-22.md) | 보안 감사 결과 — HIGH 1(로컬 파일 원클릭 실행), MEDIUM 2, LOW 4 | 완료 |

### 권장 착수 순서
1. **#6 (보안, HIGH-1)** — `open-local-path`의 임의 실행 경로는 심각도가 가장 높고 다른 항목과 독립적이라 가장 먼저 처리 권장.
2. **#5, #3, #1** — 서로 다른 파일을 건드리는 독립적인 작은 수정. 병행 가능.
3. **#2** — TOC 오프셋 수정은 #3과 같은 스크롤 관련 영역이지만 다른 파일(`markdown.js` vs `index.html`/`workspace.js`)이라 충돌 없음.
4. **#4** — 코드 수정 전에 재현 판별 실험이 선행되어야 하므로 마지막. 판별 결과에 따라 범위가 "하드닝"으로 축소되거나 "조사 종료"로 닫힐 수 있음.

## [`done/2026-08-05/07-usability-roadmap-followup-gaps.md`](./done/2026-08-05/07-usability-roadmap-followup-gaps.md) — 2026-07-13 사용성 로드맵 후속 갭 (2026-08-04 재조사, 2026-08-05 구현 완료)

로컬 스크래치였던 사용성 개선 로드맵(`.sisyphus/plans/usability-feature-roadmap.md`, 삭제됨)이 SHIPPED 표시와 함께 남겨둔 "Known gaps" 4건을 코드 조사로 재검증. 위 self-check 배치와는 별개 출처.

| # | 요약 | 상태 |
|---|------|------|
| A | 분할뷰에 리사이즈 가능한 구분선 없음 | 완료 (2026-08-04, `/team`) |
| B | 검색이 소스/분할모드에서 하드 비활성 | 라우팅은 고쳐져 있었으나 하이라이팅이 별도로 깨져 있었음 — [`done/2026-08-04/08`](./done/2026-08-04/08-search-highlight-and-ime-fixes.md)에서 완료 |
| C | `copyAll`/`copyCode` 클립보드 실패가 무음 | 완료 (2026-08-05, `/team`) |
| D | 빈 탐색기 힌트가 "+" 버튼을 가리키나 실제 버튼은 "열기" | 완료 (2026-08-05, `/team`) |

## [`done/2026-08-04/08-search-highlight-and-ime-fixes.md`](./done/2026-08-04/08-search-highlight-and-ime-fixes.md) — 편집모드 검색 하이라이팅 및 한글 IME Enter 중복 입력 (2026-08-04, 2026-08-05 회귀 테스트 보강)

Ian이 직접 보고한 두 버그: 편집모드 검색 매치가 하이라이트되지 않음(포커스를 에디터로 옮겼다가 같은 호출에서 즉시 되돌려 페인트 기회가 없었음), 검색창에 한글 입력 후 Enter 시 마지막 글자 중복(IME 조합 확정 키 입력에 `isComposing` 가드 없이 `preventDefault()`를 걸었던 것). 둘 다 원인 확인 및 수정 완료. 수정 전제(이벤트 리스너 등록 순서)를 지키는 Electron 회귀 테스트를 2026-08-05에 추가해 마지막 리스크도 닫았다 — 구현 중 "매치 이동 직후 Enter 2회"만으로는 이 회귀를 잡을 수 없다는 것(선택 영역이 비어 있지 않으면 `editor.js`의 Enter 핸들러가 애초에 무동작이라는 정확한 재현 조건)이 새로 밝혀져 문서에 반영했다.

## [`done/2026-08-05/09-code-block-copy-gutter-redesign.md`](./done/2026-08-05/09-code-block-copy-gutter-redesign.md) — 코드블럭 헤더/복사버튼 우측 여백(gutter) 재설계 + 아이콘 클리핑 수정 (2026-08-04 설계, 2026-08-05 구현)

2026-08-04에 `/team`에서 코드블럭 복사 버튼을 우측상단 절대위치 아이콘으로 만들었는데, Ian이 실사용해보니 긴 코드 줄이 가로 스크롤되면 아이콘과 시각적으로 겹칠 수 있고 아이콘 자체도 SVG 좌표 버그로 잘려 보임을 발견. 코드 영역과 절대 겹칠 수 없는 우측 고정폭 세로 여백(gutter, flex 형제 컬럼)으로 구조를 바꾸고, 언어가 있을 때는 그 위에 예약 라벨 줄을 되살렸다. 2026-08-05에 설계 문서 그대로 구현·테스트 완료.
