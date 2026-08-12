# 13. 성능 개선/다이어트 — 대용량 폴더 중단, 종료 지연, 전반적 무거움

## 상태
**구현·검증 완료** (2026-08-12). 유닛 172개(신규 11개 포함) + Electron 스모크 84개(신규 3개 포함) 전부 통과. 실제 앱을 띄워 mermaid/katex 지연 로딩과 다크 테마 초기 렌더링을 스크린샷으로 확인.

## 배경
사용자가 "앱이 점점 무거워지고 있다", "Cmd+Q 종료 시 딜레이 발생", "`~/projects/`처럼 내용 많은 디렉토리를 열면 앱이 중단된다"고 보고했다. Explore 에이전트 3개(종료 지연/대용량 폴더 중단/전반 무거움, 각각 독립 조사)로 1차 조사하고 Plan 에이전트로 구현 설계를 검증했다.

1차 조사는 종료 지연을 "dirty 탭이 있을 때만" 발생하는 별도 원인(`dialog.showMessageBoxSync`의 순차 블로킹)으로 봤으나, 사용자가 "dirty 탭 없이도 재현된다"고 정정해 전용 Explore 에이전트로 재조사했다. 그 결과 종료 지연은 별개 버그가 아니라 **대용량 폴더 문제의 증상**임이 드러났다 — 최종 근본 원인은 3가지(A/C-1/C-2)이고, A가 사용자가 보고한 두 증상(폴더 열기 중단 + 종료 지연)을 동시에 설명한다.

## 근본 원인 및 해결 방안

### A. 대용량 디렉토리 열기 시 중단 + Cmd+Q 종료 지연 (단일 근본 원인)

`src/main.js`의 `watch-directory` 핸들러가 폴더를 열 때마다 `chokidar.watch(dirPath, { ignored: DIR_WATCH_IGNORED, depth: 10 })`를 생성했다. `DIR_WATCH_IGNORED`는 `node_modules`/닷디렉토리만 제외했고, `dist`/`build`/`coverage`/`target`/`vendor` 같은 흔한 산출물 디렉토리는 걸러지지 않았다. chokidar 소스(`node_modules/chokidar/handler.js`의 `FsWatchInstances`)를 직접 확인한 결과, macOS에서도 fsevents 패스트패스 없이 **디렉토리마다 개별 네이티브 `fs.watch()`**를 건다 — `~/projects/`처럼 여러 저장소를 자식으로 둔 컨테이너를 depth 10으로 열면 산출물까지 포함해 수만 개 경로를 enumerate하고 그만큼의 네이티브 워치 핸들을 만들어, 싱글스레드 메인 프로세스 이벤트 루프를 오래 점유한다.

Cmd+Q 재조사에서는 main.js의 quit 관련 핸들러(`before-quit`/`window-all-closed`/`close`/`closed`)를 전부 나열하고 각각의 비용을 확인 — `persistSession()`(세션 상태 하나를 `JSON.stringify` + `writeFileSync`)은 탭/워처 수에 비례하지 않아 원인에서 제외됐고, 워처 정리(`registerWatchSweep`)도 quit 시퀀스에 훅되어 있지 않아 블로킹 원인이 아니었다. 남는 설명은 하나: Cmd+Q를 누른 시점에 위 대형 디렉토리 스캔이 아직 메인 프로세스 이벤트 루프 큐를 점유 중이면, `before-quit`/`close`처럼 가벼운 동기 작업도 그 뒤로 밀려 실행이 지연된다 — dirty 여부와 무관하게 재현되는 지연을 정확히 설명하는 유일한 가설이었고, 실제로 그러했다.

**적용한 해결책** (`src/main.js`):
1. `DIR_WATCH_DEPTH: 10 → 1` — 구조적 1차 방어선. 탐색기 트리 자체는 이미 펼칠 때만 해당 레벨을 다시 읽는 지연 로딩(`list-directory`, 단일 `readdir`)이라 워처가 그렇게 깊을 필요가 없었다. 트레이드오프: 2단계 이상 하위의 외부 변경은 자동 반영되지 않고, 해당 폴더를 접었다 펼치면 최신화된다.
2. `DIR_WATCH_IGNORED`에 `dist|build|out|coverage|target|vendor` 추가.
3. `makeGuardedIgnore` — `ignored`를 정규식 대신 함수로 바꿔, chokidar가 실제로 훑은 고유 경로 수(`Set`으로 dedupe — `_isIgnored`가 초기 스캔과 이후 이벤트 경로 양쪽에서 재호출되므로 단순 호출 카운터는 중복 집계됨을 소스로 확인)가 `DIR_WATCH_MAX_PATHS`(기본 20000, 테스트용 `MDV_TEST_DIR_WATCH_MAX_PATHS` 오버라이드 지원)를 넘으면 그 시점에 워처를 닫고 렌더러에 `directory-watch-unavailable` IPC를 보낸다. 렌더러(`explorer.js`)는 이를 받아 "폴더가 너무 커서 실시간 변경 감지를 껐습니다" 토스트를 띄운다(`preload.js`/`app.js`에 배선).

