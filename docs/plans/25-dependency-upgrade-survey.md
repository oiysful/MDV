# 25. 전체 의존성 최신화 조사

## 상태
**조사 완료·결정 완료, 구현 미착수 (2026-10-02).** 결정(Ian): **Electron은 44**(macOS 12 지원 종료를 감수, 최소 버전을 앱·cask에 명시), **mermaid 12는 나중에**(취약 의존성이 업스트림에서 고쳐져 override 없이 올릴 수 있을 때 시각 검토와 함께) — 이번 묶음은 1~4번 PR. marked 9가 첫 커밋의 CDN 주소(2023년 말 시점 버전)에서 굳어진 것으로
드러난 뒤(계획 24), 나머지 의존성도 같은 기준으로 점검했다. 문서만이 아니라 **실험 worktree에서 marked를 뺀
전부를 실제로 올려 단계별로 테스트**했고, 그 결과가 이 문서의 근거다. 결정할 것은 두 가지다:
**Electron 43과 44 중 어디로**, **mermaid 12를 지금 들일지**.

> **기한이 있는 항목이 하나 있다: Electron 42는 2026-10-20에 지원이 끝난다**(Electron 45 안정판 출시일).
> 그 뒤로는 Chromium 보안 패치가 42에 백포트되지 않는다. 나머지는 기한 없음.

## 요약

