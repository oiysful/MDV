# 10. mermaid 다이어그램 지원 + 사용성 개선 3건 + 프론트매터 메타 블록

## 상태
**완료 (구현·검증 완료)** — 2026-08-05 설계 후 같은 날 권장 순서(2-3 → 4 → 2-2 → 2-1 → 3 → 1)대로 6개 항목 전부 구현했다. 유닛(마크다운/검색/탐색기) + 컨트롤러 + Electron 스모크(78/78, mermaid 케이스 포함) 테스트로 검증. 구현 중 설계에 없던 이슈 하나를 실측으로 발견·수정: DOMPurify가 mXSS 방어 차원에서 인코딩된 `>`(예: mermaid의 `A-->B` 화살표)가 포함된 속성값을 통째로 제거해 `data-mermaid-src`가 사라졌다 — base64 인코딩(`utf8ToBase64`/`base64ToUtf8`, 한글 라벨 포함 round-trip 검증)으로 우회. mermaid는 실제 Electron 앱에서 SVG 렌더링·테마 토글 시 실제 재렌더(새 SVG id)·탭 전환 시 스냅샷 재사용(SVG id 불변, 중복 실행 없음)·CSP 위반 0건까지 실측 확인했다.

### 설계 대비 실제 구현에서 확인/보정된 사항
- 2-2(검색 가로 스크롤): 실험 결과 네이티브 caret reveal은 가로축에서 작동하지 않음을 확인(`scrollLeft`가 focus+setSelectionRange 후에도 0 유지) — 설계대로 미러 측정 함수(`computeScrollLeftForOffset`, `measureTextWidth`)를 구현. 세로 스크롤러도 실제로는 `#scroll-area`(조상)이었음을 확인해 `computeScrollTopForOffset`이 그 좌표계로 계산하도록 수정.
- 1(mermaid): `node_modules/mermaid/dist/mermaid.min.js`는 package.json의 `exports`엔 ESM만 명시돼 있지만(`.mjs`), `<script src>` 로딩은 exports 필드를 거치지 않고 파일을 직접 읽으므로 무관함을 확인. 번들 자체는 esbuild의 `globalThis["mermaid"] = ...` 패턴으로 전역 노출되는 실질적 UMD 동등물이라 기존 marked/hljs/dompurify 패턴 그대로 적용 가능했다.
- 4(복사 버튼): 설계대로 오버레이 회귀 + 커스텀 툴팁 구현. `.copy-btn:hover::after`와 `.copy-btn.copied::after`가 특이성 동률이라 소스 순서로 후자가 이겨야 하는데, opacity가 CSS 트랜지션(.1s) 중이라 클래스 변경 직후 즉시 읽으면 구값이 보일 수 있음 — 테스트를 클래스 존재 확인에서 최종 opacity 값 폴링으로 보정(실제 동작 버그 아님, 테스트 타이밍 이슈).

## 개요
Ian이 정리한 항목들을 조사·설계했다:
1. **기능 추가** — mermaid 다이어그램 렌더링 지원
2. **사용성 개선** — 탐색기 파일 삭제/이동 미추적, 검색 시 가로 스크롤 미포커스, 표 정렬 문법(`:---:`) 미적용
3. **기능 추가** — 프론트매터(YAML front matter)를 접을 수 있는 메타 블록으로 렌더 (조사 후 Ian이 2번 방향으로 확정)
4. **UI 개선** — 코드블럭 복사 버튼의 호버/포커스 인터랙션을 Claude 데스크탑 앱 스크린샷 그대로 맞추기 (2026-08-05 추가 요청)

대부분 서로 다른 파일을 건드리지만 완전히 독립적이진 않다 — 1(mermaid)과 4(복사 버튼)는 둘 다 `markdown.js`의 `renderer.code`와 `tests/unit/markdown.test.js`를 공유하고, 2-3(표 정렬)과 4는 둘 다 `index.html`의 CSS를 건드린다. 권장 순서(문서 끝 참고)는 이 충돌을 피하도록 이미 짜여 있다.

---

## 1. mermaid 다이어그램 지원 (기능 추가)

### 현재 상태
- `src/renderer/markdown.js:95-105` `renderer.code`가 유일한 marked 렌더러 오버라이드. `langId='mermaid'`는 `hljs.getLanguage('mermaid')`가 없어(hljs 기본 언어 미포함) `highlightAuto` 경로로 빠지고, **엉뚱한 언어로 오탐 하이라이팅된 일반 코드블록**으로 렌더된다.
- `package.json` dependencies에 mermaid 없음. 레포 전체에 "mermaid" 문자열 0건(이 조사 이전 기준).
- 라이브러리 로딩 패턴: `src/renderer/index.html:11-13`이 `marked`/`hljs`/`dompurify`를 **npm 설치 후 `node_modules` 경로를 `<script>` 태그로 직접 참조**(번들러도 CDN도 아님). electron-builder의 `build.files`가 prod dependencies를 자동 포함하므로 이 패턴이 그대로 mermaid에도 적용 가능.
- CSP(`index.html:6-7`, `tests/unit/csp.test.js`로 고정 테스트됨): `script-src 'self'` — CDN 로드는 불가하지만 로컬 파일 로드는 허용. `style-src 'unsafe-inline'`은 이미 있어 mermaid의 인라인 `<style>` 삽입과 충돌 없음. mermaid는 SVG를 DOM에 직접 삽입(blob:/data: URI를 쓰지 않음)하므로 `img-src` 제약과도 무관 — **CSP 변경 불필요**.
- 테마: `src/renderer/theme.js:5-25` `applyTheme()`이 `data-theme` 속성 설정 + hljs 스타일시트 `disabled` 토글만 함. 콜백/훅 노출 없음 — mermaid는 `mermaid.initialize({theme})`가 렌더 시점에만 반영되므로 CSS 토글만으론 테마 전환이 안 되고 **재렌더가 필요**.
- Split view: `src/renderer/app.js:270-286` `handleSourceInput`(120ms 디바운스) → `app.js:288-310` `renderSplitPreview`가 stale-version 가드(`splitRenderVersion`)와 스크롤 비율 저장/복원을 수행. mermaid를 비동기로 그리면 SVG 삽입 후 `scrollHeight`가 바뀌어 스크롤 복원이 틀어질 수 있다.
- 스냅샷: `markdown.js:206-213` `captureSnapshotHTML` / `:257-267` `hydrateFromDom`이 렌더된 DOM을 문자열로 저장·복원(탭 전환 시). mermaid가 그린 SVG도 여기 포함되므로 복원 시 재실행 여부를 정해야 한다.

