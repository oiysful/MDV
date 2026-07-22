# 06. 보안취약점 점검 결과 및 하드닝 계획

## 상태
요청 (보안 감사 완료, 2026-07-22) — [`docs/self-check-request.md`](../self-check-request.md) 6번 항목("보안취약점 점검")에 대한 조사 결과.

## 문제
`AGENTS.md`의 "ANTI-PATTERNS" 절이 문서화한 기존 하드닝(contextIsolation/sandbox, DOMPurify 새니타이즈, 이미지 확장자 allowlist, `open-external-url`의 `^https?://` 검사, `will-navigate`/`setWindowOpenHandler` 가드 등)을 감사 기준선으로 삼아, 그 이후 추가된 경로 중 같은 규칙을 상속받지 못한 신규 격차를 점검했다. **총 7건(HIGH 1, MEDIUM 2, LOW 4)**을 확인했으며, 단순히 `.md` 파일을 여는 것만으로 발생하는 무조건적 RCE는 없다.

## 근거 / 원인 (findings)

### HIGH-1. `open-local-path`가 임의 로컬 파일을 실행 — 원클릭 로컬 코드 실행
- `src/main.js:351-373`, 특히 `:363-369` — 대상이 `.md`/`.markdown`이 아니면 확장자·경로 제한 없이 곧바로 `shell.openPath(targetPath)`(`:367`)를 호출한다.
- 대조: `read-image-data-url`(`:440-452`)은 확장자 allowlist(`IMAGE_MIME_TYPES`)가 있고, `open-external-url`(`:332-342`)은 `^https?://` 스킴 검사가 있다 — `open-local-path`만 이 두 패턴을 상속받지 못했다.
- 도달 경로: `src/renderer/app-shell.js:87-106`(`openLocalLink`) → `:96` `api.openLocalPath(resolved)`, 클릭 핸들러는 `:108-125`.
- 신뢰할 수 없는 마크다운 문서 하나(`git clone`한 저장소의 `README.md`에 `[Setup](./setup.command)` 같은 링크)를 열고 그 링크를 한 번 클릭하는 것만으로 로컬 실행 파일이 실행될 수 있다. macOS Gatekeeper 격리 속성은 *다운로드*된 파일에만 적용되므로 `git clone`/일반 압축 해제로는 걸러지지 않는다.

### MEDIUM-2. 새니타이즈를 거치지 않는 유일한 `innerHTML` 지점 — 탐색기 에러 메시지
- `src/renderer/explorer.js:208` — `container.innerHTML = \`<div class="tree-hint">${res.error}</div>\`` — `list-directory` 실패 시 OS 에러 메시지(디렉터리명 포함 가능)를 새니타이즈 없이 그대로 삽입한다.
- CSP의 `script-src 'self'`가 인라인 이벤트 핸들러 실행을 막아주므로 즉시 XSS는 아니지만(HTML 삽입에 그침), `AGENTS.md:79`("Rendered markdown is sanitized with DOMPurify... untrusted .md files are treated as hostile input")가 주장하는 "전부 새니타이즈"의 유일한 예외 경로다. CSP 자체가 리그레션되면 곧바로 `window.api`를 쥔 렌더러에 대한 XSS로 격상된다.

### MEDIUM-3. CSP `img-src`가 원격 https 이미지를 전부 허용 — 열람 신호 유출
- `src/renderer/index.html:7` — `content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data: https:;"` — `img-src`가 `https:` 전체를 허용한다.
- DOMPurify는 `<img src="https://evil.example/x.png">`를 제거하지 않으므로, 신뢰할 수 없는 `.md`를 열기만 해도 요청 시점에 IP와 열람 시각이 외부로 유출될 수 있다. `AGENTS.md:78`("CSP allows no remote script origins")은 `script-src`에는 맞지만 `img-src`에는 해당하지 않는다.

### LOW-4. `setWindowOpenHandler`에 스킴 검사 없음
- `src/main.js:84-87` — `shell.openExternal(url)`을 스킴 검사 없이 호출한다. `open-external-url` 핸들러(`:332-342`)와 달리 `^https?://` 체크가 없다. 콘텐츠 링크 클릭 핸들러가 먼저 가로채고 `will-navigate`가 백스톱이라 실제 도달 경로는 좁다.

### LOW-5. `read-image-data-url`에 경로 제한 없음
- `src/main.js:440-452` — 확장자 allowlist는 있지만(`AGENTS.md`가 주장하는 대로), 대상 경로가 문서/탐색기 루트로 제한되지 않아 디스크 어디의 `.png`든 읽어 data URL로 반환한다. `svg`도 허용 목록에 있다. `<img>` 태그 안에서는 스크립트가 비활성이라 즉시 위험도는 낮다.

### LOW-6. CSP에 `form-action`/`base-uri`/`object-src` 없음
- `src/renderer/index.html:7` — 세 지시어 모두 없다. DOMPurify는 `<form action="https://evil.example">`를 제거하지 않으므로(확인됨), 현재는 `will-navigate` 가드만이 폼 제출을 막고 있다.

### LOW-7. 의존성 감사
- `npm audit`: 1 critical + 4 high, 전부 devDependency(`electron-builder` 체인의 `tar`/`undici`/`node-gyp`) — 런타임 배포물에는 포함되지 않는다(`npm audit --omit=dev`는 1 low). Electron 42.3.0은 최신이고 pre/postinstall 스크립트 없음.