`dialog.showMessageBoxSync`의 순차 블로킹(main.js 주석에 명시된 의도된 설계) 자체는 여전히 존재하지만, "여러 창에 각각 dirty 탭이 있을 때"라는 훨씬 좁은 시나리오에만 해당하고 이번 재현 조건(dirty 무관)을 설명하지 못해 **이번 범위에서 제외**했다.

### C-2. 세션 복원 시 모든 탭 즉시 완전 렌더링

`app.js`의 `restoreSession`이 저장된 탭 경로마다 `workspaceController.createTab(data)`를 순차 호출했는데, `createTab`은 무조건 `await render(...)`로 즉시 완전 렌더링(markdown 파싱+hljs+mermaid+katex+DOMPurify)한다 — 활성 탭 하나만 보이는데 N개 탭이면 N번 다 렌더링했다.

기존에 `restoreTabState`(workspace.js)가 `tab.previewDirty === true`일 때 캐시된 HTML을 임시로 붙이고 비동기로 다시 렌더링하는 경로(원래는 "백그라운드 탭이 외부 변경을 흡수한 경우"용)를 이미 갖고 있었고, `tab.renderedHTML: null`에도 안전하다는 걸 코드로 확인해 **새 lazy-render 인프라 없이 재사용**했다.

**적용한 해결책**: `workspace.js`에 기존 `createTab`은 건드리지 않고(컨트롤러/유닛 테스트가 즉시 렌더 완료를 전제하는 계약을 유지해야 함) 나란히 `createBackgroundTab(data)`를 추가 — `render()` 호출 없이 탭 객체만 만들고 `previewDirty: true`로 표시. `restoreSession`은 이 함수로 모든 탭을 만든 뒤, 실제 활성 탭 하나에만 `switchToTab`을 호출한다(`previewDirty` 경로가 그 시점에 실제 렌더를 트리거).

### C-1. mermaid/katex 무조건 즉시 로드

`index.html`에서 `marked`/`highlight.js`/`dompurify`/mermaid(3.4MB)/katex(268KB+폰트 1.1MB)가 동기 `<script>`로 창마다 항상 로드·파싱·실행됐다 — 문서에 mermaid/수식이 하나도 없어도 동일.

**적용한 해결책**: `index.html`에서 mermaid/katex의 정적 `<script>`만 제거(katex.min.css는 정적 `<link>` 유지 — FOUC 방지, 폰트는 어차피 지연 로드됨). `markdown.js`의 `render()`(이미 `async`)가 `renderMarkdown(body)` 호출 전에 원본 텍스트를 정규식(` ```mermaid` / ` ```(latex|math)`)으로 스캔해, 필요한 라이브러리만 `ensureMermaidLoaded()`/`ensureKatexLoaded()`로 동적 `<script>` 주입 후 `await`한다. 로드 Promise는 `Map`에 캐싱해 같은 세션 내 재로드를 막고, 실패 시(예: 손상된 설치) 캐시를 지워 다음 렌더에서 재시도 가능하게 하며 — **실패해도 `render()` 자체는 절대 throw하지 않고** `getMermaidLib()`/`getKatexLib()`가 계속 falsy로 남아 기존 no-lib 폴백(플레이스홀더 미처리/일반 코드블럭 폴백)이 그대로 동작한다.

**함께 고친 함정**: `themeController`의 `onThemeApplied`가 부트 시 최초 1회 `mermaid.initialize(...)`를 호출해 초기 테마를 건네주던 유일한 지점이었는데, 지연 로딩 하에서는 그 시점에 mermaid가 아직 없어 조용히 스킵되고 이후에도 다시 불리지 않아 **첫 다이어그램이 항상 라이트 테마로 그려지는 조용한 회귀**가 될 뻔했다. `theme.js`에 부작용 없는 `getIsDark()` 접근자를 추가하고, `markdown.js`의 `onMermaidLoaded` 콜백(로드 완료 시 호출)에서 `app.js`가 이 접근자로 현재 테마를 읽어 `mermaid.initialize({ securityLevel:'strict', theme, startOnLoad:false })`를 스스로 호출하도록 배선했다. `securityLevel:'strict'` 누락은 스타일이 아니라 보안 회귀이므로 이 훅에 반드시 포함시켰다.

## 구현 중 발견/조정된 사항