### 설계
1. **의존성**: `mermaid`를 `dependencies`에 추가하기 **전에** `npm i` 후 `node_modules/mermaid/dist/`와 `package.json`의 `exports` 필드를 확인해 UMD/IIFE 번들이 실제로 제공되는지 검증한다. ESM-only 배포 버전은 기존 전역 스크립트 패턴과 안 맞을 뿐 아니라, `<script type="module">`을 `file://`로 로드하면 Chromium이 CORS로 차단할 수 있어 폴백으로도 쓸 수 없다 — 이 앱이 `file://`로 렌더러를 로드하는지부터 확인하고, UMD 번들이 없다면 접근 방식 자체를 재검토해야 한다. UMD 확인 후 버전 고정.
2. **로딩**: `index.html:13` 다음 줄에 `<script src="../../node_modules/mermaid/dist/mermaid.min.js"></script>` 추가(기존 3개 라이브러리와 동일 패턴). 전역 `mermaid` 사용, 자동 실행 방지를 위해 `mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ... })`을 `app.js` 초기화부에서 호출.
   - `securityLevel: 'strict'`를 명시해 다이어그램 라벨에 임의 HTML/스크립트가 섞여도 mermaid 자체 sanitize를 통과하도록 강제(mermaid 기본값이 아닌 명시적 설정으로 회귀 방지).
3. **렌더러 진입점**: `markdown.js:95` `renderer.code`에서 `langId === 'mermaid'`일 때 코드 하이라이팅 경로를 타지 않고 `<pre class="mermaid" data-mermaid-src="...">${escapeHtml(code)}</pre>` 형태의 플레이스홀더를 반환(mermaid 관례 — `class="mermaid"`가 mermaid.js의 기본 셀렉터).
   - marked의 `walkTokens`/`extensions`는 이 코드베이스에 선례가 없으므로(오버라이드는 전부 Renderer 방식) 기존 패턴을 따라 `renderer.code` 분기로 처리한다.
4. **DOMPurify 통과**: `markdown.js:64-69` `sanitizeHtml`(DOMPurify 기본 설정)이 `<pre class="mermaid">` + 텍스트 콘텐츠는 그대로 통과시킨다(속성/텍스트만 있고 위험 요소 없음) — 추가 설정 불필요.
5. **후처리 실행 지점**: `markdown.js:190-199` `render(text, filename, docPath)`에서 `refs.content.innerHTML = renderMarkdown(text)` 직후, `updateStats`/`buildToc` 이전 또는 이후에 `await runMermaidBlocks(refs.content)` 호출을 추가 — `refs.content` 내 `.mermaid` 요소들을 모아 `mermaid.run({ nodes })`로 그린다(비동기).
   - split view(`app.js:288-310` `renderSplitPreview`)에서는 mermaid 렌더 완료까지 기다린 뒤 스크롤 비율을 복원하도록 `await` 순서 조정 필요(현재 스크롤 비율 계산이 SVG 삽입 전 `scrollHeight` 기준이면 어긋남). **중요**: `splitRenderVersion` stale-version 가드는 `await runMermaidBlocks(...)` 진입 **전이 아니라 완료 후**에 다시 비교해야 한다 — 120ms 디바운스 입력이 이 await 도중에 새로 들어오면, 재비교 없이는 오래된 렌더 결과로 스크롤/DOM을 건드리게 된다.
   - `app.js:315-330` `ensurePreviewRendered()`(인쇄/PDF 내보내기 경로)도 mermaid 렌더 완료를 await해야 내보내기 결과에 다이어그램이 빠지지 않는다.