### 검증 완료 — 추가 발견 없음
- `src/preload.js`(전체 29줄) — 최소 표면. `ipcRenderer.invoke/send/on`과 `webUtils.getPathForFile` 래퍼뿐, Node/Electron 원시 기능이나 범용 채널명 패스스루 없음.
- `webPreferences`(`main.js:70-75`) — `contextIsolation: true`/`nodeIntegration: false`/`sandbox: true`, `webSecurity`는 미지정(기본값 `true`) — 문서화된 태세 그대로, 회귀 없음.
- 마크다운 렌더 파이프라인(`markdown.js`) — 주 렌더 경로(`:68-70`)와 스냅샷/재수화 경로(`captureSnapshotHTML` `:169`, `hydrateFromDom` `:220`) 모두 이미 새니타이즈된 DOM 위에서 동작. `renderedHTML`은 메모리에만 존재하고 세션 파일에는 경로만 저장되므로 재시작 시 재주입 경로도 없음.
- `eval`/`new Function`/`child_process`/비literal `require()` — `src/`, `scripts/` 전체에서 0건.

## 제안 방안
- **HIGH-1**: `open-local-path`의 non-markdown 분기(`main.js:363-369`)에 안전한 확장자 allowlist(`.pdf`/`.txt`/`.png`/`.csv` 등)를 적용하고, 목록 밖 확장자는 `shell.showItemInFolder`로 대체하거나 열기 전 확인 다이얼로그를 추가한다.
- **MEDIUM-2**: `explorer.js:208`을 `container.textContent = res.error`로 교체(감싸는 `<div class="tree-hint">` 엘리먼트는 유지, 내용만 텍스트로).
- **MEDIUM-3**: `index.html:7`의 `img-src`를 `'self' data:`로 축소 — 로컬 이미지는 이미 `read-image-data-url`을 통해 `data:` URI로만 삽입되므로 원격 https 허용이 애초에 불필요하다.
- **LOW-4**: `setWindowOpenHandler`(`main.js:84-87`)에 `open-external-url`과 동일한 `^https?://` 검사 추가.
- **LOW-5**: `read-image-data-url`(`main.js:440-452`)에 경로 제한 로직 추가 — 문서/탐색기 루트 정의가 필요해 설계 결정 선행 필요(아래 리스크 참고).
- **LOW-6**: CSP에 `form-action 'none'; base-uri 'none'; object-src 'none'` 추가.
- **LOW-7**: `npm audit fix` — devDependency 빌드체인 위생 목적, 런타임 영향 없음.
- **문서 동기화**: HIGH-1과 MEDIUM-2는 공통 원인이 있다 — 둘 다 `AGENTS.md`의 하드닝 규칙이 작성된 *이후*에 추가된 경로라 그 규칙을 상속받지 못했다. 수정 후 `AGENTS.md`의 ANTI-PATTERNS에 두 항목을 추가하고, CSP 회귀를 막을 자동 검증(예: `index.html`의 CSP meta 문자열을 파싱해 `img-src`에 `https:`가 없고 `form-action 'none'`이 있는지 확인하는 테스트)을 함께 추가할 것을 권장한다.

## 변경 파일
- `src/main.js` (HIGH-1, LOW-4, LOW-5)
- `src/renderer/explorer.js` (MEDIUM-2)
- `src/renderer/index.html` (MEDIUM-3, LOW-6)
- `AGENTS.md` (사후 문서화)
- `package.json`/`package-lock.json` (LOW-7)

## 테스트 계획
- HIGH-1: 허용/비허용 확장자 각각에 대해 `open-local-path`가 기대한 동작(allowlist는 `shell.openPath` 호출, 목록 밖은 거부/확인)을 하는지 유닛 또는 electron smoke 케이스 추가.
- MEDIUM-2: 악성 디렉터리명을 흉내낸 에러 문자열이 태그로 해석되지 않고 그대로 텍스트로 표시되는지 확인하는 unit/controller 테스트.
- MEDIUM-3 / LOW-6: `index.html`의 CSP meta content를 파싱해 `img-src`에 `https:` 미포함, `form-action 'none'` 포함을 검증하는 "CSP 고정" 유닛 테스트 신설 — 이후 CSP를 건드리는 변경마다 이 테스트가 의도적 갱신을 강제하는 안전장치 역할.
- LOW-4/5: 최소 커버리지 추가(기존 `open-external-url` 테스트가 있다면 동일 패턴으로 확장).

## 리스크 / 미결정 사항
- HIGH-1의 allowlist 범위는 제품 결정이 필요하다 — 너무 좁으면 정당한 사용성(예: 첨부된 `.docx` 열기)을 해치고, 너무 넓으면 우회 여지가 남는다. 사용자 승인 하에 목록을 확정해야 한다.
- LOW-5(`read-image-data-url` 경로 제한)는 탐색기 루트가 없는 단일 파일 오픈 세션에서 "루트"의 정의가 모호하다 — 문서가 위치한 디렉터리를 루트로 볼지 별도 정책이 필요한지 결정이 선행되어야 한다. v2로 미룰 수 있음.
- LOW-7(의존성 감사)은 런타임에 영향이 없으므로 우선순위가 낮다 — 다른 빌드체인 작업과 묶어 처리하는 것을 권장.