| 패키지 | 현재 | 목표(쿨다운 통과) | 실제 최신 | 판단 | 위험 |
|---|---|---|---|---|---|
| **electron** | 42.11.8 | **44.4.5** (또는 43.x) | 44.5.1 (2026-09-30 → 쿨다운 2026-10-07 해제) | **필수, 10/20 전** | 중 — 대화상자 시작 폴더, macOS 12 지원 종료(44) |
| @highlightjs/cdn-assets | 11.11.1 | 11.12.0 | 동일 | 올림 | 낮음 — C/C++ 문법 ReDoS 수정 포함 |
| playwright (dev) | 1.60.0 | 1.63.0 | 동일 | 올림 | 낮음 |
| jsdom (dev) | 29.1.1 | 30.1.1 | 동일 | 올림 | 낮음 — Node `^22.22.2` 요구, CI는 22.23.2 |
| katex | 0.16.47 | 0.18.9 | 0.19.0 (2026-10-01 → 쿨다운 2026-10-08 해제) | 올림 | 낮음 |
| js-yaml | 4.3.2 | 5.4.2 | 동일 | 올림 — **코드 수정 필요** | 중 — 테스트가 못 잡는 회귀 1건 |
| mermaid | 11.17.2 | 12.0.0 | 동일 | **결정 필요** | 중 — 모양 변경, 취약 의존성(override 필요), 앱 +64MB |
| marked | 9.1.6 | — | 18.0.14 | **보류 중** (계획 24, Draft PR #28) | — |
| chokidar | 5.0.0 | — | 동일 | 이미 최신 | — |
| dompurify | 3.4.16 | — | 동일 | 이미 최신 | — |
| electron-builder (dev) | 26.15.3 | — | `latest` 태그 = 26.15.3 | 이미 최신 | — (`v26` 태그는 26.17.0, `next`는 27.0.0-alpha.9 — 메인테이너가 `latest`로 올리지 않은 판) |

"목표"는 저장소 `.npmrc`의 `min-release-age=7`을 통과한 가장 높은 버전이다. 쿨다운을 우회하지 않는다.

## 실험 결과 (develop @ 3d5e227, 별도 worktree)

| 단계 | 적용 | unit | controller | Electron |
|---|---|---|---|---|
| 기준 | — | 248/248 | 13/13 | — |
| 1 | highlight.js 11.12, jsdom 30, playwright 1.63 | 248/248 | 13/13 | — |
| 2 | + js-yaml 5(경로 변경), katex 0.18, mermaid 12 | **247/248** (js-yaml 날짜) | 13/13 | — |
| 3 | + Electron 44.4.5 | 247/248 | 13/13 | **109/109** (70.7s) |
| 4 | + `overrides: { "lodash-es": "4.18.1" }` | 247/248 | 13/13 | mermaid 관련 17/17 |

그 밖의 실측:
- **배포 앱(asar)**: `electron-builder --dir`로 빌드해 바뀐 경로 6개(js-yaml browser UMD, mermaid, katex js/css,
  highlight.js, marked)가 모두 들어가는 것을 확인.
- **업데이트 확인 네트워크 경로**: 테스트는 실제 요청을 건너뛰므로(`realUpdateCheck` 사용처 0) Electron 44.4.5
  메인 프로세스에서 `net.request`로 GitHub Releases API를 직접 호출 → **200, 9728바이트**. v44의 `net.request`
  변경(navigate 모드가 아닌 frame 대상 거부)은 MDV 경로에 해당하지 않는다.
- **크기**(같은 방식으로 develop도 실제 설치 후 빌드): 앱 **405MB → 469MB**(asar 129 → 181MB, Electron Framework
  274 → 286MB), 사용자가 받는 zip **161MB → 176MB**. 증가분 대부분은 mermaid 12의 새 의존성(ELK 등)이다.
- `npm audit`: 4단계 이전 **high 5건**(mermaid 12 경유), override 후 **0건**.

---

## 1. Electron 42 → 44 (또는 43) — 기한 있음

### 지원 기간
| 버전 | Chromium | Node | 지원 종료 |
|---|---|---|---|
| 42 (현재) | 148 | 24 | **2026-10-20** |
| 43 | 150 | 24 | 2027-01-05 |
| 44 | 152 | 24 | 2027-03-02 |
| 45 | — | — | 2026-10-20 안정판 예정 |

### breaking change → MDV 영향
| 버전 | 변경 | MDV |
|---|---|---|
| 43 | **`dialog.showOpenDialog`/`showSaveDialog`가 마지막으로 쓴 폴더를 기억하지 않고 다운로드 폴더에서 열림** | **영향 있음.** `main.js:422,439`(열기 2곳)는 `defaultPath`가 없고, `:474,487`(저장 2곳)은 파일 이름만 준다. 사용자에게 보이는 변화 → Electron 문서의 권장 패턴대로 마지막 선택 경로를 기억해(`path.dirname(result.filePaths[0])`) `defaultPath`로 넘기고, 저장은 현재 문서 폴더 + 파일 이름으로 준다. 기존 대화상자 스텁 테스트로 단언 가능 |
| 43 | Linux 둥근 모서리·WCO, 서브프레임 워커, DevTools 확장 preload | 해당 없음 (macOS 전용, 서브프레임·확장 없음) |
| 44 | **macOS 12 Monterey 지원 종료** | **영향 있음.** `package.json`에 `mac.minimumSystemVersion`이 없고, Homebrew cask(`oiysful/tap/mdv`)도 `depends_on :macos`만 있다 → Monterey 사용자는 설치는 되고 실행이 안 된다. 44로 가면 `minimumSystemVersion: "13.0"`과 cask `depends_on macos: ">= :ventura"`를 같이 넣는다 |
| 44 | `clipboard` 모듈을 렌더러에서 제거·W3C API로 재설계 | MDV는 Electron `clipboard`가 아니라 `navigator.clipboard.writeText`만 쓴다(`app-runtime.js:360,411`, `update-notice.js:38`) — 복사 테스트 통과 |
| 44 | `setTrafficLightPosition` 제거, `ipcRenderer.sendTo` 제거, 로그인 항목 속성 | 사용처 없음 (`titleBarStyle: 'hiddenInset'`만 사용) |
| 44 | `net.request` frame 대상 거부, `select-client-certificate`의 `webContents` null | 해당 없음 — 위 실측 |

### 43이냐 44냐
- **44**: 지원이 두 달 더 길고(2027-03) 다음 업그레이드까지 여유가 있다. 대가는 macOS 12 사용자 이탈.
- **43**: macOS 12 유지, 2027-01까지. 대화상자 변경은 43에서 이미 오므로 작업량은 거의 같다.
- 실험은 44로만 했다. 43을 고르면 같은 스위트를 43에서 한 번 더 돌린다.

## 2. js-yaml 4 → 5 — 코드 수정 필요

| 변경 | MDV 영향 | 대응 (실험으로 확인) |
|---|---|---|
| 브라우저 빌드가 `dist/browser/`로 이동, `dist/js-yaml.min.js` 없음 | `index.html:18` | `node_modules/js-yaml/dist/browser/js-yaml.umd.min.js` — 같은 전역 `jsyaml`, `load` 그대로 |
| `load()` 기본 스키마가 **YAML 1.2 CORE**(timestamp·merge 없음) | **프론트매터 `date: 2026-08-05`가 `Date`가 아니라 문자열** — 날짜 표시 포맷(`formatFrontmatterDate`)이 안 탄다. 단위 테스트 1건 실패 | `new Schema([...CORE_SCHEMA.tags, timestampTag, mergeTag, binaryTag])` — v4와 같은 결과 확인(날짜·`<<: *anchor` 병합·`!!binary`). binary를 빼면 `!!binary` 태그에서 예외 → 프론트매터 전체가 원문 노출 |
| `YAML11_SCHEMA` | — | **쓰지 않는다.** 날짜는 살지만 `n:` 키가 `false`, `1:23`이 83이 되는 등 v4보다 공격적 |
| **빈 입력이면 예외** | **테스트가 못 잡는 회귀**: `---\n---`, 빈 줄만·주석만 있는 프론트매터가 develop에선 제거되는데 v5에선 `catch`로 빠져 `---` 두 줄이 본문에 그대로 남는다 | 파싱 전에 공백·주석뿐인지 검사해 `frontmatter: []`로 처리. **세 경우 각각 단위 테스트 추가** |
| 새 보안 한도 `maxDepth`(100)·`maxAliases`·`maxTotalMergeKeys` | 신뢰할 수 없는 `.md`의 YAML 폭탄 방어 — 이득 | 기본값 유지 |

## 3. mermaid 11 → 12 — 결정 필요

| 변경 | MDV 영향 | 실측 |
|---|---|---|
| 기본 레이아웃 dagre → **ELK**, 기본 외관 `classic` → `neo`, flowchart 기본 테마 `redux-color` | MDV는 `theme`(`default`/`dark`)를 명시(`markdown.js:520`)하므로 테마 변경은 덮이고 **배치만 바뀐다**. 노드 색은 같음 | 같은 flowchart: 11 = 249×449, 12 = 360×518 |
| `initialize({ look: 'classic', layout: 'dagre' })`로 되돌리기 | 권장되는 호환 설정 | **완전히 돌아오지 않는다**: 426×526 (프런트매터로 줘도 같음). 12의 dagre 자체가 간격이 다르다 → 시각 검토 필요 |
| **`chevrotain ~11.1.2` 고정 → 취약한 `lodash-es` 4.17.23** | `npm audit` high 5건 — **CI 감사 게이트에서 막힘** | `overrides: { "lodash-es": "4.18.1" }`(183일 된 판) → 0건. chevrotain을 실제로 거치는 pie·gitGraph·packet이 11과 같은 크기로 오류 없이 렌더됨 |
| `mermaid.min.js` 3.4MB → 5.3MB (ELK 인라인) | 지연 로딩이라 첫 다이어그램까지 시간만 늘어남. 앱 +64MB의 주원인 | — |
| ES2024·Safari 17.4+·Node 22.12+ | Chromium 148/152라 무관 | — |
| `defaultRenderer` 옵션 제거 | 사용처 없음 | — |

**테스트 대기 조건이 더 이상 충분하지 않다.** ELK 렌더는 비동기라 `svg`가 생긴 시점에 아직 `viewBox`가 없다
(실험 중 직접 관측 — 그래서 첫 측정이 틀렸다). `boot-and-render.test.js`의 mermaid 테스트들과
`security-and-scroll.test.js:294`가 `#content .mermaid svg` 존재만 기다린 뒤 측정한다. 로컬에선 통과했지만, 이
저장소의 플레이크 넷이 모두 이런 "만료되는 대기"였다(AGENTS.md NOTES). mermaid 12 PR은 이 대기를 MDV 자신의
완료 신호(`data-processed` 등)로 바꾼다.

**override는 임시 장치다.** mermaid가 chevrotain을 올리면 제거한다. 넣을 때 `memory-security.md`에 사유와 제거
조건을 같이 적는다(이 저장소의 "allowlist는 accepted_risks와 함께" 규칙과 같은 취지).

## 4. 나머지 (낮은 위험)

- **highlight.js 11.12.0**: 문법 추가·수정 위주, **C/C++ 문법 ReDoS 수정**(#4362) 포함. 파일 경로 동일.
- **KaTeX 0.18.9**: 내부 CSS 클래스에 접두어(`base` → `katex-base` 등). MDV가 직접 지정하는 건 `.katex-error`뿐이고
  0.18에서도 같다. JS·CSS를 같은 패키지에서 함께 올리므로 안전. 0.19(쿨다운 대기)의 strict 오류 보고 변경은 MDV가
  `strict: false`라 무관.
- **jsdom 30**: 깨지는 변경은 Node 최소 버전뿐(CI 실측 v22.23.2 충족). `getComputedStyle()`이 길이를 px로 바꿔
  주도록 고쳐졌는데, 계획 23의 mermaid 호스트 폭 계산이 jsdom 테스트에서 이 값을 읽는다 — 1단계 실험에서 통과.
- **playwright 1.63**: 릴리스 노트에 Electron·breaking 항목 없음. Electron 44와 함께 109/109.

## 진행안 — PR 묶음과 순서

1. **Electron** (기한 10/20) — 43 또는 44로. 대화상자 `defaultPath` 명시 + 테스트, (44면) `minimumSystemVersion`과
   cask `depends_on macos` 같이. playwright 1.63을 같이 올린다(Electron 런처).
2. **저위험 묶음** — highlight.js, jsdom.
3. **KaTeX** 0.18.9 (0.19가 쿨다운을 넘긴 뒤라면 0.19).
4. **js-yaml 5** — 경로, 스키마(CORE+timestamp+merge+binary), 빈 입력 처리 + 테스트.
5. **mermaid 12** (결정 시) — override + 제거 조건, look/layout 결정, 테스트 대기 조건 교체, 시각 검토.
6. **marked** — 계획 24대로 보류 유지.

각 PR은 unit·controller는 매 수정, Electron 전체 스위트는 마무리 전 1회, CI 감사 게이트 통과.

### 스위트가 못 하는 수동 확인
- `--dir` 빌드를 **실제로 실행**해 보기 (이번엔 asar 목록만 봤다)
- 열기/저장 대화상자의 시작 폴더 (네이티브 대화상자라 자동화 불가)
- SMB 볼륨 소실 시나리오(계획 22)를 새 Electron에서 한 번
- mermaid·KaTeX 문서의 인쇄/PDF
- mermaid 다이어그램 시각 비교(11 vs 12)

## 출처
- Electron breaking changes: https://github.com/electron/electron/blob/main/docs/breaking-changes.md
- Electron 일정·지원 기간: https://releases.electronjs.org/schedule , https://endoflife.date/electron
- mermaid 12.0.0 릴리스 노트: https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0
- js-yaml CHANGELOG: https://github.com/nodeca/js-yaml/blob/master/CHANGELOG.md
- KaTeX CHANGELOG: https://github.com/KaTeX/KaTeX/blob/main/CHANGELOG.md
- jsdom 30.0.0 릴리스: https://github.com/jsdom/jsdom/releases/tag/v30.0.0
- highlight.js 11.12.0 릴리스: https://github.com/highlightjs/highlight.js/releases/tag/11.12.0
- playwright 1.61–1.63 릴리스: https://github.com/microsoft/playwright/releases
- Context7 `/electron/electron` — `docs/breaking-changes.md` "v43: Dialog defaultPath now defaults to Downloads directory"(마지막 경로 기억 패턴 예시 포함), `docs/api/dialog.md`
- Context7 `/mermaid-js/mermaid` — `docs/syntax/flowchart.md` "Default theme, look and layout (v12.0.0+)", `docs/intro/syntax-reference.md` (`layout: dagre`, `look: classic`)
- marked: 계획 24 (`docs/plans/24-marked-upgrade.md`)