6. **테마 연동**: `theme.js`의 `applyTheme()`에 mermaid 재렌더 콜백을 추가(테마 토글마다 `mermaid.initialize({theme: isDark?'dark':'default'})` 후 현재 표시 중인 `.mermaid` 노드 재실행). 콜백 등록 지점을 `theme.js`가 `app.js`에 노출하도록 소규모 인터페이스 추가.
7. **스냅샷 중복 실행 방지**: `hydrateFromDom`(markdown.js:257) 경로로 탭 복귀 시, 이미 SVG로 치환된 `.mermaid` 노드를 다시 `mermaid.run()`에 넘기면 중복 렌더/에러가 날 수 있다. 다만 `mermaid.run()`은 처리한 노드에 자체적으로 `data-processed="true"`를 찍고 재실행 시 스킵하므로, 별도 `data-mermaid-rendered` 마커가 정말 필요한지부터 확인할 것 — 필요한 건 이 마커가 아니라 (a) `captureSnapshotHTML`/`hydrateFromDom` 왕복 후에도 `data-processed` 속성과 삽입된 SVG(및 mermaid가 넣는 `<style>` 블록, `foreignObject` 사용 여부)가 DOMPurify를 그대로 통과하는지, (b) mermaid가 렌더마다 랜덤 엘리먼트 ID를 새로 생성한다는 점 — 두 가지 확인이다. (b)는 스냅샷 관련 테스트를 작성할 때 SVG의 `id` 속성값에 대해 assert하면 안 된다는 뜻이기도 하다.
8. **에러 처리**: 문법 오류가 있는 다이어그램은 mermaid가 자체적으로 에러 SVG를 그리는데, 이게 사용자에게 이해 가능한 형태인지 확인 필요(아니면 catch해서 에러 텍스트 블록으로 대체).
9. **테스트 가드**: `tests/unit/markdown.test.js`(jsdom)에는 전역 `mermaid`가 없다 — `runMermaidBlocks`에 `typeof mermaid === 'undefined'`일 때 즉시 반환하는 가드를 넣지 않으면 기존 유닛 테스트가 깨진다.

### 영향 파일
`package.json`, `src/renderer/index.html`(스크립트 태그 + 초기화 호출), `src/renderer/markdown.js`(renderer.code 분기, 후처리 함수), `src/renderer/app.js`(split-view 렌더 순서), `src/renderer/theme.js`(재렌더 훅), `tests/unit/markdown.test.js`(신규 케이스), `tests/unit/csp.test.js`(스크립트 추가 시 통과 여부 재확인 — 로컬 파일이라 통과 예상이나 검증 필요).

---

## 2. 사용성 개선

### 2-1. 탐색기가 파일 삭제/이동을 추적하지 않음

**원인 (확정)**: 디렉터리 감시 메커니즘이 **전혀 없음**.
- `src/renderer/explorer.js:206-245` `loadDir`은 `api.listDirectory(path)`를 1회 호출해 트리를 구성하는 일회성 스냅샷 — 구독을 걸지 않는다.
- `toggleFolderRow`(explorer.js:79-92)는 `dataset.loaded==='true'`면 재읽기를 스킵해서, 폴더를 접었다 펴도 갱신되지 않는다.
- 갱신 진입점은 `openFolder()`(explorer.js:184, 사용자가 폴더 다이얼로그로 재선택)와 `restoreRoot()`(explorer.js:196, 세션 복원) 단 2곳뿐. 새로고침 버튼 자체가 없음(`index.html:1515/1521`은 경로보기·폴더닫기만).
- `main.js`에 chokidar가 있지만(`main.js:6,15`) `watch-file` 핸들러(`main.js:531-564`)는 **개별 파일 경로만** 감시하고, `list-directory`(`main.js:273-288`)는 `fs.promises.readdir` 일회성 호출 — 디렉터리 watch 코드가 없다.
- 열린 탭이 외부에서 삭제되면 `handleExternalFileChange`(workspace.js:577) → `resolveExternalChangeAction`(workspace.js:22-26)이 `mark-deleted`로 분기해 `tab.dirty=true`로 표시하지만(workspace.js:591-597), `renderTabBar`(workspace.js:275)의 마커는 `dirty`와 `삭제됨`을 시각적으로 구분하지 않는다. 파일이 이동(rename)된 경우 chokidar는 옛 경로에 `unlink`만 보내 탭이 옛 경로를 그대로 들고 있다가 저장 시 옛 위치에 파일을 재생성한다(비대칭 버그).

**설계**:
1. `main.js`에 `watch-file`과 대칭되는 디렉터리 재귀 watch IPC(`watch-directory`/`unwatch-directory`)를 신설. chokidar로 열린 루트를 재귀 감시하고 `add`/`unlink`/`addDir`/`unlinkDir` 이벤트를 디바운스(예: 300ms, 대량 변경 시 이벤트 폭주 방지)해 `directory-changed` 이벤트로 renderer에 전달. **`ignored`에 `node_modules`, `.git`을 반드시 포함하고 `depth` 캡을 두어야 한다** — 제외 없이 레포 루트를 재귀 감시하면 수만 개의 watcher가 생겨 디바운스가 무의미해질 정도로 이벤트가 폭주한다. `watch-directory` 핸들러가 받는 경로는 `list-directory`(`main.js:273-288`)가 이미 하는 것과 동일한 수준의 검증(경로 정규화/존재 확인 등)을 그대로 적용 — 새 핸들러가 기존보다 느슨한 검증 통로가 되지 않도록 한다.
2. `preload.js`에 대응 API(`watchDirectory`/`unwatchDirectory`/`onDirectoryChanged`) 노출.
3. `explorer.js`의 `openFolder()`/`restoreRoot()`에서 watch 구독 시작, 폴더 닫기(`clearExplorerRoot` 등)에서 해제. **폴더를 다른 폴더로 전환하는 경우(재선택)도 놓치면 안 된다** — `openFolder()`가 새 루트를 구독하기 전에 이전 루트를 반드시 unwatch해야 하며, 그렇지 않으면 폴더를 바꿀 때마다 watcher가 하나씩 누적 누수된다. 최소 침습 갱신 전략은 `directory-changed` 수신 시 `loadDir(root, ...)`를 디바운스 재호출 — 단 현재 `dataset.loaded` 캐시와 펼침 상태가 초기화되므로, 재호출 전에 펼쳐진 폴더 경로 집합을 저장했다가 재구성 후 복원해야 한다(그렇지 않으면 트리가 매번 접힌 상태로 리셋되어 체감 사용성이 나빠짐).
4. 활성 탭이 가리키는 파일이 삭제된 경우, `renderTabBar`(workspace.js:275)의 마커를 `dirty`(●)와 구분되는 별도 표시(예: 취소선 또는 다른 아이콘)로 분리 — 현재 `mark-deleted` 상태가 이미 있으니 마커 로직만 손보면 됨.
5. 이동/리네임 비대칭은 이번 스코프에서는 "삭제로 감지 후 사용자가 인지할 수 있게 표시"까지만 다루고, 자동 경로 재매핑(같은 내용의 새 파일을 찾아 tab.path를 갱신하는 것)은 휴리스틱이 필요해 별도 조사 항목으로 분리 권장.