- **테스트에서 chokidar 'add' 이벤트 실시간 전달이 불안정함을 발견**: 순수 Node 환경에서 chokidar depth:1은 15/15 안정적이었지만, 이 Electron 테스트 하네스 안에서는 동일 설정이 라이브 `add` 이벤트 전달 기준으로 간헐적으로 실패했다(원시 fs 레벨 rename/change 이벤트는 계속 도착하는데 chokidar의 add 승격이 안 되는 현상). 근본 원인은 끝까지 확정하지 못했지만, 이 저장소의 기존 파일워칭 테스트들도 전부 실제 워처가 아니라 IPC를 직접 시뮬레이션(`emitFileChanged` 등)하는 방식이라 이 신뢰성 문제를 애초에 건드리지 않았다는 걸 확인했다. A의 테스트는 라이브 이벤트 대신 `chokidar.getWatched()`로 워처의 실제 감시 상태를 구조적으로 검증하는 방식으로 설계해 이 문제를 완전히 우회했다 — `main.js`에 테스트 전용(`MDV_USER_DATA_DIR` 가드) `globalThis.__mdvDirWatchers` 노출과 `entry.ready` 플래그를 추가했다.
- **jsdom은 동적 `<script src>`의 load/error를 발생시키지 않음**을 실측으로 확인 — `tests/unit/markdown.test.js`의 스냅샷 하네스에 `document.head.appendChild`를 가로채 로드 성공/실패를 시뮬레이션하는 스텁을 추가(`simulateScriptLoad: 'fail' | 'succeed'`).
- `ensureMermaidLoaded`/`ensureKatexLoaded`가 로드 실패를 삼키지 않고 그대로 throw하면 `render()` 전체가 reject되어 "라이브러리 없이도 문서는 렌더돼야 한다"는 기존 계약을 깰 뻔했다 — try/catch로 감싸 로그만 남기고 폴백시키도록 구현 중 수정.

## 변경 파일
- `src/main.js` (A: `DIR_WATCH_IGNORED`/`DIR_WATCH_DEPTH`/`makeGuardedIgnore` 카운트 가드, `directory-watch-unavailable` IPC, 테스트 전용 `globalThis.__mdvDirWatchers`)
- `src/preload.js`, `src/renderer/explorer.js`, `src/renderer/app.js` (`directory-watch-unavailable` → 토스트 배선)
- `src/renderer/markdown.js` (C-1: `ensureMermaidLoaded`/`ensureKatexLoaded`/`loadScriptOnce`, `render()` 사전 스캔)
- `src/renderer/app.js` (C-1: `onMermaidLoaded` 훅, `katexLib: katex` 즉시 참조 제거; C-2: `restoreSession` 재작성)
- `src/renderer/workspace.js` (C-2: `createBackgroundTab` 추가)
- `src/renderer/theme.js` (C-1: `getIsDark()` 접근자)
- `src/renderer/index.html` (mermaid/katex 정적 `<script>` 제거)
- `tests/electron/large-directory-watch.test.js` (신규), `tests/electron/session-and-windows.test.js` (신규 1건), `tests/unit/markdown.test.js` (신규 5건 + 하네스 확장)
- `AGENTS.md` (mermaid/katex 지연 로딩, 디렉토리 워치 depth/ignore/가드, 세션 복원 lazy 렌더링 아키텍처 문서화)

## 테스트 계획 (완료)
- `npm run test:unit`: 172/172 통과.
- `npm run test:electron`: 84/84 통과 — 특히 `watch-directory only watches shallow, non-ignored paths`, `a pathologically large directory trips the path-count guard instead of hanging the app`, `a background tab restored from a saved session renders correctly the first time it is switched to`, 기존 `mermaid fence renders an actual diagram, redraws on a theme toggle...`/`latex/math fences render via KaTeX...`(실제 mermaid/katex 번들로 지연 로딩 경로를 그대로 통과).
- 실사용 스크립트로 스크린샷 검증: (1) 다크 테마로 전환한 뒤(즉, mermaid가 단 한 번도 실행된 적 없는 상태에서) mermaid 문서를 처음 열었을 때 다이어그램이 다크 테마로 정확히 그려짐(초기화 훅 검증), (2) 일반 문서에서는 katex 스크립트가 전혀 로드되지 않다가 latex 문서를 열 때만 로드됨.

## 리스크 / 후속 과제
- `dialog.showMessageBoxSync` 순차 블로킹(여러 창 + 각각 dirty 탭)은 의도적으로 이번 범위에서 제외했다 — A 적용 후 실사용에서 이 좁은 시나리오의 지연이 여전히 체감된다면 별도로 다룬다.
- chokidar 'add' 이벤트가 이 Electron 하네스에서 간헐적으로 누락되는 현상의 근본 원인은 미확정 — 실사용에서 폴더 자동 새로고침이 가끔 누락되는 것처럼 보인다면(수동으로 폴더를 접었다 펼치면 항상 정확) 이 이슈를 참고해 재조사할 것.
