# 24. marked 9.1.6 → 18 업그레이드와 마크다운 파싱 O(n²) 대응

## 상태
**A 구현 완료 → 보류 (2026-10-01, Ian 결정). B 미결.** 계획 23의 codex 2차 리뷰가 남긴 P1(짝 없는 강조
구분자의 O(n²))에서 출발했다. A(업그레이드)는 구현·검증까지 끝내 **Draft PR #28**(`chore/marked-18`)로 올렸지만,
marked 18 자체의 회귀 3건(아래 "A 착수 결과")이 나와 머지하지 않기로 했다. 업스트림 제보도 하지 않기로 했다.
**재개 조건**: 아래 R1–R3와 #4099가 marked 릴리스에서 고쳐졌는지 확인되면 PR #28을 develop에 맞춰 다시 측정한다.

## 요약

| 질문 | 답 | 근거 |
|---|---|---|
| marked 업그레이드로 O(n²)가 사라지나 | **아니다.** 9 → 18 모든 메이저에서 동일 | 아래 1절 실측 (8000회 반복 ≈ 3.4–8s, 전 버전) |
| 업스트림은 알고 있나 | 예 — 이슈 #4099(2026-09-19, 18.0.13에서 12KB에 16s), 수정 PR #4103 열림·변경 요청 | 메인테이너: "신뢰할 수 없는 마크다운은 Worker에서 파싱하라" |
| 그럼 업그레이드는 왜 하나 | ① #4103은 현행 18.x를 대상으로 한다 — 9.x의 마지막 릴리스는 9.1.6(2023-11-10)이고 그 뒤 9.x 릴리스는 없다(`npm view marked@9 version`). 과거 구버전 백포트 전례(#2380)는 있으나 기대할 근거는 없다 ② 2년 치 스펙·버그 수정 | 수정을 받는 가장 확실한 길은 18로 와 있는 것 |
| 업그레이드 비용 | 단위 테스트 248건 중 **21건 실패**, 원인은 사실상 2곳(`code`·`blockquote` 렌더러 시그니처) | 아래 2절, 실험 worktree에서 실측 |
| 새로 생기는 위험 | v17부터 `'~a '` 반복이 marked 기본 경로에서 181ms → 2.3s로 **악화** — 단 MDV의 `del` 오버라이드 경로에서는 181ms 유지 | 아래 1절 |

---

## 1. O(n²)는 marked의 어느 버전에서나 그대로다 — 실측

각 메이저를 나란히 설치해 `new Marked({gfm:true, breaks:true}).parse(입력×8000)`을 쟀다(ms).

| 버전 | `'*xa '` | `'_a '` | `'**a '` | `'~a '` | `'[a](b) c '` | `'a~'` |
|---|---|---|---|---|---|---|
| 9.1.6 (현재) | 3962 | 3609 | 7450 | 181 | 37 | 45 |
| 12.0.2 | 3713 | 3544 | 7804 | 177 | 39 | 46 |
| 13.0.3 | 3610 | 3489 | 7251 | 176 | 39 | 44 |
| 15.0.12 | 3756 | 3512 | 7591 | 179 | 40 | 45 |
| 16.4.2 | 3734 | 3640 | 7694 | 182 | 39 | 47 |
| 17.0.6 | 3724 | 3379 | 7484 | **2269** | 36 | 44 |
| 18.0.14 | 4056 | 3789 | 8171 | **2476** | 18 | 8 |