**영향 파일**: `src/main.js`, `src/preload.js`, `src/renderer/explorer.js`, `src/renderer/workspace.js`(마커 분리), `tests/unit/explorer.test.js`, `tests/electron/smoke.test.js`(실제 파일 삭제 시나리오 추가 필요 — 이 프로젝트는 Electron 스모크 테스트를 마지막에 한 번만 돌리는 관례이므로 유닛 테스트로 watch 콜백 로직을 최대한 커버).

---

### 2-2. 검색 시 가로 스크롤로 가려진 매치로 포커스 이동 안 함

**원인 (확정)**: `selectEditorMatch`(search.js:55-62)에 가로축 처리가 아예 없다. 세로만 `computeScrollTopForOffset`(search.js:18-23)으로 계산해 `editor.scrollTop`에 설정하고, 열(column) 오프셋 기반 `scrollLeft` 계산 함수는 존재하지 않는다(`src/` 전체에 `scrollLeft` 0건).
- 에디터는 순수 `<textarea id="source-editor">`(index.html:1561, CodeMirror 아님). CSS(`index.html:684-691`) `white-space: pre; overflow-x: auto; overflow-y: hidden` — **가로 스크롤 컨테이너는 textarea 자신**. 세로는 `autoResizeEditor()`(editor.js:307-310)가 `height=scrollHeight`로 늘리는 방식이라 실제 세로 스크롤러는 부모(`#scroll-area`/`#source-view`)다.
- 즉 현재 코드는 textarea가 스크롤할 수 없는 축(세로)에 `scrollTop`을 쓰고 있고(대부분 no-op에 가까움), 정작 스크롤 가능한 축(가로)에는 아무 처리가 없다. 세로 이동이 체감상 되는 건 `focus()`+`setSelectionRange`에 대한 Chromium의 네이티브 caret reveal이 조상 스크롤러로 전파되기 때문으로 보인다(미확정, 구현 착수 전 실험으로 반드시 먼저 검증). **실험 방법과 판별 기준**: `selectEditorMatch` 전후로 `editor.scrollWidth`, `editor.clientWidth`, `editor.scrollLeft`, 조상 스크롤러의 `scrollTop` 네 값을 모두 로그로 찍는다. 이 중 `scrollWidth === clientWidth`로 나오면 애초에 textarea가 가로로 오버플로하고 있지 않다는 뜻이라 아래 설계 전체(미러 측정 함수 포함)가 잘못된 원인을 겨냥한 게 된다 — 이 경우 진짜 원인은 `editor.js:174`가 `white-space: pre` CSS만으로 grep된 것인지, 아니면 textarea의 `wrap` **속성**(`wrap="off"`)을 실제로 토글하는지를 확인하는 쪽으로 옮겨간다(`white-space: pre` CSS만으로는 textarea의 소프트 랩이 꺼지지 않고, `wrap` 속성이 별도로 필요하다). 이 확인 하나가 2-2를 몇 줄짜리 수정으로 끝낼지, 아래 미러 측정 함수까지 구현할지를 가른다.
- 기본값 word-wrap이 꺼져 있어(`editor.js:174`, `=== '1'`일 때만 wrap) 기본 사용 경험에서 그대로 재현된다.
- 분할모드에서는 미리보기가 검색 대상이 아예 아니다(`app-runtime.js:295-298`, `getSourceMode()||getSplitMode()`면 무조건 `target:'editor'`) — 이번 버그 리포트가 "편집모드와 분할모드"라고 명시한 것과 일치(둘 다 결국 textarea 검색으로 귀결).
- 별개로, 미리보기(HTML) 쪽 검색은 `scrollIntoView({block:'center'})`(search.js:93)에 `inline` 옵션이 없어 코드블록 내부 매치도 가로 이동이 안 되는데, 이는 소스 모드가 아닌 뷰 모드에서만 해당하는 별개 이슈라 이번 스코프에서는 제외하거나 부수적으로 같이 고친다.

**설계**:
1. `search.js`에 `computeScrollLeftForOffset(editor, matchStart)` 신설. **`column * charWidth` 방식은 이 문서에서 쓰기에 부적합** — Ian은 한글 마크다운을 주로 작성하는데, Hangul 음절은 monospace 폰트에서 라틴 문자의 2배 너비(더블와이드)라 한글이 포함된 줄에서는 계산이 ~2배 어긋난다. 탭 문자도 고정폭이 아니다. 대신 숨겨진 미러 `<div>`를 만들어 에디터와 동일한 `font`/`padding`/`white-space`/`tab-size`를 복제하고, 매치 시작 위치까지의 행 prefix 텍스트를 넣은 뒤 그 끝에 zero-width marker `<span>`을 붙여 `getBoundingClientRect().left`를 읽는 방식으로 목표 `scrollLeft`를 계산한다 — CJK 폭, 탭, 폰트 폴백을 전부 실측으로 처리하므로 문자 단위 근사가 필요 없다. (단, 위 실험에서 네이티브 caret reveal이 이미 이 문제를 해결하고 있다고 판명되면 이 측정 함수 자체가 불필요할 수 있음.) 에디터 너비를 고려해 매치가 중앙 부근에 오도록 여백 보정.
2. `selectEditorMatch`(search.js:55-62)에서 `editor.scrollLeft = computeScrollLeftForOffset(...)` 호출 추가. 기존 `editor.scrollTop = computeScrollTopForOffset(...)`은 실제 세로 스크롤러(`#scroll-area`/`#source-view`)를 대상으로 하도록 재확인·수정(현재 textarea 자신에 설정하는 게 의미가 있는지 위 미확정 사항 검증 후 결정).
3. `advanceEditorMatch`(search.js:78-82)뿐 아니라 `runEditorSearch`(search.js:97-112, 타이핑 중 첫 매치 표시 경로)에도 동일 로직이 타도록 — 현재 이 경로는 포커스조차 옮기지 않아 첫 매치 노출 자체가 안 된다.

**영향 파일**: `src/renderer/search.js`, `tests/unit/search.test.js`(가로 스크롤 계산 단위 테스트 — jsdom에서 실제 렌더 폭 측정이 어려우면 계산 함수를 순수 함수로 분리해 로직만 테스트).

---

### 2-3. 표에서 `:---:` 정렬 문법이 적용되지 않음

**원인 (확정)**: 파서/렌더러는 정상이고 **CSS가 강제로 덮어쓴다**.
- `markdown.js:94-106`에서 오버라이드된 건 `renderer.code`뿐, `renderer.table`/`renderer.tablecell`은 marked 기본 구현 그대로다. `gfm: true`(markdown.js:106)로 GFM 테이블이 켜져 있고, 실행 확인 결과 `|:--|:-:|--:|`가 `<th align="left|center|right">`, `<td align=...>`를 정상 생성한다. DOMPurify(`dompurify`)도 `align` 속성을 허용 목록에 포함해 그대로 통과시킨다.
- 진짜 원인은 `src/renderer/index.html:1166-1167`:
  ```css
  #content th, #content td {
    padding: 9px var(--sp-sm); border-bottom: 1px solid var(--border); text-align: left;
  }
  ```
  HTML `align` 속성은 CSS 캐스케이드에서 presentational hint로 취급되어, **작성자 스타일시트의 어떤 `text-align` 선언에도 특이성과 무관하게 진다.** 따라서 이 무조건적 `text-align: left` 때문에 모든 셀이 강제로 왼쪽 정렬된다. `td[align]`/`th[align]` 선택자는 프로젝트 어디에도 없다.

**설계**: `index.html:1166-1167`의 `text-align: left`를 **단순 삭제하면 안 된다** — `th`의 UA 기본값은 `text-align: center`이므로, 삭제만 하면 정렬을 지정하지 않은 헤더 셀들이 조용히 가운데 정렬로 바뀌어 버린다(현재는 전부 왼쪽 정렬). 대신 `align` 속성이 없는 셀(정렬 미지정)만 왼쪽 정렬되도록 `#content th:not([align]), #content td:not([align]) { text-align: left; }`로 명시 규칙을 좁힌다. 이렇게 하면 `align` 속성이 있는 셀은 UA 기본 동작(align 속성 값 반영)을 따르고, 없는 셀은 기존과 동일하게 좌측 정렬을 유지한다(td는 원래 UA 기본이 left라 문제없지만, th는 이 명시 규칙이 없으면 회귀가 생긴다). 구현 시 `#content th, #content td`에 대한 다른 `text-align` 선언이 남아있지 않은지(특히 `@media print` 블록 안)도 grep으로 확인 — 하나라도 남아있으면 인쇄/내보내기 결과에서 이번 수정이 무효화된다.

**영향 파일**: `src/renderer/index.html`(CSS 수정, `@media print` 블록 포함 확인), `tests/unit/markdown.test.js`(정렬 렌더링 회귀 테스트 추가 — HTML에 `align` 속성이 나오는지는 이미 marked가 보장하므로, 실제로 필요한 건 CSS 회귀보다 렌더러가 attribute를 안 지운다는 확인 정도. 시각적 회귀는 실제 앱 스크린샷으로 확인).

---

## 3. 프론트매터(YAML front matter)를 접을 수 있는 메타 블록으로 렌더 (기능 추가)