- 짝 없는 `*`/`_`/`**`는 전 버전 공통 — `Tokenizer.emStrong`이 여는 구분자마다 뒤의 구분자를 전부 훑는다(#4099).
  32KB 남짓한 문서로 렌더러가 수 초 멈춘다. 물결과 무관하며, 계획 23 이전부터 있던 성질이다.
- `'~a '`는 **17에서 새로 나빠졌다.** 업그레이드가 오히려 표면을 넓히는 셈이다 — 다만 MDV는 `del`을
  오버라이드하므로(계획 23) MDV 렌더 경로에서는 아래처럼 다르게 나온다.

MDV 렌더 경로(`createMarkdownController#renderMarkdown`, 8000회):

| 입력 | develop (9.1.6) | 실험 worktree (18.0.14) |
|---|---|---|
| `'*xa '` | 3812 | 3935 |
| `'~a '` | 179 | 181 |
| `'a * '`×80000 | 37 | 49 |
| `'~*x~a '` | 3789 | **18** |

**우리 `del` 오버라이드는 18에서도 marked 자신의 규칙을 돌린다 — 확인함.** `this.rules.inline.del`은 두 버전
모두 존재하고, 18의 것은 백슬래시 이스케이프를 인식하는 형태다
(9: `^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1…` / 18: `…((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1…`).
`~*x~a ~*x~a`의 토큰열도 두 버전이 같다. 그러니 `'~*x~a '`가 18에서 18ms인 것은 오버라이드 오작동이 아니라
18의 `emStrong`이 이 특정 모양(`*x` 바로 뒤가 `~`)을 다르게 처리하기 때문으로 보인다 — 원인까지는 파지
않았다. 같은 18에서 `'*xa '`는 여전히 3.9s다.

## 2. 업그레이드 비용 — 실험 worktree에서 실측

`develop`(0c5656a)에서 `marked@18.0.14`로 교체하고 `index.html`의 경로만 바꿨다
(`node_modules/marked/marked.min.js` → `node_modules/marked/lib/marked.umd.js`).

| 스위트 | 결과 |
|---|---|
| unit | **227 / 248** — 21건 실패 |
| controller | 13 / 13 |
| Electron | 미실행(렌더러 시그니처를 고치기 전엔 의미 없음) |

실패 21건 = 코드블럭 16 + Alert 4 + 물결 1. 실질 원인은 두 갈래다.
- **`renderer.code(code, lang)` (16건)** — v13에서 렌더러가 토큰 객체를 받게 됐고 v14에서 옛
  시그니처가 제거됐다. `lang`이 사라져 mermaid·latex/math·하이라이트 코드블럭이 전부 일반 코드로 나온다.
  `({ text, lang, escaped })`로 바꾸면 된다.
- **`renderer.blockquote(quote)` (Alert 4건)** — 같은 이유. 이제 `({ tokens })`를 받으므로 `quote` HTML을
  직접 만들어야 한다. MDV의 오버라이드는 **화살표 함수**라 `this.parser`가 렌더러의 파서가 아니다 —
  `const quote = renderer.parser.parse(tokens)`로 쓴다(파서는 parse 시점에 렌더러에 붙는다). 실험 worktree에서
  이 두 줄로 Alert 테스트 5건이 전부 통과함을 확인했다. Alert 판별 정규식은 그대로.
- **물결 1건 — 회귀 아님**: `~a\~b~`가 9.1.6에선 `<del>a\</del>b~`(백슬래시 노출)였고 18은 GFM대로
  `<del>a~b</del>`를 낸다. 계획 23에서 "바뀌면 의도적으로" 고정해 둔 값이 바뀐 것 — 기대값만 갱신.
  나머지 물결 테스트는 18에서 모두 통과 → `inlineText` 훅은 18에서도 동작한다.

### 릴리스 노트의 breaking change → MDV 영향 지점

| 버전 | 변경 | MDV 영향 |
|---|---|---|
| 10 | Node 16 지원 중단 | 없음 (Node 26 / Electron 42) |
| 11 | `Lexer.rules` 구조 변경 | `del` 오버라이드의 `this.rules.inline.del` — 18에도 존재, 이스케이프 인식형으로 바뀜(1절, 확인함) |
| 12 | CommonMark 0.31.2, 유니코드 구두점 확장 | 강조 판정이 일부 바뀜 — 렌더 결과 회귀 테스트로 확인 |
| 13–14 | 렌더러가 토큰 객체를 받음, 옛 렌더러 제거 | **`renderer.code`, `renderer.blockquote`** (`markdown.js:288-379`) |
| 15 | HTML 이스케이프가 토크나이저 → 렌더러로 이동 | **`inlineText` 훅**이 `token.text`에 `~`를 붙인다 — `~`는 이스케이프 대상이 아니라 무해할 것이나 확인. `code` 렌더러의 `escaped` 처리 |
| 16 | `marked.min.js`·`lib/marked.cjs` 제거, ESM 전용 | **`index.html:15` 경로** → `lib/marked.umd.js` (vm으로 로드해 전역 `marked`가 MDV가 쓰는 `parse`·`parseInline`·`lexer`·`use`·`setOptions`·`Renderer`·`Tokenizer.prototype.inlineText`를 모두 가짐을 확인), 테스트 2곳의 `require('marked')`(Node 26은 `require(esm)` 지원 — 실험에서 동작 확인) |
| 17 | 리스트 텍스트 토큰·체크박스 토큰 변경 | 리스트 렌더러는 오버라이드하지 않음 — 작업 목록 렌더 확인만 |
| 18 | 블록 토큰 끝 빈 줄 제거 | **`extractHeadingsFromSource`**(`markdown.js:71-100`)가 `token.raw`로 원문 위치를 찾는다 — 목차·소스 줄번호 매핑 회귀 확인 |

### 계획 23과의 관계
계획 23의 물결 규칙은 `marked.use({ tokenizer: { inlineText, del } })` 두 개뿐이고 18에서도 API가 같다.
따라서 업그레이드가 그 규칙을 버리게 만들지는 않는다 — 실험에서 물결 테스트는 기대값이 바뀐 `~a\~b~` 하나를 빼고 모두 통과했다.

## 3. 목표 B — 신뢰할 수 없는 문서의 파싱 시간 상한

MDV는 사용자가 연 로컬 파일만 렌더하므로, 위협은 "악의적인 `.md`를 열면 앱이 수 초~수십 초 멈춘다"는
**가용성** 문제다(데이터 유출·코드 실행 아님). 창을 닫으면 끝나지만, 세션 복원이 같은 파일을 다시 열면
재발한다는 점은 따져볼 만하다.

| 안 | 내용 | 장점 | 비용/위험 |
|---|---|---|---|
| **B0. 업스트림 대기** | #4103 머지 후 18.x 패치로 수령 | 코드 0줄 | 언제 될지 모름. A가 선행돼야 받을 수 있음 |
| **B1. Worker 파싱 + 시간 상한** | `marked.parse`를 Web Worker에서 돌리고 N초 초과 시 `terminate()` → 일반 텍스트로 표시 + 토스트 | 메인테이너 권장안. 어떤 O(n²)든 막는다(미래의 것 포함) | `renderer.code`가 hljs·KaTeX를 동기 호출하므로 Worker 안에도 로드 필요. DOMPurify·mermaid는 메인 스레드에 그대로. `file://` 페이지에서 Worker 생성이 Electron에서 되는지 **미검증**(CSP는 `worker-src`가 없어 `script-src 'self'`를 따름). 렌더가 비동기가 되어 검색·목차·분할뷰 동기화의 타이밍 가정이 흔들릴 수 있음 |
| B2. 자체 emStrong 패치 | #4103의 아이디어를 `tokenizer.emStrong` 오버라이드로 이식 | Worker 없이 해결 | marked 내부 알고리즘의 포크 — 업그레이드마다 유지보수. 권장하지 않음 |

## 권장
1. **A를 먼저** — 업스트림 수정을 받을 자리를 만드는 작업이고, 실측상 범위가 렌더러 두 곳 + 경로 한 줄로
   좁다(`blockquote`는 실험에서 이미 해결 확인). 착수 시 2절 표의 회귀 확인(v18 목차 줄번호, v17 작업 목록,
   v12 강조 판정, v15 `code` 렌더러의 `escaped`)과 Electron 전체 스위트를 완료 조건으로 둔다.
2. **B는 A 이후 별도 결정** — #4103의 진행을 보고, 그때도 열려 있으면 B1의 `file://` Worker 가능성부터
   프로브(30분짜리)로 확인한 뒤 착수 여부를 정한다. B2는 하지 않는다.

## A 착수 결과 (2026-10-01) — 보류

구현 레인(worktree) → advisor 검토 → 패키징 앱 확인 → codex 리뷰(`codex exec`, Electron 금지) 순서로 진행.
unit 254 / controller 13 / Electron 109(74.4s), `npm audit --audit-level=high` 0. `electron-builder --dir`로 만든
asar에 `node_modules/marked/lib/marked.umd.js`(18.0.14)가 들어 있고 MDV가 쓰는 API를 모두 가짐을 확인.

### 이 계획서가 틀렸던 곳
1. **"`del` 오버라이드가 18에서도 MDV를 보호한다" — 단일 `~`에만 맞았다.** marked 17부터 기본 `del` 토크나이저는
   `delLDelim`/`delRDelim`을 쓰는 구분자 런 스캐너로 바뀌어 **`rules.inline.del`을 쓰지 않는다**(정규식은 남아 있음).
   `~~`가 그쪽으로 넘어가 `'~~a '`×8000이 215ms → 2.8s, 짝 맞춤도 달라졌다. PR #28에서 오버라이드가 `~~`도
   맡고 `false`를 반환하지 않게 고쳤다(9와 같은 비용·짝 맞춤).
2. 1절의 `'~*x~a '` 18ms는 오버라이드 오작동이 아니다 — 확인함(정규식·토큰열 동일).
3. 2절 표에 없던 차이: 18은 문서 끝 들여쓰기 코드블럭의 끝 개행을 남긴다 → 9처럼 잘라냄.
4. `~a\~b~`는 18의 이스케이프 인식형 del 정규식 때문에 `<del>a~b</del>`가 된다 — 기대값 갱신.

### 보류 사유 — 기본 marked 18 자체의 회귀 (MDV 코드 없이 재현, 2026-10-01 기준 업스트림 이슈 없음)
| # | 재현 | marked 9 | marked 18 |
|---|---|---|---|
| R1 | `marked.lexer('> a\nb\n'.repeat(32000))` (인용문 lazy continuation) | 6 ms | **695 ms** — O(n²) |
| R2 | `` `x``y` **b** `c` `` (백틱 포함 코드 스팬 뒤의 굵게) | `<strong>b</strong>` | `**b**` 글자 그대로 — 커밋된 문서 `done/2026-08-12/13-performance-diet.md`도 깨짐 |
| R3 | `&#38;amp; para` (숫자 참조) | `&amp; para` 표시 | `& para` 표시 — 두 번 디코딩(텍스트 충실도 문제, XSS 아님) |

원래 동기인 #4099(짝 없는 `*`, `'*xa '`×8000 ≈ 3.8s)는 두 버전 모두 그대로다. 즉 A는 지금 머지하면 고치는 것
없이 회귀 셋을 들인다. 얻는 것(큰 문서 일부 입력 속도 개선 — `'a~'`×40000 1997 → 21ms, `'[a](b) c '`×40000
1892 → 771ms; CommonMark 규칙 정정)은 보류해도 잃지 않는다.

### 그 밖의 렌더 차이 (문서 119개 + 합성 33개, fuzz ~6만 건)
목차 줄번호 차이 0. HTML 차이 12건 중 11건은 무해(18이 HTML 블록 끝 빈 줄을 다듬음, v17 체크박스 토큰), 1건은 R2.
fuzz 차이 96건은 전부 기본 9 vs 기본 18의 차이(CommonMark 3의 배수 규칙 정정, GFM에서 `~`를 강조 판정의
비구두점으로 취급 — 예: `텍스트*~취소~*다` → `<em><del>`, github.com은 글자 그대로)이고 MDV 오버라이드 기인 0건.

## 재현 방법
- 버전별 표: 빈 디렉터리에 `npm i --ignore-scripts marked9@npm:marked@9.1.6 … marked18@npm:marked@^18`을
  **한 번에** 설치(`--no-save`로 하나씩 깔면 앞 버전이 지워진다)하고 위 입력으로 `parse` 시간을 잰다.
- 업그레이드 실험: `git worktree add --detach … develop` → `npm ci` → `npm i --ignore-scripts marked@18.0.14`
  → `index.html`의 marked 경로를 `lib/marked.umd.js`로 → `npm run test:unit`.

## 출처
- marked 릴리스 노트 v10.0.0–v18.0.0 (breaking changes): https://github.com/markedjs/marked/releases
- 업스트림 이슈 #4099 "emStrong is quadratic in the number of unmatched emphasis delimiters": https://github.com/markedjs/marked/issues/4099
- 수정 PR #4103 (열림, 변경 요청 — 모듈 수준 캐시가 문서를 붙잡는 문제, 테스트 위치): https://github.com/markedjs/marked/pull/4103
- Worker 권장: https://marked.js.org/using_advanced#workers
- 렌더러 토큰 객체 API: Context7 `/markedjs/marked` — `docs/USING_PRO.md`