**현재 상태 (사실만)**:
- 프론트매터 파싱/제거 로직이 전무하다. 파일 원문이 그대로 `markedLib.parse()`에 들어간다(`document-flow.js:122` → `app.js:218-220` → `markdown.js:190-192`).
- 실측: `---\ntitle: Hello\ndate: 2026-08-05\n---`를 렌더하면 `<hr>` + `<h2>title: Hello<br>date: 2026-08-05</h2>`가 나온다. 첫 `---`는 hr로, 나머지 줄들은 marked의 setext-heading 토크나이저에 의해 **h2로 승격**된다(hr 토크나이저가 lheading보다 먼저 시도되지만 두 번째 `---`는 앞에 텍스트가 있어 hr이 아닌 heading underline으로 해석됨).
- 이 잘못 렌더된 `<h2>`가 TOC에도 들어간다 — `buildToc()`(markdown.js:156)가 `#content h1,h2,h3`를 훑어 사이드바 항목을 만든다(markdown.js:166-171).
- 단어 수/읽기 시간 통계도 오염된다 — `updateStats(text)`가 원문 텍스트 전체를 기준으로 계산한다(markdown.js:195, computeStats).
- 소스 모드는 가공 없이 원문 그대로 표시(`editor.js:160`, textarea에 원문 그대로).
- 문서 제목은 현재 **파일명에서만** 유도된다(`stripMarkdownExtension(filename)` — markdown.js:194, document-flow.js:87, workspace.js:173). 프론트매터의 `title` 필드를 쓸 수 있는 지점이 잠재적으로 여기다. 별도 "문서 정보" 패널은 없음.

**검토했던 선택지**:
1. 완전히 숨기기(정규식/경량 YAML 파서로 감지·제거, 렌더링에서 배제).
2. **접을 수 있는 메타 블록으로 표시**(프론트매터를 파싱해 상단에 접힌 카드/표 형태로 렌더, Obsidian의 properties 패널과 유사한 UX). ← **Ian이 확정한 방향**.
3. `title` 필드만 활용(1번 + 탭 라벨에 title 사용).
4. 아무것도 안 함(현행 유지).

**설계 (2번)**:
1. **감지 조건**: 문서의 **맨 첫 줄**이 `---`이고, 그 뒤 어딘가에 닫는 `---` 줄이 존재할 때만 프론트매터로 인식한다. 이 조건이 중요한 이유는 marked의 hr/setext-heading 토크나이저 상호작용 때문에 "첫 줄"이 아닌 `---`는 정상적인 `<hr>`일 수 있어, 조건을 느슨하게 잡으면 본문 중간의 정상 `<hr>`을 프론트매터로 오인해 삼켜버릴 수 있기 때문이다. 닫는 `---`가 끝내 없으면 프론트매터로 취급하지 않고 원문을 그대로 marked에 넘긴다(현행 hr+오탐 heading 동작 유지).
2. **파싱 위치**: `document-flow.js:122` → `markdown.js:190-192`로 원문이 들어가기 전, `render()` 진입부에서 프론트매터 블록을 잘라내고 나머지 본문만 `markedLib.parse()`에 전달한다. 경량 YAML 파서(정규식 기반의 `key: value` 라인 단위 파싱으로 충분 — 중첩 구조까지는 이번 스코프에서 지원하지 않음)로 key-value 쌍을 추출.
3. **렌더**: 추출한 key-value 쌍을 `#content` 최상단에 접힌 카드(`<details>` 네이티브 엘리먼트 활용 권장 — 별도 JS 토글 로직 없이 접기/펼치기 기본 제공)로 렌더. 기본 상태는 접힘.
4. **TOC/통계 오염 해결**: 프론트매터 블록을 잘라낸 나머지 본문만 `buildToc()`(markdown.js:156)와 `updateStats()`(markdown.js:195)에 전달되므로 자연히 해결됨 — 별도 예외 처리 불필요.
5. **소스 모드**: 원문 그대로 표시(변경 없음) — 사용자가 textarea에서 프론트매터 원본을 그대로 편집 가능해야 하므로 소스 모드에는 손대지 않는다.
6. **`title` 필드**: 이번 스코프에서는 다루지 않음(3번 선택지는 채택하지 않았으나, 카드에 표시된 `title` 필드를 향후 탭 라벨에 반영하는 건 이 설계 위에 자연스럽게 얹을 수 있는 후속 확장으로 남겨둠).

**영향 파일**: `src/renderer/markdown.js`(프론트매터 파싱/제거 함수, 렌더 진입부 수정), `src/renderer/index.html`(메타 카드 CSS), `tests/unit/markdown.test.js`(프론트매터 있음/없음/닫는 `---` 없음/본문 중간 `---` 케이스).

---

## 4. 코드블럭 복사 버튼 호버 인터랙션을 Claude 데스크탑 앱 스타일로 맞추기 (UI 개선)

### 요청 배경
Ian이 Claude 데스크탑 앱의 코드블럭 스크린샷 3장을 제시했다:
1. **기본 상태**: 코드블럭에 복사 버튼이 전혀 보이지 않음(깔끔한 카드형 코드블럭).
2. **코드블럭에 마우스오버**: 우상단에 복사 아이콘(사각형 두 개가 겹친 클래식 copy 아이콘)이 코드 텍스트 위에 살짝 겹치듯 나타남.
3. **복사 아이콘 자체에 마우스오버**: 아이콘 배경이 진하게 바뀌고, 아이콘 아래쪽에 어두운 배경의 커스텀 툴팁("복사")이 뜬다.

### 기존 설계와의 충돌 (확인 완료, Ian 결정 반영)
현재 MDV(`src/renderer/index.html:1091-1148`, `src/renderer/markdown.js:95-105`)는 오늘 초 커밋(`8dfc467`, `2b1d14d`, [완료된 계획 09](./09-code-block-copy-gutter-redesign.md))에서 복사 버튼을 **절대위치 오버레이 → 고정폭(40px) 우측 gutter 컬럼**으로 의도적으로 바꿨다. 이유는 긴 코드 줄이 가로 스크롤될 때 절대위치 아이콘이 스크롤되는 텍스트와 계속 겹쳐 보이는 실사용 버그(Ian이 직접 재현·보고) 때문이었다. 이 사실을 Ian에게 확인한 결과, **스크린샷과 동일한 절대위치 오버레이로 되돌리고, 긴 줄 겹침 가능성은 감수하기로 결정했다**(이번 대화에서 명시적으로 확인). 즉 계획 09의 구조적 결정을 부분적으로 되돌리는 작업이다 — 우연한 회귀가 아니라 의식적인 선택임을 여기 기록해둔다.

### 현재 코드 상태 (그대로 쓸 수 있는 부분)
- 호버로 나타나는 동작 자체는 이미 있다: `.copy-btn { opacity: 0; ... }` + `.code-wrapper:hover .copy-btn { opacity: 1; }` (index.html:1143, 1145) — 스크린샷 1→2 전환과 이미 동일한 인터랙션.
- 아이콘 자체 호버 시 배경 변화도 있다: `.copy-btn:hover { background: color-mix(...); color: var(--code-text); }` (index.html:1146) — 스크린샷 3의 "진해지는 배경"과 방향은 같음.
- SVG 클리핑 버그는 이미 수정됨(`markdown.js:103`, `rect height="8"`, `viewBox 13`에 안전하게 들어감) — 추가 조치 불필요.
- **없는 것**: 커스텀 툴팁. 현재는 `title="코드 복사"` 네이티브 브라우저 툴팁뿐(markdown.js:104) — OS 기본 스타일(느린 지연, 각진 흰 박스)이라 스크린샷의 어두운 pill형 커스텀 툴팁과 다르다. 코드베이스 전체에 `tooltip` 관련 컴포넌트가 전무함(`grep -rn tooltip src/renderer/` 0건) — 이번이 첫 툴팁 컴포넌트.

### 설계
1. **레이아웃 되돌리기** (`src/renderer/index.html`):
   - `.code-wrapper`의 `display: flex; align-items: stretch;`(1096)를 제거하고 `position: relative`만 유지.
   - `.code-body`(1099-1106)의 `flex`/`min-width:0` 규칙 제거 — 다시 `.code-wrapper`의 유일한 콘텐츠 컬럼이 됨.
   - `.code-gutter`(1128-1135)와 그 `border-left` 구분선 삭제.
   - `.copy-btn`(1137-1148)에 `position: absolute; top: 8px; right: 8px; z-index: 1;` 추가(오버레이 방식). `opacity`/`hover` 트랜지션 규칙은 그대로 재사용. **`position: relative`가 `.code-wrapper`에 걸려 있는지 반드시 재확인** — 만약 `#content pre` 쪽에 `position: relative`가 있다면 버튼의 containing block이 스크롤되는 `<pre>`가 되어버려 "텍스트만 스크롤되고 버튼은 고정"이라는 의도된 동작이 깨지고 버튼이 코드와 함께 스크롤되어 사라진다.
   - `#content pre`(1116-1122)의 `overflow: hidden`이 `.code-body` 전용 규칙이었던 부분 확인 후 되돌리기(코드 자체 가로 스크롤은 `<pre>`가 계속 담당, 변경 없음).
   - 인쇄 스타일(1187행 `.code-gutter { display: none !important }`) 및 관련 규칙에서 `.code-gutter` 참조 제거.
2. **HTML 구조 되돌리기** (`src/renderer/markdown.js:104`): `<div class="code-wrapper"><div class="code-body">...</div><div class="code-gutter">...</div></div>` → `<div class="code-wrapper">${langRow}<pre><code class="hljs">${hl}</code></pre><button class="copy-btn" ...>${copyIcon}</button></div>`로 단순화(버튼이 wrapper의 직계 자식, 오버레이).
3. **불투명 배경 유지**: 버튼이 텍스트 위에 얹히므로 `background`가 완전 불투명해야 스크롤되는 텍스트가 비쳐 보이지 않는다 — 계획 09 이전에 이미 한 번 고친 이슈(커밋 `1c81f31`)라 `var(--code-bg)`가 알파 없는 solid 값인지 재확인.
4. **커스텀 툴팁 신규 구현**:
   - CSS로 `.copy-btn`에 `::after`(또는 별도 `.copy-tooltip` 엘리먼트)를 두고 `.copy-btn:hover` 시에만 `opacity`/`visibility` 전환으로 노출. 어두운 배경(`background: var(--text)` 계열 또는 다크 고정색), 흰 텍스트, 작은 border-radius, 아이콘 아래쪽에 위치(스크린샷 기준 아이콘보다 약간 왼쪽 정렬).
   - **`.code-wrapper`가 (둥근 모서리 등을 위해) `overflow: hidden`을 갖고 있을 가능성이 높다** — 이 경우 버튼 아래로 뻗는 `::after` 툴팁이 가로 방향으로 잘릴 수 있다(세로는 보통 안전 — 28px 아래여도 대부분 코드블록 내부에 들어감). 툴팁을 `right: 0`으로 고정해 왼쪽으로 자라게 앵커링하면 wrapper 밖으로 나가지 않는다.
   - 텍스트는 "코드 복사"를 쓸지 스크린샷처럼 "복사"로 축약할지 확인 필요 — 스크린샷은 "복사" 두 글자뿐이므로 짧은 문구로 통일 권장.
   - **접근성 (수정)**: 네이티브 `title` 속성과 커스텀 CSS 툴팁을 **동시에 두지 않는다** — Chromium은 `title`이 있으면 hover 시 자체 OS 툴팁을 별도로 띄우므로, 커스텀 툴팁 위에 없애려던 그 각진 흰 박스가 겹쳐서 뜬다. `title` 속성은 제거하고 `aria-label`만 유지한다(스크린리더에는 `aria-label` 단독으로 충분하며, `title`이 있어야만 접근 가능해지는 정보가 아니므로 손실 없음).
   - 복사 성공 시(`.copy-btn.copied`, index.html:1147-1148) 체크 아이콘으로 바뀌는 기존 동작과 툴팁이 동시에 뜨지 않게 — 클릭 시 툴팁을 즉시 숨기거나 "복사됨"으로 텍스트를 바꾸는 두 방법 중 택1 필요(스크린샷엔 클릭 후 상태가 없어 미정 — 구현 시 자연스러운 쪽으로 결정).
5. **회귀 테스트 정리** (구조 변경에 따라 반드시 갱신):
   - `tests/unit/markdown.test.js:69, 78` — `class="code-gutter"` assertion을 새 오버레이 마크업에 맞게 수정.
   - `tests/electron/smoke.test.js:327-341` (`code-gutter`가 code-body와 겹치지 않는지 검증), `:406-451`(`long code lines scroll under the code body without ever overlapping the gutter` 테스트 전체) — **이 테스트들이 검증하던 "겹침 불가능" 보장 자체를 이번 결정으로 포기**하므로 삭제하거나, "버튼이 항상 클릭 가능한 상태(z-index/pointer-events)는 유지된다" 같은 약화된 형태로 대체.
   - `tests/electron/smoke.test.js:379` — `code-gutter` 클래스 참조 갱신.
   - 신규 테스트: 커스텀 툴팁이 버튼 호버 시에만 나타나고 기본 상태·코드블럭 호버(버튼 미호버)에서는 숨겨져 있는지 검증하는 케이스 추가 권장.

### 영향 파일
`src/renderer/index.html`(CSS 되돌리기 + 툴팁 신규 CSS), `src/renderer/markdown.js`(HTML 구조 되돌리기), `tests/unit/markdown.test.js`, `tests/electron/smoke.test.js`(gutter 관련 3개 테스트 블록 수정/삭제 + 툴팁 신규 테스트).

### 열린 질문 (구현 시 결정)
- 툴팁 문구: "코드 복사" vs "복사" — 기존 `aria-label`과 통일할지 스크린샷처럼 짧게 갈지.
- 클릭 직후(복사 성공, 체크 아이콘 표시) 상태에서 툴팁을 어떻게 처리할지.
- 긴 줄이 스크롤되어 버튼과 겹칠 때의 시각적 결과를 실제로 한 번 확인(스크린샷처럼 불투명 배경이 텍스트를 가려주는 정도인지, 아니면 더 손볼 부분이 있는지)하는 것을 구현 후 실사용 검증 단계에 포함할 것.

---

## 권장 착수 순서

완전히 독립적이지는 않다 — 1(mermaid)과 4(복사 버튼)는 `markdown.js`의 `renderer.code`와 `tests/unit/markdown.test.js`를 공유하고, 2-3(표 정렬)과 4는 `index.html`의 CSS를 공유한다. 아래 순서는 이 두 충돌 쌍을 서로 떨어뜨려 배치했으므로 순서를 지키면 병행해도 충돌 없이 안전하다:

1. **표 정렬 (2-3)** — CSS 한 줄 수정으로 가장 작고 리스크 없음. 가장 먼저 처리 권장.
2. **코드블럭 복사 버튼 오버레이 회귀 (4)** — `markdown.js`/`index.html` 코드블럭 관련 두 파일만 건드리고, 계획 09가 이미 이 영역을 한 번 리팩터링해뒀기 때문에 구조를 다시 아는 상태에서 바로 이어 하는 게 효율적. 회귀 테스트(gutter 관련 3블록) 정리까지 포함. title/aria-label 중복 제거, containing block 재확인, 툴팁 클리핑 처리 포함.
3. **검색 가로 스크롤 (2-2)** — `search.js` 한 파일. **구현 착수 전 반드시 먼저** `scrollWidth`/`clientWidth`/`scrollLeft`/조상 `scrollTop` 실험으로 원인을 재확인 — 결과에 따라 미러 측정 함수 구현 여부가 갈린다.
4. **탐색기 파일 추적 (2-1)** — `main.js`/`preload.js`/`explorer.js` 3개 파일, IPC 신설이 필요해 상대적으로 범위가 큼. chokidar `ignored`/`depth` 설정과 폴더 전환 시 unwatch 누락 방지 포함.
5. **프론트매터 메타 블록 (3)** — 방향 확정됨(2번). `markdown.js` 파싱 로직 + `index.html` 카드 CSS, 다른 항목과 파일 충돌 없음.
6. **mermaid 지원 (1)** — 신규 의존성 추가 + 여러 파일(렌더러/테마/split-view) 걸친 기능 추가라 가장 마지막. UMD 번들 존재 여부와 `file://` 로드 시 CSP/CORS 통과 여부(`tests/unit/csp.test.js`)를 의존성 추가 직후 바로 확인할 것 — 여기서 막히면 접근 방식 자체를 재검토해야 한다.
